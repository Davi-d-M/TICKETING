import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { createGuestSession } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

const guestCookieName = process.env.NODE_ENV === 'production' ? '__Host-ticketing-guest' : 'ticketing-guest';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin ticket access is required.' }, { status: 403 });
  }
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  let body: { token?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid ticket access link is required.' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return NextResponse.json({ error: 'This ticket access link is invalid or expired.' }, { status: 400 });
  }

  const { data, error } = await database.rpc('ticketing_claim_guest_access_link', {
    p_token_hash: createHash('sha256').update(token).digest('hex')
  });
  if (error) {
    console.error('[TicketingWallet] Could not validate guest access link:', error);
    return NextResponse.json({ error: 'Ticket access could not be verified.' }, { status: 503 });
  }
  const claim = data as { order_id?: string; buyer_email?: string } | null;
  if (!claim?.order_id || !claim.buyer_email) {
    return NextResponse.json({ error: 'This ticket access link is invalid, expired or already used.' }, { status: 410 });
  }

  let session: string;
  try {
    session = createGuestSession(claim.order_id, claim.buyer_email);
  } catch (cause) {
    console.error('[TicketingWallet] Guest session signing is not configured:', cause);
    return NextResponse.json({ error: 'Guest ticket access is not configured.' }, { status: 503 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(guestCookieName, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60
  });
  return response;
}
