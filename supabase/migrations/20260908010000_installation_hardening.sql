/*
  AquaFlow — installation hardening / tenant bootstrap

  This migration closes the installation gap left by the original MVP
  migrations:
  - every tenant-owned root table has a required site_id;
  - site_id defaults are derived from the authenticated profile;
  - a new Auth user automatically receives a site and profile;
  - admin-created users inherit the administrator's site;
  - default catalog/settings are bootstrapped per site;
  - cross-tenant foreign-key links are rejected server-side;
  - helper functions are protected from anonymous execution.

  IMPORTANT:
  This migration contains no account-specific UUID, email or password.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------------------
-- 1. Tenant helper functions
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_site_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.site_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_site_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_site_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- -------------------------------------------------------------------------
-- 2. Guarantee that at least one site exists for legacy databases.
--    This is generic and contains no customer-specific data.
-- -------------------------------------------------------------------------

DO $$
DECLARE
  v_site_id uuid;
BEGIN
  SELECT id INTO v_site_id
  FROM public.sites
  WHERE is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_site_id IS NULL THEN
    INSERT INTO public.sites (name, address, phone)
    VALUES ('Mon premier site', '', '')
    RETURNING id INTO v_site_id;
  END IF;

  -- Repair only legacy NULL tenant references. Never overwrite an existing
  -- tenant assignment.
  UPDATE public.profiles SET site_id = v_site_id WHERE site_id IS NULL;

  UPDATE public.orders SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.payments SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.cash_registers SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.expenses SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.products SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.employees SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.customers SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.services SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.subscriptions SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.appointments SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.complaints SET site_id = v_site_id WHERE site_id IS NULL;
  UPDATE public.app_settings SET site_id = v_site_id WHERE site_id IS NULL;
END $$;

-- -------------------------------------------------------------------------
-- 3. Foreign keys + NOT NULL for tenant-owned root tables.
-- -------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_site_id_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_site_id_fkey'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_registers_site_id_fkey'
  ) THEN
    ALTER TABLE public.cash_registers
      ADD CONSTRAINT cash_registers_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_site_id_fkey'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_site_id_fkey'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_site_id_fkey'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_site_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'services_site_id_fkey'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_site_id_fkey'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_site_id_fkey'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_site_id_fkey'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_settings_site_id_fkey'
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.profiles ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.cash_registers ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.services ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.complaints ALTER COLUMN site_id SET NOT NULL;
ALTER TABLE public.app_settings ALTER COLUMN site_id SET NOT NULL;

-- -------------------------------------------------------------------------
-- 4. Defaults: frontend INSERTs do not need to know the tenant UUID.
-- -------------------------------------------------------------------------

ALTER TABLE public.orders ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.payments ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.cash_registers ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.expenses ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.products ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.employees ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.customers ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.services ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.subscriptions ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.appointments ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.complaints ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();
ALTER TABLE public.app_settings ALTER COLUMN site_id SET DEFAULT public.current_user_site_id();

CREATE INDEX IF NOT EXISTS idx_profiles_site_id ON public.profiles(site_id);
CREATE INDEX IF NOT EXISTS idx_orders_site_id ON public.orders(site_id);
CREATE INDEX IF NOT EXISTS idx_payments_site_id ON public.payments(site_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_site_id ON public.cash_registers(site_id);
CREATE INDEX IF NOT EXISTS idx_expenses_site_id ON public.expenses(site_id);
CREATE INDEX IF NOT EXISTS idx_products_site_id ON public.products(site_id);
CREATE INDEX IF NOT EXISTS idx_employees_site_id ON public.employees(site_id);
CREATE INDEX IF NOT EXISTS idx_customers_site_id ON public.customers(site_id);
CREATE INDEX IF NOT EXISTS idx_services_site_id ON public.services(site_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_site_id ON public.subscriptions(site_id);
CREATE INDEX IF NOT EXISTS idx_appointments_site_id ON public.appointments(site_id);
CREATE INDEX IF NOT EXISTS idx_complaints_site_id ON public.complaints(site_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_site_id ON public.app_settings(site_id);

-- -------------------------------------------------------------------------
-- 5. Per-site default data.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bootstrap_site_defaults(p_site_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = p_site_id) THEN
    RAISE EXCEPTION 'Site inexistant: %', p_site_id;
  END IF;

  INSERT INTO public.services
    (site_id, name, description, category, price_usd, price_cdf, duration_minutes)
  SELECT p_site_id, v.name, v.description, v.category, v.price_usd, v.price_cdf, v.duration_minutes
  FROM (VALUES
    ('Lavage extérieur', 'Nettoyage extérieur express', 'Lavage', 5.00::numeric, 14250.00::numeric, 25),
    ('Lavage complet', 'Extérieur, intérieur et aspiration', 'Lavage', 10.00::numeric, 28500.00::numeric, 45),
    ('Lavage premium', 'Traitement complet avec cire et finition', 'Premium', 18.00::numeric, 51300.00::numeric, 75),
    ('Nettoyage intérieur', 'Aspiration, tableau de bord et tapis', 'Intérieur', 7.00::numeric, 19950.00::numeric, 35),
    ('Detailing', 'Soin approfondi et finition professionnelle', 'Detailing', 35.00::numeric, 99750.00::numeric, 180)
  ) AS v(name, description, category, price_usd, price_cdf, duration_minutes)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.site_id = p_site_id AND lower(s.name) = lower(v.name)
  );

  INSERT INTO public.products
    (site_id, name, category, unit, current_stock, minimum_stock, unit_cost)
  SELECT p_site_id, v.name, v.category, v.unit, v.current_stock, v.minimum_stock, v.unit_cost
  FROM (VALUES
    ('Shampoing carrosserie', 'Produits lavage', 'litre', 18.00::numeric, 5.00::numeric, 4.50::numeric),
    ('Cire de finition', 'Produits lavage', 'litre', 7.00::numeric, 3.00::numeric, 12.00::numeric),
    ('Chiffons microfibre', 'Fournitures', 'pièce', 64.00::numeric, 20.00::numeric, 1.20::numeric),
    ('Désinfectant intérieur', 'Produits lavage', 'litre', 4.00::numeric, 5.00::numeric, 8.00::numeric)
  ) AS v(name, category, unit, current_stock, minimum_stock, unit_cost)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.site_id = p_site_id AND lower(p.name) = lower(v.name)
  );

  INSERT INTO public.app_settings(site_id, key, value)
  VALUES (p_site_id, 'usd_to_cdf_rate', '2850')
  ON CONFLICT (site_id, key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_site_defaults(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bootstrap_current_site_defaults()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid := public.current_user_site_id();
BEGIN
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Aucun site associé à ce compte.';
  END IF;
  PERFORM public.bootstrap_site_defaults(v_site_id);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_current_site_defaults() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_current_site_defaults() TO authenticated;

-- -------------------------------------------------------------------------
-- 6. New Auth user -> site + profile automatically.
--
-- Public signup:
--   raw_user_meta_data.full_name
--   raw_user_meta_data.site_name
--   => a new site + owner profile.
--
-- Admin-created user:
--   raw_app_meta_data.site_id / role
--   => profile is attached to the existing site.
-- -------------------------------------------------------------------------

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

    IF NOT EXISTS (
      SELECT 1 FROM public.sites
      WHERE id = v_site_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Le site demandé pour ce compte n''existe pas ou est inactif.';
    END IF;

    IF v_requested_role IN ('admin', 'manager', 'cashier', 'operator', 'stock_manager') THEN
      v_role := v_requested_role;
    END IF;
  ELSE
    v_site_name := COALESCE(
      NULLIF(trim(new.raw_user_meta_data ->> 'site_name'), ''),
      'Mon espace AquaFlow'
    );

    INSERT INTO public.sites(name)
    VALUES (v_site_name)
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
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE
          WHEN public.profiles.full_name = '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END,
        site_id = public.profiles.site_id;

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

-- Repair existing profiles missing a site (legacy installs only).
DO $$
DECLARE
  v_site_id uuid;
BEGIN
  SELECT id INTO v_site_id
  FROM public.sites
  WHERE is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    UPDATE public.profiles
    SET site_id = v_site_id
    WHERE site_id IS NULL;
  END IF;
END $$;

-- Bootstrap defaults for every existing site without replacing custom data.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.sites WHERE is_active = true LOOP
    PERFORM public.bootstrap_site_defaults(r.id);
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 7. Profile security: users may edit their identity fields, but never their
--    role or tenant. Owner/admin role changes remain controlled server-side.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := public.current_user_role();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.id THEN
      IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Modification de profil non autorisée.';
      END IF;
    END IF;

    IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      IF v_caller_role <> 'owner' OR NEW.site_id IS DISTINCT FROM public.current_user_site_id() THEN
        RAISE EXCEPTION 'Le site d''un profil ne peut pas être modifié par ce moyen.';
      END IF;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Seul un administrateur peut modifier un rôle.';
      END IF;
      IF OLD.role = 'owner' AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'Seul le propriétaire peut modifier le rôle d''un propriétaire.';
      END IF;
      IF NEW.role = 'owner' AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'Seul le propriétaire peut attribuer le rôle propriétaire.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_security_fields ON public.profiles;
CREATE TRIGGER protect_profile_security_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_security_fields();

REVOKE ALL ON FUNCTION public.protect_profile_security_fields() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 8. Cross-tenant integrity guards.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_tenant_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM public.customers WHERE id = NEW.customer_id;
      IF v_site_id IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION 'Le client appartient à un autre site.';
      END IF;
    END IF;
    IF NEW.vehicle_id IS NOT NULL THEN
      SELECT c.site_id INTO v_site_id
      FROM public.vehicles v
      JOIN public.customers c ON c.id = v.customer_id
      WHERE v.id = NEW.vehicle_id;
      IF v_site_id IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION 'Le véhicule appartient à un autre site.';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'order_items' THEN
    SELECT site_id INTO v_site_id FROM public.orders WHERE id = NEW.order_id;
    IF v_site_id IS NULL THEN
      RAISE EXCEPTION 'Commande inexistante.';
    END IF;
    IF NEW.service_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.services
        WHERE id = NEW.service_id AND site_id = v_site_id
      ) THEN
        RAISE EXCEPTION 'Le service appartient à un autre site.';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'payments' THEN
    SELECT site_id INTO v_site_id FROM public.orders WHERE id = NEW.order_id;
    IF v_site_id IS DISTINCT FROM NEW.site_id THEN
      RAISE EXCEPTION 'Le paiement et la commande doivent appartenir au même site.';
    END IF;

  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    SELECT site_id INTO v_site_id FROM public.customers WHERE id = NEW.customer_id;
    IF v_site_id IS DISTINCT FROM NEW.site_id THEN
      RAISE EXCEPTION 'L''abonnement et le client doivent appartenir au même site.';
    END IF;

  ELSIF TG_TABLE_NAME = 'loyalty_transactions' THEN
    SELECT site_id INTO v_site_id FROM public.customers WHERE id = NEW.customer_id;
    IF v_site_id IS NULL THEN
      RAISE EXCEPTION 'Client inexistant.';
    END IF;
    IF NEW.order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = NEW.order_id AND site_id = v_site_id
    ) THEN
      RAISE EXCEPTION 'La transaction fidélité et la commande doivent appartenir au même site.';
    END IF;

  ELSIF TG_TABLE_NAME = 'appointments' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM public.customers WHERE id = NEW.customer_id;
      IF v_site_id IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION 'Le rendez-vous et le client doivent appartenir au même site.';
      END IF;
    END IF;
    IF NEW.service_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.services
        WHERE id = NEW.service_id AND site_id = NEW.site_id
      ) THEN
        RAISE EXCEPTION 'Le service du rendez-vous appartient à un autre site.';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'complaints' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM public.customers WHERE id = NEW.customer_id;
      IF v_site_id IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION 'La réclamation et le client doivent appartenir au même site.';
      END IF;
    END IF;
    IF NEW.order_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM public.orders WHERE id = NEW.order_id;
      IF v_site_id IS DISTINCT FROM NEW.site_id THEN
        RAISE EXCEPTION 'La réclamation et la commande doivent appartenir au même site.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_orders_tenant_links ON public.orders;
CREATE TRIGGER validate_orders_tenant_links
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_order_items_tenant_links ON public.order_items;
CREATE TRIGGER validate_order_items_tenant_links
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_payments_tenant_links ON public.payments;
CREATE TRIGGER validate_payments_tenant_links
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_subscriptions_tenant_links ON public.subscriptions;
CREATE TRIGGER validate_subscriptions_tenant_links
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_loyalty_transactions_tenant_links ON public.loyalty_transactions;
CREATE TRIGGER validate_loyalty_transactions_tenant_links
  BEFORE INSERT OR UPDATE ON public.loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_appointments_tenant_links ON public.appointments;
CREATE TRIGGER validate_appointments_tenant_links
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

DROP TRIGGER IF EXISTS validate_complaints_tenant_links ON public.complaints;
CREATE TRIGGER validate_complaints_tenant_links
  BEFORE INSERT OR UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_links();

REVOKE ALL ON FUNCTION public.validate_tenant_links() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 8. Make app_settings genuinely tenant-scoped.
--    The existing unique(key) constraint was global, so two sites could
--    overwrite each other's setting. Replace it with UNIQUE(site_id, key).
-- -------------------------------------------------------------------------

DO $$
DECLARE
  c record;
BEGIN
  -- Drop any legacy UNIQUE(key) constraint, whatever PostgreSQL named it.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.app_settings'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum
         FROM pg_attribute
         WHERE attrelid = 'public.app_settings'::regclass
           AND attname = 'key'
           AND NOT attisdropped)
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.app_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_site_key_uidx
  ON public.app_settings(site_id, key);

-- -------------------------------------------------------------------------
-- 9. Ensure RLS is enabled on every application table.
--    The preceding RLS migration remains the source of the detailed
--    role/site policies; this migration only guarantees RLS cannot be off.
-- -------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_operations ENABLE ROW LEVEL SECURITY;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a tenant site/profile automatically after auth.users signup.';
COMMENT ON FUNCTION public.bootstrap_site_defaults(uuid) IS
  'Creates only generic per-site application defaults; safe to rerun.';
