import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { readGuestSession } from '@/lib/ticketing/commerce.server';
import { gateCookieName } from '@/lib/ticketing/gateAccess.server';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

const guestCookieName = process.env.NODE_ENV === 'production' ? '__Host-ticketing-guest' : 'ticketing-guest';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Same-origin transfer requests are required.' }, { status: 403 });
  const gateCookie = (await cookies()).get(gateCookieName)?.value;
  if (gateCookie) return NextResponse.json({ error: 'Gate staff cannot request customer ticket transfers.' }, { status: 403 });
  let session;
  try {
    session = readGuestSession((await cookies()).get(guestCookieName)?.value);
  } catch (cause) {
    console.error('[TicketingTransfer] Guest wallet session is invalid:', cause);
    return NextResponse.json({ error: 'Ticket wallet access is unavailable.' }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: 'Open your secure ticket wallet before requesting a transfer.' }, { status: 401 });

  let body: { ticketId?: unknown; recipientEmail?: unknown; recipientName?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Enter the recipient details.' }, { status: 400 });
  }
  const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '';
  const recipientEmail = typeof body.recipientEmail === 'string' ? body.recipientEmail.trim().toLowerCase() : '';
  const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
  if (!uuidPattern.test(ticketId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)
    || recipientEmail.length > 320 || recipientName.length > 160) {
    return NextResponse.json({ error: 'Enter a valid recipient name and email address.' }, { status: 400 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  try {
    if (!await consumeTicketingRateLimit(request, `ticket-transfer:${session.email}`, 5, 3600)) {
      return NextResponse.json({ error: 'Too many transfer requests. Contact event support.' }, { status: 429 });
    }
    const { error } = await database.rpc('ticketing_request_ticket_transfer', {
      p_ticket_id: ticketId,
      p_order_id: session.orderId,
      p_from_email: session.email,
      p_to_email: recipientEmail,
      p_to_name: recipientName
    });
    if (error) {
      if (error.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 409 });
      if (error.code === 'P0002') return NextResponse.json({ error: 'A paid ticket in this wallet could not be found.' }, { status: 404 });
      console.error('[TicketingTransfer] Could not create transfer request:', error);
      return NextResponse.json({ error: 'Ticket transfer request could not be created.' }, { status: 503 });
    }
    return NextResponse.json({
      success: true,
      message: 'Transfer request sent for owner approval. Your current ticket remains active until the owner approves it.'
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingTransfer] Could not enforce transfer rate limit:', cause);
    return NextResponse.json({ error: 'Ticket transfers are unavailable until the verification migration is configured.' }, { status: 503 });
  }
}
