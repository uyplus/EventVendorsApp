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

  async listUsers() {
    if (usingPg) return (await query("SELECT * FROM users ORDER BY id")).rows.map(toUser);
    return getDb().users.slice();
  },

  async verifyEmail(token) {
    if (usingPg) return (await query("UPDATE users SET verified=TRUE, email_token=NULL WHERE email_token=$1 RETURNING id", [token])).rowCount > 0;
    const u = getDb().users.find((x) => x.emailToken && x.emailToken === token);
    if (!u) return false; u.verified = true; u.emailToken = null; memSave(); return true;
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

  /* ── vendors ────────────────────────────────────────────────────────── */
  async createVendor(v) {
    if (usingPg) {
      const r = await query(
        `INSERT INTO vendors (owner_user_id,name,cat,offering,price,starting_price,city,region,country,distance,rating,reviews,premium,sponsored,verified,plan,licensed,equipment_hire,full_service,years,languages,cuisines,services,photos,about,pitch,business_address,business_phone,hue,max_photos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING *`,
        [v.ownerUserId ?? null, v.name || "", v.cat || "mgmt", v.offering || "", v.price ?? 2, v.startingPrice ?? 0,
         v.city || "", v.region || "", v.country || "US", v.distance ?? 0, v.rating ?? 0, v.reviews ?? 0,
         !!v.premium, !!v.sponsored, !!v.verified, v.plan || "free", !!v.licensed, !!v.equipmentHire,
         v.fullService === undefined ? true : !!v.fullService, v.years ?? 0, J(v.languages || ["English"]),
         J(v.cuisines ?? null), J(v.services || {}), J(v.photos || []), v.about || "", v.pitch || "",
         v.businessAddress || "", v.businessPhone || "", v.hue ?? 200, v.maxPhotos ?? 3]);
      return toVendor(r.rows[0]);
    }
    const db = getDb();
    const vendor = { id: nextId("vendor"), ownerUserId: v.ownerUserId ?? null, name: v.name || "",
      cat: v.cat || "mgmt", offering: v.offering || "", price: v.price ?? 2, startingPrice: v.startingPrice ?? 0,
      city: v.city || "", region: v.region || "", country: v.country || "US", distance: v.distance ?? 0,
      rating: v.rating ?? 0, reviews: v.reviews ?? 0, premium: !!v.premium, sponsored: !!v.sponsored,
      verified: !!v.verified, suspended: false, plan: v.plan || "free", licensed: !!v.licensed,
      equipmentHire: !!v.equipmentHire, fullService: v.fullService === undefined ? true : !!v.fullService,
      years: v.years ?? 0, languages: v.languages || ["English"], cuisines: v.cuisines ?? null,
      services: v.services || {}, photos: v.photos || [], blockedDates: [], about: v.about || "",
      pitch: v.pitch || "", businessAddress: v.businessAddress || "", businessPhone: v.businessPhone || "",
      hue: v.hue ?? 200, maxPhotos: v.maxPhotos ?? 3, createdAt: new Date().toISOString() };
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
    if (usingPg) return (await query("SELECT * FROM vendors WHERE suspended=FALSE")).rows.map(toVendor);
    return getDb().vendors.filter((v) => v.id && !v.suspended);
  },

  // patch contains only the keys to change; cuisines:null clears cuisines.
  async updateVendorByOwner(userId, patch, ownerDefaults = {}) {
    let listing = await this.findVendorByOwner(userId);
    if (!listing) listing = await this.createVendor({ ownerUserId: userId, ...ownerDefaults });
    const merged = { ...listing, ...patch };
    if (usingPg) {
      const r = await query(
        `UPDATE vendors SET name=$2, about=$3, services=$4, cuisines=$5, languages=$6, blocked_dates=$7,
           licensed=$8, plan=$9, sponsored=$10, max_photos=$11, photos=$12 WHERE id=$1 RETURNING *`,
        [listing.id, merged.name || "", merged.about || "", J(merged.services || {}), J(merged.cuisines ?? null),
         J(merged.languages || []), J(merged.blockedDates || []), !!merged.licensed, merged.plan || "free",
         !!merged.sponsored, merged.maxPhotos ?? 3, J(merged.photos || [])]);
      return toVendor(r.rows[0]);
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
};
