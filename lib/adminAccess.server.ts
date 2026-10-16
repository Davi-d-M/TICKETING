import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const cookieName = '__Host-ticketing-admin';
const sessionLifetimeSeconds = 4 * 60 * 60;

export type TicketingAdminSession = {
  email: string;
  role: 'owner' | 'admin';
  mfaVerified: true;
};

export type TicketingMfaChallenge = {
  email: string;
  role: 'owner' | 'admin';
  expiresAt: number;
};

function sessionSecret() {
  const secret = process.env.TICKETING_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAdminSessionToken(session: TicketingAdminSession, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new Error('TICKETING_SESSION_SECRET must be configured with at least 32 characters.');
  const payload = Buffer.from(JSON.stringify({
    email: session.email,
    role: session.role,
    mfaVerified: session.mfaVerified,
    expiresAt: Math.floor(now / 1000) + sessionLifetimeSeconds
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function createAdminMfaChallengeToken(
  challenge: Omit<TicketingMfaChallenge, 'expiresAt'>,
  now = Date.now()
) {
  const secret = sessionSecret();
  if (!secret) throw new Error('TICKETING_SESSION_SECRET must be configured with at least 32 characters.');
  const payload = Buffer.from(JSON.stringify({
    ...challenge,
    expiresAt: Math.floor(now / 1000) + 5 * 60
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readAdminMfaChallenge(token: string | undefined, now = Date.now()): TicketingMfaChallenge | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TicketingMfaChallenge>;
    if (typeof decoded.email !== 'string'
      || !['owner', 'admin'].includes(String(decoded.role))
      || typeof decoded.expiresAt !== 'number'
      || decoded.expiresAt <= Math.floor(now / 1000)) return null;
    return {
      email: decoded.email,
      role: decoded.role as TicketingMfaChallenge['role'],
      expiresAt: decoded.expiresAt
    };
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<TicketingAdminSession | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  if (!safeEqual(signature, sign(payload, secret))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
      role?: unknown;
      mfaVerified?: unknown;
      expiresAt?: unknown;
    };
    if (typeof decoded.email !== 'string'
      || !['owner', 'admin'].includes(String(decoded.role))
      || decoded.mfaVerified !== true
      || typeof decoded.expiresAt !== 'number'
      || decoded.expiresAt <= Math.floor(Date.now() / 1000)) return null;

    return { email: decoded.email, role: decoded.role as TicketingAdminSession['role'], mfaVerified: true };
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const adminSessionCookie = cookieName;
export const adminSessionLifetimeSeconds = sessionLifetimeSeconds;
export const adminMfaChallengeCookie = process.env.NODE_ENV === 'production'
  ? '__Host-ticketing-mfa'
  : 'ticketing-mfa';
