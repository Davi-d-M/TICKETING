import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';

export const dynamic = 'force-dynamic';

async function authorize() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Admin access is required.' }, { status: 401 });
  }
  if (!['owner', 'admin'].includes(session.role.toLowerCase())) {
    return NextResponse.json({ error: 'Ticketing operations are restricted to platform admins.' }, { status: 403 });
  }
  return null;
}

function isMissingMigration(error: { code?: string; message?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205'
    || (error.message || '').toLowerCase().includes('ticketing_');
}

export async function GET(request: NextRequest) {
  const denied = await authorize();
  if (denied) return denied;

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const afterValue = request.nextUrl.searchParams.get('after');
  let afterId: number | null = null;
  if (afterValue !== null) {
    afterId = Number(afterValue);
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      return NextResponse.json({ error: 'The live feed cursor is invalid.' }, { status: 400 });
    }
  }

  const liveEventsQuery = database.from('ticketing_live_events')
    .select('id,event_id,source_table,operation,event_type,severity,summary,entity_type,entity_reference,status,occurred_at')
    .order('id', { ascending: afterId !== null })
    .limit(afterId === null ? 50 : 100);
  const liveEvents = afterId === null
    ? await liveEventsQuery
    : await liveEventsQuery.gt('id', afterId);

  if (liveEvents.error) {
    if (isMissingMigration(liveEvents.error)) {
      return NextResponse.json({
        error: 'Apply supabase/TICKETING_LIVE_OPERATIONS_MIGRATION.sql after the core migration to enable the operational event feed.'
      }, { status: 503 });
    }
    console.error('[TicketingLive] Could not load operational events:', liveEvents.error);
    return NextResponse.json({ error: 'Ticketing operations could not be loaded.' }, { status: 503 });
  }

  const events = (liveEvents.data || []).sort((left, right) => Number(left.id) - Number(right.id));
  const feed = {
    events,
    nextCursor: events.length ? String(events[events.length - 1].id) : afterValue,
    sampledAt: new Date().toISOString()
  };

  if (request.nextUrl.searchParams.get('feedOnly') === '1') {
    return NextResponse.json(feed, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  }

  const { data: metricData, error: metricError } = await database.rpc('ticketing_get_security_metrics');
  if (metricError || !metricData) {
    if (metricError && isMissingMigration(metricError)) {
      return NextResponse.json({
        error: 'Apply supabase/TICKETING_VERIFICATION_MIGRATION.sql after the core, commerce, security and live operations migrations to enable security metrics.'
      }, { status: 503 });
    }
    console.error('[TicketingLive] Could not load operational metrics:', metricError);
    return NextResponse.json({ error: 'Ticketing operation metrics could not be loaded.' }, { status: 503 });
  }

  return NextResponse.json({
    ...feed,
    metrics: metricData
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}
