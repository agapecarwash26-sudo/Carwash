-- AquaFlow: repair user creation metadata and audit visibility.
-- Safe to run after the existing installation migrations.

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
    v_site_id := v_requested_site::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site_id AND is_active = true) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;
    IF v_requested_role IN ('owner','admin','manager','cashier','operator','stock_manager') THEN
      v_role := v_requested_role;
    END IF;
  ELSE
    INSERT INTO public.sites(name)
    VALUES (COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow'))
    RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (new.id, COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'), COALESCE(new.email, ''), v_role, v_site_id)
  ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, full_name=EXCLUDED.full_name, role=EXCLUDED.role, site_id=EXCLUDED.site_id;

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN new;
END;
$$;

DROP POLICY IF EXISTS "audit_logs_select_owner_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_owner_admin" ON public.audit_logs FOR SELECT
USING (site_id = public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));
