# Supabase migrations

Migration filenames use the canonical Supabase migration version (14-digit prefix).
Do not add a second generated timestamp in front of an existing migration version.
The `db/migrations` directory is legacy/reference only; Supabase Preview reads `supabase/migrations`.

If Preview still reports a remote version missing locally, run `supabase migration list` against the same project and add/restore that exact remote version file before deploying.
