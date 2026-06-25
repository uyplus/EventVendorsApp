-- schema_v11.sql — password reset tokens
-- Run in Supabase SQL Editor after schema_v10.sql has been applied.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token         TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires  TIMESTAMPTZ;

-- A token is generated on "forgot password", emailed as a link, and must be
-- presented (along with a new password) within 30 minutes. It's cleared
-- immediately after use or once it expires, so it can't be replayed.
