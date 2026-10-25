-- Anonymous, consent-gated demand signals and owner-only aggregate reporting.
-- Apply after TICKETING_WAVES_MIGRATION.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticketing_demand_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    visitor_id UUID NOT NULL,
    event_id UUID REFERENCES public.ticketing_events(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('event_view', 'event_search', 'filter', 'checkout_intent')),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::TEXT) <= 1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticketing_demand_events_created_idx
    ON public.ticketing_demand_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ticketing_demand_events_type_created_idx
    ON public.ticketing_demand_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ticketing_demand_events_event_created_idx
    ON public.ticketing_demand_events (event_id, created_at DESC)
    WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticketing_orders_paid_at_idx
    ON public.ticketing_orders (paid_at DESC)
    WHERE status = 'paid' AND paid_at IS NOT NULL;

ALTER TABLE public.ticketing_demand_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticketing_demand_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ticketing_demand_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticketing_demand_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.ticketing_get_demand_insights(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_days NOT IN (7, 30, 90) THEN
        RAISE EXCEPTION 'Demand report window must be 7, 30 or 90 days.' USING ERRCODE = '22023';
    END IF;

    WITH bounds AS (
        SELECT date_trunc('day', now()) - ((p_days - 1) * INTERVAL '1 day') AS starts_at
    ),
    signals AS (
        SELECT d.event_id, d.visitor_id, d.event_type, d.metadata, d.created_at
        FROM public.ticketing_demand_events d, bounds b
        WHERE d.created_at >= b.starts_at
    ),
    orders AS (
        SELECT o.event_id, o.total_minor, o.paid_at AS created_at
        FROM public.ticketing_orders o, bounds b
        WHERE o.status = 'paid'
          AND o.paid_at >= b.starts_at
    ),
    signal_summary AS (
        SELECT
            event_id,
            COUNT(*) FILTER (WHERE event_type = 'event_view') AS views,
            COUNT(*) FILTER (WHERE event_type = 'event_search') AS searches,
            COUNT(*) FILTER (WHERE event_type = 'event_search' AND metadata ->> 'zero_results' = 'true') AS zero_result_searches,
            COUNT(*) FILTER (WHERE event_type = 'filter') AS filter_uses,
            COUNT(*) FILTER (WHERE event_type = 'checkout_intent') AS checkout_intents,
            COUNT(DISTINCT visitor_id) AS visitors
        FROM signals
        WHERE event_id IS NOT NULL
        GROUP BY event_id
    ),
    order_summary AS (
        SELECT event_id, COUNT(*) AS paid_orders, COALESCE(SUM(total_minor), 0) AS revenue_minor
        FROM orders
        GROUP BY event_id
    ),
    event_rows AS (
        SELECT
            e.id,
            e.title,
            e.city,
            COALESCE(s.views, 0) AS views,
            COALESCE(s.searches, 0) AS searches,
            COALESCE(s.zero_result_searches, 0) AS zero_result_searches,
            COALESCE(s.filter_uses, 0) AS filter_uses,
            COALESCE(s.checkout_intents, 0) AS checkout_intents,
            COALESCE(s.visitors, 0) AS visitors,
            COALESCE(o.paid_orders, 0) AS paid_orders,
            COALESCE(o.revenue_minor, 0) AS revenue_minor
        FROM public.ticketing_events e
        LEFT JOIN signal_summary s ON s.event_id = e.id
        LEFT JOIN order_summary o ON o.event_id = e.id
        WHERE s.event_id IS NOT NULL OR o.event_id IS NOT NULL
    ),
    daily_signals AS (
        SELECT
            date_trunc('day', created_at)::DATE AS day,
            COUNT(*) FILTER (WHERE event_type = 'event_view') AS views,
            COUNT(*) FILTER (WHERE event_type = 'event_search') AS searches,
            COUNT(*) FILTER (WHERE event_type = 'event_search' AND metadata ->> 'zero_results' = 'true') AS zero_result_searches,
            COUNT(*) FILTER (WHERE event_type = 'checkout_intent') AS checkout_intents
        FROM signals
        GROUP BY date_trunc('day', created_at)::DATE
    ),
    daily_orders AS (
        SELECT
            date_trunc('day', created_at)::DATE AS day,
            COUNT(*) AS paid_orders,
            COALESCE(SUM(total_minor), 0) AS revenue_minor
        FROM orders
        GROUP BY date_trunc('day', created_at)::DATE
    ),
    daily_rows AS (
        SELECT
            generated.day::DATE AS day,
            COALESCE(s.views, 0) AS views,
            COALESCE(s.searches, 0) AS searches,
            COALESCE(s.zero_result_searches, 0) AS zero_result_searches,
            COALESCE(s.checkout_intents, 0) AS checkout_intents,
            COALESCE(o.paid_orders, 0) AS paid_orders,
            COALESCE(o.revenue_minor, 0) AS revenue_minor
        FROM bounds b
        CROSS JOIN LATERAL generate_series(b.starts_at, date_trunc('day', now()), INTERVAL '1 day') AS generated(day)
        LEFT JOIN daily_signals s ON s.day = generated.day::DATE
        LEFT JOIN daily_orders o ON o.day = generated.day::DATE
    ),
    top_searches AS (
        SELECT lower(trim(metadata ->> 'query')) AS query, COUNT(*) AS count
        FROM signals
        WHERE event_type = 'event_search'
          AND metadata ->> 'zero_results' = 'true'
          AND length(trim(COALESCE(metadata ->> 'query', ''))) BETWEEN 2 AND 80
        GROUP BY lower(trim(metadata ->> 'query'))
        ORDER BY count DESC, query
        LIMIT 20
    ),
    top_cities AS (
        SELECT lower(trim(metadata ->> 'city')) AS city, COUNT(*) AS count
        FROM signals
        WHERE event_type = 'filter'
          AND length(trim(COALESCE(metadata ->> 'city', ''))) BETWEEN 2 AND 100
        GROUP BY lower(trim(metadata ->> 'city'))
        ORDER BY count DESC, city
        LIMIT 20
    ),
    totals AS (
        SELECT
            COUNT(*) FILTER (WHERE event_type = 'event_view') AS views,
            COUNT(*) FILTER (WHERE event_type = 'event_search') AS searches,
            COUNT(*) FILTER (WHERE event_type = 'event_search' AND metadata ->> 'zero_results' = 'true') AS zero_result_searches,
            COUNT(*) FILTER (WHERE event_type = 'filter') AS filter_uses,
            COUNT(*) FILTER (WHERE event_type = 'checkout_intent') AS checkout_intents,
            COUNT(DISTINCT visitor_id) AS visitors
        FROM signals
    ),
    paid_totals AS (
        SELECT COUNT(*) AS paid_orders, COALESCE(SUM(total_minor), 0) AS revenue_minor
        FROM orders
    )
    SELECT jsonb_build_object(
        'days', p_days,
        'sampledAt', now(),
        'summary', (SELECT to_jsonb(t) || to_jsonb(p) FROM totals t CROSS JOIN paid_totals p),
        'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.views DESC, e.title) FROM event_rows e), '[]'::JSONB),
        'daily', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily_rows d), '[]'::JSONB),
        'unmetSearches', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.count DESC, s.query) FROM top_searches s), '[]'::JSONB),
        'popularCities', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.count DESC, c.city) FROM top_cities c), '[]'::JSONB)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ticketing_get_demand_insights(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_get_demand_insights(INTEGER) TO service_role;

COMMIT;
