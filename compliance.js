/**
 * compliance.js — vendor licence and insurance document uploads.
 * Uses the same vendor-media bucket as photos (simpler, single bucket setup).
 */

import { createClient } from "@supabase/supabase-js";
import multer from "multer";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return createClient(url, key);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function mountCompliance(app, { auth, requireVendor, repo, sendEmail }) {
  const h = (fn) => (req, res) => fn(req, res).catch(err => {
    console.error("[compliance]", err.message);
    res.status(500).json({ error: err.message });
  });

  // ── POST /api/vendor/licence ─────────────────────────────────────────────
  app.post("/api/vendor/licence", auth, requireVendor, upload.single("file"), h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const sb = supabase();
    const bucket = process.env.SUPABASE_BUCKET || "vendor-media";
    const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `licences/vendor_${req.user.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from(bucket).upload(path, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true,
    });
    if (upErr) throw upErr;

    const { data: urlData } = sb.storage.from(bucket).getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    const expiry = req.body.expiry || null;

    await repo.updateVendorByOwner(req.user.id, {
      licenceFile: publicUrl,
      licenceExpiry: expiry,
    }).catch(() => {});

    for (const email of ADMIN_EMAILS) {
      await (sendEmail || (() => Promise.resolve()))({
        to: email,
        subject: "New licence submission — Event Vendors",
        html: `<p>User <b>${req.user.email}</b> submitted a licence. <a href="${process.env.APP_URL || "#"}/admin">Review</a></p>`,
      }).catch(() => {});
    }
    res.json({ ok: true, status: "pending", url: publicUrl });
  }));

  // ── POST /api/vendor/insurance ────────────────────────────────────────────
  app.post("/api/vendor/insurance", auth, requireVendor, upload.single("file"), h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const sb = supabase();
    const bucket = process.env.SUPABASE_BUCKET || "vendor-media";
    const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `insurance/vendor_${req.user.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from(bucket).upload(path, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true,
    });
    if (upErr) throw upErr;

    const { data: urlData } = sb.storage.from(bucket).getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    await repo.updateVendorByOwner(req.user.id, { insuranceFile: publicUrl }).catch(() => {});
    res.json({ ok: true, url: publicUrl });
  }));
}
