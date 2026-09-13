-- Dedicated offline customer replay. Reuses an existing customer by normalized name
-- and therefore prevents duplicates when an offline sale already auto-created the customer.
CREATE OR REPLACE FUNCTION public.sync_offline_customer(
  p_operation_id uuid,
  p_full_name text,
  p_phone text DEFAULT '',
  p_email text DEFAULT '',
  p_plate_number text DEFAULT '',
  p_brand text DEFAULT '',
  p_model text DEFAULT '',
  p_color text DEFAULT '',
  p_vehicle_type text DEFAULT 'Berline',
  p_initial_visits integer DEFAULT 0,
  p_initial_loyalty_points integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c public.customers%ROWTYPE;
  v public.vehicles%ROWTYPE;
  site_id uuid;
BEGIN
  site_id := current_user_site_id();
  IF auth.uid() IS NULL OR site_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_SESSION_EXPIRED: utilisateur ou site indisponible.';
  END IF;
  IF NULLIF(BTRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du client est obligatoire.';
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE public.customers.site_id = site_id
    AND LOWER(BTRIM(public.customers.full_name)) = LOWER(BTRIM(p_full_name))
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customers(site_id, full_name, phone, email, visits, loyalty_points)
    VALUES(site_id, BTRIM(p_full_name), COALESCE(BTRIM(p_phone), ''), NULLIF(BTRIM(p_email), ''),
           GREATEST(COALESCE(p_initial_visits,0),0), GREATEST(COALESCE(p_initial_loyalty_points,0),0))
    RETURNING * INTO c;
  ELSE
    UPDATE public.customers
    SET phone = CASE WHEN COALESCE(BTRIM(p_phone),'') <> '' THEN BTRIM(p_phone) ELSE phone END,
        email = CASE WHEN COALESCE(BTRIM(p_email),'') <> '' THEN BTRIM(p_email) ELSE email END,
        updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;
  END IF;

  IF COALESCE(BTRIM(p_plate_number),'') <> '' OR COALESCE(BTRIM(p_brand),'') <> '' OR COALESCE(BTRIM(p_model),'') <> '' THEN
    SELECT * INTO v
    FROM public.vehicles
    WHERE customer_id = c.id
      AND (COALESCE(BTRIM(p_plate_number),'') = '' OR LOWER(BTRIM(plate_number)) = LOWER(BTRIM(p_plate_number)))
    LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.vehicles(customer_id, plate_number, brand, model, color, vehicle_type)
      VALUES(c.id, COALESCE(BTRIM(p_plate_number),''), COALESCE(BTRIM(p_brand),''), COALESCE(BTRIM(p_model),''), COALESCE(BTRIM(p_color),''), COALESCE(NULLIF(BTRIM(p_vehicle_type),''),'Berline'));
    END IF;
  END IF;

  INSERT INTO public.offline_operations(operation_id,user_id,site_id,operation_type,payload,status,result,completed_at)
  VALUES(p_operation_id,auth.uid(),site_id,'CLIENT',jsonb_build_object('full_name',p_full_name),'synced',to_jsonb(c),now())
  ON CONFLICT (operation_id) DO UPDATE
  SET status='synced', result=EXCLUDED.result, completed_at=now(), error=NULL;

  RETURN to_jsonb(c);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_offline_customer(uuid,text,text,text,text,text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_offline_customer(uuid,text,text,text,text,text,text,text,text,integer,integer) TO authenticated;
