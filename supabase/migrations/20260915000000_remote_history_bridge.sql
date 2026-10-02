-- Remote migration history bridge.
-- Supabase reports version 20260915000000 as already applied remotely,
-- but its original SQL body is not present in the supplied project archive.
-- Keep this migration intentionally side-effect free: it reconciles the
-- local migration filename set with the remote migration history without
-- inventing or replaying unknown production SQL.
DO $$
BEGIN
  NULL;
END $$;
