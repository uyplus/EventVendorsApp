// Vendor photo/video uploads → Supabase Storage.
//
// SETUP (one-time):
//   1) npm install multer @supabase/supabase-js
//   2) In Supabase → Storage → create a bucket named "vendor-media", make it Public.
//   3) Set env vars:
//        SUPABASE_URL=https://<your-ref>.supabase.co
//        SUPABASE_SERVICE_KEY=<service_role key from Project Settings → API Keys>
//        SUPABASE_BUCKET=vendor-media
//   4) In server.js, near the other route setup, add:
//        import { mountMedia } from "./media.js";
//        mountMedia(app, { auth, requireVendor });
//
// The frontend already calls POST /api/vendor/media with a multipart "file" field
// and expects { url, type } back; the returned url is saved on the listing.
//
// File size limits are intentionally type-aware and enforced server-side, not just
// in the browser. The frontend already checks 6 MB (image) / 60 MB (video) before
// upload for instant feedback, but a client check is only a UX nicety — it can be
// bypassed by anyone calling the API directly. Multer's own `limits.fileSize` is a
// single blanket number applied before we even see the mimetype, so we set it to
// the larger of the two (60 MB) as a hard backstop, then re-check per-type
// immediately after multer hands us the file, before it ever reaches Storage.

import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;   // 6 MB — plenty for a phone photo at full quality
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;  // 60 MB — a 30-60s portfolio clip at reasonable quality

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES }, // blanket backstop; real enforcement is per-type below
});

// allow common image + video formats only
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/;
// price lists / menus also allow PDF, since that's the most common format vendors already have
const ALLOWED_DOC = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
const MAX_DOC_BYTES = 6 * 1024 * 1024; // price lists/menus: same 6 MB ceiling as images

export function mountMedia(app, { auth, requireVendor, repo }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || "vendor-media";

  if (!url || !key) {
    console.warn("[media] uploads disabled — set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable.");
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  app.post("/api/vendor/media", auth, requireVendor, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      if (!ALLOWED.test(req.file.mimetype)) return res.status(400).json({ error: "Unsupported file type." });

      const isVideo = req.file.mimetype.startsWith("video/");
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (req.file.size > limit) {
        const limitMb = Math.round(limit / (1024 * 1024));
        return res.status(400).json({ error: `${isVideo ? "Video" : "Image"} is over the ${limitMb} MB limit.` });
      }

      const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `vendor-${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage.from(bucket).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
      if (error) throw error;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      res.status(201).json({ url: data.publicUrl, type: isVideo ? "video" : "image" });
    } catch (e) {
      console.error("[media] upload failed:", e.message);
      res.status(500).json({ error: "Upload failed." });
    }
  });

  // Price list / menu — a single document, shown to customers via a
  // "View price list" / "View menu" button on the listing. Public bucket,
  // since (unlike licence/insurance documents) this is marketing material
  // meant to be seen.
  app.post("/api/vendor/price-list", auth, requireVendor, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      if (!ALLOWED_DOC.test(req.file.mimetype)) return res.status(400).json({ error: "Please upload a PDF or image." });
      if (req.file.size > MAX_DOC_BYTES) {
        return res.status(400).json({ error: `File is over the ${Math.round(MAX_DOC_BYTES / (1024 * 1024))} MB limit.` });
      }

      const ext = (req.file.originalname.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `vendor-${req.user.id}/price-list-${Date.now()}.${ext}`;

      const { error } = await supabase.storage.from(bucket).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
      if (error) throw error;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      if (repo) await repo.updateVendorByOwner(req.user.id, { priceListPath: data.publicUrl }).catch(() => {});
      res.status(201).json({ url: data.publicUrl });
    } catch (e) {
      console.error("[media] price-list upload failed:", e.message);
      res.status(500).json({ error: "Upload failed." });
    }
  });
}
