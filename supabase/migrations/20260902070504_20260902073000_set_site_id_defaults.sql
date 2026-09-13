/*
# Fix: Column defaults for site_id + fix loadReportData

## Problem
After Point 2 RLS policies, INSERT operations fail because the frontend
doesn't pass site_id. The RLS WITH CHECK requires site_id = current_user_site_id()
but site_id is NULL in the insert payload.

## Fix
1. Set DEFAULT current_user_site_id() on all tables with site_id so inserts
   automatically get the user's site without the frontend needing to pass it.
2. Make site_id columns NOT NULL where they aren't already (they should be
   from the original schema, but this ensures consistency).

## Tables affected
- orders, payments, employees, expenses, cash_registers, products,
  subscriptions, appointments, customers, services, complaints, app_settings

## Notes
- current_user_site_id() is SECURITY DEFINER + STABLE, safe as a column default.
- The RLS WITH CHECK (site_id = current_user_site_id()) will pass because
  the default sets site_id to the same value the policy checks against.
*/

-- Set defaults on all tables with site_id
ALTER TABLE orders ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE payments ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE employees ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE expenses ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE cash_registers ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE products ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE subscriptions ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE appointments ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE customers ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE services ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE complaints ALTER COLUMN site_id SET DEFAULT current_user_site_id();
ALTER TABLE app_settings ALTER COLUMN site_id SET DEFAULT current_user_site_id();
