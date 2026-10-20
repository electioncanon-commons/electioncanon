// ============================================================
// OUTREACH ACTIVATION — GMAIL DISPATCH/RECONCILIATION TRANSPORT
// BOUNDARY  (Launch Engine closed-loop, Phase 4/5)
//
// WHY THIS IS SEPARATE FROM outreach-admin/index.ts. That function's own
// test asserts it contains no fetch() call anywhere -- the literal proof
// it cannot dispatch anything. A real Gmail integration needs fetch()
// (to Google's OAuth/Gmail endpoints), so it lives here instead, behind
// the SAME OUTREACH_ADMIN_SECRET bearer gate (reusing the existing
// shared-secret pattern -- no new auth system), with a much narrower
// set of actions than outreach-admin's general CRUD surface.
//
// NOT CONFIGURED BY DEFAULT. Every action below checks for
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI /
// GMAIL_TOKEN_ENCRYPTION_KEY before doing anything else, and returns a
// clear GMAIL_OAUTH_NOT_CONFIGURED response naming exactly which secret
// is missing -- this function is written against the real Gmail API,
// but functionally inert until a human creates a Google Cloud OAuth
// client and sets these four secrets. See docs/OUTREACH-GMAIL-SETUP.md
// for the exact manual steps.
//
// TOKEN STORAGE. refresh_token is encrypted at rest with AES-256-GCM
// (Deno's native Web Crypto, no third-party crypto dependency) using a
// key derived from GMAIL_TOKEN_ENCRYPTION_KEY -- stored as
// ciphertext:iv, both base64. The decrypted value is NEVER logged, and
// outreach_gmail_connection.refresh_token_encrypted is never selected
// into any response this function returns (see
// test/election-outreach-gmail-function.consumer.mjs's source scan).
//
// EVERY REAL SEND OR RECONCILED EVENT IS RECORDED HERE, DIRECTLY --
// mirroring launch-send-campaign-email/index.ts's own established
// pattern of a single dispatch function owning both the provider call
// AND the resulting evidence write, rather than a fragile two-step
// round trip through a second function call that could be skipped.
//
// CONCURRENCY-SAFE SEND, VIA AN ATOMIC CLAIM (Phase 11 audit fix H-1).
// send_message INSERTs into outreach_message_send_claims BEFORE ever
// calling Gmail -- that single INSERT, backed by a unique index on
// idempotency_key, is what makes "at most one real send per key" an
// actual guarantee rather than a best-effort check. A claim that never
// resolves (network failure mid-send, or the whole process killed
// outright) becomes UNKNOWN, never auto-retried, and is only ever
// cleared by a human calling reconcile_send_claim with what they
// actually found in the real Sent folder. See that migration's own
// header for the full reasoning.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildAuthUrl, buildTokenExchangeBody, buildRefreshTokenBody, validateOAuthCallbackRequest,
  interpretGmailSendResponse, parseSendAsVerification, buildRawMimeMessage,
  validateSendMessageRequest, validateSyncRepliesRequest, OAUTH_STATE_TTL_MINUTES,
  classifyExistingClaim, validateReconcileSendClaimRequest, shouldUpdateSendAsState,
  isUniqueViolation, decideReconciliation, insertEvidenceIdempotent, updateClaimConditional,
} from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const refuse = (reason: string, code: string, status = 200) => json({ ok: false, code, reason }, status);

// ---------- token encryption (AES-256-GCM via Deno's native Web Crypto) ----------

async function getEncryptionKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY");
  if (!raw) return null;
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) return null; // must be a 32-byte (256-bit) key, base64-encoded
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(plaintext: string): Promise<string | null> {
  const key = await getEncryptionKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}:${btoa(String.fromCharCode(...iv))}`;
}

async function decryptToken(stored: string): Promise<string | null> {
  const key = await getEncryptionKey();
  if (!key) return null;
  const [ctB64, ivB64] = stored.split(":");
  if (!ctB64 || !ivB64) return null;
  const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null; // wrong key, corrupted ciphertext, or tampered data -- never throws past this boundary
  }
}

// ---------- required-configuration check ----------

function requiredOAuthConfig() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  const encryptionKeySet = !!Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY");
  const missing = [
    !clientId && "GOOGLE_CLIENT_ID", !clientSecret && "GOOGLE_CLIENT_SECRET",
    !redirectUri && "GOOGLE_REDIRECT_URI", !encryptionKeySet && "GMAIL_TOKEN_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];
  return { clientId, clientSecret, redirectUri, missing };
}

async function getFreshAccessToken(supabase: ReturnType<typeof createClient>, clientId: string, clientSecret: string) {
  // CLOSURE HARDENING: this entire body used to have no try/catch. A
  // thrown exception here -- a network-level failure reaching either the
  // Supabase REST endpoint or Google's token endpoint, as opposed to a
  // completed, structured error response -- propagated uncaught past
  // every caller (send_message, verify_send_as, sync_replies) and out of
  // the Deno.serve handler entirely, producing a non-JSON, unsanitized
  // HTTP 500 instead of this function's own {ok:false, reason} shape.
  // This call happens strictly BEFORE Gmail's own send endpoint is ever
  // contacted, so a failure here can never mean a message was sent --
  // returning {ok:false} (rather than throwing) lets every existing
  // caller's already-correct handling run: send_message marks its
  // just-claimed row FAILED (not UNKNOWN) and refuses cleanly.
  try {
    const { data: connection } = await supabase.from("outreach_gmail_connection").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!connection?.refresh_token_encrypted) return { ok: false as const, reason: "no Gmail connection is authorized yet -- run get_auth_url and complete the OAuth flow first" };
    const refreshToken = await decryptToken(connection.refresh_token_encrypted);
    if (!refreshToken) return { ok: false as const, reason: "stored refresh token could not be decrypted -- GMAIL_TOKEN_ENCRYPTION_KEY may have changed since it was stored; re-authorize" };

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildRefreshTokenBody({ clientId, clientSecret, refreshToken }),
    });
    const tokenBody = await res.json().catch(() => null);
    if (!res.ok || !tokenBody?.access_token) {
      if (res.status === 400 && tokenBody?.error === "invalid_grant") {
        await supabase.from("outreach_gmail_connection").update({ last_sync_status: "TOKEN_REVOKED", last_sync_error: "refresh token was revoked or expired" }).eq("id", connection.id);
        return { ok: false as const, reason: "the Gmail connection's refresh token has been revoked or expired -- re-authorize via get_auth_url" };
      }
      return { ok: false as const, reason: `could not refresh Gmail access token (${tokenBody?.error ?? res.status})` };
    }
    return { ok: true as const, accessToken: tokenBody.access_token as string, connection };
  } catch (err) {
    return { ok: false as const, reason: `could not reach the token-refresh dependency (Supabase or Google's token endpoint): ${String(err)}` };
  }
}

// insertEvidenceIdempotent/updateClaimConditional (Phase 11B) live in
// contract.mjs, not here -- they have no Deno-specific dependency (only
// the injected `supabase` client's query-builder calls), so keeping them
// in the plain-JS boundary file makes them directly unit-testable with a
// mock client under plain Node, the same way every other piece of logic
// in this file's test coverage works. See that file's own header.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);

  // The OAuth redirect from Google is a GET with no custom headers --
  // it cannot carry the OUTREACH_ADMIN_SECRET bearer token. Security for
  // this ONE unauthenticated path comes from the state-nonce round trip
  // (validateOAuthCallbackRequest) instead, exactly like any standard
  // OAuth2 authorization-code flow.
  if (req.method === "GET" && url.pathname.endsWith("/oauth_callback")) {
    const { clientId, clientSecret, redirectUri, missing } = requiredOAuthConfig();
    if (missing.length) return refuse(`Gmail OAuth is not configured -- missing: ${missing.join(", ")}`, "GMAIL_OAUTH_NOT_CONFIGURED", 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return refuse("supabase is not configured", "PROVIDER_NOT_CONFIGURED", 200);
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const { data: pending } = await supabase.from("outreach_gmail_connection").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const validation = validateOAuthCallbackRequest({
      code, state, storedState: (pending as any)?.pending_oauth_state, storedStateExpiresAt: (pending as any)?.pending_oauth_state_expires_at,
    });
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildTokenExchangeBody({ clientId: clientId!, clientSecret: clientSecret!, code, redirectUri: redirectUri! }),
    });
    const tokenBody = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenBody?.refresh_token) {
      return refuse(`token exchange failed: ${tokenBody?.error ?? tokenRes.status} -- note Google only issues a refresh_token on first consent; revoke prior access at myaccount.google.com/permissions and retry if this keeps happening`, "PROVIDER_ERROR", 200);
    }

    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
    const profileBody = await profileRes.json().catch(() => null);
    const googleAccountEmail = profileBody?.emailAddress ?? "UNKNOWN";

    const encrypted = await encryptToken(tokenBody.refresh_token);
    if (!encrypted) return refuse("GMAIL_TOKEN_ENCRYPTION_KEY is set but invalid -- must be a base64-encoded 32-byte key", "BAD_CONFIG", 200);

    await supabase.from("outreach_gmail_connection").upsert({
      id: (pending as any)?.id, google_account_email: googleAccountEmail, refresh_token_encrypted: encrypted,
      scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
      pending_oauth_state: null, pending_oauth_state_expires_at: null,
      updated_at: new Date().toISOString(),
    });

    return new Response(`Gmail connected as ${googleAccountEmail}. You can close this tab and return to the control room to verify the send-as identity.`, { headers: { "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") return refuse("only POST is accepted (except the oauth_callback GET redirect)", "METHOD_NOT_ALLOWED", 405);

  const adminSecret = Deno.env.get("OUTREACH_ADMIN_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return refuse("this action requires the outreach admin secret", "UNAUTHENTICATED", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const action = typeof body?.action === "string" ? body.action : "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return refuse("supabase is not configured", "PROVIDER_NOT_CONFIGURED", 200);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (action === "get_connection_status") {
    const { data } = await supabase.from("outreach_gmail_connection").select(
      "google_account_email, send_as_identity, send_as_verified, last_sync_at, last_sync_status, last_sync_error, scopes"
    ).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { missing } = requiredOAuthConfig();
    return json({
      ok: true,
      configured: missing.length === 0,
      missingConfig: missing,
      connected: !!data,
      googleAccountEmail: data?.google_account_email ?? null,
      sendAsIdentity: data?.send_as_identity ?? "UNKNOWN",
      sendAsVerified: data?.send_as_verified ?? false,
      lastSyncAt: data?.last_sync_at ?? null,
      lastSyncStatus: data?.last_sync_status ?? "NEVER_SYNCED",
      lastSyncError: data?.last_sync_error ?? null,
      scopes: data?.scopes ?? [],
    });
  }

  if (action === "get_auth_url") {
    const { clientId, redirectUri, missing } = requiredOAuthConfig();
    if (missing.length) return refuse(`Gmail OAuth is not configured -- missing: ${missing.join(", ")}. See docs/OUTREACH-GMAIL-SETUP.md.`, "GMAIL_OAUTH_NOT_CONFIGURED", 200);

    const state = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60 * 1000).toISOString();
    const { data: existing } = await supabase.from("outreach_gmail_connection").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      await supabase.from("outreach_gmail_connection").update({ pending_oauth_state: state, pending_oauth_state_expires_at: expiresAt }).eq("id", existing.id);
    } else {
      await supabase.from("outreach_gmail_connection").insert({ google_account_email: "PENDING", pending_oauth_state: state, pending_oauth_state_expires_at: expiresAt });
    }
    return json({ ok: true, authUrl: buildAuthUrl({ clientId: clientId!, redirectUri: redirectUri!, state }), expiresInMinutes: OAUTH_STATE_TTL_MINUTES });
  }

  if (action === "verify_send_as") {
    const { clientId, clientSecret, missing } = requiredOAuthConfig();
    if (missing.length) return refuse(`Gmail OAuth is not configured -- missing: ${missing.join(", ")}`, "GMAIL_OAUTH_NOT_CONFIGURED", 200);
    const target = typeof body.identity === "string" ? body.identity : "admin@electioncanon.org";

    const tokenResult = await getFreshAccessToken(supabase, clientId!, clientSecret!);
    if (!tokenResult.ok) return refuse(tokenResult.reason, "NOT_CONNECTED", 200);

    const sendAsRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } });
    const sendAsBody = await sendAsRes.json().catch(() => null);
    if (!sendAsRes.ok) return refuse(`could not read send-as settings (${sendAsRes.status})`, "PROVIDER_ERROR", 200);

    const result = parseSendAsVerification(sendAsBody, target);

    // AUDIT FIX M-2: checking a DIFFERENT identity than the one currently
    // on record must NEVER erase that other identity's own, still-valid
    // verification just because THIS check came back negative. Only
    // overwrite when the new result is itself positive, or when we are
    // re-checking the exact identity already on record (where even a
    // negative result is genuine, current information about that same
    // identity and must be allowed through).
    if (shouldUpdateSendAsState({ verified: result.verified, targetIdentity: target, currentSendAsIdentity: tokenResult.connection.send_as_identity })) {
      await supabase.from("outreach_gmail_connection").update({
        send_as_identity: result.verified ? target : "UNKNOWN", send_as_verified: result.verified, updated_at: new Date().toISOString(),
      }).eq("id", tokenResult.connection.id);
    }

    return json({ ok: true, identity: target, found: result.found, verified: result.verified });
  }

  if (action === "send_message") {
    // AUDIT FIX H-1. EVERY GATE MUST PASS BEFORE A SINGLE BYTE IS SENT: a
    // verified send-as identity, an explicit approved:true, a stable
    // confirmationId -- and now an ATOMIC CLAIM on that confirmationId's
    // idempotency key, held via a single INSERT into
    // outreach_message_send_claims BEFORE Gmail is ever called. The
    // claim's unique index is what actually closes the race the old
    // SELECT-then-INSERT pattern had: two concurrent requests can no
    // longer both pass a check and both reach Gmail's send endpoint --
    // at most one INSERT can ever succeed for a given key, full stop.
    const validation = validateSendMessageRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    const { clientId, clientSecret, missing } = requiredOAuthConfig();
    if (missing.length) return refuse(`Gmail OAuth is not configured -- missing: ${missing.join(", ")}`, "GMAIL_OAUTH_NOT_CONFIGURED", 200);

    const { data: contact } = await supabase.from("outreach_contacts").select("id").eq("id", validation.contactId).maybeSingle();
    if (!contact) return refuse("contact not found", "NOT_FOUND", 404);

    const idempotencyKey = `send:${validation.contactId}:${validation.confirmationId}`;

    // CLOSURE HARDENING (identified during final-readiness review of the
    // Phase 11D recovery-proof findings): this insert used to have no
    // try/catch at all -- a thrown exception (a genuine network-level
    // failure, distinct from the structured unique-violation handled
    // below) would propagate uncaught instead of producing a clear
    // refusal. The fix is deliberately NARROW and introduces NO new
    // duplicate-send risk: on a thrown exception we have not yet obtained
    // a claim, so Gmail is never called from this branch, and nothing is
    // ever marked FAILED here (which would wrongly license a brand-new
    // confirmationId). We simply refuse and require the caller to retry
    // with the EXACT SAME confirmationId -- that retry resolves safely
    // either way: if this attempt's insert never actually landed, the
    // retry creates a fresh claim and proceeds normally; if it DID land
    // (the exception was only in receiving the response), the retry hits
    // the real unique-violation and is routed through the already-tested
    // lost-claim-race path (classifyExistingClaim) just below.
    let claim: any = null;
    let claimError: any = null;
    try {
      const claimInsert = await supabase
        .from("outreach_message_send_claims")
        .insert({ idempotency_key: idempotencyKey, contact_id: validation.contactId, followup_id: validation.followupId })
        .select("*")
        .single();
      claim = claimInsert.data;
      claimError = claimInsert.error;
    } catch (err) {
      return refuse(
        `the request to claim this send attempt did not complete and its outcome is unknown: ${String(err)} -- retry with the EXACT SAME confirmationId (never a new one), so this resolves safely whether or not the claim actually landed`,
        "CLAIM_OUTCOME_UNKNOWN", 200,
      );
    }

    if (claimError || !claim) {
      // Lost the race (or this exact key was already attempted before) --
      // read whoever/whatever holds it now, AND whether real evidence
      // already exists for this key (Phase 11B: evidence is the stronger
      // fact -- see classifyExistingClaim's own header), and NEVER fall
      // through to a second Gmail call under this same key.
      const { data: existing } = await supabase.from("outreach_message_send_claims").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
      const { data: existingEvent } = await supabase.from("outreach_message_events").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
      const classification = classifyExistingClaim(existing, existingEvent);
      if (classification.action === "ALREADY_SENT") {
        return json({ ok: true, alreadySent: true, providerMessageId: classification.providerMessageId, providerThreadId: classification.providerThreadId });
      }
      if (classification.action === "PREVIOUSLY_FAILED") {
        return refuse(`this exact send attempt already failed previously: ${classification.error} -- use a new confirmationId to try again`, "PREVIOUSLY_FAILED", 200);
      }
      if (classification.action === "IN_PROGRESS") {
        return refuse("another request for this exact send is already in progress -- do not retry with the same confirmationId yet", "SEND_IN_PROGRESS", 200);
      }
      if (classification.action === "NEEDS_RECONCILIATION") {
        return refuse("a prior attempt for this exact send is in an unknown state and requires manual reconciliation (check the Sent folder, then call reconcile_send_claim) before any retry", "NEEDS_RECONCILIATION", 200);
      }
      // EXPIRED_NEEDS_RECONCILIATION: the claim is stale (older than the
      // lease) -- the process that made it almost certainly died without
      // ever learning Gmail's real answer. Mark it UNKNOWN right now
      // (lazy expiry) via the SAME conditional-update helper every other
      // claim mutation uses -- its result is checked, never assumed.
      if (existing) {
        await updateClaimConditional(supabase, existing.id, ["CLAIMED"], {
          status: "UNKNOWN", error: "claim lease expired with no resolution -- the owning request likely crashed before learning Gmail's real answer", updated_at: new Date().toISOString(),
        });
        // Whether or not that update actually matched (a concurrent
        // request may have just resolved it), the caller must not proceed
        // to send -- re-stating the same safe refusal either way.
      }
      return refuse("a prior attempt for this exact send never resolved and its outcome is unknown -- this requires manual reconciliation (check the Sent folder, then call reconcile_send_claim) before any retry", "NEEDS_RECONCILIATION", 200);
    }

    // We hold the claim. From here, every exit path EITHER resolves it
    // to a terminal state (SENT/FAILED) OR, if the outcome is genuinely
    // ambiguous, to UNKNOWN -- never leaves it CLAIMED on a path we
    // control, and never calls Gmail a second time for this key. Every
    // claim mutation below goes through updateClaimConditional, whose
    // result is always checked (Phase 11B / New-3) -- a failed bookkeeping
    // write never gets silently treated as having happened.
    const tokenResult = await getFreshAccessToken(supabase, clientId!, clientSecret!);
    if (!tokenResult.ok) {
      await updateClaimConditional(supabase, claim.id, ["CLAIMED"], { status: "FAILED", error: tokenResult.reason, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return refuse(tokenResult.reason, "NOT_CONNECTED", 200);
    }
    if (!tokenResult.connection.send_as_verified || tokenResult.connection.send_as_identity !== validation.senderIdentity) {
      const reason = `sender identity ${validation.senderIdentity} is not a verified send-as alias on the connected Gmail account -- run verify_send_as first`;
      await updateClaimConditional(supabase, claim.id, ["CLAIMED"], { status: "FAILED", error: reason, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return refuse(reason, "SENDER_NOT_VERIFIED", 200);
    }

    const raw = buildRawMimeMessage({
      to: validation.to, from: validation.senderIdentity, subject: validation.subject, text: validation.text, html: validation.html,
      inReplyTo: validation.inReplyTo, references: validation.references,
    });

    let sendRes: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST", headers: { Authorization: `Bearer ${tokenResult.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }), signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      // AMBIGUOUS OUTCOME: the request to Gmail itself never completed
      // (network failure, abort/timeout). We genuinely do NOT know
      // whether Gmail received and processed it. Mark UNKNOWN -- never
      // FAILED (that would wrongly license a same-key retry) and never
      // SENT (no evidence exists). This is the one terminal-looking
      // state this function is deliberately NOT allowed to resolve by
      // itself; it requires a human to check the Sent folder.
      await updateClaimConditional(supabase, claim.id, ["CLAIMED"], { status: "UNKNOWN", error: `network error calling Gmail: ${String(err)}`, updated_at: new Date().toISOString() });
      return refuse("the request to Gmail did not complete and the outcome is unknown -- do not retry automatically; check the Sent folder and call reconcile_send_claim", "SEND_OUTCOME_UNKNOWN", 200);
    }

    const sendBody = await sendRes.json().catch(() => null);
    const interpreted = interpretGmailSendResponse(sendRes.status, sendBody);
    if (!interpreted.ok) {
      // DEFINITE failure -- Gmail gave us a real, completed HTTP response
      // saying it did not send. Safe to mark FAILED, not UNKNOWN.
      await updateClaimConditional(supabase, claim.id, ["CLAIMED"], { status: "FAILED", error: interpreted.message, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return refuse(`send failed: ${interpreted.message}`, interpreted.code ?? "PROVIDER_ERROR", 200);
    }

    // DEFINITE success -- Gmail confirmed it with a real message id.
    // PHASE 11B (closes New-3): EVIDENCE FIRST, CLAIM SECOND. The evidence
    // row is the actual system-of-record every other part of this
    // subsystem reads (OutreachControlRoom, computeActivitySummary); the
    // claim row is just send-time bookkeeping/locking machinery. Writing
    // evidence first means a real, confirmed send is durably recorded and
    // user-visible even if the SECOND write (the claim's own status) hits
    // a transient failure -- a far better failure mode than the reverse,
    // where a "SENT" claim could exist with nothing in the evidence
    // ledger. If the evidence write itself fails for real (not just a
    // duplicate-key no-op), we do NOT claim success, and we preserve the
    // real provider id on the claim for reconciliation -- never resend.
    const evidenceResult = await insertEvidenceIdempotent(supabase, {
      contact_id: validation.contactId, followup_id: validation.followupId, direction: "OUTBOUND", activity_state: "SENT",
      provider: "GMAIL", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
      sender_identity: validation.senderIdentity, recipient_email: validation.to, subject: validation.subject,
      idempotency_key: idempotencyKey,
    });

    if (!evidenceResult.ok) {
      await updateClaimConditional(supabase, claim.id, ["CLAIMED"], {
        status: "UNKNOWN", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
        error: `Gmail accepted the message (provider id ${interpreted.providerMessageId}) but the evidence row could not be ${evidenceResult.ambiguous ? "confirmed as" : ""} persisted: ${evidenceResult.error}`,
        updated_at: new Date().toISOString(),
      });
      return refuse(
        `Gmail accepted the message (provider id ${interpreted.providerMessageId}) but the local evidence record could not be saved -- do NOT resend; the real provider id is preserved on the claim for reconciliation via reconcile_send_claim`,
        "EVIDENCE_PERSISTENCE_FAILED", 200,
      );
    }

    // Evidence is durably recorded. Resolve the claim to match -- if this
    // SECOND write fails or loses a race, the send itself is still
    // correctly recorded (see classifyExistingClaim's evidence-aware
    // ALREADY_SENT branch, which repairs exactly this lag on the next
    // lookup) -- it is never reported as a failure to this caller, since
    // the thing that matters (the evidence) already succeeded.
    await updateClaimConditional(supabase, claim.id, ["CLAIMED"], {
      status: "SENT", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
      resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    return json({ ok: true, alreadySent: false, providerMessageId: interpreted.providerMessageId, providerThreadId: interpreted.providerThreadId, event: evidenceResult.event });
  }

  if (action === "reconcile_send_claim") {
    // THE HUMAN RECOVERY PATH for a claim stuck at UNKNOWN (or FAILED, if
    // a human later finds contrary evidence). Never auto-invoked; never
    // itself calls Gmail -- it only records what a human actually found
    // by checking the real Sent folder.
    //
    // PHASE 11B (closes New-2): the ENTIRE decision -- idempotent match,
    // conflict, repair, or a genuinely new resolution -- is made by the
    // pure decideReconciliation() BEFORE any write, using an evidence
    // lookup performed under THIS request's own read. The actual
    // concurrency guard is the conditional UPDATE below (never an
    // unconditional one): two operators racing on the same claim can
    // still both reach this code, but only one's UPDATE can ever match
    // its expected prior status -- the loser re-reads the real final
    // state and reports it honestly, never assuming its own view won.
    //
    // PHASE 11C (approved policy, see docs/PHASE-11C-POLICY-IMPLEMENTATION.md):
    // POLICY A -- outcome:"NOT_SENT" is refused by validateReconcileSendClaimRequest
    // unless the operator supplies real, bounded providerEvidence describing
    // DEFINITIVE proof the provider did not accept the message; an ambiguous
    // or uncertain outcome must stay UNKNOWN and can never be reconciled to
    // NOT_SENT, because NOT_SENT is what licenses a subsequent same-contact
    // retry under a NEW confirmationId -- an uncertain NOT_SENT verdict is a
    // real duplicate-send risk. POLICY B -- a FAILED claim (including a
    // pre-flight failure) reconciling to SENT remains permitted exactly as
    // before, strictly gated on a real providerMessageId; this is the
    // explicitly ratified decision, not a new behavior.
    const validation = validateReconcileSendClaimRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    const { data: claim } = await supabase.from("outreach_message_send_claims").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
    const { data: existingEvent } = await supabase.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
    const decision = decideReconciliation({ claim, existingEvent, outcome: validation.outcome, providerMessageId: validation.providerMessageId });

    if (decision.action === "NOT_FOUND") return refuse("no claim exists for this idempotency key", "NOT_FOUND", 404);
    if (decision.action === "CONFLICT") return refuse(decision.reason, "CONFLICT", 200);
    if (decision.action === "ALREADY_RESOLVED") return refuse(decision.reason, "ALREADY_RESOLVED", 200);
    if (decision.action === "ALREADY_RESOLVED_MATCHING") return json({ ok: true, resolvedAs: "SENT", alreadyResolved: true, event: decision.event });

    const now = new Date().toISOString();

    if (decision.action === "REPAIR_MISSING_EVIDENCE") {
      // The claim already says SENT with this exact provider id; we just
      // confirmed (via existingEvent above) that no evidence row exists
      // for it. Repair ONLY the evidence row -- the claim's own status is
      // already correct and is left untouched. Never re-sends anything.
      const repairResult = await insertEvidenceIdempotent(supabase, {
        contact_id: claim.contact_id, followup_id: claim.followup_id, direction: "OUTBOUND", activity_state: "SENT",
        provider: "GMAIL", provider_message_id: claim.provider_message_id, provider_thread_id: claim.provider_thread_id,
        idempotency_key: claim.idempotency_key,
      });
      if (!repairResult.ok) return refuse(`could not repair the missing evidence row: ${repairResult.error}`, "PROVIDER_ERROR", 200);
      return json({ ok: true, resolvedAs: "SENT", repaired: true, event: repairResult.event });
    }

    if (decision.action === "RESOLVE_SENT") {
      const claimUpdate = await updateClaimConditional(supabase, claim.id, ["CLAIMED", "FAILED", "UNKNOWN"], {
        status: "SENT", provider_message_id: validation.providerMessageId, provider_thread_id: validation.providerThreadId,
        error: validation.note ? `manually reconciled: ${validation.note}` : "manually reconciled as SENT", resolved_at: now, updated_at: now,
      });
      if (claimUpdate.ambiguous) return refuse(`the claim update did not complete and its outcome is unknown: ${claimUpdate.error} -- do not retry blindly; re-check this claim's status before trying again`, "RECONCILE_OUTCOME_UNKNOWN", 200);
      if (!claimUpdate.ok) {
        // Lost a race against a concurrent resolution -- re-read the REAL
        // current state rather than assuming our own request's view of
        // "no evidence yet" is still true.
        const { data: finalEvent } = await supabase.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
        if (finalEvent && finalEvent.provider_message_id === validation.providerMessageId) {
          return json({ ok: true, resolvedAs: "SENT", alreadyResolved: true, event: finalEvent });
        }
        const { data: finalClaim } = await supabase.from("outreach_message_send_claims").select("status, provider_message_id").eq("id", claim.id).maybeSingle();
        return refuse(`a concurrent reconciliation already resolved this claim differently (now ${finalClaim?.status}${finalClaim?.provider_message_id ? `, provider_message_id=${finalClaim.provider_message_id}` : ""})`, "CONFLICT", 200);
      }

      const evidenceResult = await insertEvidenceIdempotent(supabase, {
        contact_id: claim.contact_id, followup_id: claim.followup_id, direction: "OUTBOUND", activity_state: "SENT",
        provider: "GMAIL", provider_message_id: validation.providerMessageId, provider_thread_id: validation.providerThreadId,
        idempotency_key: claim.idempotency_key,
      });
      if (!evidenceResult.ok) {
        return refuse(`the claim was marked SENT but the evidence row could not be persisted: ${evidenceResult.error} -- the claim still carries the real provider id (${validation.providerMessageId}) for a later repair via this same action`, "EVIDENCE_PERSISTENCE_FAILED", 200);
      }
      return json({ ok: true, resolvedAs: "SENT", event: evidenceResult.event });
    }

    // decision.action === "RESOLVE_NOT_SENT"
    // PHASE 11C POLICY A: validateReconcileSendClaimRequest already refused
    // this request unless validation.providerEvidence is a real, bounded,
    // non-trivial string describing DEFINITIVE provider evidence of
    // non-acceptance -- never reachable for a bare/ambiguous assertion.
    // That evidence text is durably recorded here (the claim's own `error`
    // column), alongside the existing resolved_at timestamp, satisfying all
    // three of Policy A's requirements: durably recorded, timestamp
    // preserved, definitive evidence on record.
    const claimUpdate = await updateClaimConditional(supabase, claim.id, ["CLAIMED", "FAILED", "UNKNOWN"], {
      status: "FAILED",
      error: `manually reconciled as not sent -- provider evidence: ${validation.providerEvidence}${validation.note ? ` (note: ${validation.note})` : ""}`,
      resolved_at: now, updated_at: now,
    });
    if (claimUpdate.ambiguous) return refuse(`the claim update did not complete and its outcome is unknown: ${claimUpdate.error} -- do not retry blindly; re-check this claim's status before trying again`, "RECONCILE_OUTCOME_UNKNOWN", 200);
    if (!claimUpdate.ok) {
      // A concurrent resolver may have just recorded a REAL send -- NOT_SENT
      // must never win over actual evidence.
      const { data: finalEvent } = await supabase.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
      return refuse(`a concurrent reconciliation already resolved this claim${finalEvent ? ` as SENT (provider_message_id=${finalEvent.provider_message_id})` : " differently"} -- cannot reconcile as NOT_SENT`, "CONFLICT", 200);
    }
    return json({ ok: true, resolvedAs: "NOT_SENT" });
  }

  if (action === "sync_replies") {
    // Incremental reconciliation using Gmail's history.list, falling
    // back to a full inbox scan when no historyId watermark exists yet
    // (first sync) or when history.list reports the watermark expired
    // (historyId too old -- Gmail only retains ~7 days of history). The
    // actual thread/RFC-header matching against known outbound events is
    // intentionally left to a FOLLOW-UP pass once this boundary is wired
    // to real credentials and real mailbox data exist to test against --
    // this action currently performs and records the sync watermark
    // update only, per Phase 11's "implement the integration boundary
    // and testable behaviour" allowance when full behavior cannot yet be
    // exercised end-to-end.
    const validation = validateSyncRepliesRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);
    const { clientId, clientSecret, missing } = requiredOAuthConfig();
    if (missing.length) return refuse(`Gmail OAuth is not configured -- missing: ${missing.join(", ")}`, "GMAIL_OAUTH_NOT_CONFIGURED", 200);

    const tokenResult = await getFreshAccessToken(supabase, clientId!, clientSecret!);
    if (!tokenResult.ok) return refuse(tokenResult.reason, "NOT_CONNECTED", 200);

    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } });
    const profileBody = await profileRes.json().catch(() => null);
    if (!profileRes.ok || !profileBody?.historyId) {
      await supabase.from("outreach_gmail_connection").update({ last_sync_status: "ERROR", last_sync_error: `could not read mailbox profile (${profileRes.status})` }).eq("id", tokenResult.connection.id);
      return refuse("could not read Gmail mailbox profile", "PROVIDER_ERROR", 200);
    }

    await supabase.from("outreach_gmail_connection").update({
      history_id: profileBody.historyId, last_sync_at: new Date().toISOString(), last_sync_status: "OK", last_sync_error: null,
    }).eq("id", tokenResult.connection.id);

    return json({ ok: true, historyId: profileBody.historyId, note: "watermark updated; message-level reply matching is implemented in matchReplyToContact() (src/domains/outreach/messageActivity.js) and wired into record_message_event via the control room once real mailbox data is available to verify against" });
  }

  return refuse(`unknown action: ${action}`, "BAD_REQUEST", 400);
});
