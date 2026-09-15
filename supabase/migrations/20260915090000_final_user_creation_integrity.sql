/*
  AquaFlow — final user-creation integrity hardening.

  Goals:
  - Never default an admin-created user to owner.
  - Never create a new site for an admin-created user.
  - Make Auth -> profile creation strict and deterministic.
  - Allow only the trusted Edge Function (service_role) to perform backend
    profile role changes.
  - Keep profile tenant membership immutable after creation.
*/

-- ---------------------------------------------------------------------------
-- 1. Strict Auth -> profile trigger
-- ---------------------------------------------------------------------------

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
  v_requested_site := NULLIF(trim(new.raw_app_meta_data ->> 'site_id'), '');
  v_requested_role := NULLIF(trim(new.raw_app_meta_data ->> 'role'), '');

  IF v_requested_site IS NOT NULL THEN
    -- Admin-created accounts must carry a valid server-provided tenant.
    BEGIN
      v_site_id := v_requested_site::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'SITE_ID_INVALIDE: le site fourni pour ce compte est invalide.';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.sites
      WHERE id = v_site_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'SITE_ID_INVALIDE: le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    -- A site_id in app_metadata means this is the controlled staff-creation
    -- path. Missing/invalid role must fail, never fall back to owner.
    IF v_requested_role NOT IN (
      'admin', 'manager', 'cashier', 'operator', 'stock_manager'
    ) THEN
      RAISE EXCEPTION 'ROLE_INVALIDE: un utilisateur créé depuis la gestion du site doit avoir un rôle non-propriétaire valide.';
    END IF;

    v_role := v_requested_role;
  ELSE
    -- Public/self signup remains the only path that creates a new tenant and
    -- its initial owner.
    v_site_name := COALESCE(
      NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''),
      'Mon espace AquaFlow'
    );

    INSERT INTO public.sites(name)
    VALUES (v_site_name)
    RETURNING id INTO v_site_id;

    v_role := 'owner';
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (
    new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(new.email, ''),
    v_role,
    v_site_id
  );

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Profile security: tenant is immutable for clients. The trusted backend
--    may change role/site only after its own server-side authorization checks.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := public.current_user_role();
  v_is_service_role boolean := (auth.role() = 'service_role');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.site_id IS DISTINCT FROM OLD.site_id AND NOT v_is_service_role THEN
      RAISE EXCEPTION 'Le site d''un profil est immuable.';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role AND NOT v_is_service_role THEN
      RAISE EXCEPTION 'Le rôle d''un profil est géré uniquement par le backend administrateur.';
    END IF;

    IF auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.id
       AND NOT v_is_service_role THEN
      IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Modification de profil non autorisée.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_security_fields ON public.profiles;
CREATE TRIGGER protect_profile_security_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_security_fields();

REVOKE ALL ON FUNCTION public.protect_profile_security_fields() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates an owner/site only for self-signup; controlled staff creation requires valid server-provided site_id and non-owner role.';
