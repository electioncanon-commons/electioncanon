// ============================================================
// OUTREACH ACTIVATION — BRANDED HTML EMAIL COMPOSER  (Launch Engine
// closed-loop, Phase 7)
//
// WHAT THIS DOES NOT DO. It does not write message CONTENT -- that is
// assets.js's renderAsset() (the seven follow-up templates) or a human
// typing a fresh draft in the control room. This file takes whatever
// {subject, body} plain text already exists and wraps it into a
// responsive, email-client-compatible HTML document plus a plain-text
// alternative -- a rendering layer, not a second content engine. Reusing
// the existing registry (assets.js) rather than declaring a second one
// is the same discipline every domain module in this repo follows.
//
// NO LOGO ASSET EXISTS IN THIS REPOSITORY. index.html's own header
// comment is explicit: "no real ElectionCanon mark exists yet... would
// violate this project's own 'no claim without proof' discipline."
// buildBrandedEmail() therefore renders a TEXT wordmark (Archivo Black,
// brand teal) by default -- never a fabricated image. An optional
// `logoUrl` parameter exists for the day a real mark is published, and
// validateLogoUrl() below REFUSES anything that is not a plain https://
// URL (no localhost, no file:, no data: URI, no sandbox/preview
// hostname) -- Phase 7's own requirement that the logo "must be served
// from a stable HTTPS URL... not an expiring sandbox URL."
//
// TABLE-BASED LAYOUT, INLINE STYLES. Email clients (Outlook especially)
// do not reliably support flexbox/grid or <style> blocks scoped to a
// class -- every rule here is inline, and the structural layout uses
// nested <table> elements, the only genuinely universal approach.
//
// SAFE ESCAPING. escapeHtml() below is the ONLY path user-supplied text
// (recipientName, organization, subject, body) takes into the HTML
// output -- every interpolation in buildBrandedEmail() goes through it.
// The plain-text alternative never needs escaping (it is not HTML) but
// is still built from the SAME source paragraphs as the HTML version, so
// the two can never visibly diverge in content, only in markup.
//
// PURE, LOCAL-ONLY: no fs, no network, no Supabase, no React, no DOM --
// same discipline as every other file in this subsystem (belongs on
// test/election-outreach-launch-separation.consumer.mjs's source-scan
// list).
// ============================================================

export const TEAL = "#0A7F73";
export const PINK = "#FF2E63";
export const INK = "#111418";
export const IVORY = "#F5F3EE";
export const MUTED = "#8A8F98";

const MAX_SUBJECT = 300;
const MAX_PREHEADER = 150;

export function escapeHtml(input) {
  const s = input == null ? "" : String(input);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Splits plain text into paragraphs on a blank line, preserving single
 * newlines within a paragraph as <br> in the HTML version. Never
 * re-flows or alters wording -- purely a markup transformation.
 */
export function splitParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * A real https:// URL only -- never localhost, never a bare IP, never
 * file:/data:/blob:, never a known ephemeral preview/sandbox hostname
 * fragment. Returns {valid, error}. Called by buildBrandedEmail() before
 * a logoUrl is ever placed in outgoing HTML.
 */
export function validateLogoUrl(url) {
  if (url == null) return { valid: true, error: null }; // absent is fine -- falls back to the text wordmark
  if (typeof url !== "string" || !url.trim()) return { valid: false, error: "logoUrl must be a non-empty string when provided" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "logoUrl is not a valid URL" };
  }
  if (parsed.protocol !== "https:") return { valid: false, error: "logoUrl must use https:// -- no local file path, data URI, or plain http" };
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { valid: false, error: "logoUrl cannot point at localhost or a bare IP address" };
  }
  if (/\b(sandbox|preview|localtunnel|ngrok|vercel\.app)\b/i.test(host)) {
    return { valid: false, error: "logoUrl looks like an ephemeral preview/sandbox hostname, not a stable durable asset location" };
  }
  return { valid: true, error: null };
}

/**
 * Validates everything buildBrandedEmail() needs before composing --
 * called by the control room BEFORE building the final-approval preview,
 * so a caller never discovers a bad logoUrl only after a human has
 * already approved a send.
 */
export function validateComposerInput({ subject, bodyText, logoUrl }) {
  if (typeof subject !== "string" || !subject.trim() || subject.length > MAX_SUBJECT) {
    return { valid: false, error: `subject is required (max ${MAX_SUBJECT} chars)` };
  }
  if (typeof bodyText !== "string" || !bodyText.trim()) return { valid: false, error: "bodyText is required" };
  const logoCheck = validateLogoUrl(logoUrl);
  if (!logoCheck.valid) return logoCheck;
  return { valid: true, error: null };
}

function wordmarkHtml(logoUrl) {
  if (logoUrl) {
    // alt text is never empty -- a broken/blocked image must never leave
    // the brand entirely unidentified in a mail client that hides images.
    return `<img src="${escapeHtml(logoUrl)}" alt="ElectionCanon" width="160" style="display:block;border:0;outline:none;text-decoration:none;max-width:160px;height:auto;" />`;
  }
  return `<span style="font-family:'Archivo Black',Arial,sans-serif;font-size:20px;font-weight:900;color:${TEAL};letter-spacing:0.01em;">ElectionCanon</span>`;
}

/**
 * Builds {subject, html, text} for one outreach message. `bodyText` is
 * the SAME plain-text body a human would read in a mail client with
 * images/HTML disabled -- nothing in the HTML path says anything the
 * text path doesn't also say. `recipientName`/`organization` personalize
 * the opening line only when actually known -- an absent name is never
 * replaced with a guess or a generic "there," matching this subsystem's
 * existing honesty discipline (see assets.js's own orgLine()/
 * priorReference()).
 */
export function buildBrandedEmail({
  subject, bodyText, recipientName = null, organization = null, preheader = null, logoUrl = null,
  signatureName = "Ernest Agbofode", signatureTitle = "Project Lead, ElectionCanon", signatureOrg = "Soteria Innovate",
  signatureEmail = "admin@electioncanon.org",
}) {
  const inputCheck = validateComposerInput({ subject, bodyText, logoUrl });
  if (!inputCheck.valid) return { valid: false, error: inputCheck.error, subject: null, html: null, text: null };

  const paragraphs = splitParagraphs(bodyText);
  const safePreheader = preheader ? escapeHtml(String(preheader).slice(0, MAX_PREHEADER)) : "";

  const paragraphsHtml = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F0EFEA;">
${safePreheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0EFEA;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E3E0D8;">
        <tr>
          <td style="padding:24px 28px;border-bottom:3px solid ${TEAL};">
            ${wordmarkHtml(logoUrl)}
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            ${recipientName || organization
              ? `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK};">Dear ${escapeHtml(recipientName || organization)},</p>`
              : ""}
            ${paragraphsHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${INK};">
              Yours faithfully,<br />
              <strong>${escapeHtml(signatureName)}</strong><br />
              ${escapeHtml(signatureTitle)}<br />
              ${escapeHtml(signatureOrg)}<br />
              <a href="mailto:${escapeHtml(signatureEmail)}" style="color:${TEAL};text-decoration:none;">${escapeHtml(signatureEmail)}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background-color:#FAFAF7;border-top:1px solid #E3E0D8;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:${MUTED};">
              ElectionCanon is an open-source election operations system.
              <a href="https://electioncanon.org" style="color:${PINK};text-decoration:none;">electioncanon.org</a>
              &middot;
              <a href="https://github.com/electioncanon-commons/electioncanon" style="color:${PINK};text-decoration:none;">Source</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textLines = [
    recipientName || organization ? `Dear ${recipientName || organization},` : null,
    "",
    bodyText.trim(),
    "",
    "Yours faithfully,",
    signatureName,
    signatureTitle,
    signatureOrg,
    signatureEmail,
    "",
    "ElectionCanon -- https://electioncanon.org",
    "Source: https://github.com/electioncanon-commons/electioncanon",
  ].filter((l) => l !== null);

  return { valid: true, error: null, subject, html, text: textLines.join("\n") };
}

export default {
  TEAL, PINK, INK, IVORY, MUTED,
  escapeHtml, splitParagraphs, validateLogoUrl, validateComposerInput, buildBrandedEmail,
};
