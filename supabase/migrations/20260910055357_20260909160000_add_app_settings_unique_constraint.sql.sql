-- Add unique constraint on (site_id, key) for app_settings upserts
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_site_key_uniq ON public.app_settings (site_id, key);
