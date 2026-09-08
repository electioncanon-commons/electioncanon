// ============================================================
// FORGE ELECTION — MOTION CONTRACT  (Gate A.5.5.1, foundation)
//
// THE BOUNDARY THIS FILE OWNS:
//
//   CREATIVE TEMPLATE (declares which presets it supports, templates.js)
//           x
//   MOTION SPECIFICATION   <-- this file
//           x
//   PublicCreativePayload (design/creative.js — UNCHANGED by this gate;
//                           carries no motion/animation/timing field of
//                           any kind, and never will — see below)
//           |
//   (a future frame renderer — NOT this file, NOT this gate)
//
// A MotionSpecification is a SEPARATE, SIBLING value to
// PublicCreativePayload, never a field on it — passed alongside a payload
// to whatever future rendering function actually draws a frame, the same
// way `format` already travels alongside a payload into
// validateCreativePayload() today without living inside the payload
// itself. design/render.js's renderTemplateToCanvas({canvas, template,
// payload}) is UNCHANGED by this file: no frameIndex, no time, no
// motionSpec argument, no branching — it remains exactly the static,
// single-frame renderer both real callers already depend on.
//
// CLOSED PRESET VOCABULARY, NOT AN ANIMATION EDITOR. A motion preset is a
// fixed, named, code-owned recipe — never a user-composable timeline,
// keyframe array, easing function, transform matrix, or executable timing
// callback, and never references an external URL. See MOTION_PRESET below
// for why exactly these three and no more.
//
// NO DOM. NO TIMING. NO RENDERING. This file must never call
// requestAnimationFrame/setInterval/Date.now, never touch `document`/
// `window`, never create or receive a canvas, and never import
// MediaRecorder or any video API — src/domains/election/ is a
// structurally-enforced DOM-free boundary (see design/render.js's own
// header; test/election-web-adapter.consumer.mjs's F2 check already
// recursively scans this entire directory tree — this file included — for
// exactly those patterns). Any future timing loop, live preview, or
// export mechanism belongs at the page layer, exactly like render.js's
// canvasToPngBlob()/downloadBlob() split already establishes for static
// export.
//
// This module is also Supabase-free and a pure function of its
// inputs — same discipline as design/creative.js.
// ============================================================

// Deliberately the smallest set that covers three genuinely distinct
// needs, not a representative sample of the recon's larger candidate
// list:
//   fade          — a universal, always-safe default with no positional
//                    or slot-count assumptions; works even for a single
//                    line of text.
//   slideUp       — a directional single-composition entrance, for
//                    templates that want more visual emphasis than a
//                    plain fade without needing multiple slots to do it.
//   staggerLines  — a sequenced, multi-slot reveal (each declared text
//                    slot animates in turn); the one preset that only
//                    makes sense for a template with more than one
//                    meaningful text slot.
// "reveal" and "scaleIn" were considered and deliberately deferred: both
// overlap enough with fade/slideUp at this maturity stage (see the A.5.5
// recon's own §F) that adding them now would widen the vocabulary without
// adding a genuinely distinct capability, and scaleIn in particular would
// interact with Gate A.5.4's rendered-length overflow budget (design/
// creative.js) in a way this foundation increment has no need to reason
// about yet.
export const MOTION_PRESET = Object.freeze({
  FADE: "fade",
  SLIDE_UP: "slideUp",
  STAGGER_LINES: "staggerLines",
});

export const MOTION_PRESET_LIST = Object.freeze(Object.values(MOTION_PRESET));

// 24/30 only — deliberately excludes 60fps and anything user-chosen. This
// is lightweight motion graphics for a static creative composition, not
// smooth video, and a small, fixed set keeps a future export's frame
// count (and therefore its cost) bounded by construction, not by a
// runtime check someone could get wrong later.
export const MOTION_FPS_OPTIONS = Object.freeze([24, 30]);

// Conservative, fixed bounds — not a per-template or per-format override
// surface, and not user-configurable. Long enough to read a short
// headline/body sequence, short enough that no future export or live
// preview can become an open-ended, resource-consuming loop.
export const MOTION_DURATION_MS = Object.freeze({ MIN: 800, MAX: 6000 });

const STRUCTURE_ERROR = { valid: false, error: "Motion specification is missing or malformed." };

/** The small, purpose-built validator this gate asks for — same shape and
 *  philosophy as design/creative.js's validateCreativePayload(): synchronous,
 *  deterministic, DOM-free, never mutates `motionSpec` or `template`,
 *  returns an honest {valid, error} result naming the specific problem
 *  rather than a generic "invalid" message. No generic schema/config
 *  framework — this is a fixed sequence of explicit checks, not a
 *  pluggable rule engine.
 *
 *  Checked, in order: specification structure, that the TEMPLATE itself
 *  declares motion support at all (a legacy TEMPLATES entry never does —
 *  see templates.js's own CREATIVE_TEMPLATES-only motion declarations —
 *  so it fails here honestly, rather than silently accepting a fabricated
 *  preset list), that the requested preset is a member of the closed
 *  global vocabulary, that the SELECTED TEMPLATE's own declared presets
 *  include it (a template's own allowlist, exactly like
 *  validateCreativePayload()'s own content-slot allowlist), then
 *  duration/fps/loop. */
export function validateMotionSpecification({ motionSpec, template } = {}) {
  if (!motionSpec || typeof motionSpec !== "object") return STRUCTURE_ERROR;

  const supportedPresets = template?.motion?.supportedPresets;
  if (!Array.isArray(supportedPresets) || supportedPresets.length === 0) {
    return { valid: false, error: `Template "${template?.id}" does not declare motion support.` };
  }

  const { preset, durationMs, fps, loop } = motionSpec;

  if (typeof preset !== "string" || !MOTION_PRESET_LIST.includes(preset)) {
    return { valid: false, error: `"${preset}" is not a recognised motion preset.` };
  }

  if (!supportedPresets.includes(preset)) {
    return { valid: false, error: `Template "${template.id}" does not support the "${preset}" motion preset.` };
  }

  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return { valid: false, error: `"durationMs" must be a finite number.` };
  }
  if (durationMs < MOTION_DURATION_MS.MIN || durationMs > MOTION_DURATION_MS.MAX) {
    return { valid: false, error: `"durationMs" must be between ${MOTION_DURATION_MS.MIN} and ${MOTION_DURATION_MS.MAX}.` };
  }

  if (!MOTION_FPS_OPTIONS.includes(fps)) {
    return { valid: false, error: `"fps" must be one of ${MOTION_FPS_OPTIONS.join(", ")}.` };
  }

  if (typeof loop !== "boolean") {
    return { valid: false, error: `"loop" must be a boolean.` };
  }

  return { valid: true, error: null };
}

export default { MOTION_PRESET, MOTION_PRESET_LIST, MOTION_FPS_OPTIONS, MOTION_DURATION_MS, validateMotionSpecification };
