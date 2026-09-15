# Migration reconciliation

## Corrective action

The project previously contained migration filenames with two timestamps, e.g. `20260826093426_20260824120843_...`, and several `.sql.sql` names. Supabase migration versions are the leading 14-digit timestamp, so these names can make local history diverge from remote history.

The canonical set is now under `supabase/migrations/`, with one 14-digit version per filename. The duplicate `db/migrations/` SQL history was removed from the deployable project to avoid maintaining two competing histories.

## Important limitation

A local archive cannot reveal the exact migration versions currently stored in a remote Supabase project. After committing this tree, run `supabase migration list` against the linked project. If it still reports a remote version missing locally, that exact remote version must be restored locally (or the remote migration history must be repaired using the Supabase CLI workflow). Do not use SQL Editor to fake migration history.
