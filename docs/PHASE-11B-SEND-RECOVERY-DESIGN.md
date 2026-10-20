# Phase 11B — Verified Send Recovery and Evidence Integrity: Design

> **Superseded in part by Phase 11C.** §7's and §8's "unresolved product
> decision" framing below reflects this phase's own point in time. Both
> were explicitly decided and (for §7/Policy A) implemented in
> `docs/PHASE-11C-POLICY-IMPLEMENTATION.md` -- this document is left as-written,
> not retroactively edited, so it still accurately describes what was true
> when it was authored.

Scope: closing findings **New-2** (concurrent `reconcile_send_claim` races) and **New-3** (unchecked post-send persistence writes) from the Phase 11 Final Read-Only Verification Report, without touching the existing H-1 (atomic send claim) or M-2 (sender-identity verification) fixes, and without expanding into Gmail OAuth setup, reply sync, or UI work.

## 1. The design choice: durable claim state + evidence-first ordering, not a PL/pgSQL RPC

The brief explicitly invited evaluating a narrowly-scoped Postgres function/RPC that wraps the claim update and evidence insert in one transaction, versus a recovery-based design on the existing schema.

**Chosen: the recovery-based design.** The deciding factor is empirical, not aesthetic: this environment has no Docker, no `psql`, and no direct Postgres connection string available to this session (confirmed repeatedly across this project's prior audits). A PL/pgSQL function cannot be executed, parsed, or behaviorally tested here — any such function would have to be reviewed by eye only and reported as "written, never verified to even compile." The chosen design, by contrast, uses exclusively `supabase-js` query-builder calls (`.insert()`, `.update().eq().in()/.neq()`, `.select().maybeSingle()`) — the same primitives already exercised correctly throughout this entire project — and its decision logic was moved into plain, dependency-injected functions in `contract.mjs` that a hand-built mock client can exercise directly under plain Node. The trade-off is explicit: **this design gives up true cross-table atomicity in exchange for using only patterns this session can actually verify.** Section 4 states exactly what residual risk that leaves.

A real RPC remains the architecturally cleaner answer long-term, and nothing here forecloses it — the recovery-based design does not require a different table shape, so a future phase with real Postgres access could add a transactional RPC later without another migration rewrite (`outreach_message_send_claims`/`outreach_message_events` would be used identically by either design).

## 2. State machine

```
            insert (unique idempotency_key)
   (new) ───────────────────────────────────▶ CLAIMED
                                                 │
                        ┌────────────────────────┼────────────────────────┐
                        │                        │                        │
              pre-flight failure         Gmail definite failure   Gmail network/timeout
              (no token / sender                (4xx/5xx,                (thrown
               not verified)                non-id 2xx)                exception)
                        │                        │                        │
                        ▼                        ▼                        ▼
                     FAILED                   FAILED                  UNKNOWN
                 (resolved_at set)        (resolved_at set)        (resolved_at NOT set --
                                                                     not yet resolved)

              Gmail definite success (real id)
   CLAIMED ──────────────────────────────────────▶ [evidence insert] ──▶ [claim → SENT]
                                                         │                     │
                                               insert fails for real    (best-effort; see §3)
                                                         │
                                                         ▼
                                                      UNKNOWN
                                         (provider_message_id preserved on the
                                          claim row even though status ≠ SENT)
```

`FAILED` and `UNKNOWN` can both be reached from `reconcile_send_claim` too (`NOT_SENT` → `FAILED`; a human-confirmed send with a matching id, where the claim already says `SENT` but evidence is missing → **repairs evidence only**, the claim is left untouched).

**Terminal vs. non-terminal:** `SENT` and `FAILED` are terminal — `resolved_at` is set, and nothing in `send_message` or `reconcile_send_claim` ever transitions away from them except the explicit, audited `reconcile_send_claim` override paths (§6). `UNKNOWN` is **not** terminal — `resolved_at` stays null, signaling "still needs a human," and it is the only status a human reconciliation path can move out of via `RESOLVE_SENT`/`RESOLVE_NOT_SENT`.

**`CLAIMED` is itself not fully durable as a single source of truth** — see §3's evidence-first ordering. A row can SAY `CLAIMED` while the real, user-visible fact (`outreach_message_events`) already shows `SENT`. Every reader of claim state (`classifyExistingClaim`) checks evidence first for exactly this reason.

## 3. Evidence-first ordering (closes New-3)

Previous (Phase 11) ordering: resolve claim → SENT, *then* insert evidence. Neither write's result was checked.

**New ordering: insert evidence (idempotent) → resolve claim → SENT (best-effort, checked).**

Why the swap: `outreach_message_events` is the actual system of record — `OutreachControlRoom.jsx`, `computeActivitySummary()`, and every other reader in this subsystem reads *evidence*, never the claims table. `outreach_message_send_claims` exists purely as send-time bookkeeping/locking machinery. If exactly one of the two writes is going to succeed and the other fail, the failure mode where **the user-visible fact is correct and the bookkeeping lags** is categorically better than the reverse (a claim that says `SENT` with nothing in the ledger to show for it — the literal New-3 symptom).

Every write is checked (`insertEvidenceIdempotent`/`updateClaimConditional`, `contract.mjs`):

| Outcome | Evidence insert | Claim resolve |
|---|---|---|
| Clean success | Row inserted | Caller told `ok:true` regardless of whether this step's own result matched (see below) |
| Unique-violation (duplicate key) | **Not an error** — re-read and return the existing row | n/a |
| Genuine Postgres error | `ok:false`, reported to caller as `EVIDENCE_PERSISTENCE_FAILED`; claim marked `UNKNOWN` with the real provider id preserved | n/a |
| Thrown exception (network-level) | Retried once (safe — insert is idempotent); `ambiguous:true` only if the retry also fails | same retry-once pattern |
| Claim resolve fails/loses a race *after* evidence already succeeded | n/a | **Not reported to the caller as a failure.** The send already succeeded and is durably recorded; the claim's own status catching up later (via `classifyExistingClaim`'s evidence-aware check) is a bookkeeping repair, not a correctness problem the caller needs to see. |

This directly satisfies: *"the caller can receive success even though the evidence ledger is incomplete"* is now impossible for the success path (evidence is checked **before** `ok:true` is ever returned), and *"a retry must never blindly send again merely because a database write failed"* (an evidence-insert failure after a confirmed Gmail success produces `UNKNOWN`, not `FAILED` — `FAILED` would license a same-key retry, which must never recur with a message Gmail already accepted).

## 4. Idempotency and concurrency strategy

- **`send_message`'s claim insert** remains the H-1 guarantee, untouched: one `INSERT` against a unique-indexed column, before any Gmail call. This is still the actual atomicity primitive for "can two concurrent `send_message` calls both reach Gmail" — nothing in 11B weakens it.
- **A lost claim race** now checks evidence *and* claim state (`classifyExistingClaim(claim, existingEvent, now)`) before deciding — a claim that looks stale/`CLAIMED` but has real matching evidence is reported `ALREADY_SENT` from the evidence, never misclassified as needing reconciliation.
- **`reconcile_send_claim`** (New-2's target) is restructured around one pure function, `decideReconciliation()`, that makes the *entire* decision — idempotent match, conflict, repair, or a genuinely new resolution — from a single read of claim + evidence, before any write. The actual concurrency guard is a **conditional UPDATE** (`.eq("id", claimId).in("status", [...])`) whose matched-row-count is checked: only one of two racing reconciliation attempts can ever match the condition; the loser re-reads the real final state and reports it honestly (never assumes its own stale view still applies).
- **No client-side lock is used anywhere** (the brief explicitly prohibits this, correctly — a lock held in one Edge Function instance's memory is invisible to any other instance). Every concurrency guarantee here is a Postgres-enforced unique index or a conditional `WHERE` clause's own row-count — properties that hold regardless of which instance, or how many, are running.

## 5. Evidence-repair procedure

Three repair paths, all triggered only by `reconcile_send_claim`, never automatically:

1. **Claim says `SENT`, no evidence row exists** (the historical New-3 symptom): `decideReconciliation` returns `REPAIR_MISSING_EVIDENCE` when the operator's reconciliation request supplies the *exact* `providerMessageId` already recorded on the claim. Only the evidence row is inserted; the claim is left untouched. A mismatched id is a `CONFLICT`, never silently accepted as a correction.
2. **Evidence exists, claim hasn't caught up to `SENT`**: never needs an explicit repair action — `classifyExistingClaim` already treats this as `ALREADY_SENT` on every subsequent read, since evidence is checked first. `outreach_send_claim_inconsistencies` (the new diagnostic view) still surfaces it for a human who wants to see it directly.
3. **A send outcome that never resolved at all (`UNKNOWN`)**: `reconcile_send_claim` with `outcome: "SENT"` (requires a real `providerMessageId` a human found by checking the actual Sent folder) or `outcome: "NOT_SENT"` (no evidence requirement — see §7).

**Detectability**: `outreach_send_claim_inconsistencies` (new view, `supabase/migrations/20261014000000_...sql`) — owner-queried only, same posture as the pre-existing `launch_analytics_daily`, never granted to `anon`/`authenticated`. Surfaces exactly the two inconsistency shapes above as a plain `SELECT`.

## 6. Operator reconciliation requirements

- `reconcile_send_claim` remains behind `OUTREACH_ADMIN_SECRET`, identical to every other action in this function.
- A `SENT` reconciliation always requires a real `providerMessageId` the operator actually found — never fabricated, never accepted as a bare assertion.
- A `NOT_SENT` reconciliation requires no evidence (see §7 — recorded as an explicit, unresolved product decision, not silently changed).
- **Unresolved policy question, explicitly not changed this phase**: a `FAILED` claim (including one that failed *before Gmail was ever called*, e.g. an unverified sender) can still be reconciled to `SENT` by a human supplying a real provider id. This is the exact pre-11B behavior, preserved deliberately per the brief's instruction not to silently change it. See §8 for the recommendation.

## 7. `NOT_SENT` evidence — unresolved product decision

`validateReconcileSendClaimRequest` (`contract.mjs`) still requires **no evidence or note** for an `outcome: "NOT_SENT"` reconciliation — unchanged from before this phase. This was deliberately **not** changed:
- Requiring a mandatory `note` would add a real audit-trail improvement.
- It would also be easy to satisfy with a meaningless string, so it's unclear how much real diligence it would actually enforce versus just adding friction.
- Changing a validation contract is exactly the kind of policy change the brief asks to flag, not make unilaterally.

**Recommendation, not implemented:** require a mandatory, non-trivial `note` (e.g. minimum length) for `NOT_SENT` reconciliations, purely as an audit-trail nudge, understanding it cannot be substantively validated server-side. Left for explicit authorization.

## 8. `FAILED` → `SENT` reconciliation — unresolved product decision

Reviewed per the brief's instruction; **not changed**. Three framings, left for a human to pick:
- **Legitimate correction path**: an automated `FAILED` verdict (e.g., a transient "sender not verified" misfire, or a bug in that check) shouldn't permanently block recording a message that a human can independently confirm was actually sent.
- **Invalid transition**: a pre-flight `FAILED` (Gmail was never even called) is a *logically* different fact than "Gmail was called and something is uncertain" — allowing it into `SENT` conflates "we never tried" with "we tried and it worked."
- **Distinct, separately-audited override action**: keep the capability, but require a different action name/flag (e.g. `force: true`) so a plain `reconcile_send_claim` call can't silently cross this line, making the override visible in logs/audits as a deliberate act.

**Recommendation, not implemented:** option 3 (a distinct, explicitly-flagged override), which preserves the capability for the legitimate case while making it visibly different from routine `UNKNOWN`-resolution. Left for explicit authorization — `decideReconciliation`'s current behavior is unchanged and tested as such (see `election-outreach-gmail-function.consumer.mjs`, section K3, test 10).

## 9. Explicit guarantees and limitations

**Guaranteed, by source inspection + behavioral/mocked tests (never by live execution — see the verification report for the full breakdown):**
- A `send_message` call under a given `(contactId, confirmationId)` pair can reach the Gmail `fetch()` at most once per *first* request to win the claim insert; every other concurrent/later request under the same key is refused before any Gmail call (H-1, unchanged).
- A confirmed Gmail success is never reported as a caller-visible failure, and never silently produces a `FAILED` status (which would license a same-key retry of a message that may have already gone out).
- An evidence row, once it exists, is never overwritten with a different `providerMessageId`, and is never rebound to a different `contact_id`/`followup_id` than the claim it came from.
- `NOT_SENT` can never override existing evidence, under any race ordering tested.

**NOT guaranteed, and explicitly disclosed as a residual limitation of choosing the recovery-based design over an RPC:**
- The evidence insert and the claim-resolve update are **two independent HTTP/Postgres round trips, not one transaction.** If the Edge Function process is killed outright between them, evidence is durably recorded but the claim can sit at `CLAIMED` until a later read (lazy, on next contact with the same key) reclassifies it. This is a *known, bounded, self-describing* inconsistency (visible via `outreach_send_claim_inconsistencies` and self-healing on next read) — not a silent one — but it is not the same guarantee a single transaction would provide.
- True concurrent-request behavior (two real simultaneous HTTP calls racing against a live Postgres unique index) has **not been executed** anywhere in this phase. Every concurrency claim rests on (a) correct code structure, confirmed by reading, and (b) well-documented Postgres/`supabase-js` semantics, not on this session having actually fired two concurrent requests at a database.
