-- Definitive user provisioning hardening.
-- Employee creation is always attached to the creator's existing tenant.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_site_id uuid;
  v_role text;
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
    IF v_requested_role NOT IN ('admin','manager','cashier','operator','stock_manager') THEN
      RAISE EXCEPTION 'Rôle de nouvel utilisateur invalide.';
    END IF;
    v_role := v_requested_role;
  ELSE
    -- Public signup is the only path allowed to create a tenant and an owner.
    v_role := 'owner';
    v_site_name := COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow');
    INSERT INTO public.sites(name) VALUES (v_site_name) RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, address, role, site_id)
  VALUES (
    new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Utilisateur'),
    COALESCE(new.email, ''),
    COALESCE(new.raw_user_meta_data ->> 'address', ''),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    address = EXCLUDED.address,
    role = EXCLUDED.role,
    site_id = EXCLUDED.site_id,
    updated_at = now();

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
