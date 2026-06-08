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

export function sendNotificationEmail(to, text) {
  return send({ to, subject: "New activity on Event Vendors", html: shell("You have a new notification", `<p>${text}</p>`) });
}
