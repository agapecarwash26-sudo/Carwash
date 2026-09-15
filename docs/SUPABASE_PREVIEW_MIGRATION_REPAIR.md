# Supabase Preview — migration history is now canonicalized

## What was wrong

The repository contained migration files whose first 14 digits were generated timestamps, while several files contained the actual migration version after the first underscore, for example:

`20260826093426_20260824120843_create_car_wash_core_schema.sql.sql`

Supabase migration history is keyed by the migration version (the leading 14-digit timestamp of the migration filename). If the remote project was created/applied from the original version `20260824120843`, Preview reports:

`Remote migration versions not found in local migrations directory.`

## What this package changes

The duplicated/generated prefixes have been removed. The canonical files now use the migration versions that were already embedded in their names, e.g.:

`20260824120843_create_car_wash_core_schema.sql`

The legacy `db/migrations` copy has also been removed from the package. Supabase CLI uses `supabase/migrations`.

## Important

Do NOT run `supabase db reset` against production.

After committing this package, run:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase migration list
```

If the list is clean, Preview can run normally.

If `migration list` still reports remote versions that are not present locally, those exact versions are from a different history and must be recovered with:

```bash
supabase db pull --linked
```

or, only when the database schema is already known to contain that migration, repaired explicitly with:

```bash
supabase migration repair --status applied <EXACT_VERSION>
```

Never guess a migration version and never delete remote history just to make Preview pass.

## Users / audit runtime patch

The users/audit correction is intentionally kept outside `supabase/migrations` in:

`supabase/patches/20260914_users_audit_runtime_fix.sql`

Run that SQL once in the Supabase SQL Editor, then deploy:

```bash
supabase functions deploy manage-users
```
