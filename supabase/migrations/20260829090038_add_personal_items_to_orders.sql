/*
# Add personal_items and vehicle_details to orders table

1. Modified Tables
- `orders`: Added `personal_items` (text, nullable) to store a list of personal belongings left inside the vehicle.
- `orders`: Added `vehicle_details` (text, nullable) to store a detailed description of the vehicle.
2. Security
- No changes to existing RLS policies. The new columns inherit the existing order policies (authenticated CRUD).
3. Notes
- Both columns are optional (nullable) so existing orders are not affected.
- The frontend will use these fields in a new "Vehicle Details" modal accessible from the orders table.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'personal_items'
  ) THEN
    ALTER TABLE orders ADD COLUMN personal_items text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'vehicle_details'
  ) THEN
    ALTER TABLE orders ADD COLUMN vehicle_details text;
  END IF;
END $$;
