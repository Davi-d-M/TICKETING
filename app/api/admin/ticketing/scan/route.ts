import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin scan requests are required.' }, { status: 403 });
  }
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Admin access is required.' }, { status: 401 });
  if (!['owner', 'admin'].includes(session.role.toLowerCase())) {
    return NextResponse.json({ error: 'Ticket gate access is restricted to platform admins.' }, { status: 403 });
  }

  let body: { eventId?: unknown; credential?: unknown; gateName?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid gate scan is required.' }, { status: 400 });
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const credential = typeof body.credential === 'string' ? body.credential.trim() : '';
  const gateName = typeof body.gateName === 'string' ? body.gateName.trim() : '';
  if (!uuidPattern.test(eventId) || !/^[A-Za-z0-9_-]{40,60}$/.test(credential) || gateName.length > 120) {
    return NextResponse.json({ error: 'The selected event or scanned ticket code is invalid.' }, { status: 400 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  const { data, error } = await database.rpc('ticketing_check_in', {
    p_event_id: eventId,
    p_credential_hash: createHash('sha256').update(credential).digest('hex'),
    p_gate_name: gateName,
    p_staff_user_id: null,
    p_device_id: `admin:${session.email.toLowerCase()}`
  });
  if (error) {
    console.error('[TicketingGate] Could not validate scanned ticket:', error);
    return NextResponse.json({ error: 'Ticket admission could not be checked.' }, { status: 503 });
  }
  return NextResponse.json({ result: data }, { headers: { 'Cache-Control': 'no-store' } });
}
