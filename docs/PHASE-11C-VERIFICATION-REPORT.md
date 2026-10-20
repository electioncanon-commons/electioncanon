# Phase 11C — Verification Report

Date: 2026-10-14. Scope: implement and verify the two approved policy
decisions (Policy A — `NOT_SENT` requires definitive provider evidence;
Policy B — `FAILED → SENT` ratified as-is) left open by
`docs/PHASE-11B-SEND-RECOVERY-DESIGN.md` §7/§8. See
`docs/PHASE-11C-POLICY-IMPLEMENTATION.md` for the full design and exact
code diff description. **Stops at the live-verification preflight** --
no production migration, deployment, or email send was performed or
attempted.

## 1. Files changed

| File | Change |
|---|---|
| `supabase/functions/outreach-gmail/contract.mjs` | Added `MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH`/`MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH`; `validateReconcileSendClaimRequest` now requires `providerEvidence` (bounded) for `outcome: "NOT_SENT"`; both constants added to the default export. |
| `supabase/functions/outreach-gmail/index.ts` | `reconcile_send_claim`'s header comment documents Policies A/B; `RESOLVE_NOT_SENT`'s `updateClaimConditional` call now persists `validation.providerEvidence` into the claim's `error` column. |
| `test/election-outreach-gmail-function.consumer.mjs` | Section K extended (6 new assertions: missing/empty/too-short/too-long/valid/ignored-for-SENT `providerEvidence`); K3 extended (1 new assertion: `NOT_SENT` with no claim at all → `NOT_FOUND`; test 10's description updated to reflect Policy B's ratification, no logic change); Section O extended (2 new assertions: `providerEvidence` persistence wiring, and `REPAIR_MISSING_EVIDENCE` never calling `updateClaimConditional`). |
| `docs/PHASE-11C-POLICY-IMPLEMENTATION.md` | Created. |
| `docs/PHASE-11C-VERIFICATION-REPORT.md` | Created (this file). |

**Not changed:** `decideReconciliation`, `classifyExistingClaim`,
`insertEvidenceIdempotent`, `updateClaimConditional`, every `send_message`
code path, the migration, `src/domains/outreach/write.js` (no frontend
wrapper exists for `reconcile_send_claim` -- it is operator-invoked
directly against the Edge Function, confirmed by a repo-wide grep finding
no other caller), and every other Phase 11/11B file.

## 2. Exact implementation of Policy A and Policy B

**Policy A** -- `validateReconcileSendClaimRequest` (`contract.mjs`):
an `outcome: "NOT_SENT"` request is refused (`BAD_REQUEST`) unless
`providerEvidence` is a string whose trimmed length is between 15 and 500
characters. The validated, trimmed value is threaded through to
`index.ts`'s `RESOLVE_NOT_SENT` branch and written directly into
`outreach_message_send_claims.error` alongside the existing
`resolved_at` timestamp -- durably recorded, timestamp preserved,
evidence-text-required, exactly as specified. An ambiguous/uncertain
outcome has no path to `NOT_SENT`: the automated `send_message` path
already only ever marks `FAILED` on a real, completed, non-2xx-or-invalid
Gmail HTTP response (never on a thrown/timeout exception, which is
`UNKNOWN`), and the manual path now requires the same rigor from a human
operator, enforced as a mandatory, bounded evidence field.

**Policy B** -- unchanged code, newly ratified as explicit policy:
`decideReconciliation` allows `RESOLVE_SENT`/`REPAIR_MISSING_EVIDENCE` from
a `FAILED` claim exactly as it did before, strictly gated on
`validateReconcileSendClaimRequest`'s pre-existing, unmodified requirement
that `outcome: "SENT"` always carry a real, non-empty `providerMessageId`.
No fabrication path exists; none was added.

## 3. Focused and full-suite test results

```
node test/election-outreach-gmail-function.consumer.mjs        -> 124/124 assertions passed
node test/election-outreach-launch-separation.consumer.mjs     -> 47/47 assertions passed
node test/election-outreach-admin-function.consumer.mjs        -> 80/80 assertions passed
node test/election-outreach-model.consumer.mjs                 -> 41/41 assertions passed
node test/election-outreach-control-room.consumer.mjs          -> 49/49 assertions passed
```

(124 = 116 from Phase 11B + 8 new this phase: 6 in section K, 1 in K3, 2 in
O minus none removed.)

Full regression (`npm test`, the repo's complete manually-registered chain
of 84 consumer-test files): **exit code 0, zero `FAIL` lines across the
entire run.** Includes every multilingual, geography, launch, outreach,
demo-workspace, and core election suite -- not just the outreach-gmail
surface this phase touched.

## 4. Build result

`npm run build` (`vite build`): **succeeded**, 279 modules transformed, exit
0. Pre-existing warning about one chunk exceeding 500kB (unrelated to this
phase -- that chunk's composition was not touched; Edge Function files
under `supabase/functions/` are Deno-targeted and are not part of the Vite
build graph at all). No new warnings or errors introduced.

## 5. Migration/schema preflight findings

See `docs/PHASE-11C-POLICY-IMPLEMENTATION.md` §4 for the full review. In
summary: **no migration was created or needed.** The existing, still-unapplied
`20261014000000_election_outreach_message_activity.sql` already has every
constraint, index, and access-control posture this phase's change needs
(`outreach_message_send_claims.error`, `char_length <= 2000`, zero client
RLS policies, service-role-only access via the Edge Function). One
pre-existing, narrow gap was found and disclosed (not fixed, out of this
phase's authorized scope): `note` has no length bound, so an extreme `note`
combined with the new `providerEvidence` could in theory exceed the 2000-char
column limit and surface as a misleadingly-worded "concurrent reconciliation"
error rather than a clear constraint-violation message. This is a
pre-existing `index.ts` error-framing issue (Phase 11B's `!claimUpdate.ok`
branch), not a new defect introduced here, and does not affect correctness
(a genuine error is still reported `ok:false`, never silently treated as
success) -- only the wording a human operator would see.

Confirmed, read-only, this pass (same checks Phase 11B's own report ran):
migration `20261014000000` remains unapplied; `outreach-gmail` remains
undeployed; no secret was read, set, or printed; no OAuth credential exists
or was configured; no email was sent.

## 6. Live verification that remains outstanding

**Nothing in this phase was executed against a live Postgres instance, a
live Deno runtime, or the real Gmail API.** This environment has no Docker,
no `psql`, no direct Postgres connection string, and no Deno execution
available (same constraint Phase 11B documented repeatedly). Every claim
above is backed by: pure behavioral tests of `contract.mjs`'s real,
executed functions (Node, no I/O); mocked-client integration tests of
`insertEvidenceIdempotent`/`updateClaimConditional` against a hand-built
fake Supabase client (Phase 11B's K4 section, unmodified and re-passing);
and source-pattern scans confirming the real logic is wired into
`index.ts`'s actual control flow in the right order, since that file
cannot be imported/executed under plain Node.

### Controlled live-verification plan (write-up only -- NOT executed)

To be run only once Docker/`psql`/a real Supabase project with this
migration applied is available, and only under separate authorization:

1. **Duplicate claims.** Apply the migration to a disposable Postgres
   instance. Call `send_message`-equivalent logic twice with the identical
   `idempotencyKey` sequentially; confirm the second call's `INSERT` into
   `outreach_message_send_claims` genuinely raises a unique-violation
   (23505), not merely that the mock simulates one.
2. **Concurrent requests.** Fire two `send_message` requests with the same
   idempotency key truly concurrently (e.g. `Promise.all` against a real
   endpoint, or two parallel `psql` sessions issuing the same `INSERT`).
   Confirm exactly one wins the claim insert and the other observes the
   unique-violation path -- not that both proceed.
3. **Provider success followed by evidence-write failure.** With a real
   Postgres connection, simulate an `outreach_message_events` insert
   failure immediately after a (mocked or sandboxed) successful Gmail
   response -- e.g. temporarily drop/rename a required column, or revoke
   insert privilege for the test role -- and confirm the claim lands at
   `UNKNOWN` with the real provider id preserved, never `SENT` or `FAILED`.
4. **Missing-evidence repair.** Manually craft a claim row at `status =
   'SENT'` with a `provider_message_id` and no corresponding
   `outreach_message_events` row (reproducing the historical New-3
   symptom), then call `reconcile_send_claim` with the exact matching id
   and confirm `REPAIR_MISSING_EVIDENCE` inserts exactly one evidence row
   and the claim is untouched.
5. **NOT_SENT with and without evidence (Policy A, this phase's addition).**
   Against a real claim at `UNKNOWN`, confirm a `reconcile_send_claim`
   call with `outcome: "NOT_SENT"` and no (or too-short) `providerEvidence`
   is refused `BAD_REQUEST` before any write occurs, and that a call with
   valid `providerEvidence` resolves the claim to `FAILED` with that text
   durably present in `error`.
6. **Rollback/recovery.** Confirm the whole sequence (steps 1-5) is
   repeatable from a clean migration apply/rollback cycle on the disposable
   instance -- i.e. the migration itself is idempotent-safe to apply twice
   (`create table if not exists` / `create or replace view`, already true
   by inspection) and that no live data was touched in the process.

None of the above has been run. This report makes no claim that it has.

## 7. Known failure modes and recovery procedure

- **`EVIDENCE_PERSISTENCE_FAILED`** (send_message): Gmail accepted the
  message but the evidence row could not be written. Recovery: the real
  provider id is preserved on the claim (status `UNKNOWN`); an operator
  checks the Sent folder, confirms the id, and calls `reconcile_send_claim`
  with `outcome: "SENT"` and that same id -- `REPAIR_MISSING_EVIDENCE`
  inserts the missing row without resending.
- **`RECONCILE_OUTCOME_UNKNOWN`**: the reconciliation write itself didn't
  complete (thrown exception, both retries exhausted). Recovery: re-check
  the claim's current status before retrying the same reconciliation call
  -- never assume it failed outright.
- **`CONFLICT`** on `reconcile_send_claim`: either real evidence already
  exists with a different id than asserted, or a concurrent reconciliation
  already won. Recovery: re-read the claim/evidence state (the response
  includes what actually won) and decide manually; never retry blindly.
- **A constraint-violation on the claim `UPDATE`** (e.g. an oversized
  `note` pushing `error` past 2000 chars, see §5): currently surfaces as a
  `CONFLICT` with "a concurrent reconciliation already resolved this
  claim," which is misleading for this specific cause. Recovery: if this
  is seen with no plausible concurrent actor, shorten `note` and retry
  rather than assuming a race occurred. (Flagged for a future, separately
  authorized fix -- see implementation doc §4.)
- **A claim stuck at `CLAIMED` past its lease with no reconciliation**:
  self-heals (lazy expiry) the next time any request touches the same
  idempotency key; no cron or manual action is required to detect it, only
  to resolve it once `NEEDS_RECONCILIATION`/`UNKNOWN` is reported.

## 8. Exact next authorized action

Per the brief: **stop here.** The next action requires separate,
explicit authorization and is one of:
- Apply migration `20261014000000` to a real (disposable or staging)
  Postgres instance and execute the live-verification plan in §6.
- Deploy `outreach-gmail` (currently undeployed; `outreach-admin` remains
  at `v5`, `launch-send-campaign-email` at `v9`, both unaffected by this
  phase).
- Configure Gmail OAuth per `docs/OUTREACH-GMAIL-SETUP.md` and send a real
  test message.

No migration, deployment, or send has been performed in this phase.

---

`PHASE 11C IMPLEMENTATION: PASS`

`PRODUCTION MIGRATION: NOT APPLIED`

`DEPLOYMENT: NOT PERFORMED`

`EMAIL SENDING: NOT PERFORMED`
