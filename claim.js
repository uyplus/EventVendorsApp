// claim.js — Claim-Your-Profile endpoints
//
// ROUTES
//   GET  /api/claim/verify/:token    frontend polls this to get vendor preview before account creation
//   POST /api/claim/request          vendor enters email → receive claim link
//   POST /api/claim/complete         vendor clicks link → create account → take ownership
//
// USAGE in server.js:
//   import { mountClaim } from "./claim.js";
//   mountClaim(app, { repo, email: emailModule, generateToken });
//   ↑ add this just after mountMedia(...)

import { randomUUID } from "crypto";

export function mountClaim(app, { repo, email: emailSvc, generateToken }) {
  const BASE_URL = process.env.BASE_URL || "https://eventvendors.us";

  // ── GET /api/claim/verify/:token ─────────────────────────────────────────
  // Returns the pre-populated vendor profile so the frontend can show a
  // "Here's your listing — create an account to take control" preview.
  app.get("/api/claim/verify/:token", async (req, res) => {
    try {
      const vendor = await repo.findVendorByClaimToken(req.params.token);
      if (!vendor)
        return res.status(404).json({ error: "Invalid or expired claim link." });
      if (vendor.claimed)
        return res.status(400).json({ error: "This listing has already been claimed." });
      if (vendor.claimTokenExpires && new Date() > new Date(vendor.claimTokenExpires))
        return res.status(410).json({ error: "This link has expired. Request a new one from the listing page." });

      res.json({ vendor });
    } catch (e) {
      console.error("[claim] verify error:", e.message);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── POST /api/claim/request ───────────────────────────────────────────────
  // Body: { vendorId, email }
  // Generates a 48-hour claim token and emails it to the vendor.
  app.post("/api/claim/request", async (req, res) => {
    const { vendorId, email } = req.body || {};
    if (!vendorId || !email)
      return res.status(400).json({ error: "Vendor ID and email are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Please enter a valid email address." });

    try {
      const vendor = await repo.findVendorById(Number(vendorId));
      if (!vendor)
        return res.status(404).json({ error: "Vendor not found." });
      if (vendor.claimed)
        return res.status(400).json({ error: "This listing is already claimed." });

      const token = randomUUID();
      const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      await repo.setClaimToken(Number(vendorId), token, expires);

      await emailSvc.sendClaimEmail({
        to: email,
        vendorName: vendor.name,
        token,
        baseUrl: BASE_URL,
      });

      res.json({ ok: true, message: "Claim link sent — check your inbox." });
    } catch (e) {
      console.error("[claim] request error:", e.message);
      res.status(500).json({ error: "Could not send claim email. Please try again." });
    }
  });

  // ── POST /api/claim/complete ──────────────────────────────────────────────
  // Body: { token, email, password, firstName, lastName }
  // Creates the user account, transfers vendor ownership, returns a JWT.
  app.post("/api/claim/complete", async (req, res) => {
    const { token, email, password, firstName = "", lastName = "" } = req.body || {};
    if (!token || !email || !password)
      return res.status(400).json({ error: "Token, email and password are required." });
    if (password.length < 8)
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Please enter a valid email address." });

    try {
      const vendor = await repo.findVendorByClaimToken(token);
      if (!vendor)
        return res.status(404).json({ error: "Invalid claim token." });
      if (vendor.claimed)
        return res.status(400).json({ error: "This listing has already been claimed." });
      if (vendor.claimTokenExpires && new Date() > new Date(vendor.claimTokenExpires))
        return res.status(410).json({ error: "This claim link has expired. Please request a new one." });

      // Check if account already exists
      const existing = await repo.findUserByEmail(email);
      if (existing)
        return res.status(409).json({ error: "An account with this email already exists. Log in and link your listing from your dashboard." });

      // Hash password (reuse existing util in server.js scope)
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(password, 10);

      // Create the user account (verified immediately — they clicked an email link)
      const user = await repo.createUser({
        role: "vendor",
        email,
        passwordHash,
        verified: true,
        firstName,
        lastName,
      });

      // Transfer vendor ownership
      await repo.claimVendor(vendor.id, user.id, token);

      const jwt = generateToken({ id: user.id, role: "vendor", email });

      res.status(201).json({
        ok: true,
        token: jwt,
        user: { id: user.id, email, role: "vendor", firstName, lastName },
        vendorId: vendor.id,
      });
    } catch (e) {
      console.error("[claim] complete error:", e.message);
      res.status(500).json({ error: "Could not complete claim. Please try again." });
    }
  });
}
