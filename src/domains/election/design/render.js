// ============================================================
// FORGE ELECTION — SHARED TEMPLATE RENDERER  (Gate A.5.3)
//
// Extracted, UNCHANGED IN BEHAVIOR, from exportPng() in
// src/pages/election/CampaignStudioSection.jsx (Campaign Studio's
// original, and until now only, PNG export). Pure canvas-drawing code: no
// Supabase, no campaign_studio_assets-specific field names — it takes a
// template's dimensions/background/textSlots, a plain slot-keyed text map,
// and an identity object for the footer credit line. Reused unchanged by
// both Campaign Studio's own asset export (CampaignStudioSection.jsx) and
// Gate A.5.3's Communications export (communications/export.js) — one
// rendering engine, not two.
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
// step therefore lives in pages/election/shared.jsx's downloadBlob()
// instead of here, even though it is conceptually "part of export" — the
// page layer is where DOM-triggering belongs in this codebase; domain
// modules stay pure and Node-testable.
// ============================================================

import { T } from "../../../os/forge.js";

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

/** Draws a template's text slots + identity footer onto `canvas`, which the
 *  caller has already sized (canvas.width/canvas.height set before calling
 *  this — this function never resizes the canvas itself). Long text that
 *  would overflow the canvas's own height is not truncated or auto-shrunk:
 *  it is simply not drawn past the canvas bounds, the same implicit
 *  clipping the original exportPng() always relied on. No new overflow
 *  behavior is introduced here — this is a straight extraction. */
export function renderTemplateToCanvas({ canvas, template, textBySlot = {}, identity = {} }) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COLOUR_TOKEN[template.background?.token] ?? T.teal;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";
  let y = canvas.height * 0.12;
  const marginX = canvas.width * 0.08;
  const maxWidth = canvas.width * 0.84;

  for (const slot of template.textSlots) {
    const value = textBySlot[slot.id];
    if (!value) continue;
    const isHeadline = slot.id === "headline";
    const font = isHeadline ? `700 ${Math.round(canvas.width * 0.055)}px sans-serif` : `400 ${Math.round(canvas.width * 0.03)}px sans-serif`;
    const lines = wrapText(ctx, value, font, maxWidth);
    ctx.font = font;
    for (const line of lines) {
      ctx.fillText(line, marginX, y);
      y += Math.round(canvas.width * (isHeadline ? 0.065 : 0.04));
    }
    y += canvas.width * 0.02;
  }

  if (identity.campaignName) {
    ctx.font = `700 ${Math.round(canvas.width * 0.024)}px sans-serif`;
    ctx.fillText(identity.campaignName, marginX, canvas.height - canvas.width * 0.08);
  }
}

/** Promise wrapper around canvas.toBlob("image/png") — never throws;
 *  resolves null if the canvas produced no blob, mirroring the original
 *  exportPng()'s own toBlob callback (which silently did nothing on a null
 *  blob). */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? null), "image/png");
  });
}

export default { renderTemplateToCanvas, canvasToPngBlob };
