-- schema_v13.sql — vendor business operating hours
-- Run in Supabase SQL Editor after schema_v12.sql has been applied.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS operating_hours JSONB;

-- Shape: { "mon": {"open": "09:00", "close": "17:00", "closed": false}, "tue": {...}, ... }
-- A day can also be entirely closed: {"closed": true} with open/close ignored.
-- NULL means the vendor never set hours — shown as "Contact for hours" rather
-- than guessing or defaulting to something that might be wrong.
