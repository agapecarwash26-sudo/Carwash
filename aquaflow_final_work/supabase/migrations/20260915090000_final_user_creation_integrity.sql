-- AquaFlow: final integrity for Auth -> profiles and tenant-safe user creation.
-- Canonical migration version: 20260915090000.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';

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
  v_requested_site := NULLIF(trim(NEW.raw_app_meta_data ->> 'site_id'), '');
  v_requested_role := NULLIF(trim(NEW.raw_app_meta_data ->> 'role'), '');

  IF v_requested_site IS NOT NULL THEN
    BEGIN
      v_site_id := v_requested_site::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'site_id invalide pour le compte.';
    END;

    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site_id AND is_active = true) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    IF v_requested_role NOT IN ('admin','manager','cashier','operator','stock_manager') THEN
      RAISE EXCEPTION 'Rôle invalide pour un utilisateur secondaire.';
    END IF;
    v_role := v_requested_role;
  ELSE
    -- Public registration is the only path allowed to bootstrap a new site/owner.
    v_site_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow');
    v_role := 'owner';
    INSERT INTO public.sites(name) VALUES (v_site_name) RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, address, role, site_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(lower(NEW.email), ''),
    COALESCE(NEW.raw_user_meta_data ->> 'address', ''),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      address = EXCLUDED.address,
      role = EXCLUDED.role,
      site_id = EXCLUDED.site_id,
      updated_at = now();

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- The old SQL admin_create_user path is not used by the application. Make it harmless
-- by delegating to an explicit error rather than inserting auth.users manually.
CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'admin_create_user est désactivé. Utiliser l''Edge Function manage-users.';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_user(text,text,text,text) FROM PUBLIC, anon, authenticated;

-- Keep role changes and tenant membership server-controlled; clients cannot alter them directly.
COMMENT ON COLUMN public.profiles.site_id IS 'Tenant immutable from the client; user-management server assigns the creator site.';
COMMENT ON COLUMN public.profiles.role IS 'Application role; owner is reserved for site bootstrap and cannot be used by manage-users.';
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates an owner/site only for public registration, or a secondary profile using validated app_metadata site_id + role.';
