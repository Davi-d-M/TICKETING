import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { completePaystackPayment, sendGuestTicketAccess } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) return NextResponse.json({ error: 'Paystack webhook verification is not configured.' }, { status: 503 });

  const body = await request.text();
  if (body.length > 64_000) return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
  const signature = request.headers.get('x-paystack-signature') || '';
  if (!/^[a-f0-9]{128}$/i.test(signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }
  const expected = createHmac('sha512', secret).update(body).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  let event: {
    event?: unknown;
    data?: { reference?: unknown };
  };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook JSON.' }, { status: 400 });
  }
  if (event.event !== 'charge.success') {
    return NextResponse.json({ received: true });
  }
  const reference = typeof event.data?.reference === 'string' ? event.data.reference : '';
  if (!/^OBT_[A-Za-z0-9_-]{20,100}$/.test(reference)) {
    return NextResponse.json({ error: 'Invalid ticket payment reference.' }, { status: 400 });
  }

  try {
    const result = await completePaystackPayment(reference, `charge.success:${reference}`);
    if (result.status === 'reconciliation_required') {
      console.error('[TicketingWebhook] Verified payment requires reconciliation:', reference);
      return NextResponse.json({ received: true, status: result.status });
    }
    if (result.orderReference && result.email) {
      try {
        await sendGuestTicketAccess(result.orderReference, result.email);
      } catch (cause) {
        console.error('[TicketingWebhook] Payment succeeded but guest access email failed:', cause);
      }
    }
    return NextResponse.json({ received: true, status: result.status });
  } catch (cause) {
    console.error('[TicketingWebhook] Could not process verified payment:', cause);
    return NextResponse.json({ error: 'The ticket payment could not be processed.' }, { status: 500 });
  }
}
