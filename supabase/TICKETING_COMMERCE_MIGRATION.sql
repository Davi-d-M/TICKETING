-- Paystack checkout, atomic ticket issuance, and email-based guest ticket access.
-- Apply after TICKETING_CORE_MIGRATION.sql and before enabling customer sales.

BEGIN;

ALTER TABLE public.ticketing_payment_attempts
    ADD COLUMN IF NOT EXISTS checkout_url TEXT;

ALTER TABLE public.ticketing_tickets
    ADD COLUMN IF NOT EXISTS credential_ciphertext TEXT;

CREATE TABLE IF NOT EXISTS public.ticketing_guest_access_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.ticketing_orders(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_guest_access_links_order_idx
    ON public.ticketing_guest_access_links (order_id, created_at DESC);

ALTER TABLE public.ticketing_checkins
    DROP CONSTRAINT IF EXISTS ticketing_checkins_result_check;
ALTER TABLE public.ticketing_checkins
    ADD CONSTRAINT ticketing_checkins_result_check
    CHECK (result IN ('accepted', 'already_used', 'invalid', 'refunded', 'revoked', 'wrong_event', 'event_unavailable'));

CREATE OR REPLACE FUNCTION public.ticketing_check_in(
    p_event_id UUID,
    p_credential_hash TEXT,
    p_gate_name TEXT DEFAULT '',
    p_staff_user_id UUID DEFAULT NULL,
    p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_event public.ticketing_events%ROWTYPE;
    v_result TEXT;
BEGIN
    IF p_event_id IS NULL OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid ticket credential.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket event was not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_event.status NOT IN ('scheduled', 'on_sale', 'sold_out')
        OR now() < COALESCE(v_event.doors_open_at, v_event.starts_at)
        OR now() >= v_event.ends_at THEN
        v_result := 'event_unavailable';
    ELSE
        SELECT * INTO v_ticket
        FROM public.ticketing_tickets
        WHERE credential_hash = p_credential_hash
        FOR UPDATE;

        IF NOT FOUND THEN
            v_result := 'invalid';
        ELSIF v_ticket.event_id <> p_event_id THEN
            v_result := 'wrong_event';
        ELSIF v_ticket.status = 'checked_in' THEN
            v_result := 'already_used';
        ELSIF v_ticket.status = 'refunded' THEN
            v_result := 'refunded';
        ELSIF v_ticket.status IN ('revoked', 'transferred') THEN
            v_result := 'revoked';
        ELSE
            v_result := 'accepted';
            UPDATE public.ticketing_tickets
            SET status = 'checked_in', checked_in_at = now()
            WHERE id = v_ticket.id;
        END IF;
    END IF;

    INSERT INTO public.ticketing_checkins (
        event_id, ticket_id, credential_hash, gate_name, staff_user_id, device_id, result
    ) VALUES (
        p_event_id, v_ticket.id, p_credential_hash, left(trim(COALESCE(p_gate_name, '')), 120),
        p_staff_user_id, p_device_id, v_result
    );

    RETURN jsonb_build_object(
        'result', v_result,
        'ticket_reference', CASE WHEN v_result IN ('accepted', 'already_used') THEN v_ticket.ticket_reference ELSE NULL END,
        'ticket_id', CASE WHEN v_result IN ('accepted', 'already_used') THEN v_ticket.id ELSE NULL END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_start_checkout(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_quantity INTEGER,
    p_buyer_email TEXT,
    p_buyer_name TEXT,
    p_idempotency_key TEXT,
    p_paystack_reference TEXT
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
BEGIN
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 100
        OR p_paystack_reference IS NULL OR p_paystack_reference !~ '^OBT_[A-Za-z0-9_-]{20,100}$'
        OR p_buyer_email IS NULL OR length(trim(p_buyer_email)) > 320
        OR lower(trim(p_buyer_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(trim(COALESCE(p_buyer_name, ''))) > 160 THEN
        RAISE EXCEPTION 'Invalid checkout details.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_ticket_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND status = 'active';
    IF NOT FOUND OR v_ticket_type.currency <> 'KES' OR v_ticket_type.price_minor <= 0 THEN
        RAISE EXCEPTION 'Ticket type is not available for checkout.' USING ERRCODE = 'P0002';
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
        INSERT INTO public.ticketing_orders (
            event_id, reservation_id, buyer_email, buyer_name, currency,
            subtotal_minor, fees_minor, discount_minor, total_minor, status
        ) VALUES (
            p_event_id, v_reservation_id, lower(trim(p_buyer_email)),
            left(trim(COALESCE(p_buyer_name, '')), 160), 'KES',
            v_ticket_type.price_minor * p_quantity, 0, 0,
            v_ticket_type.price_minor * p_quantity, 'pending_payment'
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
        'currency', v_order.currency,
        'buyer_email', v_order.buyer_email,
        'buyer_name', v_order.buyer_name,
        'payment_reference', v_attempt.provider_reference,
        'checkout_url', v_attempt.checkout_url,
        'expires_at', v_reservation_row.expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_confirm_paystack(
    p_provider_reference TEXT,
    p_provider_event_id TEXT,
    p_verified_amount_minor BIGINT,
    p_verified_currency TEXT,
    p_credentials JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.ticketing_payment_attempts%ROWTYPE;
    v_order public.ticketing_orders%ROWTYPE;
    v_reservation public.ticketing_reservations%ROWTYPE;
    v_event_id UUID;
    v_expected_count INTEGER;
    v_event_row public.ticketing_payment_webhook_events%ROWTYPE;
    v_ticket JSONB;
BEGIN
    IF p_provider_reference IS NULL OR p_provider_reference !~ '^OBT_[A-Za-z0-9_-]{20,100}$'
        OR p_provider_event_id IS NULL OR length(p_provider_event_id) > 160
        OR p_verified_amount_minor IS NULL OR p_verified_amount_minor < 0
        OR p_verified_currency <> 'KES'
        OR jsonb_typeof(p_credentials) <> 'array' THEN
        RAISE EXCEPTION 'Invalid verified payment details.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.ticketing_payment_webhook_events (
        provider, provider_event_id, signature_valid, processing_status
    ) VALUES ('paystack', p_provider_event_id, true, 'received')
    ON CONFLICT (provider, provider_event_id) DO NOTHING;

    SELECT * INTO v_event_row
    FROM public.ticketing_payment_webhook_events
    WHERE provider = 'paystack' AND provider_event_id = p_provider_event_id
    FOR UPDATE;

    IF v_event_row.processing_status = 'processed' THEN
        RETURN jsonb_build_object('status', 'already_processed');
    END IF;

    SELECT * INTO v_attempt
    FROM public.ticketing_payment_attempts
    WHERE provider = 'paystack' AND provider_reference = p_provider_reference
    FOR UPDATE;
    IF NOT FOUND THEN
        UPDATE public.ticketing_payment_webhook_events
        SET processing_status = 'rejected', outcome = 'unknown_reference', processed_at = now()
        WHERE id = v_event_row.id;
        RAISE EXCEPTION 'No matching Paystack payment attempt.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_order
    FROM public.ticketing_orders
    WHERE id = v_attempt.order_id
    FOR UPDATE;

    IF v_attempt.amount_minor <> p_verified_amount_minor
        OR v_order.total_minor <> p_verified_amount_minor
        OR v_attempt.currency <> p_verified_currency
        OR v_order.currency <> p_verified_currency THEN
        UPDATE public.ticketing_orders SET status = 'reconciliation_required', updated_at = now()
        WHERE id = v_order.id AND status <> 'paid';
        UPDATE public.ticketing_payment_attempts SET status = 'reconciliation_required', updated_at = now()
        WHERE id = v_attempt.id AND status <> 'succeeded';
        UPDATE public.ticketing_payment_webhook_events
        SET processing_status = 'rejected', outcome = 'amount_or_currency_mismatch', processed_at = now()
        WHERE id = v_event_row.id;
        RETURN jsonb_build_object('status', 'reconciliation_required');
    END IF;

    IF v_order.status = 'paid' THEN
        UPDATE public.ticketing_payment_webhook_events
        SET processing_status = 'processed', outcome = 'already_paid', processed_at = now()
        WHERE id = v_event_row.id;
        RETURN jsonb_build_object('status', 'already_paid', 'order_reference', v_order.reference);
    END IF;

    SELECT * INTO v_reservation
    FROM public.ticketing_reservations
    WHERE id = v_order.reservation_id
    FOR UPDATE;
    IF v_order.status NOT IN ('pending_payment', 'payment_processing')
        OR v_reservation.status <> 'reserved'
        OR v_reservation.expires_at <= now() THEN
        UPDATE public.ticketing_orders SET status = 'reconciliation_required', updated_at = now()
        WHERE id = v_order.id;
        UPDATE public.ticketing_payment_attempts SET status = 'reconciliation_required', updated_at = now()
        WHERE id = v_attempt.id;
        UPDATE public.ticketing_payment_webhook_events
        SET processing_status = 'retry_required', outcome = 'reservation_expired_or_unavailable', processed_at = now()
        WHERE id = v_event_row.id;
        RETURN jsonb_build_object('status', 'reconciliation_required', 'order_reference', v_order.reference);
    END IF;

    SELECT event_id INTO v_event_id FROM public.ticketing_ticket_types
    WHERE id = (SELECT ticket_type_id FROM public.ticketing_order_items WHERE order_id = v_order.id LIMIT 1);
    SELECT COALESCE(sum(quantity), 0)::INTEGER INTO v_expected_count
    FROM public.ticketing_order_items WHERE order_id = v_order.id;
    IF jsonb_array_length(p_credentials) <> v_expected_count THEN
        RAISE EXCEPTION 'Ticket credential count does not match the paid order.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.ticketing_orders
    SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = v_order.id;
    UPDATE public.ticketing_payment_attempts
    SET status = 'succeeded', verified_at = now(), updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.ticketing_reservations
    SET status = 'converted', updated_at = now()
    WHERE id = v_reservation.id;

    FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_credentials)
    LOOP
        IF COALESCE(v_ticket ->> 'credential_hash', '') !~ '^[0-9a-f]{64}$'
            OR COALESCE(v_ticket ->> 'credential_ciphertext', '') = '' THEN
            RAISE EXCEPTION 'Invalid ticket credential.' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticketing_tickets (
            event_id, order_item_id, attendee_name, attendee_email,
            credential_hash, credential_ciphertext
        )
        SELECT
            v_event_id, items.id, v_order.buyer_name, v_order.buyer_email,
            v_ticket ->> 'credential_hash', v_ticket ->> 'credential_ciphertext'
        FROM public.ticketing_order_items AS items
        WHERE items.order_id = v_order.id
        ORDER BY items.created_at
        LIMIT 1;
    END LOOP;

    UPDATE public.ticketing_payment_webhook_events
    SET processing_status = 'processed', outcome = 'payment_confirmed', processed_at = now()
    WHERE id = v_event_row.id;

    RETURN jsonb_build_object('status', 'paid', 'order_reference', v_order.reference, 'order_id', v_order.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_create_guest_access_link(
    p_order_reference TEXT,
    p_email TEXT,
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.ticketing_orders%ROWTYPE;
    v_recent_links INTEGER;
BEGIN
    IF p_order_reference IS NULL OR length(p_order_reference) > 80
        OR p_email IS NULL OR length(trim(p_email)) > 320
        OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid guest ticket access request.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE reference = p_order_reference
      AND lower(buyer_email) = lower(trim(p_email))
      AND status = 'paid'
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('created', false);
    END IF;

    SELECT count(*)::INTEGER INTO v_recent_links
    FROM public.ticketing_guest_access_links
    WHERE order_id = v_order.id AND created_at > now() - INTERVAL '1 hour';
    IF v_recent_links >= 5 THEN
        RETURN jsonb_build_object('created', false, 'rate_limited', true);
    END IF;

    INSERT INTO public.ticketing_guest_access_links (order_id, token_hash, expires_at)
    VALUES (v_order.id, p_token_hash, now() + INTERVAL '30 minutes');

    RETURN jsonb_build_object('created', true, 'order_id', v_order.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_claim_guest_access_link(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link public.ticketing_guest_access_links%ROWTYPE;
    v_order public.ticketing_orders%ROWTYPE;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_link
    FROM public.ticketing_guest_access_links
    WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE id = v_link.order_id AND status = 'paid';
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    UPDATE public.ticketing_guest_access_links SET used_at = now() WHERE id = v_link.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'buyer_email', v_order.buyer_email);
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

ALTER TABLE public.ticketing_guest_access_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_guest_access_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ticketing_guest_access_links TO service_role;

REVOKE ALL ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_start_checkout(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_confirm_paystack(TEXT, TEXT, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_confirm_paystack(TEXT, TEXT, BIGINT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_guest_access_link(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_guest_access_link(TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_claim_guest_access_link(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_claim_guest_access_link(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_set_event_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_event_status(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;

COMMIT;
