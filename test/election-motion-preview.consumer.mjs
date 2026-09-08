// ============================================================
// ELECTIONCANON — GATE A.5.5.3: ephemeral motion preview architecture
//
// MotionPreview.jsx is a React component with a real requestAnimationFrame
// loop, canvas refs, and DOM-only browser APIs (window.matchMedia,
// performance.now) — none of that is meaningfully unit-testable in this
// suite's plain-Node, no-JSX-transform harness, and this file does not
// pretend otherwise (no fragile video/pixel snapshots, no headless
// browser here). Instead, following this suite's own established
// precedent (see test/election-creative-legacy-boundary.consumer.mjs's
// "Renderer contract" section, which reads CampaignStudioSection.jsx's
// own source to prove an architectural property), this file proves the
// SOURCE-LEVEL architectural guarantees the A.5.5.3 approval required:
// the governed pipeline is used exactly as specified, no motion math is
// duplicated, only template-declared presets are exposed, and nothing
// persists. Real lifecycle behavior (play/pause/cleanup/aspect ratio/
// reduced motion) is manual/browser-acceptance territory — see this
// file's own final section for that checklist, not asserted here.
// ============================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.5.3: ephemeral motion preview architecture\n");

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const previewSrc = readFileSync(join(repoRoot, "src", "pages", "election", "MotionPreview.jsx"), "utf8");
const studioSrc = readFileSync(join(repoRoot, "src", "pages", "election", "CampaignStudioSection.jsx"), "utf8");
const codeOnly = previewSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ============================================================
console.log("Governance — the existing governed pipeline is used, never a shortcut");
// ============================================================
{
  ok("G1. imports the EXISTING buildStudioCreativePayload() — never a hand-rolled/parallel payload builder", /import\s*\{[^}]*buildStudioCreativePayload[^}]*\}\s*from\s*["'].*design\/creative\.js["']/.test(previewSrc));
  ok("G2. imports the EXISTING validateCreativePayload()", /import\s*\{[^}]*validateCreativePayload[^}]*\}\s*from\s*["'].*design\/creative\.js["']/.test(previewSrc));
  ok("G3. imports the EXISTING validateMotionSpecification()", /import\s*\{[^}]*validateMotionSpecification[^}]*\}\s*from\s*["'].*design\/motion\.js["']/.test(previewSrc));
  ok("G4. imports the EXISTING renderMotionFrameToCanvas() — never a second/local drawing implementation", /import\s*\{[^}]*renderMotionFrameToCanvas[^}]*\}\s*from\s*["'].*design\/render\.js["']/.test(previewSrc));
  ok("G5. no `payload.meta`/`payload.raw`/`payload.source`/`payload.data` escape hatch appears anywhere in this file", !/payload\.(meta|raw|source|data)\b/.test(codeOnly));
  ok("G6. validateCreativePayload() is actually CALLED, not merely imported", /validateCreativePayload\(\{/.test(codeOnly));
  ok("G7. validateMotionSpecification() is actually CALLED, not merely imported", /validateMotionSpecification\(\{/.test(codeOnly));
}

// ============================================================
console.log("\nNo raw campaign/Communication metadata reaches rendering");
// ============================================================
{
  ok("R1. this file never imports communications/api.js (no Communication/language_variant row ever enters here)", !/from\s*["'].*communications\/api\.js["']/.test(previewSrc));
  ok("R2. this file never imports communications/export.js", !/from\s*["'].*communications\/export\.js["']/.test(previewSrc));
  ok("R3. this file never references brief/created_by/reviewer_id/approver_id/review_metadata/approval_metadata", !/\b(brief|created_by|reviewer_id|approver_id|review_metadata|approval_metadata)\b/.test(codeOnly));
  ok("R4. the ephemeral payload is built from a plain local `content` object literal, matching buildStudioCreativePayload()'s own expected shape", /asset:\s*\{\s*content:\s*\{\s*text:\s*content\s*\}\s*\}/.test(codeOnly));
  ok("R5. buildEphemeralPayload() never spreads an external object into the payload/asset", (() => {
    const fnBody = codeOnly.slice(codeOnly.indexOf("function buildEphemeralPayload"), codeOnly.indexOf("function buildEphemeralPayload") + 300);
    return !/\.\.\./.test(fnBody);
  })());
}

// ============================================================
console.log("\nNo persistence API is called by the preview");
// ============================================================
{
  ok("P1. MotionPreview.jsx's CODE never imports assetsApi / design/assets.js (its own header comment documents this in prose, which is why this checks comment-stripped source, not raw text)", !/assetsApi|design\/assets\.js/.test(codeOnly));
  ok("P2. MotionPreview.jsx never imports the Supabase client", !/lib\/supabase\.js/.test(previewSrc));
  ok("P3. MotionPreview.jsx's CODE never references campaign_studio_assets", !/campaign_studio_assets/.test(codeOnly));
  ok("P4. MotionPreview.jsx accepts no campaignId/userId props — nothing here is scoped to a persisted campaign at all", !/campaignId|userId/.test(codeOnly));
}

// ============================================================
console.log("\nNo duplicated motion math in the page layer");
// ============================================================
{
  ok("M1. no easing formula (1 - Math.pow(1 - t, 3), or any Math.pow-based curve) is reimplemented here", !/Math\.pow/.test(codeOnly));
  ok("M2. no local re-derivation of progress from frameIndex/totalFrames (division pattern) appears — only timing.js's own exports are used for that", !/frameIndex\s*\/\s*\(?\s*totalFrames/.test(codeOnly));
  ok("M3. imports deriveTotalFrames() and frameIndexForElapsed() from design/timing.js rather than reimplementing them", /import\s*\{[^}]*deriveTotalFrames[^}]*frameIndexForElapsed[^}]*\}\s*from\s*["'].*design\/timing\.js["']/.test(previewSrc) || (/deriveTotalFrames/.test(previewSrc) && /frameIndexForElapsed/.test(previewSrc) && /design\/timing\.js/.test(previewSrc)));
  ok("M4. setInterval is never used", !/setInterval/.test(codeOnly));
  ok("M5. Date.now() is never used — performance.now() is the only elapsed-time source, kept entirely at this page layer", !/Date\.now\(/.test(codeOnly));
  ok("M6. requestAnimationFrame/cancelAnimationFrame ARE used (the browser driver genuinely exists here, not merely described)", /requestAnimationFrame\(/.test(codeOnly) && /cancelAnimationFrame\(/.test(codeOnly));
}

// ============================================================
console.log("\nOnly template-supported presets are exposed");
// ============================================================
{
  ok("S1. the preset choices come from template.motion.supportedPresets — never a hardcoded literal list of preset names", /template\.motion\.supportedPresets\.map/.test(codeOnly));
  ok("S2. no hardcoded array literal of preset ids (e.g. ['fade','slideUp','staggerLines']) is used to populate the selector", !/\[\s*["']fade["']\s*,\s*["']slideUp["']/.test(codeOnly));
  ok("S3. the initial preset defaults to the FIRST entry of the template's own declared list, never an arbitrary literal", /useState\(template\.motion\.supportedPresets\[0\]\)/.test(codeOnly));
}

// ============================================================
console.log("\nFont readiness occurs before the first meaningful motion render");
// ============================================================
{
  ok("F1. imports the EXISTING ensureCreativeFontsReady() — never a duplicated document.fonts implementation", /import\s*\{[^}]*ensureCreativeFontsReady[^}]*\}\s*from\s*["']\.\/shared\.jsx["']/.test(previewSrc));
  ok("F2. this file never touches document.fonts directly", !/document\.fonts/.test(codeOnly));

  const onPreviewMotionBody = codeOnly.slice(codeOnly.indexOf("onPreviewMotion ="), codeOnly.indexOf("const setSlot"));
  const fontAwaitIndex = onPreviewMotionBody.indexOf("ensureCreativeFontsReady()");
  const firstMotionRenderIndex = onPreviewMotionBody.indexOf("renderMotionFrameToCanvas(");
  ok("F3. ensureCreativeFontsReady() is awaited, and its call appears BEFORE the first renderMotionFrameToCanvas() call in source order within the preview handler", fontAwaitIndex !== -1 && firstMotionRenderIndex !== -1 && fontAwaitIndex < firstMotionRenderIndex);
  ok("F4. the font-readiness call is genuinely awaited, not fired-and-forgotten", /await\s+ensureCreativeFontsReady\(\)/.test(onPreviewMotionBody));
}

// ============================================================
console.log("\nReduced-motion handling stays in the page layer");
// ============================================================
{
  ok("RM1. reads prefers-reduced-motion via window.matchMedia — a page-layer-only DOM read", /matchMedia\(["']\(prefers-reduced-motion:\s*reduce\)["']\)/.test(codeOnly));
  ok("RM2. design/motion.js and design/timing.js contain no reference to reduced motion at all — this preference never leaks into the domain layer", (() => {
    const motionSrc = readFileSync(join(repoRoot, "src", "domains", "election", "design", "motion.js"), "utf8");
    const timingSrc = readFileSync(join(repoRoot, "src", "domains", "election", "design", "timing.js"), "utf8");
    return !/reduced-motion|reducedMotion|prefers-reduced/i.test(motionSrc) && !/reduced-motion|reducedMotion|prefers-reduced/i.test(timingSrc);
  })());
}

// ============================================================
console.log("\nRefs, not state, drive the per-frame loop (no per-frame React re-render)");
// ============================================================
{
  ok("REF1. the rAF handle lives in a ref, not state", /const rafRef = useRef\(/.test(codeOnly));
  ok("REF2. the loop start timestamp lives in a ref, not state", /const startRef = useRef\(/.test(codeOnly));
  ok("REF3. no per-frame setState of a frame-position/progress value exists inside the tick loop (only isPlaying, a coarse boolean, is ever set there)", (() => {
    const tickBody = codeOnly.slice(codeOnly.indexOf("const tick = ()"), codeOnly.indexOf("rafRef.current = requestAnimationFrame(tick);\n  }, ["));
    const setStateCalls = tickBody.match(/set[A-Z]\w*\(/g) || [];
    return setStateCalls.every((c) => c.startsWith("setIsPlaying("));
  })());
}

// ============================================================
console.log("\nCampaign Studio wiring — in-page tab, not new top-level navigation");
// ============================================================
{
  ok("W1. CampaignStudioSection.jsx imports MotionPreview from a relative sibling file, not a new route/page module", /import MotionPreview from ["']\.\/MotionPreview\.jsx["']/.test(studioSrc));
  ok("W2. the new tab is added to the EXISTING STUDIO_TAB in-page tab object — no react-router-dom import appears in either file", !/react-router-dom/.test(studioSrc) && !/react-router-dom/.test(previewSrc));
  ok("W3. MotionPreview is rendered conditionally inside the existing tab switch, not mounted unconditionally alongside it", /tab === STUDIO_TAB\.PREVIEW/.test(studioSrc));
  ok("W4. the legacy Design-tab Editor/exportPng()/assetsApi flow is untouched — still present verbatim in the same file", /async function exportPng\(/.test(studioSrc) && /assetsApi\.createAsset/.test(studioSrc));
}

// ============================================================
console.log("\nExternal cancellation resets isPlaying (Gate A.5.5.3 fix)");
// ============================================================
{
  const cleanupBody = codeOnly.slice(codeOnly.indexOf("return () => {"), codeOnly.indexOf("}, [familyKey, preset, content]);"));
  ok("C1. the family/preset/content cleanup exists and still cancels the rAF handle", /cancelAnimationFrame\(rafRef\.current\)/.test(cleanupBody));
  ok("C2. that SAME cleanup also resets isPlaying to false — a preview cancelled by a family/preset/content change must not leave the button stuck on \"Previewing…\"", /setIsPlaying\(false\)/.test(cleanupBody));
  ok("C3. the isPlaying reset is guarded by the same rafRef.current != null check as the cancellation — never an unconditional call on every dependency change/unmount", (() => {
    const guardIndex = cleanupBody.indexOf("rafRef.current != null");
    const cancelIndex = cleanupBody.indexOf("cancelAnimationFrame(rafRef.current)");
    const resetIndex = cleanupBody.indexOf("setIsPlaying(false)");
    return guardIndex !== -1 && guardIndex < cancelIndex && cancelIndex < resetIndex;
  })());
  ok("C4. the natural-completion reset inside tick() is untouched — still exactly one setIsPlaying(false) call there, unchanged by this fix", (() => {
    const tickBody = codeOnly.slice(codeOnly.indexOf("const tick = ()"), codeOnly.indexOf("rafRef.current = requestAnimationFrame(tick);\n  }, ["));
    const matches = tickBody.match(/setIsPlaying\(false\)/g) || [];
    return matches.length === 1;
  })());
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
console.log("Browser-acceptance checklist still requiring MANUAL verification (not automated by this file):");
console.log("  - Preview opens and the settled static frame renders immediately");
console.log("  - clicking 'Preview motion' animates smoothly and settles on the final frame");
console.log("  - clicking 'Preview motion' again restarts cleanly from frame 0");
console.log("  - switching family/preset while playing cancels the prior loop (no visible double-draw/flicker)");
console.log("  - the canvas preserves its 1:1 aspect ratio at several viewport widths");
console.log("  - with prefers-reduced-motion enabled, clicking Preview jumps straight to the settled frame with no animation");
console.log("  - navigating away from the Motion Preview tab (or the whole page) leaves no console errors from a stale rAF callback\n");
if (fail > 0) process.exit(1);
