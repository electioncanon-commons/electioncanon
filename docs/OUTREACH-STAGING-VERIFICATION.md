# Outreach Gmail Send-Recovery — Staging Verification

Date: 2026-10-15. This closes the staging-verification milestone defined
by the implementation brief for this workstream, carrying forward from
`docs/OUTREACH-FINAL-READINESS.md`'s **READY FOR STAGING** recommendation
and its §5/§7 statement of exactly what had never been exercised against
a real database: *genuine concurrent writes against a real Postgres
unique index/conditional UPDATE, and a real apply/rollback cycle.*

**This document closes that specific gap.** It does not reopen Policy A
or Policy B, and it introduces no code change to `supabase/functions/
outreach-gmail/` or its migration -- every test below ran against the
existing, unmodified implementation.

## 1. Environment

- **Staging project:** `electioncanon-outreach-staging`, ref
  `dvehncqtaqtxqptxxulp`, region `eu-west-1`, created 2026-10-14T21:48Z,
  in the same Supabase organization as production but a **separate
  project** -- separate database, separate credentials, separate URL.
  Production remains `lncwkjlgakonokwboxdp` ("ElectionCanon"), untouched
  throughout this milestone.
- **Schema:** all 23 local migrations (`supabase/migrations/*.sql`,
  including `20261014000000_election_outreach_message_activity.sql`)
  applied cleanly via `supabase db push --include-all`; `supabase
  migration list` confirms local == remote for every one. Direct schema
  inspection (`docs/evidence/outreach-staging-verification/evidence-schema.json`)
  confirms both unique indexes
  (`outreach_message_send_claims_idempotency_idx`,
  `outreach_message_events_idempotency_idx`), every check constraint
  from the migration, RLS enabled on all three new tables, and **zero**
  client-role policies on any of them -- matching the migration header's
  claims exactly.
- **Database access:** the staging project's direct host
  (`db.<ref>.supabase.co`) is IPv6-only; the session pooler
  (`aws-0-eu-west-1.pooler.supabase.com:5432`) was used instead for
  tests needing genuine multi-statement `BEGIN`/`COMMIT`/`ROLLBACK`
  control (T2). All other tests used `@supabase/supabase-js` with the
  service-role key, i.e. real HTTP requests to the staging project's own
  PostgREST layer, each becoming a real, independent Postgres
  transaction -- the same path the real Edge Functions use.
- **Transport:** per explicit instruction this round, Gmail OAuth was
  **not** configured (it requires manual Google Cloud Console steps
  `docs/OUTREACH-GMAIL-SETUP.md` already states cannot be done by an
  automated session). Instead, an **isolated fake transport function
  with a call counter** stands in for the real `fetch()` to
  `gmail.googleapis.com` -- the brief's own explicitly allowed
  alternative ("a controlled Gmail test account **or equivalent isolated
  transport test setup**"). No real email was sent or attempted at any
  point. See §9 for exactly what this does and does not verify.
- **Synthetic data:** one synthetic contact
  (`organization = 'STAGING-VERIFICATION-SYNTHETIC-CONTACT'`, recipient
  `staging-test-recipient@example.invalid` -- an RFC 2606 reserved,
  non-resolvable TLD, never a deliverable address) was the only contact
  row used across every test. No real candidate, organization, or
  address was ever read or written.
- **Test harness:** `docs/evidence/outreach-staging-verification/scripts/harness.mjs`
  re-implements only the *sequencing* of `index.ts`'s `send_message`
  (claim insert -> transport call -> interpret -> evidence write ->
  claim resolution). Every decision function it calls --
  `classifyExistingClaim`, `isUniqueViolation`, `interpretGmailSendResponse`,
  `insertEvidenceIdempotent`, `updateClaimConditional`, `decideReconciliation`
  -- is imported **unmodified** from the real
  `supabase/functions/outreach-gmail/contract.mjs`, the exact file
  `index.ts` itself imports and Phase 11B/11C/11D's own test suite
  already unit-tests. The one substitution is the injected `transport`
  function replacing `getFreshAccessToken()` + the real Gmail `fetch()`.

## 2. Results, T1-T7

All scripts, raw output, and timestamps are retained in
`docs/evidence/outreach-staging-verification/` (one `evidence-T*.json`
per test, plus `evidence-schema.json` and `evidence-cleanup.json`).

| Test | What ran | Result |
|---|---|---|
| **T1** Concurrent claim attempts | (a) 10 concurrent raw `INSERT`s into `outreach_message_send_claims` with an identical `idempotency_key`, direct to real Postgres via PostgREST. (b) 10 concurrent full `sendMessageHarness` calls with an identical `confirmationId`, fake transport with a call counter. | **PASS.** (a) Exactly 1 insert succeeded, 9 failed with Postgres code `23505` (unique violation), exactly 1 row exists for the key. (b) Transport invoked **exactly once**; the other 9 concurrent callers correctly classified `ALREADY_SENT` (the winner resolved before the losers re-read); final claim `SENT`, exactly 1 evidence row. |
| **T2** Transaction rollback | Direct `pg` connection (session pooler): `BEGIN` -> insert a claim row -> force a check-constraint violation (`status = 'NOT_A_REAL_STATUS'`) in the same transaction -> catch -> `ROLLBACK`. | **PASS.** 0 rows for the key before, 0 rows after rollback -- the claim insert from the aborted transaction did not survive. A normal insert+commit immediately afterward on the same connection succeeded, confirming the rollback left the session/table healthy, not corrupted. |
| **T3** Same-key retry after claim uncertainty | Two sub-scenarios: the claim-insert's network response is simulated as lost (thrown exception) (a) before the insert ever reached Postgres, and (b) after it had already landed server-side. Both retried with the exact same `confirmationId`. | **PASS, both sub-scenarios.** (a) First attempt fails closed (`CLAIM_OUTCOME_UNKNOWN`, 0 transport calls); retry proceeds normally, exactly 1 transport call, resolves `SENT`. (b) First attempt fails closed identically; retry hits the real unique-violation, is refused `IN_PROGRESS` via `classifyExistingClaim`, **0 transport calls on the retry** -- the already-landed claim is never silently re-sent. |
| **T4** Transport failure vs. ambiguous outcome | (a) Transport returns a real, completed negative response (HTTP 400). (b) Transport call throws (simulated timeout); same-key retry attempted with a transport that *would* succeed if reached. | **PASS, both.** (a) Claim resolves `FAILED` with the real error message, exactly 1 transport call, 0 evidence rows. (b) Claim resolves `UNKNOWN`; the same-key retry is refused `NEEDS_RECONCILIATION` **without ever invoking its own (would-succeed) transport** -- total transport calls across attempt+retry = 1, not 2. The ambiguous outcome did not become permission to resend. |
| **T5** Evidence persistence failure | Transport succeeds (definite Gmail acceptance simulated), then the evidence-table insert is forced to fail with a real, structured (non-exception, non-duplicate-key) error. | **PASS.** Harness reports `EVIDENCE_PERSISTENCE_FAILED`, never `ok:true`; claim resolves `UNKNOWN` with the real fake-provider-id preserved; 0 evidence rows (no silent success). The unresolved state was then **identified** by a direct, reproducible query (`status='UNKNOWN' AND provider_message_id IS NOT NULL`) and **reconciled** using the real `decideReconciliation`/`updateClaimConditional`/`insertEvidenceIdempotent` functions against the real client -- claim -> `SENT`, exactly 1 evidence row, no second transport call anywhere in the sequence. |
| **T6** End-to-end staging send | One complete workflow: synthetic contact, the RFC-2606 test recipient, the isolated fake transport, no injected faults, run only after T1-T5 passed. | **PASS.** Transport invoked exactly once; harness `ok:true`; claim `SENT` with `provider_message_id` matching the harness result exactly; evidence row `SENT`/`GMAIL` with the same provider id and the test recipient address; `outreach_send_claim_inconsistencies` shows **0** rows for this key (fully converged, nothing to reconcile). Full identifiers in `evidence-t6.json`. |
| **T7** Recovery and regression | `node test/election-outreach-gmail-function.consumer.mjs`, `node test/election-outreach-gmail-recovery-proof.consumer.mjs`, full `npm test` (the complete registered suite), `npm run build`. | **PASS.** 125/125 and 55/55 assertions respectively (unchanged counts/content from `OUTREACH-FINAL-READINESS.md` -- no source file in this workstream was modified this round). Full `npm test`: exit 0, zero `FAIL`/`not ok`/`AssertionError` lines across the entire registered suite. `npm run build`: exit 0, 279 modules transformed, same as the prior closure document. |

Staging was restored to a clean baseline after testing: all synthetic
claims, events, and the one synthetic contact were deleted
(`evidence-cleanup.json` -- 9 claim rows, 4 event rows, 1 contact row
removed; post-cleanup counts all 0). The schema/migrations remain
applied (that part of the "pre-test state" is the migrated-but-empty
database the project started in, by design -- re-applying is a no-op
per the migration's own `if not exists`/`or replace` guards).

## 3. Safety properties now verified against a real database

Every property `OUTREACH-FINAL-READINESS.md` §3 already claimed from
mocked/in-memory tests is now **also** demonstrated against real
Postgres, closing §5's named gap for the claim/evidence layer
specifically:

- At most one real transport invocation per idempotency key, under
  genuine concurrent Postgres writes (T1).
- A transaction that fails partway leaves no partial state (T2).
- A claim-insert failure whose outcome is unknown fails closed and a
  same-key retry resolves safely in both directions -- fresh attempt or
  already-landed (T3).
- A transport failure and a transport ambiguity are never conflated; an
  ambiguous outcome never licenses a same-key resend (T4).
- A failed evidence write is never silently reported as success, and the
  resulting unresolved state is both identifiable by a direct query and
  mechanically reconcilable without any second send (T5).
- A complete, fault-free send correlates cleanly end-to-end: one
  transport call, one claim, one evidence row, zero inconsistencies (T6).

## 4. Defects found

**None that block this milestone.** One cosmetic, non-blocking
observation, newly noticed this round:

- `claimed_at` (set by Postgres `default now()` at INSERT time) and
  `resolved_at`/`updated_at` (set by the calling code as
  `new Date().toISOString()`, i.e. the caller's own clock) in
  `outreach_message_send_claims` come from two different clocks. Across
  real network calls in `evidence-t6.json`, `resolved_at` was observed
  slightly *earlier* than `claimed_at` for the same row -- not a logic
  error (nothing in the claim/evidence atomicity guarantees compares
  these two columns against each other; the unique index and the
  conditional `UPDATE`'s matched-row-count are the actual guards, both
  verified correct in §2-3), but worth knowing if these columns are ever
  used for duration/latency reporting. Same disposition as the two
  previously-disclosed cosmetic items in `OUTREACH-FINAL-READINESS.md`
  §4: documented, not fixed, not a release blocker, no code changed.

Neither Policy A (`NOT_SENT` evidence) nor Policy B (`FAILED -> SENT`)
was reopened -- T4/T5 re-confirm both exactly as ratified.

## 5. What this milestone does NOT verify (disclosed, not hidden)

Per the explicit choice to use an isolated fake transport rather than
configure real Gmail OAuth this round:

- **No real Gmail API call was ever made** -- not `oauth2.googleapis.com/token`,
  not `gmail.googleapis.com/.../messages/send`, not a real OAuth
  consent flow. `interpretGmailSendResponse()` (the pure function that
  parses whatever a real Gmail response would be) is exercised with
  synthetic status/body shapes, exactly as Phase 11D's own test suite
  already does -- this adds nothing new on that front.
- **The real deployed `outreach-gmail` Edge Function was never invoked**
  over HTTP in this milestone -- it was not deployed to staging. Every
  test above runs the same decision logic that function imports, but via
  this harness's own orchestration under plain Node, not via a live Deno
  Edge Function request.
- These are exactly items 3-4 of `OUTREACH-FINAL-READINESS.md` §7's
  ordered list ("Configure Gmail OAuth on a non-production account,"
  "Deploy `outreach-gmail` to staging... re-run against the real
  deployed function") -- **still not done**, by explicit instruction,
  not by inability discovered this round. Items 1-2 of that same list
  ("a real Postgres connection," "apply the migration... re-run the
  live-concurrency scenarios") **are** now done, which is this
  milestone's actual contribution.

## 6. Restore / rollback procedure (documented per the brief's §8)

- **Staging data:** `docs/evidence/outreach-staging-verification/scripts/cleanup.mjs`
  deletes every row from `outreach_message_events` and
  `outreach_message_send_claims`, and the one synthetic contact, in
  FK-safe order. Already run once (see §2); safe to re-run (idempotent,
  deletes by exact match / unconditional-but-empty-result).
- **Staging schema:** every statement in every applied migration is
  `create table if not exists` / `create or replace view` -- re-running
  `supabase db push` against this same project is a safe no-op. There is
  no down-migration; if the project itself is kept, its *data* is the
  only mutable state, and §2's cleanup already restored that to empty.
- **Staging project itself:** not deleted by this session. It is a
  genuinely separate, free-tier-eligible Supabase project
  (`dvehncqtaqtxqptxxulp`) with no production credentials or data in it
  at any point. Deleting it (`supabase projects delete
  dvehncqtaqtxqptxxulp` via the dashboard or API) is a one-way action
  this document deliberately leaves to an explicit, separate decision --
  see §7.
- **Production:** untouched throughout -- no migration applied, no
  function deployed, no secret set, no connection made to
  `lncwkjlgakonokwboxdp` at any point in this milestone.

## 7. Open operational decision (not a release-blocker, just undecided)

The staging project created for this milestone is left running. Keeping
it is useful groundwork for §5's still-open items (3-4) -- deploying
`outreach-gmail` there and connecting a real, non-production Gmail test
account would reuse this exact project rather than provisioning a new
one. Deleting it is equally reasonable if no near-term follow-up is
planned. Either way is a deliberate, separate decision for whoever picks
up item 3 of the prior readiness document's §7 next -- not something
this document resolves unilaterally.

## 8. Final decision

**VERIFIED FOR PRODUCTION REVIEW.**

Every mandatory test (T1-T7) executed and passed, against a genuinely
separate staging Supabase project with real applied PostgreSQL
constraints -- not a mock, not an assumption, not a relabeled unit test.
The specific gap `OUTREACH-FINAL-READINESS.md` named as unverifiable
locally -- real concurrent Postgres writes against the claim table's
unique index and conditional `UPDATE`, and a real transaction
rollback -- is now closed with reproducible evidence
(`docs/evidence/outreach-staging-verification/`). No tested failure path
produced an unsafe duplicate-send authorization; no acceptance criterion
in the brief's §6 is unmet; no release-blocking defect exists.

This decision is scoped honestly: it covers the **claim/evidence
persistence layer** against real Postgres, using an explicitly-disclosed
isolated fake transport in place of real Gmail (§5). It does **not**
cover a real Gmail OAuth connection or the actual deployed Edge
Function, and it is **not** itself authorization to send anything in
production -- exactly as the brief's §10 states. The next concrete,
already-named step (whoever is ready to do it) is
`OUTREACH-FINAL-READINESS.md` §7 item 3: configure Gmail OAuth on a
non-production account, which only a human with Google Cloud Console
access can do.

**No further phase, plan, or audit cycle is opened by this document.**
A new one requires a specific failed acceptance criterion or a newly
demonstrated defect -- neither exists here.
