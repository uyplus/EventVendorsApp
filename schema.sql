-- Event Vendors — Postgres schema. Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  role             TEXT NOT NULL DEFAULT 'customer',
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  email_token      TEXT,
  suspended        BOOLEAN NOT NULL DEFAULT FALSE,
  first_name       TEXT DEFAULT '',
  last_name        TEXT DEFAULT '',
  phone            TEXT DEFAULT '',
  address1         TEXT DEFAULT '',
  address2         TEXT DEFAULT '',
  city             TEXT DEFAULT '',
  state            TEXT DEFAULT '',
  postal           TEXT DEFAULT '',
  country          TEXT DEFAULT '',
  business_name    TEXT DEFAULT '',
  business_address TEXT DEFAULT '',
  business_phone   TEXT DEFAULT '',
  services         JSONB NOT NULL DEFAULT '{}'::jsonb,
  prefs            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id               BIGSERIAL PRIMARY KEY,
  owner_user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT '',
  cat              TEXT NOT NULL DEFAULT 'mgmt',
  offering         TEXT NOT NULL DEFAULT '',
  price            INT NOT NULL DEFAULT 2,
  starting_price   INT NOT NULL DEFAULT 0,
  city             TEXT DEFAULT '',
  region           TEXT DEFAULT '',
  country          TEXT DEFAULT 'US',
  distance         INT NOT NULL DEFAULT 0,
  rating           NUMERIC(2,1) NOT NULL DEFAULT 0,
  reviews          INT NOT NULL DEFAULT 0,
  premium          BOOLEAN NOT NULL DEFAULT FALSE,
  sponsored        BOOLEAN NOT NULL DEFAULT FALSE,
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  suspended        BOOLEAN NOT NULL DEFAULT FALSE,
  plan             TEXT NOT NULL DEFAULT 'free',
  licensed         BOOLEAN NOT NULL DEFAULT FALSE,
  equipment_hire   BOOLEAN NOT NULL DEFAULT FALSE,
  full_service     BOOLEAN NOT NULL DEFAULT TRUE,
  years            INT NOT NULL DEFAULT 0,
  languages        JSONB NOT NULL DEFAULT '["English"]'::jsonb,
  cuisines         JSONB,
  services         JSONB NOT NULL DEFAULT '{}'::jsonb,
  photos           JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_dates    JSONB NOT NULL DEFAULT '[]'::jsonb,
  about            TEXT DEFAULT '',
  pitch            TEXT DEFAULT '',
  business_address TEXT DEFAULT '',
  business_phone   TEXT DEFAULT '',
  hue              INT NOT NULL DEFAULT 200,
  max_photos       INT NOT NULL DEFAULT 3,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id           BIGSERIAL PRIMARY KEY,
  vendor_id    BIGINT REFERENCES vendors(id) ON DELETE CASCADE,
  name         TEXT DEFAULT '',
  email        TEXT DEFAULT '',
  event_date   TEXT DEFAULT '',
  guests       INT,
  message      TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id             BIGSERIAL PRIMARY KEY,
  vendor_id      BIGINT,
  user_id        BIGINT,
  reason         TEXT DEFAULT '',
  reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  reporter_email TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_cat       ON vendors(cat);
CREATE INDEX IF NOT EXISTS idx_vendors_country   ON vendors(country);
CREATE INDEX IF NOT EXISTS idx_vendors_owner     ON vendors(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_vendors_suspended ON vendors(suspended);
CREATE INDEX IF NOT EXISTS idx_quotes_vendor     ON quotes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_reports_status    ON reports(status);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
