# Déploiement — création des utilisateurs

Cette correction ne modifie aucune migration SQL existante.

## Edge Function

Depuis la racine du projet :

```bash
npx supabase functions deploy manage-users --project-ref webayzaxiqpmtziasisx
```

La fonction `manage-users` :
- dérive toujours `site_id` du propriétaire/admin connecté ;
- crée le compte Auth avec `app_metadata.site_id` et `app_metadata.role` ;
- force le profil `profiles` sur le bon `site_id` et le rôle demandé ;
- vérifie le profil après création ;
- enregistre les permissions dans le même workflow serveur ;
- supprime le compte Auth en cas d'échec de provisionnement ;
- met à jour les métadonnées Auth lors d'un changement de rôle ;
- écrit l'audit de création.

## Frontend

Le frontend envoie désormais les permissions au serveur lors de la création. Il ne fait plus une seconde opération de permissions qui pourrait afficher une fausse erreur après la création du compte.

## Test recommandé

1. Supprimer le compte de test mal provisionné précédemment.
2. Se connecter avec le propriétaire de SITE A.
3. Créer un `operator` avec une nouvelle adresse e-mail.
4. Vérifier `auth.users` et `public.profiles` : même utilisateur, `site_id = SITE A`, `role = operator`.
5. Vérifier qu'aucun nouveau site n'a été créé.
6. Répéter avec `manager`.
7. Tester un double clic : une seule création doit aboutir ; une erreur d'email déjà utilisé doit être explicite.
