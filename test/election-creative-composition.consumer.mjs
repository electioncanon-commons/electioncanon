// ============================================================
// ELECTIONCANON — GATE A.6.1: creative composition foundation
//
// Exercises design/composition.js's defaultCompositionFor()/
// validateCreativeComposition() and design/render.js's new
// renderCompositionToCanvas() directly, with the same hand-rolled fake
// canvas precedent every other consumer test in this suite already uses
// (see test/election-motion-frame-render.consumer.mjs) — no live database,
// no real <canvas>, no DOM.
//
// THE CENTRAL PROOF this file carries: renderCompositionToCanvas() called
// with a DEFAULT composition (every element still at its own
// alignment:"left" default) must produce a BYTE-IDENTICAL fillRect/
// fillText/fillStyle sequence to renderTemplateToCanvas() — not "the test
// suite still passes," an explicit draw-call-by-draw-call diff across
// several representative fixtures, the same discipline Gate A.5.5.2's own
// static-equivalence section already established for
// renderMotionFrameToCanvas().
// ============================================================

import { renderTemplateToCanvas, renderCompositionToCanvas, renderCompositionMotionFrameToCanvas, computeElementSelectionBounds } from "../src/domains/election/design/render.js";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_FORMAT } from "../src/domains/election/design/templates.js";
import { MOTION_PRESET } from "../src/domains/election/design/motion.js";
import {
  ELEMENT_KIND, TEXT_ALIGNMENT,
  defaultCompositionFor, validateCreativeComposition,
} from "../src/domains/election/design/composition.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.6.1: creative composition foundation\n");

function fakeCanvas(width, height) {
  const calls = { fillRect: [], fillText: [], fillStyleHistory: [] };
  let fillStyle = null;
  let globalAlpha = 1;
  const ctx = {
    set fillStyle(v) { fillStyle = v; calls.fillStyleHistory.push(v); },
    get fillStyle() { return fillStyle; },
    set globalAlpha(v) { globalAlpha = v; },
    get globalAlpha() { return globalAlpha; },
    font: null, textBaseline: null,
    fillRect: (...args) => calls.fillRect.push(args),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y, font: ctx.font, alpha: ctx.globalAlpha }),
    measureText: (text) => ({ width: String(text).length * ((parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font || "")?.[1]) || 16)) * 0.55 }),
  };
  return { width, height, getContext: () => ctx, textBaseline: null, _calls: calls };
}

const STATEMENT_TEMPLATE = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
const ANNOUNCEMENT_TEMPLATE = CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT];

// ============================================================
console.log("defaultCompositionFor()");
// ============================================================
{
  const format = CREATIVE_FORMAT.PORTRAIT;
  const composition = defaultCompositionFor(STATEMENT_TEMPLATE, format);

  ok("1. derives exactly one element per template.textSlots entry, in declared order", composition.elements.length === STATEMENT_TEMPLATE.textSlots.length && composition.elements.every((el, i) => el.role === STATEMENT_TEMPLATE.textSlots[i].id));
  ok("2. id equals role for every V1 element", composition.elements.every((el) => el.id === el.role));
  ok("3. every element defaults to alignment: left", composition.elements.every((el) => el.kind === ELEMENT_KIND.TEXT && el.properties.alignment === TEXT_ALIGNMENT.LEFT));
  ok("4. defaultCompositionFor() never mutates the template object", (() => {
    const before = JSON.stringify(STATEMENT_TEMPLATE);
    defaultCompositionFor(STATEMENT_TEMPLATE, format);
    return JSON.stringify(STATEMENT_TEMPLATE) === before;
  })());
  ok("14a. defaultCompositionFor() accepts no third argument to read campaign/asset/payload metadata from — its whole signature is (template, format)", defaultCompositionFor.length === 2);
}

// ============================================================
console.log("\nvalidateCreativeComposition()");
// ============================================================
{
  const format = CREATIVE_FORMAT.PORTRAIT;
  const valid = defaultCompositionFor(STATEMENT_TEMPLATE, format);

  ok("5. accepts a valid default composition", validateCreativeComposition({ composition: valid, template: STATEMENT_TEMPLATE }).valid === true);

  const unknownKind = { ...valid, elements: valid.elements.map((el, i) => (i === 0 ? { ...el, kind: "image" } : el)) };
  ok("6. rejects an unrecognised element kind", validateCreativeComposition({ composition: unknownKind, template: STATEMENT_TEMPLATE }).valid === false);

  const unknownRole = { ...valid, elements: valid.elements.map((el, i) => (i === 0 ? { ...el, id: "cta", role: "cta" } : el)) };
  ok("7. rejects an element role the template does not declare in textSlots", validateCreativeComposition({ composition: unknownRole, template: STATEMENT_TEMPLATE }).valid === false);

  const duplicateIds = { ...valid, elements: [valid.elements[0], { ...valid.elements[0] }] };
  ok("8. rejects duplicate element ids", validateCreativeComposition({ composition: duplicateIds, template: STATEMENT_TEMPLATE }).valid === false);

  const unknownProperty = { ...valid, elements: valid.elements.map((el, i) => (i === 0 ? { ...el, properties: { ...el.properties, color: "red" } } : el)) };
  ok("9. rejects an undeclared property key", validateCreativeComposition({ composition: unknownProperty, template: STATEMENT_TEMPLATE }).valid === false);

  const invalidAlignment = { ...valid, elements: valid.elements.map((el, i) => (i === 0 ? { ...el, properties: { alignment: "justify" } } : el)) };
  ok("10. rejects an invalid alignment value", validateCreativeComposition({ composition: invalidAlignment, template: STATEMENT_TEMPLATE }).valid === false);

  ok("11a. rejects a non-object composition", validateCreativeComposition({ composition: "not-an-object", template: STATEMENT_TEMPLATE }).valid === false);
  ok("11b. rejects a composition whose `elements` field is not an array", validateCreativeComposition({ composition: { ...valid, elements: "nope" }, template: STATEMENT_TEMPLATE }).valid === false);
  ok("11c. rejects a composition missing an element for a declared slot — the exact structural completeness check that makes an invalid V1 composition impossible to pass", validateCreativeComposition({ composition: { ...valid, elements: valid.elements.slice(1) }, template: STATEMENT_TEMPLATE }).valid === false);

  ok("12a. rejects a composition whose templateId does not match the SELECTED template (never trusted from the composition alone)", validateCreativeComposition({ composition: { ...valid, templateId: "some-other-template" }, template: STATEMENT_TEMPLATE }).valid === false);
  ok("12b. rejects a composition whose format is not a recognised CREATIVE_FORMAT value", validateCreativeComposition({ composition: { ...valid, format: "widescreen" }, template: STATEMENT_TEMPLATE }).valid === false);
  ok("12c. rejects a composition whose format IS a real CREATIVE_FORMAT but the template does not declare support for it", (() => {
    const fakeTemplate = { ...STATEMENT_TEMPLATE, formats: [CREATIVE_FORMAT.SQUARE] };
    return validateCreativeComposition({ composition: { ...valid, format: CREATIVE_FORMAT.STORY }, template: fakeTemplate }).valid === false;
  })());
}

// ============================================================
console.log("\nComposition / PublicCreativePayload separation");
// ============================================================
{
  const composition = defaultCompositionFor(STATEMENT_TEMPLATE, CREATIVE_FORMAT.PORTRAIT);
  const payload = { content: { headline: "x" }, visual: {}, identity: {} };
  ok("13. CreativeComposition and PublicCreativePayload are structurally distinct objects — no field name collides between them", !Object.keys(composition).some((k) => Object.keys(payload).includes(k)));

  const compositionSrc = readFileSync(fileURLToPath(new URL("../src/domains/election/design/composition.js", import.meta.url)), "utf8");
  const compositionCodeOnly = compositionSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("14b. design/composition.js's CODE never references payload/content/campaign/asset field names (brief, created_by, campaignId, userId, campaign_studio_assets) — it reads nothing beyond template.textSlots", !/\b(brief|created_by|reviewer_id|approver_id|campaignId|userId|campaign_studio_assets)\b/.test(compositionCodeOnly));
  ok("no DOM access in design/composition.js — a structurally-enforced DOM-free boundary", !/document\.|window\.|requestAnimationFrame|setInterval|Date\.now\(/.test(compositionCodeOnly));
  ok("no Supabase/persistence import in design/composition.js", !/lib\/supabase\.js|assetsApi|design\/assets\.js/.test(compositionSrc));
  ok("20a. design/composition.js never imports the legacy Design-tab modules (CampaignStudioSection.jsx, design/assets.js, lib/supabase.js) — this new seam is fully isolated from the legacy/persisted path", !/CampaignStudioSection/.test(compositionSrc));
}

// ============================================================
console.log("\nStatic equivalence — renderCompositionToCanvas(default) === renderTemplateToCanvas()");
// ============================================================
{
  const FIXTURES = [
    {
      name: "A. Statement/Hero default composition",
      template: STATEMENT_TEMPLATE,
      payload: { content: { headline: "Every vote counts", body: "Register before Friday" }, visual: {}, identity: {} },
    },
    {
      name: "B. Statement/Hero with the optional body slot absent",
      template: STATEMENT_TEMPLATE,
      payload: { content: { headline: "Every vote counts", body: null }, visual: {}, identity: {} },
    },
    {
      name: "C. Announcement default composition",
      template: ANNOUNCEMENT_TEMPLATE,
      payload: { content: { headline: "Rally this Saturday", body: "Doors open at 9am." }, visual: {}, identity: {} },
    },
    {
      name: "D. Announcement wrapping multi-line fixture",
      template: ANNOUNCEMENT_TEMPLATE,
      payload: {
        content: {
          headline: "Rally this Saturday in every single ward across the whole state",
          body: "Doors open at 9am and every registered voter with a valid card is welcome to attend the full programme of events planned for the day.",
        },
        visual: {}, identity: {},
      },
    },
    {
      name: "E. Statement/Hero with a brand footer present",
      template: STATEMENT_TEMPLATE,
      payload: { content: { headline: "Every vote counts", body: "Register before Friday" }, visual: {}, identity: { brand: "ElectionCanon" } },
    },
  ];

  for (const fx of FIXTURES) {
    const format = fx.template.formats[0];
    const composition = defaultCompositionFor(fx.template, format);

    const staticCanvas = fakeCanvas(1080, 1350);
    renderTemplateToCanvas({ canvas: staticCanvas, template: fx.template, payload: fx.payload });

    const compCanvas = fakeCanvas(1080, 1350);
    renderCompositionToCanvas({ canvas: compCanvas, template: fx.template, payload: fx.payload, composition });

    ok(`15. [${fx.name}] fillRect calls are byte-identical`, JSON.stringify(staticCanvas._calls.fillRect) === JSON.stringify(compCanvas._calls.fillRect));
    ok(`15. [${fx.name}] fillText calls are byte-identical`, JSON.stringify(staticCanvas._calls.fillText) === JSON.stringify(compCanvas._calls.fillText));
    ok(`15. [${fx.name}] fillStyle history is byte-identical`, JSON.stringify(staticCanvas._calls.fillStyleHistory) === JSON.stringify(compCanvas._calls.fillStyleHistory));
  }
}

// ============================================================
console.log("\nalignment:center changes ONLY the intended element's horizontal placement");
// ============================================================
{
  const fx = { template: STATEMENT_TEMPLATE, payload: { content: { headline: "Every vote counts", body: "Register before Friday" }, visual: {}, identity: {} } };
  const format = fx.template.formats[0];
  const defaultComposition = defaultCompositionFor(fx.template, format);
  const centeredComposition = {
    ...defaultComposition,
    elements: defaultComposition.elements.map((el) => (el.role === "headline" ? { ...el, properties: { alignment: TEXT_ALIGNMENT.CENTER } } : el)),
  };

  const leftCanvas = fakeCanvas(1080, 1350);
  renderCompositionToCanvas({ canvas: leftCanvas, template: fx.template, payload: fx.payload, composition: defaultComposition });
  const centerCanvas = fakeCanvas(1080, 1350);
  renderCompositionToCanvas({ canvas: centerCanvas, template: fx.template, payload: fx.payload, composition: centeredComposition });

  const leftHeadline = leftCanvas._calls.fillText.find((c) => c.text.includes("Every vote counts"));
  const centerHeadline = centerCanvas._calls.fillText.find((c) => c.text.includes("Every vote counts"));
  const leftBody = leftCanvas._calls.fillText.find((c) => c.text.includes("Register"));
  const centerBody = centerCanvas._calls.fillText.find((c) => c.text.includes("Register"));

  ok("16a. the centered headline's x actually changes", centerHeadline.x !== leftHeadline.x);
  ok("16b. the centered headline's y is unchanged", centerHeadline.y === leftHeadline.y);
  ok("16c. the centered headline's font is unchanged", centerHeadline.font === leftHeadline.font);
  ok("16d. the centered headline's text content is unchanged", centerHeadline.text === leftHeadline.text);
  ok("17. wrapping/position of the UNCHANGED body element (still left-aligned) is completely untouched by an unrelated element's alignment change", centerBody.x === leftBody.x && centerBody.y === leftBody.y && centerBody.text === leftBody.text);
  ok("18. background fillRect calls remain identical when only an element's alignment changes", JSON.stringify(leftCanvas._calls.fillRect) === JSON.stringify(centerCanvas._calls.fillRect));
}

// ============================================================
console.log("\nBrand treatment is unaffected by composition/alignment");
// ============================================================
{
  const fx = { template: STATEMENT_TEMPLATE, payload: { content: { headline: "Every vote counts", body: "Register before Friday" }, visual: {}, identity: { brand: "ElectionCanon" } } };
  const format = fx.template.formats[0];
  const defaultComposition = defaultCompositionFor(fx.template, format);
  const centeredComposition = {
    ...defaultComposition,
    elements: defaultComposition.elements.map((el) => (el.role === "headline" ? { ...el, properties: { alignment: TEXT_ALIGNMENT.CENTER } } : el)),
  };

  const c1 = fakeCanvas(1080, 1350);
  renderCompositionToCanvas({ canvas: c1, template: fx.template, payload: fx.payload, composition: defaultComposition });
  const c2 = fakeCanvas(1080, 1350);
  renderCompositionToCanvas({ canvas: c2, template: fx.template, payload: fx.payload, composition: centeredComposition });

  const brand1 = c1._calls.fillText.find((c) => c.text === "ElectionCanon");
  const brand2 = c2._calls.fillText.find((c) => c.text === "ElectionCanon");
  ok("19. the brand footer's position/text/font/alpha are unaffected by an unrelated element's alignment change", JSON.stringify(brand1) === JSON.stringify(brand2));
}

// ============================================================
console.log("\nLegacy rendering remains untouched");
// ============================================================
{
  const renderSrc = readFileSync(fileURLToPath(new URL("../src/domains/election/design/render.js", import.meta.url)), "utf8");
  ok("20b. renderTemplateToCanvas() still has its own original, unchanged signature — {canvas, template, payload}, no composition/frame argument", /export function renderTemplateToCanvas\(\{\s*canvas,\s*template,\s*payload\s*=\s*\{\}\s*\}\)/.test(renderSrc));
  ok("20c. renderMotionFrameToCanvas() is untouched by this gate — still present with its own original signature", /export function renderMotionFrameToCanvas\(\{\s*canvas,\s*template,\s*payload\s*=\s*\{\},\s*motionSpec,\s*frameIndex,\s*totalFrames\s*\}\)/.test(renderSrc));
  // Point 15's fixtures above are the direct, executable proof that
  // renderTemplateToCanvas() itself produces unchanged output — this
  // section only additionally confirms its public signature was not
  // altered to accommodate the new composition renderer.
}

// ============================================================
console.log("\nElement selection geometry (Gate A.6.3) — reuses the SAME layout source, never a second calculation");
// ============================================================
{
  const template = STATEMENT_TEMPLATE;
  const content = { headline: "Every vote counts", body: "Register before Friday" };

  const staticCanvas = fakeCanvas(1080, 1350);
  renderTemplateToCanvas({ canvas: staticCanvas, template, payload: { content, visual: {}, identity: {} } });
  const headlineDraw = staticCanvas._calls.fillText.find((c) => c.text.includes("Every vote counts"));

  const geometryCanvas = fakeCanvas(1080, 1350);
  const bounds = computeElementSelectionBounds({ canvas: geometryCanvas, template, content });
  const headlineBounds = bounds.find((b) => b.role === "headline");
  const bodyBounds = bounds.find((b) => b.role === "body");

  ok("SEL1. the headline element IS selectable — a bounding box exists for it when its content is present", !!headlineBounds);
  ok("SEL2. the body element is also selectable when its content is present", !!bodyBounds);
  ok("SEL3. the headline bounding box's top (y) is EXACTLY where renderTemplateToCanvas() actually drew the headline — same layout source, not a second, independently-computed position", headlineBounds.y === headlineDraw.y);
  ok("SEL4. the body element's box starts strictly below the headline's box — the two never overlap vertically", bodyBounds.y >= headlineBounds.y + headlineBounds.height);
  ok("SEL5. no bounding box exists for a slot with no content", (() => {
    const sparseBounds = computeElementSelectionBounds({ canvas: fakeCanvas(1080, 1350), template, content: { headline: "Only a headline", body: null } });
    return sparseBounds.length === 1 && sparseBounds[0].role === "headline";
  })());

  const renderSrc = readFileSync(fileURLToPath(new URL("../src/domains/election/design/render.js", import.meta.url)), "utf8");
  const fnStart = renderSrc.indexOf("export function computeElementSelectionBounds");
  const fnEnd = renderSrc.indexOf("\n}", fnStart);
  const fnBody = renderSrc.slice(fnStart, fnEnd);
  ok("SEL6. computeElementSelectionBounds() calls the EXISTING computeTextLayout() — it does not reimplement layout", /computeTextLayout\(/.test(fnBody));
  ok("SEL7. no second layout calculation exists — this function contains no `for (const slot of template.textSlots)` loop of its own (that loop belongs to computeTextLayout() alone)", !/for\s*\(\s*const\s+slot\s+of\s+template\.textSlots\s*\)/.test(fnBody));
  ok("SEL8. computeElementSelectionBounds() never calls wrapText() or creativeFont() directly — all font/wrapping decisions stay inside computeTextLayout()", !/\bwrapText\(|\bcreativeFont\(/.test(fnBody));
}

// ============================================================
console.log("\nUnified static/motion composition pipeline (Gate A.6.5) — the settled motion frame equals the static composition");
// ============================================================
{
  const fx = { template: STATEMENT_TEMPLATE, payload: { content: { headline: "Every vote counts", body: "Register before Friday" }, visual: {}, identity: {} } };
  const format = fx.template.formats[0];
  const motionSpec = { preset: MOTION_PRESET.FADE, durationMs: 1800, fps: 30, loop: false };

  for (const alignment of ["left", "center"]) {
    const composition = {
      ...defaultCompositionFor(fx.template, format),
      elements: defaultCompositionFor(fx.template, format).elements.map((el) => (el.role === "headline" ? { ...el, properties: { alignment } } : el)),
    };

    const staticCanvas = fakeCanvas(1080, 1350);
    renderCompositionToCanvas({ canvas: staticCanvas, template: fx.template, payload: fx.payload, composition });

    // totalFrames <= 1 makes design/timing.js's own resolveProgress()
    // resolve to progress 1 unconditionally — the exact same "settled"
    // state a completed, non-looping animation ends on.
    const settledMotionCanvas = fakeCanvas(1080, 1350);
    renderCompositionMotionFrameToCanvas({ canvas: settledMotionCanvas, template: fx.template, payload: fx.payload, composition, motionSpec, frameIndex: 0, totalFrames: 1 });

    ok(`MOTION1. [alignment: ${alignment}] the settled motion frame's fillText calls are byte-identical to the static composition render`, JSON.stringify(staticCanvas._calls.fillText) === JSON.stringify(settledMotionCanvas._calls.fillText));
    ok(`MOTION2. [alignment: ${alignment}] the settled motion frame's fillRect (background) calls are byte-identical to the static composition render`, JSON.stringify(staticCanvas._calls.fillRect) === JSON.stringify(settledMotionCanvas._calls.fillRect));
  }

  // The selected element's alignment must survive mid-animation too, not
  // only at the settled frame — a centered headline stays centered at
  // every frame of its own fade/slide, it does not silently reset to left.
  const centeredComposition = {
    ...defaultCompositionFor(fx.template, format),
    elements: defaultCompositionFor(fx.template, format).elements.map((el) => (el.role === "headline" ? { ...el, properties: { alignment: "center" } } : el)),
  };
  const leftComposition = defaultCompositionFor(fx.template, format);

  const midFrameCentered = fakeCanvas(1080, 1350);
  renderCompositionMotionFrameToCanvas({ canvas: midFrameCentered, template: fx.template, payload: fx.payload, composition: centeredComposition, motionSpec, frameIndex: 15, totalFrames: 30 });
  const midFrameLeft = fakeCanvas(1080, 1350);
  renderCompositionMotionFrameToCanvas({ canvas: midFrameLeft, template: fx.template, payload: fx.payload, composition: leftComposition, motionSpec, frameIndex: 15, totalFrames: 30 });

  const centeredHeadlineMid = midFrameCentered._calls.fillText.find((c) => c.text.includes("Every vote counts"));
  const leftHeadlineMid = midFrameLeft._calls.fillText.find((c) => c.text.includes("Every vote counts"));
  ok("MOTION3. the selected alignment is preserved mid-animation, not just at the settled frame", centeredHeadlineMid.x !== leftHeadlineMid.x);
  ok("MOTION4. mid-animation alpha (fade progress) is identical regardless of alignment — alignment affects only x, never the motion timing/opacity itself", centeredHeadlineMid.alpha === leftHeadlineMid.alpha);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
