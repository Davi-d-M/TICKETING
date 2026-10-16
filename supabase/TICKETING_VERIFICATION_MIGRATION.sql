-- Server-backed public ticket verification, assigned gate access and idempotent admission.
-- Apply after the core, commerce, security and live-operations migrations.

BEGIN;

UPDATE public.ticketing_organizers
SET name = 'MIDNIGHT SOCIETY KE',
    slug = 'midnight-society-ke'
WHERE slug = 'online-bar';

ALTER TABLE public.ticketing_checkins
    ADD COLUMN IF NOT EXISTS request_id UUID,
    ADD COLUMN IF NOT EXISTS staff_email TEXT,
    ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'first_entry'
        CHECK (entry_type = 'first_entry');

ALTER TABLE public.ticketing_tickets
    ALTER COLUMN ticket_reference SET DEFAULT (
        'OBT-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 24))
    );

ALTER TABLE public.ticketing_checkins
    DROP CONSTRAINT IF EXISTS ticketing_checkins_result_check;
ALTER TABLE public.ticketing_checkins
    ADD CONSTRAINT ticketing_checkins_result_check
    CHECK (result IN (
        'accepted', 'already_used', 'invalid', 'refunded', 'revoked',
        'wrong_event', 'event_unavailable', 'not_admissible'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS ticketing_checkins_request_id_idx
    ON public.ticketing_checkins (request_id)
    WHERE request_id IS NOT NULL;

DROP TRIGGER IF EXISTS ticketing_checkins_append_only
    ON public.ticketing_checkins;
CREATE TRIGGER ticketing_checkins_append_only
    BEFORE UPDATE OR DELETE ON public.ticketing_checkins
    FOR EACH ROW EXECUTE FUNCTION public.ticketing_reject_live_event_mutation();

CREATE TABLE IF NOT EXISTS public.ticketing_gate_staff_accounts (
    email TEXT PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 320),
    password_salt TEXT NOT NULL CHECK (length(password_salt) BETWEEN 20 AND 64),
    password_hash TEXT NOT NULL CHECK (length(password_hash) = 128),
    active BOOLEAN NOT NULL DEFAULT true,
    created_by_email TEXT NOT NULL CHECK (length(created_by_email) <= 320),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ticketing_gate_staff_assignments (
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    email TEXT NOT NULL REFERENCES public.ticketing_gate_staff_accounts(email) ON DELETE RESTRICT,
    gate_name TEXT NOT NULL DEFAULT 'Main gate' CHECK (length(gate_name) BETWEEN 1 AND 120),
    active BOOLEAN NOT NULL DEFAULT true,
    assigned_by_email TEXT NOT NULL CHECK (length(assigned_by_email) <= 320),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, email)
);

CREATE INDEX IF NOT EXISTS ticketing_gate_staff_assignments_email_idx
    ON public.ticketing_gate_staff_assignments (email, event_id)
    WHERE active = true;

CREATE TABLE IF NOT EXISTS public.ticketing_rate_limit_windows (
    bucket_hash TEXT PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticketing_guest_access_links
    ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES public.ticketing_tickets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS email TEXT;
UPDATE public.ticketing_guest_access_links AS links
SET email = orders.buyer_email
FROM public.ticketing_orders AS orders
WHERE links.order_id = orders.id AND links.email IS NULL;
ALTER TABLE public.ticketing_guest_access_links
    ALTER COLUMN email SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticketing_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.ticketing_tickets(id) ON DELETE RESTRICT,
    replacement_ticket_id UUID REFERENCES public.ticketing_tickets(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES public.ticketing_orders(id) ON DELETE RESTRICT,
    event_id UUID NOT NULL REFERENCES public.ticketing_events(id) ON DELETE RESTRICT,
    from_email TEXT NOT NULL CHECK (length(from_email) <= 320),
    to_email TEXT NOT NULL CHECK (length(to_email) <= 320),
    to_name TEXT NOT NULL DEFAULT '' CHECK (length(to_name) <= 160),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by_email TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (lower(from_email) <> lower(to_email))
);

CREATE UNIQUE INDEX IF NOT EXISTS ticketing_transfers_one_pending_per_ticket_idx
    ON public.ticketing_transfers (ticket_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ticketing_transfers_pending_idx
    ON public.ticketing_transfers (requested_at DESC)
    WHERE status = 'pending';

ALTER TABLE public.ticketing_live_events
    DROP CONSTRAINT IF EXISTS ticketing_live_events_source_table_check;
ALTER TABLE public.ticketing_live_events
    ADD CONSTRAINT ticketing_live_events_source_table_check
    CHECK (source_table IN (
        'ticketing_events', 'ticketing_ticket_types', 'ticketing_reservations',
        'ticketing_orders', 'ticketing_payment_attempts', 'ticketing_payment_webhook_events',
        'ticketing_tickets', 'ticketing_checkins', 'ticketing_refunds', 'ticketing_transfers'
    ));

DROP TRIGGER IF EXISTS ticketing_transfers_live_operation
    ON public.ticketing_transfers;
CREATE TRIGGER ticketing_transfers_live_operation
    AFTER INSERT OR UPDATE OR DELETE ON public.ticketing_transfers
    FOR EACH ROW EXECUTE FUNCTION public.ticketing_record_live_operation();

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
    IF NOT FOUND THEN RETURN jsonb_build_object('created', false); END IF;
    SELECT count(*)::INTEGER INTO v_recent_links
    FROM public.ticketing_guest_access_links
    WHERE order_id = v_order.id AND created_at > now() - INTERVAL '1 hour';
    IF v_recent_links >= 5 THEN
        RETURN jsonb_build_object('created', false, 'rate_limited', true);
    END IF;
    INSERT INTO public.ticketing_guest_access_links (order_id, email, token_hash, expires_at)
    VALUES (v_order.id, lower(trim(p_email)), p_token_hash, now() + INTERVAL '30 minutes');
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
    v_ticket public.ticketing_tickets%ROWTYPE;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_link
    FROM public.ticketing_guest_access_links
    WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
    FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE id = v_link.order_id AND status = 'paid';
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF v_link.ticket_id IS NOT NULL THEN
        SELECT * INTO v_ticket FROM public.ticketing_tickets
        WHERE id = v_link.ticket_id
            AND order_item_id IN (SELECT id FROM public.ticketing_order_items WHERE order_id = v_order.id)
            AND lower(attendee_email) = lower(v_link.email)
            AND status = 'issued';
        IF NOT FOUND THEN RETURN NULL; END IF;
    ELSE
        IF lower(v_order.buyer_email) <> lower(v_link.email) THEN RETURN NULL; END IF;
    END IF;

    UPDATE public.ticketing_guest_access_links SET used_at = now() WHERE id = v_link.id;
    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'buyer_email', v_link.email,
        'ticket_id', v_link.ticket_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_request_ticket_transfer(
    p_ticket_id UUID,
    p_order_id UUID,
    p_from_email TEXT,
    p_to_email TEXT,
    p_to_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_order public.ticketing_orders%ROWTYPE;
    v_transfer public.ticketing_transfers%ROWTYPE;
    v_event_id UUID;
BEGIN
    IF p_ticket_id IS NULL OR p_order_id IS NULL
        OR lower(trim(COALESCE(p_from_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR lower(trim(COALESCE(p_to_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(trim(COALESCE(p_to_name, ''))) > 160
        OR lower(trim(p_from_email)) = lower(trim(p_to_email)) THEN
        RAISE EXCEPTION 'Invalid ticket transfer details.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE id = p_order_id AND status = 'paid';
    IF NOT FOUND THEN RAISE EXCEPTION 'Paid ticket order was not found.' USING ERRCODE = 'P0002'; END IF;
    SELECT tickets.* INTO v_ticket
    FROM public.ticketing_tickets AS tickets
    JOIN public.ticketing_order_items AS items ON items.id = tickets.order_item_id
    WHERE tickets.id = p_ticket_id AND items.order_id = p_order_id
    FOR UPDATE OF tickets;
    IF NOT FOUND OR v_ticket.status <> 'issued'
        OR lower(v_ticket.attendee_email) <> lower(trim(p_from_email)) THEN
        RAISE EXCEPTION 'Only an active ticket in this wallet can be transferred.' USING ERRCODE = 'P0001';
    END IF;
    v_event_id := v_ticket.event_id;
    IF NOT EXISTS (
        SELECT 1 FROM public.ticketing_events
        WHERE id = v_event_id
            AND status IN ('scheduled', 'on_sale', 'sold_out')
            AND now() < ends_at
    ) THEN
        RAISE EXCEPTION 'This event is not accepting ticket transfers.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.ticketing_transfers (
        ticket_id, order_id, event_id, from_email, to_email, to_name
    ) VALUES (
        p_ticket_id, p_order_id, v_event_id,
        lower(trim(p_from_email)), lower(trim(p_to_email)), left(trim(COALESCE(p_to_name, '')), 160)
    )
    ON CONFLICT (ticket_id) WHERE status = 'pending' DO NOTHING
    RETURNING * INTO v_transfer;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A transfer request is already pending for this ticket.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.ticketing_security_events (
        event_type, severity, summary, actor_email, entity_type, entity_reference, details
    ) VALUES (
        'ticket_transfer.requested', 'medium', 'Ticket transfer requested; approval required',
        lower(trim(p_from_email)), 'ticket', v_ticket.ticket_reference,
        jsonb_build_object('transfer_id', v_transfer.id, 'event_id', v_event_id)
    );
    RETURN jsonb_build_object('transfer_id', v_transfer.id, 'status', v_transfer.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_review_ticket_transfer(
    p_transfer_id UUID,
    p_decision TEXT,
    p_actor_email TEXT,
    p_reason TEXT,
    p_credential_hash TEXT,
    p_credential_ciphertext TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transfer public.ticketing_transfers%ROWTYPE;
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_new_ticket public.ticketing_tickets%ROWTYPE;
    v_issued_ticket public.ticketing_tickets%ROWTYPE;
BEGIN
    IF p_transfer_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve', 'reject')
        OR length(trim(COALESCE(p_actor_email, ''))) > 320
        OR length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION 'A valid transfer decision and review reason are required.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_transfer FROM public.ticketing_transfers
    WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer request was not found.' USING ERRCODE = 'P0002'; END IF;
    IF v_transfer.status <> 'pending' THEN
        RAISE EXCEPTION 'Transfer request has already been reviewed.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_ticket FROM public.ticketing_tickets
    WHERE id = v_transfer.ticket_id FOR UPDATE;
    IF p_decision = 'approve' THEN
        IF v_ticket.status <> 'issued'
            OR NOT EXISTS (
                SELECT 1 FROM public.ticketing_orders
                WHERE id = v_transfer.order_id AND status = 'paid'
            )
            OR NOT EXISTS (
                SELECT 1 FROM public.ticketing_events
                WHERE id = v_transfer.event_id
                    AND status IN ('scheduled', 'on_sale', 'sold_out')
                    AND now() < ends_at
            )
            OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$'
            OR COALESCE(p_credential_ciphertext, '') = '' THEN
            RAISE EXCEPTION 'Ticket is no longer transferable or replacement credentials are invalid.' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.ticketing_tickets
        SET status = 'transferred', revoked_at = now(), credential_ciphertext = NULL
        WHERE id = v_ticket.id AND status = 'issued';
        INSERT INTO public.ticketing_tickets (
            event_id, order_item_id, attendee_name, attendee_email,
            credential_hash, credential_ciphertext
        ) VALUES (
            v_ticket.event_id, v_ticket.order_item_id, v_transfer.to_name, v_transfer.to_email,
            p_credential_hash, p_credential_ciphertext
        ) RETURNING * INTO v_new_ticket;
        UPDATE public.ticketing_transfers
        SET status = 'approved', replacement_ticket_id = v_new_ticket.id,
            reviewed_by_email = lower(trim(p_actor_email)), reviewed_at = now(), reason = trim(p_reason)
        WHERE id = v_transfer.id;
        v_issued_ticket := v_new_ticket;
    ELSE
        UPDATE public.ticketing_transfers
        SET status = 'rejected', reviewed_by_email = lower(trim(p_actor_email)),
            reviewed_at = now(), reason = trim(p_reason)
        WHERE id = v_transfer.id;
        v_issued_ticket := v_ticket;
    END IF;

    INSERT INTO public.ticketing_security_events (
        event_type, severity, summary, actor_email, entity_type, entity_reference, details
    ) VALUES (
        'ticket_transfer.' || p_decision, 'high', 'Ticket transfer reviewed by platform owner',
        lower(trim(p_actor_email)), 'ticket', v_ticket.ticket_reference,
        jsonb_build_object('transfer_id', v_transfer.id, 'decision', p_decision, 'reason', trim(p_reason))
    );
    RETURN jsonb_build_object(
        'status', CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
        'ticket_id', v_issued_ticket.id,
        'order_id', v_transfer.order_id,
        'recipient_email', CASE WHEN p_decision = 'approve' THEN v_transfer.to_email ELSE NULL END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_create_transfer_access_link(
    p_ticket_reference TEXT,
    p_email TEXT,
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_order_id UUID;
    v_order public.ticketing_orders%ROWTYPE;
    v_recent_links INTEGER;
BEGIN
    IF p_ticket_reference IS NULL OR length(p_ticket_reference) > 32
        OR p_email IS NULL OR length(trim(p_email)) > 320
        OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid transfer access request.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_ticket FROM public.ticketing_tickets
    WHERE upper(ticket_reference) = upper(trim(p_ticket_reference))
        AND lower(attendee_email) = lower(trim(p_email))
        AND status = 'issued'
    FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.ticketing_transfers
        WHERE replacement_ticket_id = v_ticket.id AND status = 'approved'
    ) THEN
        RETURN jsonb_build_object('created', false);
    END IF;
    SELECT items.order_id INTO v_order_id
    FROM public.ticketing_order_items AS items WHERE items.id = v_ticket.order_item_id;
    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE id = v_order_id AND status = 'paid';
    IF NOT FOUND THEN RETURN jsonb_build_object('created', false); END IF;

    SELECT count(*)::INTEGER INTO v_recent_links
    FROM public.ticketing_guest_access_links
    WHERE order_id = v_order_id AND ticket_id = v_ticket.id AND created_at > now() - INTERVAL '1 hour';
    IF v_recent_links >= 5 THEN
        RETURN jsonb_build_object('created', false, 'rate_limited', true);
    END IF;
    INSERT INTO public.ticketing_guest_access_links (
        order_id, ticket_id, email, token_hash, expires_at
    ) VALUES (
        v_order_id, v_ticket.id, lower(trim(p_email)), p_token_hash, now() + INTERVAL '30 minutes'
    );
    RETURN jsonb_build_object('created', true, 'order_id', v_order_id, 'ticket_id', v_ticket.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_set_gate_staff_account(
    p_email TEXT,
    p_password_salt TEXT,
    p_password_hash TEXT,
    p_active BOOLEAN,
    p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(trim(COALESCE(p_email, '')));
BEGIN
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(v_email) > 320
        OR p_password_salt !~ '^[A-Za-z0-9_-]{20,64}$'
        OR p_password_hash !~ '^[A-Fa-f0-9]{128}$'
        OR length(trim(COALESCE(p_actor_email, ''))) > 320 THEN
        RAISE EXCEPTION 'Invalid gate staff account details.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.ticketing_gate_staff_accounts (
        email, password_salt, password_hash, active, created_by_email
    ) VALUES (
        v_email, p_password_salt, lower(p_password_hash), COALESCE(lower(trim(p_actor_email)), '' )
    )
    ON CONFLICT (email) DO UPDATE SET
        password_salt = EXCLUDED.password_salt,
        password_hash = EXCLUDED.password_hash,
        active = EXCLUDED.active,
        updated_at = now();

    INSERT INTO public.ticketing_security_events (
        event_type, severity, summary, actor_email, entity_type, entity_reference, details
    ) VALUES (
        'gate_staff.account_changed', 'medium', 'Gate staff account access changed',
        lower(trim(p_actor_email)), 'gate_staff', v_email,
        jsonb_build_object('active', p_active)
    );
    RETURN jsonb_build_object('email', v_email, 'active', p_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_set_gate_staff_assignment(
    p_event_id UUID,
    p_email TEXT,
    p_gate_name TEXT,
    p_active BOOLEAN,
    p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(trim(COALESCE(p_email, '')));
    v_event public.ticketing_events%ROWTYPE;
BEGIN
    IF p_event_id IS NULL
        OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR length(trim(COALESCE(p_gate_name, ''))) NOT BETWEEN 1 AND 120
        OR length(trim(COALESCE(p_actor_email, ''))) > 320 THEN
        RAISE EXCEPTION 'Invalid event gate assignment.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_event FROM public.ticketing_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.ticketing_gate_staff_accounts
        WHERE email = v_email AND active = true
    ) THEN
        RAISE EXCEPTION 'An active gate staff account is required.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.ticketing_gate_staff_assignments (
        event_id, email, gate_name, active, assigned_by_email
    ) VALUES (
        p_event_id, v_email, trim(p_gate_name), p_active, lower(trim(p_actor_email))
    )
    ON CONFLICT (event_id, email) DO UPDATE SET
        gate_name = EXCLUDED.gate_name,
        active = EXCLUDED.active,
        assigned_by_email = EXCLUDED.assigned_by_email,
        updated_at = now();

    INSERT INTO public.ticketing_security_events (
        event_type, severity, summary, actor_email, entity_type, entity_reference, details
    ) VALUES (
        'gate_staff.assignment_changed', 'medium', 'Event gate staff assignment changed',
        lower(trim(p_actor_email)), 'event', p_event_id::TEXT,
        jsonb_build_object('staff_email', v_email, 'gate_name', trim(p_gate_name), 'active', p_active)
    );
    RETURN jsonb_build_object('event_id', p_event_id, 'email', v_email, 'gate_name', trim(p_gate_name), 'active', p_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_consume_rate_limit(
    p_bucket_hash TEXT,
    p_max_attempts INTEGER,
    p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempts INTEGER;
    v_window_started_at TIMESTAMPTZ;
BEGIN
    IF p_bucket_hash !~ '^[0-9a-f]{64}$'
        OR p_max_attempts NOT BETWEEN 1 AND 10000
        OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid rate limit request.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.ticketing_rate_limit_windows (bucket_hash, window_started_at, attempts)
    VALUES (p_bucket_hash, now(), 1)
    ON CONFLICT (bucket_hash) DO UPDATE SET
        attempts = CASE
            WHEN ticketing_rate_limit_windows.window_started_at
                <= now() - make_interval(secs => p_window_seconds) THEN 1
            ELSE ticketing_rate_limit_windows.attempts + 1
        END,
        window_started_at = CASE
            WHEN ticketing_rate_limit_windows.window_started_at
                <= now() - make_interval(secs => p_window_seconds) THEN now()
            ELSE ticketing_rate_limit_windows.window_started_at
        END,
        updated_at = now()
    RETURNING attempts, window_started_at INTO v_attempts, v_window_started_at;

    RETURN v_attempts <= p_max_attempts;
END;
$$;

DROP FUNCTION IF EXISTS public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.ticketing_check_in(
    p_event_id UUID,
    p_credential_hash TEXT,
    p_gate_name TEXT,
    p_staff_user_id UUID,
    p_device_id TEXT,
    p_request_id UUID,
    p_staff_email TEXT,
    p_platform_admin BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_event public.ticketing_events%ROWTYPE;
    v_existing public.ticketing_checkins%ROWTYPE;
    v_result TEXT;
    v_paid BOOLEAN;
BEGIN
    IF p_event_id IS NULL OR p_request_id IS NULL
        OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$'
        OR length(trim(COALESCE(p_staff_email, ''))) > 320
        OR length(trim(COALESCE(p_gate_name, ''))) > 120 THEN
        RAISE EXCEPTION 'Invalid ticket scan request.' USING ERRCODE = '22023';
    END IF;

    IF NOT COALESCE(p_platform_admin, false)
        AND NOT EXISTS (
            SELECT 1 FROM public.ticketing_gate_staff_assignments AS assignments
            JOIN public.ticketing_gate_staff_accounts AS accounts
                ON accounts.email = assignments.email AND accounts.active = true
            WHERE assignments.event_id = p_event_id
                AND assignments.email = lower(trim(p_staff_email))
                AND assignments.active = true
                AND assignments.gate_name = trim(COALESCE(p_gate_name, ''))
        ) THEN
        RAISE EXCEPTION 'This scanner is not assigned to the selected event and gate.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
    SELECT * INTO v_existing FROM public.ticketing_checkins
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.event_id <> p_event_id
            OR v_existing.credential_hash <> p_credential_hash
            OR lower(COALESCE(v_existing.device_id, '')) <> lower(COALESCE(p_device_id, ''))
            OR lower(COALESCE(v_existing.staff_email, '')) <> lower(trim(COALESCE(p_staff_email, '')))
            OR lower(COALESCE(v_existing.gate_name, '')) <> lower(trim(COALESCE(p_gate_name, ''))) THEN
            RAISE EXCEPTION 'Scan request ID was already used for different scan details.' USING ERRCODE = '23505';
        END IF;
        RETURN jsonb_build_object(
            'result', v_existing.result,
            'ticket_reference', CASE WHEN v_existing.result IN ('accepted', 'already_used')
                THEN (SELECT ticket_reference FROM public.ticketing_tickets WHERE id = v_existing.ticket_id) END,
            'replayed', true
        );
    END IF;

    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket event was not found.' USING ERRCODE = 'P0002';
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
    ELSIF v_ticket.status IN ('revoked', 'transferred') THEN
        v_result := 'revoked';
    ELSE
        SELECT orders.status = 'paid' INTO v_paid
        FROM public.ticketing_order_items AS items
        JOIN public.ticketing_orders AS orders ON orders.id = items.order_id
        WHERE items.id = v_ticket.order_item_id;
        IF NOT COALESCE(v_paid, false) THEN
            v_result := 'not_admissible';
        ELSIF v_event.status NOT IN ('scheduled', 'on_sale', 'sold_out')
            OR now() < COALESCE(v_event.doors_open_at, v_event.starts_at)
            OR now() >= v_event.ends_at THEN
            v_result := 'event_unavailable';
        ELSE
            v_result := 'accepted';
            UPDATE public.ticketing_tickets
            SET status = 'checked_in', checked_in_at = now()
            WHERE id = v_ticket.id AND status = 'issued';
            IF NOT FOUND THEN
                v_result := 'already_used';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.ticketing_checkins (
        event_id, ticket_id, credential_hash, gate_name, staff_user_id, staff_email, device_id,
        result, request_id, entry_type
    ) VALUES (
        p_event_id, v_ticket.id, p_credential_hash, left(trim(COALESCE(p_gate_name, '')), 120),
        p_staff_user_id, lower(trim(COALESCE(p_staff_email, ''))), left(COALESCE(p_device_id, ''), 160),
        v_result, p_request_id, 'first_entry'
    );

    RETURN jsonb_build_object(
        'result', v_result,
        'ticket_reference', CASE WHEN v_result IN ('accepted', 'already_used') THEN v_ticket.ticket_reference ELSE NULL END,
        'replayed', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_public_verification(p_ticket_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.ticketing_tickets%ROWTYPE;
    v_order public.ticketing_orders%ROWTYPE;
    v_event public.ticketing_events%ROWTYPE;
    v_tier TEXT;
    v_admission_status TEXT;
BEGIN
    IF p_ticket_reference IS NULL OR length(p_ticket_reference) NOT BETWEEN 8 AND 32 THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_ticket FROM public.ticketing_tickets
    WHERE upper(ticket_reference) = upper(trim(p_ticket_reference));
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO v_order FROM public.ticketing_orders
    WHERE id = (SELECT order_id FROM public.ticketing_order_items WHERE id = v_ticket.order_item_id);
    IF NOT FOUND OR v_order.status <> 'paid' THEN
        RETURN jsonb_build_object('verified', false, 'admission_status', 'not_admissible');
    END IF;
    SELECT * INTO v_event FROM public.ticketing_events WHERE id = v_ticket.event_id;
    SELECT ticket_name_snapshot INTO v_tier
    FROM public.ticketing_order_items WHERE id = v_ticket.order_item_id;

    v_admission_status := CASE
        WHEN v_ticket.status = 'checked_in' THEN 'already_used'
        WHEN v_ticket.status = 'issued'
            AND v_event.status IN ('scheduled', 'on_sale', 'sold_out')
            AND now() < v_event.ends_at THEN 'available'
        ELSE 'not_admissible'
    END;

    RETURN jsonb_build_object(
        'verified', true,
        'admission_status', v_admission_status,
        'event', v_event.title,
        'ticket_type', v_tier,
        'masked_reference', left(v_ticket.ticket_reference, 4) || '-••••-' || right(v_ticket.ticket_reference, 4)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_get_security_metrics()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    WITH paid AS (
        SELECT count(*)::BIGINT AS paid_orders FROM public.ticketing_orders WHERE status = 'paid'
    ),
    expected AS (
        SELECT COALESCE(sum(items.quantity), 0)::BIGINT AS tickets_expected
        FROM public.ticketing_order_items AS items
        JOIN public.ticketing_orders AS orders ON orders.id = items.order_id
        WHERE orders.status = 'paid'
    ),
    inventory AS (
        SELECT
            COALESCE(sum(types.capacity), 0)::BIGINT AS ticket_capacity,
            COALESCE(sum(types.capacity) FILTER (WHERE types.status = 'active'), 0)::BIGINT AS active_capacity
        FROM public.ticketing_ticket_types AS types
    ),
    reserved_inventory AS (
        SELECT COALESCE(sum(quantity), 0)::BIGINT AS active_reservations
        FROM public.ticketing_reservations
        WHERE status = 'reserved' AND expires_at > now()
    ),
    payment_events AS (
        SELECT
            count(*) FILTER (WHERE processing_status = 'processed')::BIGINT AS successful_callbacks,
            count(*) FILTER (WHERE processing_status IN ('rejected', 'retry_required'))::BIGINT AS failed_callbacks
        FROM public.ticketing_payment_webhook_events
    ),
    payment_exceptions AS (
        SELECT count(*)::BIGINT AS unresolved_payments
        FROM public.ticketing_payment_attempts
        WHERE status IN ('pending', 'unknown', 'reconciliation_required')
    ),
    refund_metrics AS (
        SELECT count(*)::BIGINT AS pending_refunds
        FROM public.ticketing_refunds
        WHERE status IN ('requested', 'approved', 'processing', 'reconciliation_required')
    ),
    event_metrics AS (
        SELECT count(*)::BIGINT AS on_sale_events
        FROM public.ticketing_events
        WHERE status = 'on_sale'
    ),
    scan_metrics AS (
        SELECT
            count(*) FILTER (WHERE result = 'accepted')::BIGINT AS accepted_entries,
            count(*) FILTER (WHERE result <> 'accepted')::BIGINT AS rejected_scans,
            count(*) FILTER (WHERE result = 'refunded')::BIGINT AS refunded_scans,
            count(*) FILTER (WHERE result = 'revoked')::BIGINT AS revoked_scans,
            count(DISTINCT device_id) FILTER (WHERE scanned_at > now() - INTERVAL '5 minutes')::BIGINT AS active_scanners,
            max(scanned_at) AS last_scanner_sync
        FROM public.ticketing_checkins
    ),
    cross_gate AS (
        SELECT count(*)::BIGINT AS repeated_across_gates
        FROM (
            SELECT ticket_id
            FROM public.ticketing_checkins
            WHERE ticket_id IS NOT NULL AND scanned_at > now() - INTERVAL '24 hours'
            GROUP BY ticket_id
            HAVING count(DISTINCT gate_name) > 1
        ) AS repeated
    ),
    issued AS (
        SELECT count(*)::BIGINT AS tickets_issued
        FROM public.ticketing_tickets
        WHERE status IN ('issued', 'checked_in')
    )
    SELECT jsonb_build_object(
        'paid_orders', paid.paid_orders,
        'on_sale_events', event_metrics.on_sale_events,
        'tickets_expected', expected.tickets_expected,
        'tickets_issued', issued.tickets_issued,
        'ticket_capacity', inventory.ticket_capacity,
        'active_capacity', inventory.active_capacity,
        'available_inventory', greatest(
            inventory.active_capacity - issued.tickets_issued - reserved_inventory.active_reservations,
            0
        ),
        'active_reservations', reserved_inventory.active_reservations,
        'successful_callbacks', payment_events.successful_callbacks,
        'failed_callbacks', payment_events.failed_callbacks,
        'unresolved_payments', payment_exceptions.unresolved_payments,
        'pending_refunds', refund_metrics.pending_refunds,
        'accepted_entries', scan_metrics.accepted_entries,
        'rejected_scans', scan_metrics.rejected_scans,
        'refunded_scans', scan_metrics.refunded_scans,
        'revoked_scans', scan_metrics.revoked_scans,
        'active_scanners', scan_metrics.active_scanners,
        'last_scanner_sync', scan_metrics.last_scanner_sync,
        'repeated_across_gates', cross_gate.repeated_across_gates,
        'recent_scans', (
            SELECT COALESCE(jsonb_agg(to_jsonb(recent)), '[]'::JSONB)
            FROM (
                SELECT
                    checkins.id,
                    checkins.scanned_at,
                    checkins.result,
                    checkins.gate_name,
                    checkins.staff_email,
                    COALESCE(tickets.ticket_reference, '') AS ticket_reference,
                    COALESCE(events.title, 'Ticket event') AS event_title
                FROM public.ticketing_checkins AS checkins
                LEFT JOIN public.ticketing_tickets AS tickets ON tickets.id = checkins.ticket_id
                LEFT JOIN public.ticketing_events AS events ON events.id = checkins.event_id
                ORDER BY checkins.scanned_at DESC
                LIMIT 50
            ) AS recent
        )
    )
    FROM paid, expected, inventory, reserved_inventory, payment_events, payment_exceptions,
        refund_metrics, event_metrics, scan_metrics, cross_gate, issued;
$$;

ALTER TABLE public.ticketing_gate_staff_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticketing_gate_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticketing_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticketing_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_gate_staff_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ticketing_gate_staff_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ticketing_rate_limit_windows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ticketing_transfers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ticketing_gate_staff_accounts TO service_role;
GRANT ALL ON public.ticketing_gate_staff_assignments TO service_role;
GRANT ALL ON public.ticketing_rate_limit_windows TO service_role;
GRANT ALL ON public.ticketing_transfers TO service_role;

REVOKE ALL ON FUNCTION public.ticketing_set_gate_staff_account(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_gate_staff_account(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_set_gate_staff_assignment(UUID, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_gate_staff_assignment(UUID, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_check_in(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_request_ticket_transfer(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_request_ticket_transfer(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_review_ticket_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_review_ticket_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_transfer_access_link(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_transfer_access_link(TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_public_verification(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_public_verification(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_get_security_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_get_security_metrics() TO service_role;

COMMIT;
