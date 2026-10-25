import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contactLikeQuery = /(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s().-]{6,}\d)/;
const eventTypes = ['event_view', 'event_search', 'filter', 'checkout_intent'] as const;
type DemandEventType = typeof eventTypes[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin demand signals are required.' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4096) {
    return NextResponse.json({ error: 'Demand signal is too large.' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A valid demand signal is required.' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.type !== 'string' || !eventTypes.includes(body.type as DemandEventType)
    || typeof body.visitorId !== 'string' || !uuidPattern.test(body.visitorId)) {
    return NextResponse.json({ error: 'The demand signal is invalid.' }, { status: 400 });
  }

  const type = body.type as DemandEventType;
  const eventId = typeof body.eventId === 'string' ? body.eventId : null;
  if ((type === 'event_view' || type === 'checkout_intent') && (!eventId || !uuidPattern.test(eventId))) {
    return NextResponse.json({ error: 'This demand signal needs a valid event.' }, { status: 400 });
  }
  if (eventId && !uuidPattern.test(eventId)) {
    return NextResponse.json({ error: 'The event reference is invalid.' }, { status: 400 });
  }

  const inputMetadata = isRecord(body.metadata) ? body.metadata : {};
  let metadata: Record<string, string | number | boolean> = {};
  if (type === 'event_search') {
    const query = cleanText(inputMetadata.query, 80);
    const results = inputMetadata.results;
    if (typeof inputMetadata.zeroResults !== 'boolean'
      || typeof results !== 'number' || !Number.isSafeInteger(results) || results < 0 || results > 10000) {
      return NextResponse.json({ error: 'The search demand signal is invalid.' }, { status: 400 });
    }
    metadata = {
      zero_results: inputMetadata.zeroResults,
      results
    };
    if (query && !contactLikeQuery.test(query)) metadata.query = query;
  } else if (type === 'filter') {
    const city = cleanText(inputMetadata.city, 100);
    const dateRange = cleanText(inputMetadata.dateRange, 20);
    const priceCeiling = inputMetadata.priceCeilingKes;
    if (dateRange && !['any', 'today', 'week', 'month'].includes(dateRange)) {
      return NextResponse.json({ error: 'The selected date range is invalid.' }, { status: 400 });
    }
    if (priceCeiling !== null && priceCeiling !== undefined
      && (typeof priceCeiling !== 'number' || !Number.isFinite(priceCeiling) || priceCeiling < 0 || priceCeiling > 10000000)) {
      return NextResponse.json({ error: 'The selected price filter is invalid.' }, { status: 400 });
    }
    if (city) metadata.city = city;
    if (dateRange && dateRange !== 'any') metadata.date_range = dateRange;
    if (typeof priceCeiling === 'number') metadata.price_ceiling_kes = priceCeiling;
    if (Object.keys(metadata).length === 0) {
      return NextResponse.json({ error: 'Select at least one event filter.' }, { status: 400 });
    }
  } else if (type === 'checkout_intent') {
    const quantity = inputMetadata.quantity;
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return NextResponse.json({ error: 'The checkout intent is invalid.' }, { status: 400 });
    }
    metadata = { quantity };
  }

  try {
    if (!await consumeTicketingRateLimit(request, 'demand_signal', 60, 300)) {
      return NextResponse.json({ error: 'Too many demand signals. Please try again later.' }, { status: 429 });
    }
  } catch (cause) {
    console.error('[TicketingDemand] Could not apply demand-signal rate limit:', cause);
    return NextResponse.json({ error: 'Demand tracking is temporarily unavailable.' }, { status: 503 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  if (eventId) {
    const { data: event, error } = await database.from('ticketing_events')
      .select('id')
      .eq('id', eventId)
      .in('status', ['on_sale', 'sold_out'])
      .maybeSingle();
    if (error) {
      console.error('[TicketingDemand] Could not validate the public event:', error);
      return NextResponse.json({ error: 'Demand tracking is temporarily unavailable.' }, { status: 503 });
    }
    if (!event) return NextResponse.json({ error: 'The event is not publicly available.' }, { status: 404 });
  }

  const { error } = await database.from('ticketing_demand_events').insert({
    visitor_id: body.visitorId,
    event_id: eventId,
    event_type: type,
    metadata
  });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({
        error: 'Apply supabase/TICKETING_DEMAND_INTELLIGENCE_MIGRATION.sql after the core ticketing migrations to enable demand signals.'
      }, { status: 503 });
    }
    console.error('[TicketingDemand] Could not save demand signal:', error);
    return NextResponse.json({ error: 'The demand signal could not be saved.' }, { status: 503 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' }
  });
}
