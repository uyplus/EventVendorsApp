/**
 * compliance.js — vendor licence and insurance document uploads.
 * Uses the vendor-media bucket (same as photos).
 */
import multer from "multer";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

const BUCKET = process.env.SUPABASE_BUCKET || "vendor-media";

async function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set in env");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function mountCompliance(app, { auth, requireVendor, repo, sendEmail }) {
  const wrap = (fn) => (req, res) =>
    fn(req, res).catch(err => {
      console.error("[compliance]", err.message);
      res.status(500).json({ error: err.message });
    });

  // POST /api/vendor/licence
  app.post("/api/vendor/licence", auth, requireVendor, upload.single("file"), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const sb = await getSupabase();
    const ext = (req.file.originalname.split(".").pop() || "pdf").toLowerCase();
    const path = `licences/vendor_${req.user.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true,
    });
    if (upErr) throw upErr;

    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
    const expiry = req.body.expiry || null;

    await repo.updateVendorByOwner(req.user.id, {
      licenceFile: urlData.publicUrl,
      licenceExpiry: expiry,
    }).catch(() => {});

    for (const email of ADMIN_EMAILS) {
      await (sendEmail || (() => Promise.resolve()))({
        to: email,
        subject: "New licence — Event Vendors",
        html: `<p>${req.user.email} submitted a licence.</p>`,
      }).catch(() => {});
    }
    res.json({ ok: true, url: urlData.publicUrl });
  }));

  // POST /api/vendor/insurance
  app.post("/api/vendor/insurance", auth, requireVendor, upload.single("file"), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const sb = await getSupabase();
    const ext = (req.file.originalname.split(".").pop() || "pdf").toLowerCase();
    const path = `insurance/vendor_${req.user.id}_${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true,
    });
    if (upErr) throw upErr;

    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
    await repo.updateVendorByOwner(req.user.id, { insuranceFile: urlData.publicUrl }).catch(() => {});
    res.json({ ok: true, url: urlData.publicUrl });
  }));
}
