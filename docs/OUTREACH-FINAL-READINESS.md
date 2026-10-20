# Outreach Gmail Send-Recovery — Final Readiness

Date: 2026-10-14. This is the single authoritative closure document for
the outreach Gmail send-recovery workstream (Phases 11B, 11C, 11D). It
consolidates, and does not replace, the historical reports:

- `docs/PHASE-11B-SEND-RECOVERY-DESIGN.md` / `PHASE-11B-VERIFICATION-REPORT.md`
- `docs/PHASE-11C-POLICY-IMPLEMENTATION.md` / `PHASE-11C-VERIFICATION-REPORT.md`
- `docs/PHASE-11D-VERIFICATION-PLAN.md` / `PHASE-11D-VERIFICATION-REPORT.md`

Those documents are left as-written. This one states where the
workstream actually stands today, closes the one outstanding defect that
was safe to fix locally, and gives a single definitive recommendation.
**No further phase, plan, or audit cycle follows this document.**

## 1. What was implemented, across Phases 11B–11D

**Phase 11B** (atomic send claims + evidence-first persistence):
- `outreach_message_send_claims` -- a separate table making "at most one
  real Gmail send per idempotency key" an actual guarantee (one unique
  index, one INSERT before any Gmail call), not a best-effort check
  (audit fix H-1, pre-existing, re-verified).
- Evidence-first write ordering: a confirmed Gmail send is recorded in
  `outreach_message_events` (the real system of record) *before* the
  claim's own bookkeeping status is resolved, so a transient failure on
  the second write never produces a `SENT` claim with nothing in the
  ledger (closes finding New-3).
- `decideReconciliation()` -- the entire reconciliation decision
  (idempotent match / conflict / repair / new resolution) made from one
  read, before any write; the actual concurrency guard is a conditional
  `UPDATE` whose matched-row-count is checked, with the loser re-reading
  real state rather than assuming its own view won (closes finding
  New-2).
- `outreach_send_claim_inconsistencies` -- an owner-only diagnostic view
  surfacing the two ways claim/evidence can lag each other.

**Phase 11C** (the two policy decisions Phase 11B left open):
- **Policy A (`NOT_SENT`):** a reconciliation to `NOT_SENT` now requires a
  real, bounded (15–500 char), non-trivial `providerEvidence` string,
  durably stored on the claim. Before this, `NOT_SENT` required nothing
  at all -- the literal gap that could let an ambiguous (`UNKNOWN`) send
  be waved through as "not sent" and then retried under a new
  confirmationId, risking a real duplicate email.
- **Policy B (`FAILED → SENT`):** ratified as the existing, unchanged
  behavior -- a `FAILED` claim can be corrected to `SENT` only with a
  real, operator-supplied `providerMessageId`, never fabricated. No code
  changed for this policy; it was already correct and is now explicitly
  the accepted policy, not merely "preserved pending a decision."

**Phase 11D** (controlled verification):
- Built `test/election-outreach-gmail-recovery-proof.consumer.mjs` --
  deterministic concurrency tests (two real, racing `Promise.all` calls
  against one shared, stateful in-memory store whose check+write steps
  are only atomic across a verified-genuine `await` boundary), mocked
  fault-injection, and harness-level end-to-end flows calling the real
  `contract.mjs` decision functions.
- Confirmed, by direct command execution (not assumption), that this
  environment has no Docker, no Podman, no `psql`, and no Deno -- so no
  live Postgres and no way to execute `index.ts` directly. Every claim
  in this workstream about live-database behavior is explicitly scoped
  around that fact, not papered over.
- Identified one real, narrow gap: the initial claim `INSERT` in
  `send_message` had no `try`/`catch`, unlike every other write in the
  file.

**This closure pass** (new in this document's own scope):
- **Fixed the Phase 11D finding.** `supabase/functions/outreach-gmail/index.ts`'s
  claim `INSERT` is now wrapped in `try`/`catch`. A thrown exception
  there is refused as `CLAIM_OUTCOME_UNKNOWN` -- Gmail is never called
  from that branch, and nothing is ever marked `FAILED` (which would
  wrongly license a brand-new `confirmationId`). The caller is told to
  retry with the exact same `confirmationId`; that retry resolves safely
  either way (a fresh claim if the original insert never landed, or the
  existing, already-tested lost-claim-race path if it did). **This
  introduces no duplicate-send risk** -- verified by a new deterministic
  test (`election-outreach-gmail-recovery-proof.consumer.mjs`, scenario
  F) that injects exactly this fault and confirms transport is called
  exactly once total across the failed attempt and its retry.
- No other code changed. No policy decision (A or B) was reopened --
  neither had a concrete defect; both were just re-confirmed by the
  tests already in place.

## 2. Final test and build results (reconfirmed, not assumed)

```
node test/election-outreach-gmail-function.consumer.mjs          -> 125/125 assertions passed
node test/election-outreach-gmail-recovery-proof.consumer.mjs    -> 55/55 assertions passed
node test/election-outreach-launch-separation.consumer.mjs       -> 47/47 assertions passed
node test/election-outreach-admin-function.consumer.mjs          -> 80/80 assertions passed
node test/election-outreach-control-room.consumer.mjs            -> 49/49 assertions passed

npm test   (full chain, 86 files)   -> exit 0, zero "FAIL" lines anywhere
npm run build (vite build)          -> exit 0, 279 modules transformed
```

(125 = Phase 11C's 124 plus one new assertion confirming the closure
fix's try/catch is wired in; 55 = Phase 11D's 53 plus two new assertions
in the rewritten scenario F, which now verifies the fix rather than
documenting the gap.)

`git status` at the start and end of this pass: branch `main`, HEAD
`797fefe`, every file touched by this workstream still untracked (`??`)
or (`package.json`, for the one test-registration line) modified-but-
unstaged -- nothing staged, committed, or pushed at any point.

## 3. Safety properties verified locally

- **At most one real Gmail send per idempotency key.** One unique-indexed
  `INSERT` before any Gmail call; proven both by source inspection and by
  a genuine concurrent-execution test (two racing requests, transport
  invoked exactly once).
- **A confirmed Gmail success is never silently incomplete.** Evidence is
  written before the claim is marked `SENT`; a failed evidence write is
  reported `EVIDENCE_PERSISTENCE_FAILED`, never `ok:true`, and preserves
  the real provider id for repair.
- **An ambiguous outcome never licenses a retry that could duplicate a
  send.** Network/timeout exceptions (Gmail fetch, and now the claim
  insert itself) resolve to `UNKNOWN` or a plain refusal, never `FAILED`
  -- `FAILED` is reserved for a real, completed, negative provider
  response or an explicit, evidenced human reconciliation.
- **Concurrent reconciliation cannot produce a contradictory result.** A
  conditional `UPDATE`'s matched-row-count is the actual guard; the loser
  of a race re-reads real state and reports it honestly. Verified by a
  genuine concurrent-execution test with two conflicting outcomes raced
  against each other.
- **`NOT_SENT` requires real, durable evidence** (Policy A) and **`FAILED
  → SENT` requires a real, non-fabricated provider id** (Policy B) --
  both enforced at request validation and verified end-to-end.
- **Identity/evidence cannot be rebound.** Reconciliation has no
  `contactId`/`followupId` parameter at all; a mismatched provider id or
  an attempt to reconcile a confirmed send as `NOT_SENT` is always
  `CONFLICT`, never silently accepted.
- **The migration is idempotent-safe to (re-)apply.** Every DDL statement
  is `create table if not exists` / `create or replace view`.

All of the above are backed by pure-function tests, mocked-client tests,
genuine-interleaving concurrency tests against a stateful in-memory
store, and source inspection confirming the real `index.ts` matches that
tested logic -- never by a live database or live Gmail call.

## 4. Remaining defects

**None known and unfixed within this workstream's scope.** The one
concrete defect identified (Phase 11D's claim-insert try/catch gap) is
fixed and verified (§1, §2). Two previously-disclosed, narrow,
non-blocking items remain **documented, not fixed** (both out of scope
for a "genuine release-blocker" bar, and neither creates a duplicate-send
or data-loss risk):
- `note` (the optional reconciliation annotation field) has no length
  bound, which combined with the claim's 2000-char `error` column could
  in an extreme case trigger a real constraint violation that currently
  surfaces with a misleading "concurrent reconciliation" message rather
  than a clear one. Cosmetic (error-message wording only); does not
  affect correctness.
- No further hardening was attempted beyond the one fix in §1; none of
  the remaining `index.ts` writes lack a try/catch or a checked result.

## 5. Explicitly unverified: live database and Gmail integration behavior

**Never executed, anywhere in this workstream, and not executed in this
closure pass either:**
- Two real, simultaneous HTTP requests racing against a real Postgres
  unique index or a real conditional `UPDATE`.
- A real migration apply/corrupt/recover/rollback cycle.
- Any real call to the Gmail API (send, reconciliation-adjacent reads,
  or OAuth token exchange).

**Why:** this environment has no Docker, no Podman, no `psql`, and no
Deno runtime (confirmed by direct command execution across Phase 11D and
reconfirmed implicitly by this pass making no attempt to install any of
them, per the closure instructions). The Supabase CLI is available only
via `npx` cache and was used solely for two read-only remote status
checks (migration list, functions list) -- no write capability was
exercised or needed.

This is the one category of evidence this workstream cannot produce
locally. It is not papered over by relabeling a mocked or harness-level
test as a live one anywhere in these documents.

## 6. Production migration and deployment status

- Migration `20261014000000_election_outreach_message_activity.sql`:
  **not applied** to the linked project (`remote: ""` as of the last
  read-only check, Phase 11D). **Not applied in this pass.**
- Edge Function `outreach-gmail`: **not deployed** (absent from the live
  functions list as of the last check). **Not deployed in this pass.**
  `outreach-admin` remains at v5, `launch-send-campaign-email` at v9 --
  both unrelated to this workstream and untouched throughout.
- Gmail OAuth: **not configured.** No secret was read, set, or printed at
  any point in Phases 11B–11D or in this pass.
- Email sending: **none, ever, in this entire workstream.** Every "send"
  in every test is a call to an in-process fake transport function that
  never leaves the Node process.

## 7. Minimum outstanding requirements for activation

In order, each a hard prerequisite for the next:

1. **A real Postgres connection** (Docker/Podman + `supabase db start`,
   or an equivalent disposable/staging instance) to run the live
   concurrency and migration-rollback tests this workstream has
   consistently and explicitly been unable to run locally.
2. **Apply migration `20261014000000`** to that instance (staging first,
   never production first) and re-run the live-concurrency scenarios from
   `docs/PHASE-11D-VERIFICATION-PLAN.md` §3-4 against it.
3. **Configure Gmail OAuth** (`docs/OUTREACH-GMAIL-SETUP.md`) on a
   non-production Google account/connection first, and verify
   `verify_send_as` and a single real send against that test mailbox.
4. **Deploy `outreach-gmail`** to staging (not production) and re-run the
   duplicate-claim and reconciliation scenarios against the real deployed
   function.
5. Only after 1–4 produce clean results: apply the migration to
   production, deploy to production, and configure the production Gmail
   connection -- each its own explicitly authorized action, not a bundle.

None of 1–5 were performed, attempted, or simulated as performed in this
document. Each requires separate authorization, exactly as the brief for
this phase and every phase before it has stated.

## 8. Definitive recommendation

**READY FOR STAGING.**

Evidence: every safety property this subsystem claims (§3) is verified
locally to the strongest standard achievable without a live database --
genuine concurrent-execution tests (not merely sequential mocks),
fault-injection tests, and harness-level end-to-end flows tied to
source-scan-verified real code, all passing (125/125, 55/55, full
regression suite 0 failures, build green). The one concrete defect found
by this verification effort was fixed and re-verified without reopening
either ratified policy decision. Nothing is deployed, nothing is applied,
no secret exists, and no email has ever been sent by this workstream.

**Not READY FOR PRODUCTION**, because the one category of risk this
workstream cannot retire locally -- genuine concurrent writes against a
*real* Postgres unique index/conditional UPDATE, and a real
apply/rollback cycle -- has never been exercised against a live
database, by this phase or any before it. That is a concrete, named gap
(§5, §7 item 1-2), not a vague caution. **Not BLOCKED**, because nothing
here prevents proceeding to staging: staging is exactly the environment
where that live verification becomes possible, and every local test this
workstream can run has already passed.

---

**This is the final document for this workstream. No Phase 11E, no new
verification plan, and no further audit cycle is recommended or implied
by anything above.** The next action is whichever item in §7 the
responsible team is ready to authorize, starting with item 1.
