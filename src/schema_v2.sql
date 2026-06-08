-- Event Vendors — schema v2 (reviews, bookings, notifications, password reset, vendor coords).
-- Additive and idempotent: safe to run on top of the existing schema, and safe to re-run.
-- You can paste this straight into the Supabase SQL Editor (no DB password needed).

-- ── Reviews ──────────────────────────────────────────────────────────────────
-- API: GET/POST /api/vendors/:id/reviews. Frontend field "text" maps to column "body",
-- and "date" in responses can be derived from created_at.
CREATE TABLE IF NOT EXISTS reviews (
  id              BIGSERIAL PRIMARY KEY,
  vendor_id       BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  author_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  author          TEXT NOT NULL DEFAULT 'Anonymous',
  rating          INT  NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  body            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bookings ─────────────────────────────────────────────────────────────────
-- API: POST /api/bookings {vendorId, date, guests}; GET /api/vendor/bookings.
CREATE TABLE IF NOT EXISTS bookings (
  id                BIGSERIAL PRIMARY KEY,
  vendor_id         BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  customer_name     TEXT NOT NULL DEFAULT '',
  event_date        TEXT NOT NULL DEFAULT '',     -- stored as the displayed date string
  guests            INT,
  amount            INT NOT NULL DEFAULT 0,        -- deposit paid
  status            TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('pending','confirmed','cancelled','completed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notifications ────────────────────────────────────────────────────────────
-- API: GET /api/notifications; POST /api/notifications/read. Field "text" -> column "body".
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Password reset tokens ────────────────────────────────────────────────────
-- API: POST /api/auth/forgot {email}  -> create a row, email the raw token to the user.
--      POST /api/auth/reset {token, password} -> look up by hash, check expiry/used, set password.
-- Store only a HASH of the token (e.g. sha256), never the raw token.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Vendor coordinates (for accurate distance) ───────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_vendor        ON reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor       ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer     ON bookings(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash     ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user     ON password_reset_tokens(user_id);

-- Optional: keep vendors.rating / vendors.reviews in sync after a review is added or
-- removed (recompute AVG(rating) and COUNT(*) for that vendor) in your repo layer.

-- ── Messaging (threads + messages) ───────────────────────────────────────────
-- A thread is one conversation between a customer and a vendor.
CREATE TABLE IF NOT EXISTS threads (
  id                BIGSERIAL PRIMARY KEY,
  customer_user_id  BIGINT REFERENCES users(id) ON DELETE CASCADE,
  vendor_id         BIGINT REFERENCES vendors(id) ON DELETE CASCADE,
  subject           TEXT NOT NULL DEFAULT '',
  customer_unread   BOOLEAN NOT NULL DEFAULT FALSE,
  vendor_unread     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  thread_id   BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('customer','vendor')),
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_threads_customer ON threads(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_threads_vendor   ON threads(vendor_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id);
