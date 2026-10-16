import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

export const dynamic = 'force-dynamic';

const bucketName = 'ticketing-event-images';
const maxImageSize = 4 * 1024 * 1024;
const allowedTypes = new Map([
  ['image/jpeg', { extension: 'jpg', signature: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['image/png', { extension: 'png', signature: (bytes: Uint8Array) => bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a }],
  ['image/webp', { extension: 'webp', signature: (bytes: Uint8Array) => bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' }]
]);

type RouteContext = { params: Promise<{ eventId: string }> };

function storagePathFromUrl(value: string | null, eventId: string) {
  if (!value) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return null;
  try {
    const path = decodeURIComponent(value.slice(markerIndex + marker.length));
    return path.startsWith(`${eventId}/`) ? path : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin event photo uploads are required.' }, { status: 403 });
  }
  const session = await getAdminSession();
  if (!session || !['owner', 'admin'].includes(session.role.toLowerCase())) {
    return NextResponse.json({ error: 'Ticketing admin access is required to upload event photos.' }, { status: session ? 403 : 401 });
  }

  const { eventId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'A valid event is required.' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Choose a valid event photo to upload.' }, { status: 400 });
  }
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose an event photo first.' }, { status: 400 });
  }
  if (file.size > maxImageSize) {
    return NextResponse.json({ error: 'Event photos must be 4 MB or smaller.' }, { status: 413 });
  }
  const imageType = allowedTypes.get(file.type);
  if (!imageType) {
    return NextResponse.json({ error: 'Use a JPEG, PNG or WebP image.' }, { status: 415 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!imageType.signature(bytes)) {
    return NextResponse.json({ error: 'The uploaded file does not match its image type.' }, { status: 415 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const { data: event, error: eventError } = await database.from('ticketing_events')
    .select('id,cover_image_url')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) {
    console.error('[TicketingEventImage] Could not load event:', eventError);
    return NextResponse.json({ error: 'Event photo could not be uploaded.' }, { status: 503 });
  }
  if (!event) return NextResponse.json({ error: 'Event was not found.' }, { status: 404 });

  const path = `${eventId}/${randomUUID()}.${imageType.extension}`;
  const { error: uploadError } = await database.storage.from(bucketName).upload(path, bytes, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false
  });
  if (uploadError) {
    console.error('[TicketingEventImage] Storage upload failed:', uploadError);
    return NextResponse.json({
      error: uploadError.message.toLowerCase().includes('bucket not found')
        ? 'Apply supabase/TICKETING_EVENT_IMAGES_MIGRATION.sql before uploading event photos.'
        : 'Event photo could not be uploaded.'
    }, { status: 503 });
  }

  const { data: publicData } = database.storage.from(bucketName).getPublicUrl(path);
  const { error: updateError } = await database.from('ticketing_events')
    .update({ cover_image_url: publicData.publicUrl })
    .eq('id', eventId);
  if (updateError) {
    const { error: cleanupError } = await database.storage.from(bucketName).remove([path]);
    if (cleanupError) console.error('[TicketingEventImage] Could not remove unreferenced upload:', cleanupError);
    console.error('[TicketingEventImage] Could not save event photo URL:', updateError);
    return NextResponse.json({ error: 'Photo uploaded but could not be attached to the event.' }, { status: 503 });
  }

  const oldPath = storagePathFromUrl(typeof event.cover_image_url === 'string' ? event.cover_image_url : null, eventId);
  if (oldPath && oldPath !== path) {
    const { error: removeError } = await database.storage.from(bucketName).remove([oldPath]);
    if (removeError) console.error('[TicketingEventImage] Could not remove replaced event photo:', removeError);
  }
  return NextResponse.json({ success: true, coverImageUrl: publicData.publicUrl }, {
    headers: { 'Cache-Control': 'private, no-store' }
  });
}
