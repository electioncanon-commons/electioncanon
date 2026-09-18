// ============================================================
// ELECTIONCANON VOICE — SERVER-SIDE TRANSPORT BOUNDARY  (Alpha 1.2)
//
// This is the only place that may hold a voice-provider secret, so the
// browser never has to. This function is TRANSPORT ONLY — the request/
// response contract and the (currently empty) provider registry live in
// contract.mjs, plain JavaScript with no Deno APIs, so Deno runs it here
// and the Node test suite runs the exact same code.
//
// WHAT THIS FUNCTION IS STRUCTURALLY INCAPABLE OF
//   * No database client — never imports @supabase/supabase-js, holds no
//     anon key and no service role.
//   * No provider is assumed. contract.mjs's PROVIDER_PROFILES is
//     genuinely empty this phase, so every request returns
//     PROVIDER_NOT_SELECTED — a real, honest, non-error outcome, not a
//     placeholder bug. See docs/VOICE.md.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { resolveProfile, validateSttRequest, validateTtsRequest, sttLanguageSupported, LIMITS } from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (reason: string, code: string, status = 200) =>
  json({ ok: false, code, reason, transcript: null, audioBase64: null }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return refuse("only POST is accepted", "METHOD_NOT_ALLOWED", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const op = (body as { op?: string })?.op;
  const validation = op === "stt" ? validateSttRequest(body) : op === "tts" ? validateTtsRequest(body) : { valid: false, reason: `"${op}" is not a recognised operation` };
  if (!validation.valid) return refuse(validation.reason, "BAD_REQUEST", 400);

  // Provider selected by ENVIRONMENT, never by the request, so a caller
  // cannot choose which vendor's key gets used.
  const resolved = resolveProfile(Deno.env.toObject());
  if (!resolved.ok) return refuse(resolved.reason, resolved.code, 200);

  if (op === "tts") {
    // No TTS provider is registered for any language this phase — see
    // contract.mjs's own header. A configured STT provider existing does
    // not imply a TTS one does; these are checked independently.
    return refuse("no text-to-speech provider is configured", "PROVIDER_NOT_CONFIGURED", 200);
  }

  const language = (body as { language?: string }).language ?? "en";
  if (!sttLanguageSupported(resolved.profile, language)) {
    return refuse(`"${language}" is not supported by the configured speech-to-text provider`, "UNSUPPORTED_LANGUAGE", 200);
  }

  try {
    const key = Deno.env.get("ELECTION_VOICE_PROVIDER_KEY") ?? "";
    const endpoint = resolved.profile.sttEndpoint({ projectId: resolved.projectId });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
    let vendorRes: Response;
    try {
      vendorRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...resolved.profile.sttHeaders({ key }) },
        body: JSON.stringify(resolved.profile.sttBody({ audioBase64: (body as { audioBase64: string }).audioBase64, language })),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!vendorRes.ok) {
      return refuse(`speech provider returned HTTP ${vendorRes.status}`, "PROVIDER_ERROR", 200);
    }
    const vendorJson = await vendorRes.json().catch(() => null);
    if (!vendorJson) return refuse("speech provider returned a non-JSON response", "PROVIDER_MALFORMED", 200);
    const transcript = resolved.profile.sttExtract(vendorJson);
    if (!transcript) return refuse("speech provider returned no recognisable speech", "PROVIDER_EMPTY", 200);
    return json({ ok: true, transcript, audioBase64: null });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return refuse(timedOut ? "speech provider timed out" : "speech provider request failed", timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE", 200);
  }
});
