import 'server-only';

import { createServerSupabaseClient } from '@/lib/serverSupabase';

export type PublicTicketType = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  min_per_order: number;
  max_per_order: number;
  capacity: number;
  remaining: number;
  benefits: string[];
  sales_start_at: string | null;
  sales_end_at: string | null;
  wave_number: number | null;
  admission_type: string;
  wave_label: string;
  activation_mode: 'scheduled' | 'previous_sold_out' | 'manual';
  wave_theme: 'obsidian-gold' | 'crimson-black' | 'electric-violet';
  wave_manual_open: boolean;
  wave_open: boolean;
};

export type PublicTicketEvent = {
  id: string;
  title: string;
  slug: string;
  description: string;
  venue_name: string;
  venue_address: string;
  city: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  doors_open_at: string | null;
  age_limit: number | null;
  cover_image_url: string | null;
  venue_maps_url: string;
  venue_latitude: number | null;
  venue_longitude: number | null;
  entrance_instructions: string;
  parking_details: string;
  transport_guidance: string;
  dress_code: string;
  service_fee_minor: number;
  cancellation_policy: string;
  ticket_types: PublicTicketType[];
};

type PublicEventRow = Omit<PublicTicketEvent, 'ticket_types'> & { organizer_id: string };

type PublicEventsResult =
  | { ok: true; events: PublicTicketEvent[] }
  | { ok: false; message: string };

const eventFields = [
  'id', 'organizer_id', 'title', 'slug', 'description', 'venue_name', 'venue_address',
  'city', 'timezone', 'starts_at', 'ends_at', 'doors_open_at', 'age_limit',
  'cover_image_url', 'venue_maps_url', 'venue_latitude', 'venue_longitude',
  'entrance_instructions', 'parking_details', 'transport_guidance', 'dress_code',
  'service_fee_minor', 'cancellation_policy'
].join(',');

const tierFields = [
  'id', 'event_id', 'name', 'description', 'price_minor', 'currency',
  'min_per_order', 'max_per_order', 'capacity', 'benefits', 'sales_start_at', 'sales_end_at',
  'wave_number', 'admission_type', 'wave_label', 'activation_mode', 'wave_theme', 'wave_manual_open'
].join(',');

function isMissingTicketingSchema(error: { code?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205';
}

async function getPublicEvents(): Promise<PublicEventsResult> {
  const database = createServerSupabaseClient();
  if (!database) {
    return { ok: false, message: 'Ticket listings are temporarily unavailable. Please check back soon.' };
  }

  const organizerResult = await database.from('ticketing_organizers')
    .select('id')
    .eq('status', 'approved')
    .limit(100);
  if (organizerResult.error) {
    if (!isMissingTicketingSchema(organizerResult.error)) {
      console.error('[PublicTicketing] Could not load approved organizers:', organizerResult.error);
    }
    return {
      ok: false,
      message: isMissingTicketingSchema(organizerResult.error)
        ? 'Ticket listings are being prepared. Please check back soon.'
        : 'Ticket listings could not be loaded right now. Please try again later.'
    };
  }

  if (!organizerResult.data?.length) return { ok: true, events: [] };
  const organizerIds = organizerResult.data.map(organizer => organizer.id);
  const eventResult = await database.from('ticketing_events')
    .select(eventFields)
    .in('organizer_id', organizerIds)
    .eq('status', 'on_sale')
    .order('starts_at', { ascending: true })
    .limit(50);
  if (eventResult.error) {
    if (!isMissingTicketingSchema(eventResult.error)) {
      console.error('[PublicTicketing] Could not load events on sale:', eventResult.error);
    }
    return {
      ok: false,
      message: isMissingTicketingSchema(eventResult.error)
        ? 'Ticket listings are being prepared. Please check back soon.'
        : 'Ticket listings could not be loaded right now. Please try again later.'
    };
  }

  const rows = (eventResult.data || []) as unknown as PublicEventRow[];
  if (!rows.length) return { ok: true, events: [] };

  const ticketTypesResult = await database.from('ticketing_ticket_types')
    .select(tierFields)
    .in('event_id', rows.map(event => event.id))
    .eq('status', 'active')
    .order('price_minor', { ascending: true });
  if (ticketTypesResult.error) {
    if (isMissingTicketingSchema(ticketTypesResult.error)) {
      return { ok: false, message: 'Apply supabase/TICKETING_WAVES_MIGRATION.sql to load ticket release waves.' };
    }
    console.error('[PublicTicketing] Could not load active ticket tiers:', ticketTypesResult.error);
    return { ok: false, message: 'Ticket options could not be loaded right now. Please try again later.' };
  }

  const ticketTypes = (ticketTypesResult.data || []) as unknown as PublicTicketType[];
  const ticketTypeIds = ticketTypes.map(ticketType => ticketType.id);
  const [reservationsResult, orderItemsResult] = await Promise.all([
    database.from('ticketing_reservations')
      .select('ticket_type_id,quantity')
      .in('ticket_type_id', ticketTypeIds)
      .eq('status', 'reserved')
      .gt('expires_at', new Date().toISOString()),
    database.from('ticketing_order_items')
      .select('id,ticket_type_id')
      .in('ticket_type_id', ticketTypeIds)
  ]);
  if (reservationsResult.error || orderItemsResult.error) {
    const error = reservationsResult.error || orderItemsResult.error;
    console.error('[PublicTicketing] Could not load ticket availability:', error);
    return { ok: false, message: 'Ticket availability could not be loaded right now. Please try again later.' };
  }

  const orderItems = (orderItemsResult.data || []) as unknown as Array<{ id: string; ticket_type_id: string }>;
  const itemIds = orderItems.map(item => item.id);
  const soldTicketsResult = itemIds.length
    ? await database.from('ticketing_tickets')
      .select('order_item_id')
      .in('order_item_id', itemIds)
      .in('status', ['issued', 'checked_in'])
    : { data: [], error: null };
  if (soldTicketsResult.error) {
    console.error('[PublicTicketing] Could not load issued ticket counts:', soldTicketsResult.error);
    return { ok: false, message: 'Ticket availability could not be loaded right now. Please try again later.' };
  }

  const reservationsByType = new Map<string, number>();
  const reservations = (reservationsResult.data || []) as unknown as Array<{ ticket_type_id: string; quantity: number }>;
  for (const reservation of reservations) {
    reservationsByType.set(reservation.ticket_type_id, (reservationsByType.get(reservation.ticket_type_id) || 0) + Number(reservation.quantity));
  }
  const itemTypeById = new Map(orderItems.map(item => [item.id, item.ticket_type_id]));
  const soldByType = new Map<string, number>();
  const soldTickets = (soldTicketsResult.data || []) as unknown as Array<{ order_item_id: string }>;
  for (const ticket of soldTickets) {
    const ticketTypeId = itemTypeById.get(ticket.order_item_id);
    if (ticketTypeId) soldByType.set(ticketTypeId, (soldByType.get(ticketTypeId) || 0) + 1);
  }

  const typesByEvent = new Map<string, PublicTicketType[]>();
  const ticketTypesWithRemaining = ticketTypes.map(ticketType => {
    const remaining = Math.max(0, ticketType.capacity
      - (reservationsByType.get(ticketType.id) || 0)
      - (soldByType.get(ticketType.id) || 0));
    return { ...ticketType, remaining };
  });
  const typesById = new Map(ticketTypesWithRemaining.map(ticketType => [ticketType.id, ticketType]));
  const now = Date.now();
  for (const ticketType of ticketTypes) {
    const typeWithRemaining = typesById.get(ticketType.id);
    if (!typeWithRemaining) continue;
    let waveOpen = true;
    if (ticketType.wave_number !== null) {
      if (ticketType.activation_mode === 'manual') {
        waveOpen = ticketType.wave_manual_open;
      } else if (ticketType.activation_mode === 'scheduled') {
        waveOpen = Boolean(ticketType.sales_start_at && new Date(ticketType.sales_start_at).getTime() <= now);
      } else {
        const previousWave = ticketTypesWithRemaining.find(candidate =>
          candidate.event_id === ticketType.event_id
          && candidate.admission_type === ticketType.admission_type
          && candidate.wave_number === ticketType.wave_number! - 1);
        waveOpen = Boolean(previousWave && (
          previousWave.remaining <= 0
          || (previousWave.sales_end_at && new Date(previousWave.sales_end_at).getTime() <= now)
        ));
      }
      waveOpen = waveOpen
        && (!ticketType.sales_start_at || new Date(ticketType.sales_start_at).getTime() <= now)
        && (!ticketType.sales_end_at || new Date(ticketType.sales_end_at).getTime() > now);
    }
    typesByEvent.set(ticketType.event_id, [
      ...(typesByEvent.get(ticketType.event_id) || []),
      { ...typeWithRemaining, wave_open: waveOpen }
    ]);
  }

  const events = rows
    .map(event => ({
      id: event.id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      venue_name: event.venue_name,
      venue_address: event.venue_address,
      city: event.city,
      timezone: event.timezone,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      doors_open_at: event.doors_open_at,
      age_limit: event.age_limit,
      cover_image_url: event.cover_image_url,
      venue_maps_url: event.venue_maps_url,
      venue_latitude: event.venue_latitude,
      venue_longitude: event.venue_longitude,
      entrance_instructions: event.entrance_instructions,
      parking_details: event.parking_details,
      transport_guidance: event.transport_guidance,
      dress_code: event.dress_code,
      service_fee_minor: Number(event.service_fee_minor) || 0,
      cancellation_policy: event.cancellation_policy,
      ticket_types: typesByEvent.get(event.id) || []
    }))
    .filter(event => event.ticket_types.length > 0 && new Date(event.ends_at).getTime() > now);

  return { ok: true, events };
}

export async function getPublicTicketEvents() {
  return getPublicEvents();
}

export async function getPublicTicketEvent(slug: string) {
  const result = await getPublicEvents();
  if (!result.ok) return result;
  return { ok: true as const, event: result.events.find(event => event.slug === slug) || null };
}
