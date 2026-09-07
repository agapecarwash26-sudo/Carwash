/*
# Point 2 — Politiques RLS granulaires par site et par rôle

## Objectif
Isoler les données entre les différents car wash (filtrage par site_id)
ET restreindre les actions par rôle (RBAC) au sein d'un même site.

## Tables modifiées (ajout de site_id)
- `customers` : ajout de site_id NOT NULL + backfill vers le site existant
- `services` : ajout de site_id NOT NULL + backfill
- `complaints` : ajout de site_id NOT NULL + backfill
- `app_settings` : ajout de site_id NOT NULL + backfill

## Politiques RLS (21 tables)
Pour chaque table, 4 politiques (SELECT/INSERT/UPDATE/DELETE) combinant :
  1. Filtrage par site : `site_id = current_user_site_id()`
  2. Filtrage par rôle : `current_user_role() IN (...)` selon la hiérarchie

## Hiérarchie des rôles
- owner    : tous les droits sur son site
- admin    : tout sauf suppression de données critiques
- manager  : gestion opérationnelle (commandes, clients, équipe, stock, caisse)
- cashier  : encaissement, commandes, caisse, clients (lecture)
- operator : file de lavage et statuts de commandes uniquement
- stock_manager : produits et mouvements de stock uniquement

## Tables enfants (filtrage via parent)
- order_items       → filtrage via orders.site_id
- cash_movements    → filtrage via cash_registers.site_id
- stock_movements   → filtrage via products.site_id
- vehicles          → filtrage via customers.site_id
- loyalty_transactions → filtrage via customers.site_id

## Tables spéciales
- notifications : filtrage par user_id = auth.uid()
- audit_logs    : lecture par owner/admin de son site
- sites         : lecture/modification par users de ce site
- profiles      : lecture par users du même site, modif par owner/admin

## Notes importantes
1. Toutes les anciennes politiques sont supprimées (DROP POLICY IF EXISTS)
   puis recréées avec les nouvelles règles.
2. Les fonctions current_user_site_id() et current_user_role() créées au
   Point 1 sont utilisées dans toutes les politiques.
3. Les INSERT policies vérifient que site_id correspond au site de l'utilisateur
   via WITH CHECK.
*/

-- =========================================================
-- 1. Ajouter site_id aux tables qui n'en ont pas
-- =========================================================

-- customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS site_id uuid;
DO $$ DECLARE s uuid; BEGIN
  SELECT id INTO s FROM sites WHERE is_active = true ORDER BY created_at LIMIT 1;
  IF s IS NOT NULL THEN UPDATE customers SET site_id = s WHERE site_id IS NULL; END IF;
END $$;
ALTER TABLE customers ALTER COLUMN site_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_site_id ON customers(site_id);

-- services
ALTER TABLE services ADD COLUMN IF NOT EXISTS site_id uuid;
DO $$ DECLARE s uuid; BEGIN
  SELECT id INTO s FROM sites WHERE is_active = true ORDER BY created_at LIMIT 1;
  IF s IS NOT NULL THEN UPDATE services SET site_id = s WHERE site_id IS NULL; END IF;
END $$;
ALTER TABLE services ALTER COLUMN site_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_site_id ON services(site_id);

-- complaints
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS site_id uuid;
DO $$ DECLARE s uuid; BEGIN
  SELECT id INTO s FROM sites WHERE is_active = true ORDER BY created_at LIMIT 1;
  IF s IS NOT NULL THEN UPDATE complaints SET site_id = s WHERE site_id IS NULL; END IF;
END $$;
ALTER TABLE complaints ALTER COLUMN site_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_site_id ON complaints(site_id);

-- app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS site_id uuid;
DO $$ DECLARE s uuid; BEGIN
  SELECT id INTO s FROM sites WHERE is_active = true ORDER BY created_at LIMIT 1;
  IF s IS NOT NULL THEN UPDATE app_settings SET site_id = s WHERE site_id IS NULL; END IF;
END $$;
ALTER TABLE app_settings ALTER COLUMN site_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_settings_site_id ON app_settings(site_id);

-- =========================================================
-- 2. PROFILES — utilisateurs du même site
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_profiles" ON profiles;
DROP POLICY IF EXISTS "authenticated_insert_profiles" ON profiles;
DROP POLICY IF EXISTS "authenticated_update_profiles" ON profiles;
DROP POLICY IF EXISTS "authenticated_delete_profiles" ON profiles;

CREATE POLICY "profiles_select_same_site" ON profiles FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "profiles_insert_owner_admin" ON profiles FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

CREATE POLICY "profiles_update_owner_admin_or_self" ON profiles FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND (
    auth.uid() = id OR current_user_role() IN ('owner', 'admin')
  ))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "profiles_delete_owner_admin" ON profiles FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 3. SITES — uniquement son propre site
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_sites" ON sites;
DROP POLICY IF EXISTS "authenticated_insert_sites" ON sites;
DROP POLICY IF EXISTS "authenticated_update_sites" ON sites;
DROP POLICY IF EXISTS "authenticated_delete_sites" ON sites;

CREATE POLICY "sites_select_own" ON sites FOR SELECT
  TO authenticated USING (id = current_user_site_id());

CREATE POLICY "sites_insert_owner" ON sites FOR INSERT
  TO authenticated WITH CHECK (current_user_role() = 'owner');

CREATE POLICY "sites_update_owner_admin" ON sites FOR UPDATE
  TO authenticated
  USING (id = current_user_site_id() AND current_user_role() IN ('owner', 'admin'))
  WITH CHECK (id = current_user_site_id());

CREATE POLICY "sites_delete_owner" ON sites FOR DELETE
  TO authenticated USING (id = current_user_site_id() AND current_user_role() = 'owner');

-- =========================================================
-- 4. ORDERS — tous les rôles lisent, création par cashier+
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_orders" ON orders;
DROP POLICY IF EXISTS "authenticated_insert_orders" ON orders;
DROP POLICY IF EXISTS "authenticated_update_orders" ON orders;
DROP POLICY IF EXISTS "authenticated_delete_orders" ON orders;

CREATE POLICY "orders_select_own_site" ON orders FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "orders_insert_own_site" ON orders FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "orders_update_own_site" ON orders FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id())
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "orders_delete_owner_admin" ON orders FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 5. PAYMENTS — cashier+ créent, manager+ modifient
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_insert_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_update_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_delete_payments" ON payments;

CREATE POLICY "payments_select_own_site" ON payments FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "payments_insert_own_site" ON payments FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "payments_update_own_site" ON payments FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "payments_delete_owner_admin" ON payments FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 6. EMPLOYEES — manager+ gèrent l'équipe
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_employees" ON employees;
DROP POLICY IF EXISTS "authenticated_insert_employees" ON employees;
DROP POLICY IF EXISTS "authenticated_update_employees" ON employees;
DROP POLICY IF EXISTS "authenticated_delete_employees" ON employees;

CREATE POLICY "employees_select_own_site" ON employees FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "employees_insert_own_site" ON employees FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager')
  );

CREATE POLICY "employees_update_own_site" ON employees FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "employees_delete_owner_admin" ON employees FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 7. EXPENSES — manager+ uniquement (pas cashier/operator)
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_expenses" ON expenses;
DROP POLICY IF EXISTS "authenticated_insert_expenses" ON expenses;
DROP POLICY IF EXISTS "authenticated_update_expenses" ON expenses;
DROP POLICY IF EXISTS "authenticated_delete_expenses" ON expenses;

CREATE POLICY "expenses_select_own_site" ON expenses FOR SELECT
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager')
  );

CREATE POLICY "expenses_insert_own_site" ON expenses FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager')
  );

CREATE POLICY "expenses_update_own_site" ON expenses FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "expenses_delete_owner_admin" ON expenses FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 8. PRODUCTS — stock_manager+ gèrent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_products" ON products;
DROP POLICY IF EXISTS "authenticated_insert_products" ON products;
DROP POLICY IF EXISTS "authenticated_update_products" ON products;
DROP POLICY IF EXISTS "authenticated_delete_products" ON products;

CREATE POLICY "products_select_own_site" ON products FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "products_insert_own_site" ON products FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'stock_manager')
  );

CREATE POLICY "products_update_own_site" ON products FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager', 'stock_manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "products_delete_owner_admin" ON products FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 9. CASH_REGISTERS — cashier+ gèrent la caisse
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_cash_registers" ON cash_registers;
DROP POLICY IF EXISTS "authenticated_insert_cash_registers" ON cash_registers;
DROP POLICY IF EXISTS "authenticated_update_cash_registers" ON cash_registers;
DROP POLICY IF EXISTS "authenticated_delete_cash_registers" ON cash_registers;

CREATE POLICY "cash_registers_select_own_site" ON cash_registers FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "cash_registers_insert_own_site" ON cash_registers FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "cash_registers_update_own_site" ON cash_registers FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "cash_registers_delete_owner_admin" ON cash_registers FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 10. CASH_MOVEMENTS — filtrage via cash_registers
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_cash_movements" ON cash_movements;
DROP POLICY IF EXISTS "authenticated_insert_cash_movements" ON cash_movements;
DROP POLICY IF EXISTS "authenticated_update_cash_movements" ON cash_movements;
DROP POLICY IF EXISTS "authenticated_delete_cash_movements" ON cash_movements;

CREATE POLICY "cash_movements_select_own_site" ON cash_movements FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM cash_registers cr
      WHERE cr.id = cash_movements.cash_register_id
        AND cr.site_id = current_user_site_id()
    )
  );

CREATE POLICY "cash_movements_insert_own_site" ON cash_movements FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM cash_registers cr
      WHERE cr.id = cash_movements.cash_register_id
        AND cr.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "cash_movements_update_own_site" ON cash_movements FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cash_registers cr
      WHERE cr.id = cash_movements.cash_register_id
        AND cr.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cash_registers cr
      WHERE cr.id = cash_movements.cash_register_id
        AND cr.site_id = current_user_site_id()
    )
  );

CREATE POLICY "cash_movements_delete_owner_admin" ON cash_movements FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM cash_registers cr
      WHERE cr.id = cash_movements.cash_register_id
        AND cr.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 11. CUSTOMERS — cashier+ gèrent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_customers" ON customers;
DROP POLICY IF EXISTS "authenticated_insert_customers" ON customers;
DROP POLICY IF EXISTS "authenticated_update_customers" ON customers;
DROP POLICY IF EXISTS "authenticated_delete_customers" ON customers;

CREATE POLICY "customers_select_own_site" ON customers FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "customers_insert_own_site" ON customers FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "customers_update_own_site" ON customers FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id())
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "customers_delete_owner_admin" ON customers FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 12. VEHICLES — filtrage via customers
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_insert_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_update_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_delete_vehicles" ON vehicles;

CREATE POLICY "vehicles_select_own_site" ON vehicles FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = vehicles.customer_id
        AND c.site_id = current_user_site_id()
    )
  );

CREATE POLICY "vehicles_insert_own_site" ON vehicles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = vehicles.customer_id
        AND c.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "vehicles_update_own_site" ON vehicles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = vehicles.customer_id
        AND c.site_id = current_user_site_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = vehicles.customer_id
        AND c.site_id = current_user_site_id()
    )
  );

CREATE POLICY "vehicles_delete_owner_admin" ON vehicles FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = vehicles.customer_id
        AND c.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 13. SERVICES — manager+ gèrent le catalogue
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_services" ON services;
DROP POLICY IF EXISTS "authenticated_insert_services" ON services;
DROP POLICY IF EXISTS "authenticated_update_services" ON services;
DROP POLICY IF EXISTS "authenticated_delete_services" ON services;

CREATE POLICY "services_select_own_site" ON services FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "services_insert_own_site" ON services FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager')
  );

CREATE POLICY "services_update_own_site" ON services FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "services_delete_owner_admin" ON services FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 14. ORDER_ITEMS — filtrage via orders
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_order_items" ON order_items;
DROP POLICY IF EXISTS "authenticated_insert_order_items" ON order_items;
DROP POLICY IF EXISTS "authenticated_update_order_items" ON order_items;
DROP POLICY IF EXISTS "authenticated_delete_order_items" ON order_items;

CREATE POLICY "order_items_select_own_site" ON order_items FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.site_id = current_user_site_id()
    )
  );

CREATE POLICY "order_items_insert_own_site" ON order_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "order_items_update_own_site" ON order_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.site_id = current_user_site_id()
    )
  );

CREATE POLICY "order_items_delete_owner_admin" ON order_items FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 15. SUBSCRIPTIONS — cashier+ créent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "authenticated_insert_subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "authenticated_update_subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "authenticated_delete_subscriptions" ON subscriptions;

CREATE POLICY "subscriptions_select_own_site" ON subscriptions FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "subscriptions_insert_own_site" ON subscriptions FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "subscriptions_update_own_site" ON subscriptions FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "subscriptions_delete_owner_admin" ON subscriptions FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 16. APPOINTMENTS — cashier+ gèrent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_appointments" ON appointments;
DROP POLICY IF EXISTS "authenticated_insert_appointments" ON appointments;
DROP POLICY IF EXISTS "authenticated_update_appointments" ON appointments;
DROP POLICY IF EXISTS "authenticated_delete_appointments" ON appointments;

CREATE POLICY "appointments_select_own_site" ON appointments FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "appointments_insert_own_site" ON appointments FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "appointments_update_own_site" ON appointments FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id())
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "appointments_delete_owner_admin" ON appointments FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 17. COMPLAINTS — cashier+ créent, manager+ gèrent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_complaints" ON complaints;
DROP POLICY IF EXISTS "authenticated_insert_complaints" ON complaints;
DROP POLICY IF EXISTS "authenticated_update_complaints" ON complaints;
DROP POLICY IF EXISTS "authenticated_delete_complaints" ON complaints;

CREATE POLICY "complaints_select_own_site" ON complaints FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "complaints_insert_own_site" ON complaints FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "complaints_update_own_site" ON complaints FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin', 'manager'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "complaints_delete_owner_admin" ON complaints FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 18. STOCK_MOVEMENTS — filtrage via products, stock_manager+
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_stock_movements" ON stock_movements;
DROP POLICY IF EXISTS "authenticated_insert_stock_movements" ON stock_movements;
DROP POLICY IF EXISTS "authenticated_update_stock_movements" ON stock_movements;
DROP POLICY IF EXISTS "authenticated_delete_stock_movements" ON stock_movements;

CREATE POLICY "stock_movements_select_own_site" ON stock_movements FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = stock_movements.product_id
        AND p.site_id = current_user_site_id()
    )
  );

CREATE POLICY "stock_movements_insert_own_site" ON stock_movements FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = stock_movements.product_id
        AND p.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager', 'stock_manager')
  );

CREATE POLICY "stock_movements_update_own_site" ON stock_movements FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = stock_movements.product_id
        AND p.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = stock_movements.product_id
        AND p.site_id = current_user_site_id()
    )
  );

CREATE POLICY "stock_movements_delete_owner_admin" ON stock_movements FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = stock_movements.product_id
        AND p.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 19. LOYALTY_TRANSACTIONS — filtrage via customers
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_loyalty_transactions" ON loyalty_transactions;
DROP POLICY IF EXISTS "authenticated_insert_loyalty_transactions" ON loyalty_transactions;
DROP POLICY IF EXISTS "authenticated_update_loyalty_transactions" ON loyalty_transactions;
DROP POLICY IF EXISTS "authenticated_delete_loyalty_transactions" ON loyalty_transactions;

CREATE POLICY "loyalty_select_own_site" ON loyalty_transactions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_transactions.customer_id
        AND c.site_id = current_user_site_id()
    )
  );

CREATE POLICY "loyalty_insert_own_site" ON loyalty_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_transactions.customer_id
        AND c.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager', 'cashier')
  );

CREATE POLICY "loyalty_update_own_site" ON loyalty_transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_transactions.customer_id
        AND c.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin', 'manager')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_transactions.customer_id
        AND c.site_id = current_user_site_id()
    )
  );

CREATE POLICY "loyalty_delete_owner_admin" ON loyalty_transactions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_transactions.customer_id
        AND c.site_id = current_user_site_id()
    )
    AND current_user_role() IN ('owner', 'admin')
  );

-- =========================================================
-- 20. NOTIFICATIONS — uniquement les siennes
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_insert_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_update_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_delete_notifications" ON notifications;

CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_own" ON notifications FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- =========================================================
-- 21. AUDIT_LOGS — lecture par owner/admin, insertion par tous
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "authenticated_update_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "authenticated_delete_audit_logs" ON audit_logs;

CREATE POLICY "audit_logs_select_owner_admin" ON audit_logs FOR SELECT
  TO authenticated USING (
    actor_id = auth.uid()
    OR (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = actor_id
          AND p.site_id = current_user_site_id()
      )
      AND current_user_role() IN ('owner', 'admin')
    )
  );

CREATE POLICY "audit_logs_insert_own_site" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (actor_id = auth.uid());

CREATE POLICY "audit_logs_update_none" ON audit_logs FOR UPDATE
  TO authenticated USING (false);

CREATE POLICY "audit_logs_delete_owner" ON audit_logs FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = actor_id
        AND p.site_id = current_user_site_id()
    )
    AND current_user_role() = 'owner'
  );

-- =========================================================
-- 22. APP_SETTINGS — owner/admin gèrent
-- =========================================================
DROP POLICY IF EXISTS "authenticated_read_app_settings" ON app_settings;
DROP POLICY IF EXISTS "authenticated_insert_app_settings" ON app_settings;
DROP POLICY IF EXISTS "authenticated_update_app_settings" ON app_settings;
DROP POLICY IF EXISTS "authenticated_delete_app_settings" ON app_settings;
DROP POLICY IF EXISTS "admin_write_app_settings" ON app_settings;

CREATE POLICY "app_settings_select_own_site" ON app_settings FOR SELECT
  TO authenticated USING (site_id = current_user_site_id());

CREATE POLICY "app_settings_insert_owner_admin" ON app_settings FOR INSERT
  TO authenticated WITH CHECK (
    site_id = current_user_site_id()
    AND current_user_role() IN ('owner', 'admin')
  );

CREATE POLICY "app_settings_update_owner_admin" ON app_settings FOR UPDATE
  TO authenticated
  USING (site_id = current_user_site_id() AND current_user_role() IN ('owner', 'admin'))
  WITH CHECK (site_id = current_user_site_id());

CREATE POLICY "app_settings_delete_owner" ON app_settings FOR DELETE
  TO authenticated USING (
    site_id = current_user_site_id()
    AND current_user_role() = 'owner'
  );
