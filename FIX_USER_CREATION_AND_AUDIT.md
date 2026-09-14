# Correctif définitif utilisateurs / audit

- Déployer les migrations : `supabase db push`
- Déployer Edge Function : `supabase functions deploy manage-users`
- Rebuild/redeploy le frontend.

La création d’un utilisateur dans un site existant utilise explicitement le site du propriétaire et le rôle choisi. Les permissions sont écrites côté serveur. En cas d’échec critique, le compte Auth est supprimé pour éviter les comptes partiellement créés.

Le journal d’audit utilise des triggers DB sur les principales tables et ne bloque jamais une opération métier si l’audit échoue.
