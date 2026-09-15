# Déploiement du correctif de création des utilisateurs

## Ordre

1. Appliquer les migrations Supabase du dépôt.
2. Déployer `supabase/functions/manage-users/index.ts`.
3. Redéployer l'application frontend.

La `service_role` reste uniquement côté Edge Function.

## Vérification attendue

Un propriétaire du site `SITE_A` qui crée un utilisateur avec le rôle `manager` doit obtenir :

- `auth.users.id` créé une seule fois ;
- `profiles.site_id = SITE_A` ;
- `profiles.role = manager` ;
- l'adresse et le nom issus du formulaire ;
- un audit avec `actor_id = propriétaire`, `site_id = SITE_A`, `entity_type = user`, `action = create`.

Si une étape obligatoire après Auth échoue, la fonction supprime le compte Auth nouvellement créé afin d'éviter un compte orphelin et le faux scénario « Impossible de créer » puis « User already exists ».
