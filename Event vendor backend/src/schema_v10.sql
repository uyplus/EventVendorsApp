-- schema_v10.sql — thumbs up/down voting on reviews
-- Run in Supabase SQL Editor after schema_v9.sql has been applied.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS thumbs VARCHAR(4); -- 'up' | 'down'

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS thumbs_up   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thumbs_down INTEGER NOT NULL DEFAULT 0;

-- thumbs_up / thumbs_down on vendors are recomputed from the reviews table
-- every time a review is posted — same pattern as the live rating/count.
