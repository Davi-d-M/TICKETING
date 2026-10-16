-- Isolated Midnight Society KE ticketing schema. Existing commerce tables are untouched.
-- Apply once to the shared Supabase project before opening the Admin module.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticketing_organizers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'suspended')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.ticketing_organizers (name, slug, status)
VALUES ('MIDNIGHT SOCIETY KE', 'midnight-society-ke', 'approved')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ticketing_organizer_members (
    organizer_id UUID NOT NULL REFERENCES public.ticketing_organizers(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'finance', 'support', 'gate_staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organizer_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.ticketing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id UUID NOT NULL REFERENCES public.ticketing_organizers(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
    venue_name TEXT NOT NULL CHECK (length(trim(venue_name)) BETWEEN 2 AND 180),
    venue_address TEXT NOT NULL DEFAULT '' CHECK (length(venue_address) <= 500),
    city TEXT NOT NULL CHECK (length(trim(city)) BETWEEN 2 AND 100),
    timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    doors_open_at TIMESTAMPTZ,
    age_limit SMALLINT CHECK (age_limit IS NULL OR age_limit BETWEEN 0 AND 120),
    capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'on_sale', 'sold_out', 'postponed', 'cancelled', 'completed')),
    cancellation_policy TEXT NOT NULL DEFAULT '' CHECK (length(cancellation_policy) <= 5000),
    cover_image_url TEXT,
    published_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (doors_open_at IS NULL OR doors_open_at <= starts_at)
);

CREATE INDEX IF NOT EXISTS ticketing_events_public_idx
    ON public.ticketing_events (status, starts_at)
    WHERE status IN ('scheduled', 'on_sale', 'sold_out');
CREATE INDEX IF NOT EXISTS ticketing_events_organizer_idx
    ON public.ticketing_events (organizer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticketing_ticket_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    min_per_order SMALLINT NOT NULL DEFAULT 1 CHECK (min_per_order > 0),
    max_per_order SMALLINT NOT NULL DEFAULT 10 CHECK (max_per_order >= min_per_order),
    sales_start_at TIMESTAMPTZ,
    sales_end_at TIMESTAMPTZ,
    benefits JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(benefits) = 'array'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sales_end_at IS NULL OR sales_start_at IS NULL OR sales_end_at > sales_start_at)
);

CREATE INDEX IF NOT EXISTS ticketing_ticket_types_event_idx
    ON public.ticketing_ticket_types (event_id, status);

CREATE TABLE IF NOT EXISTS public.ticketing_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type_id UUID NOT NULL REFERENCES public.ticketing_ticket_types(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    idempotency_key TEXT UNIQUE,
    quantity SMALLINT NOT NULL CHECK (quantity > 0),
    buyer_email TEXT NOT NULL CHECK (length(trim(buyer_email)) <= 320),
    buyer_name TEXT NOT NULL DEFAULT '' CHECK (length(buyer_name) <= 160),
    status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'converted', 'expired', 'released', 'reconciliation_required')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_reservations_active_idx
    ON public.ticketing_reservations (ticket_type_id, expires_at)
    WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS public.ticketing_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    reservation_id UUID UNIQUE REFERENCES public.ticketing_reservations(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    buyer_email TEXT NOT NULL CHECK (length(trim(buyer_email)) <= 320),
    buyer_name TEXT NOT NULL DEFAULT '' CHECK (length(buyer_name) <= 160),
    reference TEXT NOT NULL UNIQUE DEFAULT ('OBT-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12))),
    currency CHAR(3) NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
    fees_minor BIGINT NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
    discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
    status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('pending_payment', 'payment_processing', 'paid', 'payment_failed', 'expired', 'refund_pending', 'partially_refunded', 'refunded', 'cancelled', 'reconciliation_required')),
    source TEXT NOT NULL DEFAULT 'direct',
    campaign TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (total_minor = subtotal_minor + fees_minor - discount_minor)
);

CREATE INDEX IF NOT EXISTS ticketing_orders_event_idx
    ON public.ticketing_orders (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticketing_orders_customer_idx
    ON public.ticketing_orders (customer_id, created_at DESC)
    WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticketing_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.ticketing_orders(id) ON DELETE RESTRICT,
    ticket_type_id UUID NOT NULL REFERENCES public.ticketing_ticket_types(id) ON DELETE RESTRICT,
    ticket_name_snapshot TEXT NOT NULL,
    quantity SMALLINT NOT NULL CHECK (quantity > 0),
    unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    line_total_minor BIGINT NOT NULL CHECK (line_total_minor = quantity * unit_price_minor),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticketing_payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.ticketing_orders(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK (provider IN ('daraja', 'paystack', 'complimentary', 'manual')),
    provider_reference TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'unknown', 'reconciliation_required')),
    provider_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_reference)
);

CREATE TABLE IF NOT EXISTS public.ticketing_payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT false,
    processing_status TEXT NOT NULL DEFAULT 'received'
        CHECK (processing_status IN ('received', 'processed', 'rejected', 'retry_required')),
    outcome TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.ticketing_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    order_item_id UUID NOT NULL REFERENCES public.ticketing_order_items(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    attendee_name TEXT NOT NULL DEFAULT '' CHECK (length(attendee_name) <= 160),
    attendee_email TEXT NOT NULL CHECK (length(trim(attendee_email)) <= 320),
    ticket_reference TEXT NOT NULL UNIQUE DEFAULT ('OBT-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12))),
    credential_hash TEXT NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'checked_in', 'refunded', 'revoked', 'transferred')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_in_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_tickets_event_status_idx
    ON public.ticketing_tickets (event_id, status);
CREATE INDEX IF NOT EXISTS ticketing_tickets_customer_idx
    ON public.ticketing_tickets (customer_id, created_at DESC)
    WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticketing_staff_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('event_manager', 'box_office', 'finance', 'support', 'gate_staff')),
    gate_name TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS public.ticketing_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    ticket_id UUID REFERENCES public.ticketing_tickets(id) ON DELETE RESTRICT,
    credential_hash TEXT NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
    gate_name TEXT NOT NULL DEFAULT '' CHECK (length(gate_name) <= 120),
    staff_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    device_id TEXT,
    result TEXT NOT NULL CHECK (result IN ('accepted', 'already_used', 'invalid', 'refunded', 'revoked', 'wrong_event')),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ticketing_checkins_one_admission_idx
    ON public.ticketing_checkins (ticket_id)
    WHERE result = 'accepted';
CREATE INDEX IF NOT EXISTS ticketing_checkins_event_time_idx
    ON public.ticketing_checkins (event_id, scanned_at DESC);

CREATE TABLE IF NOT EXISTS public.ticketing_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.ticketing_orders(id) ON DELETE RESTRICT,
    payment_attempt_id UUID REFERENCES public.ticketing_payment_attempts(id) ON DELETE RESTRICT,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'processing', 'succeeded', 'failed', 'reconciliation_required', 'rejected')),
    provider_reference TEXT,
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticketing_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed', 'percentage')),
    discount_value BIGINT NOT NULL CHECK (discount_value > 0),
    currency CHAR(3) NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, code),
    CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);

CREATE TABLE IF NOT EXISTS public.ticketing_notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.ticketing_orders(id) ON DELETE RESTRICT,
    ticket_id UUID REFERENCES public.ticketing_tickets(id) ON DELETE RESTRICT,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'in_app')),
    event_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled')),
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_notification_jobs_ready_idx
    ON public.ticketing_notification_jobs (next_attempt_at, created_at)
    WHERE status IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS public.ticketing_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT,
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_audit_entity_idx
    ON public.ticketing_audit_logs (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ticketing_create_event(
    p_organizer_id UUID,
    p_title TEXT,
    p_slug TEXT,
    p_description TEXT,
    p_venue_name TEXT,
    p_venue_address TEXT,
    p_city TEXT,
    p_starts_at TIMESTAMPTZ,
    p_ends_at TIMESTAMPTZ,
    p_doors_open_at TIMESTAMPTZ,
    p_age_limit SMALLINT,
    p_capacity INTEGER,
    p_cancellation_policy TEXT,
    p_actor_email TEXT
)
RETURNS public.ticketing_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.ticketing_events%ROWTYPE;
BEGIN
    INSERT INTO public.ticketing_events (
        organizer_id, title, slug, description, venue_name, venue_address, city,
        starts_at, ends_at, doors_open_at, age_limit, capacity, cancellation_policy
    ) VALUES (
        p_organizer_id, trim(p_title), p_slug, COALESCE(p_description, ''),
        trim(p_venue_name), COALESCE(p_venue_address, ''), trim(p_city),
        p_starts_at, p_ends_at, p_doors_open_at, p_age_limit, p_capacity,
        COALESCE(p_cancellation_policy, '')
    ) RETURNING * INTO v_event;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'event.created', 'event', v_event.id::TEXT,
        jsonb_build_object('title', v_event.title, 'status', v_event.status, 'slug', v_event.slug)
    );
    RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_create_ticket_type(
    p_event_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_price_minor BIGINT,
    p_capacity INTEGER,
    p_min_per_order SMALLINT,
    p_max_per_order SMALLINT,
    p_sales_start_at TIMESTAMPTZ,
    p_sales_end_at TIMESTAMPTZ,
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

    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived';
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'Tier allocation exceeds event capacity.' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.ticketing_ticket_types (
        event_id, name, description, price_minor, capacity, min_per_order,
        max_per_order, sales_start_at, sales_end_at
    ) VALUES (
        p_event_id, trim(p_name), COALESCE(p_description, ''), p_price_minor,
        p_capacity, p_min_per_order, p_max_per_order, p_sales_start_at, p_sales_end_at
    ) RETURNING * INTO v_type;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'ticket_type.created', 'ticket_type', v_type.id::TEXT,
        jsonb_build_object(
            'event_id', p_event_id, 'name', v_type.name,
            'price_minor', v_type.price_minor, 'capacity', v_type.capacity
        )
    );
    RETURN v_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_reserve_inventory(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_quantity INTEGER,
    p_buyer_email TEXT,
    p_buyer_name TEXT DEFAULT '',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_event public.ticketing_events%ROWTYPE;
    v_reservation public.ticketing_reservations%ROWTYPE;
    v_reserved INTEGER;
    v_sold INTEGER;
BEGIN
    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 20
        OR p_buyer_email IS NULL OR length(trim(p_buyer_email)) NOT BETWEEN 3 AND 320 THEN
        RAISE EXCEPTION 'Invalid reservation details.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id
    FOR UPDATE;
    IF NOT FOUND OR v_type.status <> 'active' THEN
        RAISE EXCEPTION 'Ticket type is not available.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id;
    IF NOT FOUND OR v_event.status <> 'on_sale' THEN
        RAISE EXCEPTION 'Event is not on sale.' USING ERRCODE = 'P0002';
    END IF;
    IF (v_type.sales_start_at IS NOT NULL AND now() < v_type.sales_start_at)
        OR (v_type.sales_end_at IS NOT NULL AND now() >= v_type.sales_end_at) THEN
        RAISE EXCEPTION 'Ticket sales are outside the sale window.' USING ERRCODE = 'P0002';
    END IF;
    IF p_quantity < v_type.min_per_order OR p_quantity > v_type.max_per_order THEN
        RAISE EXCEPTION 'Quantity is outside the per-order limit.' USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_reservation
        FROM public.ticketing_reservations
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            IF v_reservation.ticket_type_id <> p_ticket_type_id
                OR v_reservation.quantity <> p_quantity
                OR lower(v_reservation.buyer_email) <> lower(trim(p_buyer_email)) THEN
                RAISE EXCEPTION 'Idempotency key was already used for different reservation details.' USING ERRCODE = '23505';
            END IF;
            RETURN jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'expires_at', v_reservation.expires_at);
        END IF;
    END IF;

    UPDATE public.ticketing_reservations
    SET status = 'expired', updated_at = now()
    WHERE ticket_type_id = p_ticket_type_id
        AND status = 'reserved'
        AND expires_at <= now();

    SELECT COALESCE(sum(quantity), 0)::INTEGER INTO v_reserved
    FROM public.ticketing_reservations
    WHERE ticket_type_id = p_ticket_type_id
        AND status = 'reserved'
        AND expires_at > now();

    SELECT count(*)::INTEGER INTO v_sold
    FROM public.ticketing_tickets AS tickets
    JOIN public.ticketing_order_items AS items ON items.id = tickets.order_item_id
    WHERE items.ticket_type_id = p_ticket_type_id
        AND tickets.status IN ('issued', 'checked_in');

    IF v_sold + v_reserved + p_quantity > v_type.capacity THEN
        RAISE EXCEPTION 'Not enough tickets remain.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.ticketing_reservations (
        ticket_type_id, event_id, idempotency_key, quantity, buyer_email, buyer_name, expires_at
    ) VALUES (
        p_ticket_type_id, p_event_id, p_idempotency_key, p_quantity, lower(trim(p_buyer_email)),
        left(trim(COALESCE(p_buyer_name, '')), 160), now() + INTERVAL '15 minutes'
    ) RETURNING * INTO v_reservation;

    RETURN jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'expires_at', v_reservation.expires_at);
END;
$$;

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
    v_result TEXT;
BEGIN
    IF p_event_id IS NULL OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid ticket credential.' USING ERRCODE = '22023';
    END IF;

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
    ELSIF v_ticket.status = 'revoked' OR v_ticket.status = 'transferred' THEN
        v_result := 'revoked';
    ELSE
        v_result := 'accepted';
        UPDATE public.ticketing_tickets
        SET status = 'checked_in', checked_in_at = now()
        WHERE id = v_ticket.id;
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

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'ticketing_organizers', 'ticketing_organizer_members', 'ticketing_events',
        'ticketing_ticket_types', 'ticketing_reservations', 'ticketing_orders',
        'ticketing_order_items', 'ticketing_payment_attempts', 'ticketing_payment_webhook_events',
        'ticketing_tickets', 'ticketing_staff_assignments', 'ticketing_checkins',
        'ticketing_refunds', 'ticketing_promotions', 'ticketing_notification_jobs',
        'ticketing_audit_logs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
    END LOOP;
END;
$$;

GRANT USAGE, SELECT ON SEQUENCE public.ticketing_audit_logs_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_reserve_inventory(UUID, UUID, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_reserve_inventory(UUID, UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT, INTEGER, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_ticket_type(UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_ticket_type(UUID, TEXT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;

COMMIT;
