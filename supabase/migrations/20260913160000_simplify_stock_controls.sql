-- Simplified stock controls:
-- used_stock = operational stock consumed day-to-day
-- security_stock = reserve used for manual one-unit replenishment
-- used_stock_target is kept only for backward compatibility with older rows/code.
COMMENT ON COLUMN public.products.used_stock IS 'Stock opérationnel utilisé au quotidien.';
COMMENT ON COLUMN public.products.security_stock IS 'Stock de sécurité / réserve pour réapprovisionner le stock utilisé.';
COMMENT ON COLUMN public.products.used_stock_target IS 'Legacy: no longer used by the simplified UI.';
