-- File Offline : durcissement de l'idempotence et documentation du mapping.
-- Le mapping des IDs locaux de commandes est réalisé côté client avant replay,
-- afin de conserver intacte la fonction métier process_offline_operation.
-- Aucun changement destructif n'est effectué sur les opérations existantes.

CREATE INDEX IF NOT EXISTS offline_operations_type_status_created_idx
  ON public.offline_operations(operation_type, status, created_at);

COMMENT ON TABLE public.offline_operations IS
  'File serveur d operations Offline idempotentes. Les opérations synchronisées sont conservées côté serveur pour audit/idempotence; le client les retire de son IndexedDB après succès.';
