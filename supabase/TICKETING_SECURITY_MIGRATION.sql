-- Ticketing-only security case management and append-only security activity.
-- Apply after TICKETING_CORE_MIGRATION.sql; no existing commerce tables are changed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticketing_security_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference TEXT NOT NULL UNIQUE DEFAULT (
        'SEC-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10))
    ),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    category TEXT NOT NULL CHECK (category IN (
        'account_access', 'database_access', 'payment_integrity', 'ticket_fraud',
        'admin_activity', 'attack_monitoring', 'data_exposure', 'other'
    )),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 5 AND 160),
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 5 AND 5000),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'investigating', 'contained', 'resolved', 'false_positive'
    )),
    related_entity_type TEXT CHECK (related_entity_type IS NULL OR length(related_entity_type) <= 40),
    related_entity_reference TEXT CHECK (related_entity_reference IS NULL OR length(related_entity_reference) <= 160),
    assigned_to_email TEXT NOT NULL DEFAULT '' CHECK (length(assigned_to_email) <= 320),
    reported_by_email TEXT NOT NULL DEFAULT '' CHECK (length(reported_by_email) <= 320),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ticketing_security_cases_status_idx
    ON public.ticketing_security_cases (status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticketing_security_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id UUID REFERENCES public.ticketing_security_cases(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (length(trim(event_type)) BETWEEN 3 AND 80),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 3 AND 240),
    actor_email TEXT NOT NULL DEFAULT '' CHECK (length(actor_email) <= 320),
    entity_type TEXT CHECK (entity_type IS NULL OR length(entity_type) <= 40),
    entity_reference TEXT CHECK (entity_reference IS NULL OR length(entity_reference) <= 160),
    details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_security_events_created_idx
    ON public.ticketing_security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ticketing_security_events_case_idx
    ON public.ticketing_security_events (case_id, created_at DESC)
    WHERE case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticketing_security_case_activity (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES public.ticketing_security_cases(id) ON DELETE RESTRICT,
    actor_email TEXT NOT NULL DEFAULT '' CHECK (length(actor_email) <= 320),
    action TEXT NOT NULL CHECK (action IN ('case.created', 'case.updated')),
    before_state JSONB,
    after_state JSONB NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_security_case_activity_idx
    ON public.ticketing_security_case_activity (case_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ticketing_reject_security_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Ticketing security evidence is append-only.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS ticketing_security_events_append_only
    ON public.ticketing_security_events;
CREATE TRIGGER ticketing_security_events_append_only
    BEFORE UPDATE OR DELETE ON public.ticketing_security_events
    FOR EACH ROW EXECUTE FUNCTION public.ticketing_reject_security_log_mutation();

DROP TRIGGER IF EXISTS ticketing_security_activity_append_only
    ON public.ticketing_security_case_activity;
CREATE TRIGGER ticketing_security_activity_append_only
    BEFORE UPDATE OR DELETE ON public.ticketing_security_case_activity
    FOR EACH ROW EXECUTE FUNCTION public.ticketing_reject_security_log_mutation();

CREATE OR REPLACE FUNCTION public.ticketing_create_security_case(
    p_severity TEXT,
    p_category TEXT,
    p_title TEXT,
    p_description TEXT,
    p_related_entity_type TEXT,
    p_related_entity_reference TEXT,
    p_actor_email TEXT
)
RETURNS public.ticketing_security_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_case public.ticketing_security_cases%ROWTYPE;
BEGIN
    INSERT INTO public.ticketing_security_cases (
        severity, category, title, description,
        related_entity_type, related_entity_reference, reported_by_email
    ) VALUES (
        p_severity, p_category, trim(p_title), trim(p_description),
        NULLIF(trim(COALESCE(p_related_entity_type, '')), ''),
        NULLIF(trim(COALESCE(p_related_entity_reference, '')), ''),
        left(trim(COALESCE(p_actor_email, '')), 320)
    ) RETURNING * INTO v_case;

    INSERT INTO public.ticketing_security_case_activity (
        case_id, actor_email, action, after_state
    ) VALUES (
        v_case.id, left(trim(COALESCE(p_actor_email, '')), 320), 'case.created',
        jsonb_build_object(
            'reference', v_case.reference, 'severity', v_case.severity,
            'category', v_case.category, 'status', v_case.status,
            'title', v_case.title, 'related_entity_type', v_case.related_entity_type,
            'related_entity_reference', v_case.related_entity_reference
        )
    );

    INSERT INTO public.ticketing_security_events (
        case_id, event_type, severity, summary, actor_email,
        entity_type, entity_reference, details
    ) VALUES (
        v_case.id, 'security_case.created', v_case.severity,
        'Security case opened: ' || v_case.title,
        left(trim(COALESCE(p_actor_email, '')), 320),
        v_case.related_entity_type, v_case.related_entity_reference,
        jsonb_build_object('reference', v_case.reference, 'category', v_case.category)
    );

    RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticketing_update_security_case(
    p_case_id UUID,
    p_status TEXT,
    p_assigned_to_email TEXT,
    p_reason TEXT,
    p_actor_email TEXT
)
RETURNS public.ticketing_security_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_case public.ticketing_security_cases%ROWTYPE;
    v_before JSONB;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 500 THEN
        RAISE EXCEPTION 'A case-change reason between 5 and 500 characters is required.'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_case
    FROM public.ticketing_security_cases
    WHERE id = p_case_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Security case was not found.' USING ERRCODE = 'P0002';
    END IF;

    v_before := jsonb_build_object(
        'status', v_case.status, 'assigned_to_email', v_case.assigned_to_email
    );

    UPDATE public.ticketing_security_cases
    SET status = p_status,
        assigned_to_email = left(trim(COALESCE(p_assigned_to_email, '')), 320),
        updated_at = now(),
        resolved_at = CASE WHEN p_status IN ('resolved', 'false_positive')
            THEN COALESCE(resolved_at, now()) ELSE NULL END
    WHERE id = p_case_id
    RETURNING * INTO v_case;

    INSERT INTO public.ticketing_security_case_activity (
        case_id, actor_email, action, before_state, after_state
    ) VALUES (
        v_case.id, left(trim(COALESCE(p_actor_email, '')), 320), 'case.updated',
        v_before, jsonb_build_object(
            'status', v_case.status, 'assigned_to_email', v_case.assigned_to_email
        ) || jsonb_build_object('reason', trim(p_reason))
    );

    INSERT INTO public.ticketing_security_events (
        case_id, event_type, severity, summary, actor_email,
        entity_type, entity_reference, details
    ) VALUES (
        v_case.id, 'security_case.updated', v_case.severity,
        'Security case ' || v_case.reference || ' updated',
        left(trim(COALESCE(p_actor_email, '')), 320),
        v_case.related_entity_type, v_case.related_entity_reference,
        jsonb_build_object(
            'before', v_before,
            'after', jsonb_build_object(
                'status', v_case.status, 'assigned_to_email', v_case.assigned_to_email
            ),
            'reason', trim(p_reason)
        )
    );

    RETURN v_case;
END;
$$;

ALTER TABLE public.ticketing_security_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticketing_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticketing_security_case_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ticketing_security_cases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ticketing_security_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ticketing_security_case_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticketing_security_cases TO service_role;
GRANT SELECT, INSERT ON public.ticketing_security_events TO service_role;
GRANT SELECT, INSERT ON public.ticketing_security_case_activity TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticketing_security_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticketing_security_case_activity_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.ticketing_reject_security_log_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ticketing_create_security_case(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_create_security_case(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.ticketing_update_security_case(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_update_security_case(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
