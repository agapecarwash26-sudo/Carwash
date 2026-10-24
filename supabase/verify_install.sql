/*
  AquaFlow installation smoke checks.

  This script is read-only. Run it in Supabase SQL Editor after migrations
  (or through psql) to verify the structural installation. It does not create
  an account and does not contain personal data.
*/

DO $$
DECLARE
  required_tables text[] := ARRAY[
    'profiles','sites','services','customers','vehicles','orders','order_items',
    'payments','cash_registers','cash_movements','expenses','products',
    'stock_movements','employees','audit_logs','subscriptions',
    'loyalty_transactions','appointments','complaints','notifications',
    'app_settings','offline_operations'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY required_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Table manquante: public.%', t;
    END IF;
  END LOOP;

  IF to_regprocedure('public.current_user_site_id()') IS NULL THEN
    RAISE EXCEPTION 'Fonction current_user_site_id() manquante';
  END IF;
  IF to_regprocedure('public.current_user_role()') IS NULL THEN
    RAISE EXCEPTION 'Fonction current_user_role() manquante';
  END IF;
  IF to_regprocedure('public.bootstrap_site_defaults(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Fonction bootstrap_site_defaults(uuid) manquante';
  END IF;
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION 'Fonction handle_new_user() manquante';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    RAISE EXCEPTION 'Trigger on_auth_user_created manquant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE site_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Profil sans site_id détecté';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sites s
    WHERE NOT s.is_active
  ) THEN
    RAISE NOTICE 'Des sites inactifs existent: cela est normal.';
  END IF;

  RAISE NOTICE 'AquaFlow installation smoke checks: OK';
END $$;
