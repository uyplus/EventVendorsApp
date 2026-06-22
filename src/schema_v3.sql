-- schema_v3.sql — compliance & legal columns
-- Run in Supabase SQL Editor after schema_v2.sql has been applied.
-- All statements use IF NOT EXISTS / safe column adds so re-running is harmless.

-- ── vendors table ─────────────────────────────────────────────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS licence_status   VARCHAR(20)  DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS licence_path     TEXT,
  ADD COLUMN IF NOT EXISTS licence_expires  DATE,
  ADD COLUMN IF NOT EXISTS insurance_path   TEXT,
  ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20)  DEFAULT 'none';

-- Migrate existing rows: if licensed=true and no status set, mark as pending
UPDATE vendors
SET licence_status = 'pending'
WHERE licensed = true
  AND (licence_status IS NULL OR licence_status = 'none')
  AND licence_path IS NULL;

-- ── users table ───────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS joined_at          TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS contractor_ack     BOOLEAN     DEFAULT false;

-- ── admin_actions table (audit trail for licence decisions) ───────────────────
CREATE TABLE IF NOT EXISTS admin_actions (
  id           SERIAL PRIMARY KEY,
  admin_email  TEXT NOT NULL,
  action       VARCHAR(50) NOT NULL,   -- 'verify_licence' | 'reject_licence' | 'suspend_vendor' etc.
  target_type  VARCHAR(20) NOT NULL,   -- 'vendor' | 'user'
  target_id    INTEGER NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups by target
CREATE INDEX IF NOT EXISTS admin_actions_target_idx ON admin_actions(target_type, target_id);
