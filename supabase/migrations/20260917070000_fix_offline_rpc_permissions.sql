-- Allow authenticated users to synchronize permitted offline operations through the trusted RPC.
-- The function itself enforces tenant isolation with auth.uid() and current_user_site_id().
ALTER FUNCTION public.process_offline_operation(uuid, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.process_offline_operation(uuid, text, jsonb) SET search_path = public;
REVOKE ALL ON FUNCTION public.process_offline_operation(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_offline_operation(uuid, text, jsonb) TO authenticated;
