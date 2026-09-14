-- Run after applying 20260914_users_audit_runtime_fix.sql.
SELECT id, email, role, site_id, created_at
FROM public.profiles
ORDER BY created_at DESC
LIMIT 25;

SELECT id, site_id, actor_id, action, entity_type, entity_id, details, created_at
FROM public.audit_logs
ORDER BY created_at DESC
LIMIT 50;

SELECT tg.tgname AS trigger_name
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND NOT tg.tgisinternal
  AND tg.tgname = 'on_auth_user_created';

SELECT table_name, trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'audit_row_change'
ORDER BY table_name;
