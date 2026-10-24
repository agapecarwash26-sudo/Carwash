# Correction création des utilisateurs — migrations inchangées

Cette version part de `AquaFlow-SUPABASE-PREVIEW-CORRIGE-FINAL(1).zip`.
Aucun fichier de `supabase/migrations/` n'a été modifié, ajouté ou renommé.

## Déploiement requis

Depuis la racine du projet :

```bash
npx supabase functions deploy manage-users --project-ref webayzaxiqpmtziasisx
```

Ne lancez pas `supabase db push` pour cette correction.

## Pourquoi le déploiement est important

La fonction `manage-users` doit envoyer `app_metadata.site_id` et `app_metadata.role` au moment de `auth.admin.createUser()`.
Le trigger SQL déjà présent dans la version de base utilise ces métadonnées pour créer `profiles` dans le bon site avec le bon rôle.

La nouvelle fonction vérifie ensuite le profil créé. Si le profil est absent, appartient à un autre site ou possède un autre rôle, elle supprime immédiatement le compte Auth nouvellement créé et retourne l'erreur au lieu de laisser un compte partiellement provisionné.

Les permissions de menus sont également enregistrées côté serveur dans le même appel HTTP ; le navigateur ne fait plus un second RPC qui pouvait transformer une création réussie en message d'erreur.

## Tests

1. Supprimer le compte de test actuellement mal provisionné.
2. Connecté comme propriétaire de SITE A, créer un Opérateur.
3. Vérifier `profiles.role = operator` et `profiles.site_id = SITE A`.
4. Vérifier qu'aucun nouveau site n'a été créé.
5. Créer ensuite un Manager.
6. Tester une adresse déjà utilisée : l'interface doit afficher une erreur claire sans créer de doublon.
7. Vérifier les permissions de menus sélectionnées.
