import express from "express";
import cors from "cors";
import { repo } from "./repo.js";
import { ensureSeeded } from "./seed.js";
import { CATEGORIES, LICENSE_BY_OFFERING, CUISINE_OPTIONS } from "./taxonomy.js";
import { hashPassword, checkPassword, signToken, publicUser, requireAuth, requireVendor, requireAdmin } from "./auth.js";
import { countries, statesOf, citiesOf, source as geoSource } from "./locations.js";
import { billingMode, createSubscriptionCheckout, createPaymentCheckout, handleWebhook } from "./billing.js";
import { mountFeatures } from "./features.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(","), credentials: true }));

const auth = requireAuth(repo);
const admin = requireAdmin(repo);
const COUNTRY_NAME = { US: "United States", CA: "Canada", NG: "Nigeria" };

// limit a services object to max 3 offerings per category, keeping only valid offerings
function sanitizeServices(services) {
  const out = {};
  if (!services || typeof services !== "object") return out;
  for (const cat of CATEGORIES) {
    const picked = Array.isArray(services[cat.id]) ? services[cat.id] : [];
    const valid = picked.filter((o) => cat.offerings.includes(o)).slice(0, 3);
    if (valid.length) out[cat.id] = valid;
  }
  return out;
}

// async error wrapper so handlers can throw/await safely
const h = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Server error." }); });

/* ── health & taxonomy ─────────────────────────────────────────────────── */
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/categories", (req, res) => res.json({ categories: CATEGORIES, licenseByOffering: LICENSE_BY_OFFERING, cuisines: CUISINE_OPTIONS }));

/* ── locations ─────────────────────────────────────────────────────────── */
app.get("/api/locations/countries", (req, res) => res.json(countries()));
app.get("/api/locations/states", (req, res) => res.json(statesOf(req.query.country || "")));
app.get("/api/locations/cities", (req, res) => res.json(citiesOf(req.query.country || "", req.query.state || "")));
app.get("/api/locations/meta", (req, res) => res.json({ source: geoSource(), countryCount: countries().length }));

/* ── auth ──────────────────────────────────────────────────────────────── */
const rl = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = (req.ip || req.headers["x-forwarded-for"] || "anon") + ":" + req.path;
    const now = Date.now();
    const rec = rl.get(key) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count++; rl.set(key, rec);
    if (rec.count > max) return res.status(429).json({ error: "Too many attempts. Please try again later." });
    next();
  };
}

// Optional CAPTCHA verification (Cloudflare Turnstile / hCaptcha / reCAPTCHA).
async function verifyCaptcha(token) {
  if (!process.env.CAPTCHA_SECRET) return true; // not configured → skip (dev/demo)
  if (!token) return false;
  try {
    const r = await fetch(process.env.CAPTCHA_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: process.env.CAPTCHA_SECRET, response: token }),
    });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

app.post("/api/auth/signup", rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }), h(async (req, res) => {
  const b = req.body || {};
  if (b.hp) return res.status(400).json({ error: "Bot detected." });               // honeypot
  if (!(await verifyCaptcha(b.captchaToken))) return res.status(400).json({ error: "Human verification failed. Please try again." });
  const email = (b.email || "").trim().toLowerCase();
  if (!email || !b.password) return res.status(400).json({ error: "Email and password are required." });
  if (await repo.findUserByEmail(email)) return res.status(409).json({ error: "An account with this email already exists." });

  const role = b.role === "vendor" ? "vendor" : "customer";
  const emailToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const services = role === "vendor" ? sanitizeServices(b.services) : {};

  const user = await repo.createUser({
    role, email, passwordHash: hashPassword(b.password), verified: false, emailToken,
    firstName: (b.firstName || email.split("@")[0]).trim(), lastName: (b.lastName || "").trim(),
    phone: b.phone || "", address1: b.address1 || "", address2: b.address2 || "",
    city: b.city || "", state: b.state || "", postal: b.postal || "", country: b.country || "",
    businessName: b.businessName || "", businessAddress: b.businessAddress || "", businessPhone: b.businessPhone || "",
    services,
  });

  if (role === "vendor") {
    const firstCat = Object.keys(services)[0];
    const firstOffering = firstCat ? services[firstCat][0] : "";
    await repo.createVendor({
      ownerUserId: user.id, name: (b.businessName || `${user.firstName}'s Services`).trim(),
      cat: firstCat || "mgmt", offering: firstOffering || "Full event planning",
      price: 2, startingPrice: 0, city: user.city, region: user.state, country: user.country || "US",
      licensed: !!b.licensed, fullService: true,
      languages: Array.isArray(b.languagesSpoken) && b.languagesSpoken.length ? b.languagesSpoken : ["English"],
      about: b.pitch || "", pitch: b.pitch || "", businessAddress: b.businessAddress || "", businessPhone: b.businessPhone || "",
      cuisines: b.cuisines && b.cuisines.length ? b.cuisines : null, services, hue: 200,
    });
  }
  // In production: email a link like `${APP_URL}/verify?token=${emailToken}` instead of returning the token.
  res.status(201).json({ token: signToken(user), user: publicUser(user), verifyToken: emailToken });
}));

app.get("/api/auth/verify", h(async (req, res) => {
  const ok = await repo.verifyEmail(req.query.token);
  if (!ok) return res.status(400).json({ error: "Invalid or expired verification link." });
  res.json({ ok: true, verified: true });
}));

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), h(async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const user = await repo.findUserByEmail(email);
  if (!user || !checkPassword(req.body?.password || "", user.passwordHash))
    return res.status(401).json({ error: "Invalid email or password." });
  if (user.suspended) return res.status(403).json({ error: "This account has been suspended." });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get("/api/auth/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* ── account settings (customers & vendors) ────────────────────────────── */
app.get("/api/account", auth, (req, res) => res.json(publicUser(req.user)));

app.put("/api/account", auth, h(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ["firstName", "lastName", "email", "phone", "address1", "address2", "city", "state", "postal", "country", "businessName", "businessAddress", "businessPhone"])
    if (b[k] !== undefined) patch[k] = String(b[k]);
  if (b.prefs !== undefined && typeof b.prefs === "object") patch.prefs = b.prefs;
  if (patch.email) {
    const existing = await repo.findUserByEmail(patch.email.trim().toLowerCase());
    if (existing && String(existing.id) !== String(req.user.id)) return res.status(409).json({ error: "That email is already in use." });
    patch.email = patch.email.trim().toLowerCase();
  }
  const updated = await repo.updateUser(req.user.id, patch);
  res.json(publicUser(updated));
}));

app.post("/api/account/password", auth, h(async (req, res) => {
  const { current, next } = req.body || {};
  if (!checkPassword(current || "", req.user.passwordHash)) return res.status(400).json({ error: "Current password is incorrect." });
  if (!next || next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  await repo.setPassword(req.user.id, hashPassword(next));
  res.json({ ok: true });
}));

app.delete("/api/account", auth, h(async (req, res) => {
  await repo.deleteUser(req.user.id);
  res.json({ ok: true });
}));

/* ── vendors (search) ──────────────────────────────────────────────────── */
app.get("/api/vendors", h(async (req, res) => {
  const { q, category, offering, country, verified, licensed, sort } = req.query;
  let list = await repo.listActiveVendors();
  if (category) list = list.filter((v) => v.cat === category);
  if (offering) list = list.filter((v) => v.offering === offering);
  if (country && country !== "all") list = list.filter((v) => v.country === country || COUNTRY_NAME[v.country] === country);
  if (verified === "true") list = list.filter((v) => v.verified);
  if (licensed === "true") list = list.filter((v) => !LICENSE_BY_OFFERING[v.offering] || v.licensed);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((v) => v.name.toLowerCase().includes(s) || (v.offering || "").toLowerCase().includes(s) || (v.cuisines && v.cuisines.some((c) => c.toLowerCase().includes(s))));
  }
  const sorters = {
    rating: (a, b) => b.rating - a.rating,
    priceLow: (a, b) => a.startingPrice - b.startingPrice,
    priceHigh: (a, b) => b.startingPrice - a.startingPrice,
    distance: (a, b) => a.distance - b.distance,
    featured: (a, b) => (b.sponsored - a.sponsored) || (b.premium - a.premium) || b.rating - a.rating,
  };
  res.json([...list].sort(sorters[sort] || sorters.featured));
}));

app.get("/api/vendors/:id", h(async (req, res) => {
  const v = await repo.findVendorById(req.params.id);
  if (!v) return res.status(404).json({ error: "Vendor not found" });
  res.json(v);
}));

/* ── quotes ────────────────────────────────────────────────────────────── */
app.post("/api/quotes", h(async (req, res) => {
  const b = req.body || {};
  if (!b.vendorId) return res.status(400).json({ error: "vendorId is required." });
  const id = await repo.createQuote(b);
  res.status(201).json({ ok: true, id });
}));

/* ── vendor's own listing (auth) ───────────────────────────────────────── */
app.get("/api/vendor/listing", auth, requireVendor, h(async (req, res) => {
  res.json(await repo.findVendorByOwner(req.user.id));
}));

app.put("/api/vendor/listing", auth, requireVendor, h(async (req, res) => {
  const b = req.body || {};
  const cur = (await repo.findVendorByOwner(req.user.id)) || { maxPhotos: 3, plan: "free", languages: ["English"] };
  const patch = {};
  if (b.services !== undefined) patch.services = sanitizeServices(b.services);
  if (b.cuisines !== undefined) patch.cuisines = Array.isArray(b.cuisines) ? b.cuisines : null;
  if (b.licensed !== undefined) patch.licensed = !!b.licensed;
  if (b.languagesSpoken !== undefined) patch.languages = Array.isArray(b.languagesSpoken) ? b.languagesSpoken : cur.languages;
  if (b.blockedDates !== undefined) patch.blockedDates = Array.isArray(b.blockedDates) ? b.blockedDates : [];
  if (b.name) patch.name = b.name;
  if (b.about !== undefined) patch.about = b.about;
  // plan/sponsored normally come from the Stripe webhook; accepted here for the demo.
  let maxPhotos = cur.maxPhotos || 3;
  if (b.plan !== undefined) {
    const plan = b.plan === "sponsored" ? "sponsored" : "free";
    patch.plan = plan; patch.sponsored = plan === "sponsored"; maxPhotos = plan === "sponsored" ? 20 : 3; patch.maxPhotos = maxPhotos;
  }
  if (b.photos !== undefined && Array.isArray(b.photos)) patch.photos = b.photos.slice(0, maxPhotos);
  const listing = await repo.updateVendorByOwner(req.user.id, patch, { name: `${req.user.firstName}'s Services`, services: req.user.services || {} });
  res.json(listing);
}));

/* ── billing ───────────────────────────────────────────────────────────── */
app.get("/api/billing/mode", (req, res) => res.json({ mode: billingMode() }));

app.post("/api/billing/subscribe", auth, requireVendor, h(async (req, res) => {
  res.json(await createSubscriptionCheckout({ user: req.user }));
}));

app.post("/api/payments/checkout", h(async (req, res) => {
  const { amount, vendorId, description, currency } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: "amount required" });
  res.json(await createPaymentCheckout({ amount, vendorId, description, currency }));
}));

// Stripe webhook — the ONLY place a vendor is granted/revoked Sponsored.
app.post("/api/billing/webhook", h(async (req, res) => {
  try {
    const out = await handleWebhook({
      rawBody: req.rawBody, signature: req.headers["stripe-signature"],
      onSubscriptionActive: (uid) => repo.setPlanByOwner(uid, "sponsored"),
      onSubscriptionCanceled: (uid) => repo.setPlanByOwner(uid, "free"),
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

/* ── community reports + admin moderation ──────────────────────────────── */
app.post("/api/reports", h(async (req, res) => {
  const b = req.body || {};
  if (!b.vendorId && !b.userId) return res.status(400).json({ error: "vendorId or userId is required." });
  const id = await repo.createReport({ vendorId: b.vendorId, userId: b.userId, reason: (b.reason || "").slice(0, 1000), reasons: Array.isArray(b.reasons) ? b.reasons.slice(0, 12) : [], reporterEmail: b.reporterEmail || "" });
  res.status(201).json({ ok: true, id });
}));

app.get("/api/admin/reports", admin, h(async (req, res) => res.json(await repo.listReports(req.query.status))));
app.get("/api/admin/users", admin, h(async (req, res) => res.json((await repo.listUsers()).map(publicUser))));

app.post("/api/admin/users/:id/suspend", admin, h(async (req, res) => {
  const val = req.body?.suspended === undefined ? true : !!req.body.suspended;
  const out = await repo.setUserSuspended(req.params.id, val);
  if (out === null) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true, id: Number(req.params.id), suspended: val });
}));

app.delete("/api/admin/users/:id", admin, h(async (req, res) => {
  const ids = await repo.deleteUser(req.params.id);
  if (ids === null) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true, deletedUserId: Number(req.params.id), deletedVendorIds: ids });
}));

app.delete("/api/admin/vendors/:id", admin, h(async (req, res) => {
  const ok = await repo.deleteVendor(req.params.id);
  if (!ok) return res.status(404).json({ error: "Vendor not found." });
  res.json({ ok: true, deletedVendorId: req.params.id });
}));

/* ── new feature endpoints (reviews, bookings, notifications, messaging, password reset) ── */
mountFeatures(app, { auth, requireVendor, repo });
// To enable uploads + real Stripe, install deps then uncomment (see INTEGRATION.md):
//   mountMedia(app, { auth, requireVendor });
//   await mountPayments(app, { auth, requireVendor });

/* ── boot ──────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 4000;
(async () => {
  await repo.init();
  await ensureSeeded();
  app.listen(PORT, () => console.log(`Event Vendors API running on http://localhost:${PORT}`));
})().catch((e) => { console.error("Failed to start:", e); process.exit(1); });
