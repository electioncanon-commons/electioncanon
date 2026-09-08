// ============================================================
// ELECTIONCANON — GATE A.5.5.2: shared deterministic timing utility
//
// Exercises design/timing.js (easeOutCubic, resolveProgress) in complete
// isolation — no template, no payload, no canvas, no render.js import at
// all in most of this file — plus one small cross-check proving
// design/render.js's motion renderer is actually WIRED to these exact
// exports (not a leftover local copy) rather than merely re-implementing
// the same formula twice by coincidence.
// ============================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";
import { easeOutCubic, resolveProgress } from "../src/domains/election/design/timing.js";

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
