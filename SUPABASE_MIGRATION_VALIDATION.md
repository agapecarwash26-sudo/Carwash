# Supabase migration validation

From this project root:

```bash
npx supabase migration list
```

Expected: every Local and Remote version is identical, including `20260915000000`.

Only after that check should you run a Preview/deployment migration workflow. Do not use `migration repair` unless the remote schema/history has first been verified.
