CREATE TABLE IF NOT EXISTS public.ticketing_admin_mfa (
    email TEXT PRIMARY KEY,
    encrypted_secret TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_step BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ticketing_admin_mfa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticketing_admin_mfa FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ticketing_admin_mfa TO service_role;

CREATE OR REPLACE FUNCTION public.ticketing_consume_admin_mfa_step(
    p_email TEXT,
    p_step BIGINT,
    p_activate BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_record public.ticketing_admin_mfa%ROWTYPE;
BEGIN
    UPDATE public.ticketing_admin_mfa
    SET active = active OR p_activate,
        last_verified_step = p_step,
        updated_at = now()
    WHERE email = lower(trim(p_email))
      AND p_step >= 0
      AND (active OR p_activate)
      AND (last_verified_step IS NULL OR p_step > last_verified_step)
    RETURNING * INTO v_record;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.ticketing_audit_logs (
        actor_email, action, entity_type, entity_id, after_state
    ) VALUES (
        lower(trim(p_email)),
        CASE WHEN p_activate THEN 'admin.mfa_activated' ELSE 'admin.mfa_verified' END,
        'ticketing_admin_mfa',
        lower(trim(p_email)),
        jsonb_build_object('active', v_record.active, 'verified_step', p_step)
    );
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.ticketing_consume_admin_mfa_step(TEXT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_consume_admin_mfa_step(TEXT, BIGINT, BOOLEAN) TO service_role;
