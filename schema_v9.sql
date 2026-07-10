-- schema_v9.sql — real, persisted vendor reviews
-- Run in Supabase SQL Editor after schema_v8.sql has been applied.

CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  vendor_id   INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_vendor_idx ON reviews(vendor_id);

-- vendors.rating and vendors.reviews are kept as real aggregate columns
-- (average rating, total count) recomputed every time a review is posted —
-- this is what makes the counter on the vendor card update live instead of
-- staying frozen at a seeded demo number.
