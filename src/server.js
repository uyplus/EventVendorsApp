import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { repo } from "./repo.js";
import { query, usingPg } from "./db.js";
import { ensureSeeded } from "./seed.js";
import { CATEGORIES, LICENSE_BY_OFFERING, CUISINE_OPTIONS } from "./taxonomy.js";
import { hashPassword, checkPassword, signToken, publicUser, requireAuth, requireVendor, requireAdmin } from "./auth.js";
import { countries, statesOf, citiesOf, source as geoSource } from "./locations.js";
let billingMode = () => {}, createSubscriptionCheckout = () => {}, createPaymentCheckout = () => {}, handleWebhook = () => {};
try { ({ billingMode, createSubscriptionCheckout, createPaymentCheckout, handleWebhook } = await import("./billing.js")); } catch {}
import { mountFeatures } from "./features.js";
import { mountMedia } from "./media.js";
let mountClaim = () => {};
try { ({ mountClaim } = await import("./claim.js")); } catch {}
import { mountCompliance } from "./compliance.js";
let mountChat = () => {};
try { ({ mountChat } = await import("./chat.js")); } catch {}
let mountAnalytics = () => {};
try { ({ mountAnalytics } = await import("./analytics.js")); } catch {}
import {
  sendVerifyEmail, sendWelcomeEmail, sendNewMessageEmail,
  sendContactEmail, sendReportNotificationEmail,
  sendLicenceVerifiedEmail, sendLicenceRejectedEmail,
  sendClaimEmail, sendBookingRequestEmail, sendBookingDecisionEmail,
} from "./email.js";
import * as EMAILS from "./email.js";
// Defensive: older copies of email.js may not export sendNotificationEmail.
// A missing named import would crash Node at startup, so resolve it at runtime.
const sendNotificationEmail = EMAILS.sendNotificationEmail || (async () => {});
const emailModule = { sendClaimEmail };

const APP_URL = process.env.APP_URL || process.env.CORS_ORIGIN || "https://eventvendors.us";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(","), credentials: true }));

// ── baseline security headers ───────────────────────────────────────────────
// Lightweight, dependency-free defense-in-depth. The frontend (served by
// Netlify) carries its own header set in netlify.toml — these cover the API.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});

// ── global baseline rate limit ──────────────────────────────────────────────
// Generous per-IP-per-path ceiling so no single endpoint can be hammered or
// scraped. Sensitive routes (signup/login/contact) layer a stricter limit
// on top of this — see their individual rateLimit(...) calls below.
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

const auth = requireAuth(repo);
const admin = requireAdmin(repo);
const COUNTRY_NAME = { US: "United States", CA: "Canada", NG: "Nigeria" };
// Signup sends the full country name ("United States"); every other vendor
// record (seed data, demo signups) stores the 2-letter code ("US"). Convert
// here so a backend-created vendor's country always matches that convention
// — otherwise it silently fails every country-based filter downstream.
const codeForCountryName = (name) => Object.entries(COUNTRY_NAME).find(([, n]) => n === name)?.[0] || (name || "US");

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
app.get("/api/health/messaging", h(async (req, res) => {
  if (!usingPg) return res.json({ mode: "in-memory", tablesExist: true, note: "Using in-memory store — no DB." });
  try {
    await query("SELECT 1 FROM threads LIMIT 1");
    await query("SELECT 1 FROM thread_messages LIMIT 1");
    const tc = (await query("SELECT COUNT(*) AS n FROM threads")).rows[0].n;
    const mc = (await query("SELECT COUNT(*) AS n FROM thread_messages")).rows[0].n;
    res.json({ mode: "postgres", tablesExist: true, threadCount: Number(tc), messageCount: Number(mc) });
  } catch (e) {
    res.status(500).json({ mode: "postgres", tablesExist: false, error: e.message,
      fix: "Run schema_v15.sql in your Supabase SQL Editor." });
  }
}));

app.get("/api/version", (req,res)=>res.json({version:"v265-2026-07-15",fixes:["booking-accept-decline","booking-request-email","booking-decision-email","booking-pending-status","msg-timestamp-format","messaging-self-heal","threads-table-autocreate","fk-drop-demo-vendors","messaging-route-deduped","role-enforcement","listing-prepopulate","compliance-vendor-media"],usingPg}));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/categories", (req, res) => res.json({ categories: CATEGORIES, licenseByOffering: LICENSE_BY_OFFERING, cuisines: CUISINE_OPTIONS }));

/* ── locations ─────────────────────────────────────────────────────────── */
app.get("/api/locations/countries", (req, res) => res.json(countries()));
app.get("/api/locations/states", (req, res) => res.json(statesOf(req.query.country || "")));
app.get("/api/locations/cities", (req, res) => res.json(citiesOf(req.query.country || "", req.query.state || "")));
app.get("/api/locations/meta", (req, res) => res.json({ source: geoSource(), countryCount: countries().length }));

// ── Public landing-page stats — used by the hero stats row. No auth needed. ──
app.get("/api/stats/summary", h(async (req, res) => {
  const vendors = await repo.listActiveVendors().catch(() => []);
  const countrySet = new Set(vendors.map((v) => v.country).filter(Boolean));
  res.json({
    vendors: vendors.length,
    categories: 7,
    countries: Math.max(countrySet.size, 2), // US + Canada minimum, even pre-launch
  });
}));

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
    city: b.city || "", state: b.state || "", postal: b.postal || "", country: codeForCountryName(b.country),
    businessName: b.businessName || "", businessAddress: b.businessAddress || "", businessPhone: b.businessPhone || "",
    services,
  });

  // Store legal acceptance for compliance record-keeping.
  await repo.saveUserCompliance(user.id, {
    termsAcceptedAt: b.termsAcceptedAt || new Date().toISOString(),
    termsVersion: b.termsVersion || "1.0",
    contractorAck: role === "vendor" ? !!b.contractorAck : false,
    joinedAt: b.joinedAt || new Date().toISOString(),
  }).catch(() => {});

  if (role === "vendor") {
    const firstCat = Object.keys(services)[0];
    const firstOffering = firstCat ? services[firstCat][0] : "";
    const FOUNDING_VENDOR_LIMIT = 100;
    const vendorCountBeforeThisOne = await repo.countVendors().catch(() => FOUNDING_VENDOR_LIMIT); // if the count fails for any reason, default to NOT granting — safer than over-granting
    const newVendor = await repo.createVendor({
      ownerUserId: user.id, name: (b.businessName || `${user.firstName}'s Services`).trim(),
      cat: firstCat || "mgmt", offering: firstOffering || "Full event planning",
      price: 2, startingPrice: b.startingPrice === null ? null : (Number.isFinite(parseInt(b.startingPrice)) ? parseInt(b.startingPrice) : null),
      city: user.city, region: user.state, country: user.country || "US",
      licensed: !!b.licensed, equipmentHire: !!b.equipmentHire, fullService: !!b.fullService,
      languages: Array.isArray(b.languagesSpoken) && b.languagesSpoken.length ? b.languagesSpoken : ["English"],
      about: b.pitch || "", pitch: b.pitch || "", businessAddress: b.businessAddress || "", businessPhone: b.businessPhone || "",
      cuisines: b.cuisines && b.cuisines.length ? b.cuisines : null, services, hue: 200,
      experienceSinceYear: b.experienceSinceYear ?? null,
      serviceAreas: Array.isArray(b.serviceAreas) ? b.serviceAreas : [],
      instagramHandle: b.instagramHandle || null, facebookHandle: b.facebookHandle || null, tiktokHandle: b.tiktokHandle || null,
      operatingHours: b.operatingHours || null,
    });
    // Founding-vendor perk: first 100 real signups get Premium, free, no expiry.
    // Isolated from vendor creation itself — if this fails (e.g. schema_v8.sql
    // not run yet), the vendor account still exists; they just don't get the
    // badge until an admin grants it manually or the schema catches up.
    if (vendorCountBeforeThisOne < FOUNDING_VENDOR_LIMIT && newVendor?.id) {
      await repo.setPremium(newVendor.id, "founding", null).catch(() => {});
    }
  }
  // Send a registration confirmation / verification email with an activation link.
  // No-throw: a mail failure never blocks signup.
  const verifyLink = `${APP_URL}/?verify=${emailToken}`;
  sendVerifyEmail(email, verifyLink, user.firstName).catch(() => {});
  sendWelcomeEmail(email, user.firstName, role).catch(() => {});
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.get("/api/auth/verify", h(async (req, res) => {
  const userId = await repo.verifyEmail(req.query.token);
  if (!userId) return res.status(400).json({ error: "Invalid or expired verification link." });
  // Clicking an email link often opens in an isolated in-app browser
  // (Gmail/Outlook's own preview webview), a separate storage context from
  // wherever someone was actually logged in — which looks exactly like
  // being logged out, even though nothing was actually cleared. Issuing a
  // fresh session here means verifying actively logs you in, in whichever
  // context the link happens to open, instead of leaving that to chance.
  const user = await repo.findUserById(userId);
  res.json({ ok: true, verified: true, token: user ? signToken(user) : null, user: user ? publicUser(user) : null });
}));

// Contact form (public, rate-limited) → emails the team inbox.
app.post("/api/contact", rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), h(async (req, res) => {
  const b = req.body || {};
  if (b.hp) return res.json({ ok: true });
  if (!b.subject || !b.body) return res.status(400).json({ error: "Subject and message are required." });
  sendContactEmail({ name: b.name, email: b.email, subject: b.subject, body: b.body }).catch(() => {});
  res.json({ ok: true });
}));

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), h(async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const user = await repo.findUserByEmail(email);
  if (!user || !checkPassword(req.body?.password || "", user.passwordHash))
    return res.status(401).json({ error: "Invalid email or password." });
  if (user.suspended) return res.status(403).json({ error: "This account has been suspended." });
  // Each email is tied to exactly one role at signup — reject a mismatched
  // login explicitly instead of silently logging them into their real role
  // regardless of which toggle was selected, which just looks confusing.
  const requestedRole = req.body?.role === "vendor" ? "vendor" : "customer";
  if (requestedRole !== user.role) {
    return res.status(403).json({ error: `This email is registered as a ${user.role}. Please select "I'm a ${user.role}" to log in.`, actualRole: user.role });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get("/api/auth/me", auth, h(async (req, res) => {
  const user = publicUser(req.user);
  // For vendors, merge in their listing data so the dashboard edit form pre-populates
  if (req.user.role === "vendor") {
    try {
      const listing = await repo.findVendorByOwner(req.user.id);
      if (listing) {
        // Merge all listing fields — these are what the Nn dashboard edit reads
        Object.assign(user, {
          about: listing.about, photos: listing.photos || [],
          services: listing.services || {}, cuisines: listing.cuisines || [],
          languagesSpoken: listing.languages || [], languages: listing.languages || [],
          instagramHandle: listing.instagramHandle || null,
          facebookHandle: listing.facebookHandle || null,
          tiktokHandle: listing.tiktokHandle || null,
          operatingHours: listing.operatingHours || null,
          serviceAreas: listing.serviceAreas || [],
          startingPrice: listing.startingPrice ?? null,
          experienceSinceYear: listing.experienceSinceYear ?? null,
          licensed: !!listing.licensed,
          licenceFile: listing.licencePath || listing.licenceFile || null,
          licenceExpiry: listing.licenceExpires || listing.licenceExpiry || null,
          insuranceFile: listing.insurancePath || listing.insuranceFile || null,
          priceListPath: listing.priceListPath || null,
          equipmentHire: !!listing.equipmentHire, fullService: !!listing.fullService,
          blockedDates: listing.blockedDates || [],
          businessCity: listing.city, businessRegion: listing.region,
        });
      }
    } catch (e) { console.error("[me] listing merge failed:", e.message); }
  }
  res.json({ user });
}));


// Password reset (forgot/reset) lives in features.js, mounted below via
// mountFeatures() — it already uses securely hashed tokens in a dedicated
// password_reset_tokens table. A duplicate pair of routes used to live
// here too; removed, since two handlers registered for the same path is
// exactly the kind of thing that causes silent, confusing bugs later.

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

app.get("/api/vendors/:id/reviews", h(async (req, res) => res.json(await repo.listReviewsForVendor(req.params.id))));

app.get("/api/vendors/:id/response-time", h(async (req, res) => res.json(await repo.getVendorResponseStats(req.params.id))));

app.post("/api/vendors/:id/reviews", auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), h(async (req, res) => {
  const { rating, text, author, thumbs } = req.body || {};
  const r = parseInt(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: "rating must be 1-5." });
  if (thumbs && thumbs !== "up" && thumbs !== "down") return res.status(400).json({ error: "thumbs must be 'up' or 'down'." });
  const authorName = author || `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || "Guest";
  const stats = await repo.createReview(req.params.id, req.user.id, authorName, r, (text || "").slice(0, 1000), thumbs || null);
  if (!stats) return res.status(503).json({ error: "Reviews aren't set up on the server yet." });
  res.status(201).json({ ok: true, ...stats });
}));

/* ── quotes ────────────────────────────────────────────────────────────── */
app.post("/api/quotes", rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), h(async (req, res) => {
  const b = req.body || {};
  if (!b.vendorId) return res.status(400).json({ error: "vendorId is required." });
  const id = await repo.createQuote(b);

  // A quote is a conversation-starter: if the requester is logged in, drop it
  // into the messaging inbox too so vendor and customer can continue there.
  // (Optional auth — anonymous quotes still work, they just stay email-only.)
  let quoteUser = null;
  try {
    const hh = req.headers.authorization || "";
    const token = hh.startsWith("Bearer ") ? hh.slice(7) : null;
    if (token) {
      const jwt_secret = process.env.JWT_SECRET || "dev-secret-change-me";
      const payload = jwt.verify(token, jwt_secret);
      quoteUser = await repo.findUserById(payload.id);
    }
  } catch (e) { /* anonymous quote — fine */ }

  if (quoteUser) {
    try {
      if (repo.ensureMessagingTables) await repo.ensureMessagingTables().catch(() => {});
      const thread = await repo.getOrCreateThread({
        vendorId: b.vendorId, customerId: quoteUser.id,
        subject: `Quote request${b.offering ? " \u2014 " + b.offering : ""}`, kind: "quote"
      });
      const lines = [
        "\ud83d\udccb Quote request",
        b.eventDate ? `Event date: ${b.eventDate}` : null,
        b.guests ? `Guests: ${b.guests}` : null,
        b.location ? `Location: ${b.location}` : null,
        b.budget ? `Budget: ${b.budget}` : null,
        b.notes ? `Notes: ${b.notes}` : null
      ].filter(Boolean).join("\n");
      await repo.addThreadMessage(thread.id, "customer", lines || "Quote request");
    } catch (e) { console.error("[quotes] thread create:", e.message); }
  }

  (async () => {
    try {
      const vendor = await repo.findVendorById(b.vendorId);
      const vendorUser = vendor?.ownerUserId ? await repo.findUserById(vendor.ownerUserId) : null;
      // Tell the vendor they've been contacted
      if (vendorUser?.email) {
        await sendNewMessageEmail(vendorUser.email, b.name || quoteUser?.firstName || "A customer", "quote", `${APP_URL}/?inbox=1`);
      }
      // Confirm to the customer that their request went out
      const customerEmail = quoteUser?.email || b.email;
      if (customerEmail && vendor?.name) {
        await sendNotificationEmail(customerEmail,
          `Your quote request was sent to ${vendor.name}. Replies land in your EventVendors inbox \u2014 we'll email you when they respond.`);
      }
    } catch (e) { /* never block the request over a mail failure */ }
  })();
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
  if (b.experienceSinceYear !== undefined) patch.experienceSinceYear = b.experienceSinceYear;
  if (b.serviceAreas !== undefined) patch.serviceAreas = Array.isArray(b.serviceAreas) ? b.serviceAreas : [];
  if (b.startingPrice !== undefined) patch.startingPrice = b.startingPrice === null ? null : (Number.isFinite(parseInt(b.startingPrice)) ? parseInt(b.startingPrice) : null);
  if (b.equipmentHire !== undefined) patch.equipmentHire = !!b.equipmentHire;
  if (b.fullService !== undefined) patch.fullService = !!b.fullService;
  if (b.instagramHandle !== undefined) patch.instagramHandle = b.instagramHandle || null;
  if (b.facebookHandle !== undefined) patch.facebookHandle = b.facebookHandle || null;
  if (b.tiktokHandle !== undefined) patch.tiktokHandle = b.tiktokHandle || null;
  if (b.website !== undefined) patch.website = b.website || null;
  if (b.operatingHours !== undefined) patch.operatingHours = b.operatingHours || null;
  if (b.city !== undefined) patch.city = b.city || null;
  if (b.region !== undefined) patch.region = b.region || null;
  if (b.country !== undefined) patch.country = b.country || null;
  if (b.licenceFile !== undefined) patch.licenceFile = b.licenceFile || null;
  if (b.licenceExpiry !== undefined) patch.licenceExpiry = b.licenceExpiry || null;
  if (b.insuranceFile !== undefined) patch.insuranceFile = b.insuranceFile || null;
  if (b.insuranceExpiry !== undefined) patch.insuranceExpiry = b.insuranceExpiry || null;

  // Event Vendors is free — every listing gets the full photo allowance.
  const maxPhotos = 20;
  if (b.photos !== undefined && Array.isArray(b.photos)) patch.photos = b.photos.slice(0, maxPhotos);
  const listing = await repo.updateVendorByOwner(req.user.id, patch, { name: `${req.user.firstName}'s Services`, services: req.user.services || {} });
  res.json(listing);
}));


/* ── TEMP DIAGNOSTIC — remove after messaging is fixed ─────────────────── */
app.get("/api/debug/messaging", async (req, res) => {
  const out = { usingPg, steps: [] };
  try {
    // Step 1: Can we reach the database?
    const ping = await query("SELECT 1 AS ok").catch(e => ({ error: e.message }));
    out.steps.push({ step: "db_ping", result: ping.rows?.[0] || ping });

    // Step 2: Does the threads table exist?
    const threads = await query("SELECT COUNT(*) AS n FROM threads").catch(e => ({ error: e.message }));
    out.steps.push({ step: "threads_table", result: threads.rows?.[0] || threads });

    // Step 3: Does thread_messages table exist?
    const msgs = await query("SELECT COUNT(*) AS n FROM thread_messages").catch(e => ({ error: e.message }));
    out.steps.push({ step: "thread_messages_table", result: msgs.rows?.[0] || msgs });

    // Step 4: Check threads columns
    const cols = await query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='threads' ORDER BY ordinal_position"
    ).catch(e => ({ error: e.message }));
    out.steps.push({ step: "threads_columns", result: cols.rows || cols });

    // Step 5: Check constraints on threads
    const cons = await query(
      "SELECT conname, contype FROM pg_constraint WHERE conrelid='threads'::regclass"
    ).catch(e => ({ error: e.message }));
    out.steps.push({ step: "threads_constraints", result: cons.rows || cons });

    // Step 6: Try a test INSERT (vendorId=999999, customerId=999999 — won't conflict with real data)
    const testInsert = await query(
      "INSERT INTO threads (vendor_id, customer_id, subject, kind) VALUES ($1,$2,$3,$4) RETURNING id",
      [999999, 999999, "DIAG_TEST", "message"]
    ).catch(e => ({ error: e.message, code: e.code }));
    out.steps.push({ step: "test_insert", result: testInsert.rows?.[0] || testInsert });

    // Step 7: Clean up test row
    if (testInsert.rows?.[0]) {
      await query("DELETE FROM threads WHERE subject='DIAG_TEST'").catch(() => {});
      out.steps.push({ step: "cleanup", result: "ok" });
    }

    res.json(out);
  } catch (e) {
    out.error = e.message;
    res.status(500).json(out);
  }
});
/* ── END TEMP DIAGNOSTIC ────────────────────────────────────────────────── */

/* ── messaging — two-sided: customer ⇄ vendor, one thread per pair ──────── */
app.post("/api/messages", auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }), async (req, res) => {
  try {
    const { vendorId, subject, body, kind } = req.body || {};
    if (!vendorId || !body) return res.status(400).json({ error: "vendorId and body are required." });
    // Belt and braces: make sure messaging tables exist (idempotent, ~1ms when they do)
    if (repo.ensureMessagingTables) await repo.ensureMessagingTables().catch(() => {});
    let thread;
    try { thread = await repo.getOrCreateThread({ vendorId, customerId: req.user.id, subject, kind }); }
    catch (e1) { return res.status(500).json({ error: "Thread creation failed", detail: e1.message, vendorId, customerId: req.user.id }); }
    try { await repo.addThreadMessage(thread.id, "customer", body); }
    catch (e2) { return res.status(500).json({ error: "Message save failed", detail: e2.message, threadId: thread.id }); }
  // Email the vendor — this is what makes a message actually reach someone
  // instead of just sitting unread in a dashboard inbox they may not check.
  (async () => {
    try {
      const vendor = await repo.findVendorById(vendorId);
      const vendorUser = vendor?.ownerUserId ? await repo.findUserById(vendor.ownerUserId) : null;
      if (vendorUser?.email) {
        const fromName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || "A customer";
        await sendNewMessageEmail(vendorUser.email, fromName, "message", `${APP_URL}/?inbox=1`);
      }
    } catch (e) { /* never block the request over a mail failure */ }
  })();
    res.status(201).json({ ok: true, threadId: "th" + thread.id });
  } catch (e) { res.status(500).json({ error: "Unexpected error", detail: e.message }); }
});

app.get("/api/threads", auth, h(async (req, res) => {
  if (req.user.role === "vendor") {
    const listing = await repo.findVendorByOwner(req.user.id);
    if (!listing) return res.json([]);
    return res.json(await repo.listThreadsFor({ role: "vendor", vendorId: listing.id }));
  }
  res.json(await repo.listThreadsFor({ role: "customer", userId: req.user.id }));
}));

app.post("/api/threads/:id/reply", auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 60 }), h(async (req, res) => {
  const threadId = parseInt(String(req.params.id).replace(/^th/, ""));
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: "body is required." });
  const senderRole = req.user.role === "vendor" ? "vendor" : "customer";
  await repo.addThreadMessage(threadId, senderRole, body);
  // Email whichever party did NOT just send this — a reply is exactly the
  // moment someone is actively waiting to hear back.
  (async () => {
    try {
      const thread = await repo.getThreadById(threadId);
      if (!thread) return;
      const fromName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || (senderRole === "vendor" ? "A vendor" : "A customer");
      let recipientEmail = null;
      if (senderRole === "vendor") {
        const customer = await repo.findUserById(thread.customer_id);
        recipientEmail = customer?.email;
      } else {
        const vendor = await repo.findVendorById(thread.vendor_id);
        const vendorUser = vendor?.ownerUserId ? await repo.findUserById(vendor.ownerUserId) : null;
        recipientEmail = vendorUser?.email;
      }
      if (recipientEmail) await sendNewMessageEmail(recipientEmail, fromName, "message", `${APP_URL}/?inbox=1`);
    } catch (e) { /* never block the request over a mail failure */ }
  })();
  res.status(201).json({ ok: true });
}));

// Mark a thread as read (vendor or customer opens their inbox)
app.delete("/api/threads/:id", auth, h(async (req, res) => {
  const threadId = parseInt(String(req.params.id).replace(/^th/, ""));
  const role = req.user.role === "vendor" ? "vendor" : "customer";
  // verify the requester is a participant in this thread
  const thread = await repo.getThreadById(threadId);
  if (!thread) return res.status(404).json({ error: "Thread not found." });
  const isParticipant =
    (role === "customer" && thread.customer_id === req.user.id) ||
    (role === "vendor"   && thread.vendor_id  !== undefined);
  if (!isParticipant) return res.status(403).json({ error: "Not authorised." });
  await repo.deleteThread(threadId, role);
  res.json({ ok: true });
}));

app.post("/api/threads/:id/read", auth, h(async (req, res) => {
  const threadId = parseInt(String(req.params.id).replace(/^th/, ""));
  await repo.markThreadRead(threadId, req.user.role);
  res.json({ ok: true });
}));

// Vendor enquiry stats — total enquiry threads received (for dashboard)
app.get("/api/vendor/enquiries/count", auth, requireVendor, h(async (req, res) => {
  const listing = await repo.findVendorByOwner(req.user.id);
  if (!listing) return res.json({ count: 0 });
  const threads = await repo.listThreadsFor({ role: "vendor", vendorId: listing.id });
  res.json({ count: threads.length });
}));

/* ── bookings — free, confirmed immediately, no payment involved ────────── */
app.post("/api/bookings", auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), h(async (req, res) => {
  const { vendorId, date, guests, location } = req.body || {};
  if (!vendorId) return res.status(400).json({ error: "vendorId is required." });
  const customerName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || "Customer";
  const booking = await repo.createBooking({ vendorId, customerId: req.user.id, customerName, eventDate: date || null, guests: guests || null, location: location || "" });
  // Drop a thread message too, so the booking shows up in the vendor's inbox as well as their bookings list.
  const thread = await repo.getOrCreateThread({ vendorId, customerId: req.user.id, subject: "Booking request", kind: "booking" }).catch(() => null);
  const details = `${date ? `for ${date}` : ""}${guests ? ` · ${guests} guests` : ""}${location ? ` · ${location}` : ""}`.trim();
  const bookingText = `New booking request${details ? " " + details : ""}. Please accept or decline from your vendor dashboard.`;
  if (thread) await repo.addThreadMessage(thread.id, "customer", bookingText).catch(() => {});
  (async () => {
    try {
      const vendor = await repo.findVendorById(vendorId);
      const vendorUser = vendor?.ownerUserId ? await repo.findUserById(vendor.ownerUserId) : null;
      if (vendorUser?.email) await sendBookingRequestEmail(vendorUser.email, customerName, details, `${APP_URL}/?inbox=1`);
    } catch (e) { /* never block the request over a mail failure */ }
  })();
  res.status(201).json({ ok: true, id: "bk" + booking.id });
}));

app.post("/api/vendor/bookings/:id/accept", auth, requireVendor, h(async (req, res) => {
  const listing = await repo.findVendorByOwner(req.user.id);
  if (!listing) return res.status(404).json({ error: "No vendor listing found for this account." });
  const booking = await repo.respondToBooking(req.params.id, listing.id, "accept");
  if (!booking) return res.status(404).json({ error: "Booking not found, already responded to, or doesn't belong to you." });
  (async () => {
    try {
      const customer = await repo.findUserById(booking.customer_id ?? booking.customerId);
      const details = `${(booking.event_date || booking.eventDate) ? `for ${booking.event_date || booking.eventDate}` : ""}${booking.guests ? ` · ${booking.guests} guests` : ""}`.trim();
      if (customer?.email) await sendBookingDecisionEmail(customer.email, listing.name, true, details, `${APP_URL}/?bookings=1`);
    } catch (e) { /* never block the request over a mail failure */ }
  })();
  res.json({ ok: true });
}));

app.post("/api/vendor/bookings/:id/decline", auth, requireVendor, h(async (req, res) => {
  const listing = await repo.findVendorByOwner(req.user.id);
  if (!listing) return res.status(404).json({ error: "No vendor listing found for this account." });
  const booking = await repo.respondToBooking(req.params.id, listing.id, "decline");
  if (!booking) return res.status(404).json({ error: "Booking not found, already responded to, or doesn't belong to you." });
  (async () => {
    try {
      const customer = await repo.findUserById(booking.customer_id ?? booking.customerId);
      const details = `${(booking.event_date || booking.eventDate) ? `for ${booking.event_date || booking.eventDate}` : ""}${booking.guests ? ` · ${booking.guests} guests` : ""}`.trim();
      if (customer?.email) await sendBookingDecisionEmail(customer.email, listing.name, false, details, `${APP_URL}/?bookings=1`);
    } catch (e) { /* never block the request over a mail failure */ }
  })();
  res.json({ ok: true });
}));

app.get("/api/vendor/bookings", auth, requireVendor, h(async (req, res) => {
  const listing = await repo.findVendorByOwner(req.user.id);
  if (!listing) return res.json([]);
  res.json(await repo.listBookingsForVendor(listing.id));
}));

app.get("/api/bookings", auth, h(async (req, res) => res.json(await repo.listBookingsForCustomer(req.user.id))));

app.post("/api/bookings/:id/cancel", auth, h(async (req, res) => {
  const ok = await repo.cancelBooking(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: "Booking not found, or it doesn't belong to you." });
  res.json({ ok: true });
}));

/* ── premium tiers — founding spots now, paid monthly/yearly later ──────── */
app.get("/api/premium/stats", h(async (req, res) => {
  const founding = await repo.countFoundingVendors().catch(() => 0);
  res.json({ foundingUsed: founding, foundingLimit: 100, foundingRemaining: Math.max(0, 100 - founding) });
}));

// Admin-only for now — this is where a Stripe webhook will call setPremium()
// automatically once monthly/yearly billing goes live. Until then, an admin
// can grant or revoke Premium by hand (e.g. for partnerships, corrections).
app.post("/api/admin/set-premium", auth, admin, h(async (req, res) => {
  const { vendorId, tier, months } = req.body || {};
  if (!vendorId) return res.status(400).json({ error: "vendorId is required." });
  let expiresAt = null;
  if (tier === "monthly") expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  else if (tier === "yearly") expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  else if (months) expiresAt = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString();
  // tier === null/undefined clears premium status entirely (manual revoke)
  await repo.setPremium(vendorId, tier || null, tier ? expiresAt : null);
  res.json({ ok: true, tier: tier || null, expiresAt: tier ? expiresAt : null });
}));

/* ── billing ── DORMANT ─────────────────────────────────────────────────────
   Event Vendors is 100% free. Subscriptions & payments are intentionally
   disabled. billing.js / payments.js remain in the repo but are not wired to
   any active route. To re-enable paid tiers later, restore the handlers and
   configure Stripe keys.                                                       */
app.get("/api/billing/mode", (req, res) => res.json({ mode: "disabled" }));
app.post("/api/billing/subscribe", (req, res) => res.status(410).json({ error: "Subscriptions are disabled — Event Vendors is free." }));
app.post("/api/payments/checkout", (req, res) => res.status(410).json({ error: "Payments are disabled — Event Vendors is free." }));
app.post("/api/billing/webhook", (req, res) => res.status(410).json({ error: "Billing is disabled." }));

/* ── community reports + admin moderation ──────────────────────────────── */
app.post("/api/reports", rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), h(async (req, res) => {
  const b = req.body || {};
  if (!b.vendorId && !b.userId) return res.status(400).json({ error: "vendorId or userId is required." });
  const id = await repo.createReport({ vendorId: b.vendorId, userId: b.userId, reason: (b.reason || "").slice(0, 1000), reasons: Array.isArray(b.reasons) ? b.reasons.slice(0, 12) : [], reporterEmail: b.reporterEmail || "" });
  // Notify the admin team immediately — reports should never sit unseen in the database.
  sendReportNotificationEmail({ vendorId: b.vendorId, userId: b.userId, reasons: b.reasons, reason: b.reason, reporterEmail: b.reporterEmail }).catch((e) => console.error("[reports] notification email failed:", e.message));
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
mountMedia(app, { auth, requireVendor, repo });
mountClaim(app, { repo, email: emailModule, generateToken: signToken });

// ── GET /api/vendors/unclaimed ─────────────────────────────────────────────
// Returns pre-populated, unclaimed vendor listings so vendors can find and
// claim their business. Supports ?q= search and ?country= filter.
app.get("/api/vendors/unclaimed", async (req, res) => {
  try {
    const { q = "", country = "", page = "1", limit = "24" } = req.query;
    const vendors = await repo.listUnclaimedVendors({
      q: String(q).trim(),
      country: String(country).trim(),
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(48, parseInt(limit) || 24),
    });
    res.json({ vendors, total: vendors.length });
  } catch (e) {
    console.error("[unclaimed] error:", e.message);
    res.status(500).json({ error: "Could not load unclaimed listings." });
  }
});
mountCompliance(app, {
  auth, requireVendor, repo,
  sendEmail: async ({ to, subject, html }) => {
    const { send } = await import("./email.js").catch(() => ({}));
    if (send) return send({ to, subject, html });
  },
  sendLicenceVerifiedEmail, sendLicenceRejectedEmail,
});
mountChat(app, { rateLimit });
mountAnalytics(app, { rateLimit, query, usingPg, admin });
//   await mountPayments(app, { auth, requireVendor });

/* ── boot ──────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 4000;
(async () => {
  await repo.init();
  // Ensure thread_messages table exists (might be missing if schema_v7 was not run)
  if (repo.ensureMessagingTables) await repo.ensureMessagingTables().catch(e=>console.error("[startup] messaging table check:",e.message));

  await ensureSeeded();
  app.listen(PORT, () => console.log(`Event Vendors API running on http://localhost:${PORT}`));
})().catch((e) => { console.error("Failed to start:", e); process.exit(1); });

// ── POST /api/admin/import-vendors ────────────────────────────────────────────
// Bulk-import pre-populated vendor records (from Yelp, Google, CSV, etc.)
// Body: { secret, vendors: [{ name, cat, city, region, country, phone, about,
//         website, source, sourceId, sourceUrl, hue, rating, reviews }] }
// IMPORTANT: protect with ADMIN_SECRET env var before going to production.
app.post("/api/admin/import-vendors", async (req, res) => {
  const { secret, vendors: batch } = req.body || {};
  const expectedSecret = process.env.ADMIN_SECRET || "ev-admin-2026";
  if (secret !== expectedSecret)
    return res.status(403).json({ error: "Forbidden." });
  if (!Array.isArray(batch) || batch.length === 0)
    return res.status(400).json({ error: "Provide a non-empty vendors array." });

  const results = { inserted: 0, skipped: 0, errors: [] };
  for (const v of batch) {
    try {
      const id = await repo.insertPrePopulatedVendor({
        name:      String(v.name || "").trim(),
        cat:       String(v.cat  || "mgmt").toLowerCase(),
        city:      String(v.city || "").trim(),
        region:    String(v.region || v.state || "").trim(),
        country:   String(v.country || "United States").trim(),
        about:     String(v.about || v.pitch || "").slice(0, 280),
        phone:     String(v.phone || v.businessPhone || "").trim(),
        website:   String(v.website || "").trim(),
        source:    String(v.source || "manual"),
        sourceId:  v.sourceId || null,
        sourceUrl: v.sourceUrl || v.source_url || null,
        hue:       Number(v.hue) || Math.floor(Math.random() * 340),
        rating:    Number(v.rating) || 0,
        reviews:   Number(v.reviews) || 0,
      });
      if (id) results.inserted++;
      else     results.skipped++;  // ON CONFLICT DO NOTHING (duplicate source_id)
    } catch (e) {
      results.errors.push({ name: v.name, error: e.message });
    }
  }
  res.json({ ok: true, ...results });
});
