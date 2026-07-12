-- schema_v12.sql — vendor social media handles
-- Run in Supabase SQL Editor after schema_v11.sql has been applied.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS facebook_handle  TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_handle    TEXT;

-- Stored as whatever the vendor typed — either a bare handle ("@name") or a
-- full URL. The frontend normalizes either form into a working link when
-- displaying it on the public profile.
