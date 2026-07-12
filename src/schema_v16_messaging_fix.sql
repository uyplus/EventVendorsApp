-- schema_v16_messaging_fix.sql
-- Run this ONCE in the Supabase SQL Editor. It guarantees messaging works
-- regardless of backend deployment timing.

CREATE TABLE IF NOT EXISTS threads (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'Enquiry',
  kind VARCHAR(20) NOT NULL DEFAULT 'message',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by_customer BOOLEAN NOT NULL DEFAULT false,
  deleted_by_vendor BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (vendor_id, customer_id)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_messages_thread_idx ON thread_messages(thread_id);

-- Drop the vendors FK if schema_v15 created it (it breaks messages to demo listings)
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='threads'::regclass AND contype='f' LOOP
    EXECUTE 'ALTER TABLE threads DROP CONSTRAINT ' || quote_ident(c.conname);
  END LOOP;
END $$;

-- Add any columns missing from an older threads table
ALTER TABLE threads ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'Enquiry';
ALTER TABLE threads ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'message';
ALTER TABLE threads ADD COLUMN IF NOT EXISTS deleted_by_customer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS deleted_by_vendor BOOLEAN NOT NULL DEFAULT false;

SELECT 'threads' AS tbl, COUNT(*) FROM threads
UNION ALL
SELECT 'thread_messages', COUNT(*) FROM thread_messages;
