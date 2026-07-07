-- schema_v16.sql
-- Drop the FK constraints on threads so demo/unclaimed vendors can be messaged.
-- Run in Supabase SQL Editor AFTER schema_v15.sql

-- Drop FK on vendor_id (was blocking messages to demo vendors not in vendors table)
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_vendor_id_fkey;

-- Drop FK on customer_id too (defensive — avoids edge-case failures)
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_customer_id_fkey;

-- Make vendor_id store the name as well so we can display it without a JOIN
ALTER TABLE threads ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Backfill vendor_name where we can from the vendors table
UPDATE threads t
SET vendor_name = v.name
FROM vendors v
WHERE v.id = t.vendor_id AND t.vendor_name IS NULL;
