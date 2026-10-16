-- Event arrival details, service fees and server-verified promo pricing.
-- Apply after TICKETING_COMMERCE_MIGRATION.sql.

BEGIN;

ALTER TABLE public.ticketing_events
    ADD COLUMN IF NOT EXISTS venue_maps_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS venue_latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS venue_longitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS entrance_instructions TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS parking_details TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS transport_guidance TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS dress_code TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS service_fee_minor BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_venue_maps_url_length') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_venue_maps_url_length CHECK (length(venue_maps_url) <= 1000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_entrance_instructions_length') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_entrance_instructions_length CHECK (length(entrance_instructions) <= 2000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_parking_details_length') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_parking_details_length CHECK (length(parking_details) <= 2000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_transport_guidance_length') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_transport_guidance_length CHECK (length(transport_guidance) <= 3000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_dress_code_length') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_dress_code_length CHECK (length(dress_code) <= 500);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_service_fee_nonnegative') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_service_fee_nonnegative CHECK (service_fee_minor >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_coordinates_pair') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_coordinates_pair CHECK ((venue_latitude IS NULL) = (venue_longitude IS NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_latitude_range') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_latitude_range CHECK (venue_latitude IS NULL OR venue_latitude BETWEEN -90 AND 90);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticketing_events'::regclass AND conname = 'ticketing_events_longitude_range') THEN
        ALTER TABLE public.ticketing_events ADD CONSTRAINT ticketing_events_longitude_range CHECK (venue_longitude IS NULL OR venue_longitude BETWEEN -180 AND 180);
    END IF;
END;
$$;

ALTER TABLE public.ticketing_orders
    ADD COLUMN IF NOT EXISTS promotion_id UUID
        REFERENCES public.ticketing_promotions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ticketing_orders_promotion_idx
    ON public.ticketing_orders (promotion_id, status, created_at DESC)
    WHERE promotion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ticketing_count_promotion_redemptions(p_promotion_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT count(*)::INTEGER
    FROM public.ticketing_orders AS orders
    LEFT JOIN public.ticketing_reservations AS reservations
        ON reservations.id = orders.reservation_id
    WHERE orders.promotion_id = p_promotion_id
        AND (
            orders.status = 'paid'
            OR (
                orders.status IN ('pending_payment', 'payment_processing')
                AND reservations.status = 'reserved'
                AND reservations.expires_at > now()
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.ticketing_valid_benefits(p_benefits JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_benefit JSONB;
BEGIN
    IF p_benefits IS NULL OR jsonb_typeof(p_benefits) <> 'array' THEN
        RETURN false;
    END IF;
    IF jsonb_array_length(p_benefits) > 20 THEN
        RETURN false;
    END IF;
    FOR v_benefit IN
        SELECT value FROM jsonb_array_elements(p_benefits) AS benefits(value)
    LOOP
        IF jsonb_typeof(v_benefit) <> 'string'
            OR length(v_benefit #>> '{}') > 200 THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_set_event_status(
    p_event_id UUID,
    p_status TEXT,
    p_actor_email TEXT
)
RETURNS public.ticketing_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
    v_active_tiers INTEGER;
    v_old_status TEXT;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('scheduled', 'on_sale', 'cancelled') THEN
        RAISE EXCEPTION 'Unsupported event status.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    v_old_status := v_event.status;
    IF p_status = 'on_sale' THEN
        IF v_event.status NOT IN ('draft', 'scheduled', 'on_sale') THEN
            RAISE EXCEPTION 'This event state cannot be opened for sales.' USING ERRCODE = 'P0001';
        END IF;
        SELECT count(*)::INTEGER INTO v_active_tiers
        FROM public.ticketing_ticket_types
        WHERE event_id = p_event_id AND status = 'active' AND price_minor > 0;
        IF v_active_tiers = 0 OR v_event.starts_at <= now() OR v_event.ends_at <= now() THEN
            RAISE EXCEPTION 'Add a paid ticket tier and future event dates before opening sales.' USING ERRCODE = 'P0001';
        END IF;
        IF v_event.venue_maps_url = ''
            AND v_event.venue_latitude IS NULL
            AND (v_event.venue_address = '' OR v_event.city = '') THEN
            RAISE EXCEPTION 'Add a verified Google Maps link, venue coordinates, or full venue address before opening sales.' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    IF p_status = 'scheduled' AND v_event.status IN ('cancelled', 'postponed', 'completed') THEN
        RAISE EXCEPTION 'This event state cannot be scheduled again.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.ticketing_events
    SET status = p_status,
        published_at = CASE WHEN p_status = 'on_sale' THEN COALESCE(published_at, now()) ELSE published_at END,
        updated_at = now()
    WHERE id = p_event_id
    RETURNING * INTO v_event;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'event.status_changed', 'event', p_event_id::TEXT,
        jsonb_build_object('status', v_old_status),
        jsonb_build_object('status', v_event.status)
    );
    RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_update_event_service_fee(
    p_event_id UUID,
    p_service_fee_minor BIGINT,
    p_actor_email TEXT,
    p_allow_on_sale BOOLEAN
)
RETURNS public.ticketing_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
    v_old_fee BIGINT;
BEGIN
    IF p_service_fee_minor IS NULL OR p_service_fee_minor NOT BETWEEN 0 AND 100000000 THEN
        RAISE EXCEPTION 'The service fee is outside the allowed range.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled', 'on_sale') THEN
        RAISE EXCEPTION 'Service fees cannot be changed for this event.' USING ERRCODE = 'P0001';
    END IF;
    IF v_event.status = 'on_sale' AND NOT COALESCE(p_allow_on_sale, false) THEN
        RAISE EXCEPTION 'Only the platform owner can change a service fee while sales are open.' USING ERRCODE = '42501';
    END IF;

    v_old_fee := v_event.service_fee_minor;
    UPDATE public.ticketing_events
    SET service_fee_minor = p_service_fee_minor,
        updated_at = now()
    WHERE id = p_event_id
    RETURNING * INTO v_event;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'event.service_fee_changed', 'event', p_event_id::TEXT,
        jsonb_build_object('service_fee_minor', v_old_fee),
        jsonb_build_object('service_fee_minor', v_event.service_fee_minor)
    );
    RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_update_event_experience(
    p_event_id UUID,
    p_venue_name TEXT,
    p_venue_address TEXT,
    p_city TEXT,
    p_venue_maps_url TEXT,
    p_venue_latitude NUMERIC,
    p_venue_longitude NUMERIC,
    p_entrance_instructions TEXT,
    p_parking_details TEXT,
    p_transport_guidance TEXT,
    p_dress_code TEXT,
    p_service_fee_minor BIGINT,
    p_capacity INTEGER,
    p_actor_email TEXT
)
RETURNS public.ticketing_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
    v_old_state JSONB;
    v_allocated BIGINT;
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'Event details and service fees are locked after ticket sales open.' USING ERRCODE = 'P0001';
    END IF;
    IF p_venue_name IS NULL OR length(trim(p_venue_name)) NOT BETWEEN 2 AND 180
        OR p_venue_address IS NULL OR length(trim(p_venue_address)) > 500
        OR p_city IS NULL OR length(trim(p_city)) NOT BETWEEN 2 AND 100
        OR p_venue_maps_url IS NULL OR length(p_venue_maps_url) > 1000
        OR (p_venue_latitude IS NULL) <> (p_venue_longitude IS NULL)
        OR p_entrance_instructions IS NULL OR length(p_entrance_instructions) > 2000
        OR p_parking_details IS NULL OR length(p_parking_details) > 2000
        OR p_transport_guidance IS NULL OR length(p_transport_guidance) > 3000
        OR p_dress_code IS NULL OR length(p_dress_code) > 500
        OR p_service_fee_minor IS NULL OR p_service_fee_minor NOT BETWEEN 0 AND 100000000
        OR (p_capacity IS NOT NULL AND p_capacity NOT BETWEEN 1 AND 1000000) THEN
        RAISE EXCEPTION 'Event details are invalid.' USING ERRCODE = '22023';
    END IF;

    IF p_service_fee_minor <> v_event.service_fee_minor
        AND EXISTS (SELECT 1 FROM public.ticketing_orders WHERE event_id = p_event_id) THEN
        RAISE EXCEPTION 'The service fee is locked because this event already has ticket orders.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived';
    IF p_capacity IS NOT NULL AND v_allocated > p_capacity THEN
        RAISE EXCEPTION 'Event capacity cannot be lower than the ticket-tier allocations.' USING ERRCODE = 'P0001';
    END IF;

    v_old_state := jsonb_build_object(
        'venue_name', v_event.venue_name,
        'venue_address', v_event.venue_address,
        'city', v_event.city,
        'venue_maps_url', v_event.venue_maps_url,
        'venue_latitude', v_event.venue_latitude,
        'venue_longitude', v_event.venue_longitude,
        'entrance_instructions', v_event.entrance_instructions,
        'parking_details', v_event.parking_details,
        'transport_guidance', v_event.transport_guidance,
        'dress_code', v_event.dress_code,
        'service_fee_minor', v_event.service_fee_minor,
        'capacity', v_event.capacity
    );
    UPDATE public.ticketing_events
    SET venue_name = trim(p_venue_name),
        venue_address = trim(p_venue_address),
        city = trim(p_city),
        venue_maps_url = p_venue_maps_url,
        venue_latitude = p_venue_latitude,
        venue_longitude = p_venue_longitude,
        entrance_instructions = trim(p_entrance_instructions),
        parking_details = trim(p_parking_details),
        transport_guidance = trim(p_transport_guidance),
        dress_code = trim(p_dress_code),
        service_fee_minor = p_service_fee_minor,
        capacity = p_capacity,
        updated_at = now()
    WHERE id = p_event_id
    RETURNING * INTO v_event;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'event.experience_updated', 'event', p_event_id::TEXT,
        v_old_state,
        jsonb_build_object(
            'venue_name', v_event.venue_name,
            'venue_address', v_event.venue_address,
            'city', v_event.city,
            'venue_maps_url', v_event.venue_maps_url,
            'venue_latitude', v_event.venue_latitude,
            'venue_longitude', v_event.venue_longitude,
            'entrance_instructions', v_event.entrance_instructions,
            'parking_details', v_event.parking_details,
            'transport_guidance', v_event.transport_guidance,
            'dress_code', v_event.dress_code,
            'service_fee_minor', v_event.service_fee_minor,
            'capacity', v_event.capacity
        )
    );
    RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_update_ticket_type(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_price_minor BIGINT,
    p_capacity INTEGER,
    p_min_per_order SMALLINT,
    p_max_per_order SMALLINT,
    p_sales_start_at TIMESTAMPTZ,
    p_sales_end_at TIMESTAMPTZ,
    p_benefits JSONB,
    p_actor_email TEXT
)
RETURNS public.ticketing_ticket_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_old_state JSONB;
    v_allocated BIGINT;
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'Ticket tiers are locked after ticket sales open.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND status <> 'archived'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket tier was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100
        OR p_description IS NULL OR length(p_description) > 2000
        OR p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 99999999999
        OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 1000000
        OR p_min_per_order IS NULL OR p_min_per_order < 1
        OR p_max_per_order IS NULL OR p_max_per_order < p_min_per_order OR p_max_per_order > 100
        OR (p_sales_start_at IS NOT NULL AND p_sales_end_at IS NOT NULL AND p_sales_end_at <= p_sales_start_at)
        OR NOT public.ticketing_valid_benefits(p_benefits) THEN
        RAISE EXCEPTION 'Ticket tier details are invalid.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticketing_order_items WHERE ticket_type_id = p_ticket_type_id) THEN
        RAISE EXCEPTION 'This tier has order history and its terms are locked to protect existing purchases.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived' AND id <> p_ticket_type_id;
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'The ticket allocation exceeds the event capacity.' USING ERRCODE = 'P0001';
    END IF;

    v_old_state := to_jsonb(v_type);
    UPDATE public.ticketing_ticket_types
    SET name = trim(p_name),
        description = trim(p_description),
        price_minor = p_price_minor,
        capacity = p_capacity,
        min_per_order = p_min_per_order,
        max_per_order = p_max_per_order,
        sales_start_at = p_sales_start_at,
        sales_end_at = p_sales_end_at,
        benefits = p_benefits,
        updated_at = now()
    WHERE id = p_ticket_type_id
    RETURNING * INTO v_type;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'ticket_type.updated', 'ticket_type', p_ticket_type_id::TEXT,
        v_old_state, to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_create_ticket_type_with_benefits(
    p_event_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_price_minor BIGINT,
    p_capacity INTEGER,
    p_min_per_order SMALLINT,
    p_max_per_order SMALLINT,
    p_sales_start_at TIMESTAMPTZ,
    p_sales_end_at TIMESTAMPTZ,
    p_benefits JSONB,
    p_actor_email TEXT
)
RETURNS public.ticketing_ticket_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_allocated BIGINT;
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'Ticket tiers can only be changed while an event is draft or scheduled.' USING ERRCODE = 'P0001';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100
        OR p_description IS NULL OR length(p_description) > 2000
        OR p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 99999999999
        OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 1000000
        OR p_min_per_order IS NULL OR p_min_per_order < 1
        OR p_max_per_order IS NULL OR p_max_per_order < p_min_per_order OR p_max_per_order > 100
        OR (p_sales_start_at IS NOT NULL AND p_sales_end_at IS NOT NULL AND p_sales_end_at <= p_sales_start_at)
        OR NOT public.ticketing_valid_benefits(p_benefits) THEN
        RAISE EXCEPTION 'Ticket tier details are invalid.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived';
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'Tier allocation exceeds event capacity.' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.ticketing_ticket_types (
        event_id, name, description, price_minor, capacity,
        min_per_order, max_per_order, sales_start_at, sales_end_at, benefits
    ) VALUES (
        p_event_id, trim(p_name), trim(p_description), p_price_minor, p_capacity,
        p_min_per_order, p_max_per_order, p_sales_start_at, p_sales_end_at, p_benefits
    ) RETURNING * INTO v_type;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'ticket_type.created', 'ticket_type', v_type.id::TEXT,
        to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_start_checkout(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_quantity INTEGER,
    p_buyer_email TEXT,
    p_buyer_name TEXT,
    p_idempotency_key TEXT,
    p_paystack_reference TEXT,
    p_promotion_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reservation JSONB;
    v_reservation_id UUID;
    v_reservation_row public.ticketing_reservations%ROWTYPE;
    v_order public.ticketing_orders%ROWTYPE;
    v_attempt public.ticketing_payment_attempts%ROWTYPE;
    v_ticket_type public.ticketing_ticket_types%ROWTYPE;
    v_event public.ticketing_events%ROWTYPE;
    v_promotion public.ticketing_promotions%ROWTYPE;
    v_promotion_code TEXT;
    v_redemption_count INTEGER;
    v_subtotal_minor BIGINT;
    v_fees_minor BIGINT;
    v_discount_minor BIGINT := 0;
    v_promotion_id UUID;
BEGIN
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 100
        OR p_paystack_reference IS NULL OR p_paystack_reference !~ '^OBT_[A-Za-z0-9_-]{20,100}$'
        OR p_buyer_email IS NULL OR length(trim(p_buyer_email)) > 320
        OR lower(trim(p_buyer_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(trim(COALESCE(p_buyer_name, ''))) > 160
        OR length(trim(COALESCE(p_promotion_code, ''))) > 40 THEN
        RAISE EXCEPTION 'Invalid checkout details.' USING ERRCODE = '22023';
    END IF;

    v_promotion_code := NULLIF(upper(trim(COALESCE(p_promotion_code, ''))), '');

    SELECT * INTO v_ticket_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND status = 'active';
    IF NOT FOUND OR v_ticket_type.currency <> 'KES' OR v_ticket_type.price_minor <= 0 THEN
        RAISE EXCEPTION 'Ticket type is not available for checkout.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id;
    IF NOT FOUND OR v_event.status <> 'on_sale' THEN
        RAISE EXCEPTION 'Event is not on sale.' USING ERRCODE = 'P0002';
    END IF;

    v_reservation := public.ticketing_reserve_inventory(
        p_event_id, p_ticket_type_id, p_quantity, p_buyer_email,
        COALESCE(p_buyer_name, ''), p_idempotency_key
    );
    v_reservation_id := (v_reservation ->> 'reservation_id')::UUID;

    SELECT * INTO v_reservation_row
    FROM public.ticketing_reservations
    WHERE id = v_reservation_id
    FOR UPDATE;
    IF v_reservation_row.status <> 'reserved' OR v_reservation_row.expires_at <= now() THEN
        RAISE EXCEPTION 'The ticket reservation expired. Please start checkout again.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_order
    FROM public.ticketing_orders
    WHERE reservation_id = v_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        IF v_promotion_code IS NOT NULL THEN
            SELECT * INTO v_promotion
            FROM public.ticketing_promotions
            WHERE event_id = p_event_id AND code = v_promotion_code
            FOR UPDATE;
            IF NOT FOUND OR NOT v_promotion.active
                OR v_promotion.currency <> 'KES'
                OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at > now())
                OR (v_promotion.ends_at IS NOT NULL AND v_promotion.ends_at <= now()) THEN
                RAISE EXCEPTION 'Promotion code is not valid or is no longer available.' USING ERRCODE = 'P0001';
            END IF;

            IF v_promotion.max_redemptions IS NOT NULL THEN
                SELECT count(*)::INTEGER INTO v_redemption_count
                FROM public.ticketing_orders AS orders
                LEFT JOIN public.ticketing_reservations AS reservations
                    ON reservations.id = orders.reservation_id
                WHERE orders.promotion_id = v_promotion.id
                    AND (
                        orders.status = 'paid'
                        OR (
                            orders.status IN ('pending_payment', 'payment_processing')
                            AND reservations.status = 'reserved'
                            AND reservations.expires_at > now()
                        )
                    );
                IF v_redemption_count >= v_promotion.max_redemptions THEN
                    RAISE EXCEPTION 'Promotion code is not valid or is no longer available.' USING ERRCODE = 'P0001';
                END IF;
            END IF;

            v_promotion_id := v_promotion.id;
        END IF;

        v_subtotal_minor := v_ticket_type.price_minor * p_quantity;
        v_fees_minor := v_event.service_fee_minor * p_quantity;
        IF v_promotion_id IS NOT NULL THEN
            IF v_promotion.discount_type = 'percentage' THEN
                v_discount_minor := floor(v_subtotal_minor::NUMERIC * v_promotion.discount_value / 100)::BIGINT;
            ELSE
                v_discount_minor := least(v_subtotal_minor, v_promotion.discount_value);
            END IF;
        END IF;

        INSERT INTO public.ticketing_orders (
            event_id, reservation_id, buyer_email, buyer_name, currency,
            subtotal_minor, fees_minor, discount_minor, total_minor, promotion_id, status
        ) VALUES (
            p_event_id, v_reservation_id, lower(trim(p_buyer_email)),
            left(trim(COALESCE(p_buyer_name, '')), 160), 'KES',
            v_subtotal_minor, v_fees_minor, v_discount_minor,
            v_subtotal_minor + v_fees_minor - v_discount_minor, v_promotion_id, 'pending_payment'
        ) RETURNING * INTO v_order;

        INSERT INTO public.ticketing_order_items (
            order_id, ticket_type_id, ticket_name_snapshot, quantity,
            unit_price_minor, line_total_minor
        ) VALUES (
            v_order.id, p_ticket_type_id, v_ticket_type.name, p_quantity,
            v_ticket_type.price_minor, v_ticket_type.price_minor * p_quantity
        );

        INSERT INTO public.ticketing_payment_attempts (
            order_id, provider, provider_reference, idempotency_key,
            amount_minor, currency, status
        ) VALUES (
            v_order.id, 'paystack', p_paystack_reference, p_idempotency_key,
            v_order.total_minor, v_order.currency, 'pending'
        ) RETURNING * INTO v_attempt;
    ELSE
        IF v_promotion_code IS NULL AND v_order.promotion_id IS NOT NULL
            OR v_promotion_code IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.ticketing_promotions
                WHERE id = v_order.promotion_id AND code = v_promotion_code
            ) THEN
            RAISE EXCEPTION 'This checkout was already started with different pricing details.' USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_attempt
        FROM public.ticketing_payment_attempts
        WHERE order_id = v_order.id AND provider = 'paystack'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND OR v_attempt.status NOT IN ('pending', 'unknown') THEN
            RAISE EXCEPTION 'This checkout cannot be resumed. Start a new checkout.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_reference', v_order.reference,
        'amount_minor', v_order.total_minor,
        'subtotal_minor', v_order.subtotal_minor,
        'fees_minor', v_order.fees_minor,
        'discount_minor', v_order.discount_minor,
        'currency', v_order.currency,
        'buyer_email', v_order.buyer_email,
        'buyer_name', v_order.buyer_name,
        'payment_reference', v_attempt.provider_reference,
        'checkout_url', v_attempt.checkout_url,
        'expires_at', v_reservation_row.expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_set_event_status(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_event_status(UUID, TEXT, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_event_service_fee(UUID, BIGINT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_event_service_fee(UUID, BIGINT, TEXT, BOOLEAN)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_valid_benefits(JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_valid_benefits(JSONB)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_count_promotion_redemptions(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_count_promotion_redemptions(UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_event_experience(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_event_experience(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, INTEGER, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_ticket_type(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_ticket_type(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_ticket_type_with_benefits(UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_ticket_type_with_benefits(UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
