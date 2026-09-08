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
//
// GATE A.5.5.2 — SHARED LAYOUT, ONE SOURCE OF TRUTH. computeTextLayout()
// and computeBrandLine() below are a STRAIGHT EXTRACTION of exactly the
// font-size/wrapping/line-height/positioning math renderTemplateToCanvas()
// already had inline — no formula changed, only relocated. Both this
// file's static renderTemplateToCanvas() and the new
// renderMotionFrameToCanvas() call the SAME two functions to get the SAME
// canonical text positions; the only thing that differs between them is
// whether those positions are drawn at full opacity immediately (static)
// or with a per-frame opacity/offset applied first (motion). This
// extraction is proven behavior-preserving by
// test/election-motion-frame-render.consumer.mjs's static-equivalence
// section, which pins renderTemplateToCanvas()'s exact fillRect/fillText/
// fillStyle sequence for several fixtures against a baseline captured
// from this file BEFORE this extraction — not merely "the test suite
// still passes."
//
// GATE A.5.5.2 — renderMotionFrameToCanvas() is a NEW, SEPARATE function.
// renderTemplateToCanvas()'s own public signature — {canvas, template,
// payload}, no frameIndex/time/motionSpec argument, no branching on
// motion — is completely unchanged; every existing caller
// (CampaignStudioSection.jsx, communications/export.js) keeps working
// exactly as before, unaware anything was added to this file. See
// renderMotionFrameToCanvas()'s own doc comment below for its exact,
// deterministic per-preset math.
// ============================================================

import { T } from "../../../os/forge.js";
import { creativeFont } from "./typography.js";
import { MOTION_PRESET, validateMotionSpecification } from "./motion.js";
import { easeOutCubic, resolveProgress } from "./timing.js";
import { TEXT_ALIGNMENT, validateCreativeComposition } from "./composition.js";

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

// GATE A.6.7 — the ORIGINAL fixed anchor, now a LOWER BOUND, never removed.
// Dense content (a block taller than the canvas can center) still starts
// here, exactly as every render before this gate always did.
const MIN_CONTENT_TOP_OF_HEIGHT = 0.12;

/** THE single source of truth for where every text-slot line sits on the
 *  canvas. Given `ctx` (used ONLY for `measureText`'s font-metric
 *  measurement, via wrapText — exactly the same dependency-injected use
 *  `ctx` already had before this extraction; this function never creates
 *  a canvas or a context, never touches `document`/`window`, and never
 *  draws anything itself), a `template`'s own `textSlots` (walked in
 *  their declared order, identically to the pre-extraction inline loop),
 *  the payload's `content`, and a `startY` (GATE A.6.7 — previously a
 *  hardcoded `canvasHeight * 0.12` inline here; now the caller's own
 *  computeContentStartY() decides it, see that function's own header),
 *  returns a flat, ordered array of `{slotId, isHeadline, text, x, y, font,
 *  lineHeight}` — one entry per WRAPPED LINE, in draw order. A slot with no
 *  value is skipped, exactly like the original inline `if (!value)
 *  continue`. Pure: never mutates `content` or `template`, never depends on
 *  wall-clock time, returns a fresh array every call. */
function computeTextLayout({ ctx, template, content, canvasWidth, canvasHeight, startY }) {
  const marginX = canvasWidth * 0.08;
  const maxWidth = canvasWidth * 0.84;
  let y = startY;
  const lines = [];

  for (const slot of template.textSlots) {
    const value = content[slot.id];
    if (!value) continue;
    const isHeadline = slot.id === "headline";
    const font = creativeFont({ role: isHeadline ? "headline" : "body", sizePx: canvasWidth * (isHeadline ? 0.055 : 0.03) });
    const wrapped = wrapText(ctx, value, font, maxWidth);
    const lineHeight = Math.round(canvasWidth * (isHeadline ? 0.065 : 0.04));
    for (const text of wrapped) {
      lines.push({ slotId: slot.id, isHeadline, text, x: marginX, y, font, lineHeight });
      y += lineHeight;
    }
    y += canvasWidth * 0.02;
  }

  return lines;
}

/** GATE A.6.7 — BOUNDED VERTICAL CENTERING. Determines the ONE `startY`
 *  every caller of computeTextLayout() must use, so the static renderer,
 *  the motion renderer, and the composition renderer(s) always agree on
 *  where the content block begins — never a second/independent centering
 *  calculation. The content block's true rendered height is measured by
 *  calling computeTextLayout() itself with `startY: 0` (the SAME wrapping/
 *  line-height progression every renderer already uses — this never
 *  estimates or invents a new spacing constant) and reading off where its
 *  own last line actually landed. `identity.brand` is NEVER part of this
 *  measurement — computeBrandLine() anchors to the canvas's own bottom
 *  edge independently and is untouched by this function.
 *
 *  centeredY = (canvasHeight - measuredBlockHeight) / 2
 *  startY    = max(MIN_CONTENT_TOP_OF_HEIGHT * canvasHeight, centeredY)
 *
 *  Sparse content (a short block) centers. Dense content (a block taller
 *  than centering would allow while staying below the historical 12%
 *  anchor) falls back to that EXACT original anchor — content can never be
 *  centered off the top of the canvas, and existing overflow/clipping
 *  behavior for tall content is completely unaffected, since it was always
 *  measured from that same 12% starting point before this gate. */
function computeContentStartY({ ctx, template, content, canvasWidth, canvasHeight }) {
  const measured = computeTextLayout({ ctx, template, content, canvasWidth, canvasHeight, startY: 0 });
  const blockHeight = measured.length ? measured[measured.length - 1].y + measured[measured.length - 1].lineHeight : 0;
  const centeredY = (canvasHeight - blockHeight) / 2;
  const minimumY = canvasHeight * MIN_CONTENT_TOP_OF_HEIGHT;
  return Math.max(minimumY, centeredY);
}

/** The identity.brand footer credit's own layout, computed the same way
 *  as before extraction — OPT-IN ONLY, returns null when no brand value
 *  is present. Never populated automatically from campaigns.name or any
 *  other operational field — see this file's own header and design/
 *  creative.js's builder, which is the only thing allowed to decide what
 *  (if anything) this value is. */
function computeBrandLine({ canvasWidth, canvasHeight, brand }) {
  if (!brand) return null;
  return {
    slotId: "identity.brand", isHeadline: false, text: brand,
    x: canvasWidth * 0.08, y: canvasHeight - canvasWidth * 0.08,
    font: creativeFont({ role: "body", sizePx: canvasWidth * 0.024 }),
  };
}

function drawBackground(ctx, template, canvasWidth, canvasHeight) {
  ctx.fillStyle = COLOUR_TOKEN[template.background?.token] ?? T.teal;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
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
 *  overflow behavior is introduced here.
 *
 *  GATE A.5.5.2 — now a thin wrapper around the shared layout functions
 *  above, drawing every line at full opacity, in order, with no
 *  frame/time concept of any kind. Its own signature and drawn output are
 *  unchanged — see test/election-motion-frame-render.consumer.mjs's
 *  static-equivalence section for the explicit proof. */
export function renderTemplateToCanvas({ canvas, template, payload = {} }) {
  const content = payload.content ?? {};
  const identity = payload.identity ?? {};
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, template, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";

  const startY = computeContentStartY({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height });
  const lines = computeTextLayout({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height, startY });
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillText(line.text, line.x, line.y);
  }

  const brandLine = computeBrandLine({ canvasWidth: canvas.width, canvasHeight: canvas.height, brand: identity.brand });
  if (brandLine) {
    ctx.font = brandLine.font;
    ctx.fillText(brandLine.text, brandLine.x, brandLine.y);
  }
}

// ============================================================
// GATE A.6.1 — CREATIVE COMPOSITION RENDERER
//
// Additive, not a replacement: renderTemplateToCanvas() above is UNCHANGED
// by this gate, byte-for-byte — every existing caller (CampaignStudioSection
// .jsx, communications/export.js) keeps calling it exactly as before,
// unaware this function exists. renderCompositionToCanvas() is a NEW,
// SEPARATE function for the new design/composition.js seam.
//
// Reuses the SAME computeTextLayout()/computeBrandLine()/drawBackground()
// this file's own static renderer already uses — no second layout
// algorithm, no duplicated positioning math. The ONLY thing a
// CreativeComposition can change is a text element's horizontal (x)
// placement, via its own closed `alignment` property — wrapping, font,
// vertical position, background, and brand are exactly what
// renderTemplateToCanvas() already produces, always. With every element at
// its default `alignment: "left"` (design/composition.js's own
// defaultCompositionFor()'s own default), this function's drawing
// operations are byte-identical to renderTemplateToCanvas()'s own — proven
// by test/election-creative-composition.consumer.mjs's explicit equivalence
// assertions, the same discipline Gate A.5.5.2's own static-equivalence
// section already established for renderMotionFrameToCanvas().
//
// Defends itself (validates internally, throws on an invalid composition)
// rather than trusting an already-validated caller — the same deliberate
// departure from renderTemplateToCanvas()'s "trust the payload" convention
// renderMotionFrameToCanvas() below already takes, for the same reason: a
// composition picks an actual different code path here (which alignment
// applies to which element), so it must defend that path itself.
// ============================================================

/** Draws a template's text slots — arranged per `composition`'s own closed,
 *  governed per-element `alignment` — plus the same opt-in identity.brand
 *  footer renderTemplateToCanvas() already draws. See this section's own
 *  header for the exact equivalence guarantee. */
export function renderCompositionToCanvas({ canvas, template, payload = {}, composition }) {
  const validation = validateCreativeComposition({ composition, template });
  if (!validation.valid) {
    throw new Error(`renderCompositionToCanvas: ${validation.error}`);
  }

  const content = payload.content ?? {};
  const identity = payload.identity ?? {};
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, template, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";

  const alignmentByRole = Object.fromEntries(composition.elements.map((el) => [el.role, el.properties.alignment]));
  const startY = computeContentStartY({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height });
  const lines = computeTextLayout({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height, startY });
  for (const line of lines) {
    ctx.font = line.font;
    const alignment = alignmentByRole[line.slotId] ?? TEXT_ALIGNMENT.LEFT;
    const x = alignment === TEXT_ALIGNMENT.CENTER ? (canvas.width - ctx.measureText(line.text).width) / 2 : line.x;
    ctx.fillText(line.text, x, line.y);
  }

  const brandLine = computeBrandLine({ canvasWidth: canvas.width, canvasHeight: canvas.height, brand: identity.brand });
  if (brandLine) {
    ctx.font = brandLine.font;
    ctx.fillText(brandLine.text, brandLine.x, brandLine.y);
  }
}

// ============================================================
// GATE A.6.3 — ELEMENT SELECTION GEOMETRY
//
// The SAME geometry computeTextLayout() already computes for drawing —
// reused, never recomputed. This is the smallest additive API needed for
// viewport click-selection: it calls the existing private
// computeTextLayout() exactly once and only AGGREGATES its per-line output
// into one bounding box per element (per declared text slot), never
// reimplements wrapping, font sizing, or positioning. No second layout
// calculation exists anywhere in this file.
//
// Deliberately generous/simple boxes: x/width always span the SAME text
// column computeTextLayout() itself wraps within (marginX..maxWidth),
// regardless of a text element's own alignment — so a selection target
// stays valid and stable even if design/composition.js changes that
// element's horizontal alignment later; only the vertical span (y..bottom)
// is derived from where that slot's own lines actually landed. Page-layer
// callers turn these into DOM overlay hit targets — this function itself
// draws nothing and never touches document/window.
// ============================================================

/** Returns one `{role, x, y, width, height}` bounding box per PRESENT text
 *  element (one per declared textSlot with a non-empty value), in canvas-
 *  pixel space, derived entirely from computeTextLayout()'s own per-line
 *  output — never a duplicated layout pass. `canvas` is read only for its
 *  `width`/`height`/`getContext()` — the exact same shape every other
 *  exported function in this file already accepts. */
export function computeElementSelectionBounds({ canvas, template, content = {} }) {
  const ctx = canvas.getContext("2d");
  const marginX = canvas.width * 0.08;
  const maxWidth = canvas.width * 0.84;
  const startY = computeContentStartY({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height });
  const lines = computeTextLayout({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height, startY });

  const boundsByRole = new Map();
  for (const line of lines) {
    const bottom = line.y + line.lineHeight;
    const existing = boundsByRole.get(line.slotId);
    if (!existing) boundsByRole.set(line.slotId, { role: line.slotId, top: line.y, bottom });
    else existing.bottom = Math.max(existing.bottom, bottom);
  }

  return Array.from(boundsByRole.values()).map((b) => ({
    role: b.role, x: marginX, y: b.top, width: maxWidth, height: b.bottom - b.top,
  }));
}

// ============================================================
// GATE A.5.5.2 — DETERMINISTIC MOTION FRAME RENDERER
//
// The easing curve and frame-position resolution (easeOutCubic,
// resolveProgress) live in design/timing.js — a tiny, generic, DOM-free
// utility module shared with any future consumer of the same math (see
// that file's own header), rather than duplicated or exported ad hoc
// from this file. Nothing about their behavior changed in that
// extraction — see test/election-motion-timing.consumer.mjs for the
// isolated proof, and this file's own static/motion-equivalence tests
// for proof that moving them did not change a single rendered frame.
//
// Bounded, fixed — not configurable by a preset, a template, or a caller.
const SLIDE_OFFSET_OF_WIDTH = 0.05;

/** Returns this LINE's {alpha, yOffset} for the given global `progress`
 *  (see resolveProgress()) and preset. Exactly the 3 approved presets are
 *  handled; anything else is unreachable because
 *  validateMotionSpecification() has already refused it before this
 *  function is ever called (see renderMotionFrameToCanvas() below) — the
 *  fallback branch exists only so this internal helper never throws if
 *  ever called directly.
 *
 *  FADE — affects every content line uniformly: alpha eases 0 -> 1 across
 *  the WHOLE progress range; no position change at all.
 *
 *  SLIDE_UP — affects every content line uniformly: alpha eases 0 -> 1
 *  exactly like fade, AND each line's y is offset by
 *  `(1 - eased) * canvasWidth * SLIDE_OFFSET_OF_WIDTH` — i.e. it starts
 *  displaced BELOW (larger y = lower on screen) its canonical layout
 *  position and eases up into that exact position as progress
 *  approaches 1, never overshooting or moving past it.
 *
 *  STAGGER_LINES — affects each PRESENT TEXT SLOT (not each individual
 *  wrapped line within a slot — every wrapped line of ONE slot shares
 *  that slot's own reveal) in the SAME order render.js's own layout
 *  already draws them in (template.textSlots order, filtered to slots
 *  with a value). The [0,1] progress range is divided into
 *  `presentSlotIds.length` EQUAL, sequential, non-overlapping windows;
 *  a slot's own local progress is 0 before its window starts and 1 once
 *  its window ends, eased the same way; no position offset — a pure,
 *  sequenced opacity reveal.
 *
 *  In every preset: the BACKGROUND is always drawn at full, immediate
 *  opacity (see renderMotionFrameToCanvas() — drawBackground() is called
 *  before any progress-dependent state exists) — it is never animated.
 *  identity.brand NEVER receives a preset-specific position/stagger
 *  treatment at all — see renderMotionFrameToCanvas()'s own brand
 *  handling: it always uses a plain, preset-independent full-range fade. */
function motionStateForLine({ preset, progress, slotId, presentSlotIds }, canvasWidth) {
  if (preset === MOTION_PRESET.FADE) {
    return { alpha: easeOutCubic(progress), yOffset: 0 };
  }
  if (preset === MOTION_PRESET.SLIDE_UP) {
    const eased = easeOutCubic(progress);
    return { alpha: eased, yOffset: (1 - eased) * canvasWidth * SLIDE_OFFSET_OF_WIDTH };
  }
  if (preset === MOTION_PRESET.STAGGER_LINES) {
    const count = presentSlotIds.length || 1;
    const index = Math.max(presentSlotIds.indexOf(slotId), 0);
    const windowSize = 1 / count;
    const start = index * windowSize;
    const local = Math.min(Math.max((progress - start) / windowSize, 0), 1);
    return { alpha: easeOutCubic(local), yOffset: 0 };
  }
  return { alpha: 1, yOffset: 0 };
}

/** Draws exactly ONE deterministic frame of a template's motion-governed
 *  composition. Same inputs (`template`, `payload`, `motionSpec`,
 *  `frameIndex`, `totalFrames`) ALWAYS produce the same sequence of
 *  drawing operations — no `Date.now()`, no `requestAnimationFrame`, no
 *  wall-clock reference anywhere in this function or anything it calls.
 *
 *  Refuses (throws) rather than silently drawing anything if `motionSpec`
 *  is malformed, names an unrecognised preset, or names a preset the
 *  SELECTED `template` does not declare support for — the exact same
 *  `validateMotionSpecification()` design/motion.js's own consumer tests
 *  already exercise; this function does not re-implement or loosen that
 *  check. This differs deliberately from renderTemplateToCanvas()'s own
 *  "trust an already-validated payload" convention: a motion preset picks
 *  an actual different code path here, so this function defends itself
 *  rather than trusting a caller that might not have validated at all.
 *
 *  `frameIndex`/`totalFrames` are NOT part of the governed contract (see
 *  resolveProgress()) and are therefore clamped, never thrown on. */
export function renderMotionFrameToCanvas({ canvas, template, payload = {}, motionSpec, frameIndex, totalFrames }) {
  const validation = validateMotionSpecification({ motionSpec, template });
  if (!validation.valid) {
    throw new Error(`renderMotionFrameToCanvas: ${validation.error}`);
  }

  const content = payload.content ?? {};
  const identity = payload.identity ?? {};
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, template, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";

  const progress = resolveProgress(frameIndex, totalFrames);
  const startY = computeContentStartY({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height });
  const lines = computeTextLayout({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height, startY });
  const presentSlotIds = [];
  for (const line of lines) if (!presentSlotIds.includes(line.slotId)) presentSlotIds.push(line.slotId);

  for (const line of lines) {
    const { alpha, yOffset } = motionStateForLine({ preset: motionSpec.preset, progress, slotId: line.slotId, presentSlotIds }, canvas.width);
    ctx.globalAlpha = alpha;
    ctx.font = line.font;
    ctx.fillText(line.text, line.x, line.y + yOffset);
  }
  ctx.globalAlpha = 1;

  const brandLine = computeBrandLine({ canvasWidth: canvas.width, canvasHeight: canvas.height, brand: identity.brand });
  if (brandLine) {
    // Preset-independent, deliberately: the footer credit always simply
    // fades in over the full progress range, regardless of whether the
    // main content is fading, sliding, or staggering — see this
    // function's own doc comment.
    ctx.globalAlpha = easeOutCubic(progress);
    ctx.font = brandLine.font;
    ctx.fillText(brandLine.text, brandLine.x, brandLine.y);
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// GATE A.6.5 — UNIFIED STATIC/MOTION COMPOSITION PIPELINE
//
// The exact same relationship renderCompositionToCanvas() already has to
// renderTemplateToCanvas() above: additive, not a replacement.
// renderMotionFrameToCanvas() is UNCHANGED by this gate — every existing
// caller keeps working exactly as before. renderCompositionMotionFrameToCanvas()
// is a NEW, separate function reusing the SAME motionStateForLine()/
// computeTextLayout()/computeBrandLine()/drawBackground() this file's
// existing motion renderer already uses — the only addition is applying a
// composition element's own closed `alignment` property to that element's
// x, exactly the same branch renderCompositionToCanvas() already applies
// for the static case. At progress 1 (the settled frame — see
// design/timing.js's own resolveProgress(), which totalFrames<=1
// unconditionally resolves to), every preset's alpha is 1 and every
// yOffset is 0, so this function's output at that frame is byte-identical
// to renderCompositionToCanvas()'s own — proven by test/
// election-creative-composition.consumer.mjs's explicit equivalence
// assertions, the invariant Gate A.6.5 exists to guarantee: the same
// template + payload + composition always produces the same settled
// image, whether reached via the static or the motion path.
// ============================================================

/** The composition-aware counterpart to renderMotionFrameToCanvas() above —
 *  same deterministic-frame contract, same defensive internal validation
 *  (of BOTH motionSpec and composition), with one addition: each text
 *  element's horizontal placement follows `composition`'s own closed
 *  per-element `alignment`, exactly like renderCompositionToCanvas()'s own
 *  static case. */
export function renderCompositionMotionFrameToCanvas({ canvas, template, payload = {}, composition, motionSpec, frameIndex, totalFrames }) {
  const motionValidation = validateMotionSpecification({ motionSpec, template });
  if (!motionValidation.valid) {
    throw new Error(`renderCompositionMotionFrameToCanvas: ${motionValidation.error}`);
  }
  const compositionValidation = validateCreativeComposition({ composition, template });
  if (!compositionValidation.valid) {
    throw new Error(`renderCompositionMotionFrameToCanvas: ${compositionValidation.error}`);
  }

  const content = payload.content ?? {};
  const identity = payload.identity ?? {};
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, template, canvas.width, canvas.height);

  ctx.fillStyle = T.black;
  ctx.textBaseline = "top";

  const progress = resolveProgress(frameIndex, totalFrames);
  const alignmentByRole = Object.fromEntries(composition.elements.map((el) => [el.role, el.properties.alignment]));
  const startY = computeContentStartY({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height });
  const lines = computeTextLayout({ ctx, template, content, canvasWidth: canvas.width, canvasHeight: canvas.height, startY });
  const presentSlotIds = [];
  for (const line of lines) if (!presentSlotIds.includes(line.slotId)) presentSlotIds.push(line.slotId);

  for (const line of lines) {
    const { alpha, yOffset } = motionStateForLine({ preset: motionSpec.preset, progress, slotId: line.slotId, presentSlotIds }, canvas.width);
    ctx.globalAlpha = alpha;
    ctx.font = line.font;
    const alignment = alignmentByRole[line.slotId] ?? TEXT_ALIGNMENT.LEFT;
    const x = alignment === TEXT_ALIGNMENT.CENTER ? (canvas.width - ctx.measureText(line.text).width) / 2 : line.x;
    ctx.fillText(line.text, x, line.y + yOffset);
  }
  ctx.globalAlpha = 1;

  const brandLine = computeBrandLine({ canvasWidth: canvas.width, canvasHeight: canvas.height, brand: identity.brand });
  if (brandLine) {
    ctx.globalAlpha = easeOutCubic(progress);
    ctx.font = brandLine.font;
    ctx.fillText(brandLine.text, brandLine.x, brandLine.y);
    ctx.globalAlpha = 1;
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

export default {
  renderTemplateToCanvas, renderMotionFrameToCanvas, canvasToPngBlob,
  renderCompositionToCanvas, computeElementSelectionBounds, renderCompositionMotionFrameToCanvas,
};
