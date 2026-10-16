ALTER TABLE public.ticketing_ticket_types
    ADD COLUMN IF NOT EXISTS wave_number SMALLINT,
    ADD COLUMN IF NOT EXISTS admission_type TEXT NOT NULL DEFAULT 'General Admission',
    ADD COLUMN IF NOT EXISTS wave_label TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS activation_mode TEXT NOT NULL DEFAULT 'scheduled',
    ADD COLUMN IF NOT EXISTS wave_theme TEXT NOT NULL DEFAULT 'obsidian-gold',
    ADD COLUMN IF NOT EXISTS wave_manual_open BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.ticketing_ticket_types
    DROP CONSTRAINT IF EXISTS ticketing_ticket_types_wave_number_check,
    ADD CONSTRAINT ticketing_ticket_types_wave_number_check
        CHECK (wave_number IS NULL OR wave_number BETWEEN 1 AND 3),
    DROP CONSTRAINT IF EXISTS ticketing_ticket_types_admission_type_check,
    ADD CONSTRAINT ticketing_ticket_types_admission_type_check
        CHECK (length(trim(admission_type)) BETWEEN 2 AND 80),
    DROP CONSTRAINT IF EXISTS ticketing_ticket_types_wave_label_check,
    ADD CONSTRAINT ticketing_ticket_types_wave_label_check
        CHECK (length(trim(wave_label)) <= 100),
    DROP CONSTRAINT IF EXISTS ticketing_ticket_types_activation_mode_check,
    ADD CONSTRAINT ticketing_ticket_types_activation_mode_check
        CHECK (activation_mode IN ('scheduled', 'previous_sold_out', 'manual')),
    DROP CONSTRAINT IF EXISTS ticketing_ticket_types_wave_theme_check,
    ADD CONSTRAINT ticketing_ticket_types_wave_theme_check
        CHECK (wave_theme IN ('obsidian-gold', 'crimson-black', 'electric-violet'));

CREATE UNIQUE INDEX IF NOT EXISTS ticketing_ticket_type_wave_unique
    ON public.ticketing_ticket_types(event_id, lower(trim(admission_type)), wave_number)
    WHERE wave_number IS NOT NULL AND status <> 'archived';

CREATE OR REPLACE FUNCTION public.ticketing_ticket_wave_is_open(p_ticket_type_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_previous public.ticketing_ticket_types%ROWTYPE;
    v_sold BIGINT;
    v_reserved BIGINT;
BEGIN
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id;
    IF NOT FOUND OR v_type.status <> 'active' THEN
        RETURN FALSE;
    END IF;
    IF v_type.wave_number IS NULL THEN
        RETURN TRUE;
    END IF;
    IF v_type.sales_start_at IS NOT NULL AND v_type.sales_start_at > now() THEN
        RETURN FALSE;
    END IF;
    IF v_type.sales_end_at IS NOT NULL AND v_type.sales_end_at <= now() THEN
        RETURN FALSE;
    END IF;

    IF v_type.activation_mode = 'manual' THEN
        RETURN v_type.wave_manual_open;
    ELSIF v_type.activation_mode = 'scheduled' THEN
        RETURN v_type.sales_start_at IS NOT NULL AND v_type.sales_start_at <= now();
    ELSIF v_type.activation_mode <> 'previous_sold_out' OR v_type.wave_number = 1 THEN
        RETURN FALSE;
    END IF;

    SELECT * INTO v_previous
    FROM public.ticketing_ticket_types
    WHERE event_id = v_type.event_id
      AND lower(trim(admission_type)) = lower(trim(v_type.admission_type))
      AND wave_number = v_type.wave_number - 1
      AND status <> 'archived';
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF v_previous.sales_end_at IS NOT NULL AND v_previous.sales_end_at <= now() THEN
        RETURN TRUE;
    END IF;

    SELECT count(*) INTO v_sold
    FROM public.ticketing_tickets AS tickets
    JOIN public.ticketing_order_items AS items ON items.id = tickets.order_item_id
    JOIN public.ticketing_orders AS orders ON orders.id = items.order_id
    WHERE items.ticket_type_id = v_previous.id
      AND tickets.status IN ('issued', 'checked_in')
      AND orders.status = 'paid';

    SELECT COALESCE(sum(quantity), 0) INTO v_reserved
    FROM public.ticketing_reservations
    WHERE ticket_type_id = v_previous.id
      AND status = 'reserved'
      AND expires_at > now();

    RETURN v_sold + v_reserved >= v_previous.capacity;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_validate_wave_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type public.ticketing_ticket_types%ROWTYPE;
BEGIN
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = NEW.ticket_type_id;
    IF NOT FOUND OR v_type.wave_number IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_type.event_id::TEXT || ':' || lower(trim(v_type.admission_type)), 0
    ));
    IF NOT public.ticketing_ticket_wave_is_open(v_type.id) THEN
        RAISE EXCEPTION 'This ticket wave is not open yet or has closed.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticketing_validate_wave_reservation_trigger ON public.ticketing_reservations;
CREATE TRIGGER ticketing_validate_wave_reservation_trigger
    BEFORE INSERT OR UPDATE OF ticket_type_id, status
    ON public.ticketing_reservations
    FOR EACH ROW
    WHEN (NEW.status = 'reserved')
    EXECUTE FUNCTION public.ticketing_validate_wave_reservation();

CREATE OR REPLACE FUNCTION public.ticketing_create_event_wave(
    p_event_id UUID,
    p_admission_type TEXT,
    p_wave_number SMALLINT,
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
    v_previous public.ticketing_ticket_types%ROWTYPE;
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_allocated BIGINT;
BEGIN
    SELECT * INTO v_event FROM public.ticketing_events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'Ticket waves must be configured before the event opens sales.' USING ERRCODE = 'P0001';
    END IF;
    IF p_admission_type IS NULL OR length(trim(p_admission_type)) NOT BETWEEN 2 AND 80
        OR p_wave_number IS NULL OR p_wave_number NOT BETWEEN 1 AND 3
        OR p_wave_label IS NULL OR length(trim(p_wave_label)) NOT BETWEEN 2 AND 100
        OR p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 99999999999
        OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 1000000
        OR p_min_per_order IS NULL OR p_min_per_order < 1
        OR p_max_per_order IS NULL OR p_max_per_order < p_min_per_order OR p_max_per_order > 100
        OR p_activation_mode IS NULL OR p_activation_mode NOT IN ('scheduled', 'previous_sold_out', 'manual')
        OR p_wave_theme IS NULL OR p_wave_theme NOT IN ('obsidian-gold', 'crimson-black', 'electric-violet')
        OR (p_activation_mode = 'scheduled' AND p_sales_start_at IS NULL)
        OR (p_wave_number = 1 AND p_activation_mode = 'previous_sold_out')
        OR (p_wave_number > 1 AND p_activation_mode = 'previous_sold_out'
            AND NOT EXISTS (
                SELECT 1 FROM public.ticketing_ticket_types
                WHERE event_id = p_event_id
                  AND lower(trim(admission_type)) = lower(trim(p_admission_type))
                  AND wave_number = p_wave_number - 1
                  AND status <> 'archived'
            ))
        OR (p_sales_end_at IS NOT NULL AND p_sales_start_at IS NOT NULL AND p_sales_end_at <= p_sales_start_at)
        OR p_description IS NULL OR length(p_description) > 2000
        OR NOT public.ticketing_valid_benefits(p_benefits) THEN
        RAISE EXCEPTION 'Ticket wave details are invalid or the previous wave is missing.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.ticketing_ticket_types
        WHERE event_id = p_event_id
          AND lower(trim(admission_type)) = lower(trim(p_admission_type))
          AND wave_number = p_wave_number
          AND status <> 'archived'
    ) THEN
        RAISE EXCEPTION 'This admission type already has a ticket for that wave.' USING ERRCODE = '23505';
    END IF;
    SELECT COALESCE(sum(capacity), 0) INTO v_allocated
    FROM public.ticketing_ticket_types
    WHERE event_id = p_event_id AND status <> 'archived';
    IF v_event.capacity IS NOT NULL AND v_allocated + p_capacity > v_event.capacity THEN
        RAISE EXCEPTION 'Wave allocation exceeds event capacity.' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.ticketing_ticket_types (
        event_id, name, description, price_minor, capacity,
        min_per_order, max_per_order, sales_start_at, sales_end_at, benefits,
        wave_number, admission_type, wave_label, activation_mode, wave_theme, wave_manual_open
    ) VALUES (
        p_event_id, trim(p_admission_type), trim(p_description), p_price_minor, p_capacity,
        p_min_per_order, p_max_per_order, p_sales_start_at, p_sales_end_at, p_benefits,
        p_wave_number, trim(p_admission_type), trim(p_wave_label), p_activation_mode,
        p_wave_theme, FALSE
    ) RETURNING * INTO v_type;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''), 'ticket_wave.created', 'ticket_type', v_type.id::TEXT,
        to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_set_manual_wave_open(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_open BOOLEAN,
    p_actor_email TEXT
)
RETURNS public.ticketing_ticket_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_old_state JSONB;
BEGIN
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND wave_number IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket wave was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_type.activation_mode <> 'manual' THEN
        RAISE EXCEPTION 'Only manually activated waves can be opened this way.' USING ERRCODE = 'P0001';
    END IF;
    v_old_state := to_jsonb(v_type);
    UPDATE public.ticketing_ticket_types
    SET wave_manual_open = p_open,
        status = CASE WHEN p_open THEN 'active' ELSE status END,
        updated_at = now()
    WHERE id = v_type.id
    RETURNING * INTO v_type;
    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''),
        CASE WHEN p_open THEN 'ticket_wave.manually_opened' ELSE 'ticket_wave.manually_closed' END,
        'ticket_type', v_type.id::TEXT, v_old_state, to_jsonb(v_type)
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
BEGIN
    SELECT * INTO v_event
    FROM public.ticketing_events
    WHERE id = p_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_event.status NOT IN ('draft', 'scheduled') THEN
        RAISE EXCEPTION 'Ticket wave terms are locked after event sales open.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND wave_number IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket wave was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticketing_order_items WHERE ticket_type_id = p_ticket_type_id) THEN
        RAISE EXCEPTION 'This wave has order history and its terms are locked.' USING ERRCODE = 'P0001';
    END IF;
    IF p_wave_label IS NULL OR length(trim(p_wave_label)) NOT BETWEEN 2 AND 100
        OR p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 99999999999
        OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 1000000
        OR p_min_per_order IS NULL OR p_min_per_order < 1
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

CREATE OR REPLACE FUNCTION public.ticketing_set_wave_status(
    p_event_id UUID,
    p_ticket_type_id UUID,
    p_status TEXT,
    p_actor_email TEXT
)
RETURNS public.ticketing_ticket_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type public.ticketing_ticket_types%ROWTYPE;
    v_old_state JSONB;
BEGIN
    IF p_status NOT IN ('active', 'paused') THEN
        RAISE EXCEPTION 'Wave status is invalid.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_type
    FROM public.ticketing_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id AND wave_number IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket wave was not found.' USING ERRCODE = 'P0002';
    END IF;
    v_old_state := to_jsonb(v_type);
    UPDATE public.ticketing_ticket_types
    SET status = p_status, updated_at = now()
    WHERE id = v_type.id
    RETURNING * INTO v_type;
    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, before_state, after_state
    ) VALUES (
        COALESCE(p_actor_email, ''),
        CASE WHEN p_status = 'active' THEN 'ticket_wave.resumed' ELSE 'ticket_wave.paused' END,
        'ticket_type', v_type.id::TEXT, v_old_state, to_jsonb(v_type)
    );
    RETURN v_type;
END;
$$;

REVOKE ALL ON FUNCTION public.ticketing_ticket_wave_is_open(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_ticket_wave_is_open(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_create_event_wave(UUID, TEXT, SMALLINT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_event_wave(UUID, TEXT, SMALLINT, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_set_manual_wave_open(UUID, UUID, BOOLEAN, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_manual_wave_open(UUID, UUID, BOOLEAN, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_event_wave(UUID, UUID, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_event_wave(UUID, UUID, TEXT, BIGINT, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_set_wave_status(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_set_wave_status(UUID, UUID, TEXT, TEXT)
    TO service_role;
