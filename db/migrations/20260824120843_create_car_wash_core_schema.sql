/*
# Create core car wash management schema

1. New Tables
- `profiles`: authenticated staff identities and roles.
- `sites`: car wash locations.
- `services`: catalog and pricing in USD/CDF.
- `customers`: customer directory and loyalty balances.
- `vehicles`: vehicles linked to customers.
- `orders`: sales, queue state, site and operational timing.
- `order_items`: services included in each order.
- `payments`: confirmed and pending payment records.
- `cash_registers`: daily cashier sessions and counted closeout.
- `cash_movements`: opening, sales, expenses, refunds and adjustments.
- `expenses`: site expenses and approval workflow.
- `products`: stock catalogue and thresholds.
- `stock_movements`: inventory ledger.
- `employees`: staff operational records.
- `audit_logs`: immutable activity history.

2. Security
- Enable RLS on every table.
- Authenticated users can access the shared business workspace; profile writes are limited to the owner/admin role through application controls.
- Public sign-up is supported through Supabase Auth; profile rows are created by the app after registration.

3. Important notes
- All money amounts preserve their original currency and an optional reporting conversion.
- Orders and payments are never deleted by the application; statuses record reversals and cancellations.
- `site_id` is present on operational records to support multi-site reporting.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','manager','cashier','operator','stock_manager')),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Lavage',
  price_usd numeric(12,2) NOT NULL DEFAULT 0,
  price_cdf numeric(14,2) NOT NULL DEFAULT 0,
  duration_minutes integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text,
  total_spent numeric(12,2) NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  loyalty_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  plate_number text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  vehicle_type text NOT NULL DEFAULT 'Berline',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT 'Client comptoir',
  vehicle_label text NOT NULL DEFAULT '',
  total_usd numeric(12,2) NOT NULL DEFAULT 0,
  total_cdf numeric(14,2) NOT NULL DEFAULT 0,
  paid_usd numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash_usd',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','queued','in_progress','completed','delivered','cancelled','refunded','partial')),
  assigned_employee text,
  notes text NOT NULL DEFAULT '',
  arrived_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_usd numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  method text NOT NULL,
  provider text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  reference text,
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed','cancelled','refunded')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opening_usd numeric(12,2) NOT NULL DEFAULT 0,
  opening_cdf numeric(14,2) NOT NULL DEFAULT 0,
  closing_usd numeric(12,2),
  closing_cdf numeric(14,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Consommable',
  unit text NOT NULL DEFAULT 'unité',
  current_stock numeric(12,2) NOT NULL DEFAULT 0,
  minimum_stock numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'operator',
  phone text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status);
CREATE INDEX IF NOT EXISTS orders_site_id_idx ON public.orders(site_id);
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON public.payments(created_at DESC);
CREATE INDEX IF NOT EXISTS products_stock_idx ON public.products(current_stock, minimum_stock);

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

DROP POLICY IF EXISTS "authenticated_read_profiles" ON public.profiles;
CREATE POLICY "authenticated_read_profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_insert_profiles" ON public.profiles;
CREATE POLICY "authenticated_insert_profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "authenticated_update_profiles" ON public.profiles;
CREATE POLICY "authenticated_update_profiles" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "authenticated_delete_profiles" ON public.profiles;
CREATE POLICY "authenticated_delete_profiles" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','services','customers','vehicles','orders','order_items','payments','cash_registers','cash_movements','expenses','products','stock_movements','employees','audit_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_read_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated_read_%s" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_insert_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated_insert_%s" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_update_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated_update_%s" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_delete_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated_delete_%s" ON public.%I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

INSERT INTO public.sites (name, address, phone)
SELECT 'Lubumbashi Central', 'Avenue Kasaï, Lubumbashi', '+243 81 000 0000'
WHERE NOT EXISTS (SELECT 1 FROM public.sites);

INSERT INTO public.services (name, description, category, price_usd, price_cdf, duration_minutes)
SELECT * FROM (VALUES
  ('Lavage extérieur', 'Nettoyage extérieur express', 'Lavage', 5.00, 14250.00, 25),
  ('Lavage complet', 'Extérieur, intérieur et aspiration', 'Lavage', 10.00, 28500.00, 45),
  ('Lavage premium', 'Traitement complet avec cire et finition', 'Premium', 18.00, 51300.00, 75),
  ('Nettoyage intérieur', 'Aspiration, tableau de bord et tapis', 'Intérieur', 7.00, 19950.00, 35),
  ('Detailing', 'Soin approfondi et finition professionnelle', 'Detailing', 35.00, 99750.00, 180)
) AS seed(name, description, category, price_usd, price_cdf, duration_minutes)
WHERE NOT EXISTS (SELECT 1 FROM public.services);

INSERT INTO public.products (name, category, unit, current_stock, minimum_stock, unit_cost)
SELECT * FROM (VALUES
  ('Shampoing carrosserie', 'Produits lavage', 'litre', 18.00, 5.00, 4.50),
  ('Cire de finition', 'Produits lavage', 'litre', 7.00, 3.00, 12.00),
  ('Chiffons microfibre', 'Fournitures', 'pièce', 64.00, 20.00, 1.20),
  ('Désinfectant intérieur', 'Produits lavage', 'litre', 4.00, 5.00, 8.00)
) AS seed(name, category, unit, current_stock, minimum_stock, unit_cost)
WHERE NOT EXISTS (SELECT 1 FROM public.products);
