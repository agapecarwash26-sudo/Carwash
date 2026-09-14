# Correctif AquaFlow — utilisateurs + audit, sans `db push`

Cette version corrige le problème de création d'utilisateur et évite le blocage :
`Remote migration versions not found in local migrations directory`.

## 1. IMPORTANT

**Ne lance PAS `supabase db push` pour ce correctif.**

Le correctif SQL est volontairement placé dans `supabase/patches/` et non dans
`supabase/migrations/`. Il est conçu pour être exécuté directement dans le
**SQL Editor de ton projet Supabase existant**.

## 2. Appliquer le correctif SQL

Ouvre Supabase → SQL Editor → New query.

Copie le contenu de :

`supabase/patches/20260914_safe_users_audit_patch.sql`

puis clique **Run**.

Le script est transactionnel et peut être exécuté une seule fois.

## 3. Déployer uniquement l'Edge Function

Après le SQL, depuis la racine du projet :

```bash
supabase functions deploy manage-users
```

**Pas de `supabase db push`.**

## 4. Tester

Connecte-toi avec le propriétaire et crée un utilisateur de test :

- rôle : `operator` (ou un autre rôle non-owner)
- le site doit être automatiquement celui du propriétaire

Vérifie dans Supabase :

- `auth.users` : un seul nouvel utilisateur
- `public.profiles.role` : le rôle choisi
- `public.profiles.site_id` : exactement le `site_id` du propriétaire
- `public.audit_logs` : une ligne `CREATE` pour la création du profil

## 5. Si une erreur apparaît encore

Le frontend affiche maintenant le message retourné par `manage-users`.
Copie le message complet, pas seulement `Erreur serveur`.

Le Network → POST `/functions/v1/manage-users` doit aussi afficher un JSON avec
`error` si la fonction refuse la création.
