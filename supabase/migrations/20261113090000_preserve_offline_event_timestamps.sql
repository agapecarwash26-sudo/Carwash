-- Correctif : les opérations rejouées après un passage hors ligne gardent leur
-- date d'origine (côté client) au lieu de la date de synchronisation.
-- process_offline_operation lit offline_operations.created_at pour dater
-- commandes, paiements, lignes de commande, etc. Ce trigger renseigne cette
-- colonne depuis payload->>'__createdAt' (envoyé par le client).
-- Bornes de sécurité : jamais dans le futur, jamais plus vieux que 60 jours.

CREATE OR REPLACE FUNCTION public.offline_operations_apply_client_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  client_ts timestamptz;
BEGIN
  IF NEW.payload ? '__createdAt' THEN
    BEGIN
      client_ts := (NEW.payload->>'__createdAt')::timestamptz;
    EXCEPTION WHEN others THEN
      client_ts := NULL;
    END;
    IF client_ts IS NOT NULL
       AND client_ts <= now()
       AND client_ts >= now() - interval '60 days' THEN
      NEW.created_at := client_ts;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offline_operations_client_timestamp ON public.offline_operations;
CREATE TRIGGER offline_operations_client_timestamp
  BEFORE INSERT ON public.offline_operations
  FOR EACH ROW EXECUTE FUNCTION public.offline_operations_apply_client_timestamp();
