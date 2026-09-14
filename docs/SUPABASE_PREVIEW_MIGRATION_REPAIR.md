# Supabase Preview / migration history repair

## Why Preview fails

The project has a local `supabase/migrations` directory, while the linked Supabase project has migration versions that are not present locally. Supabase compares the local migration filenames with the remote `supabase_migrations.schema_migrations` history. Preview therefore stops before applying new migrations.

The runtime repair in `supabase/patches/` is intentionally **not** a migration. It must be applied once in SQL Editor and does not change migration history.

## One-time repair (do this before relying on Supabase Preview)

From the project root:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase migration list
```

The list shows which migration versions exist remotely but not in the repository.

### Recommended: pull the remote schema/history

If the remote database is the source of truth:

```bash
supabase db pull --linked
supabase migration list
```

Commit the generated remote-schema migration **after reviewing it**. Supabase documents `db pull` as the way to capture remote changes and bring the local project back in sync.

### If a migration was already applied manually

If the schema change already exists remotely and only the history row is missing, repair the history instead of rerunning the SQL:

```bash
supabase migration repair --status applied <MISSING_REMOTE_VERSION>
```

If a history row says a migration was applied but the SQL was never applied, use:

```bash
supabase migration repair --status reverted <VERSION>
```

**Do not guess the version. Use the exact versions printed by `supabase migration list`.**

After repair:

```bash
supabase migration list
supabase db push --dry-run
```

The goal is a clean migration list with no local/remote discrepancy.

## Important

Do not use `supabase db reset --linked` on the production database. It is destructive.

Do not delete remote migration-history rows just to make Preview green. Repair only versions whose actual database state is known.

## Applying the AquaFlow runtime fix

1. Open Supabase Dashboard → SQL Editor.
2. Run `supabase/patches/20260914_users_audit_runtime_fix.sql` once.
3. Run `supabase/patches/VERIFY_USERS_AUDIT.sql` to verify the trigger, tenant scope and audit triggers.
4. Deploy the Edge Function:

```bash
supabase functions deploy manage-users
```

No `supabase db push` is required for this runtime patch.
