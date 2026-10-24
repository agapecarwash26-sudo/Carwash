# Déploiement GitHub Pages — AquaFlow

Le workflow `.github/workflows/deploy.yml` construit l'application Vite puis déploie **uniquement le dossier `dist`** avec le mécanisme officiel GitHub Pages.

## Ce qui a été corrigé

- `actions/upload-pages-artifact` est en `v4`.
- `actions/configure-pages` est en `v5`.
- `actions/deploy-pages` est en `v4`.
- permissions `pages: write` et `id-token: write` conservées.
- environnement `github-pages` explicitement utilisé.
- cache npm activé via `setup-node`.
- `npm install --no-audit --no-fund` conservé car le projet ne contient pas encore de `package-lock.json`.
- vérification explicite de `dist/index.html` avant l'upload.
- timeout de 15 minutes pour le build et de 10 minutes pour le déploiement afin d'éviter une attente infinie.
- concurrence limitée à un seul déploiement Pages à la fois.

## Secrets GitHub requis

Dans **Settings → Secrets and variables → Actions**, créer :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Ne jamais committer `.env`, `.env.local` ou des clés privées.

## Réglage GitHub Pages obligatoire

Dans le dépôt GitHub :

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Le workflow officiel `deploy-pages` est conçu pour cette source. Si Pages est configuré sur une branche (`Deploy from a branch`) alors que ce workflow utilise `actions/deploy-pages`, le déploiement peut ne pas se comporter comme prévu.

## Après le push

1. Ouvrir **Actions → Deploy to GitHub Pages**.
2. Vérifier `Build` puis `Deploy`.
3. Si `Deploy` dépasse 10 minutes, le job échoue volontairement au lieu de rester bloqué indéfiniment. Dans ce cas, vérifier **Settings → Pages** et l'historique des déploiements Pages.

## Chemin GitHub Pages

`vite.config.ts` détecte automatiquement `GITHUB_REPOSITORY` et utilise `/NomDuDepot/` comme `base` sur GitHub Pages.

Pour `agapecarwash26-sudo/Carwash`, le chemin attendu est donc `/Carwash/`.

## Remarque sur le lockfile

Le projet n'avait pas de `package-lock.json`. Une tentative de génération automatique du lockfile n'a pas terminé dans l'environnement de préparation. Pour cette raison, cette version ne bascule pas artificiellement vers `npm ci` : cela provoquerait une erreur `lock file not found`.
