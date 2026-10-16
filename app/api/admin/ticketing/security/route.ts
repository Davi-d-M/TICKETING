import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { isTicketingSalesReady } from '@/lib/ticketing/commerce.server';

export const dynamic = 'force-dynamic';

const severities = ['critical', 'high', 'medium', 'low'] as const;
const categories = [
  'account_access',
  'database_access',
  'payment_integrity',
  'ticket_fraud',
  'admin_activity',
  'attack_monitoring',
  'data_exposure',
  'other'
] as const;
const statuses = ['open', 'investigating', 'contained', 'resolved', 'false_positive'] as const;

type SecurityCase = {
  id: string;
  reference: string;
  severity: typeof severities[number];
  category: typeof categories[number];
  title: string;
  description: string;
  status: typeof statuses[number];
  related_entity_type: string | null;
  related_entity_reference: string | null;
  assigned_to_email: string;
  reported_by_email: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

async function authorize() {
  const session = await getAdminSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: 'Admin access is required.' }, { status: 401 }) };
  }
  if (!['owner', 'admin'].includes(session.role.toLowerCase())) {
    return { session: null, response: NextResponse.json({ error: 'Ticketing security access is restricted to platform admins.' }, { status: 403 }) };
  }
  return { session, response: null };
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'string' && value.trim().length <= maxLength ? value.trim() : null;
}

function migrationMissing(error: { code?: string; message?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205'
    || (error.message || '').toLowerCase().includes('ticketing_security_');
}

export async function GET() {
  const { session, response } = await authorize();
  if (response) return response;
  const database = createServerSupabaseClient();
  if (!database) {
    return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  }

  const [casesResult, eventsResult, activityResult, openCount, investigatingCount, containedCount, resolvedCount, falsePositiveCount] = await Promise.all([
    database.from('ticketing_security_cases').select(
      'id,reference,severity,category,title,description,status,related_entity_type,related_entity_reference,assigned_to_email,reported_by_email,created_at,updated_at,resolved_at'
    ).order('created_at', { ascending: false }).limit(100),
    database.from('ticketing_security_events').select(
      'id,case_id,event_type,severity,summary,actor_email,entity_type,entity_reference,details,created_at'
    ).order('created_at', { ascending: false }).limit(100),
    database.from('ticketing_security_case_activity').select(
      'id,case_id,actor_email,action,before_state,after_state,created_at'
    ).order('created_at', { ascending: false }).limit(100),
    database.from('ticketing_security_cases').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    database.from('ticketing_security_cases').select('id', { count: 'exact', head: true }).eq('status', 'investigating'),
    database.from('ticketing_security_cases').select('id', { count: 'exact', head: true }).eq('status', 'contained'),
    database.from('ticketing_security_cases').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
    database.from('ticketing_security_cases').select('id', { count: 'exact', head: true }).eq('status', 'false_positive')
  ]);

  const queryError = casesResult.error || eventsResult.error || activityResult.error
    || openCount.error || investigatingCount.error || containedCount.error
    || resolvedCount.error || falsePositiveCount.error;
  if (queryError) {
    if (migrationMissing(queryError)) {
      return NextResponse.json({
        error: 'Apply supabase/TICKETING_SECURITY_MIGRATION.sql after the core Ticketing migration to enable the security case centre.'
      }, { status: 503 });
    }
    console.error('[TicketingSecurity] Could not load security records:', queryError);
    return NextResponse.json({ error: 'Ticketing security records could not be loaded.' }, { status: 503 });
  }

  const cases = (casesResult.data || []) as SecurityCase[];
  const adminEmail = process.env.TICKETING_ADMIN_EMAIL?.trim().toLowerCase() || '';
  const [
    mfaResult,
    paymentSchema,
    walletSchema,
    walletLinksSchema,
    rotatingQrSchema,
    scannerAccountsSchema,
    scannerAssignmentsSchema,
    rateLimitSchema,
    salesReady
  ] = await Promise.all([
    database.from('ticketing_admin_mfa').select('active').eq('email', adminEmail).maybeSingle(),
    database.from('ticketing_payment_attempts').select('id').limit(0),
    database.from('ticketing_orders').select('id').limit(0),
    database.from('ticketing_guest_access_links').select('id').limit(0),
    database.from('ticketing_tickets').select('id,event_id,status,credential_hash,attendee_email').limit(0),
    database.from('ticketing_gate_staff_accounts').select('email').limit(0),
    database.from('ticketing_gate_staff_assignments').select('event_id,gate_name').limit(0),
    database.from('ticketing_rate_limit_windows').select('bucket_hash').limit(0),
    isTicketingSalesReady()
  ]);
  const hasSecret = (value: string | undefined) => (value?.trim().length || 0) >= 32;
  const paymentMode = process.env.TICKETING_PAYMENT_MODE?.trim();
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY?.trim() || '';
  const paystackKeyConfigured = (paymentMode === 'test' && paystackSecret.startsWith('sk_test_'))
    || (paymentMode === 'live' && paystackSecret.startsWith('sk_live_'));
  const paymentDatabaseReady = !paymentSchema.error && !walletSchema.error;
  const mfaConfigured = !mfaResult.error && mfaResult.data?.active === true
    && hasSecret(process.env.TICKETING_MFA_ENCRYPTION_KEY)
    && hasSecret(process.env.TICKETING_SESSION_SECRET);
  const qrConfigured = !rotatingQrSchema.error && hasSecret(process.env.TICKETING_QR_SIGNING_SECRET);
  const walletConfigured = !walletSchema.error && !walletLinksSchema.error
    && hasSecret(process.env.TICKETING_GUEST_SESSION_SECRET);
  const scannerConfigured = !scannerAccountsSchema.error && !scannerAssignmentsSchema.error && !rateLimitSchema.error
    && hasSecret(process.env.TICKETING_GATE_SESSION_SECRET);
  const controls = [
    {
      id: 'mfa',
      state: mfaResult.error ? 'Migration required' : mfaConfigured ? 'Authenticator enrolled' : 'Enrollment required',
      ready: mfaConfigured,
      description: mfaResult.error
        ? 'Apply the Ticketing MFA migration and configure its encryption key before admin sessions can be issued.'
        : mfaConfigured
          ? 'Admin sessions are issued only after password and authenticator verification. Accepted TOTP steps are atomically replay-protected.'
          : 'Password login starts a short-lived challenge; authenticator enrollment is required before an admin session is granted.'
    },
    {
      id: 'wallet',
      state: walletConfigured ? 'Configured · scoped' : 'Configuration required',
      ready: walletConfigured,
      description: 'Guest wallet links are scoped to the paid order or transferred ticket, protected by an HttpOnly session, and loaded from isolated Ticketing records.'
    },
    {
      id: 'paystack',
      state: !paymentDatabaseReady ? 'Migration required' : paystackKeyConfigured ? `Configured · ${paymentMode}` : 'Configuration required',
      ready: paymentDatabaseReady && paystackKeyConfigured,
      description: 'Paystack KES checkout, signed webhook handling, independent server-side verification, and idempotent payment records are implemented. This checks key format and schema, not provider API reachability or a successful test transaction.'
    },
    {
      id: 'rotating-qr',
      state: rotatingQrSchema.error ? 'Migration required' : qrConfigured ? 'Five-minute QR enabled' : 'Signing key required',
      ready: qrConfigured,
      description: 'Wallet QR values are signed, ticket-specific credentials that expire after five minutes. Both admin and assigned-staff scanners verify expiry and resolve the ticket before atomic check-in.'
    },
    {
      id: 'scanner',
      state: scannerConfigured ? 'Configured · assigned staff' : 'Configuration required',
      ready: scannerConfigured,
      description: 'Online scanners require an active staff account and event/gate assignment. Database check-in is atomic and request-idempotent; offline admission is not supported.'
    },
    {
      id: 'incident',
      state: 'Case audit connected',
      ready: true,
      description: 'Incident cases and case actions are stored in the Ticketing security tables. This does not ingest WAF, provider, database-denial, or automated threat signals.'
    },
    {
      id: 'backup',
      state: 'Manual verification required',
      ready: false,
      description: 'Supabase backup scheduling and a successful restore drill cannot be verified from application code. Confirm them in the provider project and record a restore-test result.'
    },
    {
      id: 'release',
      state: salesReady ? 'Release checks passed' : 'Sales release blocked',
      ready: salesReady,
      description: salesReady
        ? 'Required sales secrets, release approvals, and commerce schema checks are passing.'
        : `Sales release requires configured payment/email/session secrets, required migrations, TICKETING_SALES_ENABLED=true, and TICKETING_RELEASE_APPROVED=true. Current switches: sales ${process.env.TICKETING_SALES_ENABLED === 'true' ? 'on' : 'off'}, approval ${process.env.TICKETING_RELEASE_APPROVED === 'true' ? 'on' : 'off'}.`
    }
  ];

  return NextResponse.json({
    cases,
    events: eventsResult.data || [],
    activity: activityResult.data || [],
    counts: {
      open: openCount.count || 0,
      investigating: investigatingCount.count || 0,
      contained: containedCount.count || 0,
      resolved: resolvedCount.count || 0,
      false_positive: falsePositiveCount.count || 0
    },
    canManageCases: session?.role.toLowerCase() === 'owner',
    controls,
    monitoring: {
      source: 'Ticketing security case activity only',
      automatedDetection: false
    }
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  }

  const { session, response } = await authorize();
  if (response) return response;
  const database = createServerSupabaseClient();
  if (!database) {
    return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid security action is required.' }, { status: 400 });
  }

  if (body.action === 'create_case') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const entityType = optionalText(body.relatedEntityType, 40);
    const entityReference = optionalText(body.relatedEntityReference, 160);
    if (!isOneOf(body.severity, severities) || !isOneOf(body.category, categories)
      || title.length < 5 || title.length > 160 || description.length < 5 || description.length > 5000
      || entityType === null || entityReference === null) {
      return NextResponse.json({ error: 'Enter a valid severity, category, summary and incident description.' }, { status: 400 });
    }

    const { data, error } = await database.rpc('ticketing_create_security_case', {
      p_severity: body.severity,
      p_category: body.category,
      p_title: title,
      p_description: description,
      p_related_entity_type: entityType,
      p_related_entity_reference: entityReference,
      p_actor_email: session?.email || ''
    });
    if (error || !data) {
      console.error('[TicketingSecurity] Could not create security case:', error);
      if (error?.code === '23514' || error?.code === '22023') {
        return NextResponse.json({ error: 'The incident details did not pass validation.' }, { status: 400 });
      }
      return NextResponse.json({ error: 'The security case could not be created.' }, { status: 503 });
    }
    return NextResponse.json({ case: data }, { status: 201 });
  }

  if (body.action === 'update_case') {
    if (session?.role.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Only the platform owner can assign, contain or resolve security cases.' }, { status: 403 });
    }
    const caseId = typeof body.caseId === 'string' ? body.caseId : '';
    const assignedToEmail = optionalText(body.assignedToEmail, 320);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(caseId) || !isOneOf(body.status, statuses)
      || assignedToEmail === null || (assignedToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assignedToEmail))
      || reason.length < 5 || reason.length > 500) {
      return NextResponse.json({ error: 'Choose a valid case status and assignee email, and provide a reason for the change.' }, { status: 400 });
    }

    const { data, error } = await database.rpc('ticketing_update_security_case', {
      p_case_id: caseId,
      p_status: body.status,
      p_assigned_to_email: assignedToEmail,
      p_reason: reason,
      p_actor_email: session?.email || ''
    });
    if (error || !data) {
      console.error('[TicketingSecurity] Could not update security case:', error);
      if (error?.code === 'P0002') {
        return NextResponse.json({ error: 'The selected security case was not found.' }, { status: 404 });
      }
      if (error?.code === '22023') {
        return NextResponse.json({ error: 'Provide a reason for the case update.' }, { status: 400 });
      }
      return NextResponse.json({ error: 'The security case could not be updated.' }, { status: 503 });
    }
    return NextResponse.json({ case: data });
  }

  return NextResponse.json({ error: 'Choose a supported ticketing security action.' }, { status: 400 });
}
