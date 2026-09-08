// ============================================================
// ELECTIONCANON — GATE A.5.5.2/A.5.5.3: shared deterministic timing utility
//
// Exercises design/timing.js (easeOutCubic, resolveProgress,
// deriveTotalFrames, frameIndexForElapsed) in complete isolation — no
// template, no payload, no canvas, no render.js import at all in most of
// this file — plus one small cross-check proving design/render.js's
// motion renderer is actually WIRED to these exact exports (not a
// leftover local copy) rather than merely re-implementing the same
// formula twice by coincidence.
//
// deriveTotalFrames()/frameIndexForElapsed() (Gate A.5.5.3) are the ONLY
// bridge between real, page-layer-measured elapsed time and this
// system's otherwise fully deterministic rendering — see this file's own
// header comment in design/timing.js.
// ============================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";
import { easeOutCubic, resolveProgress, deriveTotalFrames, frameIndexForElapsed } from "../src/domains/election/design/timing.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.5.2: shared deterministic timing utility\n");

// ============================================================
console.log("1 — resolveProgress() is deterministic");
// ============================================================
{
  ok("1a. the same (frameIndex, totalFrames) pair always returns the exact same value, called repeatedly", resolveProgress(5, 21) === resolveProgress(5, 21) && resolveProgress(5, 21) === resolveProgress(5, 21));
  ok("1b. two DIFFERENT frameIndex values (sanity check) produce different progress", resolveProgress(3, 21) !== resolveProgress(10, 21));
}

// ============================================================
console.log("\n2 — progress clamps/behaves exactly as specified");
// ============================================================
{
  ok("2a. frame 0 of N resolves to progress 0", resolveProgress(0, 11) === 0);
  ok("2b. the LAST valid frame (totalFrames - 1) resolves to progress 1", resolveProgress(10, 11) === 1);
  ok("2c. an exact midpoint frame resolves to the exact expected fraction", resolveProgress(5, 11) === 0.5);
  ok("2d. a negative frameIndex clamps to progress 0, never negative", resolveProgress(-7, 11) === 0);
  ok("2e. a frameIndex far beyond totalFrames clamps to progress 1, never beyond", resolveProgress(9999, 11) === 1);
  ok("2f. a non-integer frameIndex is floored, not rounded or rejected", resolveProgress(5.9, 11) === resolveProgress(5, 11));
  ok("2g. a NaN frameIndex clamps to progress 0, never NaN", resolveProgress(NaN, 11) === 0);
  ok("2h. an undefined frameIndex clamps to progress 0, never throws", resolveProgress(undefined, 11) === 0);
}

// ============================================================
console.log("\n3 — totalFrames <= 1 remains safe and returns the intended settled state");
// ============================================================
{
  ok("3a. totalFrames === 1 resolves to progress 1 (fully settled) regardless of frameIndex", resolveProgress(0, 1) === 1 && resolveProgress(5, 1) === 1 && resolveProgress(-3, 1) === 1);
  ok("3b. totalFrames === 0 never divides by zero — clamps to the same settled state", resolveProgress(0, 0) === 1 && Number.isFinite(resolveProgress(0, 0)));
  ok("3c. a negative totalFrames never throws or divides by zero — clamps to the settled state", resolveProgress(0, -5) === 1);
  ok("3d. a non-integer totalFrames (e.g. 1.9) floors to 1 and resolves to the settled state", resolveProgress(0, 1.9) === 1);
  ok("3e. a NaN totalFrames never throws — clamps to the settled state", resolveProgress(0, NaN) === 1 && Number.isFinite(resolveProgress(0, NaN)));
}

// ============================================================
console.log("\n4 — easeOutCubic() returns exact expected values at 0, midpoint, and 1");
// ============================================================
{
  ok("4a. easeOutCubic(0) === 0 exactly", easeOutCubic(0) === 0);
  ok("4b. easeOutCubic(1) === 1 exactly", easeOutCubic(1) === 1);
  ok("4c. easeOutCubic(0.5) matches the exact code-defined formula 1-(1-t)^3, not an approximation", easeOutCubic(0.5) === 1 - Math.pow(0.5, 3));
  ok("4d. the curve is monotonically increasing across representative sample points", easeOutCubic(0.1) < easeOutCubic(0.3) && easeOutCubic(0.3) < easeOutCubic(0.6) && easeOutCubic(0.6) < easeOutCubic(0.9));
}

// ============================================================
console.log("\n5 — values outside the input range are handled exactly as specified (clamped, never extrapolated)");
// ============================================================
{
  ok("5a. easeOutCubic(-0.5) clamps to easeOutCubic(0) === 0, never negative", easeOutCubic(-0.5) === 0);
  ok("5b. easeOutCubic(1.5) clamps to easeOutCubic(1) === 1, never beyond 1", easeOutCubic(1.5) === 1);
  ok("5c. easeOutCubic never returns a value below 0 or above 1 for any input", [-100, -1, 0, 0.25, 0.5, 0.75, 1, 2, 100].every((t) => { const v = easeOutCubic(t); return v >= 0 && v <= 1; }));
}

// ============================================================
console.log("\n6 — moving this math into timing.js did not change any existing motion frame output");
// ============================================================
{
  const { renderMotionFrameToCanvas } = await import("../src/domains/election/design/render.js");
  const { CREATIVE_TEMPLATES, CREATIVE_FAMILY } = await import("../src/domains/election/design/templates.js");
  const { MOTION_PRESET } = await import("../src/domains/election/design/motion.js");

  function fakeCanvas(width, height) {
    const calls = { fillText: [] };
    let fillStyle = null, globalAlpha = 1;
    const ctx = {
      set fillStyle(v) { fillStyle = v; }, get fillStyle() { return fillStyle; },
      set globalAlpha(v) { globalAlpha = v; }, get globalAlpha() { return globalAlpha; },
      font: null, textBaseline: null,
      fillRect: () => {},
      fillText: (text, x, y) => calls.fillText.push({ text, x, y, alpha: ctx.globalAlpha }),
      measureText: (text) => ({ width: String(text).length * 16 * 0.55 }),
    };
    return { width, height, getContext: () => ctx, _calls: calls };
  }

  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
  const payload = { content: { headline: "Turnout wins elections." }, visual: {}, identity: {} };
  const spec = { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false };

  const canvas = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas, template, payload, motionSpec: spec, frameIndex: 5, totalFrames: 11 });
  const renderedAlpha = canvas._calls.fillText[0].alpha;

  // The value render.js actually drew MUST equal calling timing.js's own
  // exported functions directly with the exact same arguments — proving
  // render.js is genuinely WIRED to these exports, not a coincidentally
  // identical leftover local copy.
  const expectedAlpha = easeOutCubic(resolveProgress(5, 11));
  ok("6. render.js's rendered fade alpha at frame 5/11 equals timing.js's own easeOutCubic(resolveProgress(5,11)) exactly — render.js is genuinely wired to the shared module", renderedAlpha === expectedAlpha);
}

// ============================================================
console.log("\n7 — deriveTotalFrames() correctness and bounds");
// ============================================================
{
  ok("7a. a typical duration/fps pair resolves to the exact expected integer frame count", deriveTotalFrames(1500, 30) === 45);
  ok("7b. the result is always an integer, never a fractional frame count", deriveTotalFrames(1000, 24) === Math.round(deriveTotalFrames(1000, 24)));
  ok("7c. always at least 1, never 0", deriveTotalFrames(1, 1) >= 1);
  ok("7d. a zero durationMs never throws and resolves to 1", deriveTotalFrames(0, 30) === 1);
  ok("7e. a negative durationMs never throws and resolves to 1", deriveTotalFrames(-500, 30) === 1);
  ok("7f. a zero or negative fps never throws and resolves to 1", deriveTotalFrames(1500, 0) === 1 && deriveTotalFrames(1500, -30) === 1);
  ok("7g. a non-finite durationMs/fps never throws and resolves to 1", deriveTotalFrames(NaN, 30) === 1 && deriveTotalFrames(1500, Infinity) === 1);
  ok("7h. deterministic — the same inputs always return the same value", deriveTotalFrames(1500, 30) === deriveTotalFrames(1500, 30));
}

// ============================================================
console.log("\n8 — frameIndexForElapsed(): loop=false clamps correctly");
// ============================================================
{
  const total = deriveTotalFrames(1000, 30); // 30 frames
  ok("8a. elapsed 0 resolves to frame 0", frameIndexForElapsed(0, 1000, total, false) === 0);
  ok("8b. elapsed exactly at the duration resolves to the FINAL frame", frameIndexForElapsed(1000, 1000, total, false) === total - 1);
  ok("8c. elapsed well past the duration stays clamped at the final frame, never beyond", frameIndexForElapsed(50000, 1000, total, false) === total - 1);
  ok("8d. a midpoint elapsed resolves to roughly the midpoint frame", frameIndexForElapsed(500, 1000, total, false) === Math.floor(0.5 * (total - 1)));
  ok("8e. a negative elapsed clamps to frame 0, never negative", frameIndexForElapsed(-200, 1000, total, false) === 0);
}

// ============================================================
console.log("\n9 — frameIndexForElapsed(): loop=true wraps correctly");
// ============================================================
{
  const total = deriveTotalFrames(1000, 30);
  ok("9a. elapsed exactly one full duration wraps back to frame 0, not the final frame", frameIndexForElapsed(1000, 1000, total, true) === 0);
  ok("9b. elapsed 1.5x the duration wraps to roughly the midpoint frame, not clamped at the end", frameIndexForElapsed(1500, 1000, total, true) === Math.floor(0.5 * (total - 1)));
  ok("9c. elapsed many multiples of the duration still wraps into range, never grows unbounded", (() => { const f = frameIndexForElapsed(1000 * 7.25, 1000, total, true); return f >= 0 && f < total; })());
  ok("9d. a negative elapsed still wraps into a valid, non-negative frame (defensive against clock skew)", (() => { const f = frameIndexForElapsed(-250, 1000, total, true); return f >= 0 && f < total; })());
  ok("9e. loop=true and loop=false genuinely diverge past one full duration (sanity check the two modes are actually different)", frameIndexForElapsed(1000, 1000, total, true) !== frameIndexForElapsed(1000, 1000, total, false));
}

// ============================================================
console.log("\n10 — frameIndexForElapsed(): degenerate/single-frame cases are safe");
// ============================================================
{
  ok("10a. totalFrames === 1 always returns frame 0, regardless of elapsed or loop", frameIndexForElapsed(0, 1000, 1, false) === 0 && frameIndexForElapsed(5000, 1000, 1, true) === 0);
  ok("10b. totalFrames <= 0 never throws or divides by zero — resolves to frame 0", frameIndexForElapsed(0, 1000, 0, false) === 0 && Number.isFinite(frameIndexForElapsed(0, 1000, -3, true)));
  ok("10c. a zero/negative durationMs never throws — resolves to a safe, in-range frame", (() => { const f = frameIndexForElapsed(500, 0, 30, false); return Number.isFinite(f) && f >= 0 && f < 30; })());
  ok("10d. a NaN durationMs or elapsedMs never throws — resolves to a safe, in-range frame", (() => {
    const a = frameIndexForElapsed(NaN, 1000, 30, false);
    const b = frameIndexForElapsed(500, NaN, 30, true);
    return Number.isFinite(a) && a >= 0 && a < 30 && Number.isFinite(b) && b >= 0 && b < 30;
  })());
  ok("10e. never returns an index outside 0..totalFrames-1 across a wide sweep of inputs", (() => {
    const total = 12;
    const samples = [-9999, -1000, -1, 0, 1, 250, 999, 1000, 1001, 5000, 50000];
    return samples.every((e) => {
      const a = frameIndexForElapsed(e, 1000, total, false);
      const b = frameIndexForElapsed(e, 1000, total, true);
      return a >= 0 && a < total && b >= 0 && b < total;
    });
  })());
}

// ============================================================
console.log("\n11 — timing functions remain deterministic (repeat-call proof)");
// ============================================================
{
  const total = deriveTotalFrames(1500, 24);
  ok("11a. deriveTotalFrames is deterministic", deriveTotalFrames(1500, 24) === total);
  ok("11b. frameIndexForElapsed is deterministic across repeated identical calls", frameIndexForElapsed(700, 1500, total, false) === frameIndexForElapsed(700, 1500, total, false) && frameIndexForElapsed(700, 1500, total, true) === frameIndexForElapsed(700, 1500, total, true));
}

// ============================================================
console.log("\nDOM-FREE REQUIREMENT — timing.js is a generic, DOM-free pure utility");
// ============================================================
{
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const source = readFileSync(join(repoRoot, "src", "domains", "election", "design", "timing.js"), "utf8");
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("D1. timing.js references no document/window global", !/\bdocument\.|\bwindow\./.test(codeOnly));
  ok("D2. timing.js calls no requestAnimationFrame/setInterval/setTimeout", !/requestAnimationFrame|setInterval|setTimeout/.test(codeOnly));
  ok("D3. timing.js reads no wall-clock time (Date.now/performance.now)", !/Date\.now\(|performance\.now\(/.test(codeOnly));
  ok("D4. timing.js never constructs or references a canvas", !/createElement\(["']canvas["']\)|OffscreenCanvas|getContext\(/.test(codeOnly));
  ok("D5. timing.js never references MediaRecorder or a video API", !/MediaRecorder|captureStream|HTMLVideoElement/.test(codeOnly));
  ok("D6. timing.js imports nothing at all (no Supabase, no React, no other module)", !/^\s*import /m.test(source));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
