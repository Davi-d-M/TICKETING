import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  adminMfaChallengeCookie,
  adminSessionCookie,
  adminSessionLifetimeSeconds,
  createAdminSessionToken,
  isSameOriginRequest,
  readAdminMfaChallenge
} from '@/lib/adminAccess.server';
import {
  createTotpProvisioningUri,
  createTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  verifyTotpCode
} from '@/lib/adminMfa.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Authenticator verification is unavailable.';
}

function setupResult(email: string, secret: string) {
  return NextResponse.json({
    provisioningUri: createTotpProvisioningUri(email, secret),
    secret
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  }
  const challenge = readAdminMfaChallenge((await cookies()).get(adminMfaChallengeCookie)?.value);
  const configuredEmail = process.env.TICKETING_ADMIN_EMAIL?.trim().toLowerCase();
  if (!challenge || challenge.email !== configuredEmail) {
    return NextResponse.json({ error: 'Your sign-in challenge expired. Enter your password again.' }, { status: 401 });
  }

  let body: { action?: unknown; code?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'A valid authenticator request is required.' }, { status: 400 });
  }
  if (body.action !== 'setup' && body.action !== 'verify') {
    return NextResponse.json({ error: 'Choose authenticator setup or verification.' }, { status: 400 });
  }
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing MFA storage is unavailable.' }, { status: 503 });
  try {
    if (body.action === 'setup') {
      if (!await consumeTicketingRateLimit(request, `admin-mfa-setup:${challenge.email}`, 3, 300)) {
        return NextResponse.json({ error: 'Too many authenticator setup attempts. Wait five minutes before trying again.' }, { status: 429 });
      }
      if ((process.env.TICKETING_MFA_ENCRYPTION_KEY?.trim().length || 0) < 32) {
        return NextResponse.json({ error: 'Configure TICKETING_MFA_ENCRYPTION_KEY with at least 32 characters before enrolling an authenticator.' }, { status: 503 });
      }
      const { data: existing, error } = await database.from('ticketing_admin_mfa')
        .select('active,encrypted_secret')
        .eq('email', challenge.email)
        .maybeSingle();
      if (error) throw error;
      if (existing?.active) {
        return NextResponse.json({ error: 'An authenticator is already enrolled. Contact the system owner to recover admin access.' }, { status: 409 });
      }
      if (typeof existing?.encrypted_secret === 'string') {
        return setupResult(challenge.email, decryptTotpSecret(existing.encrypted_secret));
      }
      const secret = createTotpSecret();
      const { error: saveError } = await database.from('ticketing_admin_mfa').insert({
        email: challenge.email,
        encrypted_secret: encryptTotpSecret(secret),
        active: false,
        last_verified_step: null,
        updated_at: new Date().toISOString()
      });
      if (!saveError) return setupResult(challenge.email, secret);
      if (saveError.code !== '23505') throw saveError;
      const { data: racedSetup, error: reloadError } = await database.from('ticketing_admin_mfa')
        .select('active,encrypted_secret')
        .eq('email', challenge.email)
        .maybeSingle();
      if (reloadError) throw reloadError;
      if (racedSetup?.active) {
        return NextResponse.json({ error: 'An authenticator is already enrolled. Contact the system owner to recover admin access.' }, { status: 409 });
      }
      if (typeof racedSetup?.encrypted_secret !== 'string') throw saveError;
      return setupResult(challenge.email, decryptTotpSecret(racedSetup.encrypted_secret));
    }

    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return NextResponse.json({ error: 'Enter the six-digit code from your authenticator app.' }, { status: 400 });
    }
    if (!await consumeTicketingRateLimit(request, `admin-mfa:${challenge.email}`, 8, 300)) {
      return NextResponse.json({ error: 'Too many authenticator attempts. Wait five minutes before trying again.' }, { status: 429 });
    }
    const { data: record, error } = await database.from('ticketing_admin_mfa')
      .select('encrypted_secret,active')
      .eq('email', challenge.email)
      .maybeSingle();
    if (error) throw error;
    if (!record) return NextResponse.json({ error: 'Authenticator setup was not found. Start sign-in again.' }, { status: 409 });
    if (typeof record.encrypted_secret !== 'string') throw new Error('The stored authenticator secret is invalid.');
    const step = verifyTotpCode(decryptTotpSecret(record.encrypted_secret), body.code);
    if (step === null) return NextResponse.json({ error: 'That authenticator code is invalid or expired.' }, { status: 401 });
    const { data: accepted, error: consumeError } = await database.rpc('ticketing_consume_admin_mfa_step', {
      p_email: challenge.email,
      p_step: step,
      p_activate: !record.active
    });
    if (consumeError) throw consumeError;
    if (accepted !== true) {
      return NextResponse.json({ error: 'This authenticator code was already used. Wait for a new code and try again.' }, { status: 409 });
    }

    const token = createAdminSessionToken({
      email: challenge.email,
      role: challenge.role,
      mfaVerified: true
    });
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(adminSessionCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: adminSessionLifetimeSeconds
    });
    response.cookies.set(adminMfaChallengeCookie, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    });
    return response;
  } catch (cause) {
    console.error('[TicketingMFA] Could not complete authenticator request:', cause);
    const message = errorMessage(cause);
    return NextResponse.json({
      error: message.includes('TICKETING_MFA_ENCRYPTION_KEY')
        ? message
        : 'Authenticator verification is unavailable. Confirm the MFA migration and server configuration are applied.'
    }, { status: 503 });
  }
}
