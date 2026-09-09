// ============================================================
// FORGE ELECTION — CREATIVE LANGUAGE CONTEXT  (Gate A.7.1)
//
// THE ARCHITECTURAL PROBLEM THIS FILE ANSWERS FIRST: Campaign Studio must
// eventually let a user work in one language, ask its (future) AI layer for
// help in a second, and produce graphic text in a third — see the A.7
// product direction's own worked example (interfaceLanguage=English,
// aiInteractionLanguage=Nigerian Pidgin, creativeOutputLanguage=Yoruba).
// Those are THREE INDEPENDENT SETTINGS, never one flattened "language" field
// and never derived from one another. This file's entire job is to make
// that separation a structural fact — a value with a closed, validated
// shape — rather than a convention three different call sites could each
// get slightly wrong.
//
// REUSED, NOT REINVENTED. ElectionCanon already has exactly one authoritative
// registry of its six target languages and their real, honestly-reported
// capability (os/studio/languageCapability.js, built for the separate "Ask
// ElectionCanon" conversational layer) and exactly one language detector
// (os/studio/language.js's detectLanguage(), covering en/ha/yo/ig/pcm/urh
// plus Forge's own fr). This file adds NEITHER a second language list NOR a
// second detector — CREATIVE_LANGUAGE_LIST below is DERIVED from
// languageCapability.js's own ALL_CAPABILITIES so the two can never drift
// apart, matching the exact "reuse the existing registry" precedent
// language.js's own header already sets. Detection itself is deliberately
// NOT wired in here yet — see "WHAT THIS FILE DELIBERATELY DOES NOT DO".
//
// NOT THE SAME LIST AS ASK ELECTIONCANON'S "CAN I ANSWER IN THIS LANGUAGE".
// languageCapability.js's `text` status answers "can Ask ElectionCanon
// COMPOSE a sentence in this language" (still English-only, VERIFIED only
// for "en" — see that file). creativeOutputLanguage answers a different
// question entirely: "what language did the HUMAN choose to type their own
// headline in" — the user supplies that text directly, so it is available
// for all six target languages from day one, regardless of Ask
// ElectionCanon's own realiser coverage. This file only ever reuses the
// CODE/NAME pairs from that registry, never its per-capability status
// fields, precisely to avoid conflating the two questions.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO (see the A.7.1 brief): no AI
// integration, no translation service, no voice, and no language detection
// wiring — a UserLanguageContext is a plain, validated settings value a
// caller sets explicitly, not yet something inferred from typed text. That
// is real future work (A.7.5+), and this file's job is only to make sure
// nothing about today's shape has to change to add it.
//
// NO DOM. NO TIMING. NO RENDERING. NO SUPABASE. Same discipline as every
// other design/ module (composition.js, creative.js, motion.js): a pure
// function of its inputs, never touching `document`/`window`, never reading
// campaign/asset/database state directly — see design/render.js's own
// header and test/election-web-adapter.consumer.mjs's F2 check, which scans
// this entire directory tree.
// ============================================================

import { ALL_CAPABILITIES } from "../../../os/studio/languageCapability.js";

// {code, name} pairs only — deliberately dropping ALL_CAPABILITIES' own
// per-language text/voice status fields, which describe Ask ElectionCanon's
// OWN realiser coverage, not whether a human may choose that language for
// their interface, AI conversation, or creative text (see this file's own
// header on why those are different questions).
export const CREATIVE_LANGUAGE_LIST = Object.freeze(
  ALL_CAPABILITIES.map((c) => Object.freeze({ code: c.code, name: c.name }))
);

export const CREATIVE_LANGUAGE_CODES = Object.freeze(CREATIVE_LANGUAGE_LIST.map((l) => l.code));

export const DEFAULT_LANGUAGE_CODE = "en";

// The three independent settings, and nothing else — adding a fourth
// (e.g. a future per-element output language override) is a line here and
// in defaultUserLanguageContext(), never a generic/open bag of language
// preferences.
export const LANGUAGE_CONTEXT_FIELD = Object.freeze({
  INTERFACE: "interfaceLanguage",
  AI_INTERACTION: "aiInteractionLanguage",
  CREATIVE_OUTPUT: "creativeOutputLanguage",
});
export const LANGUAGE_CONTEXT_FIELD_LIST = Object.freeze(Object.values(LANGUAGE_CONTEXT_FIELD));

/** The one starting value every session begins from — all three settings
 *  independently defaulted to English, never inferred from a country,
 *  campaign, or browser locale (see the A.7 brief's own "do NOT assume
 *  language from a country field"). A fresh object every call, like
 *  composition.js's own defaultCompositionFor(). */
export function defaultUserLanguageContext() {
  return Object.freeze({
    [LANGUAGE_CONTEXT_FIELD.INTERFACE]: DEFAULT_LANGUAGE_CODE,
    [LANGUAGE_CONTEXT_FIELD.AI_INTERACTION]: DEFAULT_LANGUAGE_CODE,
    [LANGUAGE_CONTEXT_FIELD.CREATIVE_OUTPUT]: DEFAULT_LANGUAGE_CODE,
  });
}

const STRUCTURE_ERROR = { valid: false, error: "Language context is missing or malformed." };

/** The composition.js/creative.js/motion.js-shaped validator: synchronous,
 *  deterministic, never mutates `context`, returns an honest {valid, error}
 *  naming the specific problem. Checks each of the three fields
 *  INDEPENDENTLY against the SAME closed language list — this is the
 *  structural proof that "local language does not mean looser governance"
 *  (the A.7 brief's own words) applies here too: a caller cannot smuggle an
 *  unrecognised value into any one of the three settings by, say, setting
 *  only creativeOutputLanguage and leaving the others untouched. */
export function validateUserLanguageContext(context) {
  if (!context || typeof context !== "object") return STRUCTURE_ERROR;

  for (const field of LANGUAGE_CONTEXT_FIELD_LIST) {
    const value = context[field];
    if (typeof value !== "string" || !CREATIVE_LANGUAGE_CODES.includes(value)) {
      return { valid: false, error: `"${value}" is not a recognised language for "${field}".` };
    }
  }

  return { valid: true, error: null };
}

export default {
  CREATIVE_LANGUAGE_LIST, CREATIVE_LANGUAGE_CODES, DEFAULT_LANGUAGE_CODE,
  LANGUAGE_CONTEXT_FIELD, LANGUAGE_CONTEXT_FIELD_LIST,
  defaultUserLanguageContext, validateUserLanguageContext,
};
