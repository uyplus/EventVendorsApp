# Backend integration — what's already wired & what's left

This backend now has all the new features wired in. Most of Step 1 is **done in these files**;
the remaining items only need keys / `npm install` / uncommenting two lines.

## Already wired (no action needed in code)
- **features.js** is created and **mounted in server.js** — reviews, bookings, notifications,
  messaging, and password reset endpoints are live (Postgres-backed).
- **migrate.js** now applies **schema.sql AND schema_v2.sql** (reviews, bookings, notifications,
  threads, messages, password_reset_tokens + vendor lat/lng).
- **package.json** already lists the new deps (multer, @supabase/supabase-js, stripe, resend).
- **media.js / email.js / payments.js** are included as drop-in modules.

## Do this to go live (in order)
1. **Install deps**
   ```
   npm install
   ```
2. **Apply the new tables** — either:
   ```
   npm run migrate            # if DATABASE_URL / PG* env is set
   ```
   …or paste `src/schema_v2.sql` into the Supabase SQL Editor and Run (no password needed).
3. **Start & smoke-test**
   ```
   npm start
   ```
   The console should print “[features] … routes mounted.” Hit /api/health → {"ok":true}.
   New endpoints now work: GET /api/vendors/:id/reviews, /api/threads, /api/notifications, etc.

## Optional integrations (enable when you have the keys)
Open `src/server.js`, find the two commented lines just above `/* boot */`, and uncomment:

- **Uploads (Supabase Storage)** → `mountMedia(app, { auth, requireVendor });`
  - Supabase → Storage → create a **public** bucket `vendor-media`.
  - Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET=vendor-media`.

- **Real Stripe payments** → `await mountPayments(app, { auth, requireVendor });`
  - **Remove the old stub routes** that collide: in server.js delete the existing
    `/api/payments/checkout` and `/api/billing/webhook` (and `/api/billing/subscribe` if unused),
    since payments.js registers `/api/billing/checkout`, `/api/payments/checkout`, `/api/billing/webhook`.
  - Stripe: create a recurring $29/mo Price → `STRIPE_PRICE_SPONSORED`; add a webhook to
    `/api/billing/webhook` → `STRIPE_WEBHOOK_SECRET`.
  - Env: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_SPONSORED`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`.

- **Email (Resend)** — already imported by features.js for password reset; it logs to console
  until you set `RESEND_API_KEY` and `EMAIL_FROM`. To also send a verification email on signup,
  add to the signup handler: `import { sendVerifyEmail } from "./email.js";` then
  `sendVerifyEmail(user.email, `${process.env.APP_URL}/verify?token=${verifyToken}`);`

## CAPTCHA
Backend already verifies tokens (`verifyCaptcha`). Set `CAPTCHA_SECRET` (Turnstile secret).
Frontend: set `window.EVENT_VENDORS_TURNSTILE` to the Turnstile **site** key in index.html.

## Env vars (set in Render or your host)
```
DATABASE_URL or PG*   JWT_SECRET   CORS_ORIGIN   APP_URL
SUPABASE_URL  SUPABASE_SERVICE_KEY  SUPABASE_BUCKET
STRIPE_SECRET_KEY  STRIPE_PRICE_SPONSORED  STRIPE_WEBHOOK_SECRET
RESEND_API_KEY  EMAIL_FROM   CAPTCHA_SECRET
```

## If you already edited server.js
Don't overwrite it — just add these two lines: the import
`import { mountFeatures } from "./features.js";` and the call
`mountFeatures(app, { auth, requireVendor, repo });` before `app.listen`.
