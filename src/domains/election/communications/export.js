// ============================================================
// ELECTIONCANON — COMMUNICATIONS EXPORT PIPELINE  (Gate A.5.3)
//
// Communication + APPROVED language_variant -> a downloadable, social-
// ready PNG. Reuses design/render.js unchanged (see that file's own
// header) — this module adds no second rendering engine, no second canvas
// implementation, no second download mechanism.
//
// APPROVED-ONLY, RE-CHECKED HERE, NOT JUST IN THE UI. This module never
// reads the database and never infers approval from historical
// reviews/approvals rows — it takes `variantStatus` as a plain input and
// refuses unless it is EXACTLY VARIANT_STATUS.APPROVED at the moment this
// function runs. Communications.jsx is responsible for re-reading the
// variant's current status immediately before calling this (via
// listLanguageVariants — the same read every other screen in this
// codebase already trusts as the live source of truth), so a revoked
// approval cannot be exported as a stale "approved" snapshot. This
// function does not itself defend against a revocation landing in the
// gap between that re-read and this call finishing — that is a real,
// small, purely client-side race; see this gate's own architecture note
// on why no transactional lock is claimed for a client-side export.
//
// FIXED COMPOSITION, NOT SLOT INFERENCE. A Communication's title becomes
// the export's headline; the approved language_variant's own `text`
// becomes its body. This module never attempts to map variant text into
// an attached campaign_studio_assets row's own (arbitrary, per-template)
// slot layout, and never reads or mutates any campaign_studio_assets row
// at all — an attached Studio asset remains purely a relationship/context
// object, untouched by export.
//
// NO PERSISTENCE. No table, no Storage bucket, no history row. Export is
// a pure function of its inputs, producing a Blob the caller downloads
// client-side. Nothing here is a Supabase client, and nothing here writes
// anything, anywhere.
// ============================================================

import { renderTemplateToCanvas, canvasToPngBlob } from "../design/render.js";
import { VARIANT_STATUS } from "./api.js";

// Gate A.5.3's three required social formats. 1080x1080 and 1080x1350
// already existed as Campaign Studio template dimensions (SOCIAL_SQUARE,
// SOCIAL_POST in design/templates.js) — 1080x1920 did not and is new here.
// Deliberately a SEPARATE table from design/TEMPLATES: those are Studio's
// own creative-template gallery (arbitrary slot layouts a user picks
// from); these are Communications' own fixed export shapes (always
// exactly headline + body). Conflating the two is exactly the slot-
// mapping shortcut this gate's approved architecture rules out.
export const EXPORT_FORMAT = Object.freeze({ SQUARE: "square", PORTRAIT: "portrait", STORY: "story" });

export const EXPORT_FORMATS = Object.freeze({
  [EXPORT_FORMAT.SQUARE]: Object.freeze({ id: EXPORT_FORMAT.SQUARE, label: "1080 × 1080", width: 1080, height: 1080 }),
  [EXPORT_FORMAT.PORTRAIT]: Object.freeze({ id: EXPORT_FORMAT.PORTRAIT, label: "1080 × 1350", width: 1080, height: 1350 }),
  [EXPORT_FORMAT.STORY]: Object.freeze({ id: EXPORT_FORMAT.STORY, label: "1080 × 1920", width: 1080, height: 1920 }),
});

export const EXPORT_FORMAT_LIST = Object.freeze(Object.values(EXPORT_FORMATS));

// The fixed two-slot layout every Communications export uses, at whatever
// size the chosen format declares. Background token "primary" and the
// heading/body typography names match design/templates.js's own
// vocabulary so design/render.js needs no format-specific branch.
function buildExportTemplate(formatDef) {
  return Object.freeze({
    id: `communication_export_${formatDef.id}`,
    dimensions: { width: formatDef.width, height: formatDef.height },
    background: { kind: "solid", token: "primary" },
    typography: { heading: "display", body: "ui" },
    textSlots: [
      { id: "headline", label: "Headline" },
      { id: "body", label: "Body" },
    ],
  });
}

function slugify(value) {
  const slug = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "communication";
}

/** electioncanon-{communication-slug}-{language}-{width}x{height}.png —
 *  language-specific so the SAME Communication in multiple approved
 *  languages (e.g. an English variant and a Yoruba variant) always
 *  produces independently named files, never overwriting one another. */
export function buildExportFilename({ communicationTitle, language, format }) {
  return `electioncanon-${slugify(communicationTitle)}-${language}-${format.width}x${format.height}.png`;
}

/** A small, deterministic export function. Takes the minimum necessary —
 *  the communication's title, the variant's own text/language/CURRENT
 *  status, a chosen format, and a `createCanvas` factory — and either
 *  produces a PNG blob + honest filename, or refuses with an honest,
 *  specific error. Never touches Supabase, never receives a `client`,
 *  never creates or mutates any database row or Studio asset, and never
 *  triggers the download itself (the caller downloads only after seeing
 *  `error: null`, matching this gate's own "trigger download only after
 *  successful rendering" rule).
 *
 *  `createCanvas` has NO default here, deliberately: src/domains/election/
 *  is a structurally-enforced DOM-free boundary (see design/render.js's
 *  own header and test/election-web-adapter.consumer.mjs's "no Election
 *  domain/boundary module's CODE imports React, WhatsApp, browser state,
 *  or the DOM" check), so this module never calls `document.createElement`
 *  itself. The page layer (Communications.jsx) supplies
 *  `() => document.createElement("canvas")`. */
export async function exportApprovedVariant({
  communicationTitle,
  variantStatus,
  variantLanguage,
  variantText,
  format,
  identity = {},
  createCanvas,
}) {
  // 1 — the governance gate. Checked first, before format or content
  // validation, because this is the one refusal that must never be
  // shadowed by an unrelated error. Re-reading a genuinely CURRENT
  // variantStatus is the caller's job (see this file's own header).
  if (variantStatus !== VARIANT_STATUS.APPROVED) {
    return { blob: null, filename: null, error: "This language variant is not currently approved and cannot be exported." };
  }

  const formatDef = EXPORT_FORMATS[format];
  if (!formatDef) {
    return { blob: null, filename: null, error: `"${format}" is not a supported export format.` };
  }

  const title = String(communicationTitle ?? "").trim();
  if (!title) {
    return { blob: null, filename: null, error: "This communication has no title to use as an export headline." };
  }

  const text = String(variantText ?? "").trim();
  if (!text) {
    return { blob: null, filename: null, error: "This language variant has no text to export." };
  }

  if (typeof createCanvas !== "function") {
    return { blob: null, filename: null, error: "No canvas implementation was supplied for export." };
  }

  const template = buildExportTemplate(formatDef);
  const canvas = createCanvas();
  canvas.width = formatDef.width;
  canvas.height = formatDef.height;

  renderTemplateToCanvas({
    canvas, template,
    textBySlot: { headline: title, body: text },
    identity,
  });

  const blob = await canvasToPngBlob(canvas);
  if (!blob) {
    return { blob: null, filename: null, error: "PNG rendering failed." };
  }

  return { blob, filename: buildExportFilename({ communicationTitle: title, language: variantLanguage, format: formatDef }), error: null };
}

export default { EXPORT_FORMAT, EXPORT_FORMATS, EXPORT_FORMAT_LIST, buildExportFilename, exportApprovedVariant };
