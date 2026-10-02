# Migration history reconciliation

This package is aligned with the migration versions currently reported by the linked Supabase project.

Important: Supabase currently reports remote migration `20260915000000`, but the source package did not contain the SQL body for that remote migration. The local file below is therefore a **history bridge/no-op** so the local migration version set matches the remote history without inventing SQL or changing the database.

If `20260915000000` contained real schema changes made directly on the remote database, those changes must be captured separately with `supabase db pull` before treating a clean Preview database as a byte-for-byte reconstruction of production.

Do not run `db reset` against production.
