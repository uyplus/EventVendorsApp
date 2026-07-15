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

export function sendWelcomeEmail(to, firstName, role) {
  const name = firstName || "there";
  const body = role === "vendor"
    ? `<p>Dear ${name},</p>
       <p>Thank you for registering your business with Event Vendors. We are delighted to welcome you to our growing community of trusted event professionals, and we look forward to supporting you as you connect with customers planning their next event.</p>
       <p>To get the most out of your listing, we would recommend the following:</p>
       <ul style="padding-left:18px;color:#1E1A2B">
         <li>Add photos that showcase your work</li>
         <li>Set your starting price so customers know what to expect</li>
         <li>If your service requires one, upload your licence so customers see a verified badge on your profile</li>
       </ul>
       <p>Quote requests and messages from customers will appear in your dashboard inbox, and we will notify you by email the moment one arrives.</p>
       <p><a href="${process.env.APP_URL || "https://eventvendors.us"}" style="background:#3B2C4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Go to your dashboard</a></p>
       <p>Welcome aboard.</p>`
    : `<p>Dear ${name},</p>
       <p>Thank you for joining Event Vendors. We are delighted to welcome you, and we look forward to helping you find the right vendors for your next event.</p>
       <p>You may now browse vendors by category, filter by price, rating, and location, and message vendors directly to request a quote or book a date, entirely free of charge.</p>
       <p><a href="${process.env.APP_URL || "https://eventvendors.us"}" style="background:#E26D4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Start browsing</a></p>
       <p>Welcome aboard.</p>`;
  return send({ to, subject: `Welcome to Event Vendors, ${name}`, html: shell("Welcome to Event Vendors", body) });
}

export function sendNewMessageEmail(to, fromName, kind, link) {
  const isQuote = kind === "quote";
  const subject = isQuote ? `Quote Request from ${fromName}` : `New Message from ${fromName}`;
  const noun = isQuote ? "quote request" : "message";
  return send({
    to, subject,
    html: shell("You have a new message", `
      <p>You have a ${noun} from <b>${fromName}</b> in your inbox.</p>
      <p><a href="${link}" style="background:#3B2C4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">View in inbox</a></p>
      <p style="font-size:12px;color:#8a8594">This is a notification only — replies sent to this email address will not reach ${fromName}. Please reply from your Event Vendors inbox.</p>`),
  });
}

export function sendBookingRequestEmail(to, customerName, details, link) {
  return send({
    to, subject: `New Booking Request from ${customerName}`,
    html: shell("You have a new booking request", `
      <p><b>${customerName}</b> would like to book you${details ? ` — ${details}` : ""}.</p>
      <p>Please accept or decline this request from your vendor dashboard. The customer will be notified either way.</p>
      <p><a href="${link}" style="background:#3B2C4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Review booking request</a></p>`),
  });
}

export function sendBookingDecisionEmail(to, vendorName, accepted, details, link) {
  const verb = accepted ? "confirmed" : "declined";
  return send({
    to, subject: `Booking ${accepted ? "Confirmed" : "Declined"} — ${vendorName}`,
    html: shell(accepted ? "Your booking is confirmed" : "Update on your booking request", `
      <p><b>${vendorName}</b> has ${verb} your booking request${details ? ` — ${details}` : ""}.</p>
      ${accepted
        ? `<p>You can view the details any time from your account.</p>`
        : `<p>You're welcome to reach out to other vendors in the same category — there are usually several great options.</p>`}
      <p><a href="${link}" style="background:#3B2C4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">View in account</a></p>`),
  });
}

export function sendVerifyEmail(to, link, firstName) {
  const name = firstName || "there";
  return send({
    to, subject: "Please confirm your email — Event Vendors",
    html: shell("Confirm your email address", `
      <p>Dear ${name},</p>
      <p>Thank you for creating an account with Event Vendors. To activate your account and ensure the security of your profile, please confirm your email address by clicking the button below.</p>
      <p><a href="${link}" style="background:#E26D4F;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;display:inline-block">Confirm my email</a></p>
      <p style="font-size:12px;color:#8a8594">If the button above does not work, please copy and paste this link into your browser: ${link}</p>
      <p style="font-size:12px;color:#8a8594">If you did not create this account, you may safely disregard this email.</p>`),
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
  const to = process.env.CONTACT_TO || "Inquiry@eventvendors.us";
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

export function sendReportNotificationEmail({ vendorId, userId, reasons, reason, reporterEmail }) {
  const to = process.env.CONTACT_TO || "Inquiry@eventvendors.us";
  const target = vendorId ? `Vendor #${vendorId}` : `User #${userId}`;
  return send({
    to, subject: `[Report] ${target} flagged — review needed`,
    html: shell("New violation report submitted", `
      <p><b>Reported:</b> ${target}</p>
      <p><b>Reasons:</b> ${(reasons || []).join(", ") || "(none given)"}</p>
      <p><b>Reporter:</b> ${reporterEmail || "(not provided)"}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:14px 0" />
      <p style="white-space:pre-wrap">${(reason || "(no additional details)").replace(/</g, "&lt;")}</p>
      <p style="margin-top:18px"><a href="${process.env.APP_URL || "https://eventvendors.us"}" style="background:#E26D4F;color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:700">Review in Moderation Panel →</a></p>
      <p style="font-size:12px;color:#8a8594;margin-top:10px">Log in with an admin account → Settings → Open moderation → Reports tab.</p>`),
  });
}

export function sendLicenceVerifiedEmail(to, vendorName) {
  return send({
    to, subject: "Your licence has been verified ✅ — Event Vendors",
    html: shell("Licence verified", `
      <p>Hi ${vendorName},</p>
      <p>Great news — our team has reviewed your credential and your <b>Licensed</b> badge is now live on your listing.</p>
      <p>Customers can now see that you hold a valid licence for your service, which increases trust and booking conversions.</p>
      <p style="text-align:center;margin:24px 0"><a href="${process.env.APP_URL}" style="background:#2F8F6B;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">View your listing →</a></p>
      <p style="font-size:12px;color:#8a8594">Remember to update your licence document before it expires to keep the badge active.</p>`),
  });
}

export function sendLicenceRejectedEmail(to, vendorName, reason) {
  return send({
    to, subject: "Action required: Licence submission — Event Vendors",
    html: shell("Licence review update", `
      <p>Hi ${vendorName},</p>
      <p>Our team reviewed your licence submission but was unable to verify it${reason ? `: <b>${reason}</b>` : "."}.</p>
      <p>Please log in to your vendor dashboard and upload a clear, valid copy of your credential. Common issues:</p>
      <ul>
        <li>File is blurry or partially cropped — make sure all details are visible</li>
        <li>Licence has expired — upload a current, valid credential</li>
        <li>Wrong document type — upload the specific licence required for your service</li>
      </ul>
      <p style="text-align:center;margin:24px 0"><a href="${process.env.APP_URL}" style="background:#E26D4F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Update your listing →</a></p>
      <p style="font-size:12px;color:#8a8594">If you believe this is an error, please contact us at ${process.env.CONTACT_TO || "Inquiry@eventvendors.us"}.</p>`),
  });
}


// ── Claim-your-profile ────────────────────────────────────────────────────────
export function sendClaimEmail({ to, vendorName, token, baseUrl }) {
  const claimUrl = `${baseUrl || process.env.APP_URL || "https://eventvendors.us"}?claim=${token}`;
  return send({
    to,
    subject: `Your ${vendorName} listing is waiting — claim it free`,
    html: shell("Claim your listing", `
      <p>Hi there,</p>
      <p>Your business <b>${vendorName}</b> is already listed on Event Vendors — couples and event planners can find it right now.</p>
      <p>Claim your free listing to:</p>
      <ul>
        <li>Add professional photos and a full description</li>
        <li>Set your starting price and service packages</li>
        <li>Receive quote requests and messages directly</li>
        <li>Get your <b>Founding badge</b> — exclusive to our first 100 vendors</li>
      </ul>
      <p style="text-align:center;margin:28px 0">
        <a href="${claimUrl}" style="background:#C9A227;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
          Claim my listing — it's free →
        </a>
      </p>
      <p style="font-size:12px;color:#8a8594">This link expires in 48 hours. If you didn't request it, safely ignore this email.</p>
      <p style="font-size:12px;color:#8a8594">Or paste this link: ${claimUrl}</p>`),
  });
}
