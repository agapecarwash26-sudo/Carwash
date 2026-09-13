# Déploiement GitHub Pages — AquaFlow

Le workflow `.github/workflows/deploy.yml` construit et déploie automatiquement `dist` sur GitHub Pages à chaque push sur `main`.

## Secrets GitHub requis

Dans **Settings → Secrets and variables → Actions**, créer :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Ne jamais committer `.env`, `.env.local` ou des clés privées. Le `.gitignore` les exclut.

## Pourquoi le chemin Pages est correct

`vite.config.ts` utilise automatiquement le nom réel du dépôt fourni par `GITHUB_REPOSITORY`. Pour `agapecarwash26-sudo/Carwash`, le site sera donc servi sous `/Carwash/`.

`index.html` utilise un chemin relatif pour le module principal, ce qui évite le classique écran blanc provoqué par `/src/main.tsx` sur un site GitHub Pages en sous-chemin.

Après un push, attendre la fin de **Deploy to GitHub Pages** avant de tester. Si un ancien PWA reste en cache, faire un rechargement forcé ou supprimer les données du site.
