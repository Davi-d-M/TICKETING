import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { gateCookieName, readGateStaffSession } from '@/lib/ticketing/gateAccess.server';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

type Assignment = { event_id: string; gate_name: string };

async function staffSession() {
  const token = (await cookies()).get(gateCookieName)?.value;
  return readGateStaffSession(token);
}

export async function GET() {
  let session;
  try {
    session = await staffSession();
  } catch (cause) {
    console.error('[TicketingGate] Gate session configuration is invalid:', cause);
    return NextResponse.json({ error: 'Gate staff sign-in is not configured.' }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: 'Sign in with your gate staff account.' }, { status: 401 });
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const { data: account, error: accountError } = await database.from('ticketing_gate_staff_accounts')
    .select('email')
    .eq('email', session.email)
    .eq('active', true)
    .maybeSingle();
  if (accountError) return NextResponse.json({ error: 'Gate staff access could not be checked.' }, { status: 503 });
  if (!account) return NextResponse.json({ error: 'This gate staff account is inactive.' }, { status: 403 });

  const { data: assignments, error: assignmentsError } = await database.from('ticketing_gate_staff_assignments')
    .select('event_id,gate_name')
    .eq('email', session.email)
    .eq('active', true);
  if (assignmentsError) {
    console.error('[TicketingGate] Could not load event assignments:', assignmentsError);
    return NextResponse.json({ error: 'Assigned gate events could not be loaded.' }, { status: 503 });
  }
  const rows = (assignments || []) as unknown as Assignment[];
  const ids = rows.map(row => row.event_id);
  const eventsResult = ids.length
    ? await database.from('ticketing_events').select('id,title,status').in('id', ids).in('status', ['scheduled', 'on_sale', 'sold_out'])
    : { data: [], error: null };
  if (eventsResult.error) {
    console.error('[TicketingGate] Could not load assigned events:', eventsResult.error);
    return NextResponse.json({ error: 'Assigned gate events could not be loaded.' }, { status: 503 });
  }
  const gateByEvent = new Map(rows.map(row => [row.event_id, row.gate_name]));
  return NextResponse.json({
    events: (eventsResult.data || []).map(event => ({ ...event, gateName: gateByEvent.get(event.id) || 'Main gate' }))
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Same-origin scan requests are required.' }, { status: 403 });
  let session;
  try {
    session = await staffSession();
  } catch (cause) {
    console.error('[TicketingGate] Gate session configuration is invalid:', cause);
    return NextResponse.json({ error: 'Gate staff sign-in is not configured.' }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: 'Sign in with your gate staff account.' }, { status: 401 });

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
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(eventId) || !uuidPattern.test(requestId)
    || !/^[A-Za-z0-9_-]{40,60}$/.test(credential)
    || !gateName || gateName.length > 120 || deviceId.length > 160) {
    return NextResponse.json({ error: 'The assigned event or scanned ticket code is invalid.' }, { status: 400 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  try {
    if (!await consumeTicketingRateLimit(request, `gate:${session.email}`, 120, 60)) {
      return NextResponse.json({ error: 'Scanner rate limit reached. Wait one minute and try again.' }, { status: 429 });
    }
    const { data, error } = await database.rpc('ticketing_check_in', {
      p_event_id: eventId,
      p_credential_hash: createHash('sha256').update(credential).digest('hex'),
      p_gate_name: gateName,
      p_staff_user_id: null,
      p_device_id: deviceId || `gate:${session.email}`,
      p_request_id: requestId,
      p_staff_email: session.email,
      p_platform_admin: false
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'This scanner is not assigned to the selected event and gate.' }, { status: 403 });
      if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 });
      console.error('[TicketingGate] Could not validate assigned staff scan:', error);
      return NextResponse.json({ error: 'Ticket admission could not be checked.' }, { status: 503 });
    }
    return NextResponse.json({ result: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingGate] Could not enforce scan rate limit:', cause);
    return NextResponse.json({ error: 'Ticket admission is unavailable until the verification migration is configured.' }, { status: 503 });
  }
}
