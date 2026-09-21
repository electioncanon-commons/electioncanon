// ============================================================
// LAUNCH DISTRIBUTION — SUBSCRIBE CONTRACT  (Alpha 1.7)
//
// Modelled on election-invitation-email/contract.mjs's own split: plain
// JavaScript, no Deno APIs, so Deno runs it in production and the Node
// test suite runs the EXACT same code. crypto.randomUUID() is used
// instead (a standard Web Crypto API present in both Deno and Node,
// unlike Deno.env/fetch) -- not a Deno-specific API, so this file still
// has none.
//
// WHY THIS TAKES ONLY email/source_campaign/referral_id FROM THE CLIENT.
// This is a public, unauthenticated form -- unlike an invitation email
// (gated by an already-privileged campaign_invitations row), there is no
// prior server-side authorization step to defer to here. The closed
// source_campaign vocabulary and email shape check are the only gates,
// enforced identically in this contract AND in the migration's own
// launch_subscribers check constraint -- belt and suspenders, same as
// launch_analytics_events' event_type check.
//
// PROVIDER (Brevo migration, Alpha 1.7): this function used Resend
// through Alpha 1.7's initial launch build; it now uses Brevo, the
// domain-authenticated production provider for the launch-distribution
// path specifically. election-invitation-email is UNTOUCHED and still
// uses Resend/RESEND_API_KEY -- this is a delivery-path migration for
// ONE function, never a repo-wide provider swap. Brevo's transactional
// email API (https://api.brevo.com/v3/smtp/email) takes an `api-key`
// header (not `Authorization: Bearer`) and returns 201 + {messageId} on
// acceptance, or a 4xx + {code,message} on refusal -- see
// buildBrevoEmailRequest()/interpretBrevoResponse() below.
//
// RATE LIMITING (Alpha 1.7, Brevo pass). shouldRateLimitSignup() is the
// pure decision function; the actual counting query lives in index.ts
// against launch_subscribe_attempts (service-role only, see that
// migration's own header) since it needs a real database round trip.
// ============================================================

export const SOURCE_CAMPAIGNS = Object.freeze(["ad01", "ad02", "ad03", "launch"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the only fields a public signup form may supply. */
export function validateSubscribeRequest(body) {
  const email = body && typeof body === "object" ? body.email : undefined;
  const sourceCampaign = body && typeof body === "object" ? body.source_campaign : undefined;
  const referralIdRaw = body && typeof body === "object" ? body.referral_id : undefined;

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return { valid: false, reason: "a valid email address is required" };
  }
  if (typeof sourceCampaign !== "string" || !SOURCE_CAMPAIGNS.includes(sourceCampaign)) {
    return { valid: false, reason: `source_campaign must be one of: ${SOURCE_CAMPAIGNS.join(", ")}` };
  }
  let referralId = null;
  if (referralIdRaw !== undefined && referralIdRaw !== null) {
    if (typeof referralIdRaw !== "string") return { valid: false, reason: "referral_id must be a string" };
    const trimmed = referralIdRaw.trim().slice(0, 64);
    referralId = trimmed || null;
  }

  return { valid: true, email: email.trim().toLowerCase(), sourceCampaign, referralId };
}

/** 256 bits of randomness, same construction (two concatenated random UUIDs, dashes stripped) create_campaign_invitation() already uses in SQL -- no pgcrypto/extra dependency. */
export function mintLaunchToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

const SOURCE_CAMPAIGN_LABEL = Object.freeze({
  ad01: "AD01", ad02: "AD02", ad03: "AD03", launch: "the ElectionCanon launch",
});

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Double-opt-in confirmation email. NO subscription exists until this
 * link is clicked -- the footer says so explicitly, and this email
 * itself carries no unsubscribe link (there is nothing to unsubscribe
 * from yet; see confirm_launch_subscription()'s own migration header).
 * Same visual system as buildInvitationEmail() (black/ivory/teal/amber/
 * pink, table-based HTML, inline CSS, no external JS) -- reused, not a
 * second identity. The token never appears as visible text, only inside
 * the button's href, exactly like the invitation email's own discipline.
 */
export function buildConfirmationEmail({ email, sourceCampaign, token, origin }) {
  const link = `${origin}/launch/confirm?token=${encodeURIComponent(token)}`;
  const campaignLabel = SOURCE_CAMPAIGN_LABEL[sourceCampaign] ?? "ElectionCanon";
  const subject = "Confirm your ElectionCanon launch updates";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#0D0D0F;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    Confirm your subscription to ElectionCanon launch updates -- one click, no account required.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0D0D0F" style="background-color:#0D0D0F;">
    <tr><td align="center" style="padding: 32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr><td style="padding: 0 8px 20px 8px;">
          <span style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #0A7F73; text-transform: uppercase;">ElectionCanon</span>
        </td></tr>
        <tr><td style="background-color:#111418; border:1px solid #1C2128;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding: 36px 40px 8px 40px;">
              <h1 style="margin:0 0 12px 0; font-family: Helvetica, Arial, sans-serif; font-weight: 800; font-size: 24px; line-height: 30px; color: #F5F1E9;">
                Confirm your subscription
              </h1>
              <p style="margin: 0 0 22px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                You (or someone using ${esc(email)}) asked to follow the ElectionCanon Alpha 1.7 launch from ${esc(campaignLabel)}. One click confirms it -- no subscription exists until you do.
              </p>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="left" style="padding: 8px 40px 10px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" bgcolor="#F5A623" style="background-color:#F5A623;">
                  <a href="${esc(link)}" target="_blank" style="display:inline-block; padding: 16px 40px; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #0D0D0F; text-decoration: none; white-space: nowrap;">
                    Confirm Subscription
                  </a>
                </td>
              </tr></table>
            </td></tr>
            <tr><td style="padding: 0 40px 28px 40px;">
              <p style="margin:0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #5C6672;">
                Button not working? <a href="${esc(link)}" style="color:#0A7F73;">Open confirmation link</a>
              </p>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding: 0 40px 32px 40px; border-top: 1px solid #1C2128; padding-top: 20px;">
              <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #5C6672;">
                If you didn't request this, you can safely ignore this email -- no subscription is created until the link above is clicked, and this address will not receive anything further.
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding: 24px 8px 0 8px;">
          <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #8899AA; text-transform: uppercase;">ElectionCanon</p>
          <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #5C6672;">
            An open-source election operating system.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Confirm your subscription to ElectionCanon launch updates.\n\n`
    + `You (or someone using ${email}) asked to follow the ElectionCanon Alpha 1.7 launch from ${campaignLabel}.\n\n`
    + `Confirm here: ${link}\n\n`
    + `No subscription exists until you click this link. If you didn't request this, ignore this email.\n\n`
    + `ElectionCanon -- an open-source election operating system.`;

  return { subject, html, text };
}

/** Brevo's transactional-email request shape (POST /v3/smtp/email). */
export function buildBrevoEmailRequest({ senderEmail, senderName, to, subject, html, text }) {
  return {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };
}

/** Brevo returns 201 + {messageId} on acceptance, or a 4xx + {code,message} on refusal -- never a delivery guarantee either way. */
export function interpretBrevoResponse(status, body) {
  if (status >= 200 && status < 300 && body && typeof body.messageId === "string") {
    return { ok: true, providerMessageId: body.messageId, error: null };
  }
  const message = (body && body.message) || `email provider returned HTTP ${status}`;
  return { ok: false, providerMessageId: null, error: message };
}

/**
 * Pure rate-limit decision: given how many signup attempts this caller
 * (keyed by IP in index.ts) has made in the trailing window, should this
 * one be refused? Kept separate from the counting query itself (which
 * needs a real database round trip against launch_subscribe_attempts)
 * so the THRESHOLD LOGIC is unit-testable without a database.
 */
export function shouldRateLimitSignup(recentAttemptCount, maxAttempts = 5) {
  return recentAttemptCount >= maxAttempts;
}

export default {
  SOURCE_CAMPAIGNS, validateSubscribeRequest, mintLaunchToken, buildConfirmationEmail,
  buildBrevoEmailRequest, interpretBrevoResponse, shouldRateLimitSignup,
};
