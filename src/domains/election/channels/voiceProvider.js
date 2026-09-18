// ============================================================
// ELECTIONCANON VOICE — CLIENT-SIDE PROVIDER  (Alpha 1.2, extended 1.3)
//
// Same never-throws/explicit-status contract as src/os/studio/provider.js
// (see that file's header for the reasoning). Calls the
// `election-voice` Supabase Edge Function — see supabase/functions/
// election-voice/. Alpha 1.3 registered one real STT provider (Google
// Cloud Speech-to-Text) there, but this repository has never set the
// key it needs, so a real call still resolves to NOT_CONFIGURED in
// practice — registering a profile and possessing a working credential
// are different facts, and this module never conflates them.
//
// NO SECRET HERE. Exactly like provider.js: no voice-provider key, no
// `VITE_` variable that could carry one, and this file does not even
// name the server-side environment variable a future key would live in
// (see docs/VOICE.md for that name) — the strongest form
// of the guarantee is that the client cannot leak what it never reads.
// ============================================================

/** Voice outcomes, mirroring src/os/studio/provider.js's PROVIDER enum. */
export const VOICE_STATUS = Object.freeze({
  OK: "OK",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNREACHABLE: "UNREACHABLE",
  REFUSED: "REFUSED",
  MALFORMED: "MALFORMED",
  NOT_SUPPORTED_BY_BROWSER: "NOT_SUPPORTED_BY_BROWSER",
  UNSUPPORTED_LANGUAGE: "UNSUPPORTED_LANGUAGE",
});

const FUNCTION_NAME = "election-voice";

let clientPromise = null;
async function getSupabase() {
  if (!clientPromise) {
    clientPromise = import("../../../lib/supabase.js")
      .then((m) => ({ supabase: m.supabase, isConfigured: m.isConfigured }))
      .catch(() => ({ supabase: null, isConfigured: false }));
  }
  return clientPromise;
}

async function invoke(body) {
  const { supabase, isConfigured } = await getSupabase();
  if (!isConfigured || !supabase) {
    return { status: VOICE_STATUS.NOT_CONFIGURED, reason: "Supabase is not configured in this build" };
  }
  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
    if (error) return { status: VOICE_STATUS.UNREACHABLE, reason: error.message ?? "voice function unreachable" };
    if (!data || typeof data !== "object") return { status: VOICE_STATUS.MALFORMED, reason: "voice function returned an unrecognised shape" };
    if (data.ok === false) {
      const code = data.code;
      const status = code === "PROVIDER_NOT_SELECTED" || code === "PROVIDER_NOT_CONFIGURED" || code === "PROVIDER_NOT_IMPLEMENTED" ? VOICE_STATUS.NOT_CONFIGURED
        : code === "UNSUPPORTED_LANGUAGE" ? VOICE_STATUS.UNSUPPORTED_LANGUAGE
        : code === "PROVIDER_TIMEOUT" || code === "PROVIDER_UNREACHABLE" ? VOICE_STATUS.UNREACHABLE
        : code === "PROVIDER_MALFORMED" ? VOICE_STATUS.MALFORMED
        : VOICE_STATUS.REFUSED;
      return { status, reason: data.reason ?? "voice request refused" };
    }
    return { status: VOICE_STATUS.OK, data };
  } catch (err) {
    return { status: VOICE_STATUS.UNREACHABLE, reason: err?.message ?? "voice function call failed" };
  }
}

/** Is the browser's own microphone/speech API even present? Checked BEFORE
 *  ever touching the network — no point calling a NOT_CONFIGURED server
 *  when there is also no local capture path. */
export function browserSpeechAvailable() {
  return typeof window !== "undefined" &&
    (typeof window.MediaRecorder !== "undefined") &&
    (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function");
}

/** Speech-to-text. Never throws. `audioBase64`/`mimeType` are already
 *  captured by the caller (this module does no microphone access itself —
 *  that stays a UI concern, matching the ARCHITECTURE.md voice boundary:
 *  "speech-to-text happens before the pipeline"). */
export async function transcribe({ audioBase64, mimeType, language = null } = {}) {
  if (!browserSpeechAvailable()) {
    return { status: VOICE_STATUS.NOT_SUPPORTED_BY_BROWSER, reason: "this browser has no microphone capture API", transcript: null };
  }
  const result = await invoke({ op: "stt", audioBase64, mimeType, language });
  return { status: result.status, reason: result.reason ?? null, transcript: result.data?.transcript ?? null };
}

/** Text-to-speech. Never throws. Reads back the EXACT answer text a
 *  caller already produced (e.g. planElectionResponse's `answer`) — this
 *  module never generates its own wording, per the same architecture
 *  boundary. */
export async function speak({ text, language = null } = {}) {
  const result = await invoke({ op: "tts", text, language });
  return { status: result.status, reason: result.reason ?? null, audioBase64: result.data?.audioBase64 ?? null };
}

export default { VOICE_STATUS, browserSpeechAvailable, transcribe, speak };
