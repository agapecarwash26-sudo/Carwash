-- Complete business hardening: two-level stock, discounts/currency, ordered offline states, per-user menu permissions.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS used_stock numeric(14,3) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS used_stock_minimum numeric(14,3) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS used_stock_target numeric(14,3) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS security_stock numeric(14,3) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS security_stock_minimum numeric(14,3) NOT NULL DEFAULT 0;
UPDATE public.products SET used_stock=CASE WHEN used_stock=0 THEN current_stock ELSE used_stock END, used_stock_minimum=CASE WHEN used_stock_minimum=0 THEN minimum_stock ELSE used_stock_minimum END, used_stock_target=CASE WHEN used_stock_target=0 THEN current_stock ELSE used_stock_target END WHERE used_stock=0 OR used_stock_minimum=0 OR used_stock_target=0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_version integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS subtotal_usd numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS discount_amount_usd numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS discount_percent numeric(7,3) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS payment_amount numeric(14,2), ADD COLUMN IF NOT EXISTS payment_currency text;
UPDATE public.orders SET last_status_change_at=created_at, subtotal_usd=CASE WHEN subtotal_usd=0 THEN total_usd ELSE subtotal_usd END, payment_amount=COALESCE(payment_amount,paid_usd), payment_currency=COALESCE(payment_currency,'USD');
CREATE TABLE IF NOT EXISTS public.user_menu_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,menu_key text NOT NULL,can_view boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(site_id,user_id,menu_key));
ALTER TABLE public.user_menu_permissions ENABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS user_menu_permissions_select ON public.user_menu_permissions; DROP POLICY IF EXISTS user_menu_permissions_manage ON public.user_menu_permissions; CREATE POLICY user_menu_permissions_select ON public.user_menu_permissions FOR SELECT TO authenticated USING(site_id=public.current_user_site_id() AND (user_id=auth.uid() OR public.current_user_role() IN ('owner','admin'))); CREATE POLICY user_menu_permissions_manage ON public.user_menu_permissions FOR ALL TO authenticated USING(site_id=public.current_user_site_id() AND public.current_user_role() IN ('owner','admin')) WITH CHECK(site_id=public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));
CREATE OR REPLACE FUNCTION public.set_user_menu_permissions(p_user_id uuid,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r jsonb; BEGIN IF public.current_user_role() NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Accès refusé'; END IF; IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND site_id=public.current_user_site_id()) THEN RAISE EXCEPTION 'Utilisateur introuvable'; END IF; DELETE FROM user_menu_permissions WHERE user_id=p_user_id AND site_id=public.current_user_site_id(); FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_permissions,'[]'::jsonb)) LOOP IF COALESCE(r->>'menu_key','')<>'' AND COALESCE((r->>'can_view')::boolean,true) THEN INSERT INTO user_menu_permissions(site_id,user_id,menu_key) VALUES(public.current_user_site_id(),p_user_id,r->>'menu_key') ON CONFLICT(site_id,user_id,menu_key) DO UPDATE SET can_view=true,updated_at=now(); END IF; END LOOP; RETURN jsonb_build_object('user_id',p_user_id,'saved',true); END; $$; REVOKE ALL ON FUNCTION public.set_user_menu_permissions(uuid,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.set_user_menu_permissions(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_user_menu_permissions(p_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT CASE WHEN count(*)=0 THEN NULL ELSE jsonb_agg(jsonb_build_object('menu_key',menu_key,'can_view',can_view) ORDER BY menu_key) END FROM public.user_menu_permissions WHERE site_id=public.current_user_site_id() AND user_id=p_user_id; $$; REVOKE ALL ON FUNCTION public.get_user_menu_permissions(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_user_menu_permissions(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.process_order_status(p_operation_id uuid,p_order_id uuid,p_status text,p_operation_created_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE o orders%ROWTYPE; BEGIN SELECT * INTO o FROM orders WHERE id=p_order_id AND site_id=public.current_user_site_id() FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable'; END IF; IF o.last_status_change_at>p_operation_created_at THEN IF o.status=p_status THEN RETURN jsonb_build_object('id',o.id,'status',o.status,'ignored',true); END IF; RAISE EXCEPTION 'SYNC_CONFLICT: transition ancienne refusée'; END IF; UPDATE orders SET status=p_status,started_at=CASE WHEN p_status='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN p_status='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,order_version=order_version+1,last_status_change_at=p_operation_created_at WHERE id=o.id; RETURN jsonb_build_object('id',o.id,'status',p_status,'version',o.order_version+1); END; $$; REVOKE ALL ON FUNCTION public.process_order_status(uuid,uuid,text,timestamptz) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.process_order_status(uuid,uuid,text,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.consume_product_stock(p_product_id uuid,p_quantity numeric,p_reason text DEFAULT 'Consommation') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE p products%ROWTYPE; q numeric:=greatest(coalesce(p_quantity,0),0); after_used numeric; refill numeric; BEGIN IF q<=0 THEN RAISE EXCEPTION 'Quantité invalide'; END IF; SELECT * INTO p FROM products WHERE id=p_product_id AND site_id=public.current_user_site_id() FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Produit introuvable'; END IF; IF p.used_stock+p.security_stock<q THEN RAISE EXCEPTION 'Stock insuffisant'; END IF; after_used:=greatest(0,p.used_stock-q); refill:=least(p.security_stock,greatest(0,p.used_stock_target-after_used)); UPDATE products SET used_stock=after_used+refill,security_stock=p.security_stock-refill,current_stock=after_used+refill WHERE id=p.id; INSERT INTO stock_movements(product_id,type,quantity,reason,created_by) VALUES(p.id,'out',q,p_reason,auth.uid()); RETURN jsonb_build_object('id',p.id,'used_stock',after_used+refill,'security_stock',p.security_stock-refill,'critical_used',after_used+refill<=p.used_stock_minimum,'critical_security',p.security_stock-refill<=p.security_stock_minimum); END; $$; REVOKE ALL ON FUNCTION public.consume_product_stock(uuid,numeric,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.consume_product_stock(uuid,numeric,text) TO authenticated;

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
  loyalty_enabled boolean := true;
  loyalty_visits_for_free integer := 7;
  loyalty_points_per_visit integer := 10;
  loyalty_is_free boolean := false;
  exchange_rate numeric := 2850;
  subtotal_usd numeric := 0;
  discount_amount_usd numeric := 0;
  payment_amount numeric := 0;
  payment_currency text := 'USD';
  operation_created_at timestamptz := now();
BEGIN
  SELECT * INTO existing FROM public.offline_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF existing.user_id <> auth.uid() OR existing.site_id IS DISTINCT FROM current_user_site_id() THEN
      RAISE EXCEPTION 'Permission refusée pour cette opération.';
    END IF;
    IF existing.status = 'synced' THEN RETURN COALESCE(existing.result, '{}'::jsonb); END IF;
  ELSE
    INSERT INTO public.offline_operations(operation_id,user_id,site_id,operation_type,payload,status)
    VALUES(p_operation_id, auth.uid(), current_user_site_id(), p_operation_type, p_payload, 'processing');
  END IF;

  SELECT COALESCE(value = 'true', true) INTO loyalty_enabled
  FROM public.app_settings
  WHERE site_id = current_user_site_id() AND key = 'loyalty_enabled';
  SELECT GREATEST(1, COALESCE(NULLIF(value, '')::integer, 7)) INTO loyalty_visits_for_free
  FROM public.app_settings
  WHERE site_id = current_user_site_id() AND key = 'loyalty_visits_for_free';
  SELECT GREATEST(0, COALESCE(NULLIF(value, '')::integer, 10)) INTO loyalty_points_per_visit
  FROM public.app_settings
  WHERE site_id = current_user_site_id() AND key = 'loyalty_points_per_visit';

  loyalty_enabled := COALESCE(loyalty_enabled, true);
  loyalty_visits_for_free := COALESCE(loyalty_visits_for_free, 7);
  loyalty_points_per_visit := COALESCE(loyalty_points_per_visit, 10);
  SELECT COALESCE(NULLIF(value,'')::numeric,2850) INTO exchange_rate FROM public.app_settings WHERE site_id=current_user_site_id() AND key='usd_to_cdf_rate';
  exchange_rate := COALESCE(exchange_rate,2850);
  SELECT created_at INTO operation_created_at FROM public.offline_operations WHERE operation_id=p_operation_id;
  operation_created_at := COALESCE(operation_created_at,now());

  CASE p_operation_type
    WHEN 'VENTE' THEN
      customer_id := NULLIF(p_payload->>'customerId', '')::uuid;
      subtotal_usd := GREATEST(COALESCE((p_payload->>'subtotalUsd')::numeric,(p_payload->>'totalUsd')::numeric,0),0);
      discount_amount_usd := LEAST(subtotal_usd,GREATEST(COALESCE((p_payload->>'discountAmountUsd')::numeric,0),0));
      payment_currency := UPPER(COALESCE(NULLIF(p_payload->>'paymentCurrency',''),'USD'));
      IF payment_currency NOT IN ('USD','CDF') THEN payment_currency:='USD'; END IF;
      payment_amount := CASE WHEN payment_currency='CDF' THEN GREATEST(subtotal_usd-discount_amount_usd,0)*exchange_rate ELSE GREATEST(subtotal_usd-discount_amount_usd,0) END;
      IF customer_id IS NOT NULL THEN
        SELECT * INTO new_customer FROM public.customers WHERE id=customer_id AND site_id=current_user_site_id() FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable ou accès refusé.'; END IF;
        loyalty_is_free := loyalty_enabled AND ((new_customer.visits+1) % loyalty_visits_for_free = 0);
        UPDATE public.customers SET visits=visits+1, loyalty_points=loyalty_points+CASE WHEN loyalty_enabled THEN loyalty_points_per_visit ELSE 0 END, total_spent=total_spent+CASE WHEN loyalty_is_free THEN 0 ELSE GREATEST(subtotal_usd-discount_amount_usd,0) END, updated_at=now() WHERE id=customer_id RETURNING * INTO new_customer;
      END IF;
      INSERT INTO public.orders(order_number,site_id,customer_id,customer_name,vehicle_label,total_usd,paid_usd,payment_method,status,personal_items,vehicle_details,created_by,subtotal_usd,discount_amount_usd,discount_percent,payment_amount,payment_currency,order_version,last_status_change_at)
      VALUES(p_payload->>'orderNumber',current_user_site_id(),customer_id,COALESCE(p_payload->>'customerName','Client comptoir'),COALESCE(p_payload->>'vehicleLabel','Véhicule à préciser'),CASE WHEN loyalty_is_free THEN 0 ELSE GREATEST(subtotal_usd-discount_amount_usd,0) END,CASE WHEN loyalty_is_free THEN 0 ELSE GREATEST(subtotal_usd-discount_amount_usd,0) END,CASE WHEN loyalty_is_free THEN 'Offert (fidélité)' ELSE COALESCE(p_payload->>'paymentMethod','cash_usd') END,'queued',NULLIF(p_payload->>'personalItems',''),NULLIF(p_payload->>'vehicleDetails',''),auth.uid(),subtotal_usd,discount_amount_usd,CASE WHEN subtotal_usd>0 THEN discount_amount_usd/subtotal_usd*100 ELSE 0 END,CASE WHEN loyalty_is_free THEN 0 ELSE payment_amount END,CASE WHEN loyalty_is_free THEN 'USD' ELSE payment_currency END,0,operation_created_at)
      RETURNING * INTO new_order;
      IF customer_id IS NOT NULL AND loyalty_enabled THEN
        INSERT INTO public.loyalty_transactions(customer_id,order_id,points,transaction_type,description,created_by) VALUES(customer_id,new_order.id,loyalty_points_per_visit, 'earned',CASE WHEN loyalty_is_free THEN 'Visite enregistrée — lavage offert' ELSE 'Points gagnés pour la visite' END,auth.uid());
      END IF;
      INSERT INTO public.order_items(order_id,service_id,service_name,quantity,unit_price_usd) VALUES(new_order.id,(p_payload->>'serviceId')::uuid,CASE WHEN loyalty_is_free THEN (p_payload->>'serviceName')||' (Offert - fidélité)' ELSE p_payload->>'serviceName' END,1,CASE WHEN loyalty_is_free THEN 0 ELSE GREATEST(subtotal_usd-discount_amount_usd,0) END);
      INSERT INTO public.payments(order_id,site_id,method,amount,currency,status,created_by) VALUES(new_order.id,current_user_site_id(),CASE WHEN loyalty_is_free THEN 'loyalty' ELSE COALESCE(p_payload->>'paymentMethod','cash_usd') END,CASE WHEN loyalty_is_free THEN 0 ELSE payment_amount END,CASE WHEN loyalty_is_free THEN 'USD' ELSE payment_currency END,'succeeded',auth.uid());
      result_json:=jsonb_build_object('id',new_order.id,'order_number',new_order.order_number,'customer_name',new_order.customer_name,'vehicle_label',new_order.vehicle_label,'total_usd',new_order.total_usd,'paid_usd',new_order.paid_usd,'payment_method',new_order.payment_method,'status',new_order.status,'assigned_employee',new_order.assigned_employee,'arrived_at',new_order.arrived_at,'created_at',new_order.created_at,'personal_items',new_order.personal_items,'vehicle_details',new_order.vehicle_details,'is_free_visit',loyalty_is_free,'customer_id',new_order.customer_id,'service_id',p_payload->>'serviceId','subtotal_usd',subtotal_usd,'discount_amount_usd',discount_amount_usd,'payment_amount',new_order.payment_amount,'payment_currency',new_order.payment_currency,'exchange_rate',exchange_rate);
    WHEN 'ANNULATION' THEN
      UPDATE public.orders SET status='cancelled',order_version=order_version+1,last_status_change_at=GREATEST(last_status_change_at,operation_created_at) WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id() AND last_status_change_at<=operation_created_at;
      IF NOT FOUND THEN SELECT * INTO new_order FROM public.orders WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id(); IF new_order.status='cancelled' THEN result_json:=jsonb_build_object('id',new_order.id,'status','cancelled','ignored',true); ELSE RAISE EXCEPTION 'SYNC_CONFLICT: transition ancienne refusée'; END IF; ELSE result_json:=jsonb_build_object('id',p_payload->>'id','status','cancelled'); END IF;
    WHEN 'CONTROLE' THEN
      UPDATE public.orders SET status=p_payload->>'status',started_at=CASE WHEN p_payload->>'status'='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN p_payload->>'status'='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,order_version=order_version+1,last_status_change_at=operation_created_at WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id() AND last_status_change_at<=operation_created_at;
      IF NOT FOUND THEN SELECT * INTO new_order FROM public.orders WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id(); IF new_order.status=p_payload->>'status' THEN result_json:=jsonb_build_object('id',new_order.id,'status',new_order.status,'ignored',true); ELSE RAISE EXCEPTION 'SYNC_CONFLICT: transition ancienne refusée'; END IF; ELSE result_json:=jsonb_build_object('id',p_payload->>'id','status',p_payload->>'status'); END IF;
    WHEN 'REAPPRO' THEN
      SELECT * INTO new_product FROM public.products WHERE id=(p_payload->>'productId')::uuid AND site_id=current_user_site_id() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Produit introuvable ou accès refusé.'; END IF;
      IF (p_payload->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'Quantité invalide'; END IF;
      IF p_payload->>'type'='out' THEN
        IF new_product.used_stock+new_product.security_stock<(p_payload->>'quantity')::numeric THEN RAISE EXCEPTION 'Stock insuffisant'; END IF;
        UPDATE public.products SET used_stock=GREATEST(0,used_stock-(p_payload->>'quantity')::numeric) WHERE id=new_product.id;
        UPDATE public.products SET security_stock=GREATEST(0,security_stock-LEAST(security_stock,GREATEST(0,used_stock_target-used_stock))),used_stock=used_stock+LEAST(security_stock,GREATEST(0,used_stock_target-used_stock)),current_stock=used_stock+LEAST(security_stock,GREATEST(0,used_stock_target-used_stock)) WHERE id=new_product.id;
      ELSE
        UPDATE public.products SET security_stock=security_stock+(p_payload->>'quantity')::numeric,current_stock=used_stock WHERE id=new_product.id;
      END IF;
      INSERT INTO public.stock_movements(product_id,type,quantity,reason,created_by) VALUES(new_product.id,p_payload->>'type',(p_payload->>'quantity')::numeric,COALESCE(p_payload->>'reason',''),auth.uid());
      SELECT * INTO new_product FROM public.products WHERE id=new_product.id;
      result_json:=jsonb_build_object('id',new_product.id,'current_stock',new_product.current_stock,'used_stock',new_product.used_stock,'security_stock',new_product.security_stock,'critical_used',new_product.used_stock<=new_product.used_stock_minimum,'critical_security',new_product.security_stock<=new_product.security_stock_minimum);
    WHEN 'CAISSE' THEN
      IF p_payload->>'action'='open' THEN
        INSERT INTO public.cash_registers(site_id,opened_by,opening_usd,status) VALUES(current_user_site_id(),auth.uid(),COALESCE((p_payload->>'openingUsd')::numeric,0),'open') RETURNING * INTO new_register;
        INSERT INTO public.cash_movements(cash_register_id,type,amount,currency,reason,created_by) VALUES(new_register.id,'opening',new_register.opening_usd,'USD','Fond de caisse',auth.uid());
      ELSE
        UPDATE public.cash_registers SET status='closed',closing_usd=COALESCE((p_payload->>'closingUsd')::numeric,0),closed_at=now() WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id() AND status='open' RETURNING * INTO new_register;
        IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable, déjà fermée ou accès refusé.'; END IF;
      END IF;
      result_json := to_jsonb(new_register);
    WHEN 'PAIEMENT_CREDIT' THEN
      INSERT INTO public.payments(order_id,site_id,method,amount,currency,reference,status,created_by) VALUES((p_payload->>'orderId')::uuid,current_user_site_id(),p_payload->>'method',COALESCE((p_payload->>'amount')::numeric,0),COALESCE(p_payload->>'currency','USD'),NULLIF(p_payload->>'reference',''),'succeeded',auth.uid());
      result_json := jsonb_build_object('order_id',p_payload->>'orderId','amount',COALESCE((p_payload->>'amount')::numeric,0),'status','succeeded');
    WHEN 'CLIENT' THEN
      INSERT INTO public.customers(full_name,phone,email) VALUES(p_payload->>'full_name',COALESCE(p_payload->>'phone',''),NULLIF(p_payload->>'email','')) RETURNING * INTO new_customer;
      IF NULLIF(p_payload->>'plate_number','') IS NOT NULL OR NULLIF(p_payload->>'brand','') IS NOT NULL OR NULLIF(p_payload->>'model','') IS NOT NULL THEN
        INSERT INTO public.vehicles(customer_id,plate_number,brand,model,color,vehicle_type) VALUES(new_customer.id,COALESCE(p_payload->>'plate_number',''),COALESCE(p_payload->>'brand',''),COALESCE(p_payload->>'model',''),COALESCE(p_payload->>'color',''),COALESCE(p_payload->>'vehicle_type','Berline'));
      END IF;
      result_json := to_jsonb(new_customer);
    WHEN 'SERVICE' THEN
      INSERT INTO public.services(name,category,price_usd,price_cdf,duration_minutes,is_active) VALUES(p_payload->>'name',p_payload->>'category',COALESCE((p_payload->>'price_usd')::numeric,0),COALESCE((p_payload->>'price_cdf')::numeric,0),COALESCE((p_payload->>'duration_minutes')::integer,30),true) RETURNING * INTO new_service;
      result_json := to_jsonb(new_service);
    WHEN 'SERVICE_UPDATE' THEN
      UPDATE public.services SET name=COALESCE(NULLIF(p_payload->>'name',''),name),category=COALESCE(NULLIF(p_payload->>'category',''),category),price_usd=COALESCE((NULLIF(p_payload->>'price_usd',''))::numeric,price_usd),price_cdf=COALESCE((NULLIF(p_payload->>'price_cdf',''))::numeric,price_cdf),duration_minutes=COALESCE((NULLIF(p_payload->>'duration_minutes',''))::integer,duration_minutes),is_active=COALESCE((NULLIF(p_payload->>'is_active',''))::boolean,is_active) WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id() RETURNING * INTO new_service;
      IF NOT FOUND THEN RAISE EXCEPTION 'Service introuvable ou accès refusé.'; END IF;
      result_json := to_jsonb(new_service);
    WHEN 'DEPENSE' THEN
      INSERT INTO public.expenses(site_id,category,description,amount,currency,status,created_by) VALUES(current_user_site_id(),p_payload->>'category',COALESCE(p_payload->>'description',''),COALESCE((p_payload->>'amount')::numeric,0),COALESCE(p_payload->>'currency','USD'),'pending',auth.uid()) RETURNING * INTO new_expense;
      result_json := to_jsonb(new_expense);
    WHEN 'DEPENSE_STATUS' THEN
      UPDATE public.expenses SET status=p_payload->>'status' WHERE id=(p_payload->>'id')::uuid AND site_id=current_user_site_id() RETURNING * INTO new_expense;
      IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable ou accès refusé.'; END IF;
      result_json := to_jsonb(new_expense);
    WHEN 'RENDEZ_VOUS' THEN
      INSERT INTO public.appointments(site_id,customer_name,vehicle_label,service_name,starts_at,status,created_by) VALUES(current_user_site_id(),p_payload->>'customer_name',p_payload->>'vehicle_label',p_payload->>'service_name',p_payload->>'starts_at','confirmed',auth.uid()) RETURNING id INTO customer_id;
      result_json := jsonb_build_object('id',customer_id,'customer_name',p_payload->>'customer_name','vehicle_label',p_payload->>'vehicle_label','service_name',p_payload->>'service_name','starts_at',p_payload->>'starts_at','status','confirmed');
    WHEN 'RECLAMATION' THEN
      INSERT INTO public.complaints(site_id,case_number,customer_name,subject,description,priority,status,created_by) VALUES(current_user_site_id(),'REC-'||to_char(now(),'YYYY')||'-'||right(md5(p_operation_id::text),3),p_payload->>'customer_name',p_payload->>'subject',COALESCE(p_payload->>'description',''),p_payload->>'priority','new',auth.uid()) RETURNING id INTO customer_id;
      result_json := jsonb_build_object('id',customer_id,'case_number','REC-'||to_char(now(),'YYYY')||'-'||right(md5(p_operation_id::text),3),'customer_name',p_payload->>'customer_name','subject',p_payload->>'subject','priority',p_payload->>'priority','status','new','created_at',now());
    WHEN 'SETTING' THEN
      INSERT INTO public.app_settings(site_id,key,value,updated_at) VALUES(current_user_site_id(),p_payload->>'key',p_payload->>'value',now()) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value,updated_at=now();
      result_json := jsonb_build_object('site_id',current_user_site_id(),'key',p_payload->>'key','value',p_payload->>'value');
    ELSE
      RAISE EXCEPTION 'SYNC_CONFLICT: type d''opération non pris en charge: %', p_operation_type;
  END CASE;

  UPDATE public.offline_operations SET status='synced',result=result_json,completed_at=now(),error=NULL WHERE operation_id=p_operation_id;
  RETURN result_json;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.offline_operations SET status='failed',error=SQLERRM WHERE operation_id=p_operation_id;
  RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_offline_operation(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_operation(uuid, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_offline_operation(uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_operation(uuid,text,jsonb) TO authenticated;
