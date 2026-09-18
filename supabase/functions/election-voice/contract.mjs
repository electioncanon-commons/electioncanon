// ============================================================
// ELECTIONCANON VOICE — WIRE CONTRACT  (Alpha 1.2)
//
// The request/response shapes at the voice boundary — plain JavaScript,
// no Deno APIs, so Deno runs it in production and Node runs the exact
// same code in the test suite. The validator itself (not just the
// transport wrapper in index.ts) is what test/election-voice.consumer.mjs
// exercises directly, because the validator — not the transport — is the
// actual security control: it's what decides whether a request shape is
// acceptable before any provider is ever consulted.
//
// PROVIDER-AGNOSTIC BY CONSTRUCTION. `PROVIDER_PROFILES` held ZERO
// entries through Alpha 1.2 — the user explicitly deferred picking a
// vendor until pricing/language coverage could be compared. Alpha 1.3
// did that comparison for real (Google Cloud, Azure, and three
// Nigeria-specific specialists — see docs/VOICE.md §
// "Provider comparison" for the sourced table) and registers exactly
// ONE real profile below: Google Cloud Speech-to-Text (Chirp/Chirp 2),
// the only candidate with BOTH documented Hausa/Yoruba/Igbo coverage AND
// a public wire-format reference precise enough to implement against
// without guessing. It STILL resolves to PROVIDER_NOT_CONFIGURED in
// every real deployment of this repository, because no
// ELECTION_VOICE_PROVIDER_KEY has ever been set here — registering the
// profile is not the same claim as having tested it live, and index.ts
// never pretends otherwise.
// ============================================================

export const LIMITS = Object.freeze({
  audioBytes: 10 * 1024 * 1024, // 10 MB — a few minutes of compressed speech
  ttsTextChars: 1_000,          // one spoken answer, not an essay
  timeoutMs: 20_000,
});

export const LANGUAGES = Object.freeze(["en", "ha", "yo", "ig", "pcm", "urh", "fr"]);

/**
 * The two operations this endpoint would perform, once a provider exists.
 *
 *   stt   audio in  -> transcript text out
 *   tts   text in   -> audio out
 *
 * Kept separate because they carry different payload shapes and different
 * risk (an uploaded audio blob vs. a short text string).
 */
export const OPERATIONS = Object.freeze(["stt", "tts"]);

const ALLOWED_AUDIO_TYPES = Object.freeze(["audio/webm", "audio/wav", "audio/mp4", "audio/ogg"]);

/** Shape-validate an STT request body. Never touches a provider. */
export function validateSttRequest(body) {
  if (!body || typeof body !== "object") return { valid: false, reason: "request body is not an object" };
  if (body.op !== "stt") return { valid: false, reason: `expected op "stt", got "${body.op}"` };
  if (typeof body.audioBase64 !== "string" || !body.audioBase64.length) {
    return { valid: false, reason: "audioBase64 is required" };
  }
  // base64 inflates ~4/3 — an approximate byte-size guard, not an exact one.
  if (body.audioBase64.length * 0.75 > LIMITS.audioBytes) {
    return { valid: false, reason: `audio exceeds ${LIMITS.audioBytes} bytes` };
  }
  if (!ALLOWED_AUDIO_TYPES.includes(body.mimeType)) {
    return { valid: false, reason: `mimeType must be one of: ${ALLOWED_AUDIO_TYPES.join(", ")}` };
  }
  if (body.language != null && !LANGUAGES.includes(body.language)) {
    return { valid: false, reason: `"${body.language}" is not a recognised language` };
  }
  return { valid: true };
}

/** Shape-validate a TTS request body. Never touches a provider. */
export function validateTtsRequest(body) {
  if (!body || typeof body !== "object") return { valid: false, reason: "request body is not an object" };
  if (body.op !== "tts") return { valid: false, reason: `expected op "tts", got "${body.op}"` };
  if (typeof body.text !== "string" || !body.text.trim()) return { valid: false, reason: "text is required" };
  if (body.text.length > LIMITS.ttsTextChars) return { valid: false, reason: `text exceeds ${LIMITS.ttsTextChars} characters` };
  if (body.language != null && !LANGUAGES.includes(body.language)) {
    return { valid: false, reason: `"${body.language}" is not a recognised language` };
  }
  return { valid: true };
}

/**
 * A provider profile must supply:
 *   id                the value ELECTION_VOICE_PROVIDER must equal
 *   sttSupportedLangs  election-domain language codes this profile can transcribe
 *   sttEndpoint({ projectId }) -> URL
 *   sttHeaders({ key }) -> headers object
 *   sttBody({ audioBase64, mimeType, language }) -> vendor-shaped request
 *   sttExtract(vendorResponseJson) -> string transcript, or "" if unrecognised shape
 *   tts*  — omitted entirely when a profile has no TTS capability (see google_stt).
 */
export const PROVIDER_PROFILES = Object.freeze({
  /**
   * GOOGLE CLOUD SPEECH-TO-TEXT V2 (Chirp/Chirp 2 models) — STT only.
   *
   * EVERY FIELD BELOW WAS READ FROM THE OFFICIAL REST REFERENCE, NOT
   * REMEMBERED (docs.cloud.google.com/speech-to-text/v2/docs/reference/
   * rest/v2/projects.locations.recognizers/recognize, and the
   * RecognitionConfig reference).
   *
   *   Endpoint: POST https://speech.googleapis.com/v2/{recognizer=
   *     projects/*&#47;locations/*&#47;recognizers/*}:recognize — `_` is a
   *     valid recognizer segment for an implicit/default recognizer, used
   *     here so no per-deployment recognizer resource has to be created
   *     first.
   *   Request:  { config: { autoDecodingConfig: {}, languageCodes: [...],
   *     model: "chirp_2" }, content: "<base64 audio>" }.
   *   Auth: `Authorization: Bearer <token>`, scope
   *     `https://www.googleapis.com/auth/cloud-platform`.
   *   Response: results[].alternatives[0].transcript.
   *
   * A REAL, DOCUMENTED LIMITATION, STATED RATHER THAN HIDDEN: Google's
   * bearer token here is a short-lived OAuth2 access token minted from a
   * service-account credential — NOT a static long-lived key. This
   * repository does not implement the service-account JWT-bearer
   * exchange (custom RS256 JWT signing code
   * that could never be tested live here, without a real Google project,
   * is a correctness risk this codebase's own discipline weighs against
   * shipping unverified). `ELECTION_VOICE_PROVIDER_KEY` for this profile
   * is therefore expected to already BE a valid access token, refreshed
   * by the deployer's own operational tooling (e.g. a scheduled job
   * running `gcloud auth print-access-token` for the service account, or
   * a small token-minting sidecar) — see docs/VOICE.md for
   * the full reasoning and the upgrade path to a real JWT exchange.
   *
   * Pidgin and Urhobo are absent from `sttSupportedLangs` on purpose —
   * Google's own supported-languages table lists no `pcm`/`urh` locale,
   * confirmed by reading that table directly, not assumed from the other
   * three being present.
   */
  google_stt: Object.freeze({
    id: "google_stt",
    sttSupportedLangs: Object.freeze(["en", "ha", "yo", "ig"]),
    sttLocale: Object.freeze({ en: "en-US", ha: "ha-NG", yo: "yo-NG", ig: "ig-NG" }),
    sttEndpoint: ({ projectId }) =>
      `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:recognize`,
    sttHeaders: ({ key }) => ({ Authorization: `Bearer ${key}` }),
    sttBody: ({ audioBase64, language }) => ({
      config: {
        autoDecodingConfig: {},
        languageCodes: [PROVIDER_PROFILES.google_stt.sttLocale[language] ?? "en-US"],
        model: "chirp_2",
      },
      content: audioBase64,
    }),
    /** Top alternative of the first result. "" (never throws) for any
     *  unrecognised shape, including a genuinely silent/no-speech audio
     *  clip, which Google represents as an empty `results` array. */
    sttExtract: (res) => {
      const r = res?.results?.[0]?.alternatives?.[0]?.transcript;
      return typeof r === "string" ? r : "";
    },
  }),
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_PROFILES));

/** Fails closed at each of four checks in turn: no provider selected
 *  (PROVIDER_NOT_SELECTED), an unrecognised provider id (PROVIDER_UNKNOWN),
 *  a selected provider missing its key (PROVIDER_NOT_CONFIGURED), and —
 *  a profile that exists and is configured but names no project
 *  (google_stt needs ELECTION_VOICE_GOOGLE_PROJECT_ID to build its
 *  endpoint URL) — the same PROVIDER_NOT_CONFIGURED code with a distinct
 *  reason string, rather than attempting a request to a malformed URL. */
export function resolveProfile(env = {}) {
  const id = env.ELECTION_VOICE_PROVIDER;
  if (!id) {
    return { ok: false, code: "PROVIDER_NOT_SELECTED",
      reason: PROVIDER_IDS.length
        ? `set ELECTION_VOICE_PROVIDER to one of: ${PROVIDER_IDS.join(", ")}`
        : "no voice provider profile is registered in this deployment yet — add one to " +
          "PROVIDER_PROFILES and set ELECTION_VOICE_PROVIDER when a vendor is chosen" };
  }
  const profile = PROVIDER_PROFILES[id];
  if (!profile) return { ok: false, code: "PROVIDER_UNKNOWN", reason: `"${id}" is not a registered voice provider profile` };
  if (!env.ELECTION_VOICE_PROVIDER_KEY) {
    return { ok: false, code: "PROVIDER_NOT_CONFIGURED", reason: `provider "${id}" is selected but no ELECTION_VOICE_PROVIDER_KEY is set` };
  }
  if (id === "google_stt" && !env.ELECTION_VOICE_GOOGLE_PROJECT_ID) {
    return { ok: false, code: "PROVIDER_NOT_CONFIGURED", reason: "provider \"google_stt\" is selected but no ELECTION_VOICE_GOOGLE_PROJECT_ID is set" };
  }
  return { ok: true, profile, projectId: env.ELECTION_VOICE_GOOGLE_PROJECT_ID };
}

/** Does this configured profile support this election-domain language
 *  for STT? Checked BEFORE ever calling the vendor — an unsupported
 *  language is a documented fact, not a vendor error to interpret. */
export function sttLanguageSupported(profile, language) {
  return Array.isArray(profile?.sttSupportedLangs) && profile.sttSupportedLangs.includes(language);
}

export default {
  LIMITS, LANGUAGES, OPERATIONS, validateSttRequest, validateTtsRequest,
  PROVIDER_PROFILES, PROVIDER_IDS, resolveProfile, sttLanguageSupported,
};
