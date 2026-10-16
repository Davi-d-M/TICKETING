import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  adminMfaChallengeCookie,
  adminSessionCookie,
  createAdminMfaChallengeToken,
  isSameOriginRequest,
  type TicketingAdminSession
} from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

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
  try {
    if (!await consumeTicketingRateLimit(request, 'admin-login', 10, 300)) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Wait five minutes before trying again.' }, { status: 429 });
    }
  } catch (cause) {
    console.error('[TicketingLogin] Could not enforce sign-in rate limit:', cause);
    return NextResponse.json({ error: 'Sign-in protection is unavailable. Configure the Ticketing rate-limit migration and guest-session key.' }, { status: 503 });
  }

  const emailMatches = constantTimeEqual(body.email.trim().toLowerCase(), adminEmail);
  const passwordMatches = constantTimeEqual(body.password, adminPassword);
  if (!emailMatches || !passwordMatches) {
    return NextResponse.json({ error: 'The email or password is incorrect.' }, { status: 401 });
  }

  const roleValue = process.env.TICKETING_ADMIN_ROLE?.trim().toLowerCase();
  const role: TicketingAdminSession['role'] = roleValue === 'admin' ? 'admin' : 'owner';
  const database = createServerSupabaseClient();
  if (!database) {
    return NextResponse.json({ error: 'Ticketing MFA storage is unavailable. Configure Supabase before signing in.' }, { status: 503 });
  }
  const { data: mfaRecord, error: mfaError } = await database
    .from('ticketing_admin_mfa')
    .select('active')
    .eq('email', adminEmail)
    .maybeSingle();
  if (mfaError) {
    console.error('[TicketingLogin] Could not load mandatory MFA enrollment:', mfaError);
    return NextResponse.json({
      error: 'Authenticator MFA is required. Apply supabase/TICKETING_MFA_MIGRATION.sql and configure TICKETING_MFA_ENCRYPTION_KEY before signing in.'
    }, { status: 503 });
  }
  if (mfaRecord?.active && (process.env.TICKETING_MFA_ENCRYPTION_KEY?.trim().length || 0) < 32) {
    return NextResponse.json({ error: 'TICKETING_MFA_ENCRYPTION_KEY must contain at least 32 characters.' }, { status: 503 });
  }

  let challengeToken: string;
  try {
    challengeToken = createAdminMfaChallengeToken({ email: adminEmail, role });
  } catch (error) {
    console.error('[TicketingLogin] Could not create MFA challenge:', error);
    return NextResponse.json({ error: 'The authenticator challenge could not be created.' }, { status: 503 });
  }

  const response = NextResponse.json({
    authenticated: false,
    mfaRequired: true,
    setupRequired: !mfaRecord?.active
  });
  response.cookies.set(adminMfaChallengeCookie, challengeToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 5 * 60
  });
  response.cookies.set(adminSessionCookie, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
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
  response.cookies.set(adminMfaChallengeCookie, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
  return response;
}
