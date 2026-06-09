// Transactional email. Uses Resend when configured; otherwise logs to the console
// so flows are testable in dev without a provider.
//
// SETUP:
//   1) npm install resend
//   2) Create a Resend account, verify your sending domain, get an API key.
//   3) Set env:  RESEND_API_KEY=...   EMAIL_FROM="Event Vendors <no-reply@yourdomain.com>"
//
// All functions are no-throw: email failure never breaks the request that triggered it.

let resend = null;
async function client() {
  if (resend) return resend;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = await import("resend");
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = () => process.env.EMAIL_FROM || "Event Vendors <onboarding@resend.dev>";

async function send({ to, subject, html }) {
  try {
    const c = await client();
    if (!c) { console.log(`[email:dev] To:${to} | ${subject}\n${html}\n`); return { ok: true, dev: true }; }
    await c.emails.send({ from: FROM(), to, subject, html });
    return { ok: true };
  } catch (e) {
    console.error("[email] send failed:", e.message);
    return { ok: false };
  }
}

const shell = (title, body) => `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1E1A2B">
    <h2 style="color:#3B2C4F">${title}</h2>
    ${body}
    <p style="font-size:12px;color:#8a8594;margin-top:28px">Event Vendors — your vision, our expertise.</p>
  </div>`;

export function sendVerifyEmail(to, link) {
  return send({
    to, subject: "Verify your Event Vendors account",
    html: shell("Confirm your email", `
      <p>Welcome! Please confirm your email to activate your account.</p>
      <p><a href="${link}" style="background:#E26D4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Verify email</a></p>
      <p style="font-size:12px;color:#8a8594">Or paste this link: ${link}</p>`),
  });
}

export function sendResetEmail(to, link) {
  return send({
    to, subject: "Reset your Event Vendors password",
    html: shell("Password reset", `
      <p>We received a request to reset your password. This link expires in 30 minutes.</p>
      <p><a href="${link}" style="background:#3B2C4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Reset password</a></p>
      <p style="font-size:12px;color:#8a8594">If you didn't request this, you can ignore this email.</p>`),
  });
}

// Contact form → routed to the team inbox. `replyTo` lets us reply straight to the sender.
export function sendContactEmail({ name, email, subject, body }) {
  const to = process.env.CONTACT_TO || "eventvendors.ca@gmail.com";
  return send({
    to, subject: `[Contact] ${subject || "(no subject)"}`,
    html: shell("New contact message", `
      <p><b>From:</b> ${name || "(not given)"} &lt;${email || "no email"}&gt;</p>
      <p><b>Subject:</b> ${subject || "(none)"}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:14px 0" />
      <p style="white-space:pre-wrap">${(body || "").replace(/</g, "&lt;")}</p>`),
  });
}

// Warm welcome when a vendor upgrades to Sponsored.
export function sendSubscriptionThankYou(to, name) {
  return send({
    to, subject: "🎉 Welcome to Sponsored — thank you!",
    html: shell(`Thank you${name ? ", " + name : ""}!`, `
      <p>Your Event Vendors listing is now <b>Sponsored</b> — thank you for backing your business with us.</p>
      <p>Here's what's now switched on:</p>
      <ul style="color:#1E1A2B;line-height:1.7">
        <li>Priority placement at the top of search</li>
        <li>The gold <b>Sponsored</b> badge on your listing</li>
        <li>A feature slot on the home page</li>
        <li>Up to 20 photos &amp; unlimited services across all categories</li>
        <li>A bookable availability calendar and performance analytics</li>
      </ul>
      <p>We're rooting for you — here's to more bookings and unforgettable events.</p>
      <p style="font-size:12px;color:#8a8594">Manage your subscription any time from your vendor dashboard.</p>`),
  });
}

export function sendNotificationEmail(to, text) {
  return send({ to, subject: "New activity on Event Vendors", html: shell("You have a new notification", `<p>${text}</p>`) });
}
