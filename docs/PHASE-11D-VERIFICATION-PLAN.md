# Phase 11D — Controlled Verification Plan

Date: 2026-10-14. This plan **reuses** the live-verification plan already
written in `docs/PHASE-11C-VERIFICATION-REPORT.md` §6 -- it is not a
competing plan. §1 below maps this phase's ten lettered scenarios onto
that existing plan's six numbered items one-for-one. §2 records what
could actually be executed in this environment without one (strongest
safe tests), and §3 is the exact, reproducible procedure for the day a
real isolated Postgres instance is available.

## 1. Mapping: this phase's scenarios -> the existing Phase 11C plan

| Phase 11D scenario | Phase 11C plan item (§6) |
|---|---|
| A. Atomic duplicate-send claims | 1. Duplicate claims / 2. Concurrent requests |
| B. Concurrent reconciliation | (new refinement of 2, applied to `reconcile_send_claim` instead of `send_message`) |
| C. Gmail acceptance + claim-update failure | 3. Provider success followed by evidence-write failure (adjacent case: claim-update, not evidence-insert) |
| D. Gmail acceptance + evidence-insert failure | 3. Provider success followed by evidence-write failure |
| E. Process termination after acceptance | (new -- the "process killed outright" case the design doc's lease-expiry section names but 11C's plan did not separately enumerate) |
| F. Ambiguous database timeout | (new -- the claim-insert's own unguarded exception path; see §4) |
| G. Provider identity conflicts | (new -- extends decideReconciliation's existing CONFLICT tests to an end-to-end harness check) |
| H. `NOT_SENT` policy | 5. `NOT_SENT` with and without evidence |
| I. `FAILED -> SENT` policy | (new -- Policy B end-to-end, ratified not changed) |
| J. Recovery and rollback | 4. Missing-evidence repair / 6. Rollback/recovery |

No scenario here replaces or contradicts the 11C plan; E/F/G/I are
additions the 11C plan did not spell out as separate numbered items but
which the brief for this phase asks for explicitly.

## 2. Environment prerequisites and what is actually available

Checked this phase (commands and raw output are in
`docs/PHASE-11D-VERIFICATION-REPORT.md` §2):

| Capability | Available? |
|---|---|
| Docker | **No** -- `docker` is not on PATH; `docker info` fails with `command not found`. |
| Podman | **No** -- `supabase status` itself reports "podman also not found". |
| `psql` | **No** -- not on PATH. |
| Deno runtime | **No** -- not on PATH. |
| Supabase CLI | **Available** via `npx --no-install supabase` (cached, v2.120.0), and already linked to the real project (`lncwkjlgakonokwboxdp`) -- but `supabase db start`/`status` both require Docker or Podman to run the actual Postgres container, and both are absent. Read-only remote commands (`migration list`, `functions list`) work and were used (§2 of the report) exactly as Phase 11B/11C already did -- these are safe, make no writes, and were used only to reconfirm migration/deployment status. |
| Existing database integration tests | None in this repo -- every `*.consumer.mjs` test is either pure-function/behavioral, mocked-client, or source-scan. No file in `test/` opens a real database connection. |
| Mock Gmail transport | Built this phase (`test/election-outreach-gmail-recovery-proof.consumer.mjs`'s `transport` parameter) -- a deterministic fake, never a real HTTP call. |

**Conclusion: no isolated real database is available in this session.**
Per the brief's instruction, the strongest SAFE tests were executed (see
§3), and every scenario requiring a live Postgres instance is reported
**BLOCKED**, not simulated as passed.

## 3. Reproducible scenarios, expected invariants, and safe execution

All of the following run entirely in-process, in plain Node, against a
disposable in-memory fake store created fresh per test -- there is no
shared state between test runs, no file/network/database I/O, and
nothing to clean up afterward (no cleanup step is required; the process
exiting discards everything). This is the plan actually executed; see the
verification report for results.

```
node test/election-outreach-gmail-recovery-proof.consumer.mjs
```

For each scenario (A-J), the test file itself documents, at the top of
its own `console.log` block: the **setup**, the **action**, and the
**expected invariant**, immediately before the assertions that check the
**observed result**. This plan does not repeat that text verbatim; read
the file's own section headers alongside this plan.

**Evidence-quality note (applies to every scenario below):** none of
these are a live-database test. They are classified, per scenario, as one
of:
- **[DETERMINISTIC CONCURRENCY TEST]** -- two real, concurrently-launched
  (`Promise.all`) async operations against ONE shared, stateful in-memory
  store whose check-then-write steps are only atomic across a real
  `await` boundary (verified separately, see the report §3, to actually
  interleave rather than accidentally serialize).
- **[MOCKED FAULT-INJECTION]** -- the shared store is configured to return
  a specific structured error or throw on the Nth call to a specific
  table+operation, then behaves normally.
- **[HARNESS ORCHESTRATION]** -- a hand-written reimplementation of
  `index.ts`'s control flow (necessary because `index.ts` is Deno-only
  TypeScript and cannot be imported under plain Node), calling the REAL
  exported `contract.mjs` functions for every decision, paired with the
  pre-existing source-scan tests (`election-outreach-gmail-function.consumer.mjs`
  sections M/O) that confirm the real file matches this same ordering.
- **[SOURCE INSPECTION]** -- a regex/text check against the real file
  content, proving wiring, not runtime behavior.
- **[BLOCKED]** -- not executed; the exact missing prerequisite is named.

### Safe execution instructions

```
cd electioncanon
node test/election-outreach-gmail-recovery-proof.consumer.mjs
```

No environment variables, no network access, no database, and no
`OUTREACH_ADMIN_SECRET`/Gmail credentials are required or read. The file
can be run any number of times with identical results (every scenario
constructs its own fresh `createFakeDb()`).

### Cleanup requirements

None. The entire test is in-memory and single-process; nothing is written
to disk, no external service is contacted, and no state outlives the
process.

## 4. What remains genuinely blocked, and the exact unblocking prerequisite

- **Scenario A/B's "real" counterpart** (two actual concurrent HTTP
  requests racing against a real Postgres unique index / conditional
  `UPDATE`): requires a running Postgres instance. **Prerequisite:**
  Docker or Podman installed and on PATH, then `supabase db start` (or an
  equivalent disposable instance with this migration applied), then two
  real concurrent requests fired at it (e.g. via `Promise.all` against two
  real `pg`/`supabase-js` clients, or two parallel `psql` sessions issuing
  the same `INSERT`).
- **Scenario J's true rollback/recovery** (apply the migration, corrupt
  state, recover, roll back, confirm no data loss): requires the same
  prerequisite, plus a disposable (never shared/production) database the
  session can freely corrupt and discard.
- **Any live Gmail behavior** (real `interpretGmailSendResponse` inputs
  from the real API, real OAuth): explicitly out of scope for this phase
  and not attempted; would additionally require Gmail OAuth configuration,
  which is itself a safety-boundary item this phase does not cross.

Nothing above was worked around by touching a shared or production
database, inferring a database is disposable from its name, or otherwise
loosening the safety boundary.
