-- Persist the effective per-site exchange rate on every order.
-- The order RPC calculates using app_settings, but older versions omitted
-- exchange_rate from the INSERT and therefore stored the column default 2850.
CREATE OR REPLACE FUNCTION public.set_order_exchange_rate_from_site()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  configured_rate numeric;
BEGIN
  SELECT NULLIF(value, '')::numeric
    INTO configured_rate
  FROM public.app_settings
  WHERE site_id = NEW.site_id
    AND key = 'usd_to_cdf_rate'
  LIMIT 1;

  NEW.exchange_rate := COALESCE(configured_rate, NEW.exchange_rate, 2850);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_persist_exchange_rate ON public.orders;
CREATE TRIGGER trg_orders_persist_exchange_rate
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_exchange_rate_from_site();
