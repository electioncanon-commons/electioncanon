// ============================================================
// OUTREACH ACTIVATION — GMAIL DISPATCH/RECONCILIATION CONTRACT  (Launch
// Engine closed-loop, Phase 4/5)
//
// Plain JavaScript, no Deno APIs -- same split as outreach-admin/
// contract.mjs: this file owns every REQUEST-SHAPE validator and every
// pure data transform (MIME building, URL building, response parsing);
// index.ts owns every actual network call, token storage, and secret
// read. The Node test suite runs this exact file; Deno runs the exact
// same file in production.
//
// WHY THIS IS A SEPARATE EDGE FUNCTION FROM outreach-admin, NOT A NEW
// ACTION ON IT. outreach-admin/index.ts's own test
// (election-outreach-admin-function.consumer.mjs, section E/H) asserts
// "no fetch() call anywhere -- this function cannot dispatch anything
// itself," and that invariant is load-bearing: it is the literal proof
// that the CRUD/admin surface can never become a sending surface by
// accident. A real Gmail dispatch/reconciliation capability NEEDS
// fetch() (to Google's OAuth/Gmail endpoints) -- so it gets its own
// function, gated by the SAME OUTREACH_ADMIN_SECRET (reusing the
// existing shared-secret pattern, not inventing a second auth system),
// with its own, much narrower "what this function is and isn't allowed
// to do" discipline documented below.
//
// LEAST-PRIVILEGE SCOPES. Only two Gmail scopes are ever requested:
// gmail.send (dispatch only) and gmail.readonly (reconciliation/reply
// detection only, never gmail.modify -- this integration never deletes,
// labels, or archives anything in the connected mailbox).
//
// THE SEND PATH NEVER TRUSTS A BARE 2xx. interpretGmailSendResponse()
// below requires a real `id` (the Gmail message id) in a successful
// response body -- a 2xx with no id is treated as INVALID_RESPONSE, not
// a successful send, mirroring this project's existing
// interpretBrevoResponse() discipline in launch-send-campaign-email/
// contract.mjs exactly.
// ============================================================

export const GMAIL_SCOPES = Object.freeze(["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]);
export const SENDER_ACCOUNT = Object.freeze(["sotinnovate@gmail.com", "admin@electioncanon.org", "UNKNOWN"]);
export const OAUTH_STATE_TTL_MINUTES = 10;

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function boundedString(v, max) { return typeof v === "string" && v.length <= max; }

/**
 * Builds Google's OAuth2 authorization-code-flow URL. `state` must be a
 * caller-generated, server-stored random nonce (index.ts's job) -- this
 * function never generates its own randomness, so it stays pure and
 * testable with a fixed input.
 */
export function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // forces a refresh_token on every re-auth, not just the first
    scope: GMAIL_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Body for the authorization-code -> token exchange (application/x-www-form-urlencoded). */
export function buildTokenExchangeBody({ clientId, clientSecret, code, redirectUri }) {
  return new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code",
  }).toString();
}

/** Body for refreshing an access token from a stored refresh_token. */
export function buildRefreshTokenBody({ clientId, clientSecret, refreshToken }) {
  return new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token",
  }).toString();
}

export function validateOAuthCallbackRequest({ code, state, storedState, storedStateExpiresAt, now = new Date() }) {
  if (!isNonEmptyString(code)) return { valid: false, error: "missing authorization code" };
  if (!isNonEmptyString(state)) return { valid: false, error: "missing state parameter" };
  if (!isNonEmptyString(storedState)) return { valid: false, error: "no pending authorization request was found -- start over from get_auth_url" };
  if (state !== storedState) return { valid: false, error: "state mismatch -- possible CSRF attempt or a stale/reused authorization link" };
  if (!storedStateExpiresAt || new Date(storedStateExpiresAt).getTime() < now.getTime()) {
    return { valid: false, error: "this authorization request has expired -- start over from get_auth_url" };
  }
  return { valid: true, error: null };
}

/**
 * A successful Gmail users.messages.send response ALWAYS has a real
 * `id` -- a 2xx with no id, or a non-2xx status, is never treated as a
 * successful send. Mirrors interpretBrevoResponse()'s exact discipline
 * in launch-send-campaign-email/contract.mjs.
 */
export function interpretGmailSendResponse(status, body) {
  if (status < 200 || status >= 300) {
    return { ok: false, code: body?.error?.status ?? "PROVIDER_ERROR", message: body?.error?.message ?? `HTTP ${status}` };
  }
  if (!body || typeof body.id !== "string" || !body.id) {
    return { ok: false, code: "INVALID_RESPONSE", message: "Gmail returned a 2xx with no message id -- never treated as a successful send" };
  }
  return { ok: true, code: null, message: null, providerMessageId: body.id, providerThreadId: typeof body.threadId === "string" ? body.threadId : null };
}

/**
 * Parses Gmail's users.settings.sendAs.list response to answer "is
 * admin@electioncanon.org a verified send-as identity on this
 * connection." isVerified is true ONLY for an entry whose
 * verificationStatus is 'accepted' or which isPrimary -- a pending or
 * unverified alias is never treated as usable.
 */
export function parseSendAsVerification(sendAsListBody, targetEmail) {
  const entries = Array.isArray(sendAsListBody?.sendAs) ? sendAsListBody.sendAs : [];
  const match = entries.find((e) => typeof e.sendAsEmail === "string" && e.sendAsEmail.toLowerCase() === String(targetEmail).toLowerCase());
  if (!match) return { found: false, verified: false };
  const verified = match.isPrimary === true || match.verificationStatus === "accepted";
  return { found: true, verified };
}

/**
 * Builds a raw RFC 2822 multipart/alternative MIME message (plain text
 * + HTML), base64url-encoded exactly as Gmail's users.messages.send
 * expects in `raw`. Every header value is passed through a minimal
 * CRLF-injection guard (stripCrlf) -- a subject or address containing a
 * literal newline can never inject an extra header or body boundary.
 */
function stripCrlf(v) { return String(v ?? "").replace(/[\r\n]+/g, " "); }

export function buildRawMimeMessage({ to, from, subject, text, html, inReplyTo = null, references = null }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `To: ${stripCrlf(to)}`,
    `From: ${stripCrlf(from)}`,
    `Subject: ${stripCrlf(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${stripCrlf(inReplyTo)}`);
  if (references) headers.push(`References: ${stripCrlf(references)}`);

  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    text,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");

  const raw = `${headers.join("\r\n")}\r\n\r\n${body}`;
  const base64url = (typeof Buffer !== "undefined" ? Buffer.from(raw, "utf8").toString("base64") : btoa(raw))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base64url;
}

// ---------- send-claim lifecycle (Phase 11 audit fix H-1) ----------
// Pure, testable decision logic for the atomic-claim concurrency fix --
// see 20261014000000_election_outreach_message_activity.sql's
// outreach_message_send_claims header for the full design and why a
// placeholder row alone (without this lease/classification logic) does
// not close every failure mode.

export const CLAIM_STATUS = Object.freeze(["CLAIMED", "SENT", "FAILED", "UNKNOWN"]);
export const CLAIM_LEASE_MINUTES = 2;

/**
 * Given an EXISTING claim row (found after this request's own INSERT
 * lost a unique-index race), any EXISTING EVIDENCE row for the same key,
 * and the current time, decides what the caller must do. NEVER returns
 * an instruction to call Gmail again under the same key -- every branch
 * either returns a final answer (ALREADY_SENT, PREVIOUSLY_FAILED) or a
 * refusal that requires a human/reconciliation step (IN_PROGRESS,
 * NEEDS_RECONCILIATION) before anything else can happen under this exact
 * idempotency key.
 *
 * PHASE 11B (closes part of New-3): EVIDENCE IS THE SOURCE OF TRUTH, NOT
 * JUST THE CLAIM'S OWN STATUS COLUMN. Under the evidence-first write
 * ordering this phase introduces (see index.ts's send_message), a real
 * send can leave outreach_message_events correctly populated even if the
 * claim row's own status update lags behind (a transient failure on that
 * second, independent write). A caller who only checked claim.status
 * would wrongly see "CLAIMED"/stale and report IN_PROGRESS or
 * NEEDS_RECONCILIATION for a send that, in fact, already completed and
 * is already recorded. Passing the existing evidence row in here (looked
 * up by the SAME idempotency_key) lets this function recognize that case
 * and report ALREADY_SENT with the REAL evidence, regardless of what the
 * claim's own bookkeeping currently says.
 *
 * IN_PROGRESS vs. NEEDS_RECONCILIATION is a LEASE check, not a status
 * check alone: a CLAIMED row younger than CLAIM_LEASE_MINUTES is treated
 * as "another request is genuinely still working on it right now" (the
 * safe, common case -- two near-simultaneous clicks). A CLAIMED row
 * OLDER than the lease is treated as abandoned -- the process that made
 * it almost certainly died without ever learning whether Gmail actually
 * sent anything -- and is surfaced as needing reconciliation rather than
 * silently retried.
 */
export function classifyExistingClaim(claim, existingEvent = null, now = new Date()) {
  if (!claim) return { action: "NONE" };
  if (existingEvent) {
    return { action: "ALREADY_SENT", providerMessageId: existingEvent.provider_message_id, providerThreadId: existingEvent.provider_thread_id, fromEvidence: true };
  }
  if (claim.status === "SENT") {
    return { action: "ALREADY_SENT", providerMessageId: claim.provider_message_id, providerThreadId: claim.provider_thread_id, fromEvidence: false };
  }
  if (claim.status === "FAILED") {
    return { action: "PREVIOUSLY_FAILED", error: claim.error };
  }
  if (claim.status === "UNKNOWN") {
    return { action: "NEEDS_RECONCILIATION", error: claim.error };
  }
  // status === "CLAIMED", no evidence yet
  const claimedAt = new Date(claim.claimed_at).getTime();
  const ageMs = now.getTime() - claimedAt;
  if (Number.isNaN(claimedAt) || ageMs < 0) {
    // A clock skew/parsing anomaly is treated as "cannot prove this is
    // stale" -- never expire on bad data, only on a genuinely elapsed lease.
    return { action: "IN_PROGRESS" };
  }
  if (ageMs < CLAIM_LEASE_MINUTES * 60 * 1000) return { action: "IN_PROGRESS" };
  return { action: "EXPIRED_NEEDS_RECONCILIATION" };
}

/** Pure predicate: is this a Postgres unique-violation error (code 23505)? Named so every caller treats "this exact row already exists" consistently rather than re-deriving the code by hand. */
export function isUniqueViolation(error) {
  return !!error && error.code === "23505";
}

/**
 * THE PURE DECISION CORE OF reconcile_send_claim (Phase 11B, closes
 * New-2). Given the claim, any existing evidence row for the same key,
 * and what the operator is asserting, decides exactly one outcome --
 * index.ts executes it, never re-derives this logic inline. Keeping this
 * pure and DB-free means the full decision tree (idempotent-match,
 * conflict, repair, or a genuinely new resolution) is directly,
 * behaviorally testable without a live database or Deno runtime.
 *
 * WHY EVIDENCE IS CHECKED FIRST. An evidence row existing is a STRONGER,
 * more certain fact than the claim's own status column (which this
 * phase's evidence-first write ordering can leave temporarily stale --
 * see classifyExistingClaim's own header). If evidence already exists,
 * NOT_SENT can never be the answer, and a mismatched providerMessageId
 * is always a CONFLICT, never silently accepted.
 *
 * REPAIR_MISSING_EVIDENCE is the exact fix for the historical New-3
 * symptom: claim.status === 'SENT' with its own recorded provider id,
 * but (confirmed by the caller's own lookup) no matching evidence row.
 * Reconciling with that SAME provider id repairs the missing row --
 * never re-sends anything, never accepts a DIFFERENT id as if it were a
 * correction (that is still a conflict, requiring a human to look again).
 */
// ---------- Phase 11B: durable claim-state + evidence-first persistence helpers ----------
// Closes New-2 (concurrent reconcile_send_claim races) and New-3 (unchecked
// post-send persistence errors) WITHOUT a cross-table Postgres transaction/
// RPC -- see docs/PHASE-11B-SEND-RECOVERY-DESIGN.md for why that design was
// chosen over a PL/pgSQL function in this environment (this session cannot
// execute or validate Postgres SQL locally, so a design this file's own
// test suite can actually exercise -- with a mock client, not a live one --
// was chosen over one it could only source-scan).
//
// LIVE IN THIS FILE, NOT index.ts, DELIBERATELY. Neither helper touches any
// Deno-specific API -- only the injected `supabase` client's query-builder
// methods -- so keeping them here (plain JS) makes them directly
// unit-testable under plain Node with a hand-built mock client, the same
// way every other piece of request-shape/decision logic in this file is
// tested. index.ts imports both and never re-implements this logic inline.
//
// EVERY WRITE IS CHECKED. Neither helper ever discards an `error`; both
// distinguish three outcomes explicitly: a clean success, a DEFINITE
// conflict/failure (a real structured error response), and an AMBIGUOUS
// outcome (the request itself did not complete -- a thrown exception, not
// a structured response). Only the ambiguous case gets ONE bounded retry,
// because retrying an IDEMPOTENT database write (a unique-indexed insert,
// or an update conditioned on the row's prior state) is always safe --
// unlike retrying the external Gmail send itself, which neither helper
// ever does and which index.ts never does for the same request twice.

/**
 * Inserts one evidence row, idempotently. A unique-violation on
 * idempotency_key is NOT an error here -- it means the real evidence
 * already exists (written by this same request's own earlier attempt, a
 * concurrent resolver, or a prior completed attempt), so the existing row
 * is re-read and returned as the success case. A genuine, non-duplicate
 * error is reported as a definite failure. A thrown exception (a network
 * failure, not a structured response) is retried once -- safe, because
 * this insert is idempotent -- and only reported `ambiguous: true` if the
 * retry also fails to complete.
 */
export async function insertEvidenceIdempotent(supabase, fields) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.from("outreach_message_events").insert(fields).select("*").maybeSingle();
      if (!error) return { ok: true, event: data, ambiguous: false, error: null };
      if (isUniqueViolation(error)) {
        const { data: existing } = await supabase.from("outreach_message_events").select("*").eq("idempotency_key", fields.idempotency_key).maybeSingle();
        return { ok: true, event: existing, ambiguous: false, error: null };
      }
      return { ok: false, event: null, ambiguous: false, error: error.message };
    } catch (err) {
      if (attempt === 0) continue;
      return { ok: false, event: null, ambiguous: true, error: String(err) };
    }
  }
  return { ok: false, event: null, ambiguous: true, error: "insertEvidenceIdempotent: exhausted retries" };
}

/**
 * Updates a claim row CONDITIONALLY on its current status, and reports
 * whether the condition actually matched -- never assumes a write
 * succeeded just because no exception was thrown. `expectStatusIn: null`
 * means "any status except SENT" (SENT is always terminal for this
 * helper's callers -- a claim already resolved to SENT is never
 * overwritten by this path; reconciling THAT case is handled separately,
 * by decideReconciliation's REPAIR_MISSING_EVIDENCE/ALREADY_RESOLVED
 * branches, never by this helper).
 */
export async function updateClaimConditional(supabase, claimId, expectStatusIn, fields) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let q = supabase.from("outreach_message_send_claims").update(fields).eq("id", claimId);
      q = expectStatusIn ? q.in("status", expectStatusIn) : q.neq("status", "SENT");
      const { data, error } = await q.select("*").maybeSingle();
      if (error) return { ok: false, claim: null, ambiguous: false, error: error.message };
      return { ok: !!data, claim: data, ambiguous: false, error: data ? null : "no row matched the expected prior status -- a concurrent request already resolved this claim" };
    } catch (err) {
      if (attempt === 0) continue;
      return { ok: false, claim: null, ambiguous: true, error: String(err) };
    }
  }
  return { ok: false, claim: null, ambiguous: true, error: "updateClaimConditional: exhausted retries" };
}

export function decideReconciliation({ claim, existingEvent, outcome, providerMessageId }) {
  if (!claim) return { action: "NOT_FOUND" };

  if (existingEvent) {
    if (outcome === "SENT" && isNonEmptyString(providerMessageId) && existingEvent.provider_message_id === providerMessageId) {
      return { action: "ALREADY_RESOLVED_MATCHING", event: existingEvent };
    }
    return {
      action: "CONFLICT",
      reason: `evidence already exists for this idempotency key with provider_message_id=${existingEvent.provider_message_id} -- ${outcome === "SENT" ? `the supplied value (${providerMessageId ?? "(null)"}) does not match` : "cannot reconcile as NOT_SENT when a message was evidently sent"}`,
    };
  }

  if (claim.status === "SENT") {
    if (outcome === "SENT" && isNonEmptyString(providerMessageId) && claim.provider_message_id === providerMessageId) {
      return { action: "REPAIR_MISSING_EVIDENCE" };
    }
    return { action: "ALREADY_RESOLVED", reason: `claim is already resolved as SENT (provider_message_id=${claim.provider_message_id}) -- cannot be reconciled to a different outcome` };
  }

  return { action: outcome === "SENT" ? "RESOLVE_SENT" : "RESOLVE_NOT_SENT" };
}

// ---------- Phase 11C: approved NOT_SENT / FAILED->SENT reconciliation policy ----------
// PHASE 11C POLICY A (NOT_SENT). A send attempt may be reconciled to
// NOT_SENT (claim status FAILED) only when the attempt was durably
// recorded (a claim row exists -- see decideReconciliation's NOT_FOUND
// branch, unchanged), its timestamp is preserved (claimed_at/resolved_at,
// unchanged), AND the operator supplies DEFINITIVE provider evidence that
// the provider did not accept the message -- never a bare assertion.
// Before this phase, NOT_SENT required neither a note nor any evidence at
// all (see docs/PHASE-11B-SEND-RECOVERY-DESIGN.md §7's "unresolved product
// decision"); that gap is exactly what let an UNKNOWN (ambiguous) outcome
// be reconciled away as NOT_SENT with nothing behind it, which could then
// license a same-key-family retry (a NEW confirmationId) of a message that
// may have actually already been sent -- a real duplicate-send risk.
// providerEvidence is now MANDATORY for outcome:"NOT_SENT", bounded to a
// minimum length so an empty/trivial string can never satisfy it (this
// still cannot be cryptographically verified server-side -- that
// limitation is explicit, not hidden -- but it can no longer be skipped
// entirely), and bounded to a maximum length that, combined with the
// optional `note`, always fits the claims table's `error` column (<=2000
// chars, see the migration) with headroom to spare.
//
// PHASE 11C POLICY B (FAILED -> SENT). Explicitly ratified, not changed:
// decideReconciliation's existing behavior (a FAILED claim, including a
// pre-flight failure, can still reach RESOLVE_SENT given a real
// providerMessageId the operator found) IS the approved policy -- see
// docs/PHASE-11C-POLICY-IMPLEMENTATION.md. No distinct override flag was
// required; the existing providerMessageId-required discipline already
// satisfies "permitted only when provider evidence establishes the
// message was actually sent ... never fabricated."
export const MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH = 15;
export const MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH = 500;

/** Validates a reconcile_send_claim request -- the human-operated recovery path for a claim stuck at UNKNOWN. */
export function validateReconcileSendClaimRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!isNonEmptyString(b.idempotencyKey)) return { valid: false, error: "idempotencyKey is required" };
  if (b.outcome !== "SENT" && b.outcome !== "NOT_SENT") return { valid: false, error: "outcome must be either 'SENT' or 'NOT_SENT'" };
  if (b.outcome === "SENT" && !isNonEmptyString(b.providerMessageId)) {
    return { valid: false, error: "reconciling to SENT requires a real providerMessageId -- found by a human checking the actual Gmail Sent folder, never fabricated" };
  }
  if (b.outcome === "NOT_SENT") {
    const evidence = typeof b.providerEvidence === "string" ? b.providerEvidence.trim() : "";
    if (evidence.length < MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH || !boundedString(evidence, MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH)) {
      return {
        valid: false,
        error: `reconciling to NOT_SENT requires providerEvidence (at least ${MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH} characters, at most ${MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH}) describing the DEFINITIVE provider evidence that the message was not accepted -- e.g. a specific Gmail API error code/message, or a described, confirmed absence from the Sent folder. A timeout, a missing response, or any other ambiguous/uncertain outcome must remain UNKNOWN, never NOT_SENT -- a bare assertion with no such evidence is refused.`,
      };
    }
  }
  return {
    valid: true, error: null, idempotencyKey: b.idempotencyKey, outcome: b.outcome,
    providerMessageId: b.providerMessageId ?? null, providerThreadId: b.providerThreadId ?? null, note: b.note ?? null,
    providerEvidence: b.outcome === "NOT_SENT" ? b.providerEvidence.trim() : null,
  };
}

/**
 * Decides whether a verify_send_as result should overwrite the stored
 * connection state (Phase 11 audit fix M-2). NEVER overwrites a
 * DIFFERENT, previously-verified identity with a negative result from
 * checking some OTHER identity -- that was the bug: checking identity B
 * and finding it unverified used to blindly erase identity A's own,
 * still-valid verification. Overwriting is correct in exactly two cases:
 * the new result is itself a positive verification (always safe to
 * record), or the identity being re-checked IS the one currently on
 * record (in which case even a negative result is genuine, current
 * information about that same identity and must be allowed to downgrade
 * it).
 */
export function shouldUpdateSendAsState({ verified, targetIdentity, currentSendAsIdentity }) {
  if (verified) return true;
  return String(targetIdentity ?? "").toLowerCase() === String(currentSendAsIdentity ?? "").toLowerCase();
}

export const MAX_SHORT = 300;

/**
 * Validates a send_message request. idempotencyKey/confirmationId
 * discipline mirrors src/domains/outreach/messageActivity.js's
 * buildSendIdempotencyKey() exactly (this boundary cannot import src/,
 * same duplication rule as every other vocabulary/logic copy in this
 * project) -- a caller MUST supply a stable confirmationId so a retried
 * request after a timeout can be recognized as the same attempt rather
 * than firing a second real send.
 */
export function validateSendMessageRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!isNonEmptyString(b.contactId)) return { valid: false, error: "contactId is required" };
  if (!isNonEmptyString(b.to) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.to.trim())) return { valid: false, error: "to must be a valid email address" };
  if (!isNonEmptyString(b.subject) || !boundedString(b.subject, MAX_SHORT)) return { valid: false, error: "subject is required" };
  if (!isNonEmptyString(b.html)) return { valid: false, error: "html is required -- the exact approved HTML body must be sent, never re-rendered at send time" };
  if (!isNonEmptyString(b.text)) return { valid: false, error: "text is required -- a plain-text alternative is mandatory" };
  if (!isNonEmptyString(b.confirmationId) || !boundedString(b.confirmationId, 200)) {
    return { valid: false, error: "confirmationId is required -- a stable id that identifies THIS approved send attempt, so a retry can never duplicate it" };
  }
  if (b.approved !== true) return { valid: false, error: "approved must be explicitly true -- a human approval action is required before any dispatch" };
  if (b.senderIdentity != null && !SENDER_ACCOUNT.includes(b.senderIdentity)) return { valid: false, error: `senderIdentity must be one of: ${SENDER_ACCOUNT.join(", ")}` };
  return {
    valid: true, error: null,
    contactId: b.contactId, to: b.to.trim().toLowerCase(), subject: b.subject, html: b.html, text: b.text,
    confirmationId: b.confirmationId, senderIdentity: b.senderIdentity ?? "admin@electioncanon.org",
    inReplyTo: b.inReplyTo ?? null, references: b.references ?? null, followupId: b.followupId ?? null,
  };
}

export function validateSyncRepliesRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  return { valid: true, error: null, forceFullSync: b.forceFullSync === true };
}

export default {
  GMAIL_SCOPES, SENDER_ACCOUNT, OAUTH_STATE_TTL_MINUTES, MAX_SHORT,
  CLAIM_STATUS, CLAIM_LEASE_MINUTES,
  MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH, MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH,
  buildAuthUrl, buildTokenExchangeBody, buildRefreshTokenBody, validateOAuthCallbackRequest,
  interpretGmailSendResponse, parseSendAsVerification, buildRawMimeMessage,
  validateSendMessageRequest, validateSyncRepliesRequest,
  classifyExistingClaim, validateReconcileSendClaimRequest, shouldUpdateSendAsState,
  isUniqueViolation, decideReconciliation, insertEvidenceIdempotent, updateClaimConditional,
};
