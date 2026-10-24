/*
# Point 1 — Liaison des utilisateurs à leur site (multi-tenant)

## Objectif
Transformer la table `profiles` pour que chaque utilisateur soit rattaché
à un et un seul site (car wash). C'est la fondation de l'isolation des données
entre les différents car wash sur la plateforme.

## Changements

### 1. Nouvelle colonne : `profiles.site_id`
- Type : `uuid`, non-null après backfill.
- Référence `sites(id)` via clé étrangère avec `ON DELETE CASCADE`
  (si le site est supprimé, les profils liés le sont aussi).
- Index ajouté pour accélérer les filtres par site.

### 2. Contrainte CHECK sur `profiles.role`
- Limite les valeurs autorisées à : `owner`, `admin`, `manager`,
  `cashier`, `operator`, `stock_manager`.
- Empêche l'insertion de rôles arbitraires.

### 3. Backfill de l'utilisateur existant
- L'unique profil propriétaire actuel (Mut) est rattaché au site
  existant (Lubumbashi Central) pour ne pas perdre l'accès.

### 4. Fonction helper : `current_user_site_id()`
- Retourne le `site_id` de l'utilisateur authentifié.
- Sera utilisée dans toutes les politiques RLS (Point 2) pour
  filtrer automatiquement les données par site.

## Sécurité
- Aucune politique RLS n'est modifiée dans cette migration
  (traité au Point 2).
- La colonne est ajoutée de manière idempotente (IF NOT EXISTS).

## Notes importantes
1. La colonne `site_id` est d'abord ajoutée comme nullable pour
   permettre le backfill sans erreur, puis rendue NOT NULL.
2. Si un nouveau site doit être créé pour un nouveau propriétaire,
   cela se fera via le flux d'inscription (Point 5).
3. La fonction `current_user_site_id()` est marquée SECURITY DEFINER
   et STABLE pour pouvoir être utilisée dans les politiques RLS.
*/

-- =========================================================
-- 1. Ajouter la colonne site_id à profiles
-- =========================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS site_id uuid;

-- =========================================================
-- 2. Backfill : rattacher le propriétaire existant au site existant
--    On attribue le premier site actif à tous les profils sans site.
-- =========================================================
DO $$
DECLARE
  fallback_site uuid;
BEGIN
  SELECT id INTO fallback_site FROM sites WHERE is_active = true ORDER BY created_at LIMIT 1;
  IF fallback_site IS NOT NULL THEN
    UPDATE profiles
      SET site_id = fallback_site
      WHERE site_id IS NULL;
  END IF;
END $$;

-- =========================================================
-- 3. Rendre site_id NOT NULL (maintenant que tout le monde est rattaché)
-- =========================================================
ALTER TABLE profiles
  ALTER COLUMN site_id SET NOT NULL;

-- =========================================================
-- 4. Clé étrangère vers sites
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'profiles_site_id_fkey'
      AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
  END IF;
END $$;

-- =========================================================
-- 5. Contrainte CHECK sur le rôle
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'operator', 'stock_manager'));
  END IF;
END $$;

-- =========================================================
-- 6. Index sur site_id pour performances
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_profiles_site_id ON profiles(site_id);

-- =========================================================
-- 7. Fonction helper : current_user_site_id()
--    Retourne le site_id de l'utilisateur authentifié.
--    Utilisée dans les politiques RLS (Point 2).
-- =========================================================
CREATE OR REPLACE FUNCTION public.current_user_site_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT site_id FROM public.profiles WHERE id = auth.uid();
$$;

-- =========================================================
-- 8. Fonction helper : current_user_role()
--    Retourne le rôle de l'utilisateur authentifié.
--    Utilisée dans les politiques RLS (Point 2).
-- =========================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;
