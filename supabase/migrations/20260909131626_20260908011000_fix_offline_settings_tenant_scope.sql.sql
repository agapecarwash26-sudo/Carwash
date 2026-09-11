/*
  Fix offline SETTING operations after app_settings became tenant-scoped.
  The operation must write to (site_id, key), never to a global key.
*/
CREATE OR REPLACE FUNCTION public.process_offline_operation(p_operation_id uuid, p_operation_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  existing public.offline_operations%ROWTYPE;
  new_order public.orders%ROWTYPE;
  new_customer public.customers%ROWTYPE;
  new_product public.products%ROWTYPE;
  new_service public.services%ROWTYPE;
  new_expense public.expenses%ROWTYPE;
  new_register public.cash_registers%ROWTYPE;
  customer_id uuid;
  delta numeric;
  result_json jsonb;
BEGIN
  SELECT * INTO existing FROM public.offline_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF existing.user_id <> auth.uid() OR existing.site_id IS DISTINCT FROM current_user_site_id() THEN RAISE EXCEPTION 'Permission refusée pour cette opération.'; END IF;
    IF existing.status = 'synced' THEN RETURN COALESCE(existing.result, '{}'::jsonb); END IF;
    IF existing.status = 'processing' AND existing.completed_at IS NULL THEN
      -- A retried operation is safe because this function and all business writes are one transaction.
      NULL;
    END IF;
  ELSE
    INSERT INTO public.offline_operations(operation_id,user_id,site_id,operation_type,payload,status)
    VALUES(p_operation_id, auth.uid(), current_user_site_id(), p_operation_type, p_payload, 'processing');
  END IF;

  CASE p_operation_type
    WHEN 'VENTE' THEN
      INSERT INTO public.orders(order_number,site_id,customer_name,vehicle_label,total_usd,paid_usd,payment_method,status,personal_items,vehicle_details,created_by)
      VALUES(p_payload->>'orderNumber', current_user_site_id(), COALESCE(p_payload->>'customerName','Client comptoir'), COALESCE(p_payload->>'vehicleLabel','Véhicule à préciser'),
        CASE WHEN COALESCE((p_payload->>'isFreeVisit')::boolean,false) THEN 0 ELSE COALESCE((p_payload->>'totalUsd')::numeric,0) END,
        CASE WHEN COALESCE((p_payload->>'isFreeVisit')::boolean,false) THEN 0 ELSE COALESCE((p_payload->>'totalUsd')::numeric,0) END,
        COALESCE(p_payload->>'paymentMethod','cash'), 'queued', COALESCE(p_payload->>'personalItems',''), COALESCE(p_payload->>'vehicleDetails',''), auth.uid());
      GET STACKED DIAGNOSTICS new_order.order_number = RESULT_OID;
      SELECT * INTO new_order FROM public.orders WHERE order_number = p_payload->>'orderNumber' AND site_id = current_user_site_id();
      result_json := jsonb_build_object('orderId', new_order.id, 'orderNumber', new_order.order_number);
    WHEN 'CONTROLE' THEN
      UPDATE public.orders SET status = p_payload->>'status' WHERE id = (p_payload->>'id')::uuid AND site_id = current_user_site_id();
      result_json := jsonb_build_object('updated', true);
    WHEN 'CLIENT' THEN
      INSERT INTO public.customers(site_id, full_name, phone, email)
      VALUES(current_user_site_id(), p_payload->>'full_name', p_payload->>'phone', NULLIF(p_payload->>'email',''))
      RETURNING * INTO new_customer;
      result_json := jsonb_build_object('customerId', new_customer.id);
    WHEN 'SERVICE' THEN
      INSERT INTO public.services(site_id, name, category, price_usd, price_cdf, duration_minutes, is_active)
      VALUES(current_user_site_id(), p_payload->>'name', p_payload->>'category', COALESCE((p_payload->>'price_usd')::numeric,0), COALESCE((p_payload->>'price_cdf')::numeric,0), COALESCE((p_payload->>'duration_minutes')::integer,30), true)
      RETURNING * INTO new_service;
      result_json := jsonb_build_object('serviceId', new_service.id);
    WHEN 'SERVICE_UPDATE' THEN
      UPDATE public.services SET name = p_payload->>'name', category = p_payload->>'category', price_usd = COALESCE((p_payload->>'price_usd')::numeric,0), price_cdf = COALESCE((p_payload->>'price_cdf')::numeric,0), duration_minutes = COALESCE((p_payload->>'duration_minutes')::integer,30) WHERE id = (p_payload->>'id')::uuid AND site_id = current_user_site_id();
      result_json := jsonb_build_object('updated', true);
    WHEN 'REAPPRO' THEN
      INSERT INTO public.stock_movements(product_id, type, quantity, reason, site_id)
      VALUES((p_payload->>'productId')::uuid, p_payload->>'type', COALESCE((p_payload->>'quantity')::integer,0), p_payload->>'reason', current_user_site_id());
      UPDATE public.products SET current_stock = current_stock + CASE WHEN p_payload->>'type' = 'in' THEN COALESCE((p_payload->>'quantity')::integer,0) ELSE -COALESCE((p_payload->>'quantity')::integer,0) END WHERE id = (p_payload->>'productId')::uuid AND site_id = current_user_site_id();
      result_json := jsonb_build_object('updated', true);
    WHEN 'DEPENSE' THEN
      INSERT INTO public.expenses(site_id, category, description, amount, currency, status)
      VALUES(current_user_site_id(), p_payload->>'category', p_payload->>'description', COALESCE((p_payload->>'amount')::numeric,0), COALESCE(p_payload->>'currency','USD'), 'pending');
      result_json := jsonb_build_object('created', true);
    WHEN 'DEPENSE_STATUS' THEN
      UPDATE public.expenses SET status = p_payload->>'status' WHERE id = (p_payload->>'id')::uuid AND site_id = current_user_site_id();
      result_json := jsonb_build_object('updated', true);
    WHEN 'CAISSE' THEN
      IF p_payload->>'action' = 'open' THEN
        INSERT INTO public.cash_registers(site_id, opening_usd, opening_cdf, status, opened_by)
        VALUES(current_user_site_id(), COALESCE((p_payload->>'openingUsd')::numeric,0), 0, 'open', auth.uid());
        SELECT * INTO new_register FROM public.cash_registers WHERE site_id = current_user_site_id() AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
        result_json := jsonb_build_object('registerId', new_register.id);
      ELSIF p_payload->>'action' = 'close' THEN
        UPDATE public.cash_registers SET closing_usd = COALESCE((p_payload->>'closingUsd')::numeric,0), closing_cdf = 0, status = 'closed', closed_at = now(), closed_by = auth.uid() WHERE id = (p_payload->>'id')::uuid AND site_id = current_user_site_id();
        result_json := jsonb_build_object('closed', true);
      END IF;
    WHEN 'RENDEZ_VOUS' THEN
      INSERT INTO public.appointments(site_id, customer_name, vehicle_label, service_name, starts_at, status)
      VALUES(current_user_site_id(), p_payload->>'customer_name', p_payload->>'vehicle_label', p_payload->>'service_name', p_payload->>'starts_at', 'confirmed');
      result_json := jsonb_build_object('created', true);
    WHEN 'RECLAMATION' THEN
      INSERT INTO public.complaints(site_id, customer_name, subject, description, priority, status)
      VALUES(current_user_site_id(), p_payload->>'customer_name', p_payload->>'subject', p_payload->>'description', COALESCE(p_payload->>'priority','normal'), 'new');
      result_json := jsonb_build_object('created', true);
    WHEN 'SETTING' THEN
      INSERT INTO public.app_settings (site_id, key, value, updated_at)
      VALUES (current_user_site_id(), p_payload->>'key', p_payload->>'value', now())
      ON CONFLICT (site_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      result_json := jsonb_build_object('saved', true);
    ELSE
      RAISE EXCEPTION 'Type d''opération non reconnu: %', p_operation_type;
  END CASE;

  UPDATE public.offline_operations SET status = 'synced', completed_at = now(), result = result_json
  WHERE operation_id = p_operation_id;
  RETURN result_json;
END;
$$;
