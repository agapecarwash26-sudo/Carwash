-- AquaFlow final hardening: user creation + audit trail.
-- The Auth trigger must be minimal: it must NEVER bootstrap catalog/defaults.
-- User management owns the complete creation transaction after Auth creation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_site_id uuid;
  v_role text := 'owner';
  v_requested_site text;
  v_requested_role text;
BEGIN
  v_requested_site := NULLIF(new.raw_app_meta_data ->> 'site_id', '');
  v_requested_role := NULLIF(new.raw_app_meta_data ->> 'role', '');

  IF v_requested_site IS NOT NULL THEN
    BEGIN
      v_site_id := v_requested_site::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'site_id invalide dans les métadonnées du nouvel utilisateur.';
    END;

    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site_id AND is_active = true) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    IF v_requested_role IN ('admin','manager','cashier','operator','stock_manager') THEN
      v_role := v_requested_role;
    END IF;
  ELSE
    -- Only normal self-registration creates a new site.
    INSERT INTO public.sites(name, address, phone)
    VALUES (
      COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow'),
      '', ''
    )
    RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (
    new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(new.email, ''),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    site_id = EXCLUDED.site_id;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Server-side audit function. SECURITY DEFINER means RLS cannot suppress audit writes.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_actor_id uuid := auth.uid();
  v_entity_id text;
  v_action text := TG_OP;
  v_details jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_site_id := NULLIF(to_jsonb(OLD)->>'site_id','')::uuid;
    v_entity_id := to_jsonb(OLD)->>'id';
    v_details := to_jsonb(OLD);
  ELSE
    v_site_id := NULLIF(to_jsonb(NEW)->>'site_id','')::uuid;
    v_entity_id := to_jsonb(NEW)->>'id';
    v_details := to_jsonb(NEW);
  END IF;

  IF v_site_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, site_id, action, entity_type, entity_id, details)
    VALUES(v_actor_id, v_site_id, v_action, TG_TABLE_NAME, v_entity_id, v_details);
  END IF;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Audit must never break the business operation.
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach audit to all tenant-owned tables. Existing audit_logs is intentionally excluded.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sites','profiles','services','customers','vehicles','orders','order_items',
    'payments','cash_registers','cash_movements','expenses','products',
    'stock_movements','employees','subscriptions','appointments','complaints',
    'user_menu_permissions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- Make audit log reading robust for owners/admins of the current site.
DROP POLICY IF EXISTS audit_logs_select_owner_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_owner_admin ON public.audit_logs
FOR SELECT TO authenticated
USING (site_id = public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));
