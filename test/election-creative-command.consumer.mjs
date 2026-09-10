// ============================================================
// ELECTIONCANON — GATE A.7.5: creative command layer foundation
//
// Exercises design/creativeCommand.js's interpretCreativeCommand()/
// applyCreativeOperation() directly. The central proofs this file carries:
//
//   1. a natural-language English instruction resolves to the correct
//      structured CreativeOperation, using SELECTION CONTEXT when the
//      command names no element itself (A.7.6 — no element id required).
//   2. a confidently-detected non-English message is HONESTLY refused
//      (languageFellBack:true), never guessed at or fabricated.
//   3. applying an operation never mutates the input composition, and is
//      governed by the exact same closed TEXT_ALIGNMENT vocabulary
//      composition.js already enforces.
//   4. an operation that fails to apply (unknown role, bad alignment) is
//      refused, never silently ignored or partially applied.
// ============================================================

import {
  CREATIVE_OPERATION_KIND, INTERPRETED_LANGUAGES,
  interpretCreativeCommand, applyCreativeOperation,
} from "../src/domains/election/design/creativeCommand.js";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_FORMAT } from "../src/domains/election/design/templates.js";
import { defaultCompositionFor, TEXT_ALIGNMENT, ELEMENT_KIND } from "../src/domains/election/design/composition.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.7.5: creative command layer foundation\n");

const STATEMENT = CREATIVE_TEMPLATES[CREATIVE_FAMILY.STATEMENT];
const CTA = CREATIVE_TEMPLATES[CREATIVE_FAMILY.CTA];

// ============================================================
console.log("Honesty markers");
// ============================================================
{
  ok("H1. exactly one language is a real, interpreted vocabulary right now",
    INTERPRETED_LANGUAGES.length === 1 && INTERPRETED_LANGUAGES[0] === "en");
  // GATE A.7.2B — the honesty marker grows from one to two, deliberately:
  // exactly one operation PER GOVERNED ELEMENT KIND (SET_ALIGNMENT for
  // TEXT, SET_OPACITY for IMAGE) — still the smallest set that proves the
  // architecture for both kinds now in play, never a representative
  // sample or a generic {property, value} operation.
  ok("H2. exactly two operation kinds exist in V1 — one per governed element kind, still the smallest set that proves the architecture",
    Object.keys(CREATIVE_OPERATION_KIND).length === 2
    && CREATIVE_OPERATION_KIND.SET_ALIGNMENT === "SET_ALIGNMENT"
    && CREATIVE_OPERATION_KIND.SET_OPACITY === "SET_OPACITY");
}

// ============================================================
console.log("\ninterpretCreativeCommand() — English, explicit role name");
// ============================================================
{
  const out = interpretCreativeCommand({ message: "Center the headline", template: STATEMENT });
  ok("A1. understood", out.understood === true);
  ok("A2. resolves the correct role from the message text, no selection needed", out.operation.targetRole === "headline");
  ok("A3. resolves the correct alignment", out.operation.alignment === TEXT_ALIGNMENT.CENTER);
  ok("A4. resolves the correct operation kind", out.operation.kind === CREATIVE_OPERATION_KIND.SET_ALIGNMENT);
  ok("A5. detected language is reported as English", out.detectedLanguage === "en");
  ok("A6. no language fallback for an English command", out.languageFellBack === false);
}

// ============================================================
console.log("\ninterpretCreativeCommand() — selection context, no element named (A.7.6)");
// ============================================================
{
  const out = interpretCreativeCommand({ message: "put it in the middle", template: CTA, selectedElementId: "cta" });
  ok("B1. understood using the CURRENTLY SELECTED element — no element id was typed", out.understood === true);
  ok("B2. resolves to the selected role", out.operation.targetRole === "cta");
  ok("B3. \"middle\" resolves to center alignment", out.operation.alignment === TEXT_ALIGNMENT.CENTER);

  const noSelection = interpretCreativeCommand({ message: "put it in the middle", template: CTA, selectedElementId: null });
  ok("B4. the SAME message with nothing selected and no role named is honestly refused, never guessed",
    noSelection.understood === false && /select/i.test(noSelection.reason));
}

// ============================================================
console.log("\ninterpretCreativeCommand() — a role a template does NOT declare is never matched");
// ============================================================
{
  // STATEMENT has no "cta" text slot — the word must not resolve to a role
  // this template doesn't have, even though the synonym table knows it.
  const out = interpretCreativeCommand({ message: "left align the call to action", template: STATEMENT, selectedElementId: "headline" });
  ok("C1. falls back to the actual selection rather than inventing an undeclared role",
    out.understood === true && out.operation.targetRole === "headline");
}

// ============================================================
console.log("\ninterpretCreativeCommand() — non-English input is honestly refused, never fabricated");
// ============================================================
{
  // A confidently-Hausa sentence (from os/studio/language.js's own marker
  // vocabulary) — must never be silently matched against the English
  // ALIGNMENT_PHRASES table.
  const out = interpretCreativeCommand({
    message: "Menene matsayin wannan yanzu, ina son a canza shi",
    template: STATEMENT, selectedElementId: "headline",
  });
  ok("D1. a confidently non-English message is refused, not guessed at", out.understood === false);
  ok("D2. languageFellBack is honestly reported", out.languageFellBack === true);
  ok("D3. no operation is fabricated", out.operation === null);
  ok("D4. the detected language is reported for diagnostics", out.detectedLanguage === "ha");
}

// ============================================================
console.log("\ninterpretCreativeCommand() — an unrecognised instruction is refused, not guessed");
// ============================================================
{
  const out = interpretCreativeCommand({ message: "make it pop more", template: STATEMENT, selectedElementId: "headline" });
  ok("E1. no alignment word present -> honestly not understood", out.understood === false);
  ok("E2. no operation is fabricated", out.operation === null);
  ok("E3. a plain, non-technical reason is given", typeof out.reason === "string" && out.reason.length > 0);

  const empty = interpretCreativeCommand({ message: "   ", template: STATEMENT });
  ok("E4. empty/whitespace-only input is refused", empty.understood === false);
}

// ============================================================
console.log("\napplyCreativeOperation() — pure, immutable, and language-independent");
// ============================================================
{
  const composition = defaultCompositionFor(STATEMENT, CREATIVE_FORMAT.PORTRAIT);
  const before = JSON.stringify(composition);

  const { operation } = interpretCreativeCommand({ message: "center the headline", template: STATEMENT });
  const result = applyCreativeOperation({ operation, composition });

  ok("F1. applied", result.applied === true);
  ok("F2. the target element's alignment actually changed",
    result.composition.elements.find((el) => el.role === "headline").properties.alignment === TEXT_ALIGNMENT.CENTER);
  // GATE A.7.1 — STATEMENT's default composition now also includes a
  // non-text (IMAGE) element, which has no `alignment` property at all (see
  // design/composition.js's own IMAGE property schema) — this check only
  // ever meant "every other TEXT element", so it is scoped to TEXT kind.
  ok("F3. every OTHER TEXT element is untouched",
    result.composition.elements.filter((el) => el.kind === ELEMENT_KIND.TEXT && el.role !== "headline")
      .every((el) => el.properties.alignment === TEXT_ALIGNMENT.LEFT));
  ok("F4. the ORIGINAL composition object was never mutated", JSON.stringify(composition) === before);
  ok("F5. the result is frozen", Object.isFrozen(result.composition));
}

// ============================================================
console.log("\napplyCreativeOperation() — refuses what it cannot honestly apply");
// ============================================================
{
  const composition = defaultCompositionFor(STATEMENT, CREATIVE_FORMAT.PORTRAIT);

  const badRole = applyCreativeOperation({
    operation: { kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole: "nonexistent", alignment: TEXT_ALIGNMENT.CENTER },
    composition,
  });
  ok("G1. an operation naming a role the composition does not have is refused", badRole.applied === false && badRole.composition === null);

  const badAlignment = applyCreativeOperation({
    operation: { kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole: "headline", alignment: "justify" },
    composition,
  });
  ok("G2. an alignment value outside the closed TEXT_ALIGNMENT vocabulary is refused", badAlignment.applied === false);

  const badKind = applyCreativeOperation({ operation: { kind: "DELETE_EVERYTHING", targetRole: "headline" }, composition });
  ok("G3. an unrecognised operation kind is refused, never silently ignored-but-OK", badKind.applied === false);

  const missing = applyCreativeOperation({ operation: null, composition });
  ok("G4. a missing operation is refused", missing.applied === false);

  const badComposition = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole: "headline", alignment: TEXT_ALIGNMENT.CENTER }, composition: null });
  ok("G5. a missing/malformed composition is refused", badComposition.applied === false);
}

// ============================================================
console.log("\napplyCreativeOperation() — SET_OPACITY (Gate A.7.2B)");
// ============================================================
{
  // GATE A.7.1 already gives Statement/Hero a heroImage element by default
  // (opacity: 1) alongside its headline/body text elements — no fixture
  // change needed to exercise a real IMAGE target.
  const composition = defaultCompositionFor(STATEMENT, CREATIVE_FORMAT.PORTRAIT);

  const applied = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "heroImage", opacity: 0.4 }, composition });
  ok("OPA1. SET_OPACITY applies correctly", applied.applied === true && applied.composition.elements.find((el) => el.role === "heroImage").properties.opacity === 0.4);
  ok("OPA2. the SAME element's OTHER property (fit) is untouched", applied.composition.elements.find((el) => el.role === "heroImage").properties.fit === "cover");
  ok("OPA3. every OTHER element (headline, body) is untouched", applied.composition.elements.filter((el) => el.role !== "heroImage").every((el) => JSON.stringify(el) === JSON.stringify(composition.elements.find((o) => o.role === el.role))));
  ok("OPA4. the ORIGINAL composition object was never mutated", composition.elements.find((el) => el.role === "heroImage").properties.opacity === 1);
  ok("OPA5. the result is frozen", Object.isFrozen(applied.composition));

  const badOpacityHigh = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "heroImage", opacity: 1.5 }, composition });
  ok("OPA6. SET_OPACITY rejects opacity > 1", badOpacityHigh.applied === false && badOpacityHigh.composition === null);

  const badOpacityLow = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "heroImage", opacity: -0.5 }, composition });
  ok("OPA7. SET_OPACITY rejects negative opacity", badOpacityLow.applied === false);

  const badOpacityString = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "heroImage", opacity: "0.5" }, composition });
  ok("OPA8. SET_OPACITY rejects a non-number opacity", badOpacityString.applied === false);

  const missingOpacity = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "heroImage" }, composition });
  ok("OPA9. SET_OPACITY rejects a missing opacity value", missingOpacity.applied === false);

  const missingTarget = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "nonexistent", opacity: 0.5 }, composition });
  ok("OPA10. SET_OPACITY rejects a missing/nonexistent target role", missingTarget.applied === false && missingTarget.composition === null);

  const wrongKindTarget = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "headline", opacity: 0.5 }, composition });
  ok("OPA11. SET_OPACITY rejects a TEXT target — opacity does not apply to text elements", wrongKindTarget.applied === false && wrongKindTarget.composition === null);
}

// ============================================================
console.log("\nElement kind safety — an operation can never cross into the wrong element kind (Gate A.7.2B)");
// ============================================================
{
  const composition = defaultCompositionFor(STATEMENT, CREATIVE_FORMAT.PORTRAIT);

  const alignmentOnImage = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole: "heroImage", alignment: TEXT_ALIGNMENT.CENTER }, composition });
  ok("KIND1. SET_ALIGNMENT rejects an IMAGE target — alignment does not apply to image elements", alignmentOnImage.applied === false && alignmentOnImage.composition === null);

  ok("KIND2. an image element's properties are never touched by a rejected SET_ALIGNMENT attempt", (() => {
    applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole: "heroImage", alignment: TEXT_ALIGNMENT.CENTER }, composition });
    return composition.elements.find((el) => el.role === "heroImage").properties.opacity === 1 && composition.elements.find((el) => el.role === "heroImage").properties.fit === "cover";
  })());

  const opacityOnText = applyCreativeOperation({ operation: { kind: CREATIVE_OPERATION_KIND.SET_OPACITY, targetRole: "body", opacity: 0.5 }, composition });
  ok("KIND3. SET_OPACITY rejects a TEXT target — opacity does not apply to text elements (re-asserted here alongside OPA11, under this section's own name)", opacityOnText.applied === false && opacityOnText.composition === null);
}

// ============================================================
console.log("\ninterpretCreativeCommand() — conservative interpretation boundary (correctness fix)");
//
// Matching an alignment word and a role synonym ANYWHERE in a message is
// not enough to call it understood — a message must OPEN with a small
// closed set of design-instruction verbs (INSTRUCTION_OPENERS) before
// alignment/role resolution is even attempted.
// ============================================================
{
  // 1. Valid instruction forms — every phrasing the fix's spec calls out —
  // still resolve correctly.
  const validForms = [
    { message: "center the headline", role: "headline", alignment: TEXT_ALIGNMENT.CENTER },
    { message: "align the headline center", role: "headline", alignment: TEXT_ALIGNMENT.CENTER },
    { message: "move the title to the left", role: "headline", alignment: TEXT_ALIGNMENT.LEFT },
    { message: "put the headline on the left", role: "headline", alignment: TEXT_ALIGNMENT.LEFT },
    { message: "make the headline centered", role: "headline", alignment: TEXT_ALIGNMENT.CENTER },
  ];
  for (const fx of validForms) {
    const out = interpretCreativeCommand({ message: fx.message, template: STATEMENT });
    ok(`H3. [\"${fx.message}\"] still understood`, out.understood === true);
    ok(`H3. [\"${fx.message}\"] resolves the correct role/alignment`, out.operation?.targetRole === fx.role && out.operation?.alignment === fx.alignment);
  }

  // 2. Unrelated prose containing BOTH a role synonym and an alignment word
  // must never be silently interpreted — the exact failure scenario the
  // review identified ("middle" from "Middle East", "body" from "body copy").
  const unrelated = interpretCreativeCommand({
    message: "Explain the Middle East policy details in the body copy.",
    template: STATEMENT, selectedElementId: "headline",
  });
  ok("I1. unrelated prose with incidental role+alignment vocabulary is never understood", unrelated.understood === false);
  ok("I2. no operation is fabricated from unrelated prose", unrelated.operation === null);

  // 3. Partial/incomplete phrases — opens like an instruction but never
  // names or implies enough to act on — resolve to no operation, honestly.
  const noRole = interpretCreativeCommand({ message: "center", template: STATEMENT, selectedElementId: null });
  ok("I3a. an instruction-shaped message with no role named and nothing selected is refused, not guessed", noRole.understood === false && noRole.operation === null);

  const noAlignment = interpretCreativeCommand({ message: "make it pop more", template: STATEMENT, selectedElementId: "headline" });
  ok("I3b. an instruction-shaped message with no alignment cue is refused (still covered by E1 above too)", noAlignment.understood === false && noAlignment.operation === null);

  // 4. Mixed-language / synonym coverage already proven above (A-G) is
  // untouched by this gate: re-run the exact selection-context case to
  // confirm the new opener check does not regress it.
  const stillWorks = interpretCreativeCommand({ message: "put it in the middle", template: CTA, selectedElementId: "cta" });
  ok("I4. previously-covered synonym/selection-context case is unaffected", stillWorks.understood === true && stillWorks.operation.targetRole === "cta" && stillWorks.operation.alignment === TEXT_ALIGNMENT.CENTER);
}

// ============================================================
console.log("\nresolveAlignment() (via interpretCreativeCommand) — deterministic precedence, never object/array iteration order");
// ============================================================
{
  const resolve = (message) => interpretCreativeCommand({ message, template: STATEMENT, selectedElementId: "headline" });

  ok("J1. left only -> LEFT", resolve("move it left").operation?.alignment === TEXT_ALIGNMENT.LEFT);
  ok("J2. center only -> CENTER", resolve("center it").operation?.alignment === TEXT_ALIGNMENT.CENTER);

  // "right" is not a member of this codebase's closed TEXT_ALIGNMENT
  // vocabulary (only left/center exist — design/composition.js's own
  // TEXT_ALIGNMENT) — honestly, a message that only says "right" cues NO
  // recognised alignment at all, the same as any other unrecognised word.
  const rightOnly = resolve("move it right");
  ok("J3. right only -> no recognised alignment cue (no RIGHT value exists in this closed vocabulary) -> refused", rightOnly.understood === false && rightOnly.operation === null);

  // Genuine conflicts — two RECOGNISED values both cued in one message —
  // must resolve to no-op, never pick one by insertion/iteration order.
  const leftCenterConflict = resolve("align it left and center");
  ok("J4. conflicting left + center -> ambiguous -> refused, never silently CENTER", leftCenterConflict.understood === false && leftCenterConflict.operation === null);

  // "right" never cues a recognised value, so pairing it with a real cue is
  // NOT an actual conflict from this system's honest point of view — it
  // resolves to whichever recognised value the message actually cued.
  const centerRight = resolve("center it, or maybe to the right");
  ok("J5. center + (unrecognised) right -> resolves to the one real cue, CENTER", centerRight.operation?.alignment === TEXT_ALIGNMENT.CENTER);
  const leftRight = resolve("move it left or to the right");
  ok("J6. left + (unrecognised) right -> resolves to the one real cue, LEFT", leftRight.operation?.alignment === TEXT_ALIGNMENT.LEFT);

  const noCue = resolve("please move it");
  ok("J7. no alignment cue at all -> refused", noCue.understood === false && noCue.operation === null);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
