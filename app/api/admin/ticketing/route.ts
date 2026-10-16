import { NextResponse } from 'next/server';
import { getAdminSession, isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { isTicketingSalesReady } from '@/lib/ticketing/commerce.server';
import { isTrustedVenueMapUrl } from '@/lib/ticketing/venueLinks';

export const dynamic = 'force-dynamic';

const eventFields = 'id,organizer_id,title,slug,description,venue_name,venue_address,city,timezone,starts_at,ends_at,doors_open_at,age_limit,capacity,status,cancellation_policy,cover_image_url,venue_maps_url,venue_latitude,venue_longitude,entrance_instructions,parking_details,transport_guidance,dress_code,service_fee_minor,published_at,created_at,updated_at';
const ticketTypeFields = 'id,event_id,name,description,price_minor,currency,capacity,min_per_order,max_per_order,sales_start_at,sales_end_at,benefits,status,created_at,updated_at';
const promotionFields = 'id,event_id,code,discount_type,discount_value,currency,max_redemptions,starts_at,ends_at,active';

async function authorize() {
  const session = await getAdminSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: 'Admin access is required.' }, { status: 401 }) };
  }
  if (!['owner', 'admin'].includes(session.role.toLowerCase())) {
    return { session: null, response: NextResponse.json({ error: 'Ticketing management is restricted to platform admins.' }, { status: 403 }) };
  }
  return { session, response: null };
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  const isLocalDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized);
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  if (!isLocalDateTime && !hasTimezone) return null;
  const date = new Date(isLocalDateTime ? `${normalized}+03:00` : normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseMoney(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

function missingMigration(error: { code?: string; message?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205'
    || (error.message || '').toLowerCase().includes('ticketing_');
}

export async function GET() {
  const { session, response } = await authorize();
  if (response) return response;
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const [eventsResult, eventCount, ticketCount, orderCount] = await Promise.all([
    database.from('ticketing_events').select(eventFields).order('starts_at', { ascending: true }).limit(100),
    database.from('ticketing_events').select('id', { count: 'exact', head: true }),
    database.from('ticketing_tickets').select('id', { count: 'exact', head: true }),
    database.from('ticketing_orders').select('id', { count: 'exact', head: true })
  ]);
  const queryError = eventsResult.error || eventCount.error || ticketCount.error || orderCount.error;
  if (queryError) {
    if (missingMigration(queryError)) {
      return NextResponse.json({
        error: 'Apply supabase/TICKETING_CORE_MIGRATION.sql to the shared Supabase project to initialize the isolated Ticketing system.'
      }, { status: 503 });
    }
    console.error('[TicketingAdmin] Could not load ticketing dashboard:', queryError);
    return NextResponse.json({ error: 'Ticketing dashboard data could not be loaded.' }, { status: 503 });
  }

  const events = eventsResult.data || [];
  const eventIds = events.map(event => event.id);
  const ticketTypesResult = eventIds.length
    ? await database.from('ticketing_ticket_types').select(ticketTypeFields).in('event_id', eventIds).order('created_at')
    : { data: [], error: null };
  if (ticketTypesResult.error) {
    console.error('[TicketingAdmin] Could not load ticket tiers:', ticketTypesResult.error);
    return NextResponse.json({ error: 'Ticket tiers could not be loaded.' }, { status: 503 });
  }

  const typesByEvent = new Map<string, typeof ticketTypesResult.data>();
  for (const type of ticketTypesResult.data || []) {
    typesByEvent.set(type.event_id, [...(typesByEvent.get(type.event_id) || []), type]);
  }
  const promotionsResult = eventIds.length
    ? await database.from('ticketing_promotions').select(promotionFields).in('event_id', eventIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (promotionsResult.error) {
    console.error('[TicketingAdmin] Could not load event promotions:', promotionsResult.error);
    return NextResponse.json({ error: 'Event discounts could not be loaded.' }, { status: 503 });
  }
  const promotionsByEvent = new Map<string, typeof promotionsResult.data>();
  for (const promotion of promotionsResult.data || []) {
    promotionsByEvent.set(promotion.event_id, [...(promotionsByEvent.get(promotion.event_id) || []), promotion]);
  }
  return NextResponse.json({
    events: events.map(event => ({
      ...event,
      ticket_types: typesByEvent.get(event.id) || [],
      promotions: promotionsByEvent.get(event.id) || []
    })),
    totals: {
      events: eventCount.count || 0,
      tickets: ticketCount.count || 0,
      orders: orderCount.count || 0
    },
    salesReady: await isTicketingSalesReady(),
    canPublish: session?.role.toLowerCase() === 'owner'
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  }
  const { session, response } = await authorize();
  if (response) return response;
  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid ticketing request is required.' }, { status: 400 });
  }

  if (body.action === 'update_event_service_fee') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const serviceFeeMinor = parseMoney(body.serviceFee);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || serviceFeeMinor === null || serviceFeeMinor > 100_000_000) {
      return NextResponse.json({ error: 'Enter a valid event and per-ticket service fee.' }, { status: 400 });
    }
    const isOwner = session?.role.toLowerCase() === 'owner';
    const { data, error } = await database.rpc('ticketing_update_event_service_fee', {
      p_event_id: eventId,
      p_service_fee_minor: serviceFeeMinor,
      p_actor_email: session?.email || '',
      p_allow_on_sale: isOwner
    });
    if (error || !data) {
      if (error?.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 409 });
      if (error?.code === 'P0002') return NextResponse.json({ error: 'The selected event was not found.' }, { status: 404 });
      if (error?.code === '22023') return NextResponse.json({ error: 'The service fee is invalid.' }, { status: 400 });
      if (error?.code === '42501') return NextResponse.json({ error: error.message }, { status: 403 });
      console.error('[TicketingAdmin] Could not update event service fee:', error);
      return NextResponse.json({ error: 'The service fee could not be updated.' }, { status: 503 });
    }
    return NextResponse.json({ event: data });
  }

  if (body.action === 'set_event_status') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const status = typeof body.status === 'string' ? body.status : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || !['scheduled', 'on_sale', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Choose a valid event and event status.' }, { status: 400 });
    }
    if (status === 'on_sale' && session?.role.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Only the platform owner can open ticket sales.' }, { status: 403 });
    }
    if (status === 'on_sale' && !await isTicketingSalesReady()) {
      return NextResponse.json({ error: 'Sales release is blocked. Configure the Paystack sandbox, ticket email, guest secrets, approved database migrations and release approval first.' }, { status: 503 });
    }
    const { data, error } = await database.rpc('ticketing_set_event_status', {
      p_event_id: eventId,
      p_status: status,
      p_actor_email: session?.email || ''
    });
    if (error || !data) {
      if (error?.code === 'P0001') return NextResponse.json({ error: error.message }, { status: 409 });
      if (error?.code === 'P0002') return NextResponse.json({ error: 'The selected event was not found.' }, { status: 404 });
      if (error?.code === '22023') return NextResponse.json({ error: 'The requested event status is invalid.' }, { status: 400 });
      console.error('[TicketingAdmin] Could not update event status:', error);
      return NextResponse.json({ error: 'The event status could not be updated.' }, { status: 503 });
    }
    return NextResponse.json({ event: data });
  }

  if (body.action === 'update_event_experience') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const venueName = typeof body.venueName === 'string' ? body.venueName.trim() : '';
    const venueAddress = typeof body.venueAddress === 'string' ? body.venueAddress.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const mapsUrl = typeof body.venueMapsUrl === 'string' ? body.venueMapsUrl.trim() : '';
    const latitude = body.venueLatitude === '' || body.venueLatitude === null || body.venueLatitude === undefined
      ? null : Number(body.venueLatitude);
    const longitude = body.venueLongitude === '' || body.venueLongitude === null || body.venueLongitude === undefined
      ? null : Number(body.venueLongitude);
    const entranceInstructions = typeof body.entranceInstructions === 'string' ? body.entranceInstructions.trim() : '';
    const parkingDetails = typeof body.parkingDetails === 'string' ? body.parkingDetails.trim() : '';
    const transportGuidance = typeof body.transportGuidance === 'string' ? body.transportGuidance.trim() : '';
    const dressCode = typeof body.dressCode === 'string' ? body.dressCode.trim() : '';
    const serviceFeeMinor = parseMoney(body.serviceFee);
    const eventCapacity = body.eventCapacity === '' || body.eventCapacity === null || body.eventCapacity === undefined
      ? null : Number(body.eventCapacity);

    let validMapsUrl = false;
    if (mapsUrl) {
      validMapsUrl = isTrustedVenueMapUrl(mapsUrl);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || venueName.length < 2 || venueName.length > 180 || venueAddress.length > 500
      || city.length < 2 || city.length > 100 || (mapsUrl && (!validMapsUrl || mapsUrl.length > 1000))
      || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      || ((latitude === null) !== (longitude === null))
      || entranceInstructions.length > 2000 || parkingDetails.length > 2000
      || transportGuidance.length > 3000 || dressCode.length > 500
      || serviceFeeMinor === null || serviceFeeMinor > 100_000_000
      || (eventCapacity !== null && (!Number.isSafeInteger(eventCapacity) || eventCapacity < 1 || eventCapacity > 1_000_000))) {
      return NextResponse.json({ error: 'Check the venue, map, arrival details and non-negative per-ticket service fee.' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await database.rpc('ticketing_update_event_experience', {
      p_event_id: eventId,
      p_venue_name: venueName,
      p_venue_address: venueAddress,
      p_city: city,
      p_venue_maps_url: mapsUrl,
      p_venue_latitude: latitude,
      p_venue_longitude: longitude,
      p_entrance_instructions: entranceInstructions,
      p_parking_details: parkingDetails,
      p_transport_guidance: transportGuidance,
      p_dress_code: dressCode,
      p_service_fee_minor: serviceFeeMinor,
      p_capacity: eventCapacity,
      p_actor_email: session?.email || ''
    });
    if (updateError || !updated) {
      if (updateError?.code === 'P0001') return NextResponse.json({ error: updateError.message }, { status: 409 });
      if (updateError?.code === 'P0002') return NextResponse.json({ error: 'The selected event was not found.' }, { status: 404 });
      if (updateError?.code === '22023') return NextResponse.json({ error: 'The event details are invalid.' }, { status: 400 });
      console.error('[TicketingAdmin] Could not update event experience:', updateError);
      return NextResponse.json({ error: 'Venue and pricing details could not be saved.' }, { status: 503 });
    }
    return NextResponse.json({ event: updated });
  }

  if (body.action === 'create_promotion') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const discountType = body.discountType === 'percentage' || body.discountType === 'fixed'
      ? body.discountType : '';
    const rawValue = discountType === 'fixed' ? parseMoney(body.discountValue) : Number(body.discountValue);
    const maxRedemptions = body.maxRedemptions === '' || body.maxRedemptions === null || body.maxRedemptions === undefined
      ? null : Number(body.maxRedemptions);
    const startsAt = body.startsAt ? parseDate(body.startsAt) : null;
    const endsAt = body.endsAt ? parseDate(body.endsAt) : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)
      || !discountType || rawValue === null || !Number.isSafeInteger(rawValue) || rawValue <= 0
      || (discountType === 'percentage' && rawValue > 100)
      || (maxRedemptions !== null && (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1_000_000))
      || (body.startsAt && !startsAt) || (body.endsAt && !endsAt)
      || (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))) {
      return NextResponse.json({ error: 'Enter a valid discount code, amount, redemption limit and sale window.' }, { status: 400 });
    }
    const { data: event, error: eventError } = await database.from('ticketing_events')
      .select('status')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError || !event) {
      if (eventError) console.error('[TicketingAdmin] Could not verify event for promotion:', eventError);
      return NextResponse.json({ error: 'The event could not be verified for a discount.' }, { status: event ? 503 : 404 });
    }
    if (typeof event.status !== 'string' || !['draft', 'scheduled'].includes(event.status)) {
      return NextResponse.json({ error: 'Discounts can only be added before ticket sales open.' }, { status: 409 });
    }
    const { data: promotion, error: promotionError } = await database.from('ticketing_promotions').insert({
      event_id: eventId,
      code,
      discount_type: discountType,
      discount_value: rawValue,
      currency: 'KES',
      max_redemptions: maxRedemptions,
      starts_at: startsAt,
      ends_at: endsAt,
      active: true
    }).select(promotionFields).single();
    if (promotionError || !promotion) {
      if (promotionError?.code === '23505') return NextResponse.json({ error: 'That discount code already exists for this event.' }, { status: 409 });
      console.error('[TicketingAdmin] Could not create promotion:', promotionError);
      return NextResponse.json({ error: 'The discount could not be created.' }, { status: 503 });
    }
    const { error: auditError } = await database.from('ticketing_audit_logs').insert({
      actor_email: session?.email || '',
      action: 'promotion.created',
      entity_type: 'promotion',
      entity_id: promotion.id,
      after_state: promotion
    });
    if (auditError) {
      console.error('[TicketingAdmin] Promotion created but audit record failed:', auditError);
      return NextResponse.json({ error: 'Discount was created, but the audit record could not be written. Contact support before continuing.' }, { status: 503 });
    }
    return NextResponse.json({ promotion }, { status: 201 });
  }

  if (body.action === 'set_promotion_active') {
    const promotionId = typeof body.promotionId === 'string' ? body.promotionId : '';
    const active = body.active === true;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(promotionId)) {
      return NextResponse.json({ error: 'Choose a valid discount to update.' }, { status: 400 });
    }
    const { data: before, error: beforeError } = await database.from('ticketing_promotions')
      .select(promotionFields)
      .eq('id', promotionId)
      .maybeSingle();
    if (beforeError || !before) {
      if (beforeError) console.error('[TicketingAdmin] Could not load discount:', beforeError);
      return NextResponse.json({ error: 'The discount could not be loaded.' }, { status: before ? 503 : 404 });
    }
    const { data: promotion, error: updateError } = await database.from('ticketing_promotions')
      .update({ active })
      .eq('id', promotionId)
      .select(promotionFields)
      .maybeSingle();
    if (updateError || !promotion) {
      console.error('[TicketingAdmin] Could not update discount:', updateError);
      return NextResponse.json({ error: 'The discount could not be updated.' }, { status: 503 });
    }
    const { error: auditError } = await database.from('ticketing_audit_logs').insert({
      actor_email: session?.email || '',
      action: 'promotion.status_changed',
      entity_type: 'promotion',
      entity_id: promotionId,
      before_state: { active: before.active },
      after_state: { active: promotion.active }
    });
    if (auditError) {
      console.error('[TicketingAdmin] Discount status saved but audit record failed:', auditError);
      return NextResponse.json({ error: 'Discount status was saved, but the audit record could not be written. Contact support before continuing.' }, { status: 503 });
    }
    return NextResponse.json({ promotion });
  }

  if (body.action === 'create_event') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const venueName = typeof body.venueName === 'string' ? body.venueName.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const startsAt = parseDate(body.startsAt);
    const endsAt = parseDate(body.endsAt);
    const doorsOpenAt = body.doorsOpenAt ? parseDate(body.doorsOpenAt) : null;
    const capacity = body.capacity === '' || body.capacity === null || body.capacity === undefined
      ? null : Number(body.capacity);
    const ageLimit = body.ageLimit === '' || body.ageLimit === null || body.ageLimit === undefined
      ? null : Number(body.ageLimit);
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const venueAddress = typeof body.venueAddress === 'string' ? body.venueAddress.trim() : '';
    const cancellationPolicy = typeof body.cancellationPolicy === 'string' ? body.cancellationPolicy.trim() : '';
    const venueMapsUrl = typeof body.venueMapsUrl === 'string' ? body.venueMapsUrl.trim() : '';
    const venueLatitude = body.venueLatitude === '' || body.venueLatitude === null || body.venueLatitude === undefined
      ? null : Number(body.venueLatitude);
    const venueLongitude = body.venueLongitude === '' || body.venueLongitude === null || body.venueLongitude === undefined
      ? null : Number(body.venueLongitude);
    const entranceInstructions = typeof body.entranceInstructions === 'string' ? body.entranceInstructions.trim() : '';
    const parkingDetails = typeof body.parkingDetails === 'string' ? body.parkingDetails.trim() : '';
    const transportGuidance = typeof body.transportGuidance === 'string' ? body.transportGuidance.trim() : '';
    const dressCode = typeof body.dressCode === 'string' ? body.dressCode.trim() : '';
    const serviceFeeMinor = parseMoney(body.serviceFee);
    let validMapsUrl = false;
    if (venueMapsUrl) {
      validMapsUrl = isTrustedVenueMapUrl(venueMapsUrl);
    }

    if (title.length < 3 || title.length > 160 || venueName.length < 2 || venueName.length > 180
      || city.length < 2 || city.length > 100 || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)
      || (body.doorsOpenAt && (!doorsOpenAt || new Date(doorsOpenAt) > new Date(startsAt)))
      || (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000))
      || (ageLimit !== null && (!Number.isSafeInteger(ageLimit) || ageLimit < 0 || ageLimit > 120))
      || description.length > 10_000 || venueAddress.length > 500 || cancellationPolicy.length > 5_000
      || (venueMapsUrl && (!validMapsUrl || venueMapsUrl.length > 1000))
      || (venueLatitude !== null && (!Number.isFinite(venueLatitude) || venueLatitude < -90 || venueLatitude > 90))
      || (venueLongitude !== null && (!Number.isFinite(venueLongitude) || venueLongitude < -180 || venueLongitude > 180))
      || ((venueLatitude === null) !== (venueLongitude === null))
      || entranceInstructions.length > 2000 || parkingDetails.length > 2000
      || transportGuidance.length > 3000 || dressCode.length > 500
      || serviceFeeMinor === null || serviceFeeMinor > 100_000_000) {
      return NextResponse.json({ error: 'Enter a valid event title, venue, city and date range. End time must be after start time.' }, { status: 400 });
    }

    const organizerResult = await database.from('ticketing_organizers').select('id').eq('slug', 'midnight-society-ke').maybeSingle();
    if (organizerResult.error || !organizerResult.data) {
      console.error('[TicketingAdmin] Default organizer is unavailable:', organizerResult.error);
      return NextResponse.json({ error: 'The Midnight Society KE organizer record is unavailable. Apply the ticketing database migration.' }, { status: 503 });
    }

    const slug = `${slugify(title) || 'event'}-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error } = await database.rpc('ticketing_create_event', {
      p_organizer_id: organizerResult.data.id,
      p_title: title,
      p_slug: slug,
      p_description: description,
      p_venue_name: venueName,
      p_venue_address: venueAddress,
      p_city: city,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_doors_open_at: doorsOpenAt,
      p_age_limit: ageLimit,
      p_capacity: capacity,
      p_cancellation_policy: cancellationPolicy,
      p_actor_email: session?.email || ''
    });
    if (error || !data) {
      console.error('[TicketingAdmin] Could not create draft event:', error);
      return NextResponse.json({ error: 'The draft event could not be saved.' }, { status: 503 });
    }
    const createdEvent = data as Record<string, unknown>;
    const eventId = typeof createdEvent.id === 'string' ? createdEvent.id : '';
    const { data: experience, error: experienceError } = await database.from('ticketing_events')
      .update({
        venue_maps_url: venueMapsUrl,
        venue_latitude: venueLatitude,
        venue_longitude: venueLongitude,
        entrance_instructions: entranceInstructions,
        parking_details: parkingDetails,
        transport_guidance: transportGuidance,
        dress_code: dressCode,
        service_fee_minor: serviceFeeMinor
      })
      .eq('id', eventId)
      .select(eventFields)
      .single();
    if (experienceError || !experience) {
      console.error('[TicketingAdmin] Event draft created but experience details could not be saved:', experienceError);
      return NextResponse.json({ error: 'Event draft was created, but its venue and price details were not saved. Reopen the event and retry.' }, { status: 503 });
    }
    const { error: auditError } = await database.from('ticketing_audit_logs').insert({
      actor_email: session?.email || '',
      action: 'event.experience_added',
      entity_type: 'event',
      entity_id: eventId,
      after_state: {
        venue_maps_url: venueMapsUrl,
        venue_latitude: venueLatitude,
        venue_longitude: venueLongitude,
        entrance_instructions: entranceInstructions,
        parking_details: parkingDetails,
        transport_guidance: transportGuidance,
        dress_code: dressCode,
        service_fee_minor: serviceFeeMinor
      }
    });
    if (auditError) {
      console.error('[TicketingAdmin] Event created but experience audit record failed:', auditError);
      return NextResponse.json({ error: 'The event was created, but its venue audit record could not be written. Contact support before continuing.' }, { status: 503 });
    }
    return NextResponse.json({ event: { ...experience, ticket_types: [], promotions: [] } }, { status: 201 });
  }

  if (body.action === 'create_ticket_type') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const priceMinor = parseMoney(body.price);
    const capacity = Number(body.capacity);
    const minPerOrder = Number(body.minPerOrder ?? 1);
    const maxPerOrder = Number(body.maxPerOrder ?? 10);
    const salesStartAt = body.salesStartAt ? parseDate(body.salesStartAt) : null;
    const salesEndAt = body.salesEndAt ? parseDate(body.salesEndAt) : null;
    const rawBenefits = body.benefits === undefined ? [] : body.benefits;
    const benefits = Array.isArray(rawBenefits) && rawBenefits.every((value): value is string => typeof value === 'string')
      ? rawBenefits.map(value => value.trim()).filter(Boolean)
      : null;
    if (!/^[0-9a-f-]{36}$/i.test(eventId) || name.length < 2 || name.length > 100
      || description.length > 2_000 || priceMinor === null || !benefits || benefits.length > 20
      || benefits.some(value => value.length > 200)
      || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000
      || !Number.isSafeInteger(minPerOrder) || !Number.isSafeInteger(maxPerOrder)
      || minPerOrder < 1 || maxPerOrder < minPerOrder || maxPerOrder > 100
      || (body.salesStartAt && !salesStartAt) || (body.salesEndAt && !salesEndAt)
      || (salesStartAt && salesEndAt && new Date(salesEndAt) <= new Date(salesStartAt))) {
      return NextResponse.json({ error: 'Enter a valid tier name, price, capacity, order limit and sale window.' }, { status: 400 });
    }

    const { data, error } = await database.rpc('ticketing_create_ticket_type_with_benefits', {
      p_event_id: eventId,
      p_name: name,
      p_description: description,
      p_price_minor: priceMinor,
      p_capacity: capacity,
      p_min_per_order: minPerOrder,
      p_max_per_order: maxPerOrder,
      p_sales_start_at: salesStartAt,
      p_sales_end_at: salesEndAt,
      p_benefits: benefits,
      p_actor_email: session?.email || ''
    });
    if (error || !data) {
      console.error('[TicketingAdmin] Could not create ticket tier:', error);
      if (error?.code === '23514') {
        return NextResponse.json({ error: 'This tier exceeds the event capacity. Reduce its allocation before saving.' }, { status: 400 });
      }
      if (error?.code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error?.code === 'P0002') {
        return NextResponse.json({ error: 'The selected event was not found.' }, { status: 404 });
      }
      return NextResponse.json({ error: 'The ticket tier could not be saved.' }, { status: 503 });
    }
    return NextResponse.json({ ticketType: data }, { status: 201 });
  }

  if (body.action === 'update_ticket_type') {
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const ticketTypeId = typeof body.ticketTypeId === 'string' ? body.ticketTypeId : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const priceMinor = parseMoney(body.price);
    const capacity = Number(body.capacity);
    const minPerOrder = Number(body.minPerOrder ?? 1);
    const maxPerOrder = Number(body.maxPerOrder ?? 10);
    const salesStartAt = body.salesStartAt ? parseDate(body.salesStartAt) : null;
    const salesEndAt = body.salesEndAt ? parseDate(body.salesEndAt) : null;
    const rawBenefits = body.benefits === undefined ? [] : body.benefits;
    const benefits = Array.isArray(rawBenefits) && rawBenefits.every((value): value is string => typeof value === 'string')
      ? rawBenefits.map(value => value.trim()).filter(Boolean)
      : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketTypeId)
      || name.length < 2 || name.length > 100 || description.length > 2_000
      || priceMinor === null || priceMinor < 1 || !benefits || benefits.length > 20
      || benefits.some(value => value.length > 200)
      || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000
      || !Number.isSafeInteger(minPerOrder) || !Number.isSafeInteger(maxPerOrder)
      || minPerOrder < 1 || maxPerOrder < minPerOrder || maxPerOrder > 100
      || (body.salesStartAt && !salesStartAt) || (body.salesEndAt && !salesEndAt)
      || (salesStartAt && salesEndAt && new Date(salesEndAt) <= new Date(salesStartAt))) {
      return NextResponse.json({ error: 'Enter a valid tier name, price, allocation, order limit and sale window.' }, { status: 400 });
    }

    const { data: updatedType, error: updateError } = await database.rpc('ticketing_update_ticket_type', {
      p_event_id: eventId,
      p_ticket_type_id: ticketTypeId,
      p_name: name,
      p_description: description,
      p_price_minor: priceMinor,
      p_capacity: capacity,
      p_min_per_order: minPerOrder,
      p_max_per_order: maxPerOrder,
      p_sales_start_at: salesStartAt,
      p_sales_end_at: salesEndAt,
      p_benefits: benefits,
      p_actor_email: session?.email || ''
    });
    if (updateError || !updatedType) {
      if (updateError?.code === 'P0001') return NextResponse.json({ error: updateError.message }, { status: 409 });
      if (updateError?.code === 'P0002') return NextResponse.json({ error: 'The selected event or ticket tier was not found.' }, { status: 404 });
      if (updateError?.code === '22023') return NextResponse.json({ error: 'The ticket tier details are invalid.' }, { status: 400 });
      console.error('[TicketingAdmin] Could not update ticket tier:', updateError);
      return NextResponse.json({ error: 'The ticket tier could not be updated.' }, { status: 503 });
    }
    return NextResponse.json({ ticketType: updatedType });
  }

  return NextResponse.json({ error: 'Choose a supported ticketing action.' }, { status: 400 });
}
