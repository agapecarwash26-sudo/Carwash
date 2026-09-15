-- AquaFlow optional seed
-- New sites are automatically bootstrapped by the auth trigger.
-- This command is useful only to repair/restore generic defaults
-- for the currently authenticated site.
SELECT public.bootstrap_current_site_defaults();
