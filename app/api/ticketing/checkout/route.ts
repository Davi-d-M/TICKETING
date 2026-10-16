import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { initializePaystackTransaction, isTicketingSalesReady } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin checkout requests are required.' }, { status: 403 });
  }
  if (!await isTicketingSalesReady()) {
    return NextResponse.json({ error: 'Ticket sales are not enabled. Checkout and guest email delivery must be configured first.' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid ticket checkout request is required.' }, { status: 400 });
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const ticketTypeId = typeof body.ticketTypeId === 'string' ? body.ticketTypeId : '';
  const quantity = Number(body.quantity);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  if (!uuidPattern.test(eventId) || !uuidPattern.test(ticketTypeId)
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20
    || name.length < 1 || name.length > 160
    || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !uuidPattern.test(idempotencyKey)) {
    return NextResponse.json({ error: 'Enter a valid name, email, ticket quantity and ticket option.' }, { status: 400 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const paymentReference = `OBT_${randomUUID()}`;
  const { data, error } = await database.rpc('ticketing_start_checkout', {
    p_event_id: eventId,
    p_ticket_type_id: ticketTypeId,
    p_quantity: quantity,
    p_buyer_email: email,
    p_buyer_name: name,
    p_idempotency_key: idempotencyKey,
    p_paystack_reference: paymentReference
  });
  if (error || !data) {
    if (error?.code === 'P0001') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error?.code === 'P0002') {
      return NextResponse.json({ error: 'This ticket option is no longer available.' }, { status: 409 });
    }
    if (error?.code === '22023') {
      return NextResponse.json({ error: 'The checkout details are invalid.' }, { status: 400 });
    }
    console.error('[TicketingCheckout] Could not create reserved order:', error);
    return NextResponse.json({ error: 'The ticket reservation could not be created.' }, { status: 503 });
  }

  const checkout = data as {
    order_id?: string;
    order_reference?: string;
    payment_reference?: string;
    amount_minor?: number;
    currency?: string;
    buyer_email?: string;
    buyer_name?: string;
    checkout_url?: string | null;
    expires_at?: string;
  };
  if (!checkout.order_id || !checkout.order_reference || !checkout.payment_reference
    || !Number.isSafeInteger(Number(checkout.amount_minor))
    || checkout.currency !== 'KES' || !checkout.buyer_email) {
    console.error('[TicketingCheckout] Reservation RPC returned incomplete order details.');
    return NextResponse.json({ error: 'The ticket order could not be prepared.' }, { status: 503 });
  }

  if (checkout.checkout_url) {
    return NextResponse.json({
      checkoutUrl: checkout.checkout_url,
      expiresAt: checkout.expires_at
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const checkoutUrl = await initializePaystackTransaction({
      reference: checkout.payment_reference,
      email: checkout.buyer_email,
      name,
      amountMinor: Number(checkout.amount_minor),
      orderReference: checkout.order_reference
    });
    const { error: updateError } = await database
      .from('ticketing_payment_attempts')
      .update({ checkout_url: checkoutUrl, status: 'pending', updated_at: new Date().toISOString() })
      .eq('provider', 'paystack')
      .eq('provider_reference', checkout.payment_reference);
    if (updateError) {
      console.error('[TicketingCheckout] Could not save Paystack checkout URL:', updateError);
      return NextResponse.json({ error: 'Checkout was initialized but could not be saved. Contact support before retrying.' }, { status: 503 });
    }
    const { error: orderUpdateError } = await database
      .from('ticketing_orders')
      .update({ status: 'payment_processing', updated_at: new Date().toISOString() })
      .eq('id', checkout.order_id)
      .in('status', ['pending_payment', 'payment_processing']);
    if (orderUpdateError) {
      console.error('[TicketingCheckout] Could not update payment state:', orderUpdateError);
      return NextResponse.json({ error: 'Checkout was initialized but its payment state could not be saved.' }, { status: 503 });
    }
    return NextResponse.json({
      checkoutUrl,
      expiresAt: checkout.expires_at
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingCheckout] Paystack initialization failed:', cause);
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : 'Paystack checkout could not be initialized.'
    }, { status: 503 });
  }
}
