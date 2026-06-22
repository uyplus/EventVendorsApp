-- schema_v8.sql — premium tiers with real expiry tracking
-- Run in Supabase SQL Editor after schema_v7.sql has been applied.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS premium_tier       VARCHAR(20),  -- 'founding' | 'monthly' | 'yearly' | NULL
  ADD COLUMN IF NOT EXISTS premium_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ;  -- NULL = never expires (used for 'founding')

CREATE INDEX IF NOT EXISTS vendors_premium_idx ON vendors(premium_tier, premium_expires_at);

-- premium_tier + premium_expires_at are the source of truth. Whether a
-- vendor's badge is CURRENTLY active is always computed live —
--   premium_tier IS NOT NULL AND (premium_expires_at IS NULL OR premium_expires_at > now())
-- — never stored as a separate flag that could go stale. This means an
-- expired monthly/yearly subscription stops counting immediately, with
-- nothing to clean up, no cron job required.
--
-- 'founding' tier (the first 100 vendors) is granted with premium_expires_at
-- left NULL — it does not expire on a timer the way paid tiers will.
