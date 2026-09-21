// ============================================================
// LAUNCH DISTRIBUTION — SEQUENCE EMAIL CONTRACT  (Alpha 1.7)
//
// Same plain-JavaScript/no-Deno-APIs split as every other contract.mjs
// in this repo. This is the CONTENT for the 3-email launch sequence
// (AD01 introduction, AD02 system/architecture, AD03 Alpha 1.7 + open-
// source invitation) -- sending itself is owner-triggered only (see
// index.ts's own header), never scheduled/automatic.
//
// HONESTY OVER COMPLETENESS. AD02 and AD03 have no shipped creative
// asset in this repository (only AD01Chaos.jsx exists -- see /launch's
// own header). Email 2 and Email 3 therefore never claim "watch the
// film" -- Email 2 draws its real content from docs/ARCHITECTURE.md's
// actual "Rooms read, events write" / PREPARE->APPROVE->EXECUTE
// description, and Email 3 draws from README.md's real AGPL-3.0/open-
// source positioning and the real GitHub URL. Email 1 draws its framing
// from AD01Chaos.jsx's own real on-screen copy ("TOO MUCH NOISE." /
// "CHAOTIC ELECTION OPERATIONS? NO MORE.") since that film is real and
// live at /launch/ad01.
//
// UNSUBSCRIBE IS NEVER OPTIONAL HERE. Every template in this file takes
// a per-subscriber `token` and renders a real, working unsubscribe link
// built from it -- never a shared/placeholder link -- matching the
// launch brief's explicit requirement that every marketing email
// include working unsubscribe functionality.
//
// PROVIDER (Brevo migration, Alpha 1.7): this function used Resend
// through Alpha 1.7's initial launch build; it now sends through Brevo
// -- election-invitation-email is untouched and still uses Resend.
//
// SEQUENCE_CONTENT_READY (Brevo pass) -- AN EXPLICIT SERVER-SIDE GUARD,
// SEPARATE FROM LAUNCH_ADMIN_SECRET. The admin secret (checked in
// index.ts) proves WHO may call this function; this proves WHETHER the
// requested step has real content to send at all. Even a caller who
// holds a perfectly valid LAUNCH_ADMIN_SECRET cannot send sequence 2 or
// 3 -- no AD02/AD03 creative exists (see /launch's own header), so
// validateSendCampaignRequest() itself refuses those steps BEFORE any
// Brevo call is ever attempted, closing off "an accidental/scripted API
// call sends a nonexistent campaign" as a failure mode entirely. This
// flag exists to be flipped by hand, deliberately, once real AD02/AD03
// content exists -- never inferred, never auto-detected.
// ============================================================

export const SEQUENCE_STEPS = Object.freeze([1, 2, 3]);

export const SEQUENCE_CONTENT_READY = Object.freeze({ 1: true, 2: false, 3: false });

export function validateSendCampaignRequest(body) {
  const sequence = body && typeof body === "object" ? body.sequence : undefined;
  if (!SEQUENCE_STEPS.includes(sequence)) {
    return { valid: false, reason: `sequence must be one of: ${SEQUENCE_STEPS.join(", ")}` };
  }
  if (!SEQUENCE_CONTENT_READY[sequence]) {
    return { valid: false, reason: `sequence ${sequence} has no shipped creative yet and is blocked from sending`, code: "CONTENT_NOT_READY" };
  }
  return { valid: true, sequence };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function emailShell({ eyebrow, heading, bodyHtml, ctaLabel, ctaHref, unsubscribeHref, subject }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#0D0D0F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0D0D0F" style="background-color:#0D0D0F;">
    <tr><td align="center" style="padding: 32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr><td style="padding: 0 8px 20px 8px;">
          <span style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #0A7F73; text-transform: uppercase;">ElectionCanon</span>
        </td></tr>
        <tr><td style="background-color:#111418; border:1px solid #1C2128;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding: 36px 40px 8px 40px;">
              <p style="margin:0 0 10px 0; font-family: Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #FF2E63; text-transform: uppercase;">${esc(eyebrow)}</p>
              <h1 style="margin:0 0 16px 0; font-family: Helvetica, Arial, sans-serif; font-weight: 800; font-size: 25px; line-height: 31px; color: #F5F1E9;">${esc(heading)}</h1>
              ${bodyHtml}
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="left" style="padding: 8px 40px 32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" bgcolor="#F5A623" style="background-color:#F5A623;">
                  <a href="${esc(ctaHref)}" target="_blank" style="display:inline-block; padding: 16px 40px; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #0D0D0F; text-decoration: none; white-space: nowrap;">${esc(ctaLabel)}</a>
                </td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding: 24px 8px 0 8px;">
          <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #8899AA; text-transform: uppercase;">ElectionCanon</p>
          <p style="margin: 0 0 14px 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #5C6672;">
            An open-source election operating system.
          </p>
          <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 17px; color: #5C6672;">
            You're receiving this because you confirmed a subscription to ElectionCanon launch updates.
            <a href="${esc(unsubscribeHref)}" style="color:#0A7F73;">Unsubscribe</a> at any time.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function textFooter(unsubscribeHref) {
  return `\n\nYou're receiving this because you confirmed a subscription to ElectionCanon launch updates.\nUnsubscribe: ${unsubscribeHref}\n\nElectionCanon -- an open-source election operating system.`;
}

/** Email 1 -- AD01: introduction/problem. Framing sourced from AD01Chaos.jsx's own real on-screen copy -- see this file's own header. */
function buildEmail1({ token, origin }) {
  const unsubscribeHref = `${origin}/launch/unsubscribe?token=${encodeURIComponent(token)}`;
  const ctaHref = `${origin}/launch/ad01`;
  const subject = "Too much noise. No more. — ElectionCanon";
  const bodyHtml = `
              <p style="margin: 0 0 16px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                A ward coordinator asks who's handling polling unit 007. Someone confirms. A field agent's message goes unread. Three missed calls later, nobody actually knows what's happening on the ground.
              </p>
              <p style="margin: 0 0 22px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                That's how most campaigns coordinate today -- scattered across chats, calls, and memory. ElectionCanon exists to replace that chaos with a real, accountable operating system: every coordinator knows exactly who they are, where they're responsible, and what still needs to be done.
              </p>`;
  return { subject, ...withCta({ eyebrow: "ElectionCanon Alpha 1.7 — Part 1 of 3", heading: "Too much noise. No more.", bodyHtml, ctaLabel: "Watch AD01", ctaHref, unsubscribeHref, subject }),
    text: `Too much noise. No more.\n\nA ward coordinator asks who's handling polling unit 007. Someone confirms. A field agent's message goes unread. Three missed calls later, nobody actually knows what's happening on the ground.\n\nThat's how most campaigns coordinate today. ElectionCanon replaces it with a real, accountable operating system: every coordinator knows exactly who they are, where they're responsible, and what still needs to be done.\n\nWatch AD01: ${ctaHref}${textFooter(unsubscribeHref)}` };
}

/** Email 2 -- AD02: system/architecture. No AD02 film exists yet -- content is the real architecture, drawn from docs/ARCHITECTURE.md, never "watch the film." See this file's own header. */
function buildEmail2({ token, origin }) {
  const unsubscribeHref = `${origin}/launch/unsubscribe?token=${encodeURIComponent(token)}`;
  const ctaHref = `${origin}/launch/ad02`;
  const subject = "The system behind ElectionCanon — Alpha 1.7";
  const bodyHtml = `
              <p style="margin: 0 0 16px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                ElectionCanon's whole design comes down to one rule: <strong style="color:#F5F1E9;">rooms read, events write.</strong> No screen stores election state locally -- every action either publishes an immutable event to a shared, tenant-scoped log, or performs a directly RLS-protected read/write for the small set of operational concerns (like chat) that genuinely need it.
              </p>
              <p style="margin: 0 0 22px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                Every Canon-fact write goes through PREPARE, then an explicit human APPROVE, then EXECUTE -- no code path can skip a step, and no AI-driven action is ever allowed to write silently. That's what makes a campaign's readiness, responsibility, and results genuinely auditable, not just a claim.
              </p>
              <p style="margin: 0 0 4px 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #8899AA;">
                Our AD02 film on this is still in production -- this page will carry it the moment it's ready.
              </p>`;
  return { subject, ...withCta({ eyebrow: "ElectionCanon Alpha 1.7 — Part 2 of 3", heading: "The system behind the noise.", bodyHtml, ctaLabel: "See AD02", ctaHref, unsubscribeHref, subject }),
    text: `The system behind the noise.\n\nElectionCanon's whole design comes down to one rule: rooms read, events write. No screen stores election state locally -- every action either publishes an immutable event to a shared, tenant-scoped log, or performs a directly RLS-protected read/write for the small set of operational concerns (like chat) that genuinely need it.\n\nEvery Canon-fact write goes through PREPARE, then an explicit human APPROVE, then EXECUTE -- no code path can skip a step, and no AI-driven action is ever allowed to write silently.\n\nOur AD02 film on this is still in production -- this page will carry it the moment it's ready.\n\nSee AD02: ${ctaHref}${textFooter(unsubscribeHref)}` };
}

/** Email 3 -- AD03: Alpha 1.7 / open-source invitation. No AD03 film exists yet -- content is the real, already-true AGPL-3.0/open-source positioning from README.md. See this file's own header. */
function buildEmail3({ token, origin }) {
  const unsubscribeHref = `${origin}/launch/unsubscribe?token=${encodeURIComponent(token)}`;
  const ctaHref = "https://github.com/electioncanon-commons/electioncanon";
  const subject = "ElectionCanon is open source — join Alpha 1.7";
  const bodyHtml = `
              <p style="margin: 0 0 16px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                ElectionCanon Alpha 1.7 is real, working software -- and it's licensed AGPL-3.0, published in the open. No paywall around election accountability infrastructure; the source, the migrations, the RLS policies are all public.
              </p>
              <p style="margin: 0 0 22px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14.5px; line-height: 22px; color: #C9CDD3;">
                If you build, audit, or run civic-tech software, this is an invitation: read the code, file an issue, open a pull request, or just run it yourself.
              </p>
              <p style="margin: 0 0 4px 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #8899AA;">
                Our AD03 film on this is still in production -- <a href="${esc(origin)}/launch/ad03" style="color:#0A7F73;">this page</a> will carry it the moment it's ready.
              </p>`;
  return { subject, ...withCta({ eyebrow: "ElectionCanon Alpha 1.7 — Part 3 of 3", heading: "Open source. Open invitation.", bodyHtml, ctaLabel: "View on GitHub", ctaHref, unsubscribeHref, subject }),
    text: `Open source. Open invitation.\n\nElectionCanon Alpha 1.7 is real, working software -- and it's licensed AGPL-3.0, published in the open. No paywall around election accountability infrastructure; the source, the migrations, the RLS policies are all public.\n\nIf you build, audit, or run civic-tech software, this is an invitation: read the code, file an issue, open a pull request, or just run it yourself.\n\nOur AD03 film on this is still in production -- ${origin}/launch/ad03 will carry it the moment it's ready.\n\nView on GitHub: ${ctaHref}${textFooter(unsubscribeHref)}` };
}

function withCta({ eyebrow, heading, bodyHtml, ctaLabel, ctaHref, unsubscribeHref, subject }) {
  return { html: emailShell({ eyebrow, heading, bodyHtml, ctaLabel, ctaHref, unsubscribeHref, subject }) };
}

const BUILDERS = Object.freeze({ 1: buildEmail1, 2: buildEmail2, 3: buildEmail3 });

/** @param step 1, 2, or 3. @param token the subscriber's own token (unsubscribe link). @param origin the site origin. */
export function buildSequenceEmail({ step, token, origin }) {
  const builder = BUILDERS[step];
  if (!builder) throw new Error(`no sequence email for step ${step}`);
  const { subject, html, text } = builder({ token, origin });
  return { subject, html, text };
}

/** Brevo's transactional-email request shape (POST /v3/smtp/email). Duplicated from launch-subscribe/contract.mjs -- Supabase deploys each function directory in isolation, see that file's own header on this duplication pattern. */
export function buildBrevoEmailRequest({ senderEmail, senderName, to, subject, html, text }) {
  return {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };
}

/** Brevo returns 201 + {messageId} on acceptance, or a 4xx + {code,message} on refusal. */
export function interpretBrevoResponse(status, body) {
  if (status >= 200 && status < 300 && body && typeof body.messageId === "string") {
    return { ok: true, providerMessageId: body.messageId, error: null };
  }
  const message = (body && body.message) || `email provider returned HTTP ${status}`;
  return { ok: false, providerMessageId: null, error: message };
}

export default {
  SEQUENCE_STEPS, SEQUENCE_CONTENT_READY, validateSendCampaignRequest, buildSequenceEmail,
  buildBrevoEmailRequest, interpretBrevoResponse,
};
