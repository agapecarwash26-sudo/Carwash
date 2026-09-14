-- Definitive user creation + audit hardening.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_site_id uuid; v_role text := 'owner'; v_requested_site text; v_requested_role text; v_site_name text;
BEGIN
  v_requested_site := NULLIF(new.raw_app_meta_data ->> 'site_id','');
  v_requested_role := NULLIF(new.raw_app_meta_data ->> 'role','');
  IF v_requested_site IS NOT NULL THEN
    BEGIN v_site_id := v_requested_site::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'site_id invalide pour le nouveau compte'; END;
    IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=v_site_id AND is_active=true) THEN RAISE EXCEPTION 'Le site demandé pour ce compte n’existe pas ou est inactif.'; END IF;
    IF v_requested_role IN ('admin','manager','cashier','operator','stock_manager') THEN v_role:=v_requested_role; ELSE RAISE EXCEPTION 'Rôle utilisateur invalide.'; END IF;
    INSERT INTO public.profiles(id,full_name,email,role,site_id) VALUES(new.id,COALESCE(NULLIF(trim(new.raw_user_meta_data->>'full_name'),''),'Utilisateur'),COALESCE(new.email,''),v_role,v_site_id)
    ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,role=EXCLUDED.role,site_id=EXCLUDED.site_id,updated_at=now();
    RETURN new;
  END IF;
  v_site_name:=COALESCE(NULLIF(trim(new.raw_user_meta_data->>'site_name'),''),'Mon espace AquaFlow');
  INSERT INTO public.sites(name) VALUES(v_site_name) RETURNING id INTO v_site_id;
  INSERT INTO public.profiles(id,full_name,email,role,site_id) VALUES(new.id,COALESCE(NULLIF(trim(new.raw_user_meta_data->>'full_name'),''),'Propriétaire'),COALESCE(new.email,''),'owner',v_site_id)
  ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,role='owner',site_id=EXCLUDED.site_id,updated_at=now();
  PERFORM public.bootstrap_site_defaults(v_site_id); RETURN new;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS audit_logs_site_created_idx ON public.audit_logs(site_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_site_id uuid; v_entity_id text; v_details jsonb;
BEGIN
  IF TG_OP='DELETE' THEN v_site_id:=OLD.site_id; v_entity_id:=OLD.id::text; v_details:=to_jsonb(OLD);
  ELSE v_site_id:=NEW.site_id; v_entity_id:=NEW.id::text; v_details:=to_jsonb(NEW); END IF;
  IF v_site_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.audit_logs(site_id,actor_id,action,entity_type,entity_id,details) VALUES(v_site_id,auth.uid(),lower(TG_OP),TG_TABLE_NAME,v_entity_id,v_details);
  END IF;
  RETURN COALESCE(NEW,OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AquaFlow audit failed on %: %',TG_TABLE_NAME,SQLERRM; RETURN COALESCE(NEW,OLD);
END; $$;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['sites','services','customers','vehicles','orders','order_items','payments','cash_registers','cash_movements','expenses','products','stock_movements','employees','subscriptions','appointments','complaints','loyalty_transactions'] LOOP IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_change ON public.%I',t); EXECUTE format('CREATE TRIGGER trg_audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',t); END IF; END LOOP; END $$;
DROP POLICY IF EXISTS audit_logs_select_owner_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_owner_admin ON public.audit_logs FOR SELECT TO authenticated USING(site_id=public.current_user_site_id() AND public.current_user_role() IN ('owner','admin'));
DROP POLICY IF EXISTS audit_logs_insert_own_site ON public.audit_logs;
CREATE POLICY audit_logs_insert_own_site ON public.audit_logs FOR INSERT TO authenticated WITH CHECK(site_id=public.current_user_site_id() AND actor_id=auth.uid());
