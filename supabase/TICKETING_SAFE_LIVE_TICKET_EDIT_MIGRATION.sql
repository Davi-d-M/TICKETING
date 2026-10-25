BEGIN;

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
    v_committed BIGINT;
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled', 'on_sale') THEN
        RAISE EXCEPTION 'Ticket tiers can only be edited while the event is draft, scheduled or on sale.' USING ERRCODE = 'P0001';
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
        OR p_min_per_order IS NULL OR p_min_per_order < 1 OR p_min_per_order > p_capacity
        OR p_max_per_order IS NULL OR p_max_per_order < p_min_per_order OR p_max_per_order > 100
        OR (p_sales_start_at IS NOT NULL AND p_sales_end_at IS NOT NULL AND p_sales_end_at <= p_sales_start_at)
        OR NOT public.ticketing_valid_benefits(p_benefits) THEN
        RAISE EXCEPTION 'Ticket tier details are invalid.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.ticketing_reservations
        WHERE ticket_type_id = p_ticket_type_id
          AND status = 'reserved'
          AND expires_at > now()
    ) AND (
        p_price_minor IS DISTINCT FROM v_type.price_minor
        OR p_capacity IS DISTINCT FROM v_type.capacity
        OR p_min_per_order IS DISTINCT FROM v_type.min_per_order
        OR p_max_per_order IS DISTINCT FROM v_type.max_per_order
        OR p_sales_start_at IS DISTINCT FROM v_type.sales_start_at
        OR p_sales_end_at IS DISTINCT FROM v_type.sales_end_at
    ) THEN
        RAISE EXCEPTION 'Wait for active ticket reservations to expire before changing price, allocation or sale rules.' USING ERRCODE = 'P0001';
    END IF;

    SELECT
        (SELECT count(*)::BIGINT
         FROM public.ticketing_tickets AS tickets
         JOIN public.ticketing_order_items AS items ON items.id = tickets.order_item_id
         WHERE items.ticket_type_id = p_ticket_type_id
           AND tickets.status IN ('issued', 'checked_in'))
        +
        (SELECT COALESCE(sum(quantity), 0)::BIGINT
         FROM public.ticketing_reservations
         WHERE ticket_type_id = p_ticket_type_id
           AND status = 'reserved'
           AND expires_at > now())
    INTO v_committed;
    IF p_capacity < v_committed THEN
        RAISE EXCEPTION 'Allocation cannot be lower than issued tickets plus active reservations.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived' AND id <> p_ticket_type_id;
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'The ticket allocation exceeds the event capacity.' USING ERRCODE = '23514';
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
        COALESCE(p_actor_email, ''), 'ticket_type.updated', 'ticket_type',
        p_ticket_type_id::TEXT, v_old_state, to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_update_event_wave(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_wave_label TEXT,
    p_price_minor BIGINT,
    p_capacity INTEGER,
    p_min_per_order SMALLINT,
    p_max_per_order SMALLINT,
    p_activation_mode TEXT,
    p_wave_theme TEXT,
    p_sales_start_at TIMESTAMPTZ,
    p_sales_end_at TIMESTAMPTZ,
    p_description TEXT,
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
    v_committed BIGINT;
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled', 'on_sale') THEN
        RAISE EXCEPTION 'Ticket waves can only be edited while the event is draft, scheduled or on sale.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id
      AND wave_number IS NOT NULL AND status <> 'archived'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket wave was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF p_wave_label IS NULL OR length(trim(p_wave_label)) NOT BETWEEN 2 AND 100
        OR p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 99999999999
        OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 1000000
        OR p_min_per_order IS NULL OR p_min_per_order < 1 OR p_min_per_order > p_capacity
        OR p_max_per_order IS NULL OR p_max_per_order < p_min_per_order OR p_max_per_order > 100
        OR p_activation_mode IS NULL OR p_activation_mode NOT IN ('scheduled', 'previous_sold_out', 'manual')
        OR p_wave_theme IS NULL OR p_wave_theme NOT IN ('obsidian-gold', 'crimson-black', 'electric-violet')
        OR (p_activation_mode = 'scheduled' AND p_sales_start_at IS NULL)
        OR (v_type.wave_number = 1 AND p_activation_mode = 'previous_sold_out')
        OR (v_type.wave_number > 1 AND p_activation_mode = 'previous_sold_out'
            AND NOT EXISTS (
                SELECT 1 FROM public.ticketing_ticket_types
                WHERE event_id = p_event_id
                  AND lower(trim(admission_type)) = lower(trim(v_type.admission_type))
                  AND wave_number = v_type.wave_number - 1
                  AND status <> 'archived'
            ))
        OR (p_sales_end_at IS NOT NULL AND p_sales_start_at IS NOT NULL AND p_sales_end_at <= p_sales_start_at)
        OR p_description IS NULL OR length(p_description) > 2000
        OR NOT public.ticketing_valid_benefits(p_benefits) THEN
        RAISE EXCEPTION 'Ticket wave details are invalid.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.ticketing_reservations
        WHERE ticket_type_id = p_ticket_type_id
          AND status = 'reserved'
          AND expires_at > now()
    ) AND (
        p_price_minor IS DISTINCT FROM v_type.price_minor
        OR p_capacity IS DISTINCT FROM v_type.capacity
        OR p_min_per_order IS DISTINCT FROM v_type.min_per_order
        OR p_max_per_order IS DISTINCT FROM v_type.max_per_order
        OR p_activation_mode IS DISTINCT FROM v_type.activation_mode
        OR p_sales_start_at IS DISTINCT FROM v_type.sales_start_at
        OR p_sales_end_at IS DISTINCT FROM v_type.sales_end_at
    ) THEN
        RAISE EXCEPTION 'Wait for active ticket reservations to expire before changing price, allocation or sale rules.' USING ERRCODE = 'P0001';
    END IF;

    SELECT
        (SELECT count(*)::BIGINT
         FROM public.ticketing_tickets AS tickets
         JOIN public.ticketing_order_items AS items ON items.id = tickets.order_item_id
         WHERE items.ticket_type_id = p_ticket_type_id
           AND tickets.status IN ('issued', 'checked_in'))
        +
        (SELECT COALESCE(sum(quantity), 0)::BIGINT
         FROM public.ticketing_reservations
         WHERE ticket_type_id = p_ticket_type_id
           AND status = 'reserved'
           AND expires_at > now())
    INTO v_committed;
    IF p_capacity < v_committed THEN
        RAISE EXCEPTION 'Allocation cannot be lower than issued tickets plus active reservations.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived' AND id <> p_ticket_type_id;
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'Wave allocation exceeds event capacity.' USING ERRCODE = '23514';
    END IF;

    v_old_state := to_jsonb(v_type);
    UPDATE public.ticketing_ticket_types
    SET wave_label = trim(p_wave_label),
        price_minor = p_price_minor,
        capacity = p_capacity,
        min_per_order = p_min_per_order,
        max_per_order = p_max_per_order,
        activation_mode = p_activation_mode,
        wave_theme = p_wave_theme,
        sales_start_at = p_sales_start_at,
        sales_end_at = p_sales_end_at,
        description = trim(p_description),
        benefits = p_benefits,
        wave_manual_open = CASE WHEN p_activation_mode = 'manual' THEN wave_manual_open ELSE FALSE END,
        updated_at = now()
    WHERE id = p_ticket_type_id
    RETURNING * INTO v_type;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'ticket_wave.updated', 'ticket_type',
        v_type.id::TEXT, v_old_state, to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

DROP FUNCTION IF EXISTS public.ticketing_start_checkout(
    UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.ticketing_start_checkout(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_quantity INTEGER,
    p_buyer_email TEXT,
    p_buyer_name TEXT,
    p_idempotency_key TEXT,
    p_paystack_reference TEXT,
    p_promotion_code TEXT,
    p_expected_total_minor BIGINT
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
        OR length(trim(COALESCE(p_promotion_code, ''))) > 40
        OR p_expected_total_minor IS NULL OR p_expected_total_minor < 1 THEN
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
    WHERE id = p_event_id
    FOR SHARE;
    IF NOT FOUND OR v_event.status <> 'on_sale' THEN
        RAISE EXCEPTION 'Event is not on sale.' USING ERRCODE = 'P0002';
    END IF;

    v_reservation := public.ticketing_reserve_inventory(
        p_event_id, p_ticket_type_id, p_quantity, p_buyer_email,
        COALESCE(p_buyer_name, ''), p_idempotency_key
    );
    v_reservation_id := (v_reservation ->> 'reservation_id')::UUID;

    -- Inventory reservation locks the ticket type; refresh terms before writing the order snapshot.
    SELECT * INTO v_ticket_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND status = 'active';
    IF NOT FOUND OR v_ticket_type.currency <> 'KES' OR v_ticket_type.price_minor <= 0 THEN
        RAISE EXCEPTION 'Ticket type is not available for checkout.' USING ERRCODE = 'P0002';
    END IF;

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

        IF v_subtotal_minor + v_fees_minor - v_discount_minor <> p_expected_total_minor THEN
            RAISE EXCEPTION 'Ticket pricing changed. Refresh the price and confirm the total before checkout.' USING ERRCODE = 'P0001';
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

REVOKE ALL ON FUNCTION public.ticketing_update_ticket_type(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_ticket_type(UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_event_wave(UUID, UUID, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_event_wave(UUID, UUID, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
    TO service_role;

COMMIT;
