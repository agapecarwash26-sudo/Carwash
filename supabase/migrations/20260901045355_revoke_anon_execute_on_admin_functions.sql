/*
# Revoke anon access to admin user-management functions

## Why
The security advisor flagged that `admin_create_user` and `admin_delete_user`
are SECURITY DEFINER functions executable by the `anon` role. This means anyone
on the internet could create or delete user accounts without signing in.

## Changes
1. Revoke EXECUTE from `anon` on `admin_create_user`.
2. Revoke EXECUTE from `anon` on `admin_delete_user`.
3. Keep EXECUTE on `authenticated` so logged-in admins can still use them
   through the manage-users edge function (which sends the user's JWT).

## Security impact
- Unauthenticated requests can no longer call these functions via the REST API.
- Authenticated users still need to pass the edge function's own authorization
  check (owner/admin role verification) before the function is invoked.
*/

REVOKE EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon;
