# AquaFlow — architecture Offline

## Architecture intégrée

- **Détection réseau** : `navigator.onLine` + test Internet réel + ping authentifié de l'API Supabase.
- **Mode forcé** : persistant dans IndexedDB; aucune requête backend n'est lancée tant qu'il est actif.
- **IndexedDB** : stores `operations`, `cache`, `meta`.
- **Queue** : UUID d'opération, type, paramètres, création, statut, tentatives, résultat, erreur, utilisateur et site.
- **Synchronisation** : séquentielle, ordre FIFO, verrou local contre deux synchronisations concurrentes, reprise après fermeture/rechargement.
- **Idempotence serveur** : `offline_operations.operation_id` + RPC `process_offline_operation`. L'UUID est généré avant le premier appel réseau et réutilisé si la réponse est perdue.
- **Transactions** : ventes, paiements inclus, mouvements de stock et opérations de caisse sont regroupés dans une seule RPC transactionnelle.
- **Sécurité** : la RPC est `SECURITY INVOKER`; les RLS existantes restent la barrière d'autorisation et de tenant. Le snapshot Offline ne contient aucun mot de passe.
- **Session Offline** : snapshot de profil limité à 8h; après expiration, réauthentification nécessaire.
- **PWA** : Service Worker avec navigation network-first et ressources statiques stale-while-revalidate.

## Opérations Offline intégrées

`VENTE`, `CONTROLE`, `ANNULATION`, `REAPPRO`, `CAISSE`, `PAIEMENT_CREDIT`, `CLIENT`, `DEPENSE`, `DEPENSE_STATUS`, `RENDEZ_VOUS`, `RECLAMATION`, `SETTING`, `SERVICE`, `SERVICE_UPDATE`.

Les opérations d'administration sensibles (gestion des comptes utilisateurs, mots de passe) restent en ligne par conception.

## Déploiement

1. Appliquer `supabase/migrations/20260907110000_add_offline_idempotency_and_sync.sql`.
2. Vérifier que les migrations précédentes de `site_id` et RLS sont appliquées avant celle-ci.
3. Déployer le frontend Vite normalement sur GitHub Pages.
4. Lors d'une modification du Service Worker, incrémenter `VERSION` dans `public/sw.js`.
5. Tester le mode Offline sur un appareil réel après une première ouverture en ligne.

## Nettoyage

Le bouton « Vider le cache » efface uniquement le store IndexedDB `cache`. La file `operations` n'est jamais supprimée par ce bouton.


## Garantie de reprise de synchronisation

La file IndexedDB est la source de vérité locale pour les opérations non encore confirmées par Supabase. Une opération marquée `processing` depuis plus de 2 minutes est automatiquement récupérée après un redémarrage ou une fermeture brutale.

La synchronisation est relancée :
- au démarrage après restauration de session ;
- à chaque événement navigateur `online` ;
- toutes les 30 secondes lorsque l'application reste ouverte ;
- lors de la désactivation du mode Offline forcé ;
- via le bouton « Synchroniser maintenant ».

Chaque opération conserve son UUID d'origine. Le RPC `process_offline_operation` doit donc être déployé dans Supabase avant de mettre le frontend en production.
