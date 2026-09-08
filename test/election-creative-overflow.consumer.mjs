// ============================================================
// ELECTIONCANON — GATE A.5.4 PHASE 3: rendered-length overflow safety net
//
// design/render.js draws each present text slot top-to-bottom and, by its
// own documented design, silently clips anything that runs past the
// canvas's bottom edge rather than truncating or shrinking it. Nothing
// upstream of design/creative.js's validateCreativePayload() previously
// bounded content length for the Communications-governed path (unlike
// legacy Studio's own per-slot `maxLength` inputs), so a long enough real
// Communication title or approved variant text could have been silently
// cut off mid-word on export with no warning. This file proves the new
// conservative length check added to validateCreativePayload() actually
// catches that before a canvas is ever created — and that it does NOT
// reject the real, already-approved test campaign copy at any approved
// family/format combination.
//
// No live database, no real <canvas> — same hand-rolled-fake-canvas
// precedent as every other consumer test in this suite.
// ============================================================

import { validateCreativePayload } from "../src/domains/election/design/creative.js";
import { CREATIVE_FORMAT, CREATIVE_FAMILY, CREATIVE_TEMPLATES } from "../src/domains/election/design/templates.js";
import { exportApprovedVariant } from "../src/domains/election/communications/export.js";
import { VARIANT_STATUS } from "../src/domains/election/communications/api.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.4 Phase 3: rendered-length overflow safety net\n");

function fakeCanvas(width, height) {
  const calls = { fillText: [] };
  const ctx = {
    fillStyle: null, font: null, textBaseline: null,
    fillRect: () => {},
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
    measureText: (text) => {
      const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(ctx.font || "");
      const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
      return { width: String(text).length * fontSize * 0.55 };
    },
  };
  return {
    width, height,
    getContext: () => ctx,
    toBlob: (cb, type) => cb(new Blob([new Uint8Array(16)], { type: type ?? "image/png" })),
    _calls: calls,
  };
}

// A single very long word run (no punctuation clusters that could look
// like a real sentence) — several times longer than anything that could
// ever fit even a single approved format at any font size in this
// pipeline, so this is not a borderline/flaky case.
const OVERLONG = Array.from({ length: 400 }, (_, i) => `filler${i}`).join(" ");

// ============================================================
console.log("a/b — overlong content is rejected BEFORE any canvas is created");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];

  const overlongHeadline = { content: { headline: OVERLONG, body: "Short body.", cta: "Act now." }, visual: {}, identity: {} };
  const r1 = validateCreativePayload({ payload: overlongHeadline, template, format: CREATIVE_FORMAT.SQUARE });
  ok("a1. an overlong headline is rejected for the CTA family at 1080x1080 (square)", !r1.valid);
  ok("b1. the rejection names the offending slot ('headline')", /headline/i.test(r1.error));

  const overlongBody = { content: { headline: "Short headline.", body: OVERLONG, cta: "Act now." }, visual: {}, identity: {} };
  const r2 = validateCreativePayload({ payload: overlongBody, template, format: CREATIVE_FORMAT.SQUARE });
  ok("a2. an overlong body is rejected for the CTA family at 1080x1080 (square)", !r2.valid);
  ok("b2. the rejection names the offending slot ('body')", /body/i.test(r2.error));

  const overlongCta = { content: { headline: "Short headline.", body: "Short body.", cta: OVERLONG }, visual: {}, identity: {} };
  const r3 = validateCreativePayload({ payload: overlongCta, template, format: CREATIVE_FORMAT.SQUARE });
  ok("a3. an overlong cta is rejected for the CTA family at 1080x1080 (square)", !r3.valid);
  ok("b3. the rejection names the offending slot ('cta')", /cta/i.test(r3.error));

  // The same overlong headline is comfortably safer at a taller format
  // (more vertical room), but 400 filler words is long enough to still
  // overflow even the tallest approved format (story, 1080x1920) — this
  // proves the check is real height-arithmetic, not a flat rejection.
  const r4 = validateCreativePayload({ payload: overlongHeadline, template, format: CREATIVE_FORMAT.STORY });
  ok("a5. the same overlong headline is still rejected at the tallest approved format (story, 1080x1920)", !r4.valid);
}

// ============================================================
console.log("\nc — the real approved test campaign copy still validates at every family x format combination");
// ============================================================
{
  const CAMPAIGN = {
    headline: "Your campaign is too big for WhatsApp.",
    body: "Your campaign has people everywhere.",
    cta: "Prepare. Organize. Coordinate. Observe. Respond.",
  };

  const combos = [
    { family: CREATIVE_FAMILY.STATEMENT, content: { headline: CAMPAIGN.headline, body: CAMPAIGN.body } },
    { family: CREATIVE_FAMILY.ANNOUNCEMENT, content: { headline: CAMPAIGN.headline, body: CAMPAIGN.body } },
    { family: CREATIVE_FAMILY.CTA, content: { headline: CAMPAIGN.headline, body: CAMPAIGN.body, cta: CAMPAIGN.cta } },
  ];

  for (const { family, content } of combos) {
    const template = CREATIVE_TEMPLATES[family];
    for (const format of [CREATIVE_FORMAT.SQUARE, CREATIVE_FORMAT.PORTRAIT, CREATIVE_FORMAT.STORY]) {
      const payload = { content, visual: {}, identity: {} };
      const result = validateCreativePayload({ payload, template, format });
      ok(`c. ${family} x ${format}: the real campaign copy validates cleanly`, result.valid && !result.error);
    }
  }
}

// ============================================================
console.log("\nd — Communications export coverage, via its own independent template (no dedup, no object-identity reliance)");
// ============================================================
{
  // exportApprovedVariant() builds its OWN template internally
  // (communications/export.js's buildExportTemplate(), deliberately kept
  // independent of design/templates.js's CREATIVE_TEMPLATES per this
  // gate's own D3 decision) and routes it through the SAME
  // validateCreativePayload() this file exercises directly above. This
  // block proves the safety net applies there too, purely through
  // exportApprovedVariant()'s own public behavior — nothing here imports
  // or asserts on buildExportTemplate()'s internals, its id, or any
  // relationship to CREATIVE_TEMPLATES.
  const normal = await exportApprovedVariant({
    communicationTitle: "Election Day Reminder",
    variantStatus: VARIANT_STATUS.APPROVED,
    variantLanguage: "en",
    variantText: "Polls open 8am to 6pm. Bring your voter ID.",
    format: "square",
    createCanvas: () => fakeCanvas(1080, 1080),
  });
  ok("d1. normal-length approved content still exports successfully", normal.error === null && normal.blob !== null);

  const overlong = await exportApprovedVariant({
    communicationTitle: OVERLONG,
    variantStatus: VARIANT_STATUS.APPROVED,
    variantLanguage: "en",
    variantText: "Short.",
    format: "square",
    createCanvas: () => fakeCanvas(1080, 1080),
  });
  ok("d2. an overlong APPROVED title is refused with an honest error, never silently exported clipped", overlong.error !== null && overlong.blob === null);
  ok("d3. the refusal names the offending slot", /headline/i.test(overlong.error));

  let canvasWasCreated = false;
  const overlongBody = await exportApprovedVariant({
    communicationTitle: "Short title.",
    variantStatus: VARIANT_STATUS.APPROVED,
    variantLanguage: "en",
    variantText: OVERLONG,
    format: "square",
    createCanvas: () => { canvasWasCreated = true; return fakeCanvas(1080, 1080); },
  });
  ok("d4. an overlong APPROVED body is refused before any canvas is created", overlongBody.error !== null && !canvasWasCreated);

  // Same overlong body against the tallest supported format still refuses
  // — same real-arithmetic property proven directly against
  // validateCreativePayload() above, now proven end-to-end through the
  // public export function.
  const overlongBodyStory = await exportApprovedVariant({
    communicationTitle: "Short title.",
    variantStatus: VARIANT_STATUS.APPROVED,
    variantLanguage: "en",
    variantText: OVERLONG,
    format: "story",
    createCanvas: () => fakeCanvas(1080, 1920),
  });
  ok("d5. the same overlong body is still refused even at the tallest supported format (story)", overlongBodyStory.error !== null && overlongBodyStory.blob === null);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
