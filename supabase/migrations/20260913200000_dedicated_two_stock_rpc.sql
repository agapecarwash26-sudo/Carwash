-- AquaFlow: dedicated RPC for the ONLY two stock levels.
-- used_stock = stock used
-- security_stock = stock de sécurité
-- used_up transfers exactly 1 unit: security -1, used +1.

CREATE OR REPLACE FUNCTION public.adjust_stock_two_levels(
  p_operation_id uuid,
  p_product_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.products%ROWTYPE;
  result_json jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié.';
  END IF;

  SELECT * INTO p
  FROM public.products
  WHERE id = p_product_id
    AND site_id = public.current_user_site_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit introuvable ou accès refusé.';
  END IF;

  IF p_action = 'used_down' THEN
    IF COALESCE(p.used_stock, 0) <= 0 THEN
      RAISE EXCEPTION 'Le stock utilisé est déjà à 0.';
    END IF;

    UPDATE public.products
    SET used_stock = used_stock - 1,
        current_stock = used_stock - 1
    WHERE id = p.id;

    INSERT INTO public.stock_movements(product_id, type, quantity, reason, created_by)
    VALUES (p.id, 'out', 1, '-1 stock utilisé', auth.uid());

  ELSIF p_action = 'used_up' THEN
    IF COALESCE(p.security_stock, 0) <= 0 THEN
      RAISE EXCEPTION 'Le stock de sécurité est à 0.';
    END IF;

    UPDATE public.products
    SET used_stock = used_stock + 1,
        security_stock = security_stock - 1,
        current_stock = used_stock + 1
    WHERE id = p.id;

    INSERT INTO public.stock_movements(product_id, type, quantity, reason, created_by)
    VALUES (p.id, 'in', 1, '+1 stock utilisé / -1 stock de sécurité', auth.uid());

  ELSIF p_action = 'security_up' THEN
    UPDATE public.products
    SET security_stock = security_stock + 1,
        current_stock = used_stock
    WHERE id = p.id;

    INSERT INTO public.stock_movements(product_id, type, quantity, reason, created_by)
    VALUES (p.id, 'in', 1, '+1 stock de sécurité', auth.uid());

  ELSE
    RAISE EXCEPTION 'Action de stock inconnue: %', p_action;
  END IF;

  SELECT jsonb_build_object(
    'id', id,
    'used_stock', used_stock,
    'security_stock', security_stock,
    'current_stock', current_stock,
    'used_stock_minimum', used_stock_minimum,
    'security_stock_minimum', security_stock_minimum
  ) INTO result_json
  FROM public.products
  WHERE id = p.id;

  -- Mark the offline operation as synchronized when this RPC is replaying one.
  UPDATE public.offline_operations
  SET status = 'synced', result = result_json, completed_at = now(), error = NULL
  WHERE operation_id = p_operation_id;

  RETURN result_json;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.offline_operations
  SET status = 'failed', error = SQLERRM
  WHERE operation_id = p_operation_id;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_two_levels(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_two_levels(uuid, uuid, text) TO authenticated;
