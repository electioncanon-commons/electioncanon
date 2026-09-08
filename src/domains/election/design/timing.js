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

// ============================================================
// GATE A.5.5.3 — REAL-TIME <-> DETERMINISTIC-FRAME BRIDGE
//
// The page layer is allowed to be real-time and nondeterministic (a
// requestAnimationFrame loop measuring actual elapsed milliseconds); the
// domain renderer (renderMotionFrameToCanvas()) must never be. These two
// functions are the ONLY place elapsed real time is ever converted into a
// frameIndex — everything downstream of that conversion (resolveProgress,
// easeOutCubic, the renderer itself) remains exactly as deterministic as
// before. Still pure: given the same arguments, always the same result;
// still generic — no template/payload/canvas knowledge, same as the rest
// of this file.
// ============================================================

/** How many discrete frames a `durationMs`-long animation at `fps` frames
 *  per second has. Always at least 1 — there is no such thing as a
 *  zero-frame animation, and a degenerate/invalid input (non-finite,
 *  zero, or negative `durationMs`/`fps`) safely resolves to 1 (a single,
 *  settled frame) rather than throwing or returning NaN. Deterministic:
 *  a pure function of its two numeric arguments. */
export function deriveTotalFrames(durationMs, fps) {
  const ms = Number(durationMs);
  const rate = Number(fps);
  if (!Number.isFinite(ms) || !Number.isFinite(rate) || ms <= 0 || rate <= 0) return 1;
  return Math.max(1, Math.round((ms / 1000) * rate));
}

/** Converts a real (page-layer-measured) `elapsedMs` into a deterministic
 *  `frameIndex` in `0..totalFrames-1` — the one bridge point between
 *  nondeterministic wall-clock time and this system's otherwise fully
 *  deterministic rendering. `totalFrames <= 1` always resolves to frame
 *  `0` (the only frame that exists). Otherwise: `loop === false` clamps
 *  at the final frame once `elapsedMs >= durationMs` (an animation that
 *  has finished stays finished, it does not run backwards or repeat);
 *  `loop === true` wraps deterministically (elapsed time past one full
 *  duration re-enters at the start), including for a negative `elapsedMs`
 *  (defensive against clock skew — never returns a negative or
 *  out-of-range index). A non-finite/invalid `durationMs` or `elapsedMs`
 *  is treated as "no time has meaningfully elapsed yet": frame `0` when
 *  looping, the final frame when not — never a crash, never NaN. */
export function frameIndexForElapsed(elapsedMs, durationMs, totalFrames, loop) {
  const total = Math.max(1, Math.floor(Number(totalFrames)) || 1);
  if (total <= 1) return 0;

  const duration = Number(durationMs);
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(elapsed)) {
    return loop ? 0 : total - 1;
  }

  const rawProgress = elapsed / duration;
  let progress;
  if (loop) {
    progress = rawProgress % 1;
    if (progress < 0) progress += 1;
  } else {
    progress = Math.min(Math.max(rawProgress, 0), 1);
  }

  return Math.min(Math.max(Math.floor(progress * (total - 1)), 0), total - 1);
}

export default { easeOutCubic, resolveProgress, deriveTotalFrames, frameIndexForElapsed };
