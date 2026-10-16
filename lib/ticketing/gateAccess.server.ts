import 'server-only';

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const gateCookieName = process.env.NODE_ENV === 'production'
  ? '__Host-ticketing-gate'
  : 'ticketing-gate';

const gateSessionSeconds = 4 * 60 * 60;

function gateSessionSecret() {
  const secret = process.env.TICKETING_GATE_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('Gate staff sessions are not configured.');
  return secret;
}

function signature(payload: string) {
  return createHmac('sha256', gateSessionSecret()).update(payload).digest('base64url');
}

export function hashGatePassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyGatePassword(password: string, salt: string, hash: string) {
  const calculated = Buffer.from(scryptSync(password, salt, 64).toString('hex'), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return calculated.length === expected.length && timingSafeEqual(calculated, expected);
}

export function createGateStaffSession(email: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    email: email.trim().toLowerCase(),
    expiresAt: Math.floor(now / 1000) + gateSessionSeconds
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readGateStaffSession(value: string | undefined) {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    if (typeof decoded.email !== 'string'
      || typeof decoded.expiresAt !== 'number'
      || decoded.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export const gateStaffSessionSeconds = gateSessionSeconds;
