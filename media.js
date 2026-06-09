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

import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB hard cap
});

// allow common image + video formats only
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/;

export function mountMedia(app, { auth, requireVendor }) {
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

      const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `vendor-${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage.from(bucket).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });
      if (error) throw error;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      res.status(201).json({ url: data.publicUrl, type: req.file.mimetype.startsWith("video/") ? "video" : "image" });
    } catch (e) {
      console.error("[media] upload failed:", e.message);
      res.status(500).json({ error: "Upload failed." });
    }
  });
}
