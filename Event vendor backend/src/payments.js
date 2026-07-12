// Real payments with Stripe Checkout. Mounted only when STRIPE_SECRET_KEY is set,
// so the app still runs (in demo-payment mode) without it.
//
// SETUP:
//   1) npm install stripe
//   2) In Stripe: create a recurring Price for the Sponsored plan ($29/mo) -> STRIPE_PRICE_SPONSORED
//   3) Set env:
//        STRIPE_SECRET_KEY=sk_live_or_test_...
//        STRIPE_PRICE_SPONSORED=price_...
//        STRIPE_WEBHOOK_SECRET=whsec_...
//        APP_URL=https://yourapp.com           (for success/cancel redirects)
//   4) In server.js:
//        import { mountPayments } from "./payments.js";
//        mountPayments(app, { auth, requireVendor });
//      and REMOVE the old stub /api/billing/* and /api/payments/checkout routes.
//   5) Add a Stripe webhook endpoint in the dashboard pointing to /api/billing/webhook.
//
// NOTE: the webhook route needs the RAW body, so it is registered with express.raw()
// and must be added BEFORE any global express.json() — mountPayments handles ordering
// by registering the webhook with its own parser.

export async function mountPayments(app, { auth, requireVendor }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.warn("[payments] Stripe disabled — set STRIPE_SECRET_KEY to enable real charges."); return; }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(key);
  const express = (await import("express")).default;
  const APP = process.env.APP_URL || "http://localhost:5173";

  // Subscription checkout (vendor → Sponsored plan)
  app.post("/api/billing/checkout", auth, requireVendor, async (req, res) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: process.env.STRIPE_PRICE_SPONSORED, quantity: 1 }],
        success_url: `${APP}/dash?upgrade=success`,
        cancel_url: `${APP}/dash?upgrade=cancel`,
        client_reference_id: String(req.user.id),
        metadata: { userId: String(req.user.id), kind: "subscription" },
      });
      res.json({ url: session.url });
    } catch (e) { console.error("[payments]", e.message); res.status(500).json({ error: "Checkout failed." }); }
  });

  // One-off booking deposit (customer → vendor)
  app.post("/api/payments/checkout", auth, async (req, res) => {
    try {
      const { vendorId, date, guests, amount } = req.body || {};
      const cents = Math.max(50, Math.round(Number(amount || 0) * 100));
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          quantity: 1,
          price_data: { currency: "usd", unit_amount: cents,
            product_data: { name: `Booking deposit${date ? ` — ${date}` : ""}` } },
        }],
        success_url: `${APP}/?booking=success`,
        cancel_url: `${APP}/?booking=cancel`,
        client_reference_id: String(req.user.id),
        metadata: { userId: String(req.user.id), vendorId: String(vendorId || ""), date: String(date || ""), guests: String(guests || ""), kind: "booking" },
      });
      res.json({ url: session.url });
    } catch (e) { console.error("[payments]", e.message); res.status(500).json({ error: "Checkout failed." }); }
  });

  // Webhook — needs the raw body, so its own parser is attached here.
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) { return res.status(400).send(`Webhook error: ${e.message}`); }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const meta = s.metadata || {};
      try {
        const { repo } = await import("./repo.js");
        if (meta.kind === "subscription" && meta.userId) {
          await repo.setPlanByOwner(Number(meta.userId), "sponsored");
        }
        if (meta.kind === "booking" && meta.vendorId) {
          const vendor = await repo.findVendorById(Number(meta.vendorId));
          await repo.createBooking({
            vendorId: Number(meta.vendorId), customerUserId: Number(meta.userId) || null,
            date: meta.date || "", guests: meta.guests ? Number(meta.guests) : null,
            amount: Math.round((s.amount_total || 0) / 100), status: "confirmed",
          });
          if (vendor && vendor.ownerUserId) await repo.createNotification(vendor.ownerUserId, `New paid booking${meta.date ? ` for ${meta.date}` : ""}.`);
        }
      } catch (e) { console.error("[payments] webhook handling failed:", e.message); }
    }
    res.json({ received: true });
  });

  console.log("[payments] Stripe enabled.");
}
