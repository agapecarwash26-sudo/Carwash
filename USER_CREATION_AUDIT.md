# Audit et correction — création des utilisateurs AquaFlow

## Cause identifiée

La chaîne réelle du frontend est :

1. `UsersPage.tsx` appelle `createUser(...)`.
2. `workspace.ts` appelle `POST /functions/v1/manage-users`.
3. `manage-users` utilise `SUPABASE_SERVICE_ROLE_KEY` côté Edge Function uniquement.
4. L'Edge Function appelle `supabase.auth.admin.createUser(...)`.
5. Le trigger PostgreSQL `on_auth_user_created` appelle `public.handle_new_user()`.
6. Le trigger crée `profiles`.
7. Après le retour Auth, l'ancien Edge Function effectuait encore une mise à jour de `profiles`.
8. Puis le frontend appelait séparément `saveUserMenuPermissions(...)`.

Le défaut le plus important était la non-atomicité applicative : une création Auth pouvait réussir, puis `saveUserMenuPermissions()` pouvait échouer. Le `catch` de `NewUserModal` transformait alors cet échec post-création en « Impossible de créer l'utilisateur », alors que `auth.users` existait déjà.

Dans le cas observé où le profil avait un mauvais `site_id`, la mise à jour `.eq("site_id", callerSiteId)` ne garantissait pas qu'une ligne avait réellement été modifiée. La création pouvait donc continuer jusqu'à l'enregistrement des permissions, qui dépend du même site et pouvait échouer. Le second clic rencontrait alors naturellement « utilisateur déjà existant ».

## Rôle incorrect

La migration historique `20260908010000_installation_hardening.sql` contenait une faiblesse :

- `v_role` était initialisé à `owner`;
- si `app_metadata.role` était absent ou invalide, le trigger conservait `owner`.

Ainsi, une création administrée avec `site_id` présent mais avec un rôle absent/invalide pouvait devenir propriétaire au lieu d'échouer.

La nouvelle migration `20260915090000_final_user_creation_integrity.sql` supprime ce fallback dangereux :

- avec `app_metadata.site_id`, le rôle doit obligatoirement être `admin`, `manager`, `cashier`, `operator` ou `stock_manager`;
- un rôle absent/invalide provoque une erreur ;
- `owner` n'est plus possible dans le flux de création d'un utilisateur secondaire.

## Site incorrect

Le `site_id` correct doit provenir exclusivement du profil du créateur authentifié.

L'Edge Function récupère :

`profiles(id = auth.uid()) -> site_id`

puis injecte ce `site_id` côté serveur dans `app_metadata`.

Le navigateur ne peut donc pas choisir le site cible.

Le nouveau trigger :

- utilise le `site_id` fourni côté serveur lorsqu'il existe ;
- vérifie que le site existe et est actif ;
- n'invente aucun site dans ce cas ;
- ne crée un nouveau site que pour une inscription autonome sans `site_id`.

Point important : le code actuel du ZIP avant correction envoyait déjà correctement `app_metadata: { site_id: callerSiteId, role }`. Il ne peut donc pas, à lui seul, expliquer un profil propriétaire sur un autre site si exactement cette version de l'Edge Function et la migration `20260908010000_installation_hardening.sql` sont réellement celles déployées. L'état observé indique donc aussi une divergence entre l'état distant et le dépôt (ancienne Edge Function, ancienne migration/trigger, ou autre état SQL distant).

## Correction appliquée

### Frontend

`NewUserModal` n'appelle plus séparément `saveUserMenuPermissions()` après la création.

Il envoie les menus avec la demande de création :

`createUser({ email, password, full_name, role, menu_keys })`

Ainsi, une erreur de permissions ne peut plus être présentée comme une erreur de création après que le compte Auth a déjà été créé.

### Edge Function

`manage-users` :

- normalise l'e-mail ;
- vérifie owner/admin ;
- récupère le `site_id` du créateur côté serveur ;
- refuse les rôles non autorisés ;
- détecte un profil e-mail déjà existant ;
- crée Auth avec `admin.createUser` ;
- transmet `site_id` et `role` dans `app_metadata` ;
- vérifie ensuite que `profiles.site_id` et `profiles.role` correspondent exactement aux valeurs attendues ;
- crée les permissions de menus côté serveur ;
- écrit l'audit `user.created` avec le vrai acteur, utilisateur, site et rôle ;
- si une étape post-Auth échoue, supprime l'utilisateur Auth nouvellement créé comme rollback compensatoire ;
- si le rollback échoue, retourne une erreur spécifique `USER_CREATE_ROLLBACK_FAILED`.

La `service_role` reste exclusivement dans l'Edge Function et n'est pas exposée au frontend.

### PostgreSQL / migrations

Ajout de :

`supabase/migrations/20260915090000_final_user_creation_integrity.sql`

Cette migration :

- rend le trigger Auth -> profile strict ;
- interdit le fallback silencieux vers `owner` pour les créations administrées ;
- interdit la création d'un nouveau site lorsque `site_id` est fourni ;
- rend `profiles.site_id` immuable pour les clients ;
- réserve les changements backend de rôle/site au contexte `service_role`.

### Audit logs

La création réussie écrit :

- `actor_id` = propriétaire/admin réellement connecté ;
- `entity_id` = nouvel utilisateur ;
- `site_id` = site du créateur ;
- `action` = `user.created` ;
- `entity_type` = `user` ;
- `details.email` ;
- `details.full_name` ;
- `details.role` ;
- `details.site_id`.

## Migrations / Supabase Preview

Le dépôt possède désormais une seule source canonique de migrations : `supabase/migrations`.

Les anciennes copies `db/migrations` ont été supprimées pour éviter deux sources de vérité.

Les noms `*.sql.sql` des migrations canoniques ont été nettoyés en `*.sql` sans modifier leur préfixe de version.

Cela ne permet toutefois pas de certifier l'historique **distant** Supabase sans accès au projet Supabase lui-même. L'erreur précédente :

`Remote migration versions not found in local migrations directory.`

signifie qu'une version enregistrée à distance n'est pas présente localement. Le ZIP ne contient pas l'historique distant permettant de prouver quelles versions sont actuellement enregistrées sur le projet. Il faudra donc comparer l'historique distant au dossier `supabase/migrations` avant `db push`/Preview si l'erreur persiste.

## Tests effectués dans le ZIP

- Recherche complète des références `auth.users`, `createUser`, `signUp`, `profiles`, `site_id`, `role`, triggers et audit.
- Vérification de la chaîne frontend -> Edge Function -> Auth -> trigger -> profile.
- Vérification des RLS multi-site.
- Vérification des protections de `profiles`.
- Vérification que `service_role` n'est pas utilisé dans le frontend.
- Vérification de cohérence des accolades/parenthèses des fichiers TypeScript modifiés.
- Vérification qu'il n'existe plus de `db/migrations` concurrent.
- Vérification qu'il n'existe plus de migrations `*.sql.sql`.
- Tentative de `npm install --no-audit --no-fund` : non terminée dans l'environnement d'exécution (timeout réseau), donc aucun build npm local complet n'a pu être certifié ici.

Les scénarios E2E nécessitant un vrai projet Supabase (Test 1 à Test 6) ne peuvent pas être exécutés contre la base distante à partir du ZIP seul. La logique nécessaire est néanmoins intégrée dans la migration et l'Edge Function, avec vérification et rollback.

## Résultat attendu

Pour un propriétaire du `SITE_A` créant :

- nom : Jean Dupont
- email : jean@example.com
- rôle : employe/operator selon le vocabulaire exact de l'application

le serveur doit produire :

- `auth.users.id` = nouvel identifiant ;
- `profiles.id` = même identifiant ;
- `profiles.site_id` = `SITE_A` ;
- `profiles.role` = rôle demandé ;
- permissions de menus rattachées à `SITE_A` ;
- audit `user.created` rattaché à `SITE_A`.

Aucun nouveau `site_id` n'est généré pour ce flux.
