/*
# Add app_settings table and user management function

1. New Tables
- `app_settings` — stores global application settings (exchange rate, etc.)
  - `id` (uuid, PK)
  - `key` (text, unique) — setting key (e.g. 'usd_to_cdf_rate')
  - `value` (text) — setting value
  - `updated_at` (timestamptz)

2. New Functions
- `admin_create_user(email, password, full_name, role)` — SECURITY DEFINER function
  that allows an authenticated owner/admin to create a new auth user with a
  specific role in profiles. Uses the service role admin API internally.
- `admin_update_user_role(user_uuid, new_role)` — allows owner/admin to change
  a user's role.
- `admin_delete_user(user_uuid)` — allows owner/admin to delete a user account
  and their profile.
- `admin_list_users()` — returns all profiles with their auth email.

3. Security
- RLS enabled on `app_settings` — authenticated users can read, only owner/admin
  can write (enforced via profiles role check).
- The admin_* functions are SECURITY DEFINER and check that the caller has
  role 'owner' or 'admin' before performing any action.

4. Important Notes
- The admin_create_user function uses pgcrypto for gen_random_uuid.
- The functions use auth.users internally to create/manage accounts.
- Email confirmation stays OFF — new users can log in immediately.
*/

-- ===================== app_settings table =====================

CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_app_settings" ON app_settings;
CREATE POLICY "authenticated_read_app_settings"
ON app_settings FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_write_app_settings" ON app_settings;
CREATE POLICY "admin_write_app_settings"
ON app_settings FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin'))
);

-- Seed default exchange rate
INSERT INTO app_settings (key, value)
VALUES ('usd_to_cdf_rate', '2850')
ON CONFLICT (key) DO NOTHING;

-- ===================== admin_list_users function =====================

CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only owner or admin can list users
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : seul un administrateur peut lister les utilisateurs.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.role, p.created_at
  FROM profiles p
  ORDER BY p.created_at DESC;
END;
$$;

-- ===================== admin_create_user function =====================

CREATE OR REPLACE FUNCTION admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Only owner or admin can create users
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : seul un administrateur peut créer des utilisateurs.';
  END IF;

  -- Validate role
  IF p_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'operator', 'stock_manager') THEN
    RAISE EXCEPTION 'Rôle invalide : %', p_role;
  END IF;

  -- Create auth user
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(p_email),
    crypt(p_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('full_name', p_full_name)
  ) RETURNING id INTO new_user_id;

  -- Create profile
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (new_user_id, lower(p_email), p_full_name, p_role);

  RETURN new_user_id;
END;
$$;

-- ===================== admin_update_user_role function =====================

CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_user_id uuid,
  p_new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only owner or admin can change roles
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : seul un administrateur peut modifier les rôles.';
  END IF;

  -- Validate role
  IF p_new_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'operator', 'stock_manager') THEN
    RAISE EXCEPTION 'Rôle invalide : %', p_new_role;
  END IF;

  UPDATE profiles SET role = p_new_role, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- ===================== admin_delete_user function =====================

CREATE OR REPLACE FUNCTION admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Only owner or admin can delete users
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission refusée : seul un administrateur peut supprimer des utilisateurs.';
  END IF;

  -- Prevent self-deletion
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Vous ne pouvez pas supprimer votre propre compte.';
  END IF;

  -- Delete profile
  DELETE FROM profiles WHERE id = p_user_id;

  -- Delete auth user
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

-- ===================== Grants =====================

GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_user(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_user(uuid) TO authenticated;
