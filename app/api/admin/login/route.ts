import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  adminSessionCookie,
  adminSessionLifetimeSeconds,
  createAdminSessionToken,
  isSameOriginRequest,
  type TicketingAdminSession
} from '@/lib/adminAccess.server';

export const dynamic = 'force-dynamic';

function constantTimeEqual(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  }

  const adminEmail = process.env.TICKETING_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.TICKETING_ADMIN_PASSWORD;
  const secret = process.env.TICKETING_SESSION_SECRET;
  if (!adminEmail || !adminPassword || !secret || secret.length < 32) {
    return NextResponse.json({
      error: 'Ticketing admin sign-in is not configured. Set TICKETING_ADMIN_EMAIL, TICKETING_ADMIN_PASSWORD and a 32-character TICKETING_SESSION_SECRET in the Vercel project environment.'
    }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json() as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
  }
  if (typeof body.email !== 'string' || typeof body.password !== 'string'
    || body.email.length > 320 || body.password.length > 1024) {
    return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
  }

  const emailMatches = constantTimeEqual(body.email.trim().toLowerCase(), adminEmail);
  const passwordMatches = constantTimeEqual(body.password, adminPassword);
  if (!emailMatches || !passwordMatches) {
    return NextResponse.json({ error: 'The email or password is incorrect.' }, { status: 401 });
  }

  const roleValue = process.env.TICKETING_ADMIN_ROLE?.trim().toLowerCase();
  const role: TicketingAdminSession['role'] = roleValue === 'admin' ? 'admin' : 'owner';
  let token: string;
  try {
    token = createAdminSessionToken({ email: adminEmail, role });
  } catch (error) {
    console.error('[TicketingLogin] Could not create admin session:', error);
    return NextResponse.json({ error: 'Admin session could not be created.' }, { status: 503 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(adminSessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: adminSessionLifetimeSeconds
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  }
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(adminSessionCookie, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
  return response;
}
