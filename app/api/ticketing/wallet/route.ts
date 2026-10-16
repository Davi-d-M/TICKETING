import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { decryptTicketCredential, readGuestSession } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

const guestCookieName = process.env.NODE_ENV === 'production' ? '__Host-ticketing-guest' : 'ticketing-guest';
type TicketOrder = {
  id: string;
  reference: string;
  buyer_email: string;
  buyer_name: string;
  total_minor: number;
  currency: string;
  paid_at: string | null;
  event_id: string;
};

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
  const { data: orderData, error: orderError } = await database
    .from('ticketing_orders')
    .select('id,reference,buyer_email,buyer_name,total_minor,currency,paid_at,event_id,status')
    .eq('id', session.orderId)
    .eq('status', 'paid')
    .maybeSingle();
  if (orderError) {
    console.error('[TicketingWallet] Could not load guest order:', orderError);
    return NextResponse.json({ error: 'Ticket wallet could not be loaded.' }, { status: 503 });
  }
  const order = orderData as unknown as TicketOrder | null;
  if (!order) return NextResponse.json({ error: 'No paid ticket order is available for this wallet.' }, { status: 404 });
  if (!session.ticketId && order.buyer_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'No paid ticket order is available for this wallet.' }, { status: 404 });
  }

  const { data: event, error: eventError } = await database
    .from('ticketing_events')
    .select('title,starts_at,ends_at,venue_name,venue_address,city,timezone,age_limit,cover_image_url,venue_maps_url,venue_latitude,venue_longitude,entrance_instructions,parking_details,transport_guidance,dress_code')
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
  let walletTicketsQuery = database.from('ticketing_tickets')
    .select('id,order_item_id,ticket_reference,status,issued_at,checked_in_at,credential_ciphertext,attendee_name,attendee_email')
    .in('order_item_id', itemIds)
    .eq('attendee_email', session.email.trim().toLowerCase())
    .order('issued_at', { ascending: true });
  if (session.ticketId) walletTicketsQuery = walletTicketsQuery.eq('id', session.ticketId);
  const ticketsResult = itemIds.length ? await walletTicketsQuery : { data: [], error: null };
  if (ticketsResult.error) {
    console.error('[TicketingWallet] Could not load issued tickets:', ticketsResult.error);
    return NextResponse.json({ error: 'Issued tickets could not be loaded.' }, { status: 503 });
  }
  if (session.ticketId && !(ticketsResult.data || []).length) {
    return NextResponse.json({ error: 'This transferred ticket is no longer active in the wallet.' }, { status: 404 });
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
      if (typeof ticket.ticket_reference !== 'string'
        || typeof ticket.status !== 'string'
        || typeof ticket.issued_at !== 'string'
        || typeof ticket.order_item_id !== 'string'
        || typeof ticket.attendee_name !== 'string') {
        throw new Error('An issued ticket record is incomplete.');
      }
      const hasEntryCredential = ticket.status === 'issued' || ticket.status === 'checked_in';
      const encryptedCredential = typeof ticket.credential_ciphertext === 'string'
        ? ticket.credential_ciphertext
        : null;
      if (hasEntryCredential && !encryptedCredential) {
        throw new Error('An active ticket credential is unavailable.');
      }
      return {
        id: ticket.id,
        reference: ticket.ticket_reference,
        tier: itemsById.get(ticket.order_item_id) || 'Event admission',
        status: ticket.status,
        issuedAt: ticket.issued_at,
        checkedInAt: ticket.checked_in_at,
        buyerName: ticket.attendee_name,
        credential: hasEntryCredential && encryptedCredential
          ? decryptTicketCredential(encryptedCredential)
          : null
      };
    });
    return NextResponse.json({
      order: {
        reference: session.ticketId ? tickets[0]?.reference || order.reference : order.reference,
        buyerName: session.ticketId ? tickets[0]?.buyerName || '' : order.buyer_name,
        amountMinor: session.ticketId ? null : order.total_minor,
        currency: session.ticketId ? null : order.currency,
        paidAt: order.paid_at,
        isTransferredTicket: Boolean(session.ticketId)
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
