-- AquaFlow runtime repair: users / tenant assignment / audit logs
-- IMPORTANT: this file intentionally lives outside supabase/migrations.
-- Apply it once in Supabase SQL Editor on the EXISTING production database.
-- It does not alter the Supabase migration history.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. audit_logs must be tenant-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;

UPDATE public.audit_logs a
SET site_id = p.site_id
FROM public.profiles p
WHERE a.site_id IS NULL
  AND a.actor_id = p.id;

CREATE INDEX IF NOT EXISTS audit_logs_site_id_created_at_idx
  ON public.audit_logs(site_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Auth -> profile trigger.
--
-- Existing-site users (created by manage-users) NEVER bootstrap a site and
-- NEVER create another site. Their site_id and role come from app_metadata.
-- A normal signup without site_id still creates a new site and bootstraps it.
-- ---------------------------------------------------------------------------
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
  v_full_name text;
BEGIN
  v_requested_site := NULLIF(new.raw_app_meta_data ->> 'site_id', '');
  v_requested_role := NULLIF(new.raw_app_meta_data ->> 'role', '');
  v_full_name := COALESCE(
    NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    'Propriétaire'
  );

  IF v_requested_site IS NOT NULL THEN
    BEGIN
      v_site_id := v_requested_site::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'site_id invalide pour le nouvel utilisateur.';
    END;

    IF NOT EXISTS (
      SELECT 1 FROM public.sites
      WHERE id = v_site_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    IF v_requested_role IN ('admin', 'manager', 'cashier', 'operator', 'stock_manager') THEN
      v_role := v_requested_role;
    ELSE
      RAISE EXCEPTION 'Rôle utilisateur invalide.';
    END IF;
  ELSE
    INSERT INTO public.sites(name)
    VALUES (
      COALESCE(
        NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''),
        'Mon espace AquaFlow'
      )
    )
    RETURNING id INTO v_site_id;
  END IF;

  INSERT INTO public.profiles(id, full_name, email, role, site_id)
  VALUES (
    new.id,
    v_full_name,
    lower(COALESCE(new.email, '')),
    v_role,
    v_site_id
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE
          WHEN NULLIF(trim(public.profiles.full_name), '') IS NULL
            THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END,
        role = EXCLUDED.role,
        site_id = EXCLUDED.site_id,
        updated_at = now();

  -- Do not bootstrap defaults for an invited staff account in an existing site.
  IF v_requested_site IS NULL THEN
    PERFORM public.bootstrap_site_defaults(v_site_id);
  END IF;

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
-- 3. Audit trigger for tables that carry site_id directly.
--    Audit failures are deliberately swallowed: logging must never break a
--    sale, payment, stock movement, etc.
-- ---------------------------------------------------------------------------
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
  v_action text;
BEGIN
  BEGIN
    v_actor := auth.uid();

    -- Service-role/internal maintenance operations have no end-user JWT.
    -- Those actions are logged explicitly by manage-users when appropriate.
    IF v_actor IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' THEN
      v_row := to_jsonb(OLD);
      v_old := to_jsonb(OLD);
      v_action := 'DELETE';
    ELSIF TG_OP = 'UPDATE' THEN
      v_row := to_jsonb(NEW);
      v_old := to_jsonb(OLD);
      v_action := 'UPDATE';
    ELSE
      v_row := to_jsonb(NEW);
      v_action := 'CREATE';
    END IF;

    IF TG_TABLE_NAME = 'sites' THEN
      v_site_id := NULLIF(v_row ->> 'id', '')::uuid;
    ELSE
      v_site_id := NULLIF(v_row ->> 'site_id', '')::uuid;
    END IF;

    IF v_site_id IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_entity_id := COALESCE(v_row ->> 'id', v_old ->> 'id');

    INSERT INTO public.audit_logs(
      site_id, actor_id, action, entity_type, entity_id, details
    ) VALUES (
      v_site_id,
      v_actor,
      v_action,
      TG_TABLE_NAME,
      v_entity_id,
      jsonb_build_object(
        'source', 'database_trigger',
        'operation', TG_OP,
        'table', TG_TABLE_NAME
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit is observability, not a business-transaction dependency.
    NULL;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recreate only triggers for tables with a direct site_id column.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'sites', 'services', 'customers', 'orders', 'payments',
    'cash_registers', 'expenses', 'products', 'employees', 'subscriptions',
    'appointments', 'complaints', 'app_settings', 'user_menu_permissions'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = t
           AND column_name = 'site_id'
       ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Audit policies: owners/admins can read their own site; authenticated
--    users can write their own-site entries. The trigger is SECURITY DEFINER.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_owner_admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_own_site" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete_owner" ON public.audit_logs;

CREATE POLICY "audit_logs_select_owner_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    site_id = public.current_user_site_id()
    AND public.current_user_role() IN ('owner', 'admin')
  );

CREATE POLICY "audit_logs_insert_own_site" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    site_id = public.current_user_site_id()
    AND actor_id = auth.uid()
  );

CREATE POLICY "audit_logs_delete_owner" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (
    site_id = public.current_user_site_id()
    AND public.current_user_role() IN ('owner', 'admin')
  );

COMMIT;
