import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const rotationSeconds = 5 * 60;

function signingSecret() {
  const secret = process.env.TICKETING_QR_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('TICKETING_QR_SIGNING_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function signature(payload: string) {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

export function createRotatingTicketCredential(ticketId: string, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    ticketId,
    notBefore: issuedAt,
    expiresAt: issuedAt + rotationSeconds
  })).toString('base64url');
  return {
    credential: `${payload}.${signature(payload)}`,
    expiresAt: (issuedAt + rotationSeconds) * 1000
  };
}

export function readRotatingTicketCredential(token: string, now = Date.now()) {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      version?: unknown;
      ticketId?: unknown;
      notBefore?: unknown;
      expiresAt?: unknown;
    };
    const nowSeconds = Math.floor(now / 1000);
    if (decoded.version !== 1
      || typeof decoded.ticketId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.ticketId)
      || typeof decoded.notBefore !== 'number'
      || typeof decoded.expiresAt !== 'number'
      || decoded.expiresAt - decoded.notBefore !== rotationSeconds
      || decoded.notBefore > nowSeconds
      || decoded.expiresAt <= nowSeconds) return null;
    return { ticketId: decoded.ticketId };
  } catch {
    return null;
  }
}
