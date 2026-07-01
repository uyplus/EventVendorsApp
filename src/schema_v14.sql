-- schema_v14.sql — Claim-Your-Profile System
-- Run this in Supabase → SQL Editor (one time, safe to re-run)

-- 1. Claim columns on vendors
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS claimed             BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS claim_token        TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS claim_token_expires TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pre_populated      BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source             TEXT;          -- 'google' | 'yelp' | 'csv'
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source_id          TEXT;          -- Google place_id or Yelp id (dedup key)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS source_url         TEXT;          -- google.com/maps/... or yelp.com/biz/...
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS website            TEXT;          -- business website from source

-- 2. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS vendors_claim_token_idx
  ON vendors (claim_token)
  WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vendors_source_id_idx
  ON vendors (source_id)
  WHERE source_id IS NOT NULL;

-- 3. Expose the new fields via the toVendor mapper
--    (nothing to run; handled in repo.js update)

-- 4. Security: claim_token must never leak to the public/anon role.
--    If you're using Supabase Row Level Security (recommended), ensure
--    the SELECT policy on vendors does NOT include claim_token in its
--    column list, or use a dedicated view:
--
-- CREATE OR REPLACE VIEW public_vendors AS
--   SELECT id, name, cat, city, region, country, photos, about, rating, reviews,
--          isPremiumActive, claimed, pre_populated, source_url, website, hue, ...
--   FROM vendors WHERE suspended = false;
