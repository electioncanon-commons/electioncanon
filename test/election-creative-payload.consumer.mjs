// ============================================================
// ELECTIONCANON — GATE A.5.4: Public Creative Payload foundation
//
// Exercises design/creative.js (buildCommunicationCreativePayload,
// validateCreativePayload), design/typography.js (creativeFont), and
// design/templates.js's new CREATIVE_TEMPLATES — plus the renderer
// (design/render.js) under the new {canvas, template, payload} contract —
// directly, with no live database and no real <canvas>, following the
// same hand-rolled-fake-canvas precedent as
// test/election-communications-export.consumer.mjs.
//
// THE CENTRAL QUESTION THIS FILE ANSWERS: given a FULLY POPULATED fake
// Communication/language_variant carrying every internal field the Gate
// A.5.4 architecture audit flagged (brief, created_by, status, review/
// approval metadata), can any of that ever reach a payload, or a rendered
// pixel? Every test below is built around fixtures that are deliberately
// as internally rich as possible, specifically so a leak has somewhere to
// hide if one exists.
// ============================================================

import { PUBLIC_CONTENT_SLOTS, PUBLIC_VISUAL_SLOTS, buildCommunicationCreativePayload, validateCreativePayload } from "../src/domains/election/design/creative.js";
import { CREATIVE_FONT_FAMILY, CREATIVE_HEADLINE_WEIGHT, CREATIVE_BODY_WEIGHT, CREATIVE_FONT_LOAD_SPECS, creativeFont } from "../src/domains/election/design/typography.js";
import { TEMPLATES, TEMPLATE_LIST, CREATIVE_FORMAT, CREATIVE_FAMILY, CREATIVE_TEMPLATES, CREATIVE_TEMPLATE_LIST } from "../src/domains/election/design/templates.js";
import { renderTemplateToCanvas } from "../src/domains/election/design/render.js";
import { EXPORT_FORMATS } from "../src/domains/election/communications/export.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.4: Public Creative Payload foundation\n");

// measureText scales with the ACTUAL requested font size (parsed straight
// out of ctx.font, e.g. "900 59px 'Poppins', sans-serif") rather than a
// flat per-character constant — a flat constant can't tell a large
// headline apart from small body text, which is exactly the distinction
// wrapping/overflow behavior depends on. Still a hand-rolled
// approximation (0.55 of font-size per character), not real glyph
// metrics — there is no real <canvas> in this Node test.
function fakeCanvas(width, height) {
  const calls = { fillRect: [], fillText: [] };
  const ctx = {
    fillStyle: null, font: null, textBaseline: null,
    fillRect: (...args) => calls.fillRect.push(args),
    fillText: (text, x, y) => calls.fillText.push({ text, x, y, font: ctx.font }),
    measureText: (text) => {
      const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(ctx.font || "");
      const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
      return { width: String(text).length * fontSize * 0.55 };
    },
  };
  return { width, height, getContext: () => ctx, _calls: calls };
}

// A deliberately FULLY POPULATED fake Communication — every field the
// architecture audit flagged as internal, plus the one governed field
// (title) that IS allowed through.
const FAKE_COMMUNICATION = Object.freeze({
  id: "comm-secret-1",
  campaign_id: "camp-secret-1",
  title: "Your campaign is too big for WhatsApp.",
  brief: "INTERNAL: target swing wards, do not release outside comms team",
  master_text: "internal working draft — not for publication",
  created_by: "user-a52owner",
  status: "draft",
  review_metadata: { reviewer_id: "user-reviewer-99", notes: "looks good but check the date" },
  approval_metadata: { approver_id: "user-approver-77", notes: "approved pending legal" },
});

// A deliberately FULLY POPULATED fake language variant — same treatment.
const FAKE_VARIANT = Object.freeze({
  id: "variant-secret-1",
  communication_id: "comm-secret-1",
  campaign_id: "camp-secret-1",
  language: "en",
  text: "Your campaign has people everywhere.",
  status: "approved",
  created_by: "user-drafter-42",
  reviewer_id: "user-reviewer-99",
  approver_id: "user-approver-77",
  review_metadata: { notes: "reviewed, fine" },
  approval_metadata: { notes: "approved" },
});

const FORBIDDEN_VALUES = [
  FAKE_COMMUNICATION.brief, FAKE_COMMUNICATION.master_text, FAKE_COMMUNICATION.created_by, FAKE_COMMUNICATION.status,
  FAKE_VARIANT.created_by, FAKE_VARIANT.reviewer_id, FAKE_VARIANT.approver_id, FAKE_VARIANT.status,
  "user-reviewer-99", "user-approver-77", "looks good but check the date", "approved pending legal",
];

function payloadContainsAnyForbiddenValue(payload) {
  const json = JSON.stringify(payload);
  return FORBIDDEN_VALUES.some((v) => json.includes(v));
}

// ============================================================
console.log("A/B/C — buildCommunicationCreativePayload(): only allowed public fields ever reach the payload");
// ============================================================
{
  const payload = buildCommunicationCreativePayload({
    communication: FAKE_COMMUNICATION,
    languageVariant: FAKE_VARIANT,
    identity: { brand: "ElectionCanon" },
  });

  ok("A1. the payload's top level is EXACTLY {content, visual, identity} — no fourth key, no meta/raw/source/data escape hatch",
    Object.keys(payload).sort().join(",") === "content,identity,visual");
  ok("A2. payload.content's keys are a subset of the closed PUBLIC_CONTENT_SLOTS set", Object.keys(payload.content).every((k) => PUBLIC_CONTENT_SLOTS.includes(k)));
  ok("A3. payload.visual's keys are a subset of the closed PUBLIC_VISUAL_SLOTS set", Object.keys(payload.visual).every((k) => PUBLIC_VISUAL_SLOTS.includes(k)));
  ok("A4. payload.identity is exactly {brand}", Object.keys(payload.identity).join(",") === "brand");

  ok("B1. headline is the Communication's own title", payload.content.headline === "Your campaign is too big for WhatsApp.");
  ok("B2. body is the language variant's own text", payload.content.body === "Your campaign has people everywhere.");
  ok("B3. NONE of brief/created_by/status/review_metadata/approval_metadata appear anywhere in the payload (as keys OR values)",
    !payloadContainsAnyForbiddenValue(payload));
  ok("B4. the fully-populated fixture's brief text specifically never appears", !JSON.stringify(payload).includes("INTERNAL: target swing wards"));

  ok("C1. the payload's body is ONLY the intended public variant text — nothing else from the variant leaked in", payload.content.body === FAKE_VARIANT.text);
  ok("C2. the variant's own status/created_by/reviewer_id/approver_id/review_metadata/approval_metadata are absent", !payloadContainsAnyForbiddenValue(payload));
}

{
  // The builder must never spread its inputs. Proven structurally: a
  // Communication/variant/identity carrying EXTRA, unanticipated fields
  // (as if a future migration added a new internal column tomorrow) must
  // not have those fields appear either — spreading would leak them,
  // explicit destructuring cannot.
  const futureCommunication = { ...FAKE_COMMUNICATION, some_future_internal_column: "TOP SECRET FUTURE FIELD" };
  const futureVariant = { ...FAKE_VARIANT, another_future_column: "ALSO SECRET" };
  const payload = buildCommunicationCreativePayload({ communication: futureCommunication, languageVariant: futureVariant, identity: {} });
  ok("A5. a field that does not exist yet (added to the source object after this file was written) still cannot leak — the builder was never spreading",
    !JSON.stringify(payload).includes("SECRET"));
}

// ============================================================
console.log("\nD/E/F/G/H — the RENDERER cannot render internal fields, given a fully-built payload");
// ============================================================
{
  const payload = buildCommunicationCreativePayload({ communication: FAKE_COMMUNICATION, languageVariant: FAKE_VARIANT, identity: { brand: "ElectionCanon" } });
  const template = TEMPLATES ? Object.values(TEMPLATES)[0] : null; // any real template with textSlots headline/body
  const rendererTemplate = { id: "t", background: { token: "primary" }, textSlots: [{ id: "headline" }, { id: "body" }] };
  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas, template: rendererTemplate, payload });

  const renderedTexts = canvas._calls.fillText.map((c) => c.text).join(" | ");
  ok("D. the internal Brief never appears in a rendered fillText call", !renderedTexts.includes("INTERNAL: target swing wards"));
  ok("E. the creator id never appears", !renderedTexts.includes(FAKE_COMMUNICATION.created_by) && !renderedTexts.includes(FAKE_VARIANT.created_by));
  ok("F. the reviewer id never appears", !renderedTexts.includes(FAKE_VARIANT.reviewer_id));
  ok("G. the approver id never appears", !renderedTexts.includes(FAKE_VARIANT.approver_id));
  ok("H. the workflow status never appears", !renderedTexts.includes(FAKE_COMMUNICATION.status) && !renderedTexts.includes(FAKE_VARIANT.status));
  // H2 — reconstructed by rejoining every fillText call with a single
  // space, in draw order. wrapText only ever breaks at a word boundary
  // (never inside a word, never altering spacing), so re-joining wrapped
  // lines with one space losslessly restores the original text — this
  // reconstruction is therefore wrap-point-agnostic: it holds whether the
  // headline (real Poppins-900-sized text, at real canvas.width) happens
  // to wrap into one line or several. An EXACT equality here is a
  // stronger guarantee than the old fixed fillText-call count ever was:
  // it proves the ENTIRE composition is precisely title+body+brand, with
  // nothing else drawn anywhere, regardless of how many lines each wraps into.
  const reconstructed = canvas._calls.fillText.map((c) => c.text).join(" ");
  ok("H2. only the intended public strings (headline, body, and the EXPLICITLY-supplied brand) were drawn — nothing else, from a fixture designed to leak everything else if it could",
    reconstructed === `${FAKE_COMMUNICATION.title} ${FAKE_VARIANT.text} ElectionCanon`);
}

// ============================================================
console.log("\nI — an unexpected application field cannot silently become a slot");
// ============================================================
{
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT];
  const smuggled = {
    content: { headline: "Fine", body: "Also fine", brief: "SMUGGLED INTERNAL FIELD" },
    visual: {}, identity: {},
  };
  const result = validateCreativePayload({ payload: smuggled, template, format: CREATIVE_FORMAT.SQUARE });
  ok("I1. a payload with an extra, undeclared content key is REJECTED before rendering, never silently accepted", !result.valid);
  ok("I2. the rejection names the actual offending key", /brief/i.test(result.error));

  const missingRequired = { content: { body: "no headline here" }, visual: {}, identity: {} };
  const result2 = validateCreativePayload({ payload: missingRequired, template, format: CREATIVE_FORMAT.SQUARE });
  ok("I3. a payload missing a required slot is rejected", !result2.valid && /headline/i.test(result2.error));

  const wrongFormat = { content: { headline: "H", body: "B" }, visual: {}, identity: {} };
  const templateWithLimitedFormats = { ...template, formats: [CREATIVE_FORMAT.SQUARE] };
  const result3 = validateCreativePayload({ payload: wrongFormat, template: templateWithLimitedFormats, format: CREATIVE_FORMAT.STORY });
  ok("I4. an unsupported template/format combination is rejected", !result3.valid);

  const valid = { content: { headline: "H", body: "B" }, visual: {}, identity: {} };
  const result4 = validateCreativePayload({ payload: valid, template, format: CREATIVE_FORMAT.SQUARE });
  ok("I5. a genuinely valid payload against its own template/format passes", result4.valid && !result4.error);

  ok("I6. malformed payload structure (missing content) is rejected, not thrown", !validateCreativePayload({ payload: { visual: {}, identity: {} }, template }).valid);
  ok("I7. a null payload is rejected cleanly, never throws", !validateCreativePayload({ payload: null, template }).valid);
}

// ============================================================
console.log("\nTypography — Poppins 900 for headlines, content never case-transformed");
// ============================================================
{
  const headlineFont = creativeFont({ role: "headline", sizePx: 64 });
  ok("T1. the headline font requests weight 900", new RegExp(`\\b${CREATIVE_HEADLINE_WEIGHT}\\b`).test(headlineFont));
  ok("T2. the headline font requests Poppins", headlineFont.includes("Poppins"));
  ok("T3. the body font requests weight 400, not 900 — only headlines are Black", creativeFont({ role: "body", sizePx: 32 }).includes(`${CREATIVE_BODY_WEIGHT} `));
  ok("T4. CREATIVE_FONT_LOAD_SPECS names the exact same family this renderer uses", CREATIVE_FONT_LOAD_SPECS.every((s) => s.includes(CREATIVE_FONT_FAMILY)));

  const mixedCaseHeadline = "Your campaign is too big for WhatsApp.";
  const canvas = fakeCanvas(1080, 1080);
  const template = { id: "t", background: { token: "primary" }, textSlots: [{ id: "headline" }] };
  renderTemplateToCanvas({ canvas, template, payload: { content: { headline: mixedCaseHeadline }, identity: {} } });
  // Rejoining every wrapped line with a single space losslessly restores
  // the original text (see H2's own comment above) — this headline may
  // legitimately wrap across multiple fillText calls at its real,
  // large Poppins-900 size; that is not a case transformation.
  ok("T5. sentence-case content is drawn EXACTLY as authored — no automatic upper/lowercasing",
    canvas._calls.fillText.map((c) => c.text).join(" ") === mixedCaseHeadline);
  ok("T6. the rendered headline uses the Poppins/900 font string", canvas._calls.fillText[0].font.includes("Poppins") && new RegExp(`\\b${CREATIVE_HEADLINE_WEIGHT}\\b`).test(canvas._calls.fillText[0].font));
}

// ============================================================
console.log("\nFormat — exactly 1080x1080 / 1080x1350 / 1080x1920, no more");
// ============================================================
{
  ok("FMT1. CREATIVE_FORMAT names exactly three formats", Object.keys(CREATIVE_FORMAT).length === 3);
  ok("FMT2. those three formats match export.js's own three canonical dimensions",
    EXPORT_FORMATS[CREATIVE_FORMAT.SQUARE].width === 1080 && EXPORT_FORMATS[CREATIVE_FORMAT.SQUARE].height === 1080 &&
    EXPORT_FORMATS[CREATIVE_FORMAT.PORTRAIT].width === 1080 && EXPORT_FORMATS[CREATIVE_FORMAT.PORTRAIT].height === 1350 &&
    EXPORT_FORMATS[CREATIVE_FORMAT.STORY].width === 1080 && EXPORT_FORMATS[CREATIVE_FORMAT.STORY].height === 1920);
  ok("FMT3. every new creative template declares support for all three formats, no fourth format", CREATIVE_TEMPLATE_LIST.every((t) => t.formats.length === 3 && t.formats.every((f) => Object.values(CREATIVE_FORMAT).includes(f))));
}

// ============================================================
console.log("\nTemplate model — the three approved families only, existing 20 templates untouched");
// ============================================================
{
  ok("TPL1. exactly three creative families exist: statement, announcement, cta", Object.keys(CREATIVE_FAMILY).length === 3 && CREATIVE_TEMPLATE_LIST.length === 3);
  ok("TPL2. no quote/data/product-explainer/story family exists yet", !("QUOTE" in CREATIVE_FAMILY) && !("DATA" in CREATIVE_FAMILY) && !("STORY" in CREATIVE_FAMILY) && !("NARRATIVE" in CREATIVE_FAMILY));
  ok("TPL3. every creative template declares an explicit slots.content schema", CREATIVE_TEMPLATE_LIST.every((t) => t.slots && typeof t.slots.content === "object"));
  ok("TPL4. the existing freeform Studio templates are completely unchanged in count and untouched by this addition", TEMPLATE_LIST.length === 21);
  ok("TPL5. the Statement/Hero family requires a headline but not a body", CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT].slots.content.headline.required === true && CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT].slots.content.body.required === false);
  ok("TPL6. the Announcement family requires both headline and body", CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT].slots.content.headline.required === true && CREATIVE_TEMPLATES[CREATIVE_FAMILY.ANNOUNCEMENT].slots.content.body.required === true);
  ok("TPL7. the CTA family declares a cta content slot", "cta" in CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA].slots.content);
}

// ============================================================
console.log("\nVisual test campaign — 'Your campaign is too big for WhatsApp.'");
// ============================================================
{
  const payload = {
    content: {
      headline: "Your campaign is too big for WhatsApp.",
      body: "Your campaign has people everywhere.",
      cta: "Prepare. Organize. Coordinate. Observe. Respond.",
    },
    visual: {}, identity: { brand: "ElectionCanon" },
  };
  const template = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];
  const validation = validateCreativePayload({ payload, template, format: CREATIVE_FORMAT.SQUARE });
  ok("V1. the real campaign payload validates cleanly against the CTA template", validation.valid);

  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas, template, payload });
  const texts = canvas._calls.fillText.map((c) => c.text);
  // The headline may legitimately wrap across multiple fillText calls at
  // its real, large Poppins-900 size — reconstructing with a single
  // space (see H2's own comment) is wrap-point-agnostic.
  const reconstructedAll = texts.join(" ");
  ok("V2. the headline renders exactly as authored", reconstructedAll.includes("Your campaign is too big for WhatsApp."));
  ok("V3. the body renders exactly as authored", texts.includes("Your campaign has people everywhere."));
  ok("V4. the CTA renders exactly as authored", texts.includes("Prepare. Organize. Coordinate. Observe. Respond."));
  ok("V5. the brand credit renders because it was explicitly supplied", texts.includes("ElectionCanon"));
  ok("V6. no internal Brief text was ever part of this composition — the test payload never referenced one", !texts.some((t) => /internal/i.test(t)));
  ok("V7. no creator/account identifier appears anywhere in the composition", !texts.some((t) => /owner|user-|@/.test(t)));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
