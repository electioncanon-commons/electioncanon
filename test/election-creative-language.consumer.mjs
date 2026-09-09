// ============================================================
// ELECTIONCANON — GATE A.7.1: creative language context foundation
//
// Exercises design/language.js's UserLanguageContext shape directly. The
// central proofs this file carries:
//
//   1. interfaceLanguage, aiInteractionLanguage, and creativeOutputLanguage
//      are genuinely INDEPENDENT — changing one never touches the others,
//      and the combination from the A.7 brief's own worked example
//      (interface=English, AI interaction=Nigerian Pidgin, creative
//      output=Yoruba) is a valid context.
//   2. the language list is DERIVED from the existing
//      os/studio/languageCapability.js registry, never a second,
//      independently-maintained list that could drift from it.
//   3. validation is closed and applies IDENTICALLY to all three fields —
//      "local language" never means looser checking on any one of them.
// ============================================================

import {
  CREATIVE_LANGUAGE_LIST, CREATIVE_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE,
  LANGUAGE_CONTEXT_FIELD, LANGUAGE_CONTEXT_FIELD_LIST,
  defaultUserLanguageContext, validateUserLanguageContext,
} from "../src/domains/election/design/language.js";
import { ALL_CAPABILITIES } from "../src/os/studio/languageCapability.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.7.1: creative language context foundation\n");

// ============================================================
console.log("CREATIVE_LANGUAGE_LIST — derived, not a second registry");
// ============================================================
{
  ok("A1. the code list matches languageCapability.js's own registry exactly (same set, same order)",
    JSON.stringify(CREATIVE_LANGUAGE_CODES) === JSON.stringify(ALL_CAPABILITIES.map((c) => c.code)));
  ok("A2. all six ElectionCanon target languages are present",
    ["en", "pcm", "ha", "yo", "ig", "urh"].every((code) => CREATIVE_LANGUAGE_CODES.includes(code)));
  ok("A3. every list entry carries only {code, name} — no capability/status field leaks through",
    CREATIVE_LANGUAGE_LIST.every((l) => Object.keys(l).sort().join(",") === "code,name"));
  ok("A4. the list is frozen (closed vocabulary, not appendable at runtime)",
    Object.isFrozen(CREATIVE_LANGUAGE_LIST) && Object.isFrozen(CREATIVE_LANGUAGE_CODES));
  ok("A5. default language code is English", DEFAULT_LANGUAGE_CODE === "en");
}

// ============================================================
console.log("\ndefaultUserLanguageContext()");
// ============================================================
{
  const ctx = defaultUserLanguageContext();
  ok("B1. all three settings default to English",
    ctx.interfaceLanguage === "en" && ctx.aiInteractionLanguage === "en" && ctx.creativeOutputLanguage === "en");
  ok("B2. the default context validates", validateUserLanguageContext(ctx).valid === true);
  ok("B3. a fresh object is returned every call (never a shared mutable singleton)",
    defaultUserLanguageContext() !== defaultUserLanguageContext());
  ok("B4. the returned context is frozen", Object.isFrozen(ctx));
}

// ============================================================
console.log("\nTHE THREE SETTINGS ARE GENUINELY INDEPENDENT");
// ============================================================
{
  // The A.7 brief's own worked example: interface=English, AI
  // interaction=Nigerian Pidgin, creative output=Yoruba. Nothing about the
  // architecture may forbid this combination.
  const mixed = { interfaceLanguage: "en", aiInteractionLanguage: "pcm", creativeOutputLanguage: "yo" };
  ok("C1. the brief's own worked example (en interface / pcm AI / yo output) validates",
    validateUserLanguageContext(mixed).valid === true);

  const base = defaultUserLanguageContext();
  const changedOutputOnly = { ...base, creativeOutputLanguage: "ha" };
  ok("C2. changing creativeOutputLanguage alone leaves interfaceLanguage untouched",
    changedOutputOnly.interfaceLanguage === "en");
  ok("C3. ...and leaves aiInteractionLanguage untouched",
    changedOutputOnly.aiInteractionLanguage === "en");
  ok("C4. ...and the changed field itself actually changed",
    changedOutputOnly.creativeOutputLanguage === "ha");

  const changedAiOnly = { ...base, aiInteractionLanguage: "ig" };
  ok("C5. changing aiInteractionLanguage alone leaves creativeOutputLanguage and interfaceLanguage untouched",
    changedAiOnly.creativeOutputLanguage === "en" && changedAiOnly.interfaceLanguage === "en");

  ok("C6. every context field name is declared in the closed field list",
    LANGUAGE_CONTEXT_FIELD_LIST.length === 3 &&
    new Set(LANGUAGE_CONTEXT_FIELD_LIST).size === 3 &&
    Object.values(LANGUAGE_CONTEXT_FIELD).every((f) => LANGUAGE_CONTEXT_FIELD_LIST.includes(f)));
}

// ============================================================
console.log("\nvalidateUserLanguageContext() — closed, applies identically to all three fields");
// ============================================================
{
  ok("D1. missing context is rejected", validateUserLanguageContext(undefined).valid === false);
  ok("D2. a non-object is rejected", validateUserLanguageContext("en").valid === false);
  ok("D3. an empty object is rejected (no field silently defaults inside the validator)",
    validateUserLanguageContext({}).valid === false);

  const base = defaultUserLanguageContext();
  ok("D4. an unrecognised interfaceLanguage is rejected",
    validateUserLanguageContext({ ...base, interfaceLanguage: "de" }).valid === false);
  ok("D5. an unrecognised aiInteractionLanguage is rejected",
    validateUserLanguageContext({ ...base, aiInteractionLanguage: "de" }).valid === false);
  ok("D6. an unrecognised creativeOutputLanguage is rejected — output language gets NO looser check than the other two",
    validateUserLanguageContext({ ...base, creativeOutputLanguage: "de" }).valid === false);
  ok("D7. a non-string language value is rejected", validateUserLanguageContext({ ...base, creativeOutputLanguage: 1 }).valid === false);

  ok("D8. every real language code is independently accepted in every field",
    CREATIVE_LANGUAGE_CODES.every((code) =>
      validateUserLanguageContext({ interfaceLanguage: code, aiInteractionLanguage: code, creativeOutputLanguage: code }).valid === true));

  const rejected = validateUserLanguageContext({ ...base, creativeOutputLanguage: "de" });
  ok("D9. the error names the specific offending field, not a generic message",
    /creativeOutputLanguage/.test(rejected.error));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
