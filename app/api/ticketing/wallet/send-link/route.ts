import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { sendGuestTicketAccess, sendTransferredTicketAccess } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin ticket access requests are required.' }, { status: 403 });
  }
  let body: { orderReference?: unknown; ticketReference?: unknown; email?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Enter your order reference and purchase email.' }, { status: 400 });
  }

  const orderReference = typeof body.orderReference === 'string' ? body.orderReference.trim() : '';
  const ticketReference = typeof body.ticketReference === 'string' ? body.ticketReference.trim().toUpperCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const isTransferLink = /^OBT-[A-Z0-9]{8,24}$/.test(ticketReference);
  if ((!isTransferLink && !/^OBT-[A-Z0-9]{8,20}$/.test(orderReference))
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid order reference and email address.' }, { status: 400 });
  }

  try {
    if (isTransferLink) await sendTransferredTicketAccess(ticketReference, email);
    else await sendGuestTicketAccess(orderReference, email);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('Too many ticket access emails')) {
      return NextResponse.json({ error: cause.message }, { status: 429 });
    }
    if (cause instanceof Error && cause.message.includes('email delivery is not configured')) {
      console.error('[TicketingWallet] Guest access email is not configured:', cause);
      return NextResponse.json({ error: 'Ticket email delivery is not configured yet.' }, { status: 503 });
    }
    if (cause instanceof Error && cause.message.includes('could not be delivered')) {
      console.error('[TicketingWallet] Guest access email delivery failed:', cause);
      return NextResponse.json({ error: cause.message }, { status: 503 });
    }
    if (cause instanceof Error && (cause.message.includes('No paid ticket order matches')
      || cause.message.includes('No approved transferred ticket matches'))) {
      return NextResponse.json({
        success: true,
        message: 'If a paid ticket order matches those details, a secure access link will arrive by email.'
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('[TicketingWallet] Could not send guest access link:', cause);
    return NextResponse.json({ error: 'Ticket access email could not be requested.' }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    message: 'If a paid ticket order matches those details, a secure access link will arrive by email.'
  }, { headers: { 'Cache-Control': 'no-store' } });
}
