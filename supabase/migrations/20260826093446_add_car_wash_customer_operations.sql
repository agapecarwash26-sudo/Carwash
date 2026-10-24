/*
# Add customer operations and communication modules

1. New tables
- `subscriptions`: membership formulas and active customer subscriptions.
- `loyalty_transactions`: auditable points earned or redeemed by customers.
- `appointments`: reservations linked to a customer, vehicle, service and site.
- `complaints`: quality cases and their resolution workflow.
- `notifications`: in-app alerts for staff and owners.

2. Data integrity
- Foreign keys connect every record to the existing customer, vehicle, service, site and user records where applicable.
- Status fields use constrained values so the application can safely render workflows.
- Timestamps preserve the operational history.

3. Security
- Row-level security is enabled on every new table.
- Authenticated users can read and operate the shared workspace after signing in, matching the existing authenticated application model.
- Four separate CRUD policies are created for each table.

4. Notes
- These modules extend the current MVP without altering or deleting existing data.
- Notification rows are durable and can later be used by push, email or WhatsApp delivery jobs.
*/

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  name text NOT NULL,
  price_usd numeric(12,2) NOT NULL DEFAULT 0,
  allowed_washes integer,
  used_washes integer NOT NULL DEFAULT 0,
  starts_at date NOT NULL DEFAULT current_date,
  expires_at date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring','expired','paused','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  points integer NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('earned','redeemed','adjusted')),
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT 'Client comptoir',
  vehicle_label text NOT NULL DEFAULT '',
  service_name text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','arrived','completed','cancelled','no_show')),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT 'Client comptoir',
  subject text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','investigating','waiting_customer','resolved','rejected','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions(status, expires_at);
CREATE INDEX IF NOT EXISTS appointments_starts_at_idx ON public.appointments(starts_at);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON public.complaints(status, priority);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','loyalty_transactions','appointments','complaints'] LOOP
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

DROP POLICY IF EXISTS "users_read_own_notifications" ON public.notifications;
CREATE POLICY "users_read_own_notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_insert_notifications" ON public.notifications;
CREATE POLICY "users_insert_notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_update_own_notifications" ON public.notifications;
CREATE POLICY "users_update_own_notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_delete_own_notifications" ON public.notifications;
CREATE POLICY "users_delete_own_notifications" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);