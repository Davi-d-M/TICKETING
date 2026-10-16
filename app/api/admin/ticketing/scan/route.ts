import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';
import { readRotatingTicketCredential } from '@/lib/ticketing/rotatingCredential.server';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await getAdminSession();
  if (!session || !['owner', 'admin'].includes(session.role.toLowerCase())) {
    return NextResponse.json({ error: 'Platform admin access is required.' }, { status: 403 });
  }
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  const { data, error } = await database.from('ticketing_events')
    .select('id,title,status')
    .in('status', ['scheduled', 'on_sale', 'sold_out'])
    .order('starts_at', { ascending: true })
    .limit(100);
  if (error) {
    console.error('[TicketingGate] Could not load scanner events:', error);
    return NextResponse.json({ error: 'Scanner events could not be loaded.' }, { status: 503 });
  }
  return NextResponse.json({
    events: data || [],
    canManageStaff: session.role.toLowerCase() === 'owner'
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin scan requests are required.' }, { status: 403 });
  }
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Admin access is required.' }, { status: 401 });
  if (!['owner', 'admin'].includes(session.role.toLowerCase())) {
    return NextResponse.json({ error: 'Ticket gate access is restricted to platform admins.' }, { status: 403 });
  }

  let body: { eventId?: unknown; credential?: unknown; gateName?: unknown; requestId?: unknown; deviceId?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid gate scan is required.' }, { status: 400 });
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const credential = typeof body.credential === 'string' ? body.credential.trim() : '';
  const gateName = typeof body.gateName === 'string' ? body.gateName.trim() : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!uuidPattern.test(eventId) || !uuidPattern.test(requestId)
    || !/^[A-Za-z0-9_-]{20,512}\.[A-Za-z0-9_-]{40,60}$/.test(credential) || gateName.length > 120
    || deviceId.length > 160) {
    return NextResponse.json({ error: 'The selected event or scanned ticket code is invalid.' }, { status: 400 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  let rotatingCredential: ReturnType<typeof readRotatingTicketCredential>;
  try {
    rotatingCredential = readRotatingTicketCredential(credential);
  } catch (cause) {
    console.error('[TicketingGate] Rotating QR signing is not configured:', cause);
    return NextResponse.json({ error: 'TICKETING_QR_SIGNING_SECRET must be configured with at least 32 characters.' }, { status: 503 });
  }
  if (!rotatingCredential) return NextResponse.json({ error: 'This QR code is invalid or expired. Refresh the ticket wallet and scan the current code.' }, { status: 400 });
  try {
    const { data: ticket, error: ticketError } = await database.from('ticketing_tickets')
      .select('credential_hash,status')
      .eq('id', rotatingCredential.ticketId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (ticketError) {
      console.error('[TicketingGate] Could not resolve rotating ticket credential:', ticketError);
      return NextResponse.json({ error: 'Ticket admission could not be checked.' }, { status: 503 });
    }
    if (!ticket || typeof ticket.status !== 'string' || !['issued', 'checked_in'].includes(ticket.status)) {
      return NextResponse.json({ error: 'This ticket is not active for the selected event.' }, { status: 404 });
    }
    if (typeof ticket.credential_hash !== 'string' || !/^[0-9a-f]{64}$/.test(ticket.credential_hash)) {
      console.error('[TicketingGate] Active ticket has an invalid credential hash:', rotatingCredential.ticketId);
      return NextResponse.json({ error: 'The stored ticket credential is invalid. Contact event support.' }, { status: 503 });
    }
    if (!await consumeTicketingRateLimit(request, `gate:${session.email.toLowerCase()}`, 120, 60)) {
      return NextResponse.json({ error: 'Scanner rate limit reached. Wait one minute and try again.' }, { status: 429 });
    }
    const { data, error } = await database.rpc('ticketing_check_in', {
      p_event_id: eventId,
      p_credential_hash: ticket.credential_hash,
      p_gate_name: gateName,
      p_staff_user_id: null,
      p_device_id: deviceId || `admin:${session.email.toLowerCase()}`,
      p_request_id: requestId,
      p_staff_email: session.email.toLowerCase(),
      p_platform_admin: true
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'This scanner is not assigned to the selected event and gate.' }, { status: 403 });
      if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 });
      console.error('[TicketingGate] Could not validate scanned ticket:', error);
      return NextResponse.json({ error: 'Ticket admission could not be checked.' }, { status: 503 });
    }
    return NextResponse.json({ result: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingGate] Could not enforce scan rate limit:', cause);
    return NextResponse.json({ error: 'Ticket admission is unavailable until the security migration is configured.' }, { status: 503 });
  }
}
