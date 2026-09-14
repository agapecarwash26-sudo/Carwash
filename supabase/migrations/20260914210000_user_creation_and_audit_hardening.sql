-- AquaFlow: harden user provisioning and make the audit journal automatic.
-- The provisioning Edge Function remains the authoritative path for owner/admin-created users.

-- Ensure audit_logs can always be scoped to a tenant.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS audit_logs_site_id_created_at_idx
  ON public.audit_logs(site_id, created_at DESC);

-- Generic database audit trigger. It records INSERT/UPDATE/DELETE on business tables,
-- including actions performed by the normal authenticated application flow.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_site_id uuid;
  v_actor uuid;
  v_entity_id text;
  v_action text := lower(TG_OP);
BEGIN
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

  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;

  v_entity_id := COALESCE(v_row->>'id', v_row->>'operation_id');

  -- Avoid recursive/self-generated noise from audit_logs itself.
  IF TG_TABLE_NAME = 'audit_logs' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_logs(site_id, actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_site_id,
    v_actor,
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    jsonb_build_object('new', CASE WHEN TG_OP <> 'DELETE' THEN v_row ELSE NULL END,
                       'old', v_old)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- Keep the trigger list explicit: audit the application/business data, not Auth internals.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sites','profiles','customers','vehicles','orders','order_items','payments',
    'cash_registers','cash_movements','expenses','products','stock_movements',
    'employees','services','subscriptions','appointments','complaints',
    'app_settings','offline_operations','user_menu_permissions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER audit_row_change_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t, t);
  END LOOP;
END $$;

-- The audit trigger must be able to write even though audit_logs has restrictive RLS.
-- It is SECURITY DEFINER and owns the insert operation.
DROP POLICY IF EXISTS "audit_logs_insert_own_site" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own_site" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    site_id = public.current_user_site_id()
    AND actor_id = auth.uid()
  );

-- Strengthen the new-user trigger: when a site/role is explicitly supplied by a trusted
-- provisioning path, it must be respected; otherwise the normal signup remains owner.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_site_id uuid;
  v_role text := 'owner';
  v_site_name text;
  v_requested_site text;
  v_requested_role text;
BEGIN
  v_requested_site := NULLIF(new.raw_app_meta_data ->> 'site_id', '');
  v_requested_role := NULLIF(new.raw_app_meta_data ->> 'role', '');

  IF v_requested_site IS NOT NULL THEN
    v_site_id := v_requested_site::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site_id AND is_active = true) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;
    IF v_requested_role IN ('admin', 'manager', 'cashier', 'operator', 'stock_manager') THEN
      v_role := v_requested_role;
    END IF;
  ELSE
    v_site_name := COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow');
    INSERT INTO public.sites(name) VALUES (v_site_name) RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (
    new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(new.email, ''),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE WHEN public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        role = EXCLUDED.role,
        site_id = EXCLUDED.site_id;

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
