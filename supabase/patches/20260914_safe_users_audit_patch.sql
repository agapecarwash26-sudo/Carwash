-- AquaFlow SAFE PATCH - user creation + audit
-- IMPORTANT: execute this file ONCE in Supabase SQL Editor.
-- Do NOT run `supabase db push` for this patch. It is intentionally outside supabase/migrations
-- so it does not depend on the local migration history.

BEGIN;

-- 1) audit_logs must be tenant-scoped.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;

UPDATE public.audit_logs a
SET site_id = p.site_id
FROM public.profiles p
WHERE a.site_id IS NULL AND a.actor_id = p.id;

CREATE INDEX IF NOT EXISTS audit_logs_site_id_created_at_idx
  ON public.audit_logs(site_id, created_at DESC);

-- 2) Safe Auth trigger: ONLY create/repair the profile.
-- Never bootstrap site defaults from the auth trigger: a bootstrap failure must not
-- make auth.admin.createUser() return HTTP 500.
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
      RAISE EXCEPTION 'site_id invalide dans les métadonnées utilisateur.';
    END;

    IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = v_site_id AND is_active = true) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    IF v_requested_role IN ('admin','manager','cashier','operator','stock_manager') THEN
      v_role := v_requested_role;
    END IF;
  ELSE
    INSERT INTO public.sites(name)
    VALUES (COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''), 'Mon espace AquaFlow'))
    RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (
    new.id,
    COALESCE(NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Propriétaire'),
    COALESCE(lower(new.email), ''),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
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

-- 3) Generic audit writer. Audit failures are swallowed so business operations
-- can never fail merely because the audit table has an issue.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_site_id uuid;
  v_actor_id uuid;
  v_entity_id text;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_site_id := NULLIF(v_row->>'site_id','')::uuid;
  v_actor_id := auth.uid();
  v_entity_id := COALESCE(v_row->>'id','');

  IF v_site_id IS NULL AND v_actor_id IS NOT NULL THEN
    SELECT site_id INTO v_site_id FROM public.profiles WHERE id = v_actor_id;
  END IF;

  IF v_site_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.audit_logs(site_id, actor_id, action, entity_type, entity_id, details)
      VALUES (
        v_site_id,
        v_actor_id,
        TG_OP,
        TG_TABLE_NAME,
        NULLIF(v_entity_id,''),
        jsonb_build_object('source','database_trigger','table',TG_TABLE_NAME,'operation',TG_OP,'row',v_row)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 4) Install audit triggers only on business tables that have a site_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','sites','services','customers','vehicles','orders','order_items',
    'payments','cash_registers','cash_movements','expenses','products',
    'stock_movements','employees','user_menu_permissions','subscriptions',
    'appointments','complaints'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='site_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
      EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t, t);
    END IF;
  END LOOP;
END $$;

-- 5) Correct tenant policies for audit logs.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select_owner_admin ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_own_site ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_owner ON public.audit_logs;

CREATE POLICY audit_logs_select_owner_admin ON public.audit_logs
FOR SELECT TO authenticated
USING (site_id = public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));

CREATE POLICY audit_logs_insert_own_site ON public.audit_logs
FOR INSERT TO authenticated
WITH CHECK (site_id = public.current_user_site_id() AND actor_id = auth.uid());

CREATE POLICY audit_logs_delete_owner ON public.audit_logs
FOR DELETE TO authenticated
USING (site_id = public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));

COMMIT;
