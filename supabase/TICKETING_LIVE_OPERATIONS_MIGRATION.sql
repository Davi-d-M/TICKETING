-- Ticketing-only operational event journal for the Online Bar Admin live view.
-- Apply after TICKETING_CORE_MIGRATION.sql. No customer secrets or QR credentials are recorded.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticketing_live_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID,
    source_table TEXT NOT NULL CHECK (source_table IN (
        'ticketing_events', 'ticketing_ticket_types', 'ticketing_reservations',
        'ticketing_orders', 'ticketing_payment_attempts', 'ticketing_payment_webhook_events',
        'ticketing_tickets', 'ticketing_checkins', 'ticketing_refunds'
    )),
    operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    event_type TEXT NOT NULL CHECK (length(event_type) <= 100),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    summary TEXT NOT NULL CHECK (length(summary) <= 240),
    entity_type TEXT NOT NULL CHECK (length(entity_type) <= 40),
    entity_reference TEXT NOT NULL DEFAULT '' CHECK (length(entity_reference) <= 160),
    status TEXT NOT NULL DEFAULT '' CHECK (length(status) <= 80),
    actor_user_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS ticketing_live_events_feed_idx
    ON public.ticketing_live_events (id DESC);
CREATE INDEX IF NOT EXISTS ticketing_live_events_event_idx
    ON public.ticketing_live_events (event_id, id DESC)
    WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticketing_live_events_severity_idx
    ON public.ticketing_live_events (severity, id DESC)
    WHERE severity IN ('high', 'critical');

CREATE OR REPLACE FUNCTION public.ticketing_record_live_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row JSONB;
    v_old JSONB;
    v_event_id UUID;
    v_status TEXT;
    v_entity_type TEXT;
    v_entity_reference TEXT;
    v_severity TEXT := 'info';
    v_actor_user_id UUID;
    v_gate_name TEXT;
    v_summary TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
    ELSE
        v_row := to_jsonb(NEW);
    END IF;
    IF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
    END IF;

    BEGIN
        v_event_id := NULLIF(v_row ->> 'event_id', '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_event_id := NULL;
    END;
    IF TG_TABLE_NAME = 'ticketing_events' THEN
        BEGIN
            v_event_id := NULLIF(v_row ->> 'id', '')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            v_event_id := NULL;
        END;
    END IF;

    IF TG_TABLE_NAME IN ('ticketing_payment_attempts', 'ticketing_refunds') THEN
        BEGIN
            SELECT orders.event_id INTO v_event_id
            FROM public.ticketing_orders AS orders
            WHERE orders.id = NULLIF(v_row ->> 'order_id', '')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            v_event_id := NULL;
        END;
    END IF;

    v_status := COALESCE(v_row ->> 'status', v_row ->> 'result', v_row ->> 'processing_status', '');
    v_actor_user_id := COALESCE(
        NULLIF(v_row ->> 'staff_user_id', '')::UUID,
        NULLIF(v_row ->> 'created_by', '')::UUID,
        NULLIF(v_row ->> 'requested_by', '')::UUID
    );
    v_gate_name := COALESCE(v_row ->> 'gate_name', '');

    v_entity_type := CASE TG_TABLE_NAME
        WHEN 'ticketing_events' THEN 'event'
        WHEN 'ticketing_ticket_types' THEN 'ticket_tier'
        WHEN 'ticketing_reservations' THEN 'reservation'
        WHEN 'ticketing_orders' THEN 'order'
        WHEN 'ticketing_payment_attempts' THEN 'payment_attempt'
        WHEN 'ticketing_payment_webhook_events' THEN 'payment_webhook'
        WHEN 'ticketing_tickets' THEN 'ticket'
        WHEN 'ticketing_checkins' THEN 'gate_scan'
        WHEN 'ticketing_refunds' THEN 'refund'
        ELSE 'ticketing_record'
    END;
    v_entity_reference := left(COALESCE(
        v_row ->> 'ticket_reference',
        v_row ->> 'reference',
        v_row ->> 'slug',
        v_row ->> 'id',
        ''
    ), 160);

    IF v_status IN ('invalid', 'revoked', 'wrong_event', 'reconciliation_required') THEN
        v_severity := 'high';
    ELSIF v_status IN ('already_used', 'refunded', 'failed', 'rejected', 'retry_required') THEN
        v_severity := 'medium';
    END IF;

    v_summary := left(
        replace(TG_TABLE_NAME, 'ticketing_', '') || ' ' || lower(TG_OP)
        || CASE WHEN v_status <> '' THEN ' · ' || v_status ELSE '' END,
        240
    );

    INSERT INTO public.ticketing_live_events (
        event_id, source_table, operation, event_type, severity, summary,
        entity_type, entity_reference, status, actor_user_id, details
    ) VALUES (
        v_event_id, TG_TABLE_NAME, TG_OP, TG_TABLE_NAME || '.' || lower(TG_OP),
        v_severity, v_summary, v_entity_type, v_entity_reference, v_status,
        v_actor_user_id,
        jsonb_strip_nulls(jsonb_build_object(
            'gate_name', NULLIF(v_gate_name, ''),
            'quantity', CASE WHEN v_row ? 'quantity' THEN v_row -> 'quantity' END,
            'provider', CASE WHEN v_row ? 'provider' THEN v_row -> 'provider' END,
            'previous_status', CASE
                WHEN v_old IS NOT NULL THEN COALESCE(v_old ->> 'status', v_old ->> 'result', v_old ->> 'processing_status')
            END
        ))
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_reject_live_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Ticketing operational events are append-only.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS ticketing_live_events_append_only
    ON public.ticketing_live_events;
CREATE TRIGGER ticketing_live_events_append_only
    BEFORE UPDATE OR DELETE ON public.ticketing_live_events
    FOR EACH ROW EXECUTE FUNCTION public.ticketing_reject_live_event_mutation();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'ticketing_events', 'ticketing_ticket_types', 'ticketing_reservations',
        'ticketing_orders', 'ticketing_payment_attempts', 'ticketing_payment_webhook_events',
        'ticketing_tickets', 'ticketing_checkins', 'ticketing_refunds'
    ]
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON public.%I',
            table_name || '_live_operation', table_name
        );
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
            || 'FOR EACH ROW EXECUTE FUNCTION public.ticketing_record_live_operation()',
            table_name || '_live_operation', table_name
        );
    END LOOP;
END;
$$;

ALTER TABLE public.ticketing_live_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_live_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticketing_live_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticketing_live_events_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.ticketing_record_live_operation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ticketing_reject_live_event_mutation() FROM PUBLIC, anon, authenticated;

COMMIT;
