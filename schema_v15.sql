-- schema_v15.sql
-- Messaging tables (idempotent — safe to run even if schema_v7 was applied)
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS threads (
  id          BIGSERIAL PRIMARY KEY,
  vendor_id   BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  subject     TEXT        NOT NULL DEFAULT 'Enquiry',
  kind        VARCHAR(20) NOT NULL DEFAULT 'message',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by_customer BOOLEAN NOT NULL DEFAULT false,
  deleted_by_vendor   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (vendor_id, customer_id)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id          BIGSERIAL PRIMARY KEY,
  thread_id   BIGINT      NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL,  -- 'customer' | 'vendor'
  body        TEXT        NOT NULL,
  read        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast inbox queries
CREATE INDEX IF NOT EXISTS thread_messages_thread_idx ON thread_messages(thread_id);
CREATE INDEX IF NOT EXISTS threads_customer_idx       ON threads(customer_id);
CREATE INDEX IF NOT EXISTS threads_vendor_idx         ON threads(vendor_id);

-- Soft-delete columns (add idempotently if table already exists from v7)
ALTER TABLE threads ADD COLUMN IF NOT EXISTS deleted_by_customer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS deleted_by_vendor   BOOLEAN NOT NULL DEFAULT false;

-- Bookings (also in v7 — idempotent)
CREATE TABLE IF NOT EXISTS bookings (
  id            BIGSERIAL PRIMARY KEY,
  vendor_id     BIGINT NOT NULL REFERENCES vendors(id)   ON DELETE CASCADE,
  customer_id   BIGINT NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  customer_name TEXT,
  event_date    DATE,
  guests        INTEGER,
  location      TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_vendor_idx   ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings(customer_id);
