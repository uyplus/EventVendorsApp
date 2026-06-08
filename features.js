// All new marketplace endpoints in one mountable module.
// Reviews · Bookings · Notifications · Messaging · Password reset.
// Postgres-backed (via db.js); requires schema_v2.sql to have been applied.
//
// ── server.js integration (add ONE block, after `auth`/`requireVendor`/`repo`
//    and the existing routes, before the boot/app.listen) ──
//     import { mountFeatures } from "./features.js";
//     mountFeatures(app, { auth, requireVendor, repo });
//
// (Also mount media + payments there if using them:
//     import { mountMedia } from "./media.js";        mountMedia(app, { auth, requireVendor });
//     import { mountPayments } from "./payments.js";  await mountPayments(app, { auth, requireVendor });
//  — and remove the old stub /api/billing/* and /api/payments/checkout routes.)

import crypto from "crypto";
import { query, usingPg } from "./db.js";
import { hashPassword } from "./auth.js";
import * as email from "./email.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const fullName = (u) => `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Customer";
const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => { console.error("[features]", e.message); res.status(500).json({ error: "Server error." }); });

async function notify(userId, text) {
  if (!userId || !usingPg) return;
  await query("INSERT INTO notifications (user_id, body) VALUES ($1,$2)", [userId, text]);
}

export function mountFeatures(app, { auth, requireVendor, repo }) {
  if (!usingPg) console.warn("[features] running without Postgres — new endpoints return empty/no-op until DATABASE_URL is set.");

  /* reviews */
  app.get("/api/vendors/:id/reviews", wrap(async (req, res) => {
    if (!usingPg) return res.json([]);
    const rows = (await query("SELECT * FROM reviews WHERE vendor_id=$1 ORDER BY created_at DESC", [req.params.id])).rows;
    res.json(rows.map((r) => ({ id: Number(r.id), author: r.author, rating: r.rating, text: r.body, date: timeAgo(r.created_at) })));
  }));
  app.post("/api/vendors/:id/reviews", auth, wrap(async (req, res) => {
    const { rating, text, author } = req.body || {};
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be 1-5." });
    if (!usingPg) return res.status(201).json({ ok: true });
    const vId = req.params.id;
    await query("INSERT INTO reviews (vendor_id,author_user_id,author,rating,body) VALUES ($1,$2,$3,$4,$5)",
      [vId, req.user.id, author || fullName(req.user), Math.round(rating), String(text || "").slice(0, 1000)]);
    await query(`UPDATE vendors SET rating=COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM reviews WHERE vendor_id=$1),0), reviews=(SELECT COUNT(*) FROM reviews WHERE vendor_id=$1) WHERE id=$1`, [vId]);
    const v = (await query("SELECT owner_user_id FROM vendors WHERE id=$1", [vId])).rows[0];
    if (v) await notify(Number(v.owner_user_id), `New ${Math.round(rating)} star review on your listing.`);
    res.status(201).json({ ok: true });
  }));

  /* bookings */
  app.post("/api/bookings", auth, wrap(async (req, res) => {
    const { vendorId, date, guests, amount } = req.body || {};
    if (!vendorId) return res.status(400).json({ error: "vendorId is required." });
    if (!usingPg) return res.status(201).json({ ok: true });
    const v = (await query("SELECT owner_user_id, name FROM vendors WHERE id=$1", [vendorId])).rows[0];
    if (!v) return res.status(404).json({ error: "Vendor not found." });
    const r = await query("INSERT INTO bookings (vendor_id,customer_user_id,customer_name,event_date,guests,amount,status) VALUES ($1,$2,$3,$4,$5,$6,'confirmed') RETURNING id",
      [vendorId, req.user.id, fullName(req.user), date || "", guests || null, Math.round(amount || 0)]);
    await notify(Number(v.owner_user_id), `New booking${date ? ` for ${date}` : ""}${guests ? ` - ${guests} guests` : ""}.`);
    res.status(201).json({ ok: true, id: Number(r.rows[0].id) });
  }));
  app.get("/api/vendor/bookings", auth, requireVendor, wrap(async (req, res) => {
    if (!usingPg) return res.json([]);
    const rows = (await query("SELECT b.* FROM bookings b JOIN vendors v ON v.id=b.vendor_id WHERE v.owner_user_id=$1 ORDER BY b.created_at DESC", [req.user.id])).rows;
    res.json(rows.map((b) => ({ id: Number(b.id), customerName: b.customer_name, date: b.event_date, guests: b.guests, amount: b.amount, status: b.status })));
  }));

  /* notifications */
  app.get("/api/notifications", auth, wrap(async (req, res) => {
    if (!usingPg) return res.json([]);
    const rows = (await query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.user.id])).rows;
    res.json(rows.map((n) => ({ id: Number(n.id), text: n.body, read: n.read, time: timeAgo(n.created_at) })));
  }));
  app.post("/api/notifications/read", auth, wrap(async (req, res) => {
    if (usingPg) await query("UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE", [req.user.id]);
    res.json({ ok: true });
  }));

  /* messaging */
  const role = (u) => (u.role === "vendor" ? "vendor" : "customer");
  app.get("/api/threads", auth, wrap(async (req, res) => {
    if (!usingPg) return res.json([]);
    const r = role(req.user);
    const col = r === "vendor" ? "v.owner_user_id" : "t.customer_user_id";
    const threads = (await query(`SELECT t.*, v.name AS vendor_name FROM threads t JOIN vendors v ON v.id=t.vendor_id WHERE ${col}=$1 ORDER BY t.updated_at DESC`, [req.user.id])).rows;
    const out = [];
    for (const t of threads) {
      const msgs = (await query("SELECT * FROM messages WHERE thread_id=$1 ORDER BY created_at", [t.id])).rows;
      out.push({ id: Number(t.id), vendorId: Number(t.vendor_id), vendorName: t.vendor_name, subject: t.subject,
        unread: r === "vendor" ? t.vendor_unread : t.customer_unread,
        messages: msgs.map((m) => ({ from: m.sender === r ? "me" : (r === "vendor" ? "customer" : "vendor"), text: m.body, time: timeAgo(m.created_at) })) });
    }
    res.json(out);
  }));
  app.post("/api/messages", auth, wrap(async (req, res) => {
    const { vendorId, subject, body } = req.body || {};
    if (!vendorId || !body) return res.status(400).json({ error: "vendorId and body are required." });
    if (!usingPg) return res.status(201).json({ ok: true });
    let t = (await query("SELECT id FROM threads WHERE customer_user_id=$1 AND vendor_id=$2 LIMIT 1", [req.user.id, vendorId])).rows[0];
    const threadId = t ? Number(t.id) : Number((await query("INSERT INTO threads (customer_user_id,vendor_id,subject) VALUES ($1,$2,$3) RETURNING id", [req.user.id, vendorId, subject || "Enquiry"])).rows[0].id);
    await query("INSERT INTO messages (thread_id,sender,body) VALUES ($1,'customer',$2)", [threadId, body]);
    await query("UPDATE threads SET vendor_unread=TRUE, updated_at=now() WHERE id=$1", [threadId]);
    const v = (await query("SELECT owner_user_id FROM vendors WHERE id=$1", [vendorId])).rows[0];
    if (v) await notify(Number(v.owner_user_id), "New message from a customer.");
    res.status(201).json({ ok: true, threadId });
  }));
  app.post("/api/threads/:id/reply", auth, wrap(async (req, res) => {
    if (!usingPg) return res.json({ ok: true });
    const r = role(req.user);
    await query("INSERT INTO messages (thread_id,sender,body) VALUES ($1,$2,$3)", [req.params.id, r, String(req.body?.text || "")]);
    const other = r === "vendor" ? "customer_unread" : "vendor_unread";
    await query(`UPDATE threads SET ${other}=TRUE, updated_at=now() WHERE id=$1`, [req.params.id]);
    const row = (await query("SELECT t.customer_user_id, v.owner_user_id FROM threads t JOIN vendors v ON v.id=t.vendor_id WHERE t.id=$1", [req.params.id])).rows[0];
    if (row) await notify(Number(r === "vendor" ? row.customer_user_id : row.owner_user_id), "New reply to your conversation.");
    res.json({ ok: true });
  }));
  app.post("/api/threads/:id/read", auth, wrap(async (req, res) => {
    if (usingPg) { const col = role(req.user) === "vendor" ? "vendor_unread" : "customer_unread"; await query(`UPDATE threads SET ${col}=FALSE WHERE id=$1`, [req.params.id]); }
    res.json({ ok: true });
  }));

  /* password reset */
  const forgotHits = new Map();
  app.post("/api/auth/forgot", wrap(async (req, res) => {
    const ip = req.ip || "x", now = Date.now();
    const arr = (forgotHits.get(ip) || []).filter((t) => now - t < 3600000);
    if (arr.length >= 5) return res.json({ ok: true });
    arr.push(now); forgotHits.set(ip, arr);
    const addr = String(req.body?.email || "").trim().toLowerCase();
    const user = await repo.findUserByEmail(addr);
    if (user && usingPg) {
      const token = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await query("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,$3)", [user.id, sha256(token), expires]);
      const link = `${process.env.APP_URL || ""}/reset?token=${token}`;
      if (email.sendResetEmail) await email.sendResetEmail(addr, link);
    }
    res.json({ ok: true });
  }));
  app.post("/api/auth/reset", wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 8) return res.status(400).json({ error: "Invalid token, or password too short." });
    if (!usingPg) return res.json({ ok: true });
    const rec = (await query("SELECT id, user_id FROM password_reset_tokens WHERE token_hash=$1 AND used=FALSE AND expires_at > now()", [sha256(token)])).rows[0];
    if (!rec) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    await repo.setPassword(Number(rec.user_id), hashPassword(password));
    await query("UPDATE password_reset_tokens SET used=TRUE WHERE id=$1", [rec.id]);
    res.json({ ok: true });
  }));

  console.log("[features] reviews, bookings, notifications, messaging & password-reset routes mounted.");
}
