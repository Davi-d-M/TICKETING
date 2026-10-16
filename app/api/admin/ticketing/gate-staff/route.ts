import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { hashGatePassword } from '@/lib/ticketing/gateAccess.server';

export const dynamic = 'force-dynamic';

async function ownerSession() {
  const session = await getAdminSession();
  if (!session) return { session: null, status: 401 };
  if (session.role.toLowerCase() !== 'owner') return { session: null, status: 403 };
  return { session, status: 200 };
}

export async function GET() {
  const { session, status } = await ownerSession();
  if (!session) return NextResponse.json({ error: 'Only the platform owner can manage gate staff.' }, { status });
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  const [accounts, assignments, events] = await Promise.all([
    database.from('ticketing_gate_staff_accounts').select('email,active,created_at,last_login_at').order('email').limit(200),
    database.from('ticketing_gate_staff_assignments').select('event_id,email,gate_name,active,updated_at').order('updated_at', { ascending: false }).limit(500),
    database.from('ticketing_events').select('id,title,status').order('starts_at').limit(100)
  ]);
  const error = accounts.error || assignments.error || events.error;
  if (error) {
    console.error('[TicketingGateStaff] Could not load staff records:', error);
    return NextResponse.json({ error: 'Gate staff records could not be loaded.' }, { status: 503 });
  }
  return NextResponse.json({
    accounts: accounts.data || [],
    assignments: assignments.data || [],
    events: events.data || []
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Same-origin staff management is required.' }, { status: 403 });
  const { session, status } = await ownerSession();
  if (!session) return NextResponse.json({ error: 'Only the platform owner can manage gate staff.' }, { status });
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  let body: { action?: unknown; email?: unknown; password?: unknown; eventId?: unknown; gateName?: unknown; active?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid gate staff request is required.' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return NextResponse.json({ error: 'Enter a valid staff email address.' }, { status: 400 });
  }

  if (action === 'save_account') {
    const password = typeof body.password === 'string' ? body.password : '';
    const active = body.active !== false;
    if (active && (password.length < 14 || password.length > 128)) {
      return NextResponse.json({ error: 'Set a unique staff password of at least 14 characters.' }, { status: 400 });
    }
    const accountPassword = active ? password : randomUUID() + randomUUID();
    const { salt, hash } = hashGatePassword(accountPassword);
    const { data, error } = await database.rpc('ticketing_set_gate_staff_account', {
      p_email: email,
      p_password_salt: salt,
      p_password_hash: hash,
      p_active: active,
      p_actor_email: session.email
    });
    if (error) {
      console.error('[TicketingGateStaff] Could not save staff account:', error);
      return NextResponse.json({ error: 'Gate staff account could not be saved.' }, { status: 503 });
    }
    return NextResponse.json({ account: data });
  }

  if (action === 'set_assignment') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const gateName = typeof body.gateName === 'string' ? body.gateName.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || gateName.length < 1 || gateName.length > 120 || typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'Choose a valid event, gate name and assignment status.' }, { status: 400 });
    }
    const { data, error } = await database.rpc('ticketing_set_gate_staff_assignment', {
      p_event_id: eventId,
      p_email: email,
      p_gate_name: gateName,
      p_active: body.active,
      p_actor_email: session.email
    });
    if (error) {
      if (error.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 409 });
      if (error.code === 'P0002') return NextResponse.json({ error: 'The selected event was not found.' }, { status: 404 });
      console.error('[TicketingGateStaff] Could not update event assignment:', error);
      return NextResponse.json({ error: 'Gate event assignment could not be saved.' }, { status: 503 });
    }
    return NextResponse.json({ assignment: data });
  }

  return NextResponse.json({ error: 'Choose a supported gate staff action.' }, { status: 400 });
}
