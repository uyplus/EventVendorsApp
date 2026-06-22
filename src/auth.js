import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);
export const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: "7d" });

export const initials = (first = "", last = "") =>
  ((first[0] || "") + (last[0] || first[1] || "")).toUpperCase();

// Returns the public-safe user object the frontend expects.
export const publicUser = (u) => ({
  id: u.id, role: u.role, firstName: u.firstName, lastName: u.lastName,
  email: u.email, initials: initials(u.firstName, u.lastName), services: u.services || {},
  verified: !!u.verified, suspended: !!u.suspended,
  phone: u.phone || "", address1: u.address1 || "", address2: u.address2 || "",
  city: u.city || "", state: u.state || "", postal: u.postal || "", country: u.country || "",
  businessName: u.businessName || "", businessAddress: u.businessAddress || "", businessPhone: u.businessPhone || "",
  prefs: u.prefs || { emailQuotes: true, emailMessages: true, marketing: false },
});

// Express middleware — async because the user is now loaded from the database.
export function requireAuth(repo) {
  return async (req, res, next) => {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    try {
      const payload = jwt.verify(token, SECRET);
      const user = await repo.findUserById(payload.id);
      if (!user) return res.status(401).json({ error: "Account not found" });
      if (user.suspended) return res.status(403).json({ error: "This account has been suspended." });
      req.user = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

export function requireVendor(req, res, next) {
  if (req.user?.role !== "vendor") return res.status(403).json({ error: "Vendor account required" });
  next();
}

// Admin gate: a valid X-Admin-Key header, or a logged-in user whose role is "admin".
export function requireAdmin(repo) {
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return async (req, res, next) => {
    const key = req.headers["x-admin-key"];
    if (process.env.ADMIN_KEY && key && key === process.env.ADMIN_KEY) return next();
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) {
      try {
        const payload = jwt.verify(token, SECRET);
        const u = await repo.findUserById(payload.id);
        const email = (u?.email || "").toLowerCase();
        if (u && ADMIN_EMAILS.length && ADMIN_EMAILS.includes(email)) { req.user = u; return next(); }
      } catch (e) { /* fall through */ }
    }
    return res.status(403).json({ error: "Admin access required." });
  };
}
