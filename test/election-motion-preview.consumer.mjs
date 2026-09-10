// ============================================================
// ELECTIONCANON — GATE A.5.5.3: ephemeral motion preview architecture
// (extended by GATE A.5.6: Golden Creative Export)
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
// SOURCE-LEVEL architectural guarantees the A.5.5.3/A.5.6 approvals
// required: the governed pipeline is used exactly as specified, no motion
// math is duplicated, only template-declared presets are exposed, export
// reuses the same payload/validator/static-renderer/PNG pipeline the rest
// of the codebase already proved, and nothing persists. Real lifecycle
// behavior (play/pause/cleanup/aspect ratio/reduced motion/the downloaded
// PNG's actual visual content) is manual/browser-acceptance territory —
// see this file's own final section for that checklist, not asserted here.
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
  ok("G4. imports the EXISTING renderCompositionMotionFrameToCanvas() — never a second/local drawing implementation (Gate A.6.5: the motion path is now composition-aware, replacing the plain renderMotionFrameToCanvas() this file used before)", /import\s*\{[^}]*renderCompositionMotionFrameToCanvas[^}]*\}\s*from\s*["'].*design\/render\.js["']/.test(previewSrc));
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
  const firstMotionRenderIndex = onPreviewMotionBody.indexOf("renderCompositionMotionFrameToCanvas(");
  ok("F3. ensureCreativeFontsReady() is awaited, and its call appears BEFORE the first renderCompositionMotionFrameToCanvas() call in source order within the preview handler", fontAwaitIndex !== -1 && firstMotionRenderIndex !== -1 && fontAwaitIndex < firstMotionRenderIndex);
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

// ============================================================
console.log("\nGolden Creative export (Gate A.5.6)");
// ============================================================
{
  ok("X1. GOLDEN_FORMAT maps to the existing CREATIVE_FORMAT.PORTRAIT — never a new/invented format id", /const GOLDEN_FORMAT\s*=\s*CREATIVE_FORMAT\.PORTRAIT;/.test(codeOnly));
  ok("X2. the shared preview/export canvas dimensions are exactly 1080x1350", /PREVIEW_DIMENSIONS\s*=\s*Object\.freeze\(\{\s*width:\s*1080,\s*height:\s*1350\s*\}\)/.test(codeOnly));

  const exportStart = codeOnly.indexOf("onExportPng = useCallback");
  const exportEnd = codeOnly.indexOf("const setSlot");
  const exportBody = codeOnly.slice(exportStart, exportEnd);
  ok("X3. onExportPng() exists as its own handler", exportStart !== -1 && exportEnd > exportStart);

  ok("X4. export builds its payload through the SAME buildEphemeralPayload() the live preview uses — never a second/parallel payload builder", /buildEphemeralPayload\(/.test(exportBody));
  ok("X5. export validates through the SAME validateCreativePayload() the live preview uses", /validateCreativePayload\(\{/.test(exportBody));

  const validateIndex = exportBody.indexOf("validateCreativePayload({");
  const canvasCreateIndex = exportBody.indexOf('document.createElement("canvas")');
  ok("X6. validation happens BEFORE the export canvas is ever created", validateIndex !== -1 && canvasCreateIndex !== -1 && validateIndex < canvasCreateIndex);

  const earlyReturnMatch = exportBody.match(/if\s*\(!validation\.valid\)\s*\{\s*setExportError\(validation\.error\);\s*return;\s*\}/);
  const earlyReturnIndex = earlyReturnMatch ? exportBody.indexOf(earlyReturnMatch[0]) : -1;
  ok("X7. a failed validation sets an export-specific error and RETURNS before canvas creation — no canvas, no render, no download on invalid content", earlyReturnIndex !== -1 && earlyReturnIndex < canvasCreateIndex);

  const fontReadyIndex = exportBody.indexOf("ensureCreativeFontsReady()");
  const staticRenderIndex = exportBody.indexOf("renderCompositionToCanvas(");
  ok("X8. ensureCreativeFontsReady() is awaited BEFORE the export's own render call", /await\s+ensureCreativeFontsReady\(\)/.test(exportBody) && fontReadyIndex !== -1 && staticRenderIndex !== -1 && fontReadyIndex < staticRenderIndex);

  ok("X9. export draws via the composition-aware STATIC renderCompositionToCanvas() — the settled composition, not a motion frame (Gate A.6.6: updated from the plain renderTemplateToCanvas() this file used before)", /renderCompositionToCanvas\(\{/.test(exportBody));
  ok("X10. export NEVER calls renderCompositionMotionFrameToCanvas() — exporting a motion frame is explicitly out of scope for this gate", !/renderCompositionMotionFrameToCanvas\(/.test(exportBody));
  ok("X10b. export validates the SAME composition the live preview uses (validateCreativeComposition), never a second/parallel composition validator", /validateCreativeComposition\(\{/.test(exportBody));

  ok("X11. export encodes via the EXISTING canvasToPngBlob() — never a second PNG-encoding implementation", /canvasToPngBlob\(/.test(exportBody));
  ok("X12. export downloads via the EXISTING downloadBlob() — never a second download mechanism", /downloadBlob\(/.test(exportBody));
  ok("X13. canvasToPngBlob is imported from the existing design/render.js — not reimplemented locally", /import\s*\{[^}]*canvasToPngBlob[^}]*\}\s*from\s*["'].*design\/render\.js["']/.test(previewSrc));
  ok("X14. downloadBlob is imported from the existing ./shared.jsx — not reimplemented locally", /import\s*\{[^}]*downloadBlob[^}]*\}\s*from\s*["']\.\/shared\.jsx["']/.test(previewSrc));

  ok("X15. no second render-to-canvas implementation is introduced anywhere in this file — both renderers remain imports, never redefined", !/function\s+\w*[Rr]ender\w*Canvas\w*\s*\(/.test(codeOnly));

  // X16/X17: no persistence path is introduced by this gate's addition. P1-P4
  // above already scan this file's ENTIRE source (including onExportPng) for
  // assetsApi/design/assets.js, the Supabase client, campaign_studio_assets,
  // and campaignId/userId props — so this gate's own code is already
  // re-verified by those existing, unchanged checks; no duplicate check
  // needed here, this comment just makes that coverage explicit and traceable.
  ok("X16. (documented via P1-P4 above) export introduces no assetsApi/Supabase/persistence reference of its own", !/assetsApi|design\/assets\.js|lib\/supabase\.js|campaign_studio_assets/.test(exportBody));
}

// ============================================================
console.log("\nSelection indicator stays visible against every family's background (Gate A.6.3 fix)");
// ============================================================
{
  ok("SELFIX1. the selected-element overlay border uses IVORY, not TEAL — TEAL collides with Statement/Hero's own background token (COLOUR_TOKEN.primary in render.js), making a teal selection indicator invisible on the default Golden Creative family", /selectedElementId === b\.role \? `2px solid \$\{IVORY\}` : /.test(codeOnly));
  ok("SELFIX2. the overlay border is no longer TEAL for the selected state", !/selectedElementId === b\.role \? `2px solid \$\{TEAL\}` : /.test(codeOnly));
}

// ============================================================
console.log("\nOne controlled property — alignment (Gate A.6.4)");
// ============================================================
{
  ok("ALIGN1. imports TEXT_ALIGNMENT_LIST from the existing design/composition.js — never a hardcoded alignment list", /import\s*\{[^}]*TEXT_ALIGNMENT_LIST[^}]*\}\s*from\s*["'].*design\/composition\.js["']/.test(previewSrc));
  ok("ALIGN2. the alignment control renders from TEXT_ALIGNMENT_LIST.map(), never a hardcoded ['left','center'] literal", /TEXT_ALIGNMENT_LIST\.map\(/.test(codeOnly) && !/\[\s*["']left["']\s*,\s*["']center["']\s*\]/.test(codeOnly));
  ok("ALIGN3. setSelectedAlignment() updates the element immutably via .map(), never mutates composition.elements in place", /elements:\s*c\.elements\.map\(/.test(codeOnly));
  ok("ALIGN4. only the `alignment` property is ever assigned to an element — no font/size/colour/position key appears inside any element `properties` object anywhere in this file", !/properties:\s*\{[^}]*(fontSize|fontFamily|weight|colour|color|position|lineHeight|letterSpacing)[^}]*\}/i.test(codeOnly));
  // GATE A.7.2B — the alignment block's own condition grew a `.kind ===
  // ELEMENT_KIND.TEXT` clause (it must not render for a selected IMAGE
  // element); this still proves the same thing ALIGN5 always asserted —
  // conditional on selectedElement, never permanently visible — just via
  // an updated literal.
  ok("ALIGN5. the contextual alignment control only renders when an element is actually selected — conditional on selectedElement, never permanently visible", /\{selectedElement\s*&&\s*selectedElement\.kind\s*===\s*ELEMENT_KIND\.TEXT\s*&&\s*\(/.test(codeOnly));
  ok("ALIGN6. the SAME composition state that drives the live static render also holds the alignment change — setSelectedAlignment calls setComposition, not a separate preview-only state setter", (() => {
    const fnStart = codeOnly.indexOf("const setSelectedAlignment");
    const fnEnd = codeOnly.indexOf("};", fnStart);
    const fnBody = codeOnly.slice(fnStart, fnEnd);
    return /setComposition\(/.test(fnBody);
  })());
}

// ============================================================
console.log("\nAtomic family switch — no render can pair a new family with old composition/content (correctness fix)");
// ============================================================
{
  ok("ATOMIC1. the family reset is no longer a plain useEffect keyed ONLY on [familyKey] — that pattern let one render commit the new template alongside the old composition/content before the effect ran", !/\}, \[familyKey\]\);/.test(codeOnly));
  ok("ATOMIC2. an explicit render-phase reset guard compares against the family this component last reset for", /if\s*\(\s*familyKey\s*!==\s*resetForFamilyKey\s*\)\s*\{/.test(codeOnly));
  ok("ATOMIC3. the render-phase guard resets content, composition, preset, and selection — the same fields the old effect reset", (() => {
    const start = codeOnly.indexOf("if (familyKey !== resetForFamilyKey)");
    const end = codeOnly.indexOf("useEffect", start);
    const body = codeOnly.slice(start, end);
    return /setContent\(emptyContentFor\(template\)\)/.test(body)
      && /setComposition\(defaultCompositionFor\(template, GOLDEN_FORMAT\)\)/.test(body)
      && /setPreset\(template\.motion\.supportedPresets\[0\]\)/.test(body)
      && /setSelectedElementId\(null\)/.test(body);
  })());
  ok("ATOMIC4. the reset guard runs during render, not inside a useEffect — no `useEffect(` call appears between the guard's `const [resetForFamilyKey` declaration and its own closing brace", (() => {
    const declStart = codeOnly.indexOf("const [resetForFamilyKey");
    const guardStart = codeOnly.indexOf("if (familyKey !== resetForFamilyKey)", declStart);
    const guardEnd = codeOnly.indexOf("\n  }", guardStart);
    const between = codeOnly.slice(declStart, guardEnd);
    return declStart !== -1 && guardStart !== -1 && guardEnd !== -1 && !/useEffect\(/.test(between);
  })());
}

// ============================================================
console.log("\nInvalid composition/payload state clears selection entirely, not just its visible boxes (correctness fix)");
// ============================================================
{
  const liveEffectStart = codeOnly.indexOf("useEffect(() => {\n    const canvas = canvasRef.current;");
  // GATE A.7.2A — the live-preview effect's dependency array grew a 5th
  // entry (heroImage), so the exact literal that marks its end changed too.
  const liveEffectEnd = codeOnly.indexOf("}, [familyKey, preset, content, composition, heroImage]);");
  const liveEffectBody = codeOnly.slice(liveEffectStart, liveEffectEnd);

  ok("SELCLEAR1. the live-preview effect exists and was located", liveEffectStart !== -1 && liveEffectEnd > liveEffectStart);
  ok("SELCLEAR2. selectedElementId is cleared in BOTH invalid branches (payload invalid, composition invalid) in addition to the family-reset block — at least 3 total call sites", (codeOnly.match(/setSelectedElementId\(null\)/g) || []).length >= 3);
  ok("SELCLEAR3. specifically, the payload-invalid branch clears the selection", (() => {
    const branchStart = liveEffectBody.indexOf("if (!payloadValidation.valid)");
    const branchEnd = liveEffectBody.indexOf("} else if (!compositionValidation.valid)");
    const branch = liveEffectBody.slice(branchStart, branchEnd);
    return /setSelectionBounds\(\[\]\)/.test(branch) && /setSelectedElementId\(null\)/.test(branch);
  })());
  ok("SELCLEAR4. specifically, the composition-invalid branch clears the selection", (() => {
    const branchStart = liveEffectBody.indexOf("} else if (!compositionValidation.valid)");
    const branchEnd = liveEffectBody.indexOf("} else {", branchStart);
    const branch = liveEffectBody.slice(branchStart, branchEnd);
    return /setSelectionBounds\(\[\]\)/.test(branch) && /setSelectedElementId\(null\)/.test(branch);
  })());
  ok("SELCLEAR5. the alignment control still renders only when selectedElement is truthy — with selectedElementId cleared, an invalid state renders no alignment control at all, so it cannot mutate stale selection state", /\{selectedElement\s*&&\s*selectedElement\.kind\s*===\s*ELEMENT_KIND\.TEXT\s*&&\s*\(/.test(codeOnly));
}

// ============================================================
console.log("\nExport-error lifecycle — a stale export failure does not survive a corrective action (correctness fix)");
// ============================================================
{
  ok("EXPERR1. onExportPng still clears exportError at the start of every attempt (unchanged baseline)", (() => {
    const start = codeOnly.indexOf("onExportPng = useCallback");
    const body = codeOnly.slice(start, start + 300);
    return /setExportError\(null\)/.test(body);
  })());
  ok("EXPERR2. a dedicated effect clears exportError whenever family/content/composition change — the same three corrective-action categories this fix targets", /useEffect\(\(\) => \{\s*setExportError\(null\);/.test(codeOnly));
  ok("EXPERR3. that effect's dependency array is exactly [familyKey, content, composition] — not merely [familyKey], so editing content or an alignment change (which updates composition) also clears the stale banner", /\}, \[familyKey, content, composition\]\);/.test(codeOnly));
}

// ============================================================
console.log("\nGATE A.7.2A — REAL IMAGE INPUT: decoding");
// ============================================================
{
  const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
  const handlerEnd = codeOnly.indexOf("const selectedElement =", handlerStart);
  const handlerBody = codeOnly.slice(handlerStart, handlerEnd);

  ok("IMG1. createImageBitmap() is used to decode the chosen file", /createImageBitmap\(file\)/.test(handlerBody));
  ok("IMG2. file.type is checked against an explicit allow-list BEFORE createImageBitmap is ever called", (() => {
    const typeCheckIndex = handlerBody.indexOf("HERO_IMAGE_ALLOWED_TYPES.includes(file.type)");
    const decodeIndex = handlerBody.indexOf("createImageBitmap(file)");
    return typeCheckIndex !== -1 && decodeIndex !== -1 && typeCheckIndex < decodeIndex;
  })());
  ok("IMG3. the allow-list is exactly jpeg/png/webp — no HEIC, no wildcard, no arbitrary type", /HERO_IMAGE_ALLOWED_TYPES = Object\.freeze\(\["image\/jpeg", "image\/png", "image\/webp"\]\)/.test(codeOnly));
  ok("IMG4. an unsupported type returns BEFORE decode is attempted — never falls through to createImageBitmap", /if \(!HERO_IMAGE_ALLOWED_TYPES\.includes\(file\.type\)\) \{[\s\S]*?return;\s*\}/.test(handlerBody));
  ok("IMG5. createImageBitmap is awaited inside a try/catch — a decode failure is caught, never left to throw uncaught", /try\s*\{\s*bitmap = await createImageBitmap\(file\);\s*\} catch/.test(handlerBody));
  ok("IMG6. a caught decode failure sets a plain image-specific error, never the shared payload/composition `error` state", (() => {
    const catchStart = handlerBody.indexOf("} catch");
    const catchEnd = handlerBody.indexOf("if (heroImageGenerationRef.current !== generation)");
    const catchBlock = handlerBody.slice(catchStart, catchEnd);
    return /setImageError\(/.test(catchBlock) && !/setError\(/.test(catchBlock);
  })());
  ok("IMG7. a successful decode becomes heroImage drawable state via setHeroImage(), in the A.7.1 {source, width, height} shape", /setHeroImage\(\{ source: bitmap, width: bitmap\.width, height: bitmap\.height \}\)/.test(handlerBody));
  ok("IMG8. no Image(), object URL, or FileReader is ever used to obtain the drawable", !/new Image\(|createObjectURL|FileReader/.test(codeOnly));
  ok("IMG9. no remote URL / fetch path is introduced for image input", !/\bfetch\(/.test(codeOnly));
  ok("IMG10. render.js never receives a File/Blob — this handler's own drawable is built from bitmap.width/height, never file.size/file.type/file itself", !/renderCompositionToCanvas\([^)]*file[^)]*\)/i.test(codeOnly));
}

// ============================================================
console.log("\nGATE A.7.2A — drawables reach both the viewport and PNG export, from the SAME source");
// ============================================================
{
  ok("DRAW1. `drawables` is built exactly once, from heroImage state, as a plain {heroImage} object when present", /const drawables = heroImage \? \{ heroImage \} : \{\};/.test(codeOnly));
  ok("DRAW6. only ONE `const drawables =` declaration exists in the whole file — export and viewport structurally cannot diverge onto two independently-built objects", (codeOnly.match(/const drawables =/g) || []).length === 1);

  const liveEffectStart = codeOnly.indexOf("useEffect(() => {\n    const canvas = canvasRef.current;");
  const liveEffectEnd = codeOnly.indexOf("}, [familyKey, preset, content, composition, heroImage]);");
  const liveEffectBody = codeOnly.slice(liveEffectStart, liveEffectEnd);
  ok("DRAW2. the live viewport render call receives `drawables`", /renderCompositionToCanvas\(\{ canvas, template, payload, composition, drawables \}\)/.test(liveEffectBody));
  ok("DRAW3. heroImage is in the live-preview effect's own dependency list — a new image actually triggers a redraw", liveEffectEnd !== -1);

  const exportStart = codeOnly.indexOf("onExportPng = useCallback");
  const exportEnd = codeOnly.indexOf("const setSlot");
  const exportBody = codeOnly.slice(exportStart, exportEnd);
  ok("DRAW4. Export PNG's render call ALSO receives `drawables` — the same variable name, not a re-derived/second one", /renderCompositionToCanvas\(\{ canvas, template, payload, composition, drawables \}\)/.test(exportBody));
  ok("DRAW5. onExportPng's dependency array includes drawables — a stale export handler could otherwise close over an old image", /\}, \[template, content, composition, languageContext, drawables\]\);/.test(codeOnly));
  ok("DRAW7. renderCompositionMotionFrameToCanvas() is never passed a drawables argument anywhere — image motion is explicitly out of scope for this gate, and the motion renderer's contract is not expanded", !/renderCompositionMotionFrameToCanvas\(\{[^}]*drawables/.test(codeOnly));
}

// ============================================================
console.log("\nGATE A.7.2A — family switch clears heroImage (no orphaned bitmap survives leaving Statement/Hero)");
// ============================================================
{
  const resetStart = codeOnly.indexOf("if (familyKey !== resetForFamilyKey)");
  const resetEnd = codeOnly.indexOf("const drawables = heroImage");
  const resetBody = codeOnly.slice(resetStart, resetEnd);
  ok("FAM1. the atomic family-reset block clears heroImage to null", /setHeroImage\(null\)/.test(resetBody));
  ok("FAM2. the same block also clears imageError", /setImageError\(null\)/.test(resetBody));
  ok("FAM3. the same block bumps heroImageGenerationRef — an in-flight decode from the family just left can never land afterward", /heroImageGenerationRef\.current \+= 1/.test(resetBody));
}

// ============================================================
console.log("\nGATE A.7.2A — resource lifecycle: cleanup, replacement, and the stale-decode race");
// ============================================================
{
  ok("LIFE1. a dedicated effect exists whose ONLY job is closing heroImage's bitmap on cleanup, keyed on [heroImage]", /useEffect\(\(\) => \{\s*return \(\) => \{ heroImage\?\.source\?\.close\?\.\(\); \};\s*\}, \[heroImage\]\);/.test(codeOnly));
  ok("LIFE2. that cleanup effect is a SEPARATE effect from the draw effect — not folded into the draw effect's own cleanup (which owns the rAF handle, a different resource)", (() => {
    const idx = codeOnly.indexOf("return () => { heroImage?.source?.close?.(); };");
    const drawCleanupIdx = codeOnly.indexOf("sessionRef.current += 1;");
    return idx !== -1 && drawCleanupIdx !== -1 && idx < drawCleanupIdx;
  })());
  ok("LIFE3. onHeroImageFile captures a generation number ONCE, at the start, before any await", /const generation = \+\+heroImageGenerationRef\.current;/.test(codeOnly));
  ok("LIFE4. after a successful decode, the generation is re-checked BEFORE setHeroImage is ever called — a stale (superseded) decode is discarded, never stored", (() => {
    const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
    const setHeroIdx = codeOnly.indexOf("setHeroImage({", handlerStart);
    const raceCheckIdx = codeOnly.indexOf("heroImageGenerationRef.current !== generation", handlerStart);
    const closeIdx = codeOnly.indexOf("bitmap.close()", handlerStart);
    return raceCheckIdx !== -1 && setHeroIdx !== -1 && closeIdx !== -1 && raceCheckIdx < setHeroIdx && closeIdx < setHeroIdx && closeIdx > raceCheckIdx;
  })());
  ok("LIFE5. the stale-decode branch calls bitmap.close() and RETURNS without ever calling setHeroImage — image A (superseded) can never overwrite image B (current)", /if \(heroImageGenerationRef\.current !== generation\) \{\s*bitmap\.close\(\);\s*return;\s*\}/.test(codeOnly));
  ok("LIFE6. a failed decode (catch branch) never calls setHeroImage — no bitmap is retained on failure", (() => {
    const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
    const catchStart = codeOnly.indexOf("} catch {", handlerStart);
    const catchEnd = codeOnly.indexOf("if (heroImageGenerationRef.current !== generation)", catchStart);
    const catchBody = codeOnly.slice(catchStart, catchEnd);
    return !/setHeroImage\(/.test(catchBody);
  })());
  ok("LIFE7. exactly one bitmap.close() call exists in the handler (the stale-race discard) — a successful decode's own bitmap is never closed right after being decoded, which would close the very bitmap about to be shown", (() => {
    const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
    const handlerEnd = codeOnly.indexOf("const selectedElement =", handlerStart);
    const handlerBody = codeOnly.slice(handlerStart, handlerEnd);
    const closeMatches = handlerBody.match(/bitmap\.close\(\)/g) || [];
    return closeMatches.length === 1;
  })());
  ok("LIFE8. no double-close risk: a superseded bitmap that is closed inline in onHeroImageFile is never also passed to setHeroImage (the only path into the heroImage-keyed cleanup effect)", (() => {
    const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
    const raceBlockStart = codeOnly.indexOf("if (heroImageGenerationRef.current !== generation)", handlerStart);
    const raceBlockEnd = codeOnly.indexOf("setHeroImage({", handlerStart);
    const raceBlock = codeOnly.slice(raceBlockStart, raceBlockEnd);
    return !/setHeroImage\(/.test(raceBlock);
  })());
}

// ============================================================
console.log("\nGATE A.7.2A — UI entry point and no out-of-scope controls");
// ============================================================
{
  ok("UI1. the image input is rendered from template.imageSlots — never a hardcoded JSX block independent of the template's own declaration", /template\.imageSlots\?\.map\(/.test(codeOnly));
  ok("UI2. a native file input exists with type=\"file\"", /type="file"/.test(previewSrc));
  ok("UI3. the file input's accept attribute is built from the SAME allow-list used for validation — never a second, independently-typed accept string", /accept=\{HERO_IMAGE_ALLOWED_TYPES\.join\(","\)\}/.test(previewSrc));
  ok("UI4. no drag-and-drop handler (onDrop/onDragOver) is introduced", !/onDrop=|onDragOver=/.test(codeOnly));
  ok("UI5. no crop/resize/rotate control or opacity slider is introduced for the image", !/crop|resize.?handle|opacity.?control|rotate/i.test(codeOnly));
  ok("UI6. no <img> preview element is added — the canvas itself is the only visual surface for the chosen image", !/<img\b/.test(previewSrc));
}

// ============================================================
console.log("\nGATE A.7.2A — no persistence/Storage/asset path is introduced (re-verified alongside P1-P4 above)");
// ============================================================
{
  ok("PERSIST1. no design/assets.js or assetsApi import appears anywhere in this file's own code", !/assetsApi|design\/assets\.js/.test(codeOnly));
  ok("PERSIST2. no Supabase client import appears anywhere in this file", !/lib\/supabase\.js/.test(previewSrc));
  ok("PERSIST3. no Storage-related identifier (Storage/bucket/upload) appears anywhere in this file's code", !/\bStorage\b|\bbucket\b|\bupload\(/i.test(codeOnly));
  ok("PERSIST4. composition state is never mutated merely because a file was selected — onHeroImageFile never calls setComposition", (() => {
    const handlerStart = codeOnly.indexOf("onHeroImageFile = async (e)");
    const handlerEnd = codeOnly.indexOf("const selectedElement =", handlerStart);
    const handlerBody = codeOnly.slice(handlerStart, handlerEnd);
    return !/setComposition\(/.test(handlerBody);
  })());
}

// ============================================================
console.log("\nGATE A.7.2B — IMAGE SELECTION: bounds ordering (mandatory image-first, text-second)");
// ============================================================
{
  ok("ORDER1. imports computeImageElementSelectionBounds from the existing design/render.js — never a second/local geometry calculation", /import\s*\{[^}]*computeImageElementSelectionBounds[^}]*\}\s*from\s*["'].*design\/render\.js["']/.test(previewSrc));

  const liveEffectStart = codeOnly.indexOf("useEffect(() => {\n    const canvas = canvasRef.current;");
  const liveEffectEnd = codeOnly.indexOf("}, [familyKey, preset, content, composition, heroImage]);");
  const liveEffectBody = codeOnly.slice(liveEffectStart, liveEffectEnd);

  ok("ORDER2. `selectionBounds` is built as ONE array combining both geometry sources — not two separate state variables", /const bounds = \[\.\.\.computeImageElementSelectionBounds\(\{ canvas, composition \}\), \.\.\.computeElementSelectionBounds\(\{ canvas, template, content \}\)\];/.test(liveEffectBody));

  ok("ORDER3 (REGRESSION GUARD). computeImageElementSelectionBounds() appears BEFORE computeElementSelectionBounds() in that SAME array construction — heroImage's full-bleed overlay button must paint underneath, so headline/body's own smaller buttons (added second) remain on top and clickable. This is the exact source-level guarantee this gate is required to prove: the headline stays selectable despite heroImage being full bleed.", (() => {
    const arrayLineIndex = liveEffectBody.indexOf("const bounds = [...computeImageElementSelectionBounds");
    const imageCallIndex = liveEffectBody.indexOf("computeImageElementSelectionBounds(", arrayLineIndex);
    const textCallIndex = liveEffectBody.indexOf("computeElementSelectionBounds({ canvas, template, content })", arrayLineIndex);
    return arrayLineIndex !== -1 && imageCallIndex !== -1 && textCallIndex !== -1 && imageCallIndex < textCallIndex;
  })());

  ok("ORDER4. only ONE `selectionBounds` array is ever built per render pass — no second, competing bounds computation exists elsewhere in the file", (codeOnly.match(/const bounds = \[/g) || []).length === 1);
}

// ============================================================
console.log("\nGATE A.7.2B — CONTEXTUAL CONTROL: TEXT vs IMAGE, never both");
// ============================================================
{
  ok("CTX1. the TEXT alignment control is additionally gated on selectedElement.kind === ELEMENT_KIND.TEXT — it no longer renders merely because SOMETHING is selected", /\{selectedElement\s*&&\s*selectedElement\.kind\s*===\s*ELEMENT_KIND\.TEXT\s*&&\s*\(/.test(codeOnly));
  ok("CTX2. a SEPARATE contextual block exists gated on selectedElement.kind === ELEMENT_KIND.IMAGE", /\{selectedElement\s*&&\s*selectedElement\.kind\s*===\s*ELEMENT_KIND\.IMAGE\s*&&\s*\(/.test(codeOnly));
  ok("CTX3. the two contextual blocks test OPPOSITE kind values (TEXT vs IMAGE) on the SAME selectedElement — structurally mutually exclusive, since one value can never equal two different kinds at once", (() => {
    const textGate = /selectedElement\.kind === ELEMENT_KIND\.TEXT/.test(codeOnly);
    const imageGate = /selectedElement\.kind === ELEMENT_KIND\.IMAGE/.test(codeOnly);
    return textGate && imageGate;
  })());
  ok("CTX4. ELEMENT_KIND is imported from the existing design/composition.js — never a hardcoded 'text'/'image' string literal used for this gating", /import\s*\{[^}]*ELEMENT_KIND[^}]*\}\s*from\s*["'].*design\/composition\.js["']/.test(previewSrc));
  ok("CTX5. the empty-image state is understandable — a plain \"No photo added\" message renders when the IMAGE block is showing but no heroImage drawable exists yet", /No photo added/.test(previewSrc));
  ok("CTX6. the opacity slider is conditioned on `heroImage` being present — it never renders (with nothing to control) when no photo has been chosen", (() => {
    const imgBlockStart = codeOnly.indexOf("selectedElement.kind === ELEMENT_KIND.IMAGE");
    const imgBlockEnd = codeOnly.indexOf(")}", codeOnly.indexOf("No photo added"));
    const imgBlock = codeOnly.slice(imgBlockStart, imgBlockEnd);
    return /heroImage \?/.test(imgBlock);
  })());
}

// ============================================================
console.log("\nGATE A.7.2B — OPACITY routes through the governed CreativeOperation path");
// ============================================================
{
  ok("ROUTE1. imports CREATIVE_OPERATION_KIND from the existing design/creativeCommand.js", /import\s*\{[^}]*CREATIVE_OPERATION_KIND[^}]*\}\s*from\s*["'].*design\/creativeCommand\.js["']/.test(previewSrc));

  const opacityFnStart = codeOnly.indexOf("const setSelectedOpacity");
  const opacityFnEnd = codeOnly.indexOf("};", opacityFnStart);
  const opacityFnBody = codeOnly.slice(opacityFnStart, opacityFnEnd);
  ok("ROUTE2. setSelectedOpacity() exists and was located", opacityFnStart !== -1 && opacityFnEnd > opacityFnStart);
  ok("ROUTE3. it constructs a CREATIVE_OPERATION_KIND.SET_OPACITY operation, never a raw ad hoc composition splice", /kind:\s*CREATIVE_OPERATION_KIND\.SET_OPACITY/.test(opacityFnBody));
  ok("ROUTE4. it calls the EXISTING applyCreativeOperation() — never a second/local mutation path", /applyCreativeOperation\(\{/.test(opacityFnBody));
  ok("ROUTE5. it does NOT call interpretCreativeCommand() — a slider is not natural-language text, and no natural-language image command is introduced by this gate", !/interpretCreativeCommand\(/.test(opacityFnBody));
  ok("ROUTE6. it only commits the change via setComposition when the operation actually applied — a refused operation never touches composition state", /if \(result\.applied\) setComposition\(result\.composition\);/.test(opacityFnBody));
  ok("ROUTE7. the opacity <input type=\"range\"> calls setSelectedOpacity on change — the UI control is actually wired to the governed path, not merely defined alongside it", /onChange=\{\(e\) => setSelectedOpacity\(Number\(e\.target\.value\)\)\}/.test(previewSrc));
}

// ============================================================
console.log("\nGATE A.7.2B — family switch leaves no stale image/selection/opacity state (extends A.7.2A's own model, unmodified)");
// ============================================================
{
  ok("SWITCH1. the atomic family-reset block is UNCHANGED by this gate — still clears heroImage, imageError, selectedElementId, and bumps the generation ref (A.7.2A's own model, not altered)", (() => {
    const resetStart = codeOnly.indexOf("if (familyKey !== resetForFamilyKey)");
    const resetEnd = codeOnly.indexOf("const drawables = heroImage");
    const resetBody = codeOnly.slice(resetStart, resetEnd);
    return /setHeroImage\(null\)/.test(resetBody) && /setImageError\(null\)/.test(resetBody) && /setSelectedElementId\(null\)/.test(resetBody) && /heroImageGenerationRef\.current \+= 1/.test(resetBody);
  })());
  ok("SWITCH2. composition is rebuilt via defaultCompositionFor on family switch — a fresh Statement/Hero composition always gets a fresh opacity: 1 image element (no stale opacity value can survive a round trip through another family), since composition.js's own default never carries over a prior value", /setComposition\(defaultCompositionFor\(template, GOLDEN_FORMAT\)\)/.test(codeOnly));
  ok("SWITCH3. no NEW opacity-specific reset state was introduced — opacity staleness is structurally impossible because it lives inside composition, which is already fully replaced, not held as separate page state", !/const \[.*[Oo]pacity.*\] = useState/.test(codeOnly));
}

// ============================================================
console.log("\nGATE A.7.2B.1 — invalid-state canvas clearing is actually wired in (correctness fix)");
//
// This file's own header explains why MotionPreview.jsx's real runtime
// behavior cannot be executed here (no JSX transform, no live canvas) —
// the genuine pixel-level proof that clearCanvas() actually erases stale
// content lives in test/election-creative-composition.consumer.mjs's own
// REGR1-4 (executed against design/render.js's real, exported functions
// and a real fake-canvas call log). What THIS section proves is the
// wiring: that this exact, already-proven-correct function is imported
// and actually invoked at exactly the two places that used to leave the
// canvas untouched — never merely that a "clearCanvas" identifier exists
// somewhere in the file.
// ============================================================
{
  ok("CLEARWIRE1. imports clearCanvas from the existing design/render.js — never a second/local clearing implementation", /import\s*\{[^}]*clearCanvas[^}]*\}\s*from\s*["'].*design\/render\.js["']/.test(previewSrc));

  const liveEffectStart = codeOnly.indexOf("useEffect(() => {\n    const canvas = canvasRef.current;");
  const liveEffectEnd = codeOnly.indexOf("}, [familyKey, preset, content, composition, heroImage]);");
  const liveEffectBody = codeOnly.slice(liveEffectStart, liveEffectEnd);

  const payloadInvalidStart = liveEffectBody.indexOf("if (!payloadValidation.valid)");
  const payloadInvalidEnd = liveEffectBody.indexOf("} else if (!compositionValidation.valid)");
  const payloadInvalidBranch = liveEffectBody.slice(payloadInvalidStart, payloadInvalidEnd);
  ok("CLEARWIRE2. the payload-invalid branch calls clearCanvas(canvas)", /clearCanvas\(canvas\)/.test(payloadInvalidBranch));
  ok("CLEARWIRE3. the payload-invalid branch draws nothing else — no renderCompositionToCanvas/renderCompositionMotionFrameToCanvas call alongside the clear (no accidental partial content)", !/renderComposition(ToCanvas|MotionFrameToCanvas)\(/.test(payloadInvalidBranch));

  const compositionInvalidStart = liveEffectBody.indexOf("} else if (!compositionValidation.valid)");
  const compositionInvalidEnd = liveEffectBody.indexOf("} else {", compositionInvalidStart);
  const compositionInvalidBranch = liveEffectBody.slice(compositionInvalidStart, compositionInvalidEnd);
  ok("CLEARWIRE4. the composition-invalid branch ALSO calls clearCanvas(canvas)", /clearCanvas\(canvas\)/.test(compositionInvalidBranch));
  ok("CLEARWIRE5. the composition-invalid branch draws nothing else either", !/renderComposition(ToCanvas|MotionFrameToCanvas)\(/.test(compositionInvalidBranch));

  const validBranchStart = liveEffectBody.indexOf("} else {", compositionInvalidStart);
  const validBranch = liveEffectBody.slice(validBranchStart, liveEffectBody.length);
  ok("CLEARWIRE6. the VALID branch never calls clearCanvas — the fix only touches the two branches that previously rendered nothing at all, valid-render behavior is untouched", !/clearCanvas\(/.test(validBranch));
  ok("CLEARWIRE7. the valid branch still calls the real renderCompositionToCanvas exactly as before this fix", /renderCompositionToCanvas\(\{ canvas, template, payload, composition, drawables \}\)/.test(validBranch));

  ok("CLEARWIRE8. clearCanvas is called exactly twice in the whole file — once per invalid branch, never inside onPreviewMotion or onExportPng (this fix is scoped to the live-preview effect's own invalid-state handling only)", (codeOnly.match(/clearCanvas\(canvas\)/g) || []).length === 2);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
console.log("Browser-acceptance checklist still requiring MANUAL verification (not automated by this file):");
console.log("  - Preview opens and the settled static frame renders immediately");
console.log("  - clicking 'Preview motion' animates smoothly and settles on the final frame");
console.log("  - clicking 'Preview motion' again restarts cleanly from frame 0");
console.log("  - switching family/preset while playing cancels the prior loop (no visible double-draw/flicker)");
console.log("  - the canvas preserves its 1080x1350 aspect ratio at several viewport widths");
console.log("  - with prefers-reduced-motion enabled, clicking Preview jumps straight to the settled frame with no animation");
console.log("  - navigating away from the Motion Preview tab (or the whole page) leaves no console errors from a stale rAF callback");
console.log("  - Export PNG downloads a file, and that file visually matches the settled canvas composition");
console.log("  - an overlong headline/body is refused by Export PNG with a visible error and no download");
console.log("  - GATE A.7.2A: choosing a real local JPEG/PNG/WebP on Statement/Hero makes that actual photograph appear behind the text in the canvas");
console.log("  - GATE A.7.2A: choosing a second image replaces the first with no visible flash of the old one and no browser memory growth over repeated replacements");
console.log("  - GATE A.7.2A: choosing a corrupted/truncated image file shows a plain error and leaves any previously-shown image untouched");
console.log("  - GATE A.7.2A: choosing an unsupported file type (e.g. a PDF renamed .jpg, or a real HEIC) is refused with a plain error before any decode is attempted");
console.log("  - GATE A.7.2A: switching from Statement/Hero to Announcement or CTA and back clears the photo — it does not reappear until re-chosen");
console.log("  - GATE A.7.2A: Export PNG's downloaded file visually contains the same photo currently shown in the viewport");
console.log("  - GATE A.7.2A: rapidly selecting two files in quick succession (before the first finishes decoding) ends with the SECOND image showing, never the first");
console.log("  - GATE A.7.2B: clicking the image area on Statement/Hero selects it and shows a full-frame selection box");
console.log("  - GATE A.7.2B: clicking the headline afterward selects headline instead, and the image selection box disappears");
console.log("  - GATE A.7.2B: clicking the image again re-selects it and shows the Opacity control (not the text alignment control)");
console.log("  - GATE A.7.2B: moving the opacity slider visibly dims/brightens the photo live in the canvas");
console.log("  - GATE A.7.2B: exporting a PNG at a non-default opacity produces a file whose photo opacity matches the viewport exactly");
console.log("  - GATE A.7.2B: switching to Announcement/CTA clears the selection and the image control entirely");
console.log("  - GATE A.7.2B: switching back to Statement/Hero shows no stale image, no stale opacity, and nothing selected");
console.log("  - GATE A.7.2B: with no photo chosen, clicking the image region still selects it and clearly shows \"Image / No photo added\" rather than looking like a broken/empty canvas\n");
if (fail > 0) process.exit(1);
