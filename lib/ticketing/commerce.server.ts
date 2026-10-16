import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

type PaystackTransaction = {
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  customer?: { email?: string };
};

type PaystackResult<T> = {
  status?: boolean;
  message?: string;
  data?: T;
};

type PaymentAttemptRow = {
  id: string;
  order_id: string;
  amount_minor: number | string;
  currency: string;
};

type TicketOrderRow = {
  id: string;
  reference: string;
  buyer_email: string;
  buyer_name: string;
  total_minor: number | string;
  currency: string;
  status: string;
};

function paystackSecret() {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || '';
}

function ticketSecret() {
  const secret = process.env.TICKETING_TICKET_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error('Ticket credential encryption is not configured.');
  return createHash('sha256').update(secret).digest();
}

function guestSecret() {
  const secret = process.env.TICKETING_GUEST_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('Guest ticket access is not configured.');
  return secret;
}

export async function isTicketingSalesReady() {
  const secret = paystackSecret();
  const mode = process.env.TICKETING_PAYMENT_MODE?.trim();
  const expectedKeyPrefix = mode === 'test' ? 'sk_test_' : mode === 'live' ? 'sk_live_' : '';
  const publicUrl = process.env.TICKETING_PUBLIC_URL?.trim();
  const emailFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const validPublicUrl = (() => {
    if (!publicUrl) return false;
    try {
      const url = new URL(publicUrl);
      return url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost');
    } catch {
      return false;
    }
  })();

  const configurationReady = process.env.TICKETING_SALES_ENABLED === 'true'
    && process.env.TICKETING_RELEASE_APPROVED === 'true'
    && Boolean(expectedKeyPrefix && secret.startsWith(expectedKeyPrefix))
    && Boolean(process.env.RESEND_API_KEY?.trim())
    && Boolean(emailFrom && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom))
    && validPublicUrl
    && Boolean((process.env.TICKETING_GUEST_SESSION_SECRET?.trim().length || 0) >= 32)
    && Boolean((process.env.TICKETING_GATE_SESSION_SECRET?.trim().length || 0) >= 32)
    && Boolean((process.env.TICKETING_TICKET_ENCRYPTION_KEY?.trim().length || 0) >= 32)
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim())
    && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!configurationReady) return false;

  const database = createServerSupabaseClient();
  if (!database) return false;
  const migrationChecks = await Promise.all([
    database.from('ticketing_payment_attempts').select('checkout_url').limit(0),
    database.from('ticketing_tickets').select('credential_ciphertext').limit(0),
    database.from('ticketing_guest_access_links').select('id').limit(0),
    database.from('ticketing_gate_staff_assignments').select('event_id').limit(0)
  ]);
  const migrationError = migrationChecks.find(check => check.error)?.error;
  if (migrationError) {
    console.error('[TicketingCommerce] Commerce migration readiness check failed:', migrationError);
    return false;
  }
  return true;
}

export function hashTicketCredential(credential: string) {
  return createHash('sha256').update(credential).digest('hex');
}

export function encryptTicketCredential(credential: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ticketSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTicketCredential(value: string) {
  const [ivValue, tagValue, encryptedValue, extra] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue || extra) throw new Error('The stored ticket credential is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', ticketSecret(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export async function initializePaystackTransaction(input: {
  reference: string;
  email: string;
  name: string;
  amountMinor: number;
  orderReference: string;
}) {
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${paystackSecret()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountMinor,
      currency: 'KES',
      reference: input.reference,
      callback_url: `${process.env.TICKETING_PUBLIC_URL!.replace(/\/$/, '')}/tickets/complete`,
      metadata: {
        order_reference: input.orderReference,
        buyer_name: input.name
      }
    }),
    cache: 'no-store'
  });
  const result = await response.json() as PaystackResult<{
    authorization_url?: string;
    reference?: string;
    access_code?: string;
  }>;
  if (!response.ok || result.status !== true
    || !result.data?.authorization_url
    || result.data.reference !== input.reference) {
    throw new Error('Paystack could not initialize this checkout.');
  }
  return result.data.authorization_url;
}

export async function verifyPaystackTransaction(reference: string) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${paystackSecret()}` },
      cache: 'no-store'
    }
  );
  const result = await response.json() as PaystackResult<PaystackTransaction>;
  if (!response.ok || result.status !== true || result.data?.status !== 'success') {
    throw new Error('Paystack has not confirmed a successful transaction.');
  }
  if (result.data.reference !== reference
    || result.data.currency !== 'KES'
    || !Number.isSafeInteger(result.data.amount)
    || typeof result.data.customer?.email !== 'string') {
    throw new Error('Paystack returned incomplete or invalid transaction details.');
  }
  return result.data as Required<Pick<PaystackTransaction, 'reference' | 'amount' | 'currency'>> & {
    status: string;
    customer: { email: string };
  };
}

export async function completePaystackPayment(reference: string, providerEventId: string) {
  const database = createServerSupabaseClient();
  if (!database) throw new Error('Ticketing database access is not configured.');

  const transaction = await verifyPaystackTransaction(reference);
  const { data: attempt, error: attemptError } = await database
    .from('ticketing_payment_attempts')
    .select('id,order_id,amount_minor,currency,status')
    .eq('provider', 'paystack')
    .eq('provider_reference', reference)
    .maybeSingle();
  if (attemptError) throw attemptError;
  if (!attempt) throw new Error('No ticket order matches this Paystack reference.');
  const paymentAttempt = attempt as unknown as PaymentAttemptRow;

  const { data: order, error: orderError } = await database
    .from('ticketing_orders')
    .select('id,reference,buyer_email,buyer_name,total_minor,currency,status')
    .eq('id', paymentAttempt.order_id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new Error('The ticket order for this payment could not be found.');
  const ticketOrder = order as unknown as TicketOrderRow;

  if (transaction.amount !== Number(paymentAttempt.amount_minor)
    || transaction.amount !== Number(ticketOrder.total_minor)
    || transaction.currency !== paymentAttempt.currency.trim()
    || transaction.currency !== ticketOrder.currency.trim()
    || transaction.customer.email.trim().toLowerCase() !== ticketOrder.buyer_email.trim().toLowerCase()) {
    const [{ error: orderMismatchError }, { error: attemptMismatchError }] = await Promise.all([
      database.from('ticketing_orders')
        .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
        .eq('id', ticketOrder.id)
        .neq('status', 'paid'),
      database.from('ticketing_payment_attempts')
        .update({ status: 'reconciliation_required', updated_at: new Date().toISOString() })
        .eq('id', paymentAttempt.id)
        .neq('status', 'succeeded')
    ]);
    if (orderMismatchError) throw orderMismatchError;
    if (attemptMismatchError) throw attemptMismatchError;
    throw new Error('The verified payment does not match the saved ticket order. It has been flagged for reconciliation.');
  }

  if (ticketOrder.status === 'paid') {
    return { status: 'already_paid' as const, orderReference: ticketOrder.reference, email: ticketOrder.buyer_email };
  }

  const { data: orderItems, error: itemsError } = await database
    .from('ticketing_order_items')
    .select('quantity')
    .eq('order_id', ticketOrder.id);
  if (itemsError) throw itemsError;
  const ticketCount = (orderItems || []).reduce((total, item) => total + Number(item.quantity), 0);
  if (!Number.isSafeInteger(ticketCount) || ticketCount < 1 || ticketCount > 20) {
    throw new Error('The ticket order quantity is invalid.');
  }

  const credentials = Array.from({ length: ticketCount }, () => {
    const credential = randomBytes(32).toString('base64url');
    return {
      credential_hash: hashTicketCredential(credential),
      credential_ciphertext: encryptTicketCredential(credential)
    };
  });
  const { data: confirmation, error: confirmationError } = await database.rpc('ticketing_confirm_paystack', {
    p_provider_reference: reference,
    p_provider_event_id: providerEventId,
    p_verified_amount_minor: transaction.amount,
    p_verified_currency: transaction.currency,
    p_credentials: credentials
  });
  if (confirmationError) throw confirmationError;

  return {
    status: (confirmation as { status?: string } | null)?.status || 'unknown',
    orderReference: ticketOrder.reference,
    email: ticketOrder.buyer_email
  };
}

function signGuestSession(payload: string) {
  return createHmac('sha256', guestSecret()).update(payload).digest('base64url');
}

export function createGuestSession(orderId: string, email: string, now = Date.now(), ticketId?: string) {
  const payload = Buffer.from(JSON.stringify({
    orderId,
    email: email.trim().toLowerCase(),
    expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
    ticketId
  })).toString('base64url');
  return `${payload}.${signGuestSession(payload)}`;
}

export function readGuestSession(value: string | undefined) {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(signGuestSession(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      orderId?: unknown;
      email?: unknown;
      expiresAt?: unknown;
      ticketId?: unknown;
    };
    if (typeof decoded.orderId !== 'string'
      || typeof decoded.email !== 'string'
      || typeof decoded.expiresAt !== 'number'
      || (decoded.ticketId !== undefined && typeof decoded.ticketId !== 'string')
      || decoded.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return {
      orderId: decoded.orderId,
      email: decoded.email,
      ticketId: typeof decoded.ticketId === 'string' ? decoded.ticketId : undefined
    };
  } catch {
    return null;
  }
}

export async function sendGuestTicketAccess(orderReference: string, email: string) {
  const database = createServerSupabaseClient();
  if (!database) throw new Error('Ticketing database access is not configured.');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await database.rpc('ticketing_create_guest_access_link', {
    p_order_reference: orderReference,
    p_email: email.trim().toLowerCase(),
    p_token_hash: tokenHash
  });
  if (error) throw error;
  const result = data as { created?: boolean; rate_limited?: boolean } | null;
  if (!result?.created) {
    if (result?.rate_limited) throw new Error('Too many ticket access emails were requested. Please try again later.');
    throw new Error('No paid ticket order matches those details.');
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!from || !apiKey) throw new Error('Guest ticket email delivery is not configured.');

  const claimUrl = `${process.env.TICKETING_PUBLIC_URL!.replace(/\/$/, '')}/tickets/claim?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Midnight Society KE Tickets <${from}>`,
      to: [email.trim().toLowerCase()],
      subject: 'Your Midnight Society KE ticket access link',
      text: `Your payment has been verified. Open this one-time link within 30 minutes to access your tickets: ${claimUrl}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#211326"><h1>Your tickets are ready</h1><p>Payment has been verified. Use the secure, one-time link below within 30 minutes to open your ticket wallet.</p><p><a href="${claimUrl}" style="display:inline-block;background:#fbbf24;color:#211326;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Open ticket wallet</a></p><p>If you did not make this purchase, you can ignore this email.</p></div>`
    }),
    cache: 'no-store'
  });
  if (!response.ok) {
    console.error('[TicketingEmail] Guest ticket access delivery returned HTTP', response.status);
    throw new Error('The payment was verified, but ticket access email could not be delivered. Request a new access link.');
  }
}

export async function sendTransferredTicketAccess(ticketReference: string, email: string) {
  const database = createServerSupabaseClient();
  if (!database) throw new Error('Ticketing database access is not configured.');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await database.rpc('ticketing_create_transfer_access_link', {
    p_ticket_reference: ticketReference,
    p_email: email.trim().toLowerCase(),
    p_token_hash: tokenHash
  });
  if (error) throw error;
  const result = data as { created?: boolean; rate_limited?: boolean } | null;
  if (!result?.created) {
    if (result?.rate_limited) throw new Error('Too many ticket access emails were requested. Please try again later.');
    throw new Error('No approved transferred ticket matches those details.');
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!from || !apiKey) throw new Error('Guest ticket email delivery is not configured.');
  const claimUrl = `${process.env.TICKETING_PUBLIC_URL!.replace(/\/$/, '')}/tickets/claim?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Midnight Society KE Tickets <${from}>`,
      to: [email.trim().toLowerCase()],
      subject: 'Your transferred Midnight Society KE ticket',
      text: `The ticket transfer has been approved. Ticket reference: ${ticketReference}. Open this one-time link within 30 minutes to access your ticket: ${claimUrl}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#211326"><h1>Your ticket transfer is approved</h1><p>Ticket reference: <strong>${ticketReference}</strong></p><p>Use this secure, one-time link within 30 minutes to open your transferred ticket.</p><p><a href="${claimUrl}" style="display:inline-block;background:#fbbf24;color:#211326;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Open transferred ticket</a></p></div>`
    }),
    cache: 'no-store'
  });
  if (!response.ok) {
    console.error('[TicketingEmail] Transferred ticket access delivery returned HTTP', response.status);
    throw new Error('The transfer is approved, but ticket access email could not be delivered. Request a new access link.');
  }
}
