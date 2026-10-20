# Phase 11D — Verification Report

Date: 2026-10-14. Scope: reproducible evidence that the outreach Gmail
send-recovery subsystem (Phase 11/11B/11C) safely handles duplicate
claims, concurrent reconciliation, post-send persistence failures,
missing evidence, ambiguous outcomes, identity conflicts, and recovery.
See `docs/PHASE-11D-VERIFICATION-PLAN.md` for the plan this report
executes (itself a reuse, not a replacement, of
`docs/PHASE-11C-VERIFICATION-REPORT.md` §6). Does not rewrite Phase 11B
or 11C's conclusions.

## 0. Phase 11C working-tree state, independently reconfirmed this phase

Per instruction, the prior phase's reported results were re-executed
fresh, not assumed:

```
node test/election-outreach-gmail-function.consumer.mjs
-> 124/124 assertions passed   (reconfirmed, matches 11C's report exactly)

npm test
-> exit 0, 0 "FAIL" lines across the full chain          (reconfirmed)

npm run build
-> vite build succeeded, 279 modules transformed, exit 0 (reconfirmed)
```

One small correction to Phase 11C's own report: it stated "84" manually
registered test files; `package.json`'s `scripts.test` chain actually
contains **85** `node test/...` invocations (counted programmatically
this phase: `cmd.split("&&").filter(s => s.trim().startsWith("node")).length === 85`
before this phase's own addition). This is a minor miscount in 11C's
prose, not a functional discrepancy -- the full chain itself was,
and still is, green. Not corrected retroactively in the 11C document
(see Phase 11B/11C's own "left as-written" precedent); recorded here
instead.

`git status`/`git log` were also reconfirmed at the start of this phase:
branch `main`, HEAD `797fefe`, and every Phase 11/11B/11C file (contract.mjs,
index.ts, the migration, the gmail-function test, both pairs of docs)
still untracked (`??`), never staged or committed -- matching every prior
phase's "local only" claim.

## 1. Environment capability check (commands and raw results)

```
$ which docker / psql / deno / supabase
-> none found on PATH (docker, psql, deno all absent; supabase resolves
   only via `npx --no-install supabase`, from npm's cache, not installed
   as a project or global dependency)

$ docker info
-> bash: docker: command not found

$ npx --no-install supabase db start
-> {"_tag":"Error","error":{"code":"LocalDbRunningError","message":"failed to inspect service"}}

$ npx --no-install supabase status
-> {"linked_project":{"project_ref":"lncwkjlgakonokwboxdp", ...},
    "_tag":"Error","error":{"code":"StatusDbInspectError",
    "message":"failed to inspect container health: docker: command not
    found (podman also not found) — install Docker Desktop or Podman and
    ensure it is on PATH"}}

$ ls "/c/Program Files/Docker"*
-> No such file or directory (not just "not running" -- not installed)

$ npm ls -g --depth=0
-> @anthropic-ai/claude-code, vercel  (no supabase/pg/postgres tooling)

$ grep -i "pg|postgres|sqlite" node_modules (listing, not content)
-> only "@supabase" (the JS client library, not a database)
```

**Conclusion: confirmed, not assumed -- there is no live Postgres, no
Deno runtime, and no embeddable database library anywhere in this
environment.** This matches every one of Phase 11B's and 11C's repeated
claims; this phase re-derived it independently rather than trusting the
prior phases' prose.

Two READ-ONLY remote checks were also re-run (same calls Phase 11B/11C's
own reports document; no write, no migration apply, no deploy):

```
$ npx --no-install supabase migration list --project-ref lncwkjlgakonokwboxdp
-> ...,{"local":"20261014000000","remote":"","time":"2026-10-14 00:00:00"}
   (still unapplied -- reconfirmed)

$ npx --no-install supabase functions list --project-ref lncwkjlgakonokwboxdp
-> outreach-admin v5, launch-send-campaign-email v9, launch-invite-audience v4, ...
   ("outreach-gmail" absent from the list -- still undeployed, reconfirmed)
```

No secret was read, set, or printed by either command. No migration was
applied. No function was deployed.

## 2. Verification level actually available, and what was built to use it

Given §1, the strongest safe evidence achievable is a **deterministic
concurrency test against a real, shared, stateful in-memory store**, not
scripted sequential mocks alone (which Phase 11B's K4 section already
provides and this phase does not repeat). Built this phase:
`test/election-outreach-gmail-recovery-proof.consumer.mjs` -- a single
shared fake store with genuine uniqueness/conditional-match enforcement,
and a harness (`fakeSendMessage`/`fakeReconcileSendClaim`) that
reimplements `index.ts`'s exact orchestration while calling the REAL,
imported `contract.mjs` decision functions (`classifyExistingClaim`,
`interpretGmailSendResponse`, `decideReconciliation`,
`insertEvidenceIdempotent`, `updateClaimConditional`,
`validateReconcileSendClaimRequest`) for every decision.

**Interleaving fidelity was independently checked, not assumed.** A
throwaway diagnostic (`Promise.all` of two labeled async functions, each
logging before and after the same `setTimeout(...,0)` tick the fake
store uses) confirmed:

```
A:enter -> B:enter -> A:resume-after-tick -> B:resume-after-tick
```

Both callers reach the "about to check-and-write" point before either
one completes it -- proving the race is genuine (both are "in flight"
simultaneously), not an artifact of accidental sequential execution
dressed up as concurrent. This is exactly the race condition H-1/New-2
are designed to survive.

## 3. Scenario-by-scenario results

Setup/action/expected-invariant text lives in the test file's own section
headers (`console.log` blocks immediately preceding each scenario's
assertions) and in `docs/PHASE-11D-VERIFICATION-PLAN.md` §1; not repeated
here. Observed results:

| # | Scenario | Evidence type | Result |
|---|---|---|---|
| A | Atomic duplicate-send claims | **[DETERMINISTIC CONCURRENCY TEST]** | **PASS** (4/4) -- transport called exactly once across both racing requests; exactly one evidence row created |
| B | Concurrent reconciliation, conflicting outcomes | **[DETERMINISTIC CONCURRENCY TEST]** | **PASS** (4/4) -- exactly one terminal state wins; the loser's report never contradicts the real winning state |
| C | Gmail acceptance + claim-update failure | **[MOCKED FAULT-INJECTION]** | **PASS** (5/5) -- provider id recoverable from evidence; retry under the same key never calls transport again |
| D | Gmail acceptance + evidence-insert failure | **[MOCKED FAULT-INJECTION + HARNESS ORCHESTRATION repair]** | **PASS** (6/6) -- missing evidence detectable; repair succeeds via RESOLVE_SENT without a second transport call |
| D2 | `REPAIR_MISSING_EVIDENCE` specifically (New-3's historical shape) | **[HARNESS ORCHESTRATION]** | **PASS** (4/4) -- exactly one evidence row inserted; claim untouched; a redundant repair call is an idempotent no-op |
| D3 | Failed repair does not falsely mark SENT | **[MOCKED FAULT-INJECTION]** | **PASS** (3/3) -- refused, no fabricated evidence, pre-existing SENT status undisturbed |
| E | Process termination after provider acceptance | **[HARNESS ORCHESTRATION, simulated crash]** | **PASS** (3/3) -- later request never calls transport; routed to reconciliation as UNKNOWN, never silently NOT_SENT |
| F | Ambiguous database timeout on the initial claim insert | **[SOURCE INSPECTION]** | **PASS, with a disclosed finding** (2/2) -- confirmed the claim INSERT has no try/catch (unlike the Gmail fetch and the two helpers); documented as safe-by-construction (retry reuses the same unique-indexed key) but not exception-handled -- see §5 |
| G | Provider identity conflicts | **[DETERMINISTIC CONCURRENCY TEST + MOCKED FAULT-INJECTION]** | **PASS** (5/5) -- a different provider id and a NOT_SENT-over-real-evidence are both CONFLICT; original evidence (id + contact binding) unchanged; no contactId parameter exists for evidence to be rebound through at all |
| H | `NOT_SENT` policy (Policy A) end-to-end | **[HARNESS ORCHESTRATION]** | **PASS** (8/8) -- missing/whitespace/undersized/oversized evidence all refused before any write; valid evidence succeeds and is durably stored with its timestamp |
| I | `FAILED -> SENT` policy (Policy B) end-to-end | **[HARNESS ORCHESTRATION]** | **PASS** (4/4) -- refused without a real id; succeeds with one; never fabricated |
| J | Recovery and rollback | **[HARNESS ORCHESTRATION (partial) + SOURCE INSPECTION + BLOCKED (live)]** | **PARTIAL** (2/2 executable; 1 explicitly recorded BLOCKED) -- harness-level repair re-exercised end-to-end; migration confirmed idempotent-safe to reapply by inspection; true apply/corrupt/recover/rollback against a real instance NOT executed |

**Total: 53/53 assertions passed** in
`election-outreach-gmail-recovery-proof.consumer.mjs` (exit code 0).
Combined with the reconfirmed 124/124 in
`election-outreach-gmail-function.consumer.mjs` and the full `npm test`
chain (now 86 files, exit 0, 0 failures) and `npm run build` (exit 0):
**no regression, no failure, anywhere in this phase's changes.**

## 4. Evidence classification discipline

Every result above is labeled with its real evidence type, per the
taxonomy in the plan. Nothing in this report is described as a live
Postgres/Supabase or live-provider integration test -- those rows (§1)
are explicitly marked BLOCKED, with the exact missing prerequisite
(Docker/Podman) named. No source-pattern test is described as proof of
runtime behavior; where a source scan is the evidence (F, part of J), it
is labeled **[SOURCE INSPECTION]** and the report says exactly what it
does and does not prove.

## 5. Remaining defects and limitations (new this phase, beyond 11C's §4/§5)

- **Scenario F's finding:** the initial claim `INSERT` in
  `send_message` (`index.ts`) has no `try`/`catch` around it, unlike the
  Gmail `fetch()` call and unlike `insertEvidenceIdempotent`/
  `updateClaimConditional`. A thrown exception on this specific line
  (e.g. a genuine network timeout on the very first write of a request)
  currently propagates uncaught rather than producing a structured
  `SEND_OUTCOME_UNKNOWN`-style refusal. **This is disclosed, not fixed**
  (outside this phase's scope, which is verification, not further
  implementation) and is, by construction, **not a correctness defect**:
  because any retry must reuse the same `confirmationId` (hence the same
  idempotency key), a retry after this exception always re-attempts the
  identical unique-indexed insert -- it either lands fresh (nothing had
  actually been written) or hits the real unique-violation and is routed
  through the existing, already-tested `classifyExistingClaim` lost-race
  path. The only user-visible consequence is a less-informative error
  message on this one specific failure line. Recommended, not
  implemented: wrap this insert in the same bounded-retry pattern
  `insertEvidenceIdempotent` already uses, purely for a clearer error
  message -- left for separate authorization.
- **Everything disclosed in `docs/PHASE-11C-POLICY-IMPLEMENTATION.md` §4**
  (the unbounded `note` field, the misleading-on-a-constraint-violation
  "concurrent reconciliation" wording) remains true and unresolved; not
  re-tested or re-fixed this phase, only reconfirmed still present by
  reading the current file content (§0 above).
- **True concurrent-request behavior against a real Postgres unique index
  / conditional UPDATE, and a true migration apply/rollback cycle, remain
  unverified against a live database.** This phase substantially
  strengthens the evidence for the DECISION LOGIC under genuine JS-level
  concurrency (§2-3), but does not and cannot substitute for the live
  database test -- that distinction is deliberate and stated plainly, not
  blurred.

## 6. Live migration, deployment, OAuth, and email-sending status

Unchanged from Phase 11C, reconfirmed this phase (§1):
- Migration `20261014000000`: **not applied** (`remote: ""`).
- `outreach-gmail`: **not deployed** (absent from the live functions
  list). `outreach-admin` remains at v5, `launch-send-campaign-email` at
  v9 -- neither touched.
- Gmail OAuth: **not configured** (not attempted, not checked beyond what
  Phase 11B/11C already established -- no secret was read this phase).
- Email sending: **none performed, none attempted.** The only "sends" in
  this entire phase are calls to an in-process fake `transport` function
  that never leaves the Node process.

---

`PHASE 11D VERIFICATION: VERIFIED LOCALLY`

(for scenarios A, B, C, D, D2, D3, E, F, G, H, I as executed and passed
above, 53/53 assertions, via deterministic concurrency tests, mocked
fault-injection, harness orchestration tied to source-scan-verified real
code, and source inspection -- see §3's table for each scenario's exact
evidence classification)

`LIVE DATABASE VERIFICATION: NOT PERFORMED` (scenario A/B's real-Postgres
counterpart and scenario J's true rollback/recovery remain BLOCKED; exact
prerequisite: Docker or Podman installed and on PATH, per
`docs/PHASE-11D-VERIFICATION-PLAN.md` §4)

`PRODUCTION MIGRATION: NOT APPLIED`

`DEPLOYMENT: NOT PERFORMED`

`GMAIL OAUTH CONFIGURATION: NOT PERFORMED`

`EMAIL SENDING: NOT PERFORMED`

`GIT: NOTHING STAGED, COMMITTED, OR PUSHED THIS PHASE`
