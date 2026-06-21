-- schema_v7.sql — messaging + bookings (the missing link between customers and vendors)
-- Run in Supabase SQL Editor after schema_v6.sql has been applied.

CREATE TABLE IF NOT EXISTS threads (
  id           SERIAL PRIMARY KEY,
  vendor_id    INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject      TEXT DEFAULT 'Enquiry',
  kind         VARCHAR(20) DEFAULT 'message', -- 'message' | 'quote' | 'booking'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, customer_id)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id          SERIAL PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL, -- 'customer' | 'vendor'
  body        TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thread_messages_thread_idx ON thread_messages(thread_id);

CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_name TEXT,
  event_date    DATE,
  guests        INTEGER,
  location      TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'confirmed', -- free booking, no payment — confirmed immediately
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_vendor_idx ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings(customer_id);
