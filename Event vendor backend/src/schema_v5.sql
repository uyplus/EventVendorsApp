-- schema_v5.sql — vendor profile enrichment
-- Run in Supabase SQL Editor after schema_v4.sql has been applied.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS experience_since_year INTEGER,
  ADD COLUMN IF NOT EXISTS service_areas         JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS price_list_path        TEXT;

-- experience_since_year: the YEAR a vendor started (not a number of years).
--   "Years of experience" is always computed live as (current year - this
--   value), so it advances automatically every January 1st with no manual
--   update ever required.
-- service_areas: a JSON array of city/province/state names the vendor is
--   willing to travel to — set at signup, editable from the dashboard.
-- price_list_path: a public URL to an uploaded price list or menu (PDF or
--   image), shown to customers via a "View price list" / "View menu" button.
