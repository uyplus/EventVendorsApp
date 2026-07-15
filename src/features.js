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

  /* bookings — handled canonically by server.js (pending/accept/decline flow,
     v265+). The old auto-confirm duplicates that lived here were removed so
     there is exactly one source of truth and no route-order dependence. */

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

  /* messaging — handled canonically by server.js (threads/thread_messages
     schema, v261+). The duplicates that lived here queried the OLD schema
     (messages table, customer_user_id, vendor_unread columns) which the new
     message flow never writes to — if these routes ever won the route race,
     the inbox showed empty even though threads existed. Removed entirely. */

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
