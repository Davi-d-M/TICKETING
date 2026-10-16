import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Use the official ticket verification page.' }, { status: 403 });
  }
  let body: { reference?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Enter a ticket reference.' }, { status: 400 });
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : '';
  if (!/^OBT-[A-Z0-9]{8,24}$/.test(reference)) {
    return NextResponse.json({ error: 'Enter a valid ticket reference.' }, { status: 400 });
  }
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Official ticket verification is temporarily unavailable.' }, { status: 503 });

  try {
    if (!await consumeTicketingRateLimit(request, 'public-verification', 20, 60)) {
      return NextResponse.json({ error: 'Too many verification attempts. Wait one minute and try again.' }, { status: 429 });
    }
    const { data, error } = await database.rpc('ticketing_public_verification', {
      p_ticket_reference: reference
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ verified: false }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ verification: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingVerification] Could not verify a ticket reference:', cause);
    return NextResponse.json({ error: 'Official ticket verification is temporarily unavailable.' }, { status: 503 });
  }
}
