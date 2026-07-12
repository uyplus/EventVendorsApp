-- schema_v17.sql
-- Run in Supabase SQL Editor.
-- Adds insurance_expiry and ensures all vendor document columns exist.

-- COI expiry date
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS insurance_expiry  DATE;

-- Ensure licence/insurance file columns exist (added in earlier schemas but may be missing)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS licence_file      TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS licence_expiry    TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS insurance_file    TEXT;

-- Ensure city/region/country updatable (already exist from base schema, but confirm)
-- (no-op if already present)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS city    TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS region  TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS country TEXT;

SELECT 'schema_v17 applied' AS result;
