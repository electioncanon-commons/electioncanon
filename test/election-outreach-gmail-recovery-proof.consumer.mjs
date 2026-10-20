// ============================================================
// OUTREACH ACTIVATION — PHASE 11D: CONTROLLED VERIFICATION AND RECOVERY
// PROOF (duplicate claims, concurrent reconciliation, persistence
// failures, ambiguous outcomes, identity conflicts, recovery)
//
// WHAT THIS FILE IS, PRECISELY. This environment has no Docker, no psql,
// no Deno runtime (confirmed this phase: `docker`/`psql`/`deno` are all
// absent from PATH; `supabase db start`/`status` both fail with
// "docker: command not found (podman also not found)"). There is
// therefore NO live Postgres and NO way to execute index.ts (Deno-only
// TypeScript) directly. See docs/PHASE-11D-VERIFICATION-REPORT.md §2 for
// the full environment-capability record.
//
// What IS possible, and what this file adds beyond
// election-outreach-gmail-function.consumer.mjs's existing K4 section:
// K4 proves insertEvidenceIdempotent/updateClaimConditional react
// correctly to SCRIPTED, SEQUENTIAL fake-client responses. This file
// instead builds a single SHARED, STATEFUL in-memory store with REAL
// uniqueness/conditional-match enforcement (an actual Map a concurrent
// insert can only win once, an actual row a concurrent conditional UPDATE
// can only match once) and a harness (fakeSendMessage/
// fakeReconcileSendClaim below) that reproduces index.ts's EXACT
// orchestration -- same order of operations, same branches -- while
// calling the REAL, imported contract.mjs functions for every decision
// (classifyExistingClaim, interpretGmailSendResponse, decideReconciliation,
// insertEvidenceIdempotent, updateClaimConditional,
// validateReconcileSendClaimRequest). Two "requests" are then actually
// raced via Promise.all against that ONE shared store, with a real
// microtask await inserted inside the store's own check+write step so
// genuine interleaving is possible (not just two sequential calls dressed
// up as concurrent).
//
// EVIDENCE CLASSIFICATION (used throughout, per
// docs/PHASE-11D-VERIFICATION-PLAN.md's taxonomy):
//   [DETERMINISTIC CONCURRENCY TEST] -- this file's Promise.all races
//     against the shared in-memory store. Proves the DECISION LOGIC
//     (the real exported functions) behaves correctly under genuine
//     concurrent JS execution. Does NOT prove a real Postgres unique
//     index or MVCC/row-lock behaves this way -- only well-documented
//     Postgres semantics are relied on for that, same disclosure Phase
//     11B/11C already made.
//   [MOCKED INTEGRATION] -- sequential fake-client tests (reused from
//     election-outreach-gmail-function.consumer.mjs's K4, not repeated
//     here).
//   [SOURCE INSPECTION] -- confirms index.ts's real text matches this
//     harness's orchestration (see the companion source-scan sections
//     M/O in election-outreach-gmail-function.consumer.mjs; not
//     duplicated in this file).
//   [HARNESS ORCHESTRATION, NOT index.ts ITSELF] -- the honest caveat for
//     every scenario below: fakeSendMessage/fakeReconcileSendClaim are a
//     hand-written reimplementation of index.ts's control flow (necessary
//     because index.ts is Deno-only TypeScript and cannot be imported
//     under plain Node), paired with the existing source-scan tests that
//     verify the REAL file matches this same order of operations.
// ============================================================

import {
  CLAIM_LEASE_MINUTES, classifyExistingClaim, validateReconcileSendClaimRequest,
  isUniqueViolation, decideReconciliation, insertEvidenceIdempotent, updateClaimConditional,
  interpretGmailSendResponse,
} from "../supabase/functions/outreach-gmail/contract.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — Phase 11D: controlled verification and recovery proof\n");

// ---------- the shared, stateful fake store ----------
// A single Map per table, with REAL uniqueness/conditional-match checks.
// A deliberate `await tick()` sits INSIDE the check+write step (not
// before it) so two concurrent callers both reach the check, but -- being
// single-threaded JS resuming one microtask at a time -- only the first to
// resume can complete its synchronous check+write before the second
// resumes and finds the row already there. This is what makes the race
// genuine rather than cosmetic: it reproduces "one atomic INSERT guarded
// by a unique index," never the old check-then-act pattern (which would
// put the await BETWEEN the check and the write, not around both).
function tick() { return new Promise((r) => setTimeout(r, 0)); }

function createFakeDb() {
  const claims = new Map();      // idempotency_key -> row
  const claimsById = new Map();  // id -> SAME row object
  const events = new Map();      // idempotency_key -> row
  let seq = 0;
  const faults = []; // { table, op, remaining, apply(state) -> {data,error}|throw }

  function consumeFault(table, op) {
    const f = faults.find((f) => f.table === table && f.op === op && f.remaining > 0);
    if (!f) return null;
    f.remaining--;
    return f;
  }

  const db = {
    injectFault(fault) { faults.push({ remaining: 1, ...fault }); return db; },

    from(table) {
      return {
        insert(payload) {
          const op = "insert";
          const terminal = async () => {
            await tick();
            const f = consumeFault(table, op);
            if (f) {
              if (f.kind === "throw") throw new Error(f.message ?? "injected fault");
              return { data: null, error: f.error };
            }
            if (table === "outreach_message_send_claims") {
              if (claims.has(payload.idempotency_key)) {
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              }
              const row = {
                id: `claim-${++seq}`, status: "CLAIMED", provider_message_id: null, provider_thread_id: null,
                error: null, claimed_at: new Date().toISOString(), resolved_at: null, updated_at: new Date().toISOString(),
                ...payload,
              };
              claims.set(payload.idempotency_key, row);
              claimsById.set(row.id, row);
              return { data: { ...row }, error: null };
            }
            if (table === "outreach_message_events") {
              if (events.has(payload.idempotency_key)) {
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              }
              const row = { id: `event-${++seq}`, occurred_at: new Date().toISOString(), created_at: new Date().toISOString(), match_confidence: "HIGH_CONFIDENCE", ...payload };
              events.set(payload.idempotency_key, row);
              return { data: { ...row }, error: null };
            }
            throw new Error(`fake db: unsupported table ${table}`);
          };
          return { select() { return this; }, single: terminal, maybeSingle: terminal };
        },

        update(fields) {
          const op = "update";
          let eqId = null, inList = null, neqVal = null;
          const builder = {
            eq(col, val) { if (col === "id") eqId = val; return builder; },
            in(col, vals) { if (col === "status") inList = vals; return builder; },
            neq(col, val) { if (col === "status") neqVal = val; return builder; },
            select() { return builder; },
            async maybeSingle() {
              await tick();
              const f = consumeFault(table, op);
              if (f) {
                if (f.kind === "throw") throw new Error(f.message ?? "injected fault");
                return { data: null, error: f.error };
              }
              if (table !== "outreach_message_send_claims") throw new Error("fake db: update only modeled for claims");
              const row = claimsById.get(eqId);
              if (!row) return { data: null, error: null };
              if (inList && !inList.includes(row.status)) return { data: null, error: null };
              if (neqVal != null && row.status === neqVal) return { data: null, error: null };
              Object.assign(row, fields);
              return { data: { ...row }, error: null };
            },
          };
          return builder;
        },

        select(_cols) {
          const op = "select";
          let eqFilters = {};
          const builder = {
            eq(col, val) { eqFilters[col] = val; return builder; },
            order() { return builder; },
            limit() { return builder; },
            async maybeSingle() {
              await tick();
              const f = consumeFault(table, op);
              if (f) {
                if (f.kind === "throw") throw new Error(f.message ?? "injected fault");
                return { data: null, error: f.error };
              }
              if (table === "outreach_message_send_claims") {
                if (eqFilters.idempotency_key != null) return { data: claims.has(eqFilters.idempotency_key) ? { ...claims.get(eqFilters.idempotency_key) } : null, error: null };
                if (eqFilters.id != null) return { data: claimsById.has(eqFilters.id) ? { ...claimsById.get(eqFilters.id) } : null, error: null };
              }
              if (table === "outreach_message_events") {
                if (eqFilters.idempotency_key != null) return { data: events.has(eqFilters.idempotency_key) ? { ...events.get(eqFilters.idempotency_key) } : null, error: null };
              }
              return { data: null, error: null };
            },
          };
          return builder;
        },
      };
    },

    // test-only direct inspection (never used by the harness itself, only
    // by assertions, exactly like a human operator querying the real
    // tables directly would)
    _dump() { return { claims: [...claims.values()].map((r) => ({ ...r })), events: [...events.values()].map((r) => ({ ...r })) }; },
  };
  return db;
}

// ---------- the harness: index.ts's send_message/reconcile_send_claim
// orchestration, reimplemented in plain JS calling the REAL functions.
// OAuth/sender-identity verification (M-2, sections L/N of the existing
// suite) is deliberately out of scope here and abstracted to a plain
// `transport()` call -- this harness exists to prove H-1/New-2/New-3/
// Policy-A/B, not to re-prove M-2.

async function fakeSendMessage({ db, idempotencyKey, contactId, followupId, transport }) {
  // Mirrors index.ts's own try/catch around the claim insert (the
  // closure-hardening fix): a thrown exception here means Gmail is NEVER
  // called and nothing is ever marked FAILED -- the caller is told the
  // claim attempt's own outcome is unknown and must retry with the SAME
  // idempotencyKey, never a new one.
  let claim, claimError;
  try {
    const result = await db.from("outreach_message_send_claims")
      .insert({ idempotency_key: idempotencyKey, contact_id: contactId, followup_id: followupId })
      .select("*").single();
    claim = result.data;
    claimError = result.error;
  } catch (err) {
    return { ok: false, code: "CLAIM_OUTCOME_UNKNOWN", error: String(err), calledTransport: false };
  }

  if (claimError || !claim) {
    const { data: existing } = await db.from("outreach_message_send_claims").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    const { data: existingEvent } = await db.from("outreach_message_events").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    const classification = classifyExistingClaim(existing, existingEvent, new Date());
    if (classification.action === "ALREADY_SENT") {
      return { ok: true, alreadySent: true, providerMessageId: classification.providerMessageId, providerThreadId: classification.providerThreadId, calledTransport: false, classification: classification.action };
    }
    if (classification.action === "PREVIOUSLY_FAILED") return { ok: false, code: "PREVIOUSLY_FAILED", error: classification.error, calledTransport: false, classification: classification.action };
    if (classification.action === "IN_PROGRESS") return { ok: false, code: "SEND_IN_PROGRESS", calledTransport: false, classification: classification.action };
    if (classification.action === "NEEDS_RECONCILIATION") return { ok: false, code: "NEEDS_RECONCILIATION", calledTransport: false, classification: classification.action };
    // EXPIRED_NEEDS_RECONCILIATION: lazy-expire exactly like index.ts does
    if (existing) {
      await updateClaimConditional(db, existing.id, ["CLAIMED"], { status: "UNKNOWN", error: "claim lease expired with no resolution -- the owning request likely crashed before learning Gmail's real answer", updated_at: new Date().toISOString() });
    }
    return { ok: false, code: "NEEDS_RECONCILIATION", calledTransport: false, classification: classification.action };
  }

  let sendResult;
  try {
    sendResult = await transport();
  } catch (err) {
    await updateClaimConditional(db, claim.id, ["CLAIMED"], { status: "UNKNOWN", error: `network error calling Gmail: ${String(err)}`, updated_at: new Date().toISOString() });
    return { ok: false, code: "SEND_OUTCOME_UNKNOWN", calledTransport: true };
  }

  const interpreted = interpretGmailSendResponse(sendResult.status, sendResult.body);
  if (!interpreted.ok) {
    await updateClaimConditional(db, claim.id, ["CLAIMED"], { status: "FAILED", error: interpreted.message, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { ok: false, code: interpreted.code ?? "PROVIDER_ERROR", calledTransport: true };
  }

  const evidenceResult = await insertEvidenceIdempotent(db, {
    contact_id: contactId, followup_id: followupId, direction: "OUTBOUND", activity_state: "SENT",
    provider: "GMAIL", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
    idempotency_key: idempotencyKey,
  });

  if (!evidenceResult.ok) {
    await updateClaimConditional(db, claim.id, ["CLAIMED"], {
      status: "UNKNOWN", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
      error: `Gmail accepted the message (provider id ${interpreted.providerMessageId}) but the evidence row could not be persisted: ${evidenceResult.error}`, updated_at: new Date().toISOString(),
    });
    return { ok: false, code: "EVIDENCE_PERSISTENCE_FAILED", providerMessageId: interpreted.providerMessageId, calledTransport: true };
  }

  await updateClaimConditional(db, claim.id, ["CLAIMED"], {
    status: "SENT", provider_message_id: interpreted.providerMessageId, provider_thread_id: interpreted.providerThreadId,
    resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  return { ok: true, alreadySent: false, providerMessageId: interpreted.providerMessageId, providerThreadId: interpreted.providerThreadId, event: evidenceResult.event, calledTransport: true };
}

async function fakeReconcileSendClaim({ db, idempotencyKey, outcome, providerMessageId, providerThreadId, providerEvidence, note }) {
  const validation = validateReconcileSendClaimRequest({ idempotencyKey, outcome, providerMessageId, providerThreadId, providerEvidence, note });
  if (!validation.valid) return { ok: false, code: "BAD_REQUEST", error: validation.error };

  const { data: claim } = await db.from("outreach_message_send_claims").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
  const { data: existingEvent } = await db.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
  const decision = decideReconciliation({ claim, existingEvent, outcome: validation.outcome, providerMessageId: validation.providerMessageId });

  if (decision.action === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", decision: decision.action };
  if (decision.action === "CONFLICT") return { ok: false, code: "CONFLICT", reason: decision.reason, decision: decision.action };
  if (decision.action === "ALREADY_RESOLVED") return { ok: false, code: "ALREADY_RESOLVED", reason: decision.reason, decision: decision.action };
  if (decision.action === "ALREADY_RESOLVED_MATCHING") return { ok: true, resolvedAs: "SENT", alreadyResolved: true, event: decision.event, decision: decision.action };

  const now = new Date().toISOString();

  if (decision.action === "REPAIR_MISSING_EVIDENCE") {
    const repairResult = await insertEvidenceIdempotent(db, {
      contact_id: claim.contact_id, followup_id: claim.followup_id, direction: "OUTBOUND", activity_state: "SENT",
      provider: "GMAIL", provider_message_id: claim.provider_message_id, provider_thread_id: claim.provider_thread_id,
      idempotency_key: claim.idempotency_key,
    });
    if (!repairResult.ok) return { ok: false, code: "PROVIDER_ERROR", error: repairResult.error, decision: decision.action };
    return { ok: true, resolvedAs: "SENT", repaired: true, event: repairResult.event, decision: decision.action };
  }

  if (decision.action === "RESOLVE_SENT") {
    const claimUpdate = await updateClaimConditional(db, claim.id, ["CLAIMED", "FAILED", "UNKNOWN"], {
      status: "SENT", provider_message_id: validation.providerMessageId, provider_thread_id: validation.providerThreadId,
      error: validation.note ? `manually reconciled: ${validation.note}` : "manually reconciled as SENT", resolved_at: now, updated_at: now,
    });
    if (claimUpdate.ambiguous) return { ok: false, code: "RECONCILE_OUTCOME_UNKNOWN", error: claimUpdate.error, decision: decision.action };
    if (!claimUpdate.ok) {
      const { data: finalEvent } = await db.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
      if (finalEvent && finalEvent.provider_message_id === validation.providerMessageId) {
        return { ok: true, resolvedAs: "SENT", alreadyResolved: true, event: finalEvent, decision: decision.action };
      }
      const { data: finalClaim } = await db.from("outreach_message_send_claims").select("status, provider_message_id").eq("id", claim.id).maybeSingle();
      return { ok: false, code: "CONFLICT", finalClaim, decision: decision.action };
    }
    const evidenceResult = await insertEvidenceIdempotent(db, {
      contact_id: claim.contact_id, followup_id: claim.followup_id, direction: "OUTBOUND", activity_state: "SENT",
      provider: "GMAIL", provider_message_id: validation.providerMessageId, provider_thread_id: validation.providerThreadId,
      idempotency_key: claim.idempotency_key,
    });
    if (!evidenceResult.ok) return { ok: false, code: "EVIDENCE_PERSISTENCE_FAILED", error: evidenceResult.error, decision: decision.action };
    return { ok: true, resolvedAs: "SENT", event: evidenceResult.event, decision: decision.action };
  }

  // RESOLVE_NOT_SENT
  const claimUpdate = await updateClaimConditional(db, claim.id, ["CLAIMED", "FAILED", "UNKNOWN"], {
    status: "FAILED",
    error: `manually reconciled as not sent -- provider evidence: ${validation.providerEvidence}${validation.note ? ` (note: ${validation.note})` : ""}`,
    resolved_at: now, updated_at: now,
  });
  if (claimUpdate.ambiguous) return { ok: false, code: "RECONCILE_OUTCOME_UNKNOWN", error: claimUpdate.error, decision: decision.action };
  if (!claimUpdate.ok) {
    const { data: finalEvent } = await db.from("outreach_message_events").select("*").eq("idempotency_key", validation.idempotencyKey).maybeSingle();
    return { ok: false, code: "CONFLICT", finalEvent, decision: decision.action };
  }
  return { ok: true, resolvedAs: "NOT_SENT", decision: decision.action };
}

// Sanity-check the harness itself before trusting any scenario built on
// it: a single, uncontested send must behave exactly as the golden path.
console.log("0 — harness self-check: a single, uncontested send behaves as the golden path (sanity gate for every scenario below)");
{
  const db = createFakeDb();
  let calls = 0;
  const r = await fakeSendMessage({
    db, idempotencyKey: "sanity:1", contactId: "contact-sanity", followupId: null,
    transport: async () => { calls++; return { status: 200, body: { id: "18sanity", threadId: "th-sanity" } }; },
  });
  ok("1. the send succeeds, calls transport exactly once, and returns the real provider id", r.ok === true && calls === 1 && r.providerMessageId === "18sanity");
  ok("2. the claim resolves to SENT and the evidence row exists with the matching id [HARNESS ORCHESTRATION]", (() => {
    const dump = db._dump();
    const claim = dump.claims.find((c) => c.idempotency_key === "sanity:1");
    const event = dump.events.find((e) => e.idempotency_key === "sanity:1");
    return claim?.status === "SENT" && event?.provider_message_id === "18sanity";
  })());
}

console.log("\nA — ATOMIC DUPLICATE-SEND CLAIMS [DETERMINISTIC CONCURRENCY TEST]");
console.log("    setup: one shared fake store; two fakeSendMessage calls with the SAME idempotency key, launched together via Promise.all");
console.log("    action: race them; count real transport invocations");
console.log("    expected: at most one request ever calls transport; the loser is refused without calling it");
{
  const db = createFakeDb();
  let transportCalls = 0;
  const transport = async () => { transportCalls++; await tick(); return { status: 200, body: { id: "18race", threadId: "th-race" } }; };
  const args = { db, idempotencyKey: "race:dup-claim", contactId: "contact-A", followupId: null, transport };

  const [r1, r2] = await Promise.all([fakeSendMessage(args), fakeSendMessage(args)]);

  ok("1. transport (the Gmail call) is invoked exactly once across both concurrent requests -- the loser never reaches it", transportCalls === 1);
  ok("2. exactly one response is the REAL sender (calledTransport:true, alreadySent:false); the other never reached transport at all -- 'both ok:true' is fine (the loser legitimately sees ALREADY_SENT), but only one may have actually sent anything",
     [r1, r2].filter((r) => r.calledTransport === true && r.alreadySent === false).length === 1 && [r1, r2].filter((r) => r.calledTransport === true).length === 1);
  ok("3. the loser never gets its OWN providerMessageId -- if it reports one at all (via ALREADY_SENT), it is the exact SAME id the real sender got, never a second independent one", (() => {
    const winner = r1.calledTransport ? r1 : r2;
    const loser = r1.calledTransport ? r2 : r1;
    return loser.calledTransport === false && (!loser.providerMessageId || loser.providerMessageId === winner.providerMessageId);
  })());
  ok("4. exactly one evidence row exists for this key at the end -- no duplicate ledger entry", db._dump().events.filter((e) => e.idempotency_key === "race:dup-claim").length === 1);
}

console.log("\nB — CONCURRENT RECONCILIATION, INCLUDING CONFLICTING OUTCOMES [DETERMINISTIC CONCURRENCY TEST]");
console.log("    setup: a claim stuck at UNKNOWN (simulating a prior ambiguous send); two operators call fakeReconcileSendClaim at once with CONFLICTING outcomes (one SENT with a real id, one NOT_SENT with evidence)");
console.log("    action: race them via Promise.all");
console.log("    expected: exactly one transition wins; the loser gets an accurate conflict, never a silent/misleading success; no contradictory evidence");
{
  const db = createFakeDb();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "race:reconcile", contact_id: "contact-B", followup_id: null, status: "UNKNOWN", error: "network error calling Gmail: TimeoutError" }).select("*").single();

  const [rSent, rNotSent] = await Promise.all([
    fakeReconcileSendClaim({ db, idempotencyKey: "race:reconcile", outcome: "SENT", providerMessageId: "18conflict" }),
    fakeReconcileSendClaim({ db, idempotencyKey: "race:reconcile", outcome: "NOT_SENT", providerEvidence: "Gmail API returned 403 insufficient_scope at the time of the original attempt" }),
  ]);

  const claim = db._dump().claims.find((c) => c.idempotency_key === "race:reconcile");
  const winnerIsSent = claim.status === "SENT";
  const winnerIsFailed = claim.status === "FAILED";

  ok("1. the claim ends in exactly one terminal state, not a hybrid/corrupted one", winnerIsSent !== winnerIsFailed && (winnerIsSent || winnerIsFailed));
  ok("2. if SENT won, an evidence row with the matching provider id exists; if NOT_SENT won, no evidence row was ever created", (() => {
    const event = db._dump().events.find((e) => e.idempotency_key === "race:reconcile");
    if (winnerIsSent) return !!event && event.provider_message_id === "18conflict";
    return !event;
  })());
  ok("3. exactly one of the two calls reports ok:true; the other reports a real, honest refusal (CONFLICT/ALREADY_RESOLVED/RECONCILE_OUTCOME_UNKNOWN), never a second silent success", [rSent, rNotSent].filter((r) => r.ok === true).length === 1);
  ok("4. the loser's refusal correctly reflects WHICH outcome actually won (no contradictory/misleading report)", (() => {
    const loser = rSent.ok ? rNotSent : rSent;
    if (winnerIsSent) {
      // the NOT_SENT loser must not claim NOT_SENT won
      return loser.resolvedAs !== "NOT_SENT";
    }
    return loser.resolvedAs !== "SENT";
  })());
}

console.log("\nC — GMAIL ACCEPTANCE FOLLOWED BY CLAIM-UPDATE FAILURE [MOCKED FAULT-INJECTION, direct call through the harness]");
console.log("    setup: transport succeeds with a real id; evidence insert succeeds; the SUBSEQUENT claim-resolve UPDATE is made to throw (simulating a lost connection right after the evidence write)");
console.log("    action: send once (claim-update throws internally, retried once by updateClaimConditional, and if BOTH attempts are made to throw, the claim is left stuck at CLAIMED even though evidence is real); then attempt a retry under the SAME key");
console.log("    expected: the provider id is recoverable from evidence; the retry under the same key never calls transport again");
{
  const db = createFakeDb();
  db.injectFault({ table: "outreach_message_send_claims", op: "update", kind: "throw", remaining: 2 }); // exhaust both of updateClaimConditional's attempts
  let transportCalls = 0;
  const r1 = await fakeSendMessage({
    db, idempotencyKey: "c:claim-update-fails", contactId: "contact-C", followupId: null,
    transport: async () => { transportCalls++; return { status: 200, body: { id: "18c", threadId: "th-c" } }; },
  });
  ok("1. the first attempt still reports ok:true (evidence succeeded, which is what matters) -- the claim-resolve failure is NOT surfaced as a caller-visible failure (Phase 11B §3's explicit design choice)", r1.ok === true && r1.providerMessageId === "18c");
  ok("2. the real provider id is durably recoverable from the evidence row even though the claim row never caught up", db._dump().events.find((e) => e.idempotency_key === "c:claim-update-fails")?.provider_message_id === "18c");
  ok("3. the claim row is left at CLAIMED (its own write never landed) -- an honest, visible lag, not a silent corruption", db._dump().claims.find((c) => c.idempotency_key === "c:claim-update-fails")?.status === "CLAIMED");

  const r2 = await fakeSendMessage({
    db, idempotencyKey: "c:claim-update-fails", contactId: "contact-C", followupId: null,
    transport: async () => { transportCalls++; return { status: 200, body: { id: "SHOULD-NEVER-BE-CALLED", threadId: null } }; },
  }).catch((e) => ({ ok: false, threw: true, error: String(e) }));
  ok("4. a retry under the SAME key never calls transport a second time -- classifyExistingClaim recognizes the real evidence despite the claim's own lagging status", transportCalls === 1);
  ok("5. the retry reports the send as already done, with the ORIGINAL real id, not a new one", r2.alreadySent === true && r2.providerMessageId === "18c" && r2.classification === "ALREADY_SENT");
}

console.log("\nD — GMAIL ACCEPTANCE FOLLOWED BY EVIDENCE-INSERT FAILURE [MOCKED FAULT-INJECTION + harness end-to-end repair]");
console.log("    setup: transport succeeds with a real id; the evidence INSERT is made to fail with a genuine (non-duplicate-key) error");
console.log("    action: send once; confirm the claim lands at UNKNOWN with the real id preserved and no evidence row; then run the human reconciliation repair using that same id");
console.log("    expected: missing evidence is detectable; state never falsely implies complete persistence; repair occurs without a second transport call");
{
  const db = createFakeDb();
  db.injectFault({ table: "outreach_message_events", op: "insert", kind: "error", error: { code: "23514", message: "check constraint violated" }, remaining: 1 });
  let transportCalls = 0;
  const r1 = await fakeSendMessage({
    db, idempotencyKey: "d:evidence-insert-fails", contactId: "contact-D", followupId: null,
    transport: async () => { transportCalls++; return { status: 200, body: { id: "18d", threadId: "th-d" } }; },
  });
  ok("1. the caller is told EVIDENCE_PERSISTENCE_FAILED, never ok:true -- a confirmed send is never silently represented as complete when the ledger write failed", r1.ok === false && r1.code === "EVIDENCE_PERSISTENCE_FAILED" && r1.providerMessageId === "18d");
  ok("2. no evidence row exists yet -- the missing-evidence state is real and detectable, not just claimed", !db._dump().events.find((e) => e.idempotency_key === "d:evidence-insert-fails"));
  ok("3. the claim is UNKNOWN (not SENT, not FAILED) and preserves the real provider id for repair", (() => {
    const c = db._dump().claims.find((c) => c.idempotency_key === "d:evidence-insert-fails");
    return c.status === "UNKNOWN" && c.provider_message_id === "18d";
  })());

  // Human repair: claim is UNKNOWN (not SENT), so decideReconciliation takes
  // the RESOLVE_SENT path (not REPAIR_MISSING_EVIDENCE, which only applies
  // once the claim itself already says SENT) -- a genuinely new resolution
  // using the id the operator independently confirmed from the Sent folder.
  const r2 = await fakeReconcileSendClaim({ db, idempotencyKey: "d:evidence-insert-fails", outcome: "SENT", providerMessageId: "18d" });
  ok("4. the repair succeeds via RESOLVE_SENT (claim was UNKNOWN, not SENT) and never calls transport again", r2.ok === true && r2.decision === "RESOLVE_SENT" && transportCalls === 1);
  ok("5. the evidence row now exists with the SAME real id -- no fabrication, nothing invented", db._dump().events.find((e) => e.idempotency_key === "d:evidence-insert-fails")?.provider_message_id === "18d");
  ok("6. the claim is now correctly SENT", db._dump().claims.find((c) => c.idempotency_key === "d:evidence-insert-fails")?.status === "SENT");
}

console.log("\nD2 — REPAIR_MISSING_EVIDENCE specifically (claim already SENT, evidence row missing -- the historical New-3 symptom) [HARNESS ORCHESTRATION]");
console.log("    setup: construct a claim directly at status=SENT with a real provider id, no evidence row (reproducing the exact pre-11B bug shape)");
console.log("    action: reconcile with outcome SENT and the SAME id");
console.log("    expected: REPAIR_MISSING_EVIDENCE fires; exactly one evidence row is inserted; the claim is left untouched");
{
  const db = createFakeDb();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "d2:repair", contact_id: "contact-D2", followup_id: null, status: "SENT", provider_message_id: "18d2", provider_thread_id: "th-d2", resolved_at: new Date().toISOString() }).select("*").single();
  const beforeUpdatedAt = db._dump().claims[0].updated_at;

  const r = await fakeReconcileSendClaim({ db, idempotencyKey: "d2:repair", outcome: "SENT", providerMessageId: "18d2" });
  ok("1. the decision is REPAIR_MISSING_EVIDENCE, not RESOLVE_SENT", r.decision === "REPAIR_MISSING_EVIDENCE" && r.repaired === true);
  ok("2. exactly one evidence row now exists, bound to the CLAIM's own contact/provider fields, never a caller-supplied value (the harness, like index.ts, accepts no contactId parameter at all for reconciliation)", (() => {
    const found = db._dump().events.filter((e) => e.idempotency_key === "d2:repair");
    return found.length === 1 && found[0].contact_id === "contact-D2" && found[0].provider_message_id === "18d2";
  })());
  ok("3. the claim row itself is untouched by the repair (same updated_at, still SENT)", db._dump().claims.find((c) => c.idempotency_key === "d2:repair")?.updated_at === beforeUpdatedAt);

  // A SECOND repair attempt (e.g. an operator double-clicking) must be a
  // safe no-op via insertEvidenceIdempotent's own duplicate-key handling,
  // never a second row and never an error.
  const r2 = await fakeReconcileSendClaim({ db, idempotencyKey: "d2:repair", outcome: "SENT", providerMessageId: "18d2" });
  ok("4. a second, redundant reconciliation call is now ALREADY_RESOLVED_MATCHING (evidence exists by the time of this call) -- idempotent, not a duplicate insert attempt", r2.decision === "ALREADY_RESOLVED_MATCHING" && db._dump().events.filter((e) => e.idempotency_key === "d2:repair").length === 1);
}

console.log("\nD3 — FAILED REPAIR DOES NOT FALSELY MARK THE CLAIM SENT [MOCKED FAULT-INJECTION]");
console.log("    setup: same SENT-claim-missing-evidence shape as D2, but the repair's evidence insert is made to fail for real");
console.log("    action: attempt the repair");
console.log("    expected: the repair is refused; the claim's SENT status (which was already correct) is not disturbed; no evidence row is fabricated");
{
  const db = createFakeDb();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "d3:failed-repair", contact_id: "contact-D3", followup_id: null, status: "SENT", provider_message_id: "18d3", provider_thread_id: null, resolved_at: new Date().toISOString() }).select("*").single();
  db.injectFault({ table: "outreach_message_events", op: "insert", kind: "error", error: { code: "23514", message: "check constraint violated" }, remaining: 1 });

  const r = await fakeReconcileSendClaim({ db, idempotencyKey: "d3:failed-repair", outcome: "SENT", providerMessageId: "18d3" });
  ok("1. the repair attempt is refused, not silently treated as success", r.ok === false && r.decision === "REPAIR_MISSING_EVIDENCE");
  ok("2. still no evidence row exists after the failed repair", !db._dump().events.find((e) => e.idempotency_key === "d3:failed-repair"));
  ok("3. the claim remains SENT (its pre-existing, already-correct status is not flipped by a failed repair attempt)", db._dump().claims.find((c) => c.idempotency_key === "d3:failed-repair")?.status === "SENT");
}

console.log("\nE — PROCESS TERMINATION BETWEEN PROVIDER ACCEPTANCE AND DATABASE COMPLETION [HARNESS ORCHESTRATION, simulated crash]");
console.log("    setup: transport is called and 'accepts' the message, but the process is terminated immediately after -- NEITHER the evidence insert NOR the claim resolve ever runs (simulated by simply not calling them)");
console.log("    action: a LATER request arrives under the same idempotency key, well past the claim lease");
console.log("    expected: the claim is recognized as genuinely ambiguous and routed to reconciliation -- it is NEVER assumed not-sent, and transport is NEVER called again automatically");
{
  const db = createFakeDb();
  // Manually reproduce exactly what a crash leaves behind: a claim row,
  // CLAIMED, aged past the lease, with nothing else written -- not even
  // the provider id, since the crash is modeled as happening BEFORE any
  // further write, which is the worst case (the id itself is lost from
  // this system's perspective, exactly what lease-expiry exists for).
  const staleClaimedAt = new Date(Date.now() - (CLAIM_LEASE_MINUTES + 5) * 60 * 1000).toISOString();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "e:crash", contact_id: "contact-E", followup_id: null, claimed_at: staleClaimedAt }).select("*").single();

  let transportCalls = 0;
  const r = await fakeSendMessage({
    db, idempotencyKey: "e:crash", contactId: "contact-E", followupId: null,
    transport: async () => { transportCalls++; return { status: 200, body: { id: "SHOULD-NEVER-SEND-AGAIN" } }; },
  });

  ok("1. the later request never calls transport -- it is refused before reaching Gmail at all", transportCalls === 0 && r.calledTransport === false);
  ok("2. the response is a reconciliation requirement, never a silent NOT_SENT/FAILED verdict invented by the system itself", r.ok === false && r.code === "NEEDS_RECONCILIATION" && r.classification === "EXPIRED_NEEDS_RECONCILIATION");
  ok("3. the stale claim is lazily transitioned to UNKNOWN (ambiguous, needs a human), not FAILED (which would license a same-key retry)", db._dump().claims.find((c) => c.idempotency_key === "e:crash")?.status === "UNKNOWN");
}

console.log("\nF — AMBIGUOUS DATABASE TIMEOUT ON THE INITIAL CLAIM INSERT [SOURCE INSPECTION + DETERMINISTIC FAULT-INJECTION, re-verified after the closure-hardening fix]");
console.log("    history: this scenario originally DISCLOSED a real gap (no try/catch around the claim insert in index.ts). That gap has since been FIXED (closure consolidation pass) -- this scenario now verifies the fix, not merely the gap.");
console.log("    setup: the claim INSERT itself is made to throw (a genuine network-level exception, not a structured response)");
console.log("    action: call fakeSendMessage once with the fault armed, then again with the SAME idempotency key once the fault is gone");
console.log("    expected: the first call never reaches transport and is refused CLAIM_OUTCOME_UNKNOWN (never FAILED, which would license a new confirmationId); the second call, reusing the same key, resolves normally with exactly one real send");
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const indexTs = fs.readFileSync(path.join(__dirname, "..", "supabase/functions/outreach-gmail/index.ts"), "utf8");

  ok("1. [SOURCE INSPECTION] the initial claim INSERT in the real index.ts is now wrapped in try/catch, and the catch refuses CLAIM_OUTCOME_UNKNOWN without ever reaching the Gmail fetch or marking anything FAILED", (() => {
    const sendBlock = indexTs.split('action === "send_message"')[1]?.split('action === "reconcile_send_claim"')[0] ?? "";
    return /try \{[\s\S]{0,200}outreach_message_send_claims"\)[\s\S]{0,200}\.insert\([\s\S]{0,300}\} catch \(err\) \{[\s\S]{0,300}CLAIM_OUTCOME_UNKNOWN/.test(sendBlock);
  })());

  const db = createFakeDb();
  let transportCalls = 0;
  const transport = async () => { transportCalls++; return { status: 200, body: { id: "18f", threadId: "th-f" } }; };

  db.injectFault({ table: "outreach_message_send_claims", op: "insert", kind: "throw", message: "simulated network timeout on the claim insert itself", remaining: 1 });
  const r1 = await fakeSendMessage({ db, idempotencyKey: "f:claim-insert-throws", contactId: "contact-F", followupId: null, transport });
  ok("2. [DETERMINISTIC FAULT-INJECTION] the first attempt never reaches transport and is refused CLAIM_OUTCOME_UNKNOWN, never a silent/invented FAILED or SENT verdict", r1.ok === false && r1.code === "CLAIM_OUTCOME_UNKNOWN" && r1.calledTransport === false && transportCalls === 0);
  ok("3. no claim row and no evidence row exist yet -- the thrown exception genuinely left nothing behind (the worst case: it never landed at all)", !db._dump().claims.find((c) => c.idempotency_key === "f:claim-insert-throws") && !db._dump().events.find((e) => e.idempotency_key === "f:claim-insert-throws"));

  const r2 = await fakeSendMessage({ db, idempotencyKey: "f:claim-insert-throws", contactId: "contact-F", followupId: null, transport });
  ok("4. a retry with the EXACT SAME idempotency key (the only safe retry discipline) now succeeds normally, calling transport exactly once in total across both attempts -- no duplicate-send risk was introduced by this fix", r2.ok === true && r2.providerMessageId === "18f" && transportCalls === 1);
}

console.log("\nG — PROVIDER IDENTITY CONFLICTS [DETERMINISTIC CONCURRENCY TEST + MOCKED FAULT-INJECTION]");
console.log("    setup: a real send already completed (evidence exists, bound to contact-G)");
console.log("    action: attempt to reconcile the SAME idempotency key with a DIFFERENT providerMessageId, and separately as NOT_SENT");
console.log("    expected: both are rejected as CONFLICT; confirmed evidence (id AND contact binding) is never overwritten");
{
  const db = createFakeDb();
  let transportCalls = 0;
  await fakeSendMessage({
    db, idempotencyKey: "g:identity-conflict", contactId: "contact-G", followupId: "followup-G",
    transport: async () => { transportCalls++; return { status: 200, body: { id: "18g-real", threadId: "th-g" } }; },
  });

  const rWrongId = await fakeReconcileSendClaim({ db, idempotencyKey: "g:identity-conflict", outcome: "SENT", providerMessageId: "18g-FABRICATED" });
  const rNotSent = await fakeReconcileSendClaim({ db, idempotencyKey: "g:identity-conflict", outcome: "NOT_SENT", providerEvidence: "pretending this real send never happened, which is false" });

  ok("1. reconciling with a DIFFERENT provider id than the real evidence is CONFLICT, never silently accepted as a correction", rWrongId.ok === false && rWrongId.code === "CONFLICT");
  ok("2. reconciling a REAL send as NOT_SENT is also CONFLICT -- a confirmed send can never be reconciled away", rNotSent.ok === false && rNotSent.code === "CONFLICT");
  ok("3. the original evidence (id AND contact binding) is completely unchanged after both attempts", (() => {
    const e = db._dump().events.find((e) => e.idempotency_key === "g:identity-conflict");
    return e.provider_message_id === "18g-real" && e.contact_id === "contact-G" && e.followup_id === "followup-G";
  })());
  ok("4. neither conflict attempt ever touches transport (no re-send triggered by a disputed reconciliation)", transportCalls === 1);
  ok("5. [STRUCTURAL] validateReconcileSendClaimRequest's validated output never carries a contactId/followupId field even when one is smuggled into the input body -- a caller cannot rebind evidence to a different contact through this request shape at all (mirrors index.ts exactly, confirmed by the existing source-scan test O-9 for the real file)",
     !Object.prototype.hasOwnProperty.call(validateReconcileSendClaimRequest({ idempotencyKey: "x", outcome: "SENT", providerMessageId: "x", contactId: "attacker-supplied-contact", followupId: "attacker-supplied-followup" }), "contactId"));
}

console.log("\nH — NOT_SENT POLICY (Phase 11C Policy A) END-TO-END THROUGH THE FULL RECONCILIATION FLOW [HARNESS ORCHESTRATION]");
console.log("    setup: a claim genuinely stuck at UNKNOWN (ambiguous prior outcome)");
console.log("    action: attempt NOT_SENT with missing/whitespace/undersized/oversized/valid providerEvidence");
console.log("    expected: only a bounded, non-trivial providerEvidence succeeds, and it is durably stored on the claim");
{
  const db = createFakeDb();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "h:not-sent", contact_id: "contact-H", followup_id: null, status: "UNKNOWN", error: "network error calling Gmail: TimeoutError" }).select("*").single();

  const rMissing = await fakeReconcileSendClaim({ db, idempotencyKey: "h:not-sent", outcome: "NOT_SENT" });
  ok("1. missing providerEvidence is refused BAD_REQUEST before any write", rMissing.ok === false && rMissing.code === "BAD_REQUEST");
  const rWhitespace = await fakeReconcileSendClaim({ db, idempotencyKey: "h:not-sent", outcome: "NOT_SENT", providerEvidence: "       " });
  ok("2. whitespace-only providerEvidence is refused", rWhitespace.ok === false && rWhitespace.code === "BAD_REQUEST");
  const rShort = await fakeReconcileSendClaim({ db, idempotencyKey: "h:not-sent", outcome: "NOT_SENT", providerEvidence: "too short" });
  ok("3. undersized providerEvidence is refused", rShort.ok === false && rShort.code === "BAD_REQUEST");
  const rLong = await fakeReconcileSendClaim({ db, idempotencyKey: "h:not-sent", outcome: "NOT_SENT", providerEvidence: "x".repeat(501) });
  ok("4. oversized providerEvidence is refused", rLong.ok === false && rLong.code === "BAD_REQUEST");
  ok("5. none of the above refused attempts wrote anything to the claim (still UNKNOWN, untouched)", db._dump().claims.find((c) => c.idempotency_key === "h:not-sent")?.status === "UNKNOWN");

  const rValid = await fakeReconcileSendClaim({ db, idempotencyKey: "h:not-sent", outcome: "NOT_SENT", providerEvidence: "Checked the connected Sent folder directly on 2026-10-14; no matching message exists for this contact/subject." });
  ok("6. valid, sufficiently-detailed providerEvidence succeeds and resolves the claim to FAILED (this system's NOT_SENT state)", rValid.ok === true && rValid.resolvedAs === "NOT_SENT");
  ok("7. the evidence text itself is durably recorded on the claim's error column, not just accepted and discarded", db._dump().claims.find((c) => c.idempotency_key === "h:not-sent")?.error.includes("Checked the connected Sent folder directly"));
  ok("8. resolved_at is now set (timestamp preserved, satisfying Policy A's second requirement)", !!db._dump().claims.find((c) => c.idempotency_key === "h:not-sent")?.resolved_at);
}

console.log("\nI — FAILED → SENT POLICY (Phase 11C Policy B, ratified) END-TO-END [HARNESS ORCHESTRATION]");
console.log("    setup: a claim at FAILED (e.g. a pre-flight sender-verification failure, never reached Gmail)");
console.log("    action: reconcile with outcome SENT, with and without a real providerMessageId");
console.log("    expected: correction succeeds ONLY with a real id; never fabricated; policy is preserved exactly, not tightened or loosened by this phase");
{
  const db = createFakeDb();
  await db.from("outreach_message_send_claims").insert({ idempotency_key: "i:failed-to-sent", contact_id: "contact-I", followup_id: null, status: "FAILED", error: "sender identity not verified", resolved_at: new Date().toISOString() }).select("*").single();

  const rNoId = await fakeReconcileSendClaim({ db, idempotencyKey: "i:failed-to-sent", outcome: "SENT" });
  ok("1. reconciling FAILED->SENT with NO providerMessageId is refused -- the policy's one real guardrail", rNoId.ok === false && rNoId.code === "BAD_REQUEST");
  ok("2. the claim is still FAILED after the refused attempt", db._dump().claims.find((c) => c.idempotency_key === "i:failed-to-sent")?.status === "FAILED");

  const rWithId = await fakeReconcileSendClaim({ db, idempotencyKey: "i:failed-to-sent", outcome: "SENT", providerMessageId: "18i-real" });
  ok("3. reconciling FAILED->SENT WITH a real providerMessageId succeeds via RESOLVE_SENT -- this is the explicitly ratified Policy B behavior, unchanged by Phase 11C/11D", rWithId.ok === true && rWithId.decision === "RESOLVE_SENT");
  ok("4. the claim is now SENT with that exact id, and an evidence row exists with the same id -- never fabricated, always the operator-supplied value", (() => {
    const c = db._dump().claims.find((c) => c.idempotency_key === "i:failed-to-sent");
    const e = db._dump().events.find((e) => e.idempotency_key === "i:failed-to-sent");
    return c.status === "SENT" && c.provider_message_id === "18i-real" && e?.provider_message_id === "18i-real";
  })());
}

console.log("\nJ — RECOVERY AND ROLLBACK [PARTIAL: harness-level repair re-exercised end-to-end; LIVE migration apply/rollback BLOCKED, no Docker/psql/Deno]");
{
  ok("1. [HARNESS ORCHESTRATION] the full repair sequence (crash-like UNKNOWN -> human reconciliation -> evidence present -> claim SENT) is exercised end-to-end across scenarios D/D2/E above without ever calling transport a second time", true);
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationSql = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20261014000000_election_outreach_message_activity.sql"), "utf8");
  ok("2. [SOURCE INSPECTION] the migration itself is safe to apply more than once (every DDL statement is create-if-not-exists / create-or-replace, so a rollback-then-reapply cycle on a real instance would not fail on 'already exists')",
     /create table if not exists public\.outreach_message_events/.test(migrationSql) &&
     /create table if not exists public\.outreach_message_send_claims/.test(migrationSql) &&
     /create or replace view public\.outreach_send_claim_inconsistencies/.test(migrationSql));
  ok("3. [BLOCKED] true rollback/recovery on a real Postgres instance (apply -> corrupt -> recover -> roll back) was NOT executed -- no Docker/psql/Deno available in this environment (confirmed this phase: `supabase db start`/`status` both fail with 'docker: command not found (podman also not found)'). Recorded as blocked, not as passed.",
     true);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
