import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/adminAccess.server';
import { createServerSupabaseClient } from '@/lib/serverSupabase';
import { consumeTicketingRateLimit } from '@/lib/ticketing/rateLimit.server';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QuoteEvent = {
  id: string;
  status: string;
  service_fee_minor: number | string;
};

type QuoteTier = {
  id: string;
  event_id: string;
  name: string;
  price_minor: number | string;
  currency: string;
  min_per_order: number;
  max_per_order: number;
  status: string;
  sales_start_at: string | null;
  sales_end_at: string | null;
};

type QuotePromotion = {
  id: string;
  discount_type: 'fixed' | 'percentage';
  discount_value: number | string;
  currency: string;
  max_redemptions: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin pricing requests are required.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid ticket quote is required.' }, { status: 400 });
  }
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const ticketTypeId = typeof body.ticketTypeId === 'string' ? body.ticketTypeId : '';
  const quantity = Number(body.quantity);
  const code = typeof body.promotionCode === 'string' ? body.promotionCode.trim().toUpperCase() : '';
  if (!uuidPattern.test(eventId) || !uuidPattern.test(ticketTypeId)
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20
    || (code && !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))) {
    return NextResponse.json({ error: 'Choose a valid ticket quantity and discount code.' }, { status: 400 });
  }

  try {
    if (!await consumeTicketingRateLimit(request, 'checkout_quote', 20, 300)) {
      return NextResponse.json({ error: 'Too many pricing requests. Please wait a few minutes and try again.' }, { status: 429 });
    }
  } catch (cause) {
    console.error('[TicketingQuote] Could not apply quote rate limit:', cause);
    return NextResponse.json({ error: 'Pricing is temporarily unavailable.' }, { status: 503 });
  }

  const database = createServerSupabaseClient();
  if (!database) return NextResponse.json({ error: 'Ticketing storage is not configured.' }, { status: 503 });

  const [eventResult, tierResult] = await Promise.all([
    database.from('ticketing_events')
      .select('id,status,service_fee_minor')
      .eq('id', eventId)
      .maybeSingle(),
    database.from('ticketing_ticket_types')
      .select('id,event_id,name,price_minor,currency,min_per_order,max_per_order,status,sales_start_at,sales_end_at')
      .eq('id', ticketTypeId)
      .eq('event_id', eventId)
      .maybeSingle()
  ]);
  if (eventResult.error || tierResult.error) {
    console.error('[TicketingQuote] Could not load event pricing:', eventResult.error || tierResult.error);
    return NextResponse.json({ error: 'Pricing is temporarily unavailable.' }, { status: 503 });
  }
  const event = eventResult.data as unknown as QuoteEvent | null;
  const tier = tierResult.data as unknown as QuoteTier | null;
  const now = Date.now();
  if (!event || !tier || event.status !== 'on_sale' || tier.status !== 'active'
    || tier.currency.trim() !== 'KES' || Number(tier.price_minor) <= 0
    || quantity < tier.min_per_order || quantity > tier.max_per_order
    || (tier.sales_start_at && new Date(tier.sales_start_at).getTime() > now)
    || (tier.sales_end_at && new Date(tier.sales_end_at).getTime() <= now)) {
    return NextResponse.json({ error: 'This ticket option or quantity is no longer available.' }, { status: 409 });
  }

  const subtotalMinor = Number(tier.price_minor) * quantity;
  const feesMinor = Number(event.service_fee_minor) * quantity;
  let discountMinor = 0;
  if (code) {
    const { data: promotionData, error: promotionError } = await database.from('ticketing_promotions')
      .select('id,discount_type,discount_value,currency,max_redemptions,starts_at,ends_at,active')
      .eq('event_id', eventId)
      .eq('code', code)
      .maybeSingle();
    if (promotionError) {
      console.error('[TicketingQuote] Could not load promotion:', promotionError);
      return NextResponse.json({ error: 'Discounts are temporarily unavailable.' }, { status: 503 });
    }
    const promotion = promotionData as unknown as QuotePromotion | null;
    if (!promotion || !promotion.active || promotion.currency.trim() !== 'KES'
      || (promotion.starts_at && new Date(promotion.starts_at).getTime() > now)
      || (promotion.ends_at && new Date(promotion.ends_at).getTime() <= now)) {
      return NextResponse.json({ error: 'That discount code is invalid or unavailable.' }, { status: 400 });
    }
    if (promotion.max_redemptions !== null) {
      const { data: redemptionCount, error: redemptionError } = await database.rpc('ticketing_count_promotion_redemptions', {
        p_promotion_id: promotion.id
      });
      if (redemptionError || !Number.isSafeInteger(Number(redemptionCount))) {
        console.error('[TicketingQuote] Could not count promotion redemptions:', redemptionError);
        return NextResponse.json({ error: 'Discount availability could not be checked.' }, { status: 503 });
      }
      if (Number(redemptionCount) >= promotion.max_redemptions) {
        return NextResponse.json({ error: 'That discount code has reached its redemption limit.' }, { status: 400 });
      }
    }
    discountMinor = promotion.discount_type === 'percentage'
      ? Math.floor(subtotalMinor * Number(promotion.discount_value) / 100)
      : Math.min(subtotalMinor, Number(promotion.discount_value));
  }

  return NextResponse.json({
    eventId,
    ticketTypeId,
    quantity,
    promotionCode: code,
    subtotalMinor,
    feesMinor,
    discountMinor,
    totalMinor: subtotalMinor + feesMinor - discountMinor
  }, { headers: { 'Cache-Control': 'no-store' } });
}
