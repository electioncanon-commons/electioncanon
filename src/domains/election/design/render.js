// ============================================================
// FORGE ELECTION — SHARED TEMPLATE RENDERER  (Gate A.5.3, refactored Gate A.5.4)
//
// GATE A.5.4 RENDERER CONTRACT CHANGE. This renderer now accepts exactly
// two things beyond the canvas: a `template` (design/templates.js's
// TEMPLATES or CREATIVE_TEMPLATES shape) and a `payload` — the closed
// {content, identity} shape design/creative.js builds (or, for the
// existing freeform Campaign Studio Design-tab flow, a locally-built
// equivalent — see CampaignStudioSection.jsx's own comment on why THAT
// path is deliberately not routed through design/creative.js's strict
// builder/validator). It NEVER accepts a raw campaign_studio_assets /
// communications / language_variants / reviews / approvals /
// campaign_members row — only ever this shape.
//
// GATE A.5.4 — THE AUTOMATIC CAMPAIGN-NAME FOOTER IS REMOVED. The prior
// version of this file drew `identity.campaignName` as an unconditional
// footer credit on every single render, sourced (via assets.js/
// CampaignStudioSection.jsx) directly from campaigns.name with no
// judgment about whether that value was ever meant to be public-facing
// text. That is exactly the mechanism the Gate A.5.4 architecture audit
// identified as a structural leak (a test/placeholder campaign name
// rendering as a public credit line on every export). This file now draws
// NOTHING automatically from any application field. `identity.brand` is
// still drawn — but only when a caller EXPLICITLY supplies it, and only
// design/creative.js's builders decide what that value is (never derived
// from campaigns.name, never a creator/user identifier — see that file's
// own header).
//
// GATE A.5.4 — TYPOGRAPHY. Headline text now requests Poppins Black (900)
// via design/typography.js's creativeFont(), formalizing forge-brand.css's
// own documented ("Poppins is the single Forge face, Black (900) for
// headlines") but previously canvas-unenforced brand rule. Body text also
// requests Poppins (regular weight) for consistency. Content is drawn
// EXACTLY as authored — no case transformation of any kind; "sentence
// case" is an authoring convention this file has no business enforcing.
// Canvas will silently fall back to a system font if Poppins has not
// actually loaded in the browser yet — this file cannot fix that itself
// (no DOM access, see below); see pages/election/shared.jsx's
// ensureCreativeFontsReady(), which callers must await before rendering.
//
// Reused unchanged by both Campaign Studio's own asset export
// (CampaignStudioSection.jsx) and Gate A.5.3's Communications export
// (communications/export.js) — one rendering engine, not two.
//
// Colour tokens come from os/forge.js (the canonical, JSX-free design
// token module) rather than pages/election/shared.jsx, so this module
// stays importable from a plain Node consumer test with no JSX transform
// — the same reason design/templates.js and design/assets.js never import
// anything from pages/.
//
// NO DOM ACCESS HERE, DELIBERATELY. This file only ever calls methods on
// the `canvas` object it is handed (getContext/toBlob) — never
// `document.*`/`window.*` directly — because src/domains/election/** is a
// structurally-enforced DOM-free boundary (see test/election-web-adapter.
// consumer.mjs's "no Election domain/boundary module's CODE imports
// React, WhatsApp, browser state, or the DOM" check, which scans this
// entire directory tree). The actual createObjectURL/anchor-click download
// step, and font-loading, therefore live in pages/election/shared.jsx
// instead of here — the page layer is where DOM-triggering belongs in
// this codebase; domain modules stay pure and Node-testable.
// ============================================================

import { T } from "../../../os/forge.js";
import { creativeFont } from "./typography.js";

const COLOUR_TOKEN = { primary: T.teal, secondary: T.pink, accent: T.amber, surface: T.surface };

function wrapText(ctx, text, font, maxW) {
  ctx.font = font;
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws a template's text slots + an OPT-IN identity.brand footer onto
 *  `canvas`, which the caller has already sized (canvas.width/height set
 *  before calling this — this function never resizes the canvas itself).
 *
 *  `payload` is the closed {content, identity} shape — `payload.content`
 *  is read by slot id (template.textSlots), `payload.identity.brand` is
 *  drawn only if explicitly present. Nothing else on `payload` is ever
 *  read (in particular, `payload.visual` is accepted for shape
 *  completeness — see design/creative.js's own header — but nothing here
 *  draws an image in this phase).
 *
 *  Long text that would overflow the canvas's own height is not truncated
 *  or auto-shrunk: it is simply not drawn past the canvas bounds, the
 *  same implicit clipping this renderer has always relied on. No new
 *  overflow behavior is introduced here. */
export function renderTemplateToCanvas({ canvas, template, payload = {} }) {
  const content = payload.content ?? {};
  const identity = payload.identity ?? {};

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COLOUR_TOKEN[template.background?.token] ?? T.teal;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";
  let y = canvas.height * 0.12;
  const marginX = canvas.width * 0.08;
  const maxWidth = canvas.width * 0.84;

  for (const slot of template.textSlots) {
    const value = content[slot.id];
    if (!value) continue;
    const isHeadline = slot.id === "headline";
    const font = creativeFont({ role: isHeadline ? "headline" : "body", sizePx: canvas.width * (isHeadline ? 0.055 : 0.03) });
    const lines = wrapText(ctx, value, font, maxWidth);
    ctx.font = font;
    for (const line of lines) {
      ctx.fillText(line, marginX, y);
      y += Math.round(canvas.width * (isHeadline ? 0.065 : 0.04));
    }
    y += canvas.width * 0.02;
  }

  // OPT-IN ONLY. Never populated automatically from campaigns.name or any
  // other operational field — see this file's own header and design/
  // creative.js's builder, which is the only thing allowed to decide what
  // (if anything) this value is.
  if (identity.brand) {
    ctx.font = creativeFont({ role: "body", sizePx: canvas.width * 0.024 });
    ctx.fillText(identity.brand, marginX, canvas.height - canvas.width * 0.08);
  }
}

/** Promise wrapper around canvas.toBlob("image/png") — never throws;
 *  resolves null if the canvas produced no blob, mirroring this
 *  renderer's own long-standing toBlob callback (which silently did
 *  nothing on a null blob). */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? null), "image/png");
  });
}

export default { renderTemplateToCanvas, canvasToPngBlob };
