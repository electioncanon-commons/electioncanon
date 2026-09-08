// ============================================================
// FORGE ELECTION — PUBLIC CREATIVE PAYLOAD  (Gate A.5.4, generalized Phase 2.1)
//
// THE CRITICAL BOUNDARY:
//
//   GOVERNED / LEGACY SOURCE DATA
//           |
//   EXPLICIT PUBLIC CREATIVE PAYLOAD   <-- this file
//           |
//   TEMPLATE-DECLARED PUBLIC SLOTS
//           |
//   RENDERER
//           |
//   OUTPUT
//
// A renderer must NEVER accept a raw campaign_studio_assets / communications
// / language_variants / reviews / approvals / campaign_members row, and
// never an arbitrary content map whose fields are implicitly assumed to be
// public. It accepts ONLY the closed shape built here.
//
// PHASE 2.1 — GENERALIZED, NOT WEAKENED. This file no longer hardcodes a
// single global content-slot vocabulary (headline/body/supporting/cta) as
// the only thing any renderer may ever draw. Communications' governed
// payload still uses exactly those two (headline, body) — nothing about
// that changed. But design/templates.js's 21 EXISTING freeform Studio
// templates have their own, legitimate, template-specific public
// vocabularies (when/where/ward/callToAction/subject/etc.), already
// declared on each template as `textSlots`. Rather than force those 21
// templates into the 4-key Communications shape (explicitly ruled out —
// "do not reduce the 21 templates into the four Communications slots"),
// this file now treats EACH TEMPLATE'S OWN declared slot list — whether
// expressed as the newer `slots.content` schema or the original
// `textSlots` array — as that template's own closed allowlist. A content
// key is public if, and only if, the SELECTED TEMPLATE explicitly declares
// it. Nothing else is ever renderable, regardless of the renderer's
// generic drawing loop.
//
// THE SAFETY PROPERTY IS STRUCTURAL, NOT A FILTER, IN BOTH BUILDERS BELOW.
// Neither buildCommunicationCreativePayload() nor
// buildStudioCreativePayload() spreads a source object
// ({...communication}, {...languageVariant}, {...asset.content.text},
// {...identity} appear NOWHERE in this file). Each builder reads content
// key-by-key, and buildStudioCreativePayload() reads ONLY the keys the
// SELECTED TEMPLATE's own textSlots/slots.content already name — never
// "whatever happens to be on the asset." A field not named on the
// right-hand side of an assignment here cannot reach the payload, full
// stop — true even for a field added to a source object after this file
// was written.
//
// NO ESCAPE HATCH. There is no payload.meta / payload.raw / payload.source
// / payload.data / payload.applicationObject / payload.databaseRow
// anywhere in this shape, for either builder. A generic passthrough
// object would defeat the entire point of a CLOSED payload — this file
// has none.
//
// This module is DOM-free (src/domains/election/ boundary, see
// design/render.js's own header) and Supabase-free — it never imports a
// client, never reads a database, and is a pure function of its inputs.
// ============================================================

// The Communications-governed vocabulary — UNCHANGED from the original
// A.5.4 foundation. This is what buildCommunicationCreativePayload()'s own
// skeleton uses; it is NOT the universal set every template must live
// within (see this file's own header) — it is simply the four names
// Communications' own governed object model currently has a source for.
export const PUBLIC_CONTENT_SLOTS = Object.freeze(["headline", "body", "supporting", "cta"]);

// Visual slots are declared here so the payload SHAPE is complete and
// stable, but nothing in this phase populates them with real image data
// and render.js draws none of them — see this file's own header and
// templates.js's own "no image rendering yet" note. Declaring the shape
// now avoids a breaking payload-shape change when image support is added
// in a later A.5.4 increment.
export const PUBLIC_VISUAL_SLOTS = Object.freeze(["background", "heroImage", "secondaryImage", "logo", "accent", "icon"]);

function emptyContentFor(slotIds) {
  return Object.freeze(Object.fromEntries(slotIds.map((id) => [id, null])));
}

function emptyVisual() {
  return Object.freeze(Object.fromEntries(PUBLIC_VISUAL_SLOTS.map((id) => [id, null])));
}

/** Builds the ONLY payload shape a Communications-driven creative render
 *  may use. Destructures EXACTLY three governed fields — nothing else is
 *  ever read from `communication`, `languageVariant`, or `identity`, even
 *  if those objects carry far more (brief, created_by, status, review/
 *  approval metadata, campaign membership, database ids, etc. are simply
 *  never named below, so they cannot reach the return value):
 *
 *    headline       <- communication.title
 *    body           <- languageVariant.text
 *    identity.brand <- identity.brand (an EXPLICIT value the caller
 *                      supplies — see this file's header: never
 *                      auto-derived from campaigns.name or any other
 *                      operational field)
 *
 *  `supporting` and `cta` are left null in this foundation increment —
 *  nothing in the current Communication/language_variant object model has
 *  a governed source for them yet; inventing one here would be exactly
 *  the kind of unapproved field-mapping this file exists to prevent. */
export function buildCommunicationCreativePayload({ communication, languageVariant, identity } = {}) {
  return {
    content: { ...emptyContentFor(PUBLIC_CONTENT_SLOTS), headline: communication?.title ?? null, body: languageVariant?.text ?? null },
    visual: emptyVisual(),
    identity: { brand: identity?.brand ?? null },
  };
}

/** PHASE 2.1 — the legacy Studio adapter. Builds a payload for the
 *  freeform Campaign Studio Design-tab flow's existing 21 templates,
 *  WITHOUT reducing them to the Communications vocabulary and WITHOUT
 *  spreading `asset`/`asset.content`/`asset.content.text` into the
 *  payload.
 *
 *  The allowlist is the SELECTED TEMPLATE's own declared slots
 *  (`template.textSlots`, the exact field every one of the 21 templates
 *  already carries) — nothing else on `asset.content.text` is ever read,
 *  no matter what else that object contains. If the template declares a
 *  slot, that slot's value may enter the payload; if it does not, the
 *  value cannot, structurally, regardless of what key it was stored
 *  under on the asset (brief, created_by, reviewer_id, approver_id,
 *  status, internal_notes, an arbitrary future field — none of these are
 *  ever a declared slot on any existing template, so none can ever reach
 *  this payload through this builder).
 *
 *  `identity.brand` is, exactly as in buildCommunicationCreativePayload(),
 *  only ever the caller's own explicit value — this builder never reads
 *  `asset.content.identity` (which historically carried the now-removed
 *  automatic campaignName leak) at all. */
export function buildStudioCreativePayload({ asset, template, identity } = {}) {
  const declaredSlotIds = Array.isArray(template?.textSlots) ? template.textSlots.map((s) => s.id) : [];
  const sourceText = asset?.content?.text ?? {};
  const content = Object.fromEntries(declaredSlotIds.map((id) => [id, sourceText[id] ?? null]));
  return {
    content,
    visual: emptyVisual(),
    identity: { brand: identity?.brand ?? null },
  };
}

/** Resolves "what content slots does this template publicly declare, and
 *  which are required" for EITHER template shape this codebase has:
 *  the newer `slots.content` schema (the 3 Gate A.5.4 creative families,
 *  and communications/export.js's own internal template), or the
 *  original `textSlots` array every one of the 21 legacy Studio templates
 *  already carries. Returns null if a template declares neither — such a
 *  template has no public content model at all and cannot be validated
 *  against. Legacy `textSlots` entries are treated as non-required (this
 *  preserves EXACT existing behavior: a legacy template with an empty
 *  "when"/"where" field has always rendered fine, and validation must not
 *  newly start rejecting that). */
function templateContentSlotDefs(template) {
  if (template?.slots?.content && typeof template.slots.content === "object") return template.slots.content;
  if (Array.isArray(template?.textSlots)) {
    return Object.fromEntries(template.textSlots.map((s) => [s.id, { required: false }]));
  }
  return null;
}

const STRUCTURE_ERROR = { valid: false, error: "Creative payload is missing or malformed." };

// ============================================================
// PHASE 3 — CONSERVATIVE RENDERED-LENGTH SAFETY NET.
//
// render.js draws each present text slot top-to-bottom and, by its own
// documented design, silently clips anything that runs past the canvas's
// bottom edge rather than truncating or shrinking it. Nothing upstream
// currently bounds Communications' title/variant-text length the way
// legacy Studio's own per-slot `maxLength` inputs do, so a long enough
// real headline/body/cta could be cut off mid-word with no warning. This
// is a DELIBERATELY CONSERVATIVE character-budget estimate of render.js's
// own layout math (its font-size/line-height/margin fractions of canvas
// width, mirrored here as literal constants since render.js does not
// export them and this file must not import a renderer) — not real glyph
// metrics, because no canvas exists yet at validation time, BY DESIGN:
// this must reject before a canvas is ever created. It deliberately
// assumes narrower per-line packing than real word-wrap achieves, so it
// may occasionally refuse content that would have just barely fit — it
// must never accept content that would actually overflow. This is a
// fixed arithmetic check, not a generic schema/config framework: no new
// configuration surface, no per-template override, nothing pluggable.
const LAYOUT = Object.freeze({
  TOP_OFFSET_OF_HEIGHT: 0.12,      // render.js: y = canvas.height * 0.12
  BOTTOM_SAFETY_OF_HEIGHT: 0.04,   // conservative bottom buffer this file adds
  MAX_WIDTH_OF_WIDTH: 0.84,        // render.js: maxWidth = canvas.width * 0.84
  GAP_OF_WIDTH: 0.02,              // render.js: y += canvas.width * 0.02 after each slot
  HEADLINE: { FONT_OF_WIDTH: 0.055, LINE_OF_WIDTH: 0.065, AVG_CHAR_OF_FONT: 0.62 },
  BODY: { FONT_OF_WIDTH: 0.03, LINE_OF_WIDTH: 0.04, AVG_CHAR_OF_FONT: 0.55 },
  LINE_PACKING_EFFICIENCY: 0.85,   // real word-wrap never packs a line to exactly maxWidth
});

// square/portrait/story dimensions, duplicated deliberately from
// communications/export.js's own EXPORT_FORMATS — same precedent this
// file's own header already documents for CREATIVE_FORMAT vs
// EXPORT_FORMAT ids: design/ must not depend on communications/ (the
// reverse dependency already exists).
const FORMAT_DIMENSIONS = Object.freeze({
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
});

// Legacy Studio templates carry their own fixed `dimensions`; the 3
// approved creative families do not (their canvas size is whatever
// format the caller picks) — so dimensions come from whichever of the two
// this template/format pair actually supplies. Returns null when neither
// is available (e.g. a creative-family template validated with no
// `format`, or a legacy template with a flowing/no fixed height, such as
// EMAIL's `height: null`) — the length check is skipped entirely in that
// case rather than guessing a canvas size, matching this validator's
// existing "format is optional" philosophy for its format-compatibility
// check above.
function resolveDimensions(template, format) {
  const d = template?.dimensions;
  if (d && typeof d.width === "number" && typeof d.height === "number") return d;
  if (format && FORMAT_DIMENSIONS[format]) return FORMAT_DIMENSIONS[format];
  return null;
}

function estimatedSlotHeight(isHeadline, text, canvasWidth) {
  const role = isHeadline ? LAYOUT.HEADLINE : LAYOUT.BODY;
  const fontSize = canvasWidth * role.FONT_OF_WIDTH;
  const avgCharWidth = fontSize * role.AVG_CHAR_OF_FONT;
  const maxWidth = canvasWidth * LAYOUT.MAX_WIDTH_OF_WIDTH;
  const charsPerLine = Math.max(1, Math.floor((maxWidth / avgCharWidth) * LAYOUT.LINE_PACKING_EFFICIENCY));
  const charCount = String(text).trim().length;
  const lineCount = Math.max(1, Math.ceil(charCount / charsPerLine));
  const lineHeight = canvasWidth * role.LINE_OF_WIDTH;
  return lineCount * lineHeight + canvasWidth * LAYOUT.GAP_OF_WIDTH;
}

/** Walks `template.textSlots` in the SAME order render.js itself draws
 *  them, accumulating each present slot's estimated drawn height (a slot
 *  with no value is skipped, exactly like render.js's own `if (!value)
 *  continue`). Returns the id of the first slot whose cumulative height
 *  would run past the canvas's bottom edge, or null if everything
 *  comfortably fits. Never mutates `content`. */
function findOverflowingSlot(template, content, format) {
  const dims = resolveDimensions(template, format);
  if (!dims) return null;
  const slots = Array.isArray(template?.textSlots) ? template.textSlots : [];
  const available = dims.height * (1 - LAYOUT.TOP_OFFSET_OF_HEIGHT - LAYOUT.BOTTOM_SAFETY_OF_HEIGHT);
  let used = 0;
  for (const slot of slots) {
    const value = content[slot.id];
    if (!value) continue;
    used += estimatedSlotHeight(slot.id === "headline", value, dims.width);
    if (used > available) return slot.id;
  }
  return null;
}

/** The small runtime validator Gate A.5.4 asks for — purpose-built, not a
 *  generic schema-validation framework. Works identically for BOTH a
 *  Communications payload and a legacy Studio payload, because both
 *  resolve to the same underlying question via templateContentSlotDefs()
 *  above: "which keys does THIS template publicly declare, and which of
 *  those are required?"
 *
 *  Checked, in order: payload structure, that the template declares SOME
 *  public content model at all, template/format compatibility, required
 *  content present, and — the direct answer to "an unexpected application
 *  field cannot silently become a slot" — every key actually present in
 *  `payload.content` must be one this TEMPLATE explicitly declares (never
 *  a global fixed set, so a template cannot accidentally accept a slot it
 *  never designed for, and a legacy template's own vocabulary is neither
 *  widened nor narrowed by this check). Runs BEFORE any canvas is
 *  created — callers must call this ahead of renderTemplateToCanvas(), it
 *  is never invoked internally by the renderer itself. */
export function validateCreativePayload({ payload, template, format = null } = {}) {
  if (!payload || typeof payload !== "object") return STRUCTURE_ERROR;
  if (!payload.content || typeof payload.content !== "object") return STRUCTURE_ERROR;
  if (!payload.identity || typeof payload.identity !== "object") return STRUCTURE_ERROR;

  const slotDefs = templateContentSlotDefs(template);
  if (!slotDefs) return { valid: false, error: "This template does not declare a public content slot schema." };

  if (format && Array.isArray(template.formats) && !template.formats.includes(format)) {
    return { valid: false, error: `Template "${template.id}" does not support the "${format}" format.` };
  }

  for (const [slotId, def] of Object.entries(slotDefs)) {
    if (!def?.required) continue;
    const value = payload.content[slotId];
    if (value == null || !String(value).trim()) {
      return { valid: false, error: `Missing required content: "${slotId}".` };
    }
  }

  const allowedKeys = Object.keys(slotDefs);
  for (const key of Object.keys(payload.content)) {
    if (payload.content[key] == null) continue; // an explicit null for an unused slot is not "present"
    if (!allowedKeys.includes(key)) {
      return { valid: false, error: `"${key}" is not a recognised content slot for template "${template.id}".` };
    }
  }

  const overflowingSlot = findOverflowingSlot(template, payload.content, format);
  if (overflowingSlot) {
    const dims = resolveDimensions(template, format);
    const sizeLabel = format ?? (dims ? `${dims.width}x${dims.height}` : "its target size");
    return { valid: false, error: `"${overflowingSlot}" is too long to fit the "${sizeLabel}" format for template "${template.id}".` };
  }

  return { valid: true, error: null };
}

export default {
  PUBLIC_CONTENT_SLOTS, PUBLIC_VISUAL_SLOTS,
  buildCommunicationCreativePayload, buildStudioCreativePayload, validateCreativePayload,
};
