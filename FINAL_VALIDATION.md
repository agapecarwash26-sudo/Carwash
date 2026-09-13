# AquaFlow — validation finale

## 1. Installation locale

```bash
npm ci
cp .env.example .env
# renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run build
npm run dev
```

> Le conteneur de travail utilisé pour cette livraison ne dispose pas d'un accès fiable au registre npm : `npm ci` n'a donc pas pu être terminé ici. Le build final doit être confirmé par GitHub Actions après le push.

## 2. Supabase

Appliquer la nouvelle migration :

`supabase/migrations/20260911100000_fix_atomic_loyalty_transaction.sql`

Elle corrige notamment le calcul atomique de la visite gratuite, conserve les valeurs de fidélité personnalisées et passe le défaut à la 7e visite.

## 3. GitHub Pages

Le dépôt `agapecarwash26-sudo/Carwash` est servi sous `/Carwash/`. Le chemin Vite est calculé automatiquement depuis `GITHUB_REPOSITORY`.

Les secrets Actions requis :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 4. Scénario fonctionnel minimal

- Connexion / création de compte
- Chargement du profil et du site
- Création d'un client + véhicule
- Modification d'un client
- Création/activation/désactivation d'un service
- Création d'une vente avec client
- 7e visite gratuite avec fidélité activée
- Changement du seuil de fidélité depuis Configuration
- Passage hors ligne puis synchronisation
- Création d'une dépense
- Mouvement de stock
- Ouverture/fermeture de caisse
- Rendez-vous et réclamation
- Impression du reçu
- Rapports et export CSV

## 5. Sécurité

Ne jamais ajouter `.env`, une clé service-role Supabase ou un token GitHub au dépôt.
