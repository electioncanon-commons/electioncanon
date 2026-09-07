// ============================================================
// ELECTIONCANON — GATE A.5.3: Communications export pipeline
//
// Exercises design/render.js (the shared canvas renderer, extracted from
// Campaign Studio's exportPng()) and communications/export.js
// (exportApprovedVariant, EXPORT_FORMATS, buildExportFilename) directly —
// no live database, no real <canvas>, no `client`/Supabase anywhere in
// this file, because export touches neither.
//
// Follows this project's own established precedent for testing
// canvas-shaped browser code without a canvas/jsdom dependency (see
// test/election-evidence-ocr-edge-cases.consumer.mjs's OffscreenCanvas
// stub, section J). render.js's renderTemplateToCanvas() takes its canvas
// as a plain argument rather than constructing one internally, so here the
// fake canvas is supplied directly as that argument instead of patched
// onto a global — the SAME "hand-rolled fake object capturing calls, no
// canvas library" philosophy, just adapted to this function's own
// dependency-injected shape. No second canvas test framework is invented.
// ============================================================

import { renderTemplateToCanvas, canvasToPngBlob } from "../src/domains/election/design/render.js";
import { EXPORT_FORMAT, EXPORT_FORMATS, EXPORT_FORMAT_LIST, buildExportFilename, exportApprovedVariant } from "../src/domains/election/communications/export.js";
import { VARIANT_STATUS } from "../src/domains/election/communications/api.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.3: Communications export pipeline\n");

// A fake 2D context + canvas, covering exactly the surface render.js
// actually calls: fillRect, fillText, measureText, the font/fillStyle/
// textBaseline setters, and toBlob. measureText returns a deterministic
// 6px-per-character width so text-wrapping is exercised predictably,
// without depending on real font metrics.
function fakeCanvas(width, height) {
  const calls = { fillRect: [], fillText: [], fillStyleHistory: [] };
  let fillStyle = null;
  const ctx = {
    set fillStyle(v) { fillStyle = v; calls.fillStyleHistory.push(v); },
    get fillStyle() { return fillStyle; },
    font: null,
    textBaseline: null,
    fillRect: (...args) => calls.fillRect.push(args),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y, font: ctx.font }),
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  return {
    width, height,
    getContext: () => ctx,
    toBlob: (cb, type) => cb(new Blob([new Uint8Array(16)], { type: type ?? "image/png" })),
    _calls: calls,
  };
}

const SQUARE_TEMPLATE = Object.freeze({
  id: "test_template",
  dimensions: { width: 1080, height: 1080 },
  background: { kind: "solid", token: "primary" },
  textSlots: [{ id: "headline", label: "Headline" }, { id: "body", label: "Body" }],
});

// ============================================================
console.log("render.js — the shared, extracted renderer");
// ============================================================
{
  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({
    canvas, template: SQUARE_TEMPLATE,
    textBySlot: { headline: "Get Out The Vote", body: "Polls open 8am to 6pm." },
    identity: { campaignName: "Ada for LG Chair" },
  });

  ok("R1. the background is filled once, covering the full canvas", canvas._calls.fillRect.length >= 1 && canvas._calls.fillRect[0][2] === 1080 && canvas._calls.fillRect[0][3] === 1080);
  ok("R2. the background colour comes from the template's declared token (T.teal for 'primary'), not a new literal", canvas._calls.fillStyleHistory[0] === "#0A7F73");
  ok("R3. the headline text is drawn", canvas._calls.fillText.some((c) => c.text === "Get Out The Vote"));
  ok("R4. the body text is drawn", canvas._calls.fillText.some((c) => c.text.includes("Polls open")));
  ok("R5. the identity campaignName is drawn as a footer credit, exactly as exportPng() always did", canvas._calls.fillText.some((c) => c.text === "Ada for LG Chair"));
  ok("R6. a slot with no value is skipped, never rendered as 'undefined'", !canvas._calls.fillText.some((c) => /undefined/.test(c.text)));
}

{
  // Long text: the renderer must wrap deterministically (multiple lines)
  // and never throw — but it also must NOT invent new truncation/auto-
  // shrink behavior that didn't exist in the original exportPng(). Text
  // that would overflow the canvas's own height is simply not visible
  // past the canvas bounds — the same implicit clipping the original
  // always relied on.
  const longBody = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas, template: SQUARE_TEMPLATE, textBySlot: { body: longBody }, identity: {} });
  ok("R7. long text wraps into multiple lines rather than one unbroken (and unmeasurable) string", canvas._calls.fillText.length > 1);
  ok("R8. wrapping never throws or drops words — every line drawn starts with a real word token", canvas._calls.fillText.every((c) => /^word\d/.test(c.text)));
}

{
  const canvas = fakeCanvas(1080, 1080);
  const blob = await canvasToPngBlob(canvas);
  ok("R9. canvasToPngBlob resolves a real Blob from canvas.toBlob", blob instanceof Blob);
}

// ============================================================
console.log("\nexport.js — format model");
// ============================================================
{
  ok("F1. exactly three export formats are defined (no extra formats added in this gate)", EXPORT_FORMAT_LIST.length === 3);
  ok("F2. 1080x1080 square is present — the same dimension Studio's own SOCIAL_SQUARE already used", EXPORT_FORMATS[EXPORT_FORMAT.SQUARE].width === 1080 && EXPORT_FORMATS[EXPORT_FORMAT.SQUARE].height === 1080);
  ok("F3. 1080x1350 portrait is present — the same dimension Studio's own SOCIAL_POST already used", EXPORT_FORMATS[EXPORT_FORMAT.PORTRAIT].width === 1080 && EXPORT_FORMATS[EXPORT_FORMAT.PORTRAIT].height === 1350);
  ok("F4. 1080x1920 story is present — the new format this gate adds", EXPORT_FORMATS[EXPORT_FORMAT.STORY].width === 1080 && EXPORT_FORMATS[EXPORT_FORMAT.STORY].height === 1920);
}

// ============================================================
console.log("\nexport.js — filename strategy");
// ============================================================
{
  const name = buildExportFilename({ communicationTitle: "Get Out The Vote!", language: "yo", format: EXPORT_FORMATS[EXPORT_FORMAT.PORTRAIT] });
  ok("N1. filename follows electioncanon-{slug}-{language}-{w}x{h}.png", name === "electioncanon-get-out-the-vote-yo-1080x1350.png");

  const messyName = buildExportFilename({ communicationTitle: "  Ward 7: URGENT!! ", language: "en", format: EXPORT_FORMATS[EXPORT_FORMAT.SQUARE] });
  ok("N2. punctuation and whitespace are sanitized out of the slug, never left raw in a filename", messyName === "electioncanon-ward-7-urgent-en-1080x1080.png");

  const englishName = buildExportFilename({ communicationTitle: "Election Day Reminder", language: "en", format: EXPORT_FORMATS[EXPORT_FORMAT.SQUARE] });
  const yorubaName = buildExportFilename({ communicationTitle: "Election Day Reminder", language: "yo", format: EXPORT_FORMATS[EXPORT_FORMAT.SQUARE] });
  ok("N3. the SAME communication in two approved languages produces two DIFFERENT, independent filenames", englishName !== yorubaName && englishName.includes("-en-") && yorubaName.includes("-yo-"));
}

// ============================================================
console.log("\nexportApprovedVariant() — the approval gate, re-read live, never inferred from history");
// ============================================================
const baseInput = () => ({
  communicationTitle: "Election Day Reminder",
  variantLanguage: "yo",
  variantText: "Dibo ni ọjọ Satide.",
  format: EXPORT_FORMAT.SQUARE,
  createCanvas: () => fakeCanvas(1, 1),
});

{
  const approved = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED });
  ok("A1. an APPROVED variant exports successfully", !approved.error && approved.blob instanceof Blob);
  ok("A2. the filename carries the variant's own language code", approved.filename.includes("-yo-"));
  ok("A3. the filename carries the chosen format's dimensions", approved.filename.endsWith("1080x1080.png"));

  const draft = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.DRAFT });
  ok("A4. a DRAFT variant is refused, never exported as a finalized asset", draft.error && !draft.blob);

  const inReview = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.IN_REVIEW });
  ok("A5. an IN_REVIEW variant is refused", inReview.error && !inReview.blob);

  const changesRequested = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.CHANGES_REQUESTED });
  ok("A6. a CHANGES_REQUESTED variant is refused", changesRequested.error && !changesRequested.blob);
  ok("A6b. the refusal names the real reason (not currently approved), not a generic failure", /not currently approved/.test(changesRequested.error));

  // Gate A.5.2's own revoke_approval RPC transitions a revoked variant's
  // status to 'changes_requested' (proven by
  // election-communications-review-workflow.consumer.mjs's own "Approval
  // revoked -> variant becomes changes_requested" assertion) — so the
  // CHANGES_REQUESTED case above IS the exact, real post-revocation state,
  // not a hypothetical fourth one. A revoked approval therefore already,
  // structurally, loses export eligibility the moment its live status is
  // re-read — no separate "revoked" branch is needed in export.js itself.
  ok("A7. a revoked approval (status: changes_requested) loses export eligibility, exactly like any other non-approved state", changesRequested.error && !changesRequested.blob);
}

// ============================================================
console.log("\nexportApprovedVariant() — all three formats, correct dimensions");
// ============================================================
{
  const cases = [
    ["square", EXPORT_FORMAT.SQUARE, 1080, 1080],
    ["portrait", EXPORT_FORMAT.PORTRAIT, 1080, 1350],
    ["story", EXPORT_FORMAT.STORY, 1080, 1920],
  ];
  for (const [label, formatId, w, h] of cases) {
    let capturedCanvas = null;
    const result = await exportApprovedVariant({
      ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, format: formatId,
      createCanvas: () => { capturedCanvas = fakeCanvas(1, 1); return capturedCanvas; },
    });
    ok(`D-${label}. the ${label} format (${w}x${h}) exports successfully and resizes the canvas to exactly ${w}x${h} before rendering`,
      !result.error && capturedCanvas.width === w && capturedCanvas.height === h && result.filename.endsWith(`${w}x${h}.png`));
  }
}

// ============================================================
console.log("\nexportApprovedVariant() — fixed composition, never Studio slot inference");
// ============================================================
{
  let capturedTexts = [];
  const result = await exportApprovedVariant({
    ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED,
    createCanvas: () => {
      const c = fakeCanvas(1, 1);
      const realGetContext = c.getContext;
      c.getContext = () => {
        const ctx = realGetContext();
        const realFillText = ctx.fillText;
        ctx.fillText = (text, x, y) => { capturedTexts.push(text); return realFillText(text, x, y); };
        return ctx;
      };
      return c;
    },
  });
  ok("S1. the export succeeds", !result.error);
  ok("S2. the COMMUNICATION's own title becomes the rendered headline", capturedTexts.includes("Election Day Reminder"));
  ok("S3. the APPROVED VARIANT's own text becomes the rendered body", capturedTexts.some((t) => t.includes("Dibo")));

  // An extraneous, FROZEN Studio-asset-shaped object: exportApprovedVariant
  // has no parameter for it at all, so it must be both unnecessary (export
  // succeeds without it) and untouched (frozen -> any attempted mutation
  // would throw in this ESM module's strict mode, failing this test loudly
  // rather than silently).
  const frozenAsset = Object.freeze({ id: "asset-1", content: Object.freeze({ text: Object.freeze({ headline: "original" }) }) });
  const withAsset = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, studioAsset: frozenAsset });
  ok("S4. Studio-asset slot mapping is NOT required — an extraneous, frozen asset-shaped input is ignored, export still succeeds, and the asset is never mutated",
    !withAsset.error && withAsset.blob instanceof Blob && frozenAsset.content.text.headline === "original");
}

// ============================================================
console.log("\nexportApprovedVariant() — no persistence, no shared state");
// ============================================================
{
  const first = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED });
  const second = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED });
  ok("P1. exporting the same approved variant twice succeeds twice, independently (no 'already exported' state)", !first.error && !second.error);
  ok("P2. the two exports produce two distinct Blob instances, never a cached/shared one", first.blob !== second.blob);
  ok("P3. the result is exactly {blob, filename, error} — no id, no created_at, no row of any kind", Object.keys(first).sort().join(",") === "blob,error,filename");
}

// ============================================================
console.log("\nexportApprovedVariant() — honest refusals, checked in the right order");
// ============================================================
{
  const badFormat = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, format: "poster-size-nobody-asked-for" });
  ok("E1. an unsupported format is refused with an honest error", badFormat.error && !badFormat.blob);

  let canvasWasCreated = false;
  await exportApprovedVariant({
    ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, format: "poster-size-nobody-asked-for",
    createCanvas: () => { canvasWasCreated = true; return fakeCanvas(1, 1); },
  });
  ok("E2. rejecting an unsupported format never reaches rendering — createCanvas is never called", !canvasWasCreated);

  const emptyTitle = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, communicationTitle: "   " });
  ok("E3. an empty/whitespace-only communication title is refused, never rendered as a blank headline", emptyTitle.error && !emptyTitle.blob);

  const emptyText = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.APPROVED, variantText: "" });
  ok("E4. empty variant text is refused, never fabricated or rendered blank", emptyText.error && !emptyText.blob);

  const both = await exportApprovedVariant({ ...baseInput(), variantStatus: VARIANT_STATUS.DRAFT, format: "not-a-real-format" });
  ok("E5. the approval gate is checked BEFORE format validation — a draft variant is refused for not being approved, not for an unrelated format error", /not currently approved/.test(both.error));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
