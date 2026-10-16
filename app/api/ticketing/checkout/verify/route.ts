import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { sendGuestTicketAccess, completePaystackPayment } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin payment verification is required.' }, { status: 403 });
  }

  let body: { reference?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid Paystack reference is required.' }, { status: 400 });
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!/^OBT_[A-Za-z0-9_-]{20,100}$/.test(reference)) {
    return NextResponse.json({ error: 'A valid Paystack reference is required.' }, { status: 400 });
  }

  try {
    const result = await completePaystackPayment(reference, `customer_return:${reference}`);
    if (result.status === 'reconciliation_required') {
      return NextResponse.json({ error: 'Payment was received but needs manual reconciliation before tickets can be released.' }, { status: 409 });
    }
    if (!result.orderReference || !result.email) {
      return NextResponse.json({ error: 'The verified order could not be loaded.' }, { status: 503 });
    }
    let emailSent = true;
    try {
      await sendGuestTicketAccess(result.orderReference, result.email);
    } catch (cause) {
      emailSent = false;
      console.error('[TicketingCheckout] Payment verified but guest access email failed:', cause);
    }
    return NextResponse.json({
      success: true,
      email: result.email,
      orderReference: result.orderReference,
      emailSent
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('[TicketingCheckout] Could not verify Paystack return:', cause);
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : 'Payment verification is not complete. Please try again shortly.'
    }, { status: 503 });
  }
}
