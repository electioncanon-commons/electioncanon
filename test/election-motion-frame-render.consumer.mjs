// ============================================================
// ELECTIONCANON — GATE A.5.5.2: deterministic motion frame renderer
//
// Exercises design/render.js's new renderMotionFrameToCanvas() and its
// shared layout extraction (computeTextLayout/computeBrandLine, private
// to render.js) directly, with no live database, no real <canvas>, no
// wall-clock time anywhere — same hand-rolled-fake-canvas precedent as
// every other consumer test in this suite.
//
// THE CENTRAL STATIC-REGRESSION PROOF this file carries: the four
// GOLDEN_* fixtures below are the EXACT fillRect/fillText/fillStyle
// sequences captured from renderTemplateToCanvas() BEFORE the Gate
// A.5.5.2 shared-layout extraction (captured via this same fake-canvas
// harness, saved as literal JSON, never regenerated from the refactored
// code — see "14 — static render behavior has not changed" below). This
// is not "the test suite still passes" — it is an explicit, byte-for-byte
// diff against a pre-refactor snapshot.
// ============================================================

import {
  renderTemplateToCanvas, renderMotionFrameToCanvas,
} from "../src/domains/election/design/render.js";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, TEMPLATES, ASSET_TYPE } from "../src/domains/election/design/templates.js";
import { buildCommunicationCreativePayload } from "../src/domains/election/design/creative.js";
import { MOTION_PRESET } from "../src/domains/election/design/motion.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.5.2: deterministic motion frame renderer\n");

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

function easeOutCubic(t) { const c = Math.min(Math.max(t, 0), 1); return 1 - Math.pow(1 - c, 3); }

const CTA_TEMPLATE = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
const STATEMENT_TEMPLATE = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
const CTA_PAYLOAD = Object.freeze({
  content: { headline: "Your campaign is too big for WhatsApp.", body: "Your campaign has people everywhere.", cta: "Prepare. Organize. Coordinate. Observe. Respond." },
  visual: {}, identity: {},
});

// ============================================================
console.log("1 — same inputs, same frameIndex produce identical drawing operations");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false };
  const c1 = fakeCanvas(1080, 1080);
  const c2 = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: c1, template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex: 5, totalFrames: 21 });
  renderMotionFrameToCanvas({ canvas: c2, template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex: 5, totalFrames: 21 });
  ok("1a. two independent renders of the same frame produce byte-identical drawing operations", JSON.stringify(c1._calls) === JSON.stringify(c2._calls));

  const c3 = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: c3, template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex: 6, totalFrames: 21 });
  ok("1b. a DIFFERENT frameIndex produces DIFFERENT operations (sanity check the harness can detect a real difference)", JSON.stringify(c1._calls) !== JSON.stringify(c3._calls));
}

// ============================================================
console.log("\n2/3 — fade: frame 0 / middle / final have deterministic, correctly-ordered opacity");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false };
  const payload = { content: { headline: "Turnout wins elections." }, visual: {}, identity: {} };
  const alphaAt = (frameIndex) => {
    const canvas = fakeCanvas(1080, 1080);
    renderMotionFrameToCanvas({ canvas, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex, totalFrames: 11 });
    return canvas._calls.fillText[0].alpha;
  };
  const alpha0 = alphaAt(0), alpha5 = alphaAt(5), alpha10 = alphaAt(10);
  ok("2a. frame 0 is fully transparent (alpha === 0)", alpha0 === 0);
  ok("2b. the final frame is fully opaque (alpha === 1)", alpha10 === 1);
  ok("3a. opacity strictly increases: start < midpoint < end", alpha0 < alpha5 && alpha5 < alpha10);
  ok("3b. the midpoint matches the exact code-defined easeOutCubic(0.5) value, not an approximation", alpha5 === easeOutCubic(0.5));
  ok("2c. fade never moves position — x/y are identical across all three frames", (() => {
    const c0 = fakeCanvas(1080, 1080); renderMotionFrameToCanvas({ canvas: c0, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex: 0, totalFrames: 11 });
    const c10 = fakeCanvas(1080, 1080); renderMotionFrameToCanvas({ canvas: c10, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex: 10, totalFrames: 11 });
    return c0._calls.fillText[0].x === c10._calls.fillText[0].x && c0._calls.fillText[0].y === c10._calls.fillText[0].y;
  })());
}

// ============================================================
console.log("\n4 — slideUp: affected content begins displaced and reaches canonical layout position");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.SLIDE_UP, durationMs: 1500, fps: 30, loop: false };
  const payload = { content: { headline: "Turnout wins elections." }, visual: {}, identity: {} };

  const staticCanvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas: staticCanvas, template: STATEMENT_TEMPLATE, payload });
  const canonicalY = staticCanvas._calls.fillText[0].y;

  const firstFrame = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: firstFrame, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex: 0, totalFrames: 11 });
  const lastFrame = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: lastFrame, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex: 10, totalFrames: 11 });

  ok("4a. frame 0 is displaced BELOW (larger y than) its canonical static position", firstFrame._calls.fillText[0].y > canonicalY);
  ok("4b. the final frame reaches EXACTLY the canonical static layout position — same y as the static renderer produces", lastFrame._calls.fillText[0].y === canonicalY);
  ok("4c. x never changes — only y is offset by slideUp", firstFrame._calls.fillText[0].x === lastFrame._calls.fillText[0].x);
  ok("4d. slideUp also fades in (alpha 0 at frame 0, alpha 1 at the final frame), not just a position change", firstFrame._calls.fillText[0].alpha === 0 && lastFrame._calls.fillText[0].alpha === 1);
}

// ============================================================
console.log("\n5 — staggerLines: deterministic sequencing, in declared slot order");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.STAGGER_LINES, durationMs: 3000, fps: 30, loop: false };
  const alphasAt = (frameIndex, totalFrames) => {
    const canvas = fakeCanvas(1080, 1080);
    renderMotionFrameToCanvas({ canvas, template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex, totalFrames });
    const bySlot = {};
    for (const call of canvas._calls.fillText) bySlot[call.text] = call.alpha;
    return {
      headline: canvas._calls.fillText.find((c) => c.text.includes("WhatsApp"))?.alpha,
      body: canvas._calls.fillText.find((c) => c.text.includes("everywhere"))?.alpha,
      cta: canvas._calls.fillText.find((c) => c.text.includes("Prepare"))?.alpha,
    };
  };

  const totalFrames = 31; // 30 divides cleanly into 3 equal windows of 10 frames each
  const start = alphasAt(0, totalFrames);
  ok("5a. at frame 0, nothing has appeared yet", start.headline === 0 && start.body === 0 && start.cta === 0);

  // Roughly 1/6 of the way through — inside the headline's own window
  // (window 1 of 3: [0, 1/3)), well before body's window starts.
  const early = alphasAt(5, totalFrames);
  ok("5b. early in the sequence, ONLY the first declared slot (headline) is revealing — body and cta have not started", early.headline > 0 && early.body === 0 && early.cta === 0);

  // Roughly the midpoint — inside body's own window (window 2: [1/3, 2/3)).
  const middle = alphasAt(15, totalFrames);
  ok("5c. by the midpoint, headline has FINISHED (alpha 1), body is revealing, cta has not started", middle.headline === 1 && middle.body > 0 && middle.body < 1 && middle.cta === 0);

  const end = alphasAt(30, totalFrames);
  ok("5d. by the final frame, every slot has fully appeared", end.headline === 1 && end.body === 1 && end.cta === 1);

  ok("5e. no position offset is applied by staggerLines — only opacity", (() => {
    const staticCanvas = fakeCanvas(1080, 1080);
    renderTemplateToCanvas({ canvas: staticCanvas, template: CTA_TEMPLATE, payload: CTA_PAYLOAD });
    const midCanvas = fakeCanvas(1080, 1080);
    renderMotionFrameToCanvas({ canvas: midCanvas, template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex: 15, totalFrames });
    return JSON.stringify(staticCanvas._calls.fillText.map((c) => ({ x: c.x, y: c.y }))) === JSON.stringify(midCanvas._calls.fillText.map((c) => ({ x: c.x, y: c.y })));
  })());
}

// ============================================================
console.log("\n6 — unsupported preset/template combinations cannot be rendered");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.STAGGER_LINES, durationMs: 1500, fps: 30, loop: false };
  let threw = false;
  try {
    renderMotionFrameToCanvas({ canvas: fakeCanvas(1080, 1080), template: STATEMENT_TEMPLATE, payload: { content: { headline: "H" }, visual: {}, identity: {} }, motionSpec: spec, frameIndex: 0, totalFrames: 10 });
  } catch { threw = true; }
  ok("6. Statement/Hero does not support staggerLines — renderMotionFrameToCanvas() refuses (throws) rather than silently drawing anything", threw);
}

// ============================================================
console.log("\n7 — invalid MotionSpecification cannot be rendered");
// ============================================================
{
  const cases = [
    ["malformed (null)", null],
    ["unknown preset", { preset: "zoomWhirl", durationMs: 1500, fps: 30, loop: false }],
    ["duration below bounds", { preset: MOTION_PRESET.FADE, durationMs: 1, fps: 30, loop: false }],
    ["duration above bounds", { preset: MOTION_PRESET.FADE, durationMs: 99999, fps: 30, loop: false }],
    ["invalid fps", { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 60, loop: false }],
    ["invalid loop", { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: "yes" }],
  ];
  for (const [label, spec] of cases) {
    let threw = false;
    try { renderMotionFrameToCanvas({ canvas: fakeCanvas(1080, 1080), template: CTA_TEMPLATE, payload: CTA_PAYLOAD, motionSpec: spec, frameIndex: 0, totalFrames: 10 }); }
    catch { threw = true; }
    ok(`7. ${label} — renderMotionFrameToCanvas() refuses before drawing anything`, threw);
  }
}

// ============================================================
console.log("\n8/9/10 — frameIndex/totalFrames bounds handled safely; single-frame is deterministic");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false };
  const payload = { content: { headline: "H" }, visual: {}, identity: {} };
  const alphaFor = (frameIndex, totalFrames) => {
    const canvas = fakeCanvas(1080, 1080);
    renderMotionFrameToCanvas({ canvas, template: STATEMENT_TEMPLATE, payload, motionSpec: spec, frameIndex, totalFrames });
    return canvas._calls.fillText[0].alpha;
  };

  ok("8a. a negative frameIndex never throws and clamps to frame 0 (alpha 0)", alphaFor(-5, 11) === 0);
  ok("8b. a frameIndex far beyond totalFrames never throws and clamps to the final frame (alpha 1)", alphaFor(999, 11) === 1);
  ok("8c. a NaN frameIndex never throws and clamps safely (alpha 0)", alphaFor(NaN, 11) === 0);

  ok("9a. totalFrames <= 0 never throws and resolves to the fully-settled state (alpha 1)", alphaFor(0, 0) === 1 && alphaFor(0, -3) === 1);
  ok("9b. a non-integer totalFrames never throws", (() => { try { alphaFor(0, 1.7); return true; } catch { return false; } })());
  ok("9c. a NaN totalFrames never throws and resolves to the fully-settled state", alphaFor(0, NaN) === 1);

  ok("10a. totalFrames === 1 never divides by zero (no NaN/Infinity) and is fully settled", alphaFor(0, 1) === 1 && Number.isFinite(alphaFor(0, 1)));
  ok("10b. the single-frame case is deterministic across repeated calls", alphaFor(0, 1) === alphaFor(0, 1) && alphaFor(5, 1) === alphaFor(0, 1));
}

// ============================================================
console.log("\n11 — PublicCreativePayload remains unchanged");
// ============================================================
{
  const payload = buildCommunicationCreativePayload({ communication: { title: "Election Day Reminder" }, languageVariant: { text: "Polls open 8am." }, identity: {} });
  ok("11a. the payload built by design/creative.js is still EXACTLY {content, visual, identity} — no `motion` field was added to it", Object.keys(payload).sort().join(",") === "content,identity,visual");

  const frozen = Object.freeze(JSON.parse(JSON.stringify(payload)));
  const before = JSON.stringify(frozen);
  const spec = { preset: MOTION_PRESET.FADE, durationMs: 1500, fps: 30, loop: false };
  renderMotionFrameToCanvas({ canvas: fakeCanvas(1080, 1080), template: CTA_TEMPLATE, payload: frozen, motionSpec: spec, frameIndex: 3, totalFrames: 10 });
  ok("11b. renderMotionFrameToCanvas() never mutates the payload it is given (a frozen payload survives unmutated)", JSON.stringify(frozen) === before);
}

// ============================================================
console.log("\n12 — no internal campaign fields are accepted by the motion renderer");
// ============================================================
{
  const FAKE_COMMUNICATION = { title: "Your campaign is too big for WhatsApp.", brief: "INTERNAL: target swing wards", created_by: "user-a52owner", status: "draft", review_metadata: { reviewer_id: "user-reviewer-99" } };
  const FAKE_VARIANT = { text: "Your campaign has people everywhere.", status: "approved", created_by: "user-drafter-42", reviewer_id: "user-reviewer-99", approver_id: "user-approver-77" };
  const payload = buildCommunicationCreativePayload({ communication: FAKE_COMMUNICATION, languageVariant: FAKE_VARIANT, identity: { brand: "ElectionCanon" } });
  const spec = { preset: MOTION_PRESET.STAGGER_LINES, durationMs: 3000, fps: 30, loop: false };

  const forbidden = ["INTERNAL: target swing wards", "user-a52owner", "draft", "user-reviewer-99", "user-drafter-42", "user-approver-77"];
  let allTexts = [];
  for (let frameIndex = 0; frameIndex < 10; frameIndex++) {
    const canvas = fakeCanvas(1080, 1080);
    renderMotionFrameToCanvas({ canvas, template: CTA_TEMPLATE, payload, motionSpec: spec, frameIndex, totalFrames: 10 });
    allTexts.push(...canvas._calls.fillText.map((c) => c.text));
  }
  const joined = allTexts.join(" | ");
  ok("12. across every frame, no internal field (brief/created_by/status/reviewer_id/approver_id) is ever drawn — only the governed headline/body/brand", forbidden.every((v) => !joined.includes(v)));
}

// ============================================================
console.log("\n13 — identity.brand remains opt-in and preset-independent");
// ============================================================
{
  const spec = { preset: MOTION_PRESET.STAGGER_LINES, durationMs: 3000, fps: 30, loop: false };
  const noBrand = { content: { headline: "H", body: "B", cta: "C" }, visual: {}, identity: {} };
  const withBrand = { content: { headline: "H", body: "B", cta: "C" }, visual: {}, identity: { brand: "ElectionCanon" } };

  const canvasNoBrand = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: canvasNoBrand, template: CTA_TEMPLATE, payload: noBrand, motionSpec: spec, frameIndex: 30, totalFrames: 31 });
  ok("13a. with no identity.brand, no footer is ever drawn, even at the final frame", !canvasNoBrand._calls.fillText.some((c) => c.text === "ElectionCanon"));

  // progress = 15/30 = 0.5 falls INSIDE body's own staggerLines window
  // (headline already fully done). Brand's own fade must ignore that
  // windowing entirely and simply equal easeOutCubic(0.5) directly.
  const canvasMid = fakeCanvas(1080, 1080);
  renderMotionFrameToCanvas({ canvas: canvasMid, template: CTA_TEMPLATE, payload: withBrand, motionSpec: spec, frameIndex: 15, totalFrames: 31 });
  const brandCall = canvasMid._calls.fillText.find((c) => c.text === "ElectionCanon");
  ok("13b. identity.brand IS drawn when explicitly supplied", !!brandCall);
  ok("13c. brand's own fade is preset-independent — exactly easeOutCubic(progress), unaffected by the main content's staggerLines windowing", brandCall.alpha === easeOutCubic(15 / 30));
}

// ============================================================
console.log("\n14 — static render behavior matches the CURRENT deterministic baseline (explicit equivalence, updated for Gate A.6.7)");
// ============================================================
{
  // GATE A.6.7 — these literal values were DELIBERATELY updated from the
  // original Gate A.5.5.2 baseline: bounded vertical centering
  // (computeContentStartY(), render.js) intentionally moved every one of
  // these fixtures' start-Y position from the old fixed `canvasHeight *
  // 0.12` anchor to a centered (or, for genuinely dense content, still
  // 12%-anchored) position. This is the new, intentional regression
  // baseline — a future accidental change to the layout math is still
  // caught here, but this file no longer claims "nothing changed"; see
  // section 15 below for the explicit before/after proof that this WAS a
  // deliberate, bounded change, not a silent one. Still captured via this
  // SAME fake-canvas harness, still literal, still never live-regenerated
  // from the refactored code.
  const GOLDEN = {
    FIX1_cta_full_with_brand: { fillRect: [[0, 0, 1080, 1080]], fillStyleHistory: ["#F5A623", "#0D0D0F"], fillText: [{ text: "Your campaign is too big", x: 86.4, y: 405.4, font: "900 59px 'Poppins', sans-serif" }, { text: "for WhatsApp.", x: 86.4, y: 475.4, font: "900 59px 'Poppins', sans-serif" }, { text: "Your campaign has people everywhere.", x: 86.4, y: 567, font: "400 32px 'Poppins', sans-serif" }, { text: "Prepare. Organize. Coordinate. Observe. Respond.", x: 86.4, y: 631.6, font: "400 32px 'Poppins', sans-serif" }, { text: "ElectionCanon", x: 86.4, y: 993.6, font: "400 26px 'Poppins', sans-serif" }] },
    FIX2_statement_headline_only_no_brand: { fillRect: [[0, 0, 1080, 1350]], fillStyleHistory: ["#0A7F73", "#0D0D0F"], fillText: [{ text: "Turnout wins elections.", x: 86.4, y: 640, font: "900 59px 'Poppins', sans-serif" }] },
    FIX3_legacy_ward_meeting_4slots: { fillRect: [[0, 0, 1080, 1350]], fillStyleHistory: ["#FF2E63", "#0D0D0F"], fillText: [{ text: "Ward 7", x: 86.4, y: 556.6, font: "400 32px 'Poppins', sans-serif" }, { text: "Saturday 10am", x: 86.4, y: 621.2, font: "400 32px 'Poppins', sans-serif" }, { text: "Community Hall", x: 86.4, y: 685.8000000000001, font: "400 32px 'Poppins', sans-serif" }, { text: "Bring your voter card and questions.", x: 86.4, y: 750.4000000000001, font: "400 32px 'Poppins', sans-serif" }] },
    FIX4_long_wrapping_body: { fillRect: [[0, 0, 1080, 1080]], fillStyleHistory: ["#FF2E63", "#0D0D0F"], fillText: [{ text: "Announcement", x: 86.4, y: 365.2, font: "900 59px 'Poppins', sans-serif" }, { text: "word0 word1 word2 word3 word4 word5 word6 word7", x: 86.4, y: 456.8, font: "400 32px 'Poppins', sans-serif" }, { text: "word8 word9 word10 word11 word12 word13 word14", x: 86.4, y: 499.8, font: "400 32px 'Poppins', sans-serif" }, { text: "word15 word16 word17 word18 word19 word20 word21", x: 86.4, y: 542.8, font: "400 32px 'Poppins', sans-serif" }, { text: "word22 word23 word24 word25 word26 word27 word28", x: 86.4, y: 585.8, font: "400 32px 'Poppins', sans-serif" }, { text: "word29 word30 word31 word32 word33 word34 word35", x: 86.4, y: 628.8, font: "400 32px 'Poppins', sans-serif" }, { text: "word36 word37 word38 word39", x: 86.4, y: 671.8, font: "400 32px 'Poppins', sans-serif" }] },
  };

  function actual(template, payload, width, height) {
    const canvas = fakeCanvas(width, height);
    renderTemplateToCanvas({ canvas, template, payload });
    return { fillRect: canvas._calls.fillRect, fillStyleHistory: canvas._calls.fillStyleHistory, fillText: canvas._calls.fillText.map(({ text, x, y, font }) => ({ text, x, y, font })) };
  }

  const a1 = actual(CTA_TEMPLATE, { content: { headline: "Your campaign is too big for WhatsApp.", body: "Your campaign has people everywhere.", cta: "Prepare. Organize. Coordinate. Observe. Respond." }, visual: {}, identity: { brand: "ElectionCanon" } }, 1080, 1080);
  ok("14a. FIX1 (CTA, full payload + brand): renderTemplateToCanvas() output is byte-for-byte identical to the pre-extraction baseline", JSON.stringify(a1) === JSON.stringify(GOLDEN.FIX1_cta_full_with_brand));

  const a2 = actual(STATEMENT_TEMPLATE, { content: { headline: "Turnout wins elections.", body: null }, visual: {}, identity: {} }, 1080, 1350);
  ok("14b. FIX2 (Statement/Hero, headline only, no brand): identical to baseline", JSON.stringify(a2) === JSON.stringify(GOLDEN.FIX2_statement_headline_only_no_brand));

  const a3 = actual(TEMPLATES[ASSET_TYPE.WARD_MEETING_ANNOUNCEMENT], { content: { ward: "Ward 7", when: "Saturday 10am", where: "Community Hall", body: "Bring your voter card and questions." }, visual: {}, identity: {} }, 1080, 1350);
  ok("14c. FIX3 (a LEGACY 4-slot template, untouched by motion): identical to baseline — the extraction generalizes correctly beyond the 3 creative families", JSON.stringify(a3) === JSON.stringify(GOLDEN.FIX3_legacy_ward_meeting_4slots));

  const a4 = actual(CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT], { content: { headline: "Announcement", body: Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ") }, visual: {}, identity: {} }, 1080, 1080);
  ok("14d. FIX4 (long wrapping body, many lines): identical to baseline — wrapping behavior via the extracted computeTextLayout() is unchanged", JSON.stringify(a4) === JSON.stringify(GOLDEN.FIX4_long_wrapping_body));
}

// ============================================================
console.log("\n15 — Gate A.6.7: bounded vertical centering");
// ============================================================
{
  const MIN_TOP_OF_HEIGHT = 0.12;

  // 1 — sparse content (a single short headline line) is vertically
  // centered: startY = (canvasHeight - lineHeight) / 2, not the old fixed
  // 12%-of-height anchor.
  {
    const canvas = fakeCanvas(1080, 1350);
    renderTemplateToCanvas({ canvas, template: STATEMENT_TEMPLATE, payload: { content: { headline: "Turnout wins elections." }, visual: {}, identity: {} } });
    const headlineLineHeight = Math.round(1080 * 0.065);
    const expectedCenteredY = (1350 - headlineLineHeight) / 2;
    ok("15.1 sparse single-line content is vertically centered — startY matches (canvasHeight - blockHeight) / 2 exactly", canvas._calls.fillText[0].y === expectedCenteredY);
    ok("15.1b sparse content's centered startY is well ABOVE the old fixed 12% anchor — this is a real, visible change, not a no-op", canvas._calls.fillText[0].y > 1350 * MIN_TOP_OF_HEIGHT);
  }

  // 2 — the calculated start position never rises above (i.e. never
  // produces a y SMALLER than) the existing 12% minimum, across both a
  // sparse and a dense fixture.
  {
    const sparseCanvas = fakeCanvas(1080, 1350);
    renderTemplateToCanvas({ canvas: sparseCanvas, template: STATEMENT_TEMPLATE, payload: { content: { headline: "Hi" }, visual: {}, identity: {} } });
    const denseCanvas = fakeCanvas(1080, 1080);
    renderTemplateToCanvas({ canvas: denseCanvas, template: CTA_TEMPLATE, payload: { content: { headline: "H", body: Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "), cta: "Go" }, visual: {}, identity: {} } });
    ok("15.2 the sparse fixture's startY is >= the 12% minimum", sparseCanvas._calls.fillText[0].y >= 1350 * MIN_TOP_OF_HEIGHT - 1e-9);
    ok("15.2b the dense fixture's startY is >= the 12% minimum", denseCanvas._calls.fillText[0].y >= 1080 * MIN_TOP_OF_HEIGHT - 1e-9);
  }

  // 3 — genuinely dense content (tall enough that centering would rise
  // above the historical anchor) falls back to the EXACT original 12%
  // anchor — dense content is never pushed off the top of the canvas.
  {
    const canvas = fakeCanvas(1080, 1080);
    renderTemplateToCanvas({ canvas, template: CTA_TEMPLATE, payload: { content: { headline: "H", body: Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "), cta: "Go" }, visual: {}, identity: {} } });
    ok("15.3 dense content retains the EXACT original top anchor (canvasHeight * 0.12), byte-for-byte", canvas._calls.fillText[0].y === 1080 * MIN_TOP_OF_HEIGHT);
    ok("15.3b confirms this fixture is genuinely dense (many lines), not a trivial/degenerate case", canvas._calls.fillText.length > 10);
  }

  // 4 — a MULTI-LINE single slot (one long headline that wraps into
  // several lines) is centered based on the ACTUAL total wrapped block
  // height, not a single-line assumption.
  {
    const canvas = fakeCanvas(1080, 1350);
    const longHeadline = "This headline is long enough to wrap across several lines on a narrow canvas width";
    renderTemplateToCanvas({ canvas, template: STATEMENT_TEMPLATE, payload: { content: { headline: longHeadline }, visual: {}, identity: {} } });
    const n = canvas._calls.fillText.length;
    ok("15.4 the long headline actually wrapped into multiple lines (a real multi-line fixture)", n > 1);
    const headlineLineHeight = Math.round(1080 * 0.065);
    const blockHeight = n * headlineLineHeight;
    const expectedStartY = (1350 - blockHeight) / 2;
    ok("15.4b the wrapped block's startY reflects its ACTUAL total height (all N lines), not a single-line estimate", canvas._calls.fillText[0].y === expectedStartY);
  }

  // 5 — an optional ABSENT slot contributes NO phantom height: a
  // headline-only render centers around the headline's own height alone,
  // not headline + a reserved-but-empty body slot.
  {
    const headlineOnly = fakeCanvas(1080, 1350);
    renderTemplateToCanvas({ canvas: headlineOnly, template: STATEMENT_TEMPLATE, payload: { content: { headline: "Turnout wins elections.", body: null }, visual: {}, identity: {} } });
    const headlineLineHeight = Math.round(1080 * 0.065);
    const expectedHeadlineOnlyY = (1350 - headlineLineHeight) / 2;
    ok("15.5 a present headline with an ABSENT optional body centers around the headline's own height alone — no phantom space reserved for the missing slot", headlineOnly._calls.fillText[0].y === expectedHeadlineOnlyY);
  }

  // 6 — with MULTIPLE present slots, the relative spacing BETWEEN slots
  // (the existing per-slot trailing gap) is completely unaffected by
  // where the whole block starts — centering shifts everything by the
  // same constant offset, it never compresses or expands inter-slot gaps.
  {
    const canvas = fakeCanvas(1080, 1350);
    renderTemplateToCanvas({ canvas, template: STATEMENT_TEMPLATE, payload: { content: { headline: "Turnout wins elections.", body: "Register today." }, visual: {}, identity: {} } });
    const [headlineLine, bodyLine] = canvas._calls.fillText;
    const headlineLineHeight = Math.round(1080 * 0.065);
    const expectedGap = 1080 * 0.02;
    ok("15.6 the existing per-slot trailing gap between the headline and the next slot is EXACTLY preserved, regardless of the block's new start position", Math.abs(bodyLine.y - (headlineLine.y + headlineLineHeight) - expectedGap) < 1e-9);
  }

  // 7 — identity.brand is drawn at its ORIGINAL, UNCHANGED bottom-anchored
  // position, completely independent of the (now variable) content block
  // start position — already implicitly proven by FIX1's own unchanged
  // brand y (993.6) above; this makes the invariant explicit.
  {
    const sparse = fakeCanvas(1080, 1080);
    renderTemplateToCanvas({ canvas: sparse, template: CTA_TEMPLATE, payload: { content: { headline: "Short" }, visual: {}, identity: { brand: "ElectionCanon" } } });
    const dense = fakeCanvas(1080, 1080);
    renderTemplateToCanvas({ canvas: dense, template: CTA_TEMPLATE, payload: { content: { headline: "H", body: Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "), cta: "Go" }, visual: {}, identity: { brand: "ElectionCanon" } } });
    const sparseBrand = sparse._calls.fillText.find((c) => c.text === "ElectionCanon");
    const denseBrand = dense._calls.fillText.find((c) => c.text === "ElectionCanon");
    const expectedBrandY = 1080 - 1080 * 0.08;
    ok("15.7 identity.brand's y is the SAME fixed bottom-anchored position regardless of whether the content above it is sparse (centered) or dense (top-anchored)", sparseBrand.y === expectedBrandY && denseBrand.y === expectedBrandY && sparseBrand.y === denseBrand.y);
  }
}

// ============================================================
console.log("\nDOM-FREE REQUIREMENT — render.js's new motion code introduces no DOM/browser dependency");
// ============================================================
{
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const source = readFileSync(join(repoRoot, "src", "domains", "election", "design", "render.js"), "utf8");
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("D1. render.js references no document/window global", !/\bdocument\.|\bwindow\./.test(codeOnly));
  ok("D2. render.js calls no requestAnimationFrame/setInterval/setTimeout", !/requestAnimationFrame|setInterval|setTimeout/.test(codeOnly));
  ok("D3. render.js reads no wall-clock time (Date.now/performance.now)", !/Date\.now\(|performance\.now\(/.test(codeOnly));
  ok("D4. render.js never constructs a canvas itself (only ever receives one)", !/document\.createElement\(["']canvas["']\)|new OffscreenCanvas/.test(codeOnly));
  ok("D5. render.js never references MediaRecorder or a video API", !/MediaRecorder|captureStream|HTMLVideoElement/.test(codeOnly));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
