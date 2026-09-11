/*
  Revoke anon EXECUTE on process_offline_operation.
  The migration 20260908011000 only GRANTed to authenticated but did not
  REVOKE from anon, leaving the function callable by unauthenticated users.
*/
REVOKE EXECUTE ON FUNCTION public.process_offline_operation(uuid, text, jsonb) FROM anon;
