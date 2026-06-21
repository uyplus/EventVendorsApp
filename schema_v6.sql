-- schema_v6.sql — allow "price varies / not applicable" vendors
-- Run in Supabase SQL Editor after schema_v5.sql has been applied.

-- starting_price was NOT NULL DEFAULT 0, which made it impossible to
-- represent "price varies / contact for quote" — every vendor without a
-- price showed a misleading "$0". NULL now means N/A; an explicit dollar
-- amount means a real starting price (minimum $1, enforced in the app).
ALTER TABLE vendors ALTER COLUMN starting_price DROP NOT NULL;
ALTER TABLE vendors ALTER COLUMN starting_price DROP DEFAULT;
