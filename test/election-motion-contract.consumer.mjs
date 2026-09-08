// ============================================================
// ELECTIONCANON — GATE A.5.5.1: motion contract foundation
//
// Exercises design/motion.js (MOTION_PRESET, MOTION_PRESET_LIST,
// MOTION_FPS_OPTIONS, MOTION_DURATION_MS, validateMotionSpecification)
// and design/templates.js's new per-family `motion.supportedPresets`
// declarations directly, with no live database, no canvas, no DOM — same
// discipline as every other consumer test in this suite.
//
// This file proves the contract (schema + validator) is sound BEFORE any
// frame renderer, live preview, or export mechanism exists — exactly the
// A.5.5.1 scope: contract and validation only, nothing here renders a
// pixel or advances a clock.
// ============================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";
import {
  MOTION_PRESET, MOTION_PRESET_LIST, MOTION_FPS_OPTIONS, MOTION_DURATION_MS,
  validateMotionSpecification,
} from "../src/domains/election/design/motion.js";
import { TEMPLATES, TEMPLATE_LIST, ASSET_TYPE, CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_TEMPLATE_LIST } from "../src/domains/election/design/templates.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.5.1: motion contract foundation\n");

function validSpecFor(template) {
  const preset = template.motion.supportedPresets[0];
  return { preset, durationMs: 1500, fps: 30, loop: false };
}

// ============================================================
console.log("1 — valid specifications pass");
// ============================================================
{
  for (const family of Object.values(CREATIVE_FAMILY)) {
    const template = CREATIVE_TEMPLATES[family];
    for (const preset of template.motion.supportedPresets) {
      const spec = { preset, durationMs: 1200, fps: 24, loop: false };
      const result = validateMotionSpecification({ motionSpec: spec, template });
      ok(`1. ${family} x ${preset}: a valid specification passes`, result.valid && !result.error);
    }
  }
  const looping = { preset: MOTION_PRESET.FADE, durationMs: MOTION_DURATION_MS.MIN, fps: 30, loop: true };
  ok("1b. loop:true is a valid value, not just loop:false", validateMotionSpecification({ motionSpec: looping, template: CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT] }).valid);
}

// ============================================================
console.log("\n2 — unknown presets fail");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  const spec = { preset: "zoomWhirlSpin", durationMs: 1500, fps: 30, loop: false };
  const result = validateMotionSpecification({ motionSpec: spec, template });
  ok("2a. an unrecognised preset is rejected", !result.valid);
  ok("2b. the rejection names the offending preset", /zoomWhirlSpin/.test(result.error));

  const numericPreset = { preset: 5, durationMs: 1500, fps: 30, loop: false };
  ok("2c. a non-string preset is rejected, not coerced", !validateMotionSpecification({ motionSpec: numericPreset, template }).valid);
}

// ============================================================
console.log("\n3/4 — invalid and out-of-range duration fail");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  const validPreset = template.motion.supportedPresets[0];

  const notANumber = { preset: validPreset, durationMs: "long", fps: 30, loop: false };
  const r1 = validateMotionSpecification({ motionSpec: notANumber, template });
  ok("3a. a non-numeric durationMs is rejected", !r1.valid);
  ok("3b. the rejection names durationMs", /durationMs/.test(r1.error));

  const infinite = { preset: validPreset, durationMs: Infinity, fps: 30, loop: false };
  ok("3c. a non-finite durationMs (Infinity) is rejected", !validateMotionSpecification({ motionSpec: infinite, template }).valid);

  const tooShort = { preset: validPreset, durationMs: MOTION_DURATION_MS.MIN - 1, fps: 30, loop: false };
  const r2 = validateMotionSpecification({ motionSpec: tooShort, template });
  ok("4a. a duration below the hard minimum is rejected", !r2.valid);
  ok("4b. the rejection names the bounds", r2.error.includes(String(MOTION_DURATION_MS.MIN)) && r2.error.includes(String(MOTION_DURATION_MS.MAX)));

  const tooLong = { preset: validPreset, durationMs: MOTION_DURATION_MS.MAX + 1, fps: 30, loop: false };
  ok("4c. a duration above the hard maximum is rejected", !validateMotionSpecification({ motionSpec: tooLong, template }).valid);

  const exactlyMin = { preset: validPreset, durationMs: MOTION_DURATION_MS.MIN, fps: 30, loop: false };
  const exactlyMax = { preset: validPreset, durationMs: MOTION_DURATION_MS.MAX, fps: 30, loop: false };
  ok("4d. the bounds are inclusive — exactly MIN passes", validateMotionSpecification({ motionSpec: exactlyMin, template }).valid);
  ok("4e. the bounds are inclusive — exactly MAX passes", validateMotionSpecification({ motionSpec: exactlyMax, template }).valid);
}

// ============================================================
console.log("\n5 — unsupported preset/template combinations fail");
// ============================================================
{
  const statement = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
  ok("PRE. sanity check — Statement/Hero does not declare staggerLines support", !statement.motion.supportedPresets.includes(MOTION_PRESET.STAGGER_LINES));

  const spec = { preset: MOTION_PRESET.STAGGER_LINES, durationMs: 1500, fps: 30, loop: false };
  const result = validateMotionSpecification({ motionSpec: spec, template: statement });
  ok("5a. a globally-valid preset the SELECTED TEMPLATE does not support is rejected", !result.valid);
  ok("5b. the rejection names both the template and the preset", result.error.includes(statement.id) && result.error.includes(MOTION_PRESET.STAGGER_LINES));

  // The SAME preset, against a template that DOES support it, passes —
  // proving this is a template-specific allowlist, not a global ban.
  const cta = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  ok("5c. the same preset passes against a template that declares support for it", validateMotionSpecification({ motionSpec: spec, template: cta }).valid);
}

// ============================================================
console.log("\n6 — invalid fps fails");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT];
  const validPreset = template.motion.supportedPresets[0];

  ok("6a. an unsupported fps value (60) is rejected", !validateMotionSpecification({ motionSpec: { preset: validPreset, durationMs: 1500, fps: 60, loop: false }, template }).valid);
  ok("6b. a non-numeric fps is rejected", !validateMotionSpecification({ motionSpec: { preset: validPreset, durationMs: 1500, fps: "30", loop: false }, template }).valid);
  ok("6c. a missing fps is rejected", !validateMotionSpecification({ motionSpec: { preset: validPreset, durationMs: 1500, loop: false }, template }).valid);
  ok("6d. every declared MOTION_FPS_OPTIONS value is individually accepted", MOTION_FPS_OPTIONS.every((fps) => validateMotionSpecification({ motionSpec: { preset: validPreset, durationMs: 1500, fps, loop: false }, template }).valid));
}

// ============================================================
console.log("\n7 — invalid loop values fail");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT];
  const validPreset = template.motion.supportedPresets[0];
  const base = { preset: validPreset, durationMs: 1500, fps: 30 };

  ok("7a. loop:'true' (a string) is rejected, not coerced", !validateMotionSpecification({ motionSpec: { ...base, loop: "true" }, template }).valid);
  ok("7b. loop:1 (a number) is rejected, not coerced", !validateMotionSpecification({ motionSpec: { ...base, loop: 1 }, template }).valid);
  ok("7c. a missing loop is rejected", !validateMotionSpecification({ motionSpec: base, template }).valid);
}

// ============================================================
console.log("\n8/F — all 3 approved families declare valid preset combinations");
// ============================================================
{
  ok("8a. exactly the 3 approved families exist and each declares a motion.supportedPresets array", CREATIVE_TEMPLATE_LIST.length === 3 && CREATIVE_TEMPLATE_LIST.every((t) => Array.isArray(t.motion?.supportedPresets) && t.motion.supportedPresets.length > 0));

  for (const family of Object.values(CREATIVE_FAMILY)) {
    const template = CREATIVE_TEMPLATES[family];
    for (const preset of template.motion.supportedPresets) {
      ok(`F. ${family}'s declared preset "${preset}" is a member of the closed global vocabulary`, MOTION_PRESET_LIST.includes(preset));
    }
  }

  // Lock in the exact, deliberate per-family decisions (not just "some
  // subset of the global vocabulary") — a regression guard against
  // accidental drift, e.g. someone widening Statement/Hero to
  // staggerLines without a deliberate design decision to do so.
  const statement = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
  const announcement = CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT];
  const cta = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  ok("F-statement. Statement/Hero supports exactly [fade, slideUp] — no staggerLines (single dominant statement, nothing to sequence)",
    statement.motion.supportedPresets.slice().sort().join(",") === [MOTION_PRESET.FADE, MOTION_PRESET.SLIDE_UP].sort().join(","));
  ok("F-announcement. Announcement supports exactly [fade, slideUp, staggerLines]",
    announcement.motion.supportedPresets.slice().sort().join(",") === [MOTION_PRESET.FADE, MOTION_PRESET.SLIDE_UP, MOTION_PRESET.STAGGER_LINES].sort().join(","));
  ok("F-cta. CTA supports exactly [fade, slideUp, staggerLines]",
    cta.motion.supportedPresets.slice().sort().join(",") === [MOTION_PRESET.FADE, MOTION_PRESET.SLIDE_UP, MOTION_PRESET.STAGGER_LINES].sort().join(","));
}

// ============================================================
console.log("\n9 — malformed specifications fail");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  ok("9a. a null motionSpec is rejected, never throws", !validateMotionSpecification({ motionSpec: null, template }).valid);
  ok("9b. an undefined motionSpec is rejected, never throws", !validateMotionSpecification({ motionSpec: undefined, template }).valid);
  ok("9c. a non-object motionSpec (string) is rejected, never throws", !validateMotionSpecification({ motionSpec: "fade", template }).valid);
  ok("9d. an empty object is rejected (no preset at all)", !validateMotionSpecification({ motionSpec: {}, template }).valid);
  ok("9e. calling with no arguments at all never throws", (() => { try { return !validateMotionSpecification().valid; } catch { return false; } })());
}

// ============================================================
console.log("\n10 — validator does not mutate its input");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  const spec = Object.freeze({ preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false });
  const beforeJson = JSON.stringify(spec);
  const beforeTemplateJson = JSON.stringify(template);
  // A frozen spec would THROW on any real mutation attempt in strict
  // mode (this file is an ES module, always strict) — validating it
  // succeeding at all is itself partial proof of no mutation; the JSON
  // comparison below is the direct proof.
  const result = validateMotionSpecification({ motionSpec: spec, template });
  ok("10a. validation of a genuinely valid, frozen spec still succeeds (frozen inputs are tolerated)", result.valid);
  ok("10b. the specification object is byte-for-byte unchanged after validation", JSON.stringify(spec) === beforeJson);
  ok("10c. the template object is byte-for-byte unchanged after validation", JSON.stringify(template) === beforeTemplateJson);

  // The same proof against a REJECTING call — mutation must not happen
  // on the failure path either.
  const badSpec = Object.freeze({ preset: "nonsense", durationMs: 1500, fps: 30, loop: false });
  const beforeBadJson = JSON.stringify(badSpec);
  validateMotionSpecification({ motionSpec: badSpec, template });
  ok("10d. a REJECTED specification is also left byte-for-byte unchanged", JSON.stringify(badSpec) === beforeBadJson);
}

// ============================================================
console.log("\n11 — no DOM/browser dependency is introduced");
// ============================================================
{
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const source = readFileSync(join(repoRoot, "src", "domains", "election", "design", "motion.js"), "utf8");
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("11a. motion.js references no document/window global", !/\bdocument\.|\bwindow\./.test(codeOnly));
  ok("11b. motion.js calls no requestAnimationFrame/setInterval/setTimeout", !/requestAnimationFrame|setInterval|setTimeout/.test(codeOnly));
  ok("11c. motion.js reads no wall-clock time (Date.now/performance.now)", !/Date\.now\(|performance\.now\(/.test(codeOnly));
  ok("11d. motion.js never constructs or references a canvas", !/createElement\(["']canvas["']\)|OffscreenCanvas|getContext\(/.test(codeOnly));
  ok("11e. motion.js never references MediaRecorder or a video API", !/MediaRecorder|captureStream|HTMLVideoElement/.test(codeOnly));
  ok("11f. motion.js imports nothing at all (no Supabase, no React, no other module)", !/^\s*import /m.test(source));
}

// ============================================================
console.log("\n12 — legacy TEMPLATES remain untouched by motion declarations");
// ============================================================
{
  ok("12a. all 21 legacy templates still exist, unchanged in count", TEMPLATE_LIST.length === 21);
  ok("12b. no legacy template declares a `motion` field", TEMPLATE_LIST.every((t) => !("motion" in t)));
  ok("12c. spot check — a specific legacy template (ANNOUNCEMENT, same label as the new creative family, different object) has no motion field", !("motion" in TEMPLATES[ASSET_TYPE.ANNOUNCEMENT]));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
