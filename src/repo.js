// Data-access layer. Every handler talks to the DB through this repository.
// When DATABASE_URL is set it runs parameterised SQL against Postgres;
// otherwise it falls back to the JSON file store (src/store.js) for local dev.

import { usingPg, initDb, query } from "./db.js";
import { load as memLoad, save as memSave, getDb, nextId } from "./store.js";

/* ── row → API object mappers (snake_case columns → camelCase) ───────────── */
const toUser = (r) => r && ({
  id: Number(r.id), role: r.role, email: r.email, passwordHash: r.password_hash,
  verified: r.verified, emailToken: r.email_token, suspended: r.suspended,
  firstName: r.first_name, lastName: r.last_name, phone: r.phone,
  address1: r.address1, address2: r.address2, city: r.city, state: r.state,
  postal: r.postal, country: r.country, businessName: r.business_name,
  businessAddress: r.business_address, businessPhone: r.business_phone,
  services: r.services || {}, prefs: r.prefs || {}, createdAt: r.created_at,
});
const toVendor = (r) => r && ({
  id: Number(r.id), ownerUserId: r.owner_user_id == null ? null : Number(r.owner_user_id),
  name: r.name, cat: r.cat, offering: r.offering, price: r.price, startingPrice: r.starting_price,
  city: r.city, region: r.region, country: r.country, distance: r.distance,
  rating: Number(r.rating), reviews: r.reviews, premium: r.premium, sponsored: r.sponsored,
  thumbsUp: r.thumbs_up || 0, thumbsDown: r.thumbs_down || 0,
  premiumTier: r.premium_tier || null,
  premiumSince: r.premium_since || null,
  premiumExpiresAt: r.premium_expires_at || null,
  // The badge is never a stored boolean that can go stale — it's computed
  // live from tier + expiry every time a vendor record is read. A 'founding'
  // tier has no expiry; monthly/yearly tiers stop counting the instant
  // premium_expires_at passes, with nothing to clean up afterward.
  isPremiumActive: !!r.premium_tier && (!r.premium_expires_at || new Date(r.premium_expires_at) > new Date()),
  verified: r.verified, suspended: r.suspended, plan: r.plan, licensed: r.licensed,
  licenceStatus: r.licence_status || (r.licensed ? "pending" : "none"),
  licencePath: r.licence_path, licenceExpires: r.licence_expires,
  insurancePath: r.insurance_path, insuranceStatus: r.insurance_status || "none",
  equipmentHire: r.equipment_hire, fullService: r.full_service, years: r.years,
  languages: r.languages || [], cuisines: r.cuisines, services: r.services || {},
  photos: r.photos || [], blockedDates: r.blocked_dates || [], about: r.about, pitch: r.pitch,
  businessAddress: r.business_address, businessPhone: r.business_phone, hue: r.hue,
  maxPhotos: r.max_photos, createdAt: r.created_at, joinedAt: r.joined_at || r.created_at,
  ownerEmail: r.owner_email,
  experienceSinceYear: r.experience_since_year ?? null,
  serviceAreas: r.service_areas || [],
  priceListPath: r.price_list_path || null,
  instagramHandle: r.instagram_handle || null,
  facebookHandle: r.facebook_handle || null, tiktokHandle: r.tiktok_handle || null,
  operatingHours: r.operating_hours || null,
  // claim-your-profile fields
  claimed: r.claimed ?? true,
  prePopulated: r.pre_populated ?? false,
  sourceUrl: r.source_url || null,
  website: r.website || null,
  claimTokenExpires: r.claim_token_expires || null,
});
const toReport = (r) => r && ({
  id: Number(r.id), vendorId: r.vendor_id == null ? null : Number(r.vendor_id),
  userId: r.user_id == null ? null : Number(r.user_id), reason: r.reason,
  reasons: r.reasons || [], reporterEmail: r.reporter_email, status: r.status, createdAt: r.created_at,
});
const J = (v) => (v == null ? null : JSON.stringify(v));

export const repo = {
  async init() {
    if (usingPg) { await initDb(); await query("SELECT 1"); }
    else { memLoad(); }
  },

  /* ── users ──────────────────────────────────────────────────────────── */
  async createUser(u) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO users (role,email,password_hash,verified,email_token,first_name,last_name,phone,address1,address2,city,state,postal,country,business_name,business_address,business_phone,services)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [u.role, u.email, u.passwordHash, !!u.verified, u.emailToken || null, u.firstName || "", u.lastName || "",
         u.phone || "", u.address1 || "", u.address2 || "", u.city || "", u.state || "", u.postal || "", u.country || "",
         u.businessName || "", u.businessAddress || "", u.businessPhone || "", J(u.services || {})]);
      return toUser(r.rows[0]);
    }
    const db = getDb();
    const user = { id: nextId("user"), role: u.role, email: u.email, passwordHash: u.passwordHash,
      verified: !!u.verified, emailToken: u.emailToken || null, suspended: false,
      firstName: u.firstName || "", lastName: u.lastName || "", phone: u.phone || "",
      address1: u.address1 || "", address2: u.address2 || "", city: u.city || "", state: u.state || "",
      postal: u.postal || "", country: u.country || "", businessName: u.businessName || "",
      businessAddress: u.businessAddress || "", businessPhone: u.businessPhone || "",
      services: u.services || {}, prefs: u.prefs || {}, createdAt: new Date().toISOString() };
    db.users.push(user); memSave(); return user;
  },

  async findUserByEmail(email) {
    if (usingPg) return toUser((await query("SELECT * FROM users WHERE email=$1", [email])).rows[0]) || null;
    return getDb().users.find((u) => u.email === email) || null;
  },

  async findUserById(id) {
    if (usingPg) return toUser((await query("SELECT * FROM users WHERE id=$1", [id])).rows[0]) || null;
    return getDb().users.find((u) => String(u.id) === String(id)) || null;
  },

  // Password reset lives in features.js (password_reset_tokens table,
  // hashed tokens) — that's the real, working implementation. A duplicate
  // pair of methods used to live here too; removed for the same reason
  // the duplicate routes were removed from server.js.

  async listUsers() {
    if (usingPg) return (await query("SELECT * FROM users ORDER BY id")).rows.map(toUser);
    return getDb().users.slice();
  },

  async verifyEmail(token) {
    if (usingPg) {
      const r = await query("UPDATE users SET verified=TRUE, email_token=NULL WHERE email_token=$1 RETURNING id", [token]);
      return r.rows[0]?.id || null;
    }
    const u = getDb().users.find((x) => x.emailToken && x.emailToken === token);
    if (!u) return null;
    u.verified = true; u.emailToken = null; memSave(); return u.id;
  },

  async setUserSuspended(id, val) {
    if (usingPg) {
      const r = await query("UPDATE users SET suspended=$2 WHERE id=$1 RETURNING id", [id, val]);
      if (!r.rowCount) return null;
      await query("UPDATE vendors SET suspended=$2 WHERE owner_user_id=$1", [id, val]);
      return val;
    }
    const db = getDb(); const u = db.users.find((x) => String(x.id) === String(id));
    if (!u) return null; u.suspended = val;
    db.vendors.filter((v) => String(v.ownerUserId) === String(id)).forEach((v) => { v.suspended = val; });
    memSave(); return val;
  },

  async deleteUser(id) {
    if (usingPg) {
      const ids = (await query("SELECT id FROM vendors WHERE owner_user_id=$1", [id])).rows.map((r) => Number(r.id));
      const del = await query("DELETE FROM users WHERE id=$1 RETURNING id", [id]); // cascades vendors + quotes
      if (!del.rowCount) return null;
      await query("UPDATE reports SET status='resolved' WHERE user_id=$1 OR vendor_id = ANY($2::bigint[])", [id, ids]);
      return ids;
    }
    const db = getDb(); const idx = db.users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return null;
    const ids = db.vendors.filter((v) => String(v.ownerUserId) === String(id)).map((v) => v.id);
    db.users.splice(idx, 1);
    db.vendors = db.vendors.filter((v) => String(v.ownerUserId) !== String(id));
    db.quotes = (db.quotes || []).filter((q) => !ids.includes(q.vendorId));
    (db.reports || []).forEach((r) => { if (String(r.userId) === String(id) || ids.includes(r.vendorId)) r.status = "resolved"; });
    memSave(); return ids;
  },

  async updateUser(id, patch) {
    const cur = await this.findUserById(id);
    if (!cur) return null;
    const m = { ...cur, ...patch };
    if (usingPg) {
      const r = await query(
        `UPDATE users SET first_name=$2,last_name=$3,email=$4,phone=$5,address1=$6,address2=$7,city=$8,state=$9,postal=$10,country=$11,business_name=$12,business_address=$13,business_phone=$14,prefs=$15 WHERE id=$1 RETURNING *`,
        [id, m.firstName||"", m.lastName||"", m.email||"", m.phone||"", m.address1||"", m.address2||"", m.city||"", m.state||"", m.postal||"", m.country||"", m.businessName||"", m.businessAddress||"", m.businessPhone||"", J(m.prefs||{})]);
      if (m.role === "vendor") {
        await query("UPDATE vendors SET business_address=$2,business_phone=$3,city=$4,region=$5,country=$6 WHERE owner_user_id=$1", [id, m.businessAddress||"", m.businessPhone||"", m.city||"", m.state||"", m.country||"US"]);
        if (patch.businessName) await query("UPDATE vendors SET name=$2 WHERE owner_user_id=$1", [id, patch.businessName]);
      }
      return toUser(r.rows[0]);
    }
    Object.assign(cur, patch);
    if (cur.role === "vendor") {
      const v = getDb().vendors.find((x) => String(x.ownerUserId) === String(id));
      if (v) { v.businessAddress = m.businessAddress||""; v.businessPhone = m.businessPhone||""; v.city = m.city||""; v.region = m.state||""; v.country = m.country||"US"; if (patch.businessName) v.name = patch.businessName; }
    }
    memSave(); return cur;
  },

  async setPassword(id, hash) {
    if (usingPg) return (await query("UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id", [id, hash])).rowCount > 0;
    const u = getDb().users.find((x) => String(x.id) === String(id));
    if (!u) return false; u.passwordHash = hash; memSave(); return true;
  },

  /* ── premium tiers (founding spots now; paid monthly/yearly later) ────── */

  async countVendors() {
    if (usingPg) return parseInt((await query("SELECT COUNT(*)::int AS n FROM vendors")).rows[0].n, 10);
    return getDb().vendors.length;
  },

  // tier: 'founding' | 'monthly' | 'yearly' | null (null clears premium status)
  // expiresAt: a Date/ISO string, or null for tiers that never expire (founding)
  async setPremium(vendorId, tier, expiresAt = null) {
    if (usingPg) {
      try {
        await query(
          `UPDATE vendors SET premium_tier=$2, premium_since=now(), premium_expires_at=$3 WHERE id=$1`,
          [vendorId, tier, expiresAt]);
        return true;
      } catch (e) {
        if (!/column .* does not exist/i.test(e.message)) throw e;
        console.error("[repo] setPremium: premium columns missing — run schema_v8.sql in Supabase. Skipping (signup itself still succeeded). Detail:", e.message);
        return false;
      }
    }
    const v = getDb().vendors.find((x) => String(x.id) === String(vendorId));
    if (!v) return false;
    v.premiumTier = tier; v.premiumSince = new Date().toISOString(); v.premiumExpiresAt = expiresAt;
    v.isPremiumActive = !!tier && (!expiresAt || new Date(expiresAt) > new Date());
    memSave(); return true;
  },

  async countActivePremium() {
    if (usingPg) {
      try {
        const r = await query(`SELECT COUNT(*)::int AS n FROM vendors WHERE premium_tier IS NOT NULL AND (premium_expires_at IS NULL OR premium_expires_at > now())`);
        return parseInt(r.rows[0].n, 10);
      } catch (e) { return 0; }
    }
    return getDb().vendors.filter((v) => v.isPremiumActive).length;
  },

  async countFoundingVendors() {
    if (usingPg) {
      try {
        const r = await query(`SELECT COUNT(*)::int AS n FROM vendors WHERE premium_tier = 'founding'`);
        return parseInt(r.rows[0].n, 10);
      } catch (e) { return 0; }
    }
    return getDb().vendors.filter((v) => v.premiumTier === "founding").length;
  },

  /* ── reviews — real, persisted; vendor rating/count recompute live ────── */

  async createReview(vendorId, customerId, authorName, rating, body, thumbs) {
    if (usingPg) {
      try {
        await query(
          `INSERT INTO reviews (vendor_id, customer_id, author_name, rating, body, thumbs) VALUES ($1,$2,$3,$4,$5,$6)`,
          [vendorId, customerId || null, authorName || "Guest", rating, body || "", thumbs || null]);
        // Recompute the vendor's aggregate rating/count/thumbs from real reviews —
        // this is what makes the counters genuinely live, not frozen seed numbers.
        const agg = await query(`SELECT COUNT(*)::int AS n, AVG(rating)::numeric(3,2) AS avg,
          COUNT(*) FILTER (WHERE thumbs='up')::int AS up, COUNT(*) FILTER (WHERE thumbs='down')::int AS down
          FROM reviews WHERE vendor_id=$1`, [vendorId]);
        const { n, avg, up, down } = agg.rows[0];
        await query(`UPDATE vendors SET reviews=$2, rating=$3, thumbs_up=$4, thumbs_down=$5 WHERE id=$1`, [vendorId, n, avg, up, down]);
        return { count: n, rating: parseFloat(avg), thumbsUp: up, thumbsDown: down };
      } catch (e) {
        if (!/relation .* does not exist/i.test(e.message) && !/column .* does not exist/i.test(e.message)) throw e;
        console.error("[repo] createReview: reviews table/columns missing — run schema_v9.sql and schema_v10.sql in Supabase. Review was not saved. Detail:", e.message);
        return null;
      }
    }
    const db = getDb();
    db.reviews = db.reviews || [];
    db.reviews.push({ id: nextId("review"), vendorId, customerId: customerId || null, authorName: authorName || "Guest", rating, body: body || "", thumbs: thumbs || null, createdAt: new Date().toISOString() });
    const mine = db.reviews.filter((r) => r.vendorId === vendorId);
    const avg = mine.reduce((s, r) => s + r.rating, 0) / mine.length;
    const up = mine.filter((r) => r.thumbs === "up").length;
    const down = mine.filter((r) => r.thumbs === "down").length;
    const v = db.vendors.find((x) => x.id === vendorId);
    if (v) { v.reviews = mine.length; v.rating = Math.round(avg * 100) / 100; v.thumbsUp = up; v.thumbsDown = down; }
    memSave();
    return { count: mine.length, rating: Math.round(avg * 100) / 100, thumbsUp: up, thumbsDown: down };
  },

  async listReviewsForVendor(vendorId) {
    if (usingPg) {
      try {
        const r = await query(`SELECT * FROM reviews WHERE vendor_id=$1 ORDER BY created_at DESC`, [vendorId]);
        return r.rows.map((x) => ({ author: x.author_name, rating: x.rating, text: x.body, date: new Date(x.created_at).toLocaleDateString(), thumbs: x.thumbs || null }));
      } catch (e) { return []; }
    }
    const db = getDb();
    return (db.reviews || []).filter((r) => r.vendorId === vendorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((r) => ({ author: r.authorName, rating: r.rating, text: r.body, date: new Date(r.createdAt).toLocaleDateString(), thumbs: r.thumbs || null }));
  },

  /* ── response time — computed from real message timestamps ────────────
     For each thread, time from the customer's first message to the
     vendor's first reply after it, averaged across all threads with a
     reply. This is a genuine measurement, not an estimate or a default. */
  async getVendorResponseStats(vendorId) {
    if (usingPg) {
      try {
        const r = await query(`
          WITH first_customer AS (
            SELECT t.id AS thread_id, MIN(m.created_at) AS at
            FROM threads t JOIN thread_messages m ON m.thread_id = t.id
            WHERE t.vendor_id = $1 AND m.sender_role = 'customer'
            GROUP BY t.id
          ),
          first_reply AS (
            SELECT fc.thread_id, MIN(m.created_at) AS at
            FROM first_customer fc
            JOIN thread_messages m ON m.thread_id = fc.thread_id AND m.sender_role = 'vendor' AND m.created_at > fc.at
            GROUP BY fc.thread_id
          )
          SELECT AVG(EXTRACT(EPOCH FROM (fr.at - fc.at)))::int AS avg_seconds, COUNT(*)::int AS n
          FROM first_customer fc JOIN first_reply fr ON fr.thread_id = fc.thread_id`, [vendorId]);
        const { avg_seconds, n } = r.rows[0];
        return { avgMinutes: avg_seconds != null ? Math.round(avg_seconds / 60) : null, sampleSize: n || 0 };
      } catch (e) { return { avgMinutes: null, sampleSize: 0 }; }
    }
    const db = getDb();
    const myThreads = (db.threads || []).filter((t) => t.vendorId === Number(vendorId));
    let total = 0, count = 0;
    for (const t of myThreads) {
      const msgs = (db.threadMessages || []).filter((m) => m.threadId === t.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const firstCustomer = msgs.find((m) => m.senderRole === "customer");
      if (!firstCustomer) continue;
      const reply = msgs.find((m) => m.senderRole === "vendor" && new Date(m.createdAt) > new Date(firstCustomer.createdAt));
      if (!reply) continue;
      total += (new Date(reply.createdAt) - new Date(firstCustomer.createdAt)) / 60000;
      count++;
    }
    return { avgMinutes: count ? Math.round(total / count) : null, sampleSize: count };
  },

  /* ── vendors ────────────────────────────────────────────────────────── */
  async createVendor(v) {
    let vendor;
    if (usingPg) {
      try {
        const r = await query(
          `INSERT INTO vendors (owner_user_id,name,cat,offering,price,starting_price,city,region,country,distance,rating,reviews,premium,sponsored,verified,plan,licensed,equipment_hire,full_service,years,languages,cuisines,services,photos,about,pitch,business_address,business_phone,hue,max_photos,experience_since_year,service_areas,price_list_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) RETURNING *`,
          [v.ownerUserId ?? null, v.name || "", v.cat || "mgmt", v.offering || "", v.price ?? 2, v.startingPrice === undefined ? 0 : v.startingPrice,
           v.city || "", v.region || "", v.country || "US", v.distance ?? 0, v.rating ?? 0, v.reviews ?? 0,
           !!v.premium, !!v.sponsored, !!v.verified, v.plan || "free", !!v.licensed, !!v.equipmentHire,
           v.fullService === undefined ? true : !!v.fullService, v.years ?? 0, J(v.languages || ["English"]),
           J(v.cuisines ?? null), J(v.services || {}), J(v.photos || []), v.about || "", v.pitch || "",
           v.businessAddress || "", v.businessPhone || "", v.hue ?? 200, v.maxPhotos ?? 3,
           v.experienceSinceYear ?? null, J(v.serviceAreas || []), v.priceListPath || null]);
        vendor = toVendor(r.rows[0]);
      } catch (e) {
        // Defensive fallback: if experience_since_year / service_areas / price_list_path
        // don't exist yet (schema_v5.sql / schema_v6.sql not run), don't let a brand new
        // vendor signup fail outright — create the listing with the original column set
        // and log clearly so this is easy to spot in Render's logs.
        if (!/column .* does not exist/i.test(e.message)) throw e;
        console.error("[repo] createVendor: newer columns missing — run schema_v5.sql and schema_v6.sql in Supabase. Falling back. Detail:", e.message);
        const r = await query(
          `INSERT INTO vendors (owner_user_id,name,cat,offering,price,starting_price,city,region,country,distance,rating,reviews,premium,sponsored,verified,plan,licensed,equipment_hire,full_service,years,languages,cuisines,services,photos,about,pitch,business_address,business_phone,hue,max_photos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING *`,
          [v.ownerUserId ?? null, v.name || "", v.cat || "mgmt", v.offering || "", v.price ?? 2, v.startingPrice || 0,
           v.city || "", v.region || "", v.country || "US", v.distance ?? 0, v.rating ?? 0, v.reviews ?? 0,
           !!v.premium, !!v.sponsored, !!v.verified, v.plan || "free", !!v.licensed, !!v.equipmentHire,
           v.fullService === undefined ? true : !!v.fullService, v.years ?? 0, J(v.languages || ["English"]),
           J(v.cuisines ?? null), J(v.services || {}), J(v.photos || []), v.about || "", v.pitch || "",
           v.businessAddress || "", v.businessPhone || "", v.hue ?? 200, v.maxPhotos ?? 3]);
        vendor = toVendor(r.rows[0]);
      }
      // Social handles, set via a separate isolated update rather than baked
      // into the INSERT above — keeps that already-complex statement
      // untouched, and means a missing schema_v12.sql just skips this
      // instead of risking the vendor record itself.
      if (v.instagramHandle || v.facebookHandle || v.tiktokHandle) {
        try {
          await query(`UPDATE vendors SET instagram_handle=$2, facebook_handle=$3, tiktok_handle=$4 WHERE id=$1`,
            [vendor.id, v.instagramHandle || null, v.facebookHandle || null, v.tiktokHandle || null]);
          vendor.instagramHandle = v.instagramHandle || null; vendor.facebookHandle = v.facebookHandle || null; vendor.tiktokHandle = v.tiktokHandle || null;
        } catch (e) {
          if (!/column .* does not exist/i.test(e.message)) throw e;
          console.error("[repo] createVendor: social handle columns missing — run schema_v12.sql in Supabase. Skipped.", e.message);
        }
      }
      // Same isolated-update pattern for operating hours.
      if (v.operatingHours) {
        try {
          await query(`UPDATE vendors SET operating_hours=$2 WHERE id=$1`, [vendor.id, J(v.operatingHours)]);
          vendor.operatingHours = v.operatingHours;
        } catch (e) {
          if (!/column .* does not exist/i.test(e.message)) throw e;
          console.error("[repo] createVendor: operating_hours column missing — run schema_v13.sql in Supabase. Skipped.", e.message);
        }
      }
      return vendor;
    }
    const db = getDb();
    vendor = { id: nextId("vendor"), ownerUserId: v.ownerUserId ?? null, name: v.name || "",
      cat: v.cat || "mgmt", offering: v.offering || "", price: v.price ?? 2,
      startingPrice: v.startingPrice === undefined ? 0 : v.startingPrice, // preserve explicit null (N/A) — only default when truly unset
      city: v.city || "", region: v.region || "", country: v.country || "US", distance: v.distance ?? 0,
      rating: v.rating ?? 0, reviews: v.reviews ?? 0, premium: !!v.premium, sponsored: !!v.sponsored,
      verified: !!v.verified, suspended: false, plan: v.plan || "free", licensed: !!v.licensed,
      equipmentHire: !!v.equipmentHire, fullService: v.fullService === undefined ? true : !!v.fullService,
      years: v.years ?? 0, languages: v.languages || ["English"], cuisines: v.cuisines ?? null,
      services: v.services || {}, photos: v.photos || [], blockedDates: [], about: v.about || "",
      pitch: v.pitch || "", businessAddress: v.businessAddress || "", businessPhone: v.businessPhone || "",
      hue: v.hue ?? 200, maxPhotos: v.maxPhotos ?? 3, createdAt: new Date().toISOString(),
      experienceSinceYear: v.experienceSinceYear ?? null, serviceAreas: v.serviceAreas || [], priceListPath: v.priceListPath || null,
      instagramHandle: v.instagramHandle || null, facebookHandle: v.facebookHandle || null, tiktokHandle: v.tiktokHandle || null,
      operatingHours: v.operatingHours || null };
    db.vendors.push(vendor); memSave(); return vendor;
  },

  async findVendorById(id) {
    if (usingPg) return toVendor((await query("SELECT * FROM vendors WHERE id=$1", [id])).rows[0]) || null;
    return getDb().vendors.find((v) => String(v.id) === String(id)) || null;
  },

  async findVendorByOwner(userId) {
    if (usingPg) return toVendor((await query("SELECT * FROM vendors WHERE owner_user_id=$1 LIMIT 1", [userId])).rows[0]) || null;
    return getDb().vendors.find((v) => String(v.ownerUserId) === String(userId)) || null;
  },

  async listActiveVendors() {
    if (usingPg) {
      try {
        const r = await query(
          `SELECT *, (premium_tier IS NOT NULL AND (premium_expires_at IS NULL OR premium_expires_at > now())) AS is_premium_active
           FROM vendors WHERE suspended=FALSE
           ORDER BY is_premium_active DESC, rating DESC NULLS LAST`);
        return r.rows.map(toVendor);
      } catch (e) {
        if (!/column .* does not exist/i.test(e.message)) throw e;
        // schema_v8.sql not run yet — premium sorting just isn't active, everything else still works.
        return (await query("SELECT * FROM vendors WHERE suspended=FALSE")).rows.map(toVendor);
      }
    }
    return getDb().vendors.filter((v) => v.id && !v.suspended)
      .sort((a, b) => ((b.isPremiumActive ? 1 : 0) - (a.isPremiumActive ? 1 : 0)) || ((b.rating || 0) - (a.rating || 0)));
  },

  // patch contains only the keys to change; cuisines:null clears cuisines.
  async updateVendorByOwner(userId, patch, ownerDefaults = {}) {
    let listing = await this.findVendorByOwner(userId);
    if (!listing) listing = await this.createVendor({ ownerUserId: userId, ...ownerDefaults });
    const merged = { ...listing, ...patch };
    if (usingPg) {
      try {
        const r = await query(
          `UPDATE vendors SET name=$2, about=$3, services=$4, cuisines=$5, languages=$6, blocked_dates=$7,
             licensed=$8, plan=$9, sponsored=$10, max_photos=$11, photos=$12,
             experience_since_year=$13, service_areas=$14, price_list_path=$15, starting_price=$16,
             equipment_hire=$17, full_service=$18, instagram_handle=$19, facebook_handle=$20, tiktok_handle=$21,
             operating_hours=$22, website=$23 WHERE id=$1 RETURNING *`,
          [listing.id, merged.name || "", merged.about || "", J(merged.services || {}), J(merged.cuisines ?? null),
           J(merged.languages || []), J(merged.blockedDates || []), !!merged.licensed, merged.plan || "free",
           !!merged.sponsored, merged.maxPhotos ?? 3, J(merged.photos || []),
           merged.experienceSinceYear ?? null, J(merged.serviceAreas || []), merged.priceListPath || null,
           merged.startingPrice === undefined ? null : merged.startingPrice,
           !!merged.equipmentHire, !!merged.fullService,
           merged.instagramHandle || null, merged.facebookHandle || null, merged.tiktokHandle || null,
           merged.operatingHours ? J(merged.operatingHours) : null,
           merged.website || null]);
        return toVendor(r.rows[0]);
      } catch (e) {
        if (!/column .* does not exist/i.test(e.message)) throw e;
        console.error("[repo] updateVendorByOwner: newer columns missing — run schema_v5.sql, schema_v6.sql, schema_v12.sql, and schema_v13.sql in Supabase. Falling back. Detail:", e.message);
        const r = await query(
          `UPDATE vendors SET name=$2, about=$3, services=$4, cuisines=$5, languages=$6, blocked_dates=$7,
             licensed=$8, plan=$9, sponsored=$10, max_photos=$11, photos=$12 WHERE id=$1 RETURNING *`,
          [listing.id, merged.name || "", merged.about || "", J(merged.services || {}), J(merged.cuisines ?? null),
           J(merged.languages || []), J(merged.blockedDates || []), !!merged.licensed, merged.plan || "free",
           !!merged.sponsored, merged.maxPhotos ?? 3, J(merged.photos || [])]);
        return toVendor(r.rows[0]);
      }
    }
    Object.assign(listing, patch); memSave(); return listing;
  },

  async setPlanByOwner(userId, plan) {
    const sponsored = plan === "sponsored";
    const maxPhotos = sponsored ? 20 : 3;
    if (usingPg) {
      const r = await query("UPDATE vendors SET plan=$2, sponsored=$3, max_photos=$4 WHERE owner_user_id=$1 RETURNING *", [userId, plan, sponsored, maxPhotos]);
      return toVendor(r.rows[0]) || null;
    }
    const v = getDb().vendors.find((x) => String(x.ownerUserId) === String(userId));
    if (!v) return null; v.plan = plan; v.sponsored = sponsored; v.maxPhotos = maxPhotos; memSave(); return v;
  },

  async deleteVendor(id) {
    if (usingPg) return (await query("DELETE FROM vendors WHERE id=$1 RETURNING id", [id])).rowCount > 0;
    const db = getDb(); const before = db.vendors.length;
    db.vendors = db.vendors.filter((v) => String(v.id) !== String(id));
    if (db.vendors.length === before) return false; memSave(); return true;
  },

  async countVendors() {
    if (usingPg) return Number((await query("SELECT COUNT(*)::int AS n FROM vendors")).rows[0].n);
    return getDb().vendors.length;
  },

  /* ── quotes & reports ───────────────────────────────────────────────── */
  async createQuote(q) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO quotes (vendor_id,name,email,event_date,guests,message,status) VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING id`,
        [q.vendorId, q.name || "", q.email || "", q.eventDate || "", q.guests ?? null, q.message || ""]);
      return Number(r.rows[0].id);
    }
    const db = getDb();
    const quote = { id: nextId("quote"), vendorId: q.vendorId, name: q.name || "", email: q.email || "",
      eventDate: q.eventDate || "", guests: q.guests ?? null, message: q.message || "", status: "new", createdAt: new Date().toISOString() };
    db.quotes.push(quote); memSave(); return quote.id;
  },

  async createReport(rep) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO reports (vendor_id,user_id,reason,reasons,reporter_email,status) VALUES ($1,$2,$3,$4,$5,'open') RETURNING id`,
        [rep.vendorId ?? null, rep.userId ?? null, rep.reason || "", J(rep.reasons || []), rep.reporterEmail || ""]);
      return Number(r.rows[0].id);
    }
    const db = getDb(); db.reports = db.reports || [];
    const report = { id: nextId("report"), vendorId: rep.vendorId || null, userId: rep.userId || null,
      reason: rep.reason || "", reasons: rep.reasons || [], reporterEmail: rep.reporterEmail || "", status: "open", createdAt: new Date().toISOString() };
    db.reports.push(report); memSave(); return report.id;
  },

  async listReports(status) {
    if (usingPg) {
      const r = status ? await query("SELECT * FROM reports WHERE status=$1 ORDER BY id DESC", [status])
                       : await query("SELECT * FROM reports ORDER BY id DESC");
      return r.rows.map(toReport);
    }
    return (getDb().reports || []).filter((r) => (status ? r.status === status : true));
  },

  // ── compliance methods ──────────────────────────────────────────────────

  async updateVendorCompliance(vendorId, fields) {
    if (usingPg) {
      const cols = Object.keys(fields);
      const vals = Object.values(fields);
      const set  = cols.map((c, i) => `${c}=$${i + 2}`).join(", ");
      await query(`UPDATE vendors SET ${set} WHERE id=$1`, [vendorId, ...vals]);
      return;
    }
    const v = getDb().vendors.find((x) => String(x.id) === String(vendorId));
    if (v) { Object.assign(v, fields); memSave(); }
  },

  async getVendorsByLicenceStatus(status) {
    if (usingPg) {
      const r = await query(
        `SELECT v.*, u.email AS owner_email FROM vendors v
         LEFT JOIN users u ON u.id = v.owner_user_id
         WHERE v.licence_status = $1 ORDER BY v.id DESC`, [status]);
      return r.rows.map(toVendor);
    }
    return getDb().vendors.filter((v) => (v.licenceStatus || "none") === status).map(toVendor);
  },

  async getVendorById(id) {
    if (usingPg) {
      const r = await query(
        `SELECT v.*, u.email AS owner_email FROM vendors v
         LEFT JOIN users u ON u.id = v.owner_user_id
         WHERE v.id = $1`, [id]);
      return r.rows[0] ? toVendor(r.rows[0]) : null;
    }
    return getDb().vendors.find((v) => String(v.id) === String(id)) || null;
  },

  async logAdminAction({ adminEmail, action, targetType, targetId, reason }) {
    if (usingPg) {
      await query(
        `INSERT INTO admin_actions (admin_email, action, target_type, target_id, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [adminEmail, action, targetType, targetId, reason || null]);
      return;
    }
    // in-memory: no-op (dev only)
  },

  async saveUserCompliance(userId, { termsAcceptedAt, termsVersion, contractorAck, joinedAt }) {
    if (usingPg) {
      await query(
        `UPDATE users SET terms_accepted_at=$2, terms_version=$3, contractor_ack=$4, joined_at=COALESCE(joined_at,$5) WHERE id=$1`,
        [userId, termsAcceptedAt || null, termsVersion || null, !!contractorAck, joinedAt || null]);
      return;
    }
    const u = getDb().users?.find((x) => String(x.id) === String(userId));
    if (u) { Object.assign(u, { termsAcceptedAt, termsVersion, contractorAck, joinedAt }); memSave(); }
  },

  // ── messaging (two-sided: a thread links one customer + one vendor) ──────

  async getThreadById(threadId) {
    if (usingPg) return (await query("SELECT * FROM threads WHERE id=$1", [threadId])).rows[0] || null;
    const db = getDb();
    const t = (db.threads || []).find((x) => x.id === threadId);
    return t ? { id: t.id, vendor_id: t.vendorId, customer_id: t.customerId } : null;
  },

  async getOrCreateThread({ vendorId, customerId, subject, kind }) {
    if (usingPg) {
      const existing = await query(`SELECT * FROM threads WHERE vendor_id=$1 AND customer_id=$2`, [vendorId, customerId]);
      if (existing.rows[0]) return existing.rows[0];
      const r = await query(
        `INSERT INTO threads (vendor_id, customer_id, subject, kind) VALUES ($1,$2,$3,$4) RETURNING *`,
        [vendorId, customerId, subject || "Enquiry", kind || "message"]);
      return r.rows[0];
    }
    const db = getDb();
    db.threads = db.threads || [];
    let t = db.threads.find((x) => x.vendorId === vendorId && x.customerId === customerId);
    if (!t) { t = { id: nextId("thread"), vendorId, customerId, subject: subject || "Enquiry", kind: kind || "message", createdAt: new Date().toISOString() }; db.threads.push(t); memSave(); }
    return t;
  },

  async addThreadMessage(threadId, senderRole, body) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO thread_messages (thread_id, sender_role, body) VALUES ($1,$2,$3) RETURNING *`,
        [threadId, senderRole, body]);
      return r.rows[0];
    }
    const db = getDb();
    db.threadMessages = db.threadMessages || [];
    const m = { id: nextId("msg"), threadId, senderRole, body, read: false, createdAt: new Date().toISOString() };
    db.threadMessages.push(m); memSave(); return m;
  },

  // Threads + their messages, for whichever side (customer or vendor) is asking.
  async listThreadsFor({ role, userId, vendorId }) {
    if (usingPg) {
      const where = role === "vendor" ? `t.vendor_id = $1` : `t.customer_id = $1`;
      const param = role === "vendor" ? vendorId : userId;
      const threads = (await query(
        `SELECT t.*, v.name AS vendor_name, u.first_name, u.last_name
         FROM threads t
         LEFT JOIN vendors v ON v.id = t.vendor_id
         LEFT JOIN users u ON u.id = t.customer_id
         WHERE ${where}
         AND ${role === "vendor" ? "t.deleted_by_vendor = false" : "t.deleted_by_customer = false"}
         ORDER BY t.created_at DESC`, [param])).rows;
      const out = [];
      for (const t of threads) {
        const msgs = (await query(`SELECT * FROM thread_messages WHERE thread_id=$1 ORDER BY created_at ASC`, [t.id])).rows;
        out.push({
          id: "th" + t.id, vendorId: t.vendor_id, vendorName: t.vendor_name,
          customerName: `${t.first_name || ""} ${t.last_name || ""}`.trim(), subject: t.subject, kind: t.kind,
          unread: msgs.some((m) => !m.read && m.sender_role !== role),
          // "me" must mean "whoever is currently looking at this" — not
          // hardcoded to one side. A vendor viewing their own inbox needs
          // their own replies to render as "me", not as the other party.
          messages: msgs.map((m) => ({ from: m.sender_role === role ? "me" : m.sender_role, text: m.body, time: m.created_at })),
        });
      }
      return out;
    }
    const db = getDb();
    const threads = (db.threads || []).filter((t) => role === "vendor" ? t.vendorId === vendorId : t.customerId === userId);
    return threads.map((t) => {
      const msgs = (db.threadMessages || []).filter((m) => m.threadId === t.id);
      const vendor = (db.vendors || []).find((v) => v.id === t.vendorId);
      const customer = (db.users || []).find((u) => u.id === t.customerId);
      return {
        id: "th" + t.id, vendorId: t.vendorId, vendorName: vendor?.name || "Vendor",
        customerName: customer ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim() : "Customer",
        subject: t.subject, kind: t.kind,
        unread: msgs.some((m) => !m.read && m.senderRole !== role),
        messages: msgs.map((m) => ({ from: m.senderRole === role ? "me" : m.senderRole, text: m.body, time: m.createdAt })),
      };
    }).sort((a, b) => b.id.localeCompare(a.id));
  },

  async deleteThread(threadId, role) {
    if (usingPg) {
      const col = role === "vendor" ? "deleted_by_vendor" : "deleted_by_customer";
      await query(`UPDATE threads SET ${col}=true WHERE id=$1`, [threadId]);
      return;
    }
    // in-memory fallback: just remove the thread
    const db = getDb();
    db.threads = (db.threads || []).filter((t) => t.id !== threadId);
    db.threadMessages = (db.threadMessages || []).filter((m) => m.threadId !== threadId);
    memSave();
  },

  async markThreadRead(threadId, role) {
    if (usingPg) {
      await query(`UPDATE thread_messages SET read=true WHERE thread_id=$1 AND sender_role != $2`, [threadId, role]);
      return;
    }
    const db = getDb();
    (db.threadMessages || []).forEach((m) => { if (m.threadId === threadId && m.senderRole !== role) m.read = true; });
    memSave();
  },

  // ── bookings (free — no payment, confirmed immediately) ──────────────────

  async createBooking({ vendorId, customerId, customerName, eventDate, guests, location }) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO bookings (vendor_id, customer_id, customer_name, event_date, guests, location, status)
         VALUES ($1,$2,$3,$4,$5,$6,'confirmed') RETURNING *`,
        [vendorId, customerId, customerName || "", eventDate || null, guests || null, location || ""]);
      return r.rows[0];
    }
    const db = getDb();
    db.bookings = db.bookings || [];
    const b = { id: nextId("booking"), vendorId, customerId, customerName: customerName || "", eventDate: eventDate || null, guests: guests || null, location: location || "", status: "confirmed", createdAt: new Date().toISOString() };
    db.bookings.push(b); memSave(); return b;
  },

  async listBookingsForVendor(vendorId) {
    if (usingPg) {
      const r = await query(`SELECT * FROM bookings WHERE vendor_id=$1 ORDER BY event_date ASC NULLS LAST, created_at DESC`, [vendorId]);
      return r.rows.map((b) => ({ id: "bk" + b.id, vendorId: b.vendor_id, customerName: b.customer_name, date: b.event_date, guests: b.guests, location: b.location, status: b.status }));
    }
    const db = getDb();
    return (db.bookings || []).filter((b) => b.vendorId === vendorId)
      .map((b) => ({ id: "bk" + b.id, vendorId: b.vendorId, customerName: b.customerName, date: b.eventDate, guests: b.guests, location: b.location, status: b.status }));
  },

  async listBookingsForCustomer(customerId) {
    if (usingPg) {
      const r = await query(
        `SELECT b.*, v.name AS vendor_name FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.customer_id=$1 ORDER BY b.event_date ASC NULLS LAST`, [customerId]);
      return r.rows.map((b) => ({ id: "bk" + b.id, vendorId: b.vendor_id, vendorName: b.vendor_name, date: b.event_date, guests: b.guests, location: b.location, status: b.status }));
    }
    const db = getDb();
    return (db.bookings || []).filter((b) => b.customerId === customerId)
      .map((b) => { const v = (db.vendors || []).find((x) => x.id === b.vendorId); return { id: "bk" + b.id, vendorId: b.vendorId, vendorName: v?.name, date: b.eventDate, guests: b.guests, location: b.location, status: b.status }; });
  },

  // Cancelling sets status rather than deleting — keeps a record, and frees
  // the customer to immediately book a new date with the same or another
  // vendor. Verifies the booking actually belongs to this customer first.
  async cancelBooking(bookingId, customerId) {
    const rawId = String(bookingId).replace(/^bk/, "");
    if (usingPg) {
      const r = await query(`UPDATE bookings SET status='cancelled' WHERE id=$1 AND customer_id=$2 RETURNING id`, [rawId, customerId]);
      return r.rowCount > 0;
    }
    const db = getDb();
    const b = (db.bookings || []).find((x) => String(x.id) === String(rawId) && x.customerId === customerId);
    if (!b) return false;
    b.status = "cancelled"; memSave(); return true;
  },

  /* ── claim-your-profile ─────────────────────────────────────────────── */

  // Look up an unclaimed vendor by its single-use claim token.
  async findVendorByClaimToken(token) {
    if (!token) return null;
    if (usingPg) {
      const r = await query(
        `SELECT *, claim_token_expires AS "claimTokenExpires" FROM vendors WHERE claim_token = $1 LIMIT 1`,
        [token]
      );
      return r.rows[0] ? toVendor({ ...r.rows[0], claimTokenExpires: r.rows[0].claimTokenExpires }) : null;
    }
    return (getDb().vendors || []).find((v) => v.claimToken === token) || null;
  },

  // Persist a fresh claim token + expiry on a pre-populated vendor so we can
  // send it in the claim email. Safe to call multiple times (overwrites).
  async setClaimToken(vendorId, token, expiresIso) {
    if (usingPg) {
      await query(
        `UPDATE vendors SET claim_token = $2, claim_token_expires = $3 WHERE id = $1`,
        [vendorId, token, expiresIso]
      );
      return;
    }
    const v = (getDb().vendors || []).find((x) => String(x.id) === String(vendorId));
    if (v) { v.claimToken = token; v.claimTokenExpires = expiresIso; memSave(); }
  },

  // Transfer ownership once the vendor has created their account via the claim link.
  async claimVendor(vendorId, userId, _usedToken) {
    if (usingPg) {
      await query(
        `UPDATE vendors
            SET owner_user_id        = $2,
                claimed              = true,
                claim_token          = NULL,
                claim_token_expires  = NULL
          WHERE id = $1`,
        [vendorId, userId]
      );
      return;
    }
    const v = (getDb().vendors || []).find((x) => String(x.id) === String(vendorId));
    if (v) {
      v.ownerUserId = userId; v.claimed = true;
      v.claimToken = null; v.claimTokenExpires = null;
      memSave();
    }
  },

  // Insert a vendor row sourced from an external scraper (Google / Yelp / CSV).
  // Returns null (silently) if source_id already exists — idempotent scraping.
  async insertPrePopulatedVendor(v) {
    if (usingPg) {
      try {
        const r = await query(
          `INSERT INTO vendors
             (name, cat, city, region, country,
              about, business_phone, website,
              hue, plan, languages, photos, offering, services,
              pre_populated, claimed, source, source_id, source_url,
              claim_token, claim_token_expires,
              rating, reviews, max_photos, price, starting_price,
              full_service, years, service_areas)
           VALUES
             ($1,$2,$3,$4,$5,
              $6,$7,$8,
              $9,$10,$11,$12,$13,$14,
              true,false,$15,$16,$17,
              $18,$19,
              $20,$21,$22,$23,$24,
              true,0,'{}')
           ON CONFLICT (source_id)
             WHERE source_id IS NOT NULL
             DO NOTHING
           RETURNING id`,
          [
            v.name, v.cat || "eventmgmt", v.city || "", v.region || "", v.country || "US",
            v.about || "", v.phone || "", v.website || "",
            v.hue ?? 220, "free",
            J(["English"]), J(v.photos || []), "", J({}),
            v.source || "manual", v.sourceId || null, v.sourceUrl || null,
            v.claimToken, v.claimTokenExpires,
            v.rating ?? 0, v.reviews ?? 0, 10, 2, 0,
          ]
        );
        return r.rows[0]?.id ?? null;
      } catch (e) {
        // If schema_v14 hasn't been run yet, skip gracefully
        if (/column .* does not exist/i.test(e.message)) {
          console.warn("[repo] insertPrePopulatedVendor: run schema_v14.sql first.", e.message);
          return null;
        }
        throw e;
      }
    }
    // In-memory fallback: just push (no dedup by source_id for local dev)
    const db = getDb();
    if ((db.vendors || []).some((x) => x.sourceId && x.sourceId === v.sourceId)) return null;
    const vendor = { id: nextId("vendor"), claimed: false, prePopulated: true, ...v, createdAt: new Date().toISOString() };
    db.vendors = db.vendors || [];
    db.vendors.push(vendor); memSave();
    return vendor.id;
  },

  async listUnclaimedVendors({ q = "", country = "", page = 1, limit = 24 }) {
    try {
      if (!usingPg()) {
        const db = getDb();
        const all = (db.vendors || []).filter(v => v.prePopulated && !v.claimed);
        const filtered = q
          ? all.filter(v =>
              (v.name||"").toLowerCase().includes(q.toLowerCase()) ||
              (v.city||"").toLowerCase().includes(q.toLowerCase()))
          : all;
        const countryed = country ? filtered.filter(v => v.country===country) : filtered;
        return countryed.slice((page-1)*limit, page*limit).map(toVendor);
      }
      const offset = (page - 1) * limit;
      const term = q ? `%${q}%` : "%";
      const params = [term, limit, offset];
      let sql = `SELECT * FROM vendors WHERE pre_populated = true AND (claimed = false OR claimed IS NULL)
                 AND (name ILIKE $1 OR city ILIKE $1 OR about ILIKE $1)`;
      if (country) { sql += ` AND country = $${params.length+1}`; params.push(country); }
      sql += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      const result = await query(sql, params);
      return result.rows.map(toVendor);
    } catch (e) {
      console.error("[repo] listUnclaimedVendors:", e.message);
      return [];
    }
  },
};
