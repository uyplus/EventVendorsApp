-- schema_v4.sql — event type analytics
-- Run in Supabase SQL Editor after schema_v3.sql

CREATE TABLE IF NOT EXISTS event_type_analytics (
  id          SERIAL PRIMARY KEY,
  event_type  TEXT         NOT NULL,          -- the value selected or typed
  is_custom   BOOLEAN      NOT NULL DEFAULT false, -- true when user typed their own
  country     TEXT,                            -- "United States" | "Canada" etc.
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for fast aggregation queries
CREATE INDEX IF NOT EXISTS eta_event_type_idx ON event_type_analytics(event_type);
CREATE INDEX IF NOT EXISTS eta_created_at_idx  ON event_type_analytics(created_at);
CREATE INDEX IF NOT EXISTS eta_country_idx     ON event_type_analytics(country);

-- Convenience view: top event types in the last 90 days
CREATE OR REPLACE VIEW event_type_summary AS
SELECT
  event_type,
  is_custom,
  COUNT(*)                                          AS total_requests,
  COUNT(*) FILTER (WHERE country = 'United States') AS us_count,
  COUNT(*) FILTER (WHERE country = 'Canada')        AS ca_count,
  MAX(created_at)                                   AS last_seen
FROM event_type_analytics
WHERE created_at >= now() - INTERVAL '90 days'
GROUP BY event_type, is_custom
ORDER BY total_requests DESC;
