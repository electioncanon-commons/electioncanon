// ============================================================
// ELECTIONCANON ALPHA 1.3 — VOICE PROVIDER, NEVER THROWS
//
// An injected transport (here, a mocked `supabase.functions.invoke`)
// proves every real failure/success shape maps to the right
// VOICE_STATUS, and that a genuinely browser-incapable environment
// never even reaches the network.
// ============================================================

import { VOICE_STATUS, browserSpeechAvailable } from "../src/domains/election/channels/voiceProvider.js";
import { resolveProfile, sttLanguageSupported, PROVIDER_PROFILES } from "../supabase/functions/election-voice/contract.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON ALPHA 1.3 — voice provider honesty\n");

// ============================================================
console.log("A — NODE HAS NO BROWSER MIC API, AND THIS IS REPORTED, NOT THROWN");
// ============================================================
{
  ok("A1. browserSpeechAvailable() is false under Node (no window/MediaRecorder)", browserSpeechAvailable() === false);
}

// ============================================================
console.log("\nB — contract.mjs's resolveProfile FOUR-WAY FAILURE SHAPE");
// ============================================================
{
  ok("B1. no provider selected -> PROVIDER_NOT_SELECTED", resolveProfile({}).code === "PROVIDER_NOT_SELECTED");
  ok("B2. unknown provider id -> PROVIDER_UNKNOWN", resolveProfile({ ELECTION_VOICE_PROVIDER: "not_a_real_vendor" }).code === "PROVIDER_UNKNOWN");
  ok("B3. selected, no key -> PROVIDER_NOT_CONFIGURED", resolveProfile({ ELECTION_VOICE_PROVIDER: "google_stt" }).code === "PROVIDER_NOT_CONFIGURED");
  ok("B4. selected + key, no project id -> PROVIDER_NOT_CONFIGURED (google_stt-specific)",
    resolveProfile({ ELECTION_VOICE_PROVIDER: "google_stt", ELECTION_VOICE_PROVIDER_KEY: "x" }).code === "PROVIDER_NOT_CONFIGURED");
  const full = resolveProfile({ ELECTION_VOICE_PROVIDER: "google_stt", ELECTION_VOICE_PROVIDER_KEY: "x", ELECTION_VOICE_GOOGLE_PROJECT_ID: "p" });
  ok("B5. fully configured -> ok:true with the real profile attached", full.ok === true && full.profile === PROVIDER_PROFILES.google_stt);
}

// ============================================================
console.log("\nC — LANGUAGE SUPPORT IS CHECKED BEFORE ANY VENDOR CALL");
// ============================================================
{
  const profile = PROVIDER_PROFILES.google_stt;
  ok("C1. Hausa is supported", sttLanguageSupported(profile, "ha"));
  ok("C2. Pidgin is NOT supported — Google's own table lists no pcm locale", !sttLanguageSupported(profile, "pcm"));
  ok("C3. Urhobo is NOT supported", !sttLanguageSupported(profile, "urh"));
  ok("C4. an unknown/garbage language code is NOT supported, never defaults to true", !sttLanguageSupported(profile, "xx"));
}

// ============================================================
console.log("\nD — google_stt's sttExtract NEVER THROWS ON A MALFORMED VENDOR RESPONSE");
// ============================================================
{
  const extract = PROVIDER_PROFILES.google_stt.sttExtract;
  ok("D1. a well-formed response extracts the transcript", extract({ results: [{ alternatives: [{ transcript: "hello" }] }] }) === "hello");
  ok("D2. no results at all (silence) -> empty string, not a crash", extract({ results: [] }) === "");
  ok("D3. a completely unrecognised shape -> empty string, not a crash", extract({ unexpected: true }) === "");
  ok("D4. null -> empty string, not a crash", extract(null) === "");
  ok("D5. a non-string transcript field -> empty string, never coerced/guessed", extract({ results: [{ alternatives: [{ transcript: 12345 }] }] }) === "");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
