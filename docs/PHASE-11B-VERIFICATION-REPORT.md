# Phase 11B — Verification Report

> **Superseded in part by Phase 11C.** The two "left outstanding by
> instruction" items in §2 below (`NOT_SENT` evidence requirement, `FAILED
> → SENT` policy) were both explicitly decided in Phase 11C -- see
> `docs/PHASE-11C-VERIFICATION-REPORT.md`. This document is left as-written.

Date: 2026-10-14. Scope: findings **New-2** and **New-3** from the Phase 11 Final Read-Only Verification Report. Local source/test changes only — nothing committed, staged, pushed, deployed, migrated, or sent. See `docs/PHASE-11B-SEND-RECOVERY-DESIGN.md` for the full design and its stated trade-offs.

## 1. Findings addressed

| ID | Finding | Status |
|---|---|---|
| New-2 | Concurrent `reconcile_send_claim` calls race; a failed evidence insert could be silently ignored, producing a misleading `{ok:true}` | **Addressed** — `decideReconciliation()` + conditional updates with checked results; see design doc §4 |
| New-3 | Post-Gmail-success claim-update/evidence-insert errors unchecked; caller could see success with an incomplete ledger | **Addressed** — evidence-first ordering + `insertEvidenceIdempotent`/`updateClaimConditional`, both fully checked; see design doc §3 |
| H-1 (prior fix) | Atomic send-claim insertion | **Preserved, re-verified** — unchanged insert-before-fetch structure; confirmed by source inspection (test section M-1) |
| M-2 (prior fix) | Sender-identity verification must not clobber an unrelated identity | **Preserved, re-verified, untouched by this phase's edits** — confirmed by source inspection (test section N) and unchanged `shouldUpdateSendAsState` |

## 2. Findings explicitly left outstanding (by instruction, not oversight)

- **`NOT_SENT` evidence requirement** — unchanged. See design doc §7: a recommendation (mandatory note) is recorded, not implemented, pending authorization.
- **`FAILED` → `SENT` reconciliation** — unchanged. See design doc §8: three framings and a recommendation (a distinct, explicitly-flagged override action) are recorded, not implemented, pending authorization.
- **No PL/pgSQL RPC / cross-table transaction** — by design (see design doc §1). The residual risk (two independent writes, not one transaction) is stated explicitly in design doc §9, not hidden.

## 3. Implementation summary

**New, untracked (never committed in any prior phase):**
- `supabase/functions/outreach-gmail/contract.mjs` — added `classifyExistingClaim`'s evidence-aware third parameter, `isUniqueViolation`, `decideReconciliation`, `insertEvidenceIdempotent`, `updateClaimConditional`.
- `supabase/functions/outreach-gmail/index.ts` — `send_message` rewritten for evidence-first ordering with checked writes throughout; `reconcile_send_claim` rewritten around `decideReconciliation()` with conditional, checked updates and lost-race re-reads.
- `supabase/migrations/20261014000000_election_outreach_message_activity.sql` — added `outreach_send_claim_inconsistencies` (read-only diagnostic view, owner-queried only, same posture as the pre-existing `launch_analytics_daily`). **No table schema changed** — `outreach_message_send_claims`/`outreach_message_events` are untouched structurally; this phase added behavior, not new columns.
- `test/election-outreach-gmail-function.consumer.mjs` — rewritten/extended sections J (evidence-aware classification), new K2 (`isUniqueViolation`), K3 (`decideReconciliation`, 10 tests), K4 (12 **mocked-client behavioral** tests for the two persistence helpers), M (updated for the new ordering), new O (reconcile_send_claim's full rewrite).

**Modified (pre-existing Phase 11 files, one line each):**
- `test/election-outreach-launch-separation.consumer.mjs` — one new assertion confirming the new view is never granted to `anon`/`authenticated`.

**Untouched by this phase:** `src/domains/outreach/messageActivity.js`, `src/domains/outreach/write.js` — both inspected (per the brief's explicit instruction) and found to need no change. `messageActivity.js`'s `matchReplyToContact`/reply-sync logic is unrelated to `send_message`/`reconcile_send_claim`. `write.js`'s `sendOutreachGmailMessage`/`getGmailConnectionStatus` wrappers already forward `{ok, error}` generically and required no change — the new response codes (`EVIDENCE_PERSISTENCE_FAILED`, `RECONCILE_OUTCOME_UNKNOWN`, etc.) surface through the existing generic error path without any wrapper change. `outreach-admin`'s separate `record_message_event` action (a different, pre-existing check-then-insert pattern, already self-documented as benign since it never calls an external provider) is unrelated to New-2/New-3 and was not touched.

## 4. Tests executed — exact commands, counts, results

All commands run from the repository root, read-only (no file writes outside the process's own stdout/exit code):

```
node test/election-outreach-gmail-function.consumer.mjs        -> 116/116 assertions passed
node test/election-outreach-launch-separation.consumer.mjs     -> 47/47 assertions passed
node test/election-outreach-admin-function.consumer.mjs        -> 80/80 assertions passed
node test/election-outreach-model.consumer.mjs                 -> 41/41 assertions passed
node test/election-outreach-message-activity.consumer.mjs      -> 39/39 assertions passed
node test/election-outreach-composer.consumer.mjs              -> 34/34 assertions passed
node test/election-outreach-control-room.consumer.mjs          -> 49/49 assertions passed
node test/election-outreach-followup.consumer.mjs               -> 21/21 assertions passed
node test/election-outreach-assets.consumer.mjs                 -> 20/20 assertions passed
node test/election-outreach-import.consumer.mjs                 -> 39/39 assertions passed
node test/election-outreach-learning.consumer.mjs               -> 14/14 assertions passed
```

**Total: 500/500 assertions passed, 0 failures**, across 11 focused suites. `npm run build` was **not** run this phase (it writes `dist/*`, outside this task's "local source edits and local tests" authorization, and nothing in this phase touches build-affecting code — no `.jsx`/React files were changed).

## 5. Distinguishing test kinds (as required)

| Kind | What it proves | Where |
|---|---|---|
| **Pure behavioral** (real function, real inputs, real asserted outputs, no I/O) | `classifyExistingClaim`, `isUniqueViolation`, `decideReconciliation`, `shouldUpdateSendAsState`, plus the pre-existing `interpretGmailSendResponse`/`buildRawMimeMessage`/`parseSendAsVerification`/`validateSendMessageRequest`/`validateReconcileSendClaimRequest` | Sections J, K, K2, K3, L |
| **Mocked integration** (a hand-built fake Supabase client exercising the ACTUAL `insertEvidenceIdempotent`/`updateClaimConditional` functions — real retry loops, real branch logic — against scripted fake responses, including thrown exceptions) | Confirms the retry-once-on-exception, duplicate-key-is-success, and conditional-filter-selection logic genuinely executes as designed. **Does not** prove a real Postgres unique index or conditional `WHERE` clause behaves this way — only that this code's *own* logic correctly reacts to the shapes a real client *would* return. | Section K4 |
| **Source-pattern / regex scan** (confirms the real logic is *wired into* the Deno transport file's actual control flow, in the right order, since that file cannot be executed/imported under plain Node) | Sections I, M, N, O |
| **Live database / live Deno runtime / true concurrency** | **Not performed anywhere in this phase.** No Docker, no `psql`, no direct Postgres connection, and no Deno execution are available in this environment (confirmed repeatedly across this project's audits). Every claim about actual concurrent-request behavior against a real unique index, and every claim about the SQL in the new view actually parsing/executing, rests on (a) code structure confirmed by reading and (b) well-documented Postgres/`supabase-js` semantics — never on this session having run it. | — |

This phase deliberately maximized the first and second categories (moving `insertEvidenceIdempotent`/`updateClaimConditional` out of the Deno-only `index.ts` into the plain-JS `contract.mjs` specifically to make this possible) rather than relying on the fourth category being presented as proof it is not.

## 6. Remaining product decisions (unresolved, by instruction)

1. Whether `NOT_SENT` reconciliation should require a mandatory note (design doc §7).
2. Whether `FAILED` → `SENT` reconciliation should remain as-is, be blocked entirely, or become a distinct, explicitly-flagged override action (design doc §8).
3. Whether to eventually replace the recovery-based design with a real transactional RPC once this environment (or a future session) has genuine Postgres access to validate one.

## 7. Migration and deployment status (confirmed this pass, read-only, no changes made)

- `supabase migration list --project-ref lncwkjlgakonokwboxdp`: `20261014000000` shows `"remote": ""` — **confirmed still unapplied.**
- `supabase functions list --project-ref lncwkjlgakonokwboxdp`: `outreach-gmail` **absent** from the live function list; `outreach-admin` still at `v5` (predates even Phase 11's own additions); `launch-send-campaign-email` still at `v9`. **Confirmed nothing from Phase 11 or 11B is deployed.**
- No secret was read, set, or printed. No OAuth credential exists or was configured. No email was sent.

## 8. File-change manifest

**Phase 11B (this task):**
- `supabase/functions/outreach-gmail/contract.mjs` — modified (new)
- `supabase/functions/outreach-gmail/index.ts` — modified (new)
- `supabase/migrations/20261014000000_election_outreach_message_activity.sql` — modified (new, one view added)
- `test/election-outreach-gmail-function.consumer.mjs` — modified (new)
- `test/election-outreach-launch-separation.consumer.mjs` — modified (one assertion added)
- `docs/PHASE-11B-SEND-RECOVERY-DESIGN.md` — created
- `docs/PHASE-11B-VERIFICATION-REPORT.md` — created

**Pre-existing Phase 11 work, confirmed untouched by this task** (re-verified via `git diff --stat` showing zero change to these paths in this session): `src/domains/launch/write.js`, `src/domains/outreach/model.js`, `src/domains/outreach/write.js`, `src/domains/outreach/messageActivity.js`, `src/pages/outreach/OutreachControlRoom.jsx`, `supabase/functions/launch-send-campaign-email/index.ts`, `supabase/functions/outreach-admin/{contract.mjs,index.ts}`, `test/election-outreach-{admin-function,control-room,learning,model,message-activity,composer}.consumer.mjs`, `docs/OUTREACH-GMAIL-SETUP.md`.

**Confirmed untouched, all other workstreams** (multilingual, media-preview, demo, candidate-research, historical-import/recovery-tooling, `launch-invite-audience`, and the pre-existing mixed `package.json` line): verified via a filtered `git status` pass this session showing zero new changes outside the Phase 11B list above.

## 9. Acceptance criteria — self-assessment against §8 of the brief

| Criterion | Met? |
|---|---|
| New-2 and New-3 addressed in code, covered by meaningful tests | Yes — see §1, §4, §5 |
| No confirmed Gmail success silently represented as complete when persistence failed | Yes — evidence-first ordering; a failed evidence insert is reported `EVIDENCE_PERSISTENCE_FAILED`, never `ok:true` |
| Recovery does not trigger an unguarded duplicate send | Yes — no code path calls Gmail twice for the same key; `UNKNOWN`/`FAILED`/ambiguous outcomes all refuse rather than retry the external call |
| Concurrent reconciliation cannot create contradictory outcomes or falsely report completion | Yes, **to the extent verifiable without a live database** — conditional updates + re-read-on-loss logic is correct by inspection and mocked-client testing; true concurrent execution is not verified (see §5's last row) |
| Provider message identity and contact/followup associations preserved | Yes — every evidence insert in `reconcile_send_claim` binds to `claim.contact_id`/`claim.followup_id`, never a caller-supplied id (test O-9) |
| H-1 and M-2 remain intact | Yes — unchanged logic, re-confirmed by source inspection (sections M-1, N) |
| Focused tests pass | Yes — 500/500 |
| Final diff is scoped and reviewed | Yes — §8, and the filtered `git status` pass |
| Limitations of untested live integration/concurrency disclosed | Yes — design doc §9, this report §5 |

**No production-readiness or live-integration-success claim is made.** Gmail OAuth remains unconfigured, the migration remains unapplied, and `outreach-gmail` remains undeployed, all reconfirmed live and read-only this pass. **Phase 11B is VERIFIED LOCALLY** under the above self-assessment; it is not, and does not claim to be, verified in a live Postgres or Deno environment.
