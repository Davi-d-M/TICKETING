import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

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
