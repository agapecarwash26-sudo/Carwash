# AquaFlow — correctif création utilisateurs + journal d’audit

## Ce correctif résout

1. Un utilisateur Auth créé alors que l'interface affiche ensuite une erreur.
2. Les profils créés avec le mauvais rôle (`owner`) ou le mauvais `site_id`.
3. Les permissions de menus enregistrées dans une seconde opération pouvant échouer après la création Auth.
4. Le journal d'audit vide : les changements métier sont désormais journalisés par triggers PostgreSQL.
5. La création d'un utilisateur est validée côté serveur avec le `site_id` et le rôle du propriétaire/admin connecté.

## Déploiement Supabase

Depuis la racine du projet :

```bash
supabase db push
supabase functions deploy manage-users
```

La migration est :

```text
supabase/migrations/20260914210000_user_creation_and_audit_hardening.sql
```

## Important pour un compte déjà mal créé

Ce correctif empêche le problème pour les nouvelles créations. Il ne devine pas quel utilisateur existant doit être déplacé entre deux sites.
Pour un compte déjà créé avec le mauvais `site_id`, il faut le corriger explicitement dans `public.profiles` (ou supprimer puis recréer le compte) avec le `site_id` du propriétaire concerné.

## Test recommandé

1. Connecter le propriétaire.
2. Créer un utilisateur `operator` avec une adresse e-mail jamais utilisée.
3. Vérifier immédiatement dans `auth.users` et `public.profiles` : même UUID, rôle `operator`, même `site_id` que le propriétaire.
4. Vérifier `user_menu_permissions`.
5. Vérifier `audit_logs` : une entrée `create` pour `user` doit apparaître.
6. Faire ensuite une vente, modifier un client ou une dépense : une entrée `insert`/`update` doit apparaître automatiquement.
