-- Fix audit tenant scope and make stock semantics explicit.
-- Stock used = operational stock. Stock security = reserve used for automatic replenishment.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;

UPDATE public.audit_logs a
SET site_id = p.site_id
FROM public.profiles p
WHERE a.site_id IS NULL
  AND a.actor_id = p.id;

CREATE INDEX IF NOT EXISTS audit_logs_site_id_created_at_idx
  ON public.audit_logs(site_id, created_at DESC);

DROP POLICY IF EXISTS "audit_logs_select_owner_admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_own_site" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete_owner" ON public.audit_logs;

CREATE POLICY "audit_logs_select_owner_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    site_id = public.current_user_site_id()
    AND public.current_user_role() IN ('owner', 'admin')
  );

CREATE POLICY "audit_logs_insert_own_site" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    site_id = public.current_user_site_id()
    AND actor_id = auth.uid()
  );

CREATE POLICY "audit_logs_delete_owner" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (
    site_id = public.current_user_site_id()
    AND public.current_user_role() IN ('owner', 'admin')
  );

-- Keep current_stock aligned with the operational stock for the two-stock model.
UPDATE public.products
SET current_stock = used_stock;
