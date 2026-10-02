// ============================================================
// ELECTIONCANON — LANGUAGE MODEL  (multilingual Track A, extended to six
// — Six-Language Pass)
//
// Six languages this product offers a human a choice between, alphabetical
// by display name: English, Hausa, Igbo, Nigerian Pidgin, Urhobo, Yoruba.
// Every OTHER fact about each language — whether Ask ElectionCanon can
// actually answer in it — is never hardcoded here. It is read live from
// os/studio/languageCapability.js's capabilityFor(), the SAME
// computed-not-claimed registry Election's existing voice-status UI
// (AskAssistant.jsx's "Voice · soon" button) already trusts. This file
// adds no second source of truth about what is or isn't production-ready.
//
// WHY SIX NOW, WHEN ONLY THREE WERE HERE BEFORE. The previous revision's
// own header named the exact condition for this expansion: "reserved for
// exactly the 'existing architecture makes this necessary' case." That
// case has now arrived — Pidgin/Urhobo/Yoruba have their own
// ElectionCanon-shaped response-template packs (os/studio/pidgin|urhobo|
// yoruba/responses.js, same 27-template shape as Hausa/Igbo's, wired into
// respond.js's LANGUAGE_BUILDERS) exactly like Hausa/Igbo already did.
// EXPANDED_LANGUAGE_CODES is now empty — nothing left to reserve.
// ============================================================

import { capabilityFor, TEXT_STATUS } from "../../os/studio/languageCapability.js";

/** Static metadata — the facts that never change at runtime. Status is
 *  deliberately NOT here; see languageEntry() below. Declared in
 *  alphabetical-by-name order so SUPPORTED_LANGUAGE_CODES (and therefore
 *  the selector, which maps over LANGUAGES unchanged) lists them that
 *  way without a second sort step. */
const LANGUAGE_META = Object.freeze({
  en: { code: "en", name: "English", nativeName: "English", uiLabel: "English", locale: "en-NG", direction: "ltr" },
  ha: { code: "ha", name: "Hausa", nativeName: "Hausa", uiLabel: "Hausa", locale: "ha-NG", direction: "ltr" },
  ig: { code: "ig", name: "Igbo", nativeName: "Igbo", uiLabel: "Igbo", locale: "ig-NG", direction: "ltr" },
  pcm: { code: "pcm", name: "Nigerian Pidgin", nativeName: "Naija", uiLabel: "Nigerian Pidgin", locale: "pcm-NG", direction: "ltr" },
  urh: { code: "urh", name: "Urhobo", nativeName: "Urhobo", uiLabel: "Urhobo", locale: "urh-NG", direction: "ltr" },
  yo: { code: "yo", name: "Yoruba", nativeName: "Yorùbá", uiLabel: "Yoruba", locale: "yo-NG", direction: "ltr" },
});

export const SUPPORTED_LANGUAGE_CODES = Object.freeze(Object.keys(LANGUAGE_META));
export const DEFAULT_LANGUAGE = "en";

/** Nothing left reserved — the previous revision's "existing architecture
 *  makes this necessary" condition has been met for all three. Kept as an
 *  empty, frozen export rather than deleted, so a caller that still reads
 *  it (none did as of this revision) degrades to "nothing expanded" ---
 *  rather than crashing on an undefined import. */
export const EXPANDED_LANGUAGE_CODES = Object.freeze([]);

export const AVAILABILITY = Object.freeze({
  // Ask ElectionCanon can genuinely compose a sentence in this language —
  // mirrors languageCapability.js's TEXT_STATUS.VERIFIED exactly.
  AVAILABLE: "AVAILABLE",
  // The language exists in the selector (so the session/UI architecture
  // can be built and tested end-to-end) but Ask ElectionCanon has no
  // approved sentence generation for it yet — every answer honestly
  // falls back to English and says so. Never shown to a user as
  // "supported".
  REVIEW: "REVIEW",
});

/** The one, live-computed entry for a language code — never a hardcoded
 *  claim. `isValid` is false for a code this feature doesn't offer. */
export function languageEntry(code) {
  const meta = LANGUAGE_META[code];
  if (!meta) return Object.freeze({ code, isValid: false });
  const cap = capabilityFor(code);
  const availability = cap?.text === TEXT_STATUS.VERIFIED ? AVAILABILITY.AVAILABLE : AVAILABILITY.REVIEW;
  return Object.freeze({
    ...meta,
    isValid: true,
    availability,
    // A short, honest, user-facing explanation of exactly why — never a
    // flat "not supported" with no reason, and never silent about it.
    availabilityNote: availability === AVAILABILITY.AVAILABLE
      ? null
      : "Ask ElectionCanon answers in English for now — this language is awaiting native-speaker review before it answers directly.",
  });
}

export const LANGUAGES = Object.freeze(SUPPORTED_LANGUAGE_CODES.map(languageEntry));

export const isSupportedLanguageCode = (code) => SUPPORTED_LANGUAGE_CODES.includes(code);

export default { SUPPORTED_LANGUAGE_CODES, DEFAULT_LANGUAGE, EXPANDED_LANGUAGE_CODES, AVAILABILITY, languageEntry, LANGUAGES, isSupportedLanguageCode };
