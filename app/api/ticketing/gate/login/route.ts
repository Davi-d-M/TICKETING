import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { createGateStaffSession, gateCookieName, gateStaffSessionSeconds, verifyGatePassword } from '@/lib/ticketing/gateAccess.server';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

type StaffAccount = { email: string; password_salt: string; password_hash: string; active: boolean };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Same-origin sign-in is required.' }, { status: 403 });
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Enter your staff email and password.' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 128 || !password) {
    return NextResponse.json({ error: 'Sign-in failed. Check your credentials or contact the event owner.' }, { status: 401 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  try {
    if (!await consumeTicketingRateLimit(request, `gate-login:${email}`, 10, 300)) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again in five minutes.' }, { status: 429 });
    }
    const { data, error } = await database.from('ticketing_gate_staff_accounts')
      .select('email,password_salt,password_hash,active')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    const account = data as unknown as StaffAccount | null;
    const salt = account?.password_salt || randomBytes(16).toString('base64url');
    const hash = account?.password_hash || '0'.repeat(128);
    const valid = verifyGatePassword(password, salt, hash);
    if (!account?.active || !valid) {
      return NextResponse.json({ error: 'Sign-in failed. Check your credentials or contact the event owner.' }, { status: 401 });
    }
    const { error: updateError } = await database.from('ticketing_gate_staff_accounts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('email', email)
      .eq('active', true);
    if (updateError) throw updateError;
    const token = createGateStaffSession(email);
    const response = NextResponse.json({ success: true });
    response.cookies.set(gateCookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: gateStaffSessionSeconds
    });
    return response;
  } catch (cause) {
    console.error('[TicketingGateAuth] Staff sign-in failed:', cause);
    return NextResponse.json({ error: 'Gate staff sign-in is unavailable.' }, { status: 503 });
  }
}
