# AquaFlow — installation Supabase reproductible

## 1. Principe

AquaFlow est multi-tenant : chaque compte authentifié appartient à un `site` et
les données opérationnelles sont isolées par `site_id`.

La création du compte n'insère plus `public.profiles` depuis le navigateur.
Le trigger PostgreSQL `public.handle_new_user()` crée atomiquement :

1. le site du nouveau propriétaire (inscription publique) ;
2. le profil `owner` ;
3. les données génériques initiales du site.

Lorsqu'un administrateur crée un utilisateur depuis **Gestion des utilisateurs**,
l'Edge Function transmet le `site_id` dans `app_metadata`; le même trigger crée
alors le profil dans le site existant.

Aucun UUID, e-mail, mot de passe ou compte de l'instance actuelle n'est requis
par les migrations.

## 2. Tables utilisées

### Tables principales

- `sites`
- `profiles`
- `services`
- `customers`
- `vehicles`
- `orders`
- `order_items`
- `payments`
- `cash_registers`
- `cash_movements`
- `expenses`
- `products`
- `stock_movements`
- `employees`
- `audit_logs`
- `subscriptions`
- `loyalty_transactions`
- `appointments`
- `complaints`
- `notifications`
- `app_settings`
- `offline_operations`

`auth.users` est la source d'identité Supabase.

### Isolation

Les tables racines tenantisées portent un `site_id` obligatoire :

`profiles`, `orders`, `payments`, `cash_registers`, `expenses`, `products`,
`employees`, `customers`, `services`, `subscriptions`, `appointments`,
`complaints`, `app_settings`.

Les tables enfants sont isolées par leur relation avec leur parent :

- `vehicles` -> `customers`
- `order_items` -> `orders`
- `cash_movements` -> `cash_registers`
- `stock_movements` -> `products`
- `loyalty_transactions` -> `customers`

Des triggers PostgreSQL empêchent en plus de relier des objets appartenant à
deux sites différents.

## 3. Installation d'une nouvelle instance

### Pré-requis

- un projet Supabase vide ;
- Node.js 20+ ;
- Supabase CLI ;
- les variables Supabase côté frontend.

### Lier le projet

```bash
supabase login
supabase link --project-ref VOTRE_PROJECT_REF
```

### Appliquer toutes les migrations

```bash
supabase db push
```

Cela crée la structure complète, les fonctions, triggers, RLS et policies.

### Déployer la fonction de gestion des utilisateurs

```bash
supabase functions deploy manage-users
```

La fonction utilise les variables système Supabase de l'Edge Function.
La `service_role` n'est jamais envoyée au navigateur.

### Seed

Le seed est optionnel :

```bash
supabase db seed
```

Les valeurs génériques essentielles sont déjà amorcées automatiquement par
`handle_new_user()` lors de la création d'un site.

## 4. Première installation / premier propriétaire

Aucune insertion SQL manuelle n'est nécessaire.

1. Ouvrir l'application avec le nouveau projet Supabase.
2. Choisir **Créer votre espace**.
3. Saisir le nom du propriétaire, le nom du site, l'e-mail et le mot de passe.
4. Supabase crée `auth.users`.
5. Le trigger crée automatiquement `sites` puis `profiles`.
6. Le profil reçoit le rôle `owner` et un `site_id` valide.
7. Le catalogue et les réglages génériques du site sont initialisés.

Si la confirmation e-mail est activée, le profil est tout de même créé avant la
confirmation ; l'utilisateur se connecte après confirmation.

## 5. Variables d'environnement

### Développement local

Copier `.env.example` vers `.env`, puis renseigner :

```env
VITE_SUPABASE_URL=https://VOTRE_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=VOTRE_SUPABASE_ANON_KEY
```

Seule la clé `anon` est autorisée dans le frontend.

### GitHub Actions / GitHub Pages

Créer les Repository Secrets :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Le workflow `.github/workflows/deploy.yml` les injecte au moment du build.

Ne jamais mettre `SUPABASE_SERVICE_ROLE_KEY` dans le frontend, `.env` public ou
GitHub Pages.

## 6. Vérification structurelle

Après `supabase db push`, exécuter :

```bash
supabase db execute --file supabase/verify_install.sql
```

ou coller `supabase/verify_install.sql` dans le SQL Editor.

Le script est en lecture seule et vérifie notamment :

- les 22 tables attendues ;
- les fonctions de tenant ;
- le trigger `on_auth_user_created` ;
- l'absence de profil avec `site_id IS NULL`.

## 7. Test fonctionnel recommandé

Créer deux comptes via deux inscriptions séparées :

- Compte A -> Site A
- Compte B -> Site B

Puis vérifier :

1. chaque compte voit son profil avec `role = owner` ;
2. chaque compte possède un `site_id` différent ;
3. les services/clients/commandes créés par A ne sont pas visibles par B ;
4. B ne peut pas modifier ou supprimer les données de A ;
5. un utilisateur secondaire créé par A reçoit automatiquement le `site_id` de A ;
6. le même utilisateur secondaire ne peut pas accéder au site B ;
7. un lien forcé `order_id`/`payment`, `customer_id`/`subscription`, etc.
   vers un autre site est rejeté par PostgreSQL.

## 8. Migrations

La migration d'origine du projet reste conservée pour la compatibilité avec
les instances existantes. Les dernières migrations corrigent les problèmes
d'installation et rendent la structure reproductible :

- `20260908010000_installation_hardening.sql`
  - tenant bootstrap ;
  - `profiles.site_id NOT NULL` ;
  - FK/index/defaults ;
  - trigger Auth -> site/profile ;
  - bootstrap catalogue/réglages ;
  - guards inter-tenant ;
  - contrainte tenant sur `app_settings` ;
  - garantie RLS.

- `20260908011000_fix_offline_settings_tenant_scope.sql`
  - corrige la synchronisation offline des réglages après le passage à
    `UNIQUE(site_id, key)`.

## 9. Données spécifiques à l'ancienne instance

Les migrations de durcissement n'utilisent aucun UUID, e-mail ou mot de passe
de l'ancienne instance.

Les données métier génériques sont créées par `bootstrap_site_defaults()`.
Le fichier `seed.sql` ne contient aucune donnée personnelle.
