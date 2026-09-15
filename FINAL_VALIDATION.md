# Validation finale AquaFlow

## Vérifications statiques effectuées
- Structure Vite/React vérifiée.
- `package.json` vérifié ; le dépôt n'embarque pas de `package-lock.json`, donc GitHub Actions utilise `npm install`.
- `tsconfig.json` en mode strict.
- Imports locaux vérifiés par inspection.
- Chemins GitHub Pages vérifiés : le `base` est dérivé de `GITHUB_REPOSITORY`.
- Service Worker enregistré avec `import.meta.env.BASE_URL`.
- `.env` et fichiers secrets exclus par `.gitignore`.
- Migrations Supabase inspectées.
- Doublons de migrations historiques supprimés pour éviter une seconde exécution sur une installation neuve.
- Migration d'installation hardening conservée dans sa version avec l'index `(site_id,key)` créé avant le bootstrap qui l'utilise.
- Fidélité par défaut finalisée à 7 visites et paramétrable par site.
- Correction atomique de la fidélité et journalisation `loyalty_transactions` présentes.

## Limite honnête
Le build npm n'a pas pu être exécuté dans cet environnement car les paquets npm nécessaires ne sont pas disponibles dans le cache local et l'accès au registre a expiré. Le build réel doit donc être confirmé par GitHub Actions après le push.

## Avant le push
1. Décompresser le ZIP à la racine du dépôt local.
2. Vérifier que `.env` n'est pas présent.
3. Commit + push sur `main`.
4. Ouvrir l'onglet **Actions** du dépôt et attendre le workflow `Deploy to GitHub Pages`.
5. En cas d'échec, récupérer le log du step `Build` avant toute autre modification.

- Création utilisateurs durcie : Auth -> profile -> permissions -> audit avec rollback compensatoire en cas d'échec.
- Le `site_id` et le rôle des comptes créés par owner/admin sont imposés côté serveur et vérifiés avant succès.
