// ============================================================
// OUTREACH ACTIVATION — GMAIL DISPATCH/RECONCILIATION FUNCTION TESTS
// (Launch Engine closed-loop, Phase 4/5)
// Covers: supabase/functions/outreach-gmail/contract.mjs (pure, fully
// testable here), and a source scan of index.ts proving the admin gate,
// the evidence-required send discipline, idempotent retry safety, and
// safe secret/token handling.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GMAIL_SCOPES, buildAuthUrl, buildTokenExchangeBody, buildRefreshTokenBody, validateOAuthCallbackRequest,
  interpretGmailSendResponse, parseSendAsVerification, buildRawMimeMessage,
  validateSendMessageRequest, validateSyncRepliesRequest,
  CLAIM_STATUS, CLAIM_LEASE_MINUTES, classifyExistingClaim, validateReconcileSendClaimRequest, shouldUpdateSendAsState,
  isUniqueViolation, decideReconciliation, insertEvidenceIdempotent, updateClaimConditional,
  MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH, MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH,
} from "../supabase/functions/outreach-gmail/contract.mjs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const indexTs = readSrc("supabase/functions/outreach-gmail/index.ts");
const indexCode = stripComments(indexTs);

console.log("\nOUTREACH ACTIVATION — Gmail dispatch/reconciliation function\n");

console.log("A — least-privilege scopes");
{
  ok("1. exactly gmail.send and gmail.readonly -- never gmail.modify", GMAIL_SCOPES.length === 2 && GMAIL_SCOPES.every((s) => /gmail\.(send|readonly)$/.test(s)));
}

console.log("\nB — buildAuthUrl() / token exchange bodies");
{
  const url = buildAuthUrl({ clientId: "CID", redirectUri: "https://x.com/cb", state: "STATE123" });
  ok("1. the auth URL points at Google's real OAuth endpoint", url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
  ok("2. access_type=offline is present (required to ever receive a refresh_token)", url.includes("access_type=offline"));
  ok("3. the exact state value is carried through unmodified", url.includes("state=STATE123"));
  ok("4. both scopes are present in the URL", GMAIL_SCOPES.every((s) => url.includes(encodeURIComponent(s))));

  const exchangeBody = buildTokenExchangeBody({ clientId: "CID", clientSecret: "SECRET", code: "CODE", redirectUri: "https://x.com/cb" });
  ok("5. token exchange body uses grant_type=authorization_code", exchangeBody.includes("grant_type=authorization_code"));
  const refreshBody = buildRefreshTokenBody({ clientId: "CID", clientSecret: "SECRET", refreshToken: "RT" });
  ok("6. refresh body uses grant_type=refresh_token", refreshBody.includes("grant_type=refresh_token"));
}

console.log("\nC — validateOAuthCallbackRequest() (CSRF-protection state nonce)");
{
  const now = new Date("2026-10-14T12:00:00Z");
  const future = "2026-10-14T12:10:00Z";
  const past = "2026-10-14T11:00:00Z";
  ok("1. a matching, unexpired state is accepted", validateOAuthCallbackRequest({ code: "c", state: "s1", storedState: "s1", storedStateExpiresAt: future, now }).valid === true);
  ok("2. a mismatched state is rejected", validateOAuthCallbackRequest({ code: "c", state: "s1", storedState: "s2", storedStateExpiresAt: future, now }).valid === false);
  ok("3. an expired state is rejected even if it matches", validateOAuthCallbackRequest({ code: "c", state: "s1", storedState: "s1", storedStateExpiresAt: past, now }).valid === false);
  ok("4. no pending state at all (never initiated) is rejected", validateOAuthCallbackRequest({ code: "c", state: "s1", storedState: null, storedStateExpiresAt: null, now }).valid === false);
  ok("5. a missing code is rejected", validateOAuthCallbackRequest({ code: "", state: "s1", storedState: "s1", storedStateExpiresAt: future, now }).valid === false);
}

console.log("\nD — interpretGmailSendResponse() (a bare 2xx with no id is NEVER a successful send)");
{
  ok("1. a 2xx WITH a real id is a successful send", interpretGmailSendResponse(200, { id: "18abc", threadId: "th1" }).ok === true);
  ok("2. a 2xx with NO id is INVALID_RESPONSE, not a success", interpretGmailSendResponse(200, {}).ok === false && interpretGmailSendResponse(200, {}).code === "INVALID_RESPONSE");
  ok("3. a 4xx/5xx is never a success regardless of body shape", interpretGmailSendResponse(403, { id: "would-be-ignored" }).ok === false);
  ok("4. a successful interpretation carries the real providerMessageId/providerThreadId through", interpretGmailSendResponse(200, { id: "18abc", threadId: "th1" }).providerMessageId === "18abc");
}

console.log("\nE — parseSendAsVerification() (only 'accepted'/isPrimary counts as verified)");
{
  const body = { sendAs: [
    { sendAsEmail: "admin@electioncanon.org", verificationStatus: "accepted" },
    { sendAsEmail: "sotinnovate@gmail.com", isPrimary: true },
    { sendAsEmail: "pending@electioncanon.org", verificationStatus: "pending" },
  ] };
  ok("1. an accepted alias is verified", parseSendAsVerification(body, "admin@electioncanon.org").verified === true);
  ok("2. the primary account is verified even with no verificationStatus field", parseSendAsVerification(body, "sotinnovate@gmail.com").verified === true);
  ok("3. a pending (not yet accepted) alias is NOT verified", parseSendAsVerification(body, "pending@electioncanon.org").verified === false);
  ok("4. an identity not present at all reports found:false, verified:false", parseSendAsVerification(body, "nobody@x.com").found === false);
  ok("5. matching is case-insensitive on the email address", parseSendAsVerification(body, "ADMIN@electioncanon.org").verified === true);
}

console.log("\nF — buildRawMimeMessage() (multipart/alternative, CRLF-injection guarded)");
{
  const raw = buildRawMimeMessage({ to: "a@b.com", from: "admin@electioncanon.org", subject: "Hi", text: "Plain body", html: "<p>HTML body</p>" });
  const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  ok("1. decodes back to a real MIME message with both parts", decoded.includes("Plain body") && decoded.includes("<p>HTML body</p>"));
  ok("2. declares multipart/alternative", decoded.includes("multipart/alternative"));
  ok("3. a newline injected into the subject cannot create a second header", !buildRawMimeMessage({ to: "a@b.com", from: "f@x.com", subject: "Hi\r\nBcc: evil@x.com", text: "t", html: "h" })
     .replace(/-/g, "+").replace(/_/g, "/")
     .length || Buffer.from(buildRawMimeMessage({ to: "a@b.com", from: "f@x.com", subject: "Hi\r\nBcc: evil@x.com", text: "t", html: "h" }).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").split("\r\n").filter((l) => /^Bcc:/i.test(l)).length === 0);
  ok("4. In-Reply-To/References headers are included when provided (thread continuity for follow-ups)",
     Buffer.from(buildRawMimeMessage({ to: "a@b.com", from: "f@x.com", subject: "Re: Hi", text: "t", html: "h", inReplyTo: "<msg-1@mail>", references: "<msg-1@mail>" }).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").includes("In-Reply-To: <msg-1@mail>"));
}

console.log("\nG — validateSendMessageRequest() (every dispatch gate)");
{
  const base = { contactId: "c1", to: "a@b.com", subject: "Hi", html: "<p>h</p>", text: "t", confirmationId: "conf-1", approved: true };
  ok("1. a fully-formed, approved request passes", validateSendMessageRequest(base).valid === true);
  ok("2. approved:true is MANDATORY -- false or missing is refused", validateSendMessageRequest({ ...base, approved: false }).valid === false && validateSendMessageRequest({ ...base, approved: undefined }).valid === false);
  ok("3. a missing confirmationId is refused (no idempotency key possible)", validateSendMessageRequest({ ...base, confirmationId: "" }).valid === false);
  ok("4. an invalid recipient email is refused", validateSendMessageRequest({ ...base, to: "not-an-email" }).valid === false);
  ok("5. a missing html body is refused", validateSendMessageRequest({ ...base, html: "" }).valid === false);
  ok("6. a missing plain-text alternative is refused", validateSendMessageRequest({ ...base, text: "" }).valid === false);
  ok("7. defaults senderIdentity to admin@electioncanon.org when not given", validateSendMessageRequest(base).senderIdentity === "admin@electioncanon.org");
  ok("8. an out-of-vocabulary senderIdentity is refused", validateSendMessageRequest({ ...base, senderIdentity: "random@x.com" }).valid === false);
}

console.log("\nH — validateSyncRepliesRequest()");
{
  ok("1. an empty body is valid (defaults forceFullSync to false)", validateSyncRepliesRequest({}).valid === true && validateSyncRepliesRequest({}).forceFullSync === false);
}

console.log("\nI — source scan: admin gate, evidence-required send, idempotent retry safety, safe secrets");
{
  ok("1. every non-oauth_callback action requires OUTREACH_ADMIN_SECRET as a bearer token",
     /const adminSecret = Deno\.env\.get\("OUTREACH_ADMIN_SECRET"\)[\s\S]{0,200}UNAUTHENTICATED/.test(indexCode));
  ok("2. the oauth_callback path is reached only via GET with no header requirement (Google cannot send custom headers on a redirect)",
     /req\.method === "GET" && url\.pathname\.endsWith\("\/oauth_callback"\)/.test(indexCode));
  ok("3. the oauth_callback path validates the state nonce before exchanging any code",
     /validateOAuthCallbackRequest\(/.test(indexCode));
  ok("4. send_message checks for an existing event under the SAME idempotency key BEFORE calling Gmail -- a retry can never double-send",
     /idempotency_key", idempotencyKey\)\.maybeSingle\(\)[\s\S]{0,200}alreadySent: true/.test(indexCode));
  ok("5. send_message refuses to dispatch unless send_as_verified is true for the exact requested identity",
     /send_as_verified[\s\S]{0,700}SENDER_NOT_VERIFIED/.test(indexCode));
  ok("6. a successful send is interpreted via interpretGmailSendResponse before being recorded as evidence",
     /interpretGmailSendResponse\(sendRes\.status, sendBody\)/.test(indexCode));
  ok("7. a failed/invalid send response is refused, never recorded as a SENT message_event (now via a claim-resolving block, not a bare one-liner)",
     /if \(!interpreted\.ok\) \{[\s\S]{0,300}status: "FAILED"[\s\S]{0,300}return refuse/.test(indexCode));
  ok("8. the refresh_token is NEVER logged -- no console.log/error/warn anywhere in this file",
     !/console\.(log|error|warn)/.test(indexTs));
  ok("9. the refresh token column is only ever referenced for encryption/decryption, never returned in a response body",
     !/json\(\{[\s\S]{0,400}refresh_token/.test(indexCode));
  ok("10. token encryption uses AES-GCM (authenticated encryption, not a plain cipher)", /AES-GCM/.test(indexCode));
  ok("11. a revoked/expired refresh token (invalid_grant) is detected and marks the connection TOKEN_REVOKED rather than silently retrying forever",
     /invalid_grant[\s\S]{0,200}TOKEN_REVOKED/.test(indexCode));
  ok("12. every action checks for missing OAuth configuration and names exactly what is missing, rather than attempting a call with undefined credentials",
     (indexCode.match(/GMAIL_OAUTH_NOT_CONFIGURED/g) || []).length >= 3);
  ok("13. the one unauthenticated path (oauth_callback) never returns the exchanged tokens to the browser -- only a plain confirmation message",
     !/refresh_token:/.test(indexCode.split('endsWith("/oauth_callback")')[1]?.split("return new Response(`Gmail connected")[0] ?? ""));
}

console.log("\nJ — classifyExistingClaim() (audit fix H-1 + Phase 11B evidence-aware classification)");
{
  const now = new Date("2026-10-15T12:00:00Z");
  ok("1. no existing claim at all -> NONE (the caller's own INSERT should have won; this is an unexpected but harmless case)", classifyExistingClaim(null, null, now).action === "NONE");

  const sentClaim = { status: "SENT", provider_message_id: "18abc", provider_thread_id: "th1" };
  ok("2. a SENT claim, no evidence row passed -> ALREADY_SENT from the claim's own fields (never re-send)",
     classifyExistingClaim(sentClaim, null, now).action === "ALREADY_SENT" && classifyExistingClaim(sentClaim, null, now).providerMessageId === "18abc" && classifyExistingClaim(sentClaim, null, now).fromEvidence === false);

  const failedClaim = { status: "FAILED", error: "sender not verified" };
  ok("3. a FAILED claim, no evidence -> PREVIOUSLY_FAILED, carrying the real error through (never silently retried under the same key)",
     classifyExistingClaim(failedClaim, null, now).action === "PREVIOUSLY_FAILED" && classifyExistingClaim(failedClaim, null, now).error === "sender not verified");

  const unknownClaim = { status: "UNKNOWN", error: "network error calling Gmail: TimeoutError" };
  ok("4. an UNKNOWN claim, no evidence -> NEEDS_RECONCILIATION (never auto-retried)", classifyExistingClaim(unknownClaim, null, now).action === "NEEDS_RECONCILIATION");

  const freshClaim = { status: "CLAIMED", claimed_at: new Date(now.getTime() - 30 * 1000).toISOString() }; // 30s old
  ok("5. a CLAIMED claim younger than the lease, no evidence -> IN_PROGRESS (another request is genuinely still working on it)", classifyExistingClaim(freshClaim, null, now).action === "IN_PROGRESS");

  const staleClaim = { status: "CLAIMED", claimed_at: new Date(now.getTime() - (CLAIM_LEASE_MINUTES + 1) * 60 * 1000).toISOString() };
  ok("6. a CLAIMED claim OLDER than the lease, no evidence -> EXPIRED_NEEDS_RECONCILIATION (the owner almost certainly died without resolving it)",
     classifyExistingClaim(staleClaim, null, now).action === "EXPIRED_NEEDS_RECONCILIATION");

  const edgeClaim = { status: "CLAIMED", claimed_at: new Date(now.getTime() - CLAIM_LEASE_MINUTES * 60 * 1000 + 1000).toISOString() }; // 1s inside the lease
  ok("7. a CLAIMED claim just inside the lease window is still IN_PROGRESS, not expired", classifyExistingClaim(edgeClaim, null, now).action === "IN_PROGRESS");

  const badDateClaim = { status: "CLAIMED", claimed_at: "not-a-date" };
  ok("8. an unparseable claimed_at never expires a claim on bad data -- fails safe to IN_PROGRESS, never silently allows a retry", classifyExistingClaim(badDateClaim, null, now).action === "IN_PROGRESS");

  ok("9. CLAIM_STATUS is exactly the four lifecycle states", CLAIM_STATUS.length === 4 && ["CLAIMED", "SENT", "FAILED", "UNKNOWN"].every((s) => CLAIM_STATUS.includes(s)));

  // Phase 11B: evidence is the stronger fact, overriding a STALE claim status.
  const staleClaimWithRealEvidence = { status: "CLAIMED", claimed_at: new Date(now.getTime() - (CLAIM_LEASE_MINUTES + 5) * 60 * 1000).toISOString() };
  const evidenceRow = { provider_message_id: "18real", provider_thread_id: "threal" };
  const withEvidence = classifyExistingClaim(staleClaimWithRealEvidence, evidenceRow, now);
  ok("10. a claim that LOOKS expired/CLAIMED, but a matching evidence row actually exists, is reported ALREADY_SENT from the evidence -- never EXPIRED_NEEDS_RECONCILIATION (closes the New-3 lag this phase introduced by writing evidence before the claim)",
     withEvidence.action === "ALREADY_SENT" && withEvidence.providerMessageId === "18real" && withEvidence.fromEvidence === true);
  ok("11. evidence overrides even a FAILED claim's own status (the claim's bookkeeping lagged, but a real send is on record)",
     classifyExistingClaim(failedClaim, evidenceRow, now).action === "ALREADY_SENT" && classifyExistingClaim(failedClaim, evidenceRow, now).fromEvidence === true);
}

console.log("\nK — validateReconcileSendClaimRequest() (the human recovery path for an UNKNOWN claim; Phase 11C Policy A/B)");
{
  ok("1. a missing idempotencyKey is rejected", validateReconcileSendClaimRequest({ outcome: "SENT", providerMessageId: "x" }).valid === false);
  ok("2. an outcome outside SENT/NOT_SENT is rejected", validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "MAYBE" }).valid === false);
  ok("3. reconciling to SENT without a real providerMessageId is rejected -- a human must supply what they actually found, never fabricated (Policy B)", validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "SENT" }).valid === false);
  ok("4. reconciling to SENT with a providerMessageId is accepted (Policy B)", validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "SENT", providerMessageId: "18abc" }).valid === true);
  ok("5. reconciling to NOT_SENT with NO providerEvidence at all is rejected (Phase 11C Policy A -- the pre-11C gap: this used to be accepted with nothing behind it)",
     validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "NOT_SENT" }).valid === false);
  ok("6. reconciling to NOT_SENT with an empty/whitespace-only providerEvidence is rejected -- a bare assertion is never sufficient",
     validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "NOT_SENT", providerEvidence: "   " }).valid === false);
  ok("7. reconciling to NOT_SENT with providerEvidence shorter than the minimum is rejected (cannot satisfy 'definitive provider evidence' with a trivial string)",
     validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "NOT_SENT", providerEvidence: "x".repeat(MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH - 1) }).valid === false);
  ok("8. reconciling to NOT_SENT with providerEvidence longer than the maximum is rejected (keeps the claim's error column, which also carries an optional note, safely under its length constraint)",
     validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "NOT_SENT", providerEvidence: "x".repeat(MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH + 1) }).valid === false);
  ok("9. reconciling to NOT_SENT with real, sufficiently-detailed providerEvidence is accepted and carried through, trimmed",
     (() => {
       const r = validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "NOT_SENT", providerEvidence: "  Gmail API returned 403 insufficient_scope at 2026-10-14T09:12:00Z  " });
       return r.valid === true && r.providerEvidence === "Gmail API returned 403 insufficient_scope at 2026-10-14T09:12:00Z";
     })());
  ok("10. providerEvidence is ignored/null for a SENT reconciliation (it is only meaningful for NOT_SENT)",
     validateReconcileSendClaimRequest({ idempotencyKey: "k", outcome: "SENT", providerMessageId: "18abc", providerEvidence: "whatever" }).providerEvidence === null);
}

console.log("\nK2 — isUniqueViolation()");
{
  ok("1. recognizes Postgres code 23505", isUniqueViolation({ code: "23505", message: "duplicate key" }) === true);
  ok("2. a different error code is not a unique violation", isUniqueViolation({ code: "23514", message: "check violation" }) === false);
  ok("3. null/undefined is never a unique violation", isUniqueViolation(null) === false && isUniqueViolation(undefined) === false);
}

console.log("\nK3 — decideReconciliation() (audit fix New-2: the pure decision core of reconcile_send_claim, closing the check-then-act race by making the WHOLE decision before any write)");
{
  const claimed = { id: "c1", status: "CLAIMED", contact_id: "contact-1", followup_id: null, provider_message_id: null };
  const sentClaim = { id: "c1", status: "SENT", contact_id: "contact-1", followup_id: null, provider_message_id: "18abc" };
  const evidence = { id: "e1", provider_message_id: "18abc", provider_thread_id: "th1" };

  ok("1. no claim at all -> NOT_FOUND", decideReconciliation({ claim: null, existingEvent: null, outcome: "SENT", providerMessageId: "x" }).action === "NOT_FOUND");
  ok("1b. no claim at all, outcome NOT_SENT -> still NOT_FOUND (Phase 11C Policy A: with no durably-recorded attempt at all, there is nothing to classify as NOT_SENT either)",
     decideReconciliation({ claim: null, existingEvent: null, outcome: "NOT_SENT", providerMessageId: null }).action === "NOT_FOUND");

  ok("2. evidence already exists with a MATCHING provider id and outcome SENT -> ALREADY_RESOLVED_MATCHING (idempotent repeat, never re-inserted)",
     decideReconciliation({ claim: claimed, existingEvent: evidence, outcome: "SENT", providerMessageId: "18abc" }).action === "ALREADY_RESOLVED_MATCHING");

  ok("3. evidence already exists with a DIFFERENT provider id -> CONFLICT, never silently accepted as a correction",
     decideReconciliation({ claim: claimed, existingEvent: evidence, outcome: "SENT", providerMessageId: "99different" }).action === "CONFLICT");

  ok("4. evidence already exists but the operator asserts NOT_SENT -> CONFLICT (a real send cannot be reconciled away)",
     decideReconciliation({ claim: claimed, existingEvent: evidence, outcome: "NOT_SENT", providerMessageId: null }).action === "CONFLICT");

  ok("5. claim is already SENT (no evidence row found) with a MATCHING provider id -> REPAIR_MISSING_EVIDENCE, the exact New-3 symptom this phase repairs",
     decideReconciliation({ claim: sentClaim, existingEvent: null, outcome: "SENT", providerMessageId: "18abc" }).action === "REPAIR_MISSING_EVIDENCE");

  ok("6. claim is already SENT with a DIFFERENT supplied provider id -> ALREADY_RESOLVED (refused, not silently overwritten)",
     decideReconciliation({ claim: sentClaim, existingEvent: null, outcome: "SENT", providerMessageId: "99different" }).action === "ALREADY_RESOLVED");

  ok("7. claim is already SENT and the operator asserts NOT_SENT -> ALREADY_RESOLVED (cannot reconcile to a different outcome)",
     decideReconciliation({ claim: sentClaim, existingEvent: null, outcome: "NOT_SENT", providerMessageId: null }).action === "ALREADY_RESOLVED");

  ok("8. claim is CLAIMED, no evidence, outcome SENT -> RESOLVE_SENT (a genuinely new resolution)",
     decideReconciliation({ claim: claimed, existingEvent: null, outcome: "SENT", providerMessageId: "18new" }).action === "RESOLVE_SENT");

  ok("9. claim is CLAIMED, no evidence, outcome NOT_SENT -> RESOLVE_NOT_SENT",
     decideReconciliation({ claim: claimed, existingEvent: null, outcome: "NOT_SENT", providerMessageId: null }).action === "RESOLVE_NOT_SENT");

  const failedClaim = { id: "c1", status: "FAILED", contact_id: "contact-1", followup_id: null, provider_message_id: null };
  ok("10. a FAILED claim with no evidence can still reach RESOLVE_SENT, given real provider evidence -- Phase 11C Policy B explicitly RATIFIES this as the approved policy (not merely preserved-pending-a-decision, as it was under Phase 11B): 'FAILED -> SENT reconciliation is permitted only when provider evidence establishes the message was actually sent,' which this path already enforces via validateReconcileSendClaimRequest's mandatory providerMessageId",
     decideReconciliation({ claim: failedClaim, existingEvent: null, outcome: "SENT", providerMessageId: "18new" }).action === "RESOLVE_SENT");
}

console.log("\nK4 — insertEvidenceIdempotent() / updateClaimConditional() -- MOCKED integration tests (a hand-built fake Supabase client, not a live database; see the report for what this does and does not prove)");
{
  // A minimal chainable fake mirroring supabase-js's query-builder shape.
  // `handler(table, state)` is called at the terminal .maybeSingle() and
  // decides the outcome for that specific call -- tests can make it throw
  // (simulating a network-level failure distinct from a structured
  // Postgres error) or return a structured {data, error}.
  function fakeClient(handler) {
    function builder(table, state) {
      return {
        insert(payload) { return builder(table, { ...state, op: "insert", payload }); },
        update(payload) { return builder(table, { ...state, op: "update", payload }); },
        select() { return builder(table, state); },
        eq(col, val) { return builder(table, { ...state, filters: { ...state.filters, [col]: { eq: val } } }); },
        in(col, vals) { return builder(table, { ...state, filters: { ...state.filters, [col]: { in: vals } } }); },
        neq(col, val) { return builder(table, { ...state, filters: { ...state.filters, [col]: { neq: val } } }); },
        maybeSingle: async () => handler(table, state),
      };
    }
    return { from: (table) => builder(table, { filters: {} }) };
  }

  // --- insertEvidenceIdempotent ---
  {
    const client = fakeClient((table, state) => {
      if (state.op === "insert") return { data: { id: "e1", ...state.payload }, error: null };
      return { data: null, error: null };
    });
    const r = await insertEvidenceIdempotent(client, { idempotency_key: "k1", provider_message_id: "18abc" });
    ok("1. a clean insert succeeds and returns the inserted row", r.ok === true && r.event.id === "e1" && r.ambiguous === false);
  }
  {
    let insertCalls = 0;
    const client = fakeClient((table, state) => {
      if (state.op === "insert") { insertCalls++; return { data: null, error: { code: "23505", message: "duplicate key value" } }; }
      // the re-read-by-idempotency_key path
      return { data: { id: "existing-1", idempotency_key: "k1", provider_message_id: "18abc" }, error: null };
    });
    const r = await insertEvidenceIdempotent(client, { idempotency_key: "k1", provider_message_id: "18abc" });
    ok("2. a unique-violation on insert is NOT treated as a failure -- the existing row is re-read and returned as success", r.ok === true && r.event.id === "existing-1" && insertCalls === 1);
  }
  {
    const client = fakeClient((table, state) => {
      if (state.op === "insert") return { data: null, error: { code: "23514", message: "check constraint violated" } };
      return { data: null, error: null };
    });
    const r = await insertEvidenceIdempotent(client, { idempotency_key: "k1" });
    ok("3. a genuine (non-duplicate-key) error is reported as a definite, non-ambiguous failure -- never silently swallowed", r.ok === false && r.ambiguous === false && r.error.includes("check constraint"));
  }
  {
    let calls = 0;
    const client = fakeClient((table, state) => {
      calls++;
      if (state.op === "insert" && calls === 1) throw new Error("network reset");
      if (state.op === "insert" && calls === 2) return { data: { id: "e2" }, error: null };
      return { data: null, error: null };
    });
    const r = await insertEvidenceIdempotent(client, { idempotency_key: "k1" });
    ok("4. a thrown exception on the first attempt is retried once, and a successful retry reports ok:true, not ambiguous", r.ok === true && r.event.id === "e2" && calls === 2);
  }
  {
    const client = fakeClient(() => { throw new Error("connection refused"); });
    const r = await insertEvidenceIdempotent(client, { idempotency_key: "k1" });
    ok("5. a thrown exception on BOTH attempts is reported ambiguous:true -- never silently treated as success or as a definite failure", r.ok === false && r.ambiguous === true);
  }

  // --- updateClaimConditional ---
  {
    const client = fakeClient((table, state) => ({ data: { id: "claim-1", status: state.payload.status }, error: null }));
    const r = await updateClaimConditional(client, "claim-1", ["CLAIMED"], { status: "SENT" });
    ok("6. a matching conditional update succeeds and returns the updated row", r.ok === true && r.claim.status === "SENT");
  }
  {
    const client = fakeClient(() => ({ data: null, error: null })); // the WHERE clause matched zero rows
    const r = await updateClaimConditional(client, "claim-1", ["CLAIMED"], { status: "SENT" });
    ok("7. zero rows matching the expected prior status is reported ok:false, not ambiguous, and NEVER thrown as an exception -- a lost race is a normal, expected outcome", r.ok === false && r.ambiguous === false && r.error.includes("no row matched"));
  }
  {
    const client = fakeClient(() => ({ data: null, error: { message: "connection pool exhausted" } }));
    const r = await updateClaimConditional(client, "claim-1", ["CLAIMED"], { status: "SENT" });
    ok("8. a genuine database error is reported as a definite failure", r.ok === false && r.ambiguous === false && r.error.includes("connection pool"));
  }
  {
    let calls = 0;
    const client = fakeClient((table, state) => { calls++; if (calls === 1) throw new Error("timeout"); return { data: { id: "claim-1" }, error: null }; });
    const r = await updateClaimConditional(client, "claim-1", ["CLAIMED"], { status: "SENT" });
    ok("9. a thrown exception on the first attempt is retried once, succeeding on the second", r.ok === true && calls === 2);
  }
  {
    const client = fakeClient(() => { throw new Error("timeout"); });
    const r = await updateClaimConditional(client, "claim-1", ["CLAIMED"], { status: "SENT" });
    ok("10. exhausting retries on a thrown exception reports ambiguous:true -- the caller must not assume success or failure", r.ok === false && r.ambiguous === true);
  }
  {
    let observedFilter = null;
    const client = fakeClient((table, state) => { observedFilter = state.filters.status; return { data: { id: "claim-1" }, error: null }; });
    await updateClaimConditional(client, "claim-1", ["CLAIMED", "FAILED", "UNKNOWN"], { status: "SENT" });
    ok("11. an explicit expectStatusIn list is applied as an IN filter (reconcile_send_claim's own usage)", observedFilter && Array.isArray(observedFilter.in) && observedFilter.in.length === 3);

    observedFilter = null;
    await updateClaimConditional(client, "claim-1", null, { status: "UNKNOWN" });
    ok("12. a null expectStatusIn falls back to a NEQ-SENT filter (send_message's own 'still CLAIMED, whatever that means right now' usage)", observedFilter && observedFilter.neq === "SENT");
  }
}

console.log("\nL — shouldUpdateSendAsState() (audit fix M-2: both successful and unsuccessful verification cases)");
{
  ok("1. SUCCESSFUL verification of a NEW identity always updates (switches the record to the newly-verified identity)",
     shouldUpdateSendAsState({ verified: true, targetIdentity: "admin@electioncanon.org", currentSendAsIdentity: "sotinnovate@gmail.com" }) === true);
  ok("2. UNSUCCESSFUL verification of a DIFFERENT identity than the one on record does NOT update -- the bug this fixes",
     shouldUpdateSendAsState({ verified: false, targetIdentity: "sotinnovate@gmail.com", currentSendAsIdentity: "admin@electioncanon.org" }) === false);
  ok("3. UNSUCCESSFUL verification of the SAME identity currently on record DOES update -- a genuine downgrade must still go through",
     shouldUpdateSendAsState({ verified: false, targetIdentity: "admin@electioncanon.org", currentSendAsIdentity: "admin@electioncanon.org" }) === true);
  ok("4. SUCCESSFUL re-verification of the SAME identity currently on record updates (idempotent refresh)",
     shouldUpdateSendAsState({ verified: true, targetIdentity: "admin@electioncanon.org", currentSendAsIdentity: "admin@electioncanon.org" }) === true);
  ok("5. UNSUCCESSFUL verification when nothing is on record yet (UNKNOWN) does not update",
     shouldUpdateSendAsState({ verified: false, targetIdentity: "admin@electioncanon.org", currentSendAsIdentity: "UNKNOWN" }) === false);
  ok("6. the identity comparison is case-insensitive", shouldUpdateSendAsState({ verified: false, targetIdentity: "Admin@ElectionCanon.org", currentSendAsIdentity: "admin@electioncanon.org" }) === true);
}

console.log("\nM — source scan: H-1's atomic claim + Phase 11B's evidence-first ordering are wired into send_message");
{
  ok("1. send_message INSERTs into outreach_message_send_claims BEFORE any fetch() to Gmail's send endpoint",
     (() => {
       const sendBlock = indexCode.split('action === "send_message"')[1]?.split('action === "reconcile_send_claim"')[0] ?? "";
       const insertIdx = sendBlock.search(/outreach_message_send_claims"\)\s*\.insert\(/);
       const fetchIdx = sendBlock.indexOf("gmail/v1/users/me/messages/send");
       return insertIdx !== -1 && fetchIdx !== -1 && insertIdx < fetchIdx;
     })());
  ok("1b. CLOSURE HARDENING: the claim-insert itself is now wrapped in try/catch, and a thrown exception there is refused as CLAIM_OUTCOME_UNKNOWN WITHOUT ever calling Gmail or marking anything FAILED (closes the one gap Phase 11D's recovery-proof review disclosed but did not fix)",
     /try \{[\s\S]{0,200}outreach_message_send_claims"\)[\s\S]{0,200}\.insert\([\s\S]{0,300}\} catch \(err\) \{[\s\S]{0,300}CLAIM_OUTCOME_UNKNOWN/.test(indexCode));
  ok("2. a lost claim race looks up BOTH the existing claim AND any existing evidence row before classifying (Phase 11B: evidence is the stronger fact)",
     /classifyExistingClaim\(existing, existingEvent\)/.test(indexCode) && /outreach_message_events"\)\.select\("\*"\)\.eq\("idempotency_key", idempotencyKey\)\.maybeSingle\(\)/.test(indexCode));
  ok("3. the Gmail send fetch is wrapped in try/catch, and the catch marks the claim UNKNOWN via the checked helper, never FAILED or SENT",
     /catch \(err\) \{[\s\S]{0,400}updateClaimConditional\(supabase, claim\.id, \["CLAIMED"\], \{ status: "UNKNOWN"[\s\S]{0,400}SEND_OUTCOME_UNKNOWN/.test(indexCode));
  ok("4. the Gmail send fetch has a client-side abort timeout (does not rely on the platform timeout alone to bound the ambiguous window)",
     /AbortController\(\)[\s\S]{0,200}setTimeout\(\(\) => controller\.abort\(\)/.test(indexCode));
  ok("5. a definite provider failure (interpreted.ok === false) marks the claim FAILED via the checked helper, not UNKNOWN",
     /if \(!interpreted\.ok\) \{[\s\S]{0,300}updateClaimConditional\(supabase, claim\.id, \["CLAIMED"\], \{ status: "FAILED"/.test(indexCode));
  ok("6. PHASE 11B (closes New-3): evidence is inserted BEFORE the claim is resolved to SENT -- the reverse of the pre-11B ordering, so a real send is durably recorded even if the claim's own status update lags",
     (() => {
       const sendBlock = indexCode.split('action === "send_message"')[1]?.split('action === "reconcile_send_claim"')[0] ?? "";
       const evidenceIdx = sendBlock.indexOf("insertEvidenceIdempotent(supabase, {");
       const claimSentIdx = sendBlock.indexOf('status: "SENT", provider_message_id: interpreted.providerMessageId');
       return evidenceIdx !== -1 && claimSentIdx !== -1 && evidenceIdx < claimSentIdx;
     })());
  ok("7. a failed evidence insert after a confirmed Gmail success is NEVER reported as overall success, and marks the claim UNKNOWN (not SENT, not FAILED) while preserving the real provider id",
     /if \(!evidenceResult\.ok\) \{[\s\S]{0,400}status: "UNKNOWN", provider_message_id: interpreted\.providerMessageId[\s\S]{0,600}EVIDENCE_PERSISTENCE_FAILED/.test(indexCode));
  ok("8. the claim-resolution update after a successful evidence write result is never allowed to turn an already-successful send into a reported failure (no refuse() between the evidence insert and the final json() response)",
     (() => {
       const sendBlock = indexCode.split('action === "send_message"')[1]?.split('action === "reconcile_send_claim"')[0] ?? "";
       const afterEvidence = sendBlock.slice(sendBlock.indexOf("Evidence is durably recorded"));
       return !/return refuse\(/.test(afterEvidence);
     })());
  ok("9. an expired (stale) CLAIMED row is transitioned to UNKNOWN via the same checked, conditional helper (only while still CLAIMED, avoiding clobbering a concurrent resolution)",
     /updateClaimConditional\(supabase, existing\.id, \["CLAIMED"\], \{[\s\S]{0,200}status: "UNKNOWN"/.test(indexCode));
}

console.log("\nN — source scan: M-2's fix is actually wired into verify_send_as in the real transport file");
{
  ok("1. verify_send_as calls shouldUpdateSendAsState before writing the connection row", /shouldUpdateSendAsState\(\{ verified: result\.verified, targetIdentity: target, currentSendAsIdentity: tokenResult\.connection\.send_as_identity \}\)/.test(indexCode));
  ok("2. the connection UPDATE is now conditional (inside an if), not unconditional", /if \(shouldUpdateSendAsState\(/.test(indexCode));
}

console.log("\nO — source scan: Phase 11B's reconcile_send_claim rewrite (closes New-2)");
{
  const reconcileBlock = indexCode.split('action === "reconcile_send_claim"')[1]?.split('action === "sync_replies"')[0] ?? "";
  ok("1. reconcile_send_claim looks up existing evidence BEFORE making any decision", /existingEvent.*=.*await supabase\.from\("outreach_message_events"\)/.test(reconcileBlock));
  ok("2. the entire outcome is decided via decideReconciliation() -- no inline re-derivation of the conflict/repair logic", /decideReconciliation\(\{ claim, existingEvent, outcome: validation\.outcome, providerMessageId: validation\.providerMessageId \}\)/.test(reconcileBlock));
  ok("3. every one of decideReconciliation's six possible actions is handled explicitly",
     ["NOT_FOUND", "CONFLICT", "ALREADY_RESOLVED\"", "ALREADY_RESOLVED_MATCHING", "REPAIR_MISSING_EVIDENCE", "RESOLVE_SENT"].every((a) => reconcileBlock.includes(a)));
  ok("4. RESOLVE_SENT uses the CONDITIONAL claim-update helper, never an unconditional update", /updateClaimConditional\(supabase, claim\.id, \["CLAIMED", "FAILED", "UNKNOWN"\], \{\s*status: "SENT"/.test(reconcileBlock));
  ok("5. RESOLVE_SENT checks claimUpdate.ambiguous and refuses rather than guessing when the write's own outcome is uncertain",
     /claimUpdate\.ambiguous.*RECONCILE_OUTCOME_UNKNOWN/.test(reconcileBlock.replace(/\n/g, " ")));
  ok("6. a lost race on RESOLVE_SENT re-reads the REAL evidence/claim state rather than assuming its own request's decision still applies",
     /a concurrent reconciliation already resolved this claim differently/.test(reconcileBlock));
  ok("7. RESOLVE_NOT_SENT also uses the conditional helper and re-checks for real evidence before accepting a lost race, so NOT_SENT can never beat an actual send",
     /status: "FAILED"[\s\S]{0,300}claimUpdate\.ambiguous[\s\S]{0,600}cannot reconcile as NOT_SENT/.test(reconcileBlock));
  ok("8. REPAIR_MISSING_EVIDENCE never touches the claim row at all -- only the missing evidence row is inserted, using the CLAIM's OWN already-recorded provider id (never a caller-supplied one)",
     /insertEvidenceIdempotent\(supabase, \{\s*contact_id: claim\.contact_id, followup_id: claim\.followup_id,[\s\S]{0,200}provider_message_id: claim\.provider_message_id/.test(reconcileBlock));
  ok("9. every evidence insert in this action binds to claim.contact_id/claim.followup_id, never a caller-supplied contactId -- reconciliation cannot rebind evidence to the wrong contact",
     !/contactId/.test(reconcileBlock) && (reconcileBlock.match(/contact_id: claim\.contact_id/g) || []).length >= 2);
  ok("10. still never calls fetch() / never contacts Gmail -- it only records what a human already found", !/\bfetch\(/.test(reconcileBlock));
  ok("11. still sits behind the same OUTREACH_ADMIN_SECRET gate as every other POST action", indexCode.indexOf('action === "reconcile_send_claim"') > indexCode.indexOf("UNAUTHENTICATED"));
  ok("12. RESOLVE_NOT_SENT durably records validation.providerEvidence on the claim's own error column (Phase 11C Policy A -- not just a note, the mandatory evidence text itself is persisted)",
     /status: "FAILED"[\s\S]{0,200}error: `manually reconciled as not sent -- provider evidence: \$\{validation\.providerEvidence\}/.test(reconcileBlock));
  ok("13. REPAIR_MISSING_EVIDENCE never calls updateClaimConditional -- a failed repair leaves the claim's existing SENT status untouched, never silently flips it",
     (() => {
       const repairBlock = reconcileBlock.split('"REPAIR_MISSING_EVIDENCE"')[1]?.split('if (decision.action === "RESOLVE_SENT")')[0] ?? "";
       return repairBlock.length > 0 && !/updateClaimConditional/.test(repairBlock);
     })());
}

console.log("\nP — closure hardening: getFreshAccessToken() never lets a thrown exception escape uncaught (fixes the opaque non-JSON HTTP 500 regression -- a network failure reaching Supabase or Google's token endpoint, happening strictly BEFORE Gmail's send endpoint is ever contacted, must resolve to a clean {ok:false} refusal, never an unhandled exception that propagates out of Deno.serve)");
{
  const fnBlock = indexCode.split("async function getFreshAccessToken(")[1]?.split("Deno.serve(async (req: Request)")[0] ?? "";
  ok("1. the function body is wrapped in try/catch around the Google token-endpoint fetch (previously unguarded)",
     /try \{[\s\S]*fetch\("https:\/\/oauth2\.googleapis\.com\/token"[\s\S]*\} catch \(err\) \{/.test(fnBlock));
  ok("2. the catch returns the function's own {ok:false, reason} shape -- never re-throws, never leaves the caller to handle a raw exception",
     /catch \(err\) \{[\s\S]{0,200}return \{ ok: false as const, reason: `[\s\S]{0,200}\$\{String\(err\)\}` \};/.test(fnBlock));
  ok("3. the connection-lookup Supabase call is ALSO inside the same try (a network failure reaching Supabase, not just Google, is covered)",
     /try \{[\s\S]*outreach_gmail_connection"\)\.select\("\*"\)[\s\S]*fetch\("https:\/\/oauth2\.googleapis\.com\/token"/.test(fnBlock));
  ok("4. send_message's own call site is a bare await with no surrounding try/catch of its own -- it correctly relies on getFreshAccessToken() itself never throwing, rather than duplicating defensive handling at every call site",
     (() => {
       const sendBlock = indexCode.split('action === "send_message"')[1]?.split('action === "reconcile_send_claim"')[0] ?? "";
       return /const tokenResult = await getFreshAccessToken\(supabase, clientId!, clientSecret!\);\s*\n\s*if \(!tokenResult\.ok\)/.test(sendBlock);
     })());
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
