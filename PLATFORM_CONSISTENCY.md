# AquaFlow — Platform Consistency Hardening

## Référentiel temps
- Fuseau métier unique : `Africa/Lubumbashi` (UTC+02).
- Supabase conserve les `timestamptz` en UTC.
- Les dates d'affichage et les filtres calendaires utilisent la date métier de Lubumbashi.
- Les opérations offline conservent leur `createdAt` UTC d'origine lors du replay.

## Véhicules traités
Le dashboard compte un véhicule traité uniquement lorsque la commande est `completed`/`delivered` et que `completed_at` tombe dans le jour métier sélectionné.

## Chiffre d'affaires
Le CA du dashboard et des rapports repose sur les lignes `payments` dont le statut est `succeeded`.
- USD : montant utilisé directement.
- CDF : conversion en USD avec le taux de change enregistré sur la commande.
- Les commandes créées mais sans paiement réussi ne sont pas additionnées au CA.

## Impression P5_30D8
- Android / Windows : chemin Bluetooth Web Bluetooth existant conservé.
- iOS : Web Bluetooth n'étant pas disponible dans Safari, génération d'un reçu HTML au format thermique puis ouverture de l'impression native iOS.
- Les UUID GATT/service/caractéristique restent configurables dans `thermalPrinter.ts` pour une identification protocolaire ultérieure.

## Migration Supabase
Appliquer `supabase/migrations/20261002000000_platform_consistency_hardening.sql` après les migrations existantes.

> Le build npm complet n'a pas pu être exécuté dans l'environnement d'audit : l'installation des dépendances a dépassé le délai disponible. Les fichiers modifiés ont néanmoins été contrôlés structurellement et les flux/référentiels concernés ont été inspectés.
