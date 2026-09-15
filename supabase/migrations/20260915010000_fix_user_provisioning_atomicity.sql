-- Definitive user provisioning hardening: one tenant source, one role source.
-- The Edge Function derives site_id from the authenticated creator; the trigger only
-- consumes server-written app_metadata during auth.users insertion.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_site_id uuid;
  v_role text;
BEGIN
  IF NULLIF(new.raw_app_meta_data ->> 'site_id', '') IS NOT NULL THEN
    v_site_id := (new.raw_app_meta_data ->> 'site_id')::uuid;
    v_role := NULLIF(new.raw_app_meta_data ->> 'role', '');
    IF v_role NOT IN ('admin','manager','cashier','operator','stock_manager') THEN
      RAISE EXCEPTION 'Invalid provisioned role';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id=v_site_id AND is_active=true) THEN
      RAISE EXCEPTION 'Invalid provisioned site';
    END IF;
  ELSE
    -- Public signup/bootstrap is the only path allowed to create a site and owner.
    v_role := 'owner';
    INSERT INTO public.sites(name)
    VALUES (COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow'))
    RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, address, role, site_id)
  VALUES (new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(new.email, ''), COALESCE(new.raw_user_meta_data ->> 'address', ''), v_role, v_site_id)
  ON CONFLICT (id) DO UPDATE SET
    email=EXCLUDED.email, full_name=EXCLUDED.full_name, address=EXCLUDED.address,
    role=EXCLUDED.role, site_id=EXCLUDED.site_id;

  PERFORM public.bootstrap_site_defaults(v_site_id);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Repair historical non-owner profiles only when their Auth metadata explicitly carries
-- the intended tenant and role. This never invents a site and never changes owners.
UPDATE public.profiles p
SET site_id = (u.raw_app_meta_data ->> 'site_id')::uuid,
    role = u.raw_app_meta_data ->> 'role'
FROM auth.users u
WHERE p.id=u.id AND p.role <> 'owner'
  AND NULLIF(u.raw_app_meta_data ->> 'site_id','') IS NOT NULL
  AND NULLIF(u.raw_app_meta_data ->> 'role','') IN ('admin','manager','cashier','operator','stock_manager')
  AND p.site_id IS DISTINCT FROM (u.raw_app_meta_data ->> 'site_id')::uuid;
