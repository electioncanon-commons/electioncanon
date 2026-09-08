// ============================================================
// FORGE ELECTION — DETERMINISTIC TIMING MATHEMATICS  (Gate A.5.5.2)
//
// Pure, generic, deterministic frame-position math — extracted from
// design/render.js's own renderMotionFrameToCanvas() so a future
// consumer (the A.5.5 architecture review's own artifact-readiness audit
// specifically anticipated a future ambient-artifact motion layer) can
// share the SAME progress/easing math without duplicating it — exactly
// the "one source of truth" discipline this gate already applies to text
// layout (render.js's computeTextLayout()). Unlike the format-table
// duplication precedent elsewhere in this codebase (design/templates.js
// vs communications/export.js, deliberately duplicated to avoid a
// cross-layer dependency), this math has no reason to ever differ
// between two consumers, so it is shared here rather than copied.
//
// GENERIC ONLY. This file knows nothing about text, slots, templates,
// payloads, presets, or canvases — it is a pure function of a frame
// position, nothing else. It must NEVER contain: DOM access, a canvas
// reference, React, Supabase, requestAnimationFrame, MediaRecorder,
// Date.now()/performance.now(), setInterval/setTimeout, an animation-
// preset vocabulary, a template definition, or payload logic — any of
// that belongs in design/render.js (drawing), design/motion.js (the
// closed preset contract), or the page layer (real timing loops), never
// here. Not a generic animation framework: exactly two small, fixed
// helpers, nothing pluggable, nothing configurable beyond their own
// plain numeric arguments.
// ============================================================

/** A single, code-owned, deterministic easing curve — never a per-call,
 *  per-preset, or user-supplied function. Pure: `t` in, a number in
 *  [0,1] out, nothing else. Inputs outside [0,1] are clamped, never
 *  extrapolated — an eased value is never negative or greater than 1. */
export function easeOutCubic(t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

/** Resolves a frame-loop's mechanical position — `frameIndex` of
 *  `totalFrames` — into a single [0,1] progress value. `frameIndex`/
 *  `totalFrames` are NOT part of any governed contract (design/motion.js
 *  validates preset/durationMs/fps/loop; it says nothing about "which
 *  frame"), so malformed values here are CLAMPED to a safe, sensible
 *  state rather than thrown on — never a crash, never NaN, never a
 *  divide-by-zero. A single requested frame (`totalFrames <= 1`, after
 *  clamping) deterministically resolves to progress `1` — the fully-
 *  settled, final state — since no partial reveal is meaningful for a
 *  one-frame render. */
export function resolveProgress(frameIndex, totalFrames) {
  const total = Math.max(1, Math.floor(Number(totalFrames)) || 1);
  if (total <= 1) return 1;
  const rawFrame = Math.floor(Number(frameIndex));
  const frame = Number.isFinite(rawFrame) ? Math.min(Math.max(rawFrame, 0), total - 1) : 0;
  return frame / (total - 1);
}

export default { easeOutCubic, resolveProgress };
