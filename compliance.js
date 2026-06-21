/**
 * compliance.js — private document storage, licence verification workflow,
 * and audit-trail endpoints.
 *
 * Routes mounted:
 *   POST   /api/vendor/licence          upload licence file (vendor auth)
 *   POST   /api/vendor/insurance        upload insurance cert (vendor auth)
 *   GET    /api/admin/pending-licences  list vendors awaiting review (admin auth)
 *   POST   /api/admin/verify-licence    approve or reject a licence (admin auth)
 *   GET    /api/admin/licence-file/:id  get a signed URL to view the doc (admin auth)
 */

import { createClient } from "@supabase/supabase-js";
import multer from "multer";

const LICENCE_BUCKET   = process.env.SUPABASE_LICENCE_BUCKET   || "vendor-licences";
const INSURANCE_BUCKET = process.env.SUPABASE_INSURANCE_BUCKET || "vendor-insurance";
const ADMIN_EMAILS     = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return createClient(url, key);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── helpers ──────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const email = (req.user?.email || "").toLowerCase();
  if (!ADMIN_EMAILS.length) return res.status(403).json({ error: "No admin emails configured. Set ADMIN_EMAILS env var." });
  if (!ADMIN_EMAILS.includes(email)) return res.status(403).json({ error: "Admin access required." });
  next();
}

async function uploadPrivateFile(bucket, buffer, mimeType, path) {
  const sb = supabase();
  const { error } = await sb.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

async function getSignedUrl(bucket, path, expiresIn = 3600) {
  const sb = supabase();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

// ── route factory ─────────────────────────────────────────────────────────────

export function mountCompliance(app, { auth, requireVendor, repo, sendEmail, sendLicenceVerifiedEmail, sendLicenceRejectedEmail }) {
  const h = (fn) => (req, res) => fn(req, res).catch(err => {
    console.error("[compliance]", err.message);
    res.status(500).json({ error: err.message });
  });

  // ── POST /api/vendor/licence ─────────────────────────────────────────────
  app.post("/api/vendor/licence", auth, requireVendor, upload.single("file"), h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const { originalname, buffer, mimetype } = req.file;
    const ext = originalname.split(".").pop()?.toLowerCase() || "bin";
    const path = `vendor_${req.user.vendorId}_licence_${Date.now()}.${ext}`;

    await uploadPrivateFile(LICENCE_BUCKET, buffer, mimetype, path);

    const expiry = req.body.expiry || null;
    await repo.updateVendorCompliance(req.user.vendorId, {
      licence_path:    path,
      licence_status:  "pending",
      licence_expires: expiry,
    });

    // Notify admin(s)
    for (const email of ADMIN_EMAILS) {
      await sendEmail({
        to: email,
        subject: "New licence submission — Event Vendors",
        html: `<p>Vendor ID <b>${req.user.vendorId}</b> has submitted a licence document for review.</p>
               <p>Log in to the admin panel to review: <a href="${process.env.APP_URL}/admin">Admin Panel</a></p>`,
      }).catch(() => {});
    }

    res.json({ ok: true, status: "pending" });
  }));

  // ── POST /api/vendor/insurance ────────────────────────────────────────────
  app.post("/api/vendor/insurance", auth, requireVendor, upload.single("file"), h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const { originalname, buffer, mimetype } = req.file;
    const ext = originalname.split(".").pop()?.toLowerCase() || "bin";
    const path = `vendor_${req.user.vendorId}_insurance_${Date.now()}.${ext}`;

    await uploadPrivateFile(INSURANCE_BUCKET, buffer, mimetype, path);
    await repo.updateVendorCompliance(req.user.vendorId, {
      insurance_path:   path,
      insurance_status: "pending",
    });

    res.json({ ok: true, status: "pending" });
  }));

  // ── GET /api/admin/pending-licences ───────────────────────────────────────
  app.get("/api/admin/pending-licences", auth, requireAdmin, h(async (req, res) => {
    const rows = await repo.getVendorsByLicenceStatus("pending");
    res.json(rows);
  }));

  // ── POST /api/admin/verify-licence ────────────────────────────────────────
  app.post("/api/admin/verify-licence", auth, requireAdmin, h(async (req, res) => {
    const { vendorId, decision, reason } = req.body || {};
    if (!vendorId) return res.status(400).json({ error: "vendorId required." });
    if (!["verified", "rejected"].includes(decision)) return res.status(400).json({ error: 'decision must be "verified" or "rejected".' });

    await repo.updateVendorCompliance(vendorId, { licence_status: decision });

    // Audit log
    await repo.logAdminAction({
      adminEmail:  req.user.email,
      action:      `${decision}_licence`,
      targetType:  "vendor",
      targetId:    vendorId,
      reason:      reason || null,
    });

    // Email the vendor — the dedicated templates explain what happened and
    // (for rejections) what to fix, rather than a generic notice.
    const vendor = await repo.getVendorById(vendorId);
    if (vendor?.owner_email) {
      const sendFn = decision === "verified" ? sendLicenceVerifiedEmail : sendLicenceRejectedEmail;
      if (sendFn) {
        await sendFn(vendor.owner_email, vendor.name || "there", reason).catch(() => {});
      } else if (sendEmail) {
        // fallback if the dedicated templates weren't wired in for some reason
        const subject = decision === "verified" ? "Your licence has been verified — Event Vendors 🎉" : "Action required: Licence submission needs attention — Event Vendors";
        await sendEmail({ to: vendor.owner_email, subject, html: `<p>Your licence was ${decision}.</p>` }).catch(() => {});
      }
    }

    res.json({ ok: true, decision });
  }));

  // ── GET /api/admin/licence-file/:vendorId ─────────────────────────────────
  app.get("/api/admin/licence-file/:vendorId", auth, requireAdmin, h(async (req, res) => {
    const vendor = await repo.getVendorById(parseInt(req.params.vendorId));
    if (!vendor?.licence_path) return res.status(404).json({ error: "No licence document on file." });
    const url = await getSignedUrl(LICENCE_BUCKET, vendor.licence_path);
    res.json({ url });
  }));

  // ── GET /api/admin/insurance-file/:vendorId ───────────────────────────────
  app.get("/api/admin/insurance-file/:vendorId", auth, requireAdmin, h(async (req, res) => {
    const vendor = await repo.getVendorById(parseInt(req.params.vendorId));
    if (!vendor?.insurance_path) return res.status(404).json({ error: "No insurance document on file." });
    const url = await getSignedUrl(INSURANCE_BUCKET, vendor.insurance_path);
    res.json({ url });
  }));
}
