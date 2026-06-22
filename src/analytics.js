/**
 * analytics.js — lightweight platform analytics endpoints.
 *
 * Routes mounted:
 *   POST /api/analytics/event-type   public, rate-limited — log an event type selection
 *   GET  /api/admin/analytics/event-types  admin-only — view the aggregated data
 */

export function mountAnalytics(app, { rateLimit, query, usingPg, admin }) {
  // ── POST /api/analytics/event-type ─────────────────────────────────────
  // Called every time a user chooses their event type on the landing page.
  // No auth required — fire-and-forget from the frontend.
  app.post(
    "/api/analytics/event-type",
    rateLimit({ windowMs: 60 * 1000, max: 30 }),
    async (req, res) => {
      try {
        const { eventType, isCustom, country } = req.body || {};
        if (!eventType || typeof eventType !== "string") {
          return res.status(400).json({ error: "eventType required" });
        }
        const safe = eventType.trim().slice(0, 200);
        if (!safe) return res.status(400).json({ error: "eventType is empty" });

        if (usingPg) {
          await query(
            `INSERT INTO event_type_analytics (event_type, is_custom, country)
             VALUES ($1, $2, $3)`,
            [safe, !!isCustom, country || null]
          );
        }
        // In-memory (demo mode): silently ignore — no persistent store needed
        res.json({ ok: true });
      } catch (err) {
        console.error("[analytics] event-type:", err.message);
        res.status(500).json({ error: "Could not record event type" });
      }
    }
  );

  // ── GET /api/admin/analytics/event-types ───────────────────────────────
  // Admin-only view: top requested event types, custom entries highlighted.
  app.get("/api/admin/analytics/event-types", admin, async (req, res) => {
    try {
      if (usingPg) {
        const r = await query(
          `SELECT event_type, is_custom,
                  COUNT(*)::int                                           AS total,
                  COUNT(*) FILTER (WHERE country = 'United States')::int AS us_count,
                  COUNT(*) FILTER (WHERE country = 'Canada')::int        AS ca_count,
                  MAX(created_at)                                         AS last_seen
           FROM event_type_analytics
           WHERE created_at >= now() - INTERVAL '90 days'
           GROUP BY event_type, is_custom
           ORDER BY total DESC
           LIMIT 100`
        );
        return res.json(r.rows);
      }
      res.json([]);
    } catch (err) {
      console.error("[analytics] admin event-types:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
