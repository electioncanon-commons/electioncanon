#!/usr/bin/env node
// ============================================================
// ELECTORAL GEOGRAPHY — NATIONAL READ-ONLY ACQUISITION  (Pre-import qualification pass, Phase 2/3/4)
//
// Crawls INEC's own live PublicApi (see inec-source.mjs's header for how
// this endpoint was found) across the ENTIRE declared hierarchy — every
// state, every LGA, every ward, every polling unit — and writes a
// reproducible local snapshot. READ-ONLY: this script makes zero writes
// to any database, zero Supabase calls, zero service-role key. It only
// talks to cvr.inecnigeria.org and writes local files under
// supabase/geography-import/snapshots/ (gitignored — generated data, not
// source, and too large to commit).
//
// PRODUCTION-SAFE ACQUISITION, ON PURPOSE:
//   - BOUNDED CONCURRENCY (default 3) — never floods the service.
//   - TIMEOUT per request (10s) via AbortController.
//   - RETRY WITH EXPONENTIAL BACKOFF, capped at MAX_RETRIES (5) — a
//     transient failure (the Delta pilot hit exactly one) is retried, not
//     silently treated as "this LGA/ward has zero children."
//   - THREE-WAY OUTCOME, NEVER COLLAPSED TO ONE: a request either
//     succeeds with real rows (possibly zero — a genuinely empty ward is
//     a real, valid outcome), or exhausts its retries as a REQUEST_FAILED
//     (timeout/network) or INVALID_RESPONSE (non-JSON/malformed body).
//     These are recorded distinctly in the snapshot and the log — an
//     empty array in the output NEVER means "we don't know," only
//     "INEC really has none here."
//   - CHECKPOINTING — progress is written to checkpoint.json after every
//     STATE completes. Re-running this script skips states already
//     checkpointed, so an interruption (Ctrl+C, a crash, a long network
//     outage) loses at most one state's partial progress, not the whole run.
//   - DETERMINISTIC OUTPUT — states/LGAs/wards/PUs are always processed
//     and written in the same (INEC id) order, so re-running against an
//     unchanged source produces a byte-identical snapshot (and therefore
//     the same checksum — see writeManifest()).
//   - POLITE PACING — concurrency is capped low and requests are staggered
//     (REQUEST_STAGGER_MS between request starts within a batch); this is
//     a real public service used by citizens, not a target to maximize
//     throughput against.
//
// Run (foreground or backgrounded by the operator):
//   node supabase/geography-import/acquire-national-snapshot.mjs
// Resume after an interruption: just run it again — checkpoint.json is
// read on startup and completed states are skipped.
//
// FORCE_REFRESH=true — EXPLICIT, OPT-IN, NEVER THE DEFAULT (national
// import repair, follow-up pass). Checkpointing is a feature for surviving
// an INTERRUPTION mid-crawl — it is not, and must never silently become, a
// cache that hides source-side or PARSER-side changes. When
// parseCascadeResponse() itself changes (as it did in this repair — see
// inec-source.mjs's own header), a plain re-run against an existing
// checkpoint.json that already lists all 37 states complete does
// ABSOLUTELY NOTHING: every state is skipped, and the snapshot is
// rewritten with a fresh `acquiredAt` timestamp but the SAME STALE,
// pre-fix parsed data — a silent no-op that looks like a real
// reacquisition. FORCE_REFRESH=true is the explicit escape hatch: it
// makes this run start from a completely EMPTY in-memory checkpoint
// (ignoring whatever is on disk), so every one of the 37 states is
// genuinely re-fetched from INEC and re-parsed with whatever
// parseCascadeResponse() currently is. Everything else about the run is
// UNCHANGED — same retry/timeout/bounded-concurrency/polite-pacing
// protections, same deterministic per-state order, same incremental
// checkpoint.json writes after each state (so a FORCE_REFRESH run can
// itself still be safely interrupted and resumed — resuming afterward,
// with or without FORCE_REFRESH, only ever finds FRESH completed-state
// entries, never a stale one silently mixed in). Zero Supabase/database
// calls, exactly like every other mode of this script.
//
//   FORCE_REFRESH=true node supabase/geography-import/acquire-national-snapshot.mjs
// ============================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { INEC_STATE_IDS, INEC_ENDPOINTS, parseCascadeResponse } from "./inec-source.mjs";
import { fetchWithRetry, runBounded, tallyOutcome, checksumOf, OUTCOME } from "./harden.mjs";
import { loadCheckpoint, saveCheckpoint, isStateComplete, recordStateComplete } from "./checkpoint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, "snapshots");
const CHECKPOINT_PATH = join(SNAP_DIR, "checkpoint.json");
const SNAPSHOT_PATH = join(SNAP_DIR, "national-snapshot.json");
const MANIFEST_PATH = join(SNAP_DIR, "manifest.json");
const LOG_PATH = join(SNAP_DIR, "acquisition-log.jsonl");

const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;
const REQUEST_STAGGER_MS = 60;

// Explicit, opt-in, never-default — see this file's own header for why
// this exists and exactly what it does/doesn't change.
const FORCE_REFRESH = process.env.FORCE_REFRESH === "true";

if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });

const logLine = (entry) => appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");

/** One request against the real INEC service, using harden.mjs's shared,
 *  independently-tested retry/timeout logic — see that file's own header
 *  for why the retry/backoff/outcome-tagging itself lives there instead
 *  of here. */
async function fetchCascade(url, context) {
  const result = await fetchWithRetry({
    url, fetchImpl: fetch, parseFn: parseCascadeResponse,
    timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES, baseBackoffMs: BASE_BACKOFF_MS,
    onRetry: (info) => logLine({ level: "retry", context, ...info }),
  });
  if (result.outcome !== OUTCOME.OK) logLine({ level: "failed", context, url, attempts: result.attempts, ...result.detail });
  return { outcome: result.outcome, rows: result.data, attempts: result.attempts };
}

async function acquireState(stateEntry) {
  const stats = { successfulRequests: 0, retriedRequests: 0, failedRequests: 0, invalidResponses: 0 };
  const lgaResult = await fetchCascade(INEC_ENDPOINTS.lgas(stateEntry.stateId), { level: "lga", stateId: stateEntry.stateId });
  tallyOutcome(stats, lgaResult);
  if (lgaResult.outcome !== OUTCOME.OK) {
    return { stateId: stateEntry.stateId, code: stateEntry.code, label: stateEntry.label, lgas: [], stats, stateLevelFailure: lgaResult.outcome };
  }

  const { results: lgas } = await runBounded(lgaResult.rows, async (lga) => {
    const wardResult = await fetchCascade(INEC_ENDPOINTS.wards(lga.id), { level: "ward", lgaId: lga.id, stateCode: stateEntry.code });
    tallyOutcome(stats, wardResult);
    if (wardResult.outcome !== OUTCOME.OK) {
      return { id: lga.id, name: lga.name, displayNumber: lga.displayNumber, wards: [], lgaLevelFailure: wardResult.outcome };
    }
    const { results: wards } = await runBounded(wardResult.rows, async (ward) => {
      const puResult = await fetchCascade(INEC_ENDPOINTS.pollingUnits(ward.id), { level: "pu", wardId: ward.id, lgaId: lga.id, stateCode: stateEntry.code });
      tallyOutcome(stats, puResult);
      if (puResult.outcome !== OUTCOME.OK) {
        return { id: ward.id, name: ward.name, displayNumber: ward.displayNumber, pollingUnits: null, pollingUnitCount: 0, wardLevelFailure: puResult.outcome };
      }
      return {
        id: ward.id, name: ward.name, displayNumber: ward.displayNumber,
        pollingUnitCount: puResult.rows.length,
        pollingUnits: puResult.rows.map((pu) => ({ id: pu.id, code: pu.displayNumber, name: pu.name })),
      };
    }, { concurrency: CONCURRENCY, staggerMs: REQUEST_STAGGER_MS });
    return { id: lga.id, name: lga.name, displayNumber: lga.displayNumber, wards };
  }, { concurrency: CONCURRENCY, staggerMs: REQUEST_STAGGER_MS });

  return { stateId: stateEntry.stateId, code: stateEntry.code, label: stateEntry.label, lgas, stats };
}

/** Exported for direct testing (see
 *  test/election-geography-acquisition-hardening.consumer.mjs's own
 *  FORCE_REFRESH section) — pure, no I/O: given the flag and whatever
 *  loadCheckpoint() would return, decides which starting checkpoint this
 *  run actually uses. Default (false): trust and resume from what's on
 *  disk. FORCE_REFRESH (true): start empty, regardless of what's on disk
 *  — every state will look "not yet complete" to isStateComplete(), so
 *  the main loop below re-fetches and re-parses every one of them. */
export function resolveStartingCheckpoint(forceRefresh, loadedCheckpoint) {
  return forceRefresh ? { completedStateCodes: [], states: {} } : loadedCheckpoint;
}

async function main() {
  const checkpoint = resolveStartingCheckpoint(FORCE_REFRESH, loadCheckpoint(CHECKPOINT_PATH));
  const startedAt = new Date().toISOString();
  console.log(`\nNational geography acquisition starting at ${startedAt}`);
  if (FORCE_REFRESH) {
    console.log(`FORCE_REFRESH=true — ignoring any existing checkpoint on disk. Every one of the ${INEC_STATE_IDS.length} states will be re-fetched from INEC and re-parsed with the CURRENT parseCascadeResponse().`);
  }
  console.log(`Already completed (from checkpoint): ${checkpoint.completedStateCodes.length}/${INEC_STATE_IDS.length} states\n`);

  for (const stateEntry of INEC_STATE_IDS) {
    if (isStateComplete(checkpoint, stateEntry.code)) {
      console.log(`  skip  ${stateEntry.code} (already checkpointed)`);
      continue;
    }
    console.log(`  crawl ${stateEntry.code} (state_id=${stateEntry.stateId})...`);
    const result = await acquireState(stateEntry);
    const lgaCount = result.lgas.length;
    const wardCount = result.lgas.reduce((s, l) => s + l.wards.length, 0);
    const puCount = result.lgas.reduce((s, l) => s + l.wards.reduce((s2, w) => s2 + w.pollingUnitCount, 0), 0);
    console.log(`  done  ${stateEntry.code}: ${lgaCount} LGAs, ${wardCount} wards, ${puCount} PUs` +
      (result.stats.failedRequests ? ` — ${result.stats.failedRequests} failed requests` : ""));
    recordStateComplete(checkpoint, stateEntry.code, result);
    saveCheckpoint(CHECKPOINT_PATH, checkpoint);
  }

  const finishedAt = new Date().toISOString();
  const states = Object.values(checkpoint.states);
  const totals = states.reduce((acc, s) => {
    acc.lgas += s.lgas.length;
    for (const l of s.lgas) {
      acc.wards += l.wards.length;
      for (const w of l.wards) acc.pollingUnits += w.pollingUnitCount;
    }
    acc.successfulRequests += s.stats.successfulRequests;
    acc.retriedRequests += s.stats.retriedRequests;
    acc.failedRequests += s.stats.failedRequests;
    acc.invalidResponses += s.stats.invalidResponses;
    return acc;
  }, { lgas: 0, wards: 0, pollingUnits: 0, successfulRequests: 0, retriedRequests: 0, failedRequests: 0, invalidResponses: 0 });

  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ acquiredAt: finishedAt, states: checkpoint.states }));

  const manifest = {
    source_name: "INEC Continuous Voter Registration Portal — Polling Unit Locator (PublicApi)",
    source_url: "https://cvr.inecnigeria.org/pu",
    retrieved_at: finishedAt,
    acquisition_started_at: startedAt,
    reference_description: "Live current INEC CVR administrative geography (State -> LGA -> Ward -> Polling Unit). Not INEC-labelled with an explicit election-cycle year — see inec-source.mjs's own header.",
    state_count: states.length,
    lga_count: totals.lgas,
    ward_count: totals.wards,
    polling_unit_count: totals.pollingUnits,
    successful_requests: totals.successfulRequests,
    retried_requests: totals.retriedRequests,
    failed_requests: totals.failedRequests,
    invalid_responses: totals.invalidResponses,
    validation_status: totals.failedRequests === 0 && totals.invalidResponses === 0 ? "CLEAN — zero unresolved requests" : `${totals.failedRequests + totals.invalidResponses} unresolved requests — see acquisition-log.jsonl`,
    snapshot_file: "national-snapshot.json",
    snapshot_sha256: checksumOf(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"))),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\nDone. States: ${states.length}/${INEC_STATE_IDS.length}. LGAs: ${totals.lgas}. Wards: ${totals.wards}. PUs: ${totals.pollingUnits}.`);
  console.log(`Requests — ok: ${totals.successfulRequests}, retried: ${totals.retriedRequests}, failed: ${totals.failedRequests}, invalid: ${totals.invalidResponses}`);
  console.log(`Snapshot: ${SNAPSHOT_PATH}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`SHA-256: ${manifest.snapshot_sha256}\n`);
}

// Only runs the real crawl when executed directly — this module exports
// nothing meant to be imported elsewhere, but the guard is cheap
// insurance against ever accidentally importing this file (e.g. from a
// future test) and triggering a live national crawl as a side effect.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Acquisition run crashed:", err);
    process.exitCode = 1;
  });
}
