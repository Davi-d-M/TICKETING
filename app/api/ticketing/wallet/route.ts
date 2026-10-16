import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { decryptTicketCredential, readGuestSession } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

const guestCookieName = process.env.NODE_ENV === 'production' ? '__Host-ticketing-guest' : 'ticketing-guest';

export async function GET() {
  const cookie = (await cookies()).get(guestCookieName)?.value;
  let session: ReturnType<typeof readGuestSession>;
  try {
    session = readGuestSession(cookie);
  } catch (cause) {
    console.error('[TicketingWallet] Guest session validation is not configured:', cause);
    return NextResponse.json({ error: 'Guest ticket access is not configured.' }, { status: 503 });
  }

  if (!session) return NextResponse.json({ error: 'Open your secure ticket access link to sign in.' }, { status: 401 });

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  const { data: order, error: orderError } = await database
    .from('ticketing_orders')
    .select('id,reference,buyer_email,buyer_name,total_minor,currency,paid_at,event_id,status')
    .eq('id', session.orderId)
    .eq('buyer_email', session.email)
    .eq('status', 'paid')
    .maybeSingle();
  if (orderError) {
    console.error('[TicketingWallet] Could not load guest order:', orderError);
    return NextResponse.json({ error: 'Ticket wallet could not be loaded.' }, { status: 503 });
  }
  if (!order) return NextResponse.json({ error: 'No paid ticket order is available for this wallet.' }, { status: 404 });

  const { data: event, error: eventError } = await database
    .from('ticketing_events')
    .select('title,starts_at,ends_at,venue_name,venue_address,city,timezone,age_limit')
    .eq('id', order.event_id)
    .maybeSingle();
  if (eventError || !event) {
    console.error('[TicketingWallet] Could not load ticket event:', eventError);
    return NextResponse.json({ error: 'Ticket event details could not be loaded.' }, { status: 503 });
  }

  const { data: items, error: itemsError } = await database
    .from('ticketing_order_items')
    .select('id,ticket_name_snapshot')
    .eq('order_id', order.id);
  if (itemsError) {
    console.error('[TicketingWallet] Could not load order items:', itemsError);
    return NextResponse.json({ error: 'Ticket details could not be loaded.' }, { status: 503 });
  }

  const itemIds = (items || []).map(item => item.id);
  const ticketsResult = itemIds.length
    ? await database.from('ticketing_tickets')
      .select('id,order_item_id,ticket_reference,status,issued_at,checked_in_at,credential_ciphertext')
      .in('order_item_id', itemIds)
      .order('issued_at', { ascending: true })
    : { data: [], error: null };
  if (ticketsResult.error) {
    console.error('[TicketingWallet] Could not load issued tickets:', ticketsResult.error);
    return NextResponse.json({ error: 'Issued tickets could not be loaded.' }, { status: 503 });
  }

  try {
    const itemsById = new Map<string, string>();
    for (const item of items || []) {
      if (typeof item.id !== 'string' || typeof item.ticket_name_snapshot !== 'string') {
        throw new Error('A ticket order item is incomplete.');
      }
      itemsById.set(item.id, item.ticket_name_snapshot);
    }
    const tickets = (ticketsResult.data || []).map(ticket => {
      if (typeof ticket.credential_ciphertext !== 'string' || !ticket.credential_ciphertext
        || typeof ticket.ticket_reference !== 'string'
        || typeof ticket.status !== 'string'
        || typeof ticket.issued_at !== 'string'
        || typeof ticket.order_item_id !== 'string') {
        throw new Error('An issued ticket record is incomplete.');
      }
      return {
        id: ticket.id,
        reference: ticket.ticket_reference,
        tier: itemsById.get(ticket.order_item_id) || 'Event admission',
        status: ticket.status,
        issuedAt: ticket.issued_at,
        checkedInAt: ticket.checked_in_at,
        credential: decryptTicketCredential(ticket.credential_ciphertext)
      };
    });
    return NextResponse.json({
      order: {
        reference: order.reference,
        buyerName: order.buyer_name,
        amountMinor: order.total_minor,
        currency: order.currency,
        paidAt: order.paid_at
      },
      event,
      tickets
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (cause) {
    console.error('[TicketingWallet] Could not decrypt issued ticket credentials:', cause);
    return NextResponse.json({ error: 'Ticket credentials could not be opened. Contact event support.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin ticket wallet requests are required.' }, { status: 403 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(guestCookieName, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
  return response;
}
