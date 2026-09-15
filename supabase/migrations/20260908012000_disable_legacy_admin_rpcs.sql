/*
  Tenant-safe admin RPC cleanup.

  The application manages users through the `manage-users` Edge Function.
  The legacy SQL admin RPCs are kept for compatibility but are no longer
  callable by client roles. This prevents an old RPC from bypassing the
  tenant-scoped Edge Function checks.
*/

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_role(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon, authenticated;
