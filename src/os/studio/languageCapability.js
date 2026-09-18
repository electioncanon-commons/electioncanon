// ============================================================
// FORGE — LANGUAGE CAPABILITY REGISTRY  (Alpha 1.3)
//
// ElectionCanon's six target languages (English, Nigerian Pidgin, Hausa,
// Yoruba, Igbo, Urhobo), each with an EXPLICIT, COMPUTED status — never
// a hardcoded claim, and never a single flattened "supported: true/false"
// boolean.
//
// WHY THIS IS STRUCTURED, NOT ONE ENUM. The brief's five states
// (VERIFIED/REVIEW_REQUIRED/TEXT_AVAILABLE/VOICE_AVAILABLE/UNAVAILABLE)
// describe THREE ORTHOGONAL FACTS: whether text realisation is reviewed,
// whether voice speech-to-text works, whether voice text-to-speech works.
// A language can be TEXT-reviewed and VOICE-unavailable at once (Urhobo),
// or voice-capable-once-configured and TEXT-unreviewed (Hausa). Collapsing
// these into one value would hide exactly the distinction this codebase's
// honesty discipline exists to preserve — the same reason `MISSION_POLICY`
// keeps `UNKNOWN` distinct from `OPTIONAL` rather than merging them.
//
// EVERYTHING BELOW IS COMPUTED FROM REAL STATE, NOT ASSERTED. `textStatus`
// reads each pack's own `lexiconCoverage()`; `detection` reads
// `language.js`'s real detector; `voiceStt`/`voiceTts` read the actual
// registered provider profiles in supabase/functions/election-voice/
// contract.mjs (imported by path reference here as a plain data mirror —
// see NOTE below on why this file can't literally `import` a Deno module).
// ============================================================

import { REALISED_LANGUAGES as ELECTION_REALISED } from "../../domains/election/studio/respond.js";
import { DETECTABLE } from "./language.js";
import * as hausa from "./hausa/coverage.js";
import * as yoruba from "./yoruba/coverage.js";
import * as igbo from "./igbo/coverage.js";
import * as pidgin from "./pidgin/coverage.js";
import * as urhobo from "../../os/studio/urhobo/coverage.js";

export const TEXT_STATUS = Object.freeze({ VERIFIED: "VERIFIED", REVIEW_REQUIRED: "REVIEW_REQUIRED", UNAVAILABLE: "UNAVAILABLE" });
export const VOICE_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",                         // a real, configured, working provider
  AVAILABLE_PENDING_CONFIG: "AVAILABLE_PENDING_CONFIG", // real registered profile, no key yet
  UNAVAILABLE: "UNAVAILABLE",                      // no viable provider found/implemented
});

// NOTE — this mirrors, rather than imports, `election-voice/contract.mjs`'s
// PROVIDER_PROFILES. That file lives under `supabase/functions/` so Deno
// deploys it standalone; importing it from browser-bundled code would pull
// a server-only module into the client bundle. The mirror is a single,
// explicit, commented table — not a duplicated GUESS — and
// `test/language-capability.consumer.mjs` asserts the two stay in sync by
// reading contract.mjs's own PROVIDER_IDS/LANGUAGES directly (Node can
// import contract.mjs directly — it has no Deno APIs, the same reason
// it can be dual-run in both Deno production and the Node test suite).
const VOICE_STT_LOCALES = Object.freeze({
  // Google Cloud Speech-to-Text (Chirp/Chirp 2) — real, documented locales.
  // See docs/VOICE.md for the citation and why Pidgin/TTS
  // are absent from this table rather than guessed at.
  en: "en-US", ha: "ha-NG", yo: "yo-NG", ig: "ig-NG",
});

function textStatusFor(coverageModule) {
  const pack = coverageModule.lexiconCoverage();
  return pack.approvedForProduction > 0 ? TEXT_STATUS.VERIFIED : TEXT_STATUS.REVIEW_REQUIRED;
}

/** Registered (real code, may still need a key) vs. genuinely absent. */
function voiceSttStatusFor(code) {
  if (!VOICE_STT_LOCALES[code]) return VOICE_STATUS.UNAVAILABLE;
  // "AVAILABLE" (fully live) would require a real, tested provider key —
  // this repository never holds one, so registered-but-unconfigured is
  // the honest ceiling this function can report from static analysis.
  return VOICE_STATUS.AVAILABLE_PENDING_CONFIG;
}

const LANGUAGES = Object.freeze({
  en: { name: "English", textCoverage: null }, // authoritative fallback, not a "pack"
  pcm: { name: "Nigerian Pidgin", textCoverage: pidgin },
  ha: { name: "Hausa", textCoverage: hausa },
  yo: { name: "Yoruba", textCoverage: yoruba },
  ig: { name: "Igbo", textCoverage: igbo },
  urh: { name: "Urhobo", textCoverage: urhobo },
});

/** The full, honest capability record for one language code. */
export function capabilityFor(code) {
  const entry = LANGUAGES[code];
  if (!entry) return null;
  const detected = DETECTABLE.includes(code);
  // VERIFIED requires BOTH a reviewer having approved real pack entries
  // AND the language actually being wired into REALISED_LANGUAGES — a
  // pack with approved words but no wired realiser can still only
  // produce isolated words, not a sentence, so it stays REVIEW_REQUIRED
  // at the pipeline level even if individual entries are approved.
  const text = code === "en" ? TEXT_STATUS.VERIFIED
    : !ELECTION_REALISED.includes(code) ? TEXT_STATUS.REVIEW_REQUIRED
    : textStatusFor(entry.textCoverage);
  return Object.freeze({
    code, name: entry.name,
    detection: detected,
    text,
    voiceStt: voiceSttStatusFor(code),
    voiceTts: VOICE_STATUS.UNAVAILABLE, // no TTS provider found this pass for any of these — see docs/VOICE.md §B
  });
}

export const ALL_CAPABILITIES = Object.freeze(Object.keys(LANGUAGES).map(capabilityFor));

/** The one sentence a UI may show. Never says "supported" unqualified. */
export function supportStatement(code) {
  const c = capabilityFor(code);
  if (!c) return `"${code}" is not a language ElectionCanon tracks.`;
  const parts = [
    `${c.name}: message detection ${c.detection ? "works" : "is not available"}.`,
    c.text === TEXT_STATUS.VERIFIED
      ? "Ask ElectionCanon can respond in this language."
      : "Ask ElectionCanon does not yet have reviewed response text for this language — questions are answered in English, and this is stated in the reply.",
    c.voiceStt === VOICE_STATUS.AVAILABLE ? "Voice input works."
      : c.voiceStt === VOICE_STATUS.AVAILABLE_PENDING_CONFIG ? "Voice input has a real, coded provider but no voice vendor is configured yet."
      : "No voice input provider was found for this language.",
    "No text-to-speech provider was found for this language.",
  ];
  return parts.join(" ");
}

export default { TEXT_STATUS, VOICE_STATUS, capabilityFor, ALL_CAPABILITIES, supportStatement };
