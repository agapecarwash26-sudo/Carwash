-- Final user provisioning consistency hardening.
-- Service-role profile provisioning has no auth.uid(); user creation is audited explicitly
-- by the manage-users Edge Function with the real creator as actor_id.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_site_id uuid;
  v_actor uuid;
  v_entity_id text;
  v_action text := lower(TG_OP);
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;

  -- manage-users records the authoritative actor-aware user creation audit entry.
  IF TG_TABLE_NAME = 'profiles' AND v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;

  BEGIN
    v_site_id := NULLIF(COALESCE(v_row->>'site_id', v_old->>'site_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_site_id := NULL;
  END;

  IF v_site_id IS NULL AND TG_TABLE_NAME = 'sites' THEN
    BEGIN v_site_id := (v_row->>'id')::uuid; EXCEPTION WHEN invalid_text_representation THEN NULL; END;
  END IF;

  IF v_site_id IS NULL THEN
    BEGIN v_site_id := public.current_user_site_id(); EXCEPTION WHEN OTHERS THEN v_site_id := NULL; END;
  END IF;

  v_entity_id := COALESCE(v_row->>'id', v_row->>'operation_id');

  INSERT INTO public.audit_logs(site_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_site_id, v_actor, v_action, TG_TABLE_NAME, v_entity_id,
          jsonb_build_object('new', CASE WHEN TG_OP <> 'DELETE' THEN v_row ELSE NULL END, 'old', v_old));

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
