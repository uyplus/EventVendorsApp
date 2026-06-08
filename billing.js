// Billing — vendor subscriptions (Sponsored) + customer service payments.
//
// This ships in DEMO MODE: with no STRIPE_SECRET_KEY set, the endpoints return
// simulated sessions so the app flows end-to-end. To accept real money, set the
// env vars below and uncomment the Stripe blocks (the shapes already match Stripe).
//
//   STRIPE_SECRET_KEY=sk_live_...          (use sk_test_... in the sandbox first)
//   STRIPE_WEBHOOK_SECRET=whsec_...
//   STRIPE_PRICE_SPONSORED=price_...       (the $29/mo recurring Price ID)
//   APP_URL=https://yourapp.com            (for success/cancel redirects)
//
//   npm install stripe
//   import Stripe from "stripe";
//   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
//
// IMPORTANT: never trust the client to grant "sponsored". The ONLY place a vendor
// becomes sponsored is the webhook below, after Stripe confirms payment.

const LIVE = !!process.env.STRIPE_SECRET_KEY;

export const billingMode = () => (LIVE ? "live" : "demo");

// Vendor → start a Sponsored subscription. Returns a Checkout URL to redirect to.
export async function createSubscriptionCheckout({ user }) {
  if (!LIVE) {
    return { mode: "demo", url: `${process.env.APP_URL || ""}/billing/demo-success?plan=sponsored`, note: "Demo session — no real charge. Set STRIPE_SECRET_KEY to go live." };
  }
  // const session = await stripe.checkout.sessions.create({
  //   mode: "subscription",
  //   line_items: [{ price: process.env.STRIPE_PRICE_SPONSORED, quantity: 1 }],
  //   client_reference_id: String(user.id),
  //   customer_email: user.email,
  //   success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  //   cancel_url: `${process.env.APP_URL}/billing/cancel`,
  // });
  // return { mode: "live", url: session.url };
  throw new Error("Stripe not wired yet — uncomment the block in billing.js");
}

// Customer → pay a deposit / for a service. Returns a Checkout URL (one-time payment).
export async function createPaymentCheckout({ amount, currency = "usd", vendorId, description }) {
  if (!LIVE) {
    return { mode: "demo", url: `${process.env.APP_URL || ""}/pay/demo-success`, amount, note: "Demo session — no real charge." };
  }
  // const session = await stripe.checkout.sessions.create({
  //   mode: "payment",
  //   line_items: [{ price_data: { currency, unit_amount: Math.round(amount * 100), product_data: { name: description || `Booking deposit (vendor ${vendorId})` } }, quantity: 1 }],
  //   success_url: `${process.env.APP_URL}/pay/success`,
  //   cancel_url: `${process.env.APP_URL}/pay/cancel`,
  // });
  // return { mode: "live", url: session.url };
  throw new Error("Stripe not wired yet — uncomment the block in billing.js");
}

// Stripe webhook → the source of truth that flips a vendor to/from Sponsored.
// Mount with express.raw({ type: "application/json" }) so the signature verifies.
export async function handleWebhook({ rawBody, signature, onSubscriptionActive, onSubscriptionCanceled }) {
  if (!LIVE) return { received: true, mode: "demo" };
  // const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  // switch (event.type) {
  //   case "checkout.session.completed":
  //   case "customer.subscription.updated":
  //     await onSubscriptionActive(event.data.object.client_reference_id);
  //     break;
  //   case "customer.subscription.deleted":
  //     await onSubscriptionCanceled(event.data.object.client_reference_id);
  //     break;
  // }
  // return { received: true };
  throw new Error("Stripe not wired yet — uncomment the block in billing.js");
}
