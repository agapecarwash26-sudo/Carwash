-- AquaFlow: stock model = exactly two stock levels.
-- 1) used_stock       = stock used operationally
-- 2) security_stock   = stock kept as security level
-- There is no target stock and no third stock level in the application logic.
-- The legacy used_stock_target column is intentionally left in the database for
-- backward compatibility with older installations, but it is no longer read,
-- written or used by the current application.

-- The RPC must execute its atomic stock transaction with the caller's identity
-- while bypassing table RLS for its internal writes. Site access is still checked
-- explicitly inside the function.
ALTER FUNCTION public.process_offline_operation(uuid, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.process_offline_operation(uuid, text, jsonb) SET search_path = public;
REVOKE ALL ON FUNCTION public.process_offline_operation(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_offline_operation(uuid, text, jsonb) TO authenticated;

COMMENT ON COLUMN public.products.used_stock IS 'Stock utilisé opérationnellement.';
COMMENT ON COLUMN public.products.security_stock IS 'Stock de sécurité. Aucun troisième niveau de stock.';
COMMENT ON COLUMN public.products.used_stock_target IS 'LEGACY UNIQUEMENT: non utilisé par AquaFlow. Le modèle actuel comporte seulement stock utilisé et stock de sécurité.';
