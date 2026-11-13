-- RÉPARATION MANUELLE (à lancer une seule fois dans le SQL Editor Supabase).
-- Les ventes saisies côté caisse ont un numéro "CMD-<Date.now() en base 36>-XXXXXX".
-- On y relit l'heure réelle de la vente pour corriger les ventes que la
-- synchronisation avait datées trop tard (mélange avant-hier / hier).
-- Étape 1 : lire l'APERÇU. Étape 2 : exécuter la partie "CORRECTION" si OK.

CREATE OR REPLACE FUNCTION public.tmp_b36_to_ms(s text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r bigint := 0; c text; v int; i int;
BEGIN
  s := lower(s);
  FOR i IN 1..length(s) LOOP
    c := substr(s, i, 1);
    v := position(c in '0123456789abcdefghijklmnopqrstuvwxyz') - 1;
    IF v < 0 THEN RETURN NULL; END IF;
    r := r * 36 + v;
  END LOOP;
  RETURN r;
END $$;

-- ===== APERÇU =====
SELECT id, order_number, created_at AS date_actuelle,
       to_timestamp(public.tmp_b36_to_ms(split_part(order_number,'-',2)) / 1000.0) AS date_reelle
FROM public.orders
WHERE order_number ~ '^CMD-[0-9A-Za-z]+-[0-9A-Za-z]+$'
  AND abs(extract(epoch FROM created_at) - public.tmp_b36_to_ms(split_part(order_number,'-',2))/1000.0) > 300
ORDER BY created_at DESC;

-- ===== CORRECTION (décommenter pour exécuter) =====
-- BEGIN;
-- CREATE TEMP TABLE fix AS
--   SELECT id, created_at AS old_ts,
--          to_timestamp(public.tmp_b36_to_ms(split_part(order_number,'-',2)) / 1000.0) AS new_ts
--   FROM public.orders
--   WHERE order_number ~ '^CMD-[0-9A-Za-z]+-[0-9A-Za-z]+$'
--     AND abs(extract(epoch FROM created_at) - public.tmp_b36_to_ms(split_part(order_number,'-',2))/1000.0) > 300
--     AND public.tmp_b36_to_ms(split_part(order_number,'-',2)) / 1000.0 < extract(epoch FROM now());
-- UPDATE public.payments p     SET created_at = f.new_ts FROM fix f WHERE p.order_id = f.id AND p.created_at = f.old_ts;
-- UPDATE public.order_items i  SET created_at = f.new_ts FROM fix f WHERE i.order_id = f.id AND i.created_at = f.old_ts;
-- UPDATE public.orders o       SET created_at = f.new_ts, arrived_at = f.new_ts FROM fix f WHERE o.id = f.id;
-- COMMIT;
-- DROP FUNCTION public.tmp_b36_to_ms(text);
