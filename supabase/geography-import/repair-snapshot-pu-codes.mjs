#!/usr/bin/env node
// ============================================================
// ELECTORAL GEOGRAPHY — TARGETED SNAPSHOT PU-CODE REPAIR  (National import repair, follow-up pass)
//
// READ-ONLY against INEC (GET requests only), WRITES ONLY the local
// snapshot file on disk — never touches Supabase, never imports any
// database client, makes zero database calls. This is the tool this
// repair's own forensic investigation concluded was needed: the earlier
// parser fix in inec-source.mjs's parseCascadeResponse() (`.` -> `[\s\S]`
// to tolerate an embedded newline INEC's own live PU labels can contain)
// is correct and, per this file's own investigation, resolves 100% of the
// 396 polling units the CURRENT local snapshot still reports as missing a
// code — but the snapshot itself was ACQUIRED before that fix landed, so
// it still holds the OLD (pre-fix) parse output frozen in JSON. A full
// national re-crawl (acquire-national-snapshot.mjs, ~70 minutes, ~9,600+
// live requests) would fix this too, but would re-fetch 176,450 records
// that were never wrong in the first place. This script instead:
//
//   1. Reads the current local snapshot and finds every candidate PU with
//      a missing/blank code (via import-plan.mjs's own preflightPuCodes()
//      — the SAME check the importer's live preflight runs, so this tool
//      and the importer can never disagree about what counts as "bad").
//   2. Groups them by their real INEC parent ward (117 wards, not 396
//      individual requests) and re-fetches ONLY those wards live from
//      INEC's own PublicApi — bounded concurrency, retry/backoff, timeout,
//      the exact same hardened/polite discipline as
//      acquire-national-snapshot.mjs (see harden.mjs).
//   3. Re-parses each affected ward's response with the CURRENT (fixed)
//      parseCascadeResponse() — the real function, not a reimplementation,
//      so there is zero risk of this tool and the importer ever disagreeing
//      about what a given label means.
//   4. For each originally-bad PU, classifies the outcome honestly:
//        PATCHED                    — the fix genuinely recovers a real,
//                                      authoritative INEC display number;
//                                      the snapshot's `code`/`name` for
//                                      that one record are updated in place.
//        GENUINELY_MISSING_SOURCE_CODE — even freshly re-fetched and
//                                      re-parsed with the fixed parser, no
//                                      leading digit-dash prefix is present
//                                      at all. NEVER fabricated. Left
//                                      exactly as-is (still null/blank) and
//                                      reported separately so a human can
//                                      decide, per this repair's own "do
//                                      not manufacture a code" rule.
//        NOT_FOUND_IN_LIVE_REFETCH  — the PU id no longer appears at all
//                                      in a fresh live response for its
//                                      ward (INEC's live data may have
//                                      changed since acquisition). Left
//                                      untouched, reported separately —
//                                      never silently dropped.
//        WARD_REFETCH_FAILED        — the live request for that PU's whole
//                                      ward failed after retries. Every PU
//                                      under that ward is left untouched,
//                                      reported separately.
//   5. Writes the patched snapshot back to disk, but ONLY after writing an
//      exact, restorable BACKUP of the original file first (never a
//      destructive in-place edit with no way back). Also appends a patch
//      record + a freshly recomputed checksum to manifest.json, and writes
//      a full JSON + human-readable forensic report.
//
// NEVER fabricates: PATCHED only ever writes a code that came from a real,
// live GET to INEC's own endpoint, parsed by the SAME parser the real
// importer uses. No PU UUID, array index, hash, name, or invented sequence
// is ever substituted in — see derivePuCodePatch()'s own logic below,
// which is pure and independently tested (see
// test/election-geography-pu-code-repair.consumer.mjs).
//
// Run (read-only against INEC, writes only the local snapshot file):
//   node supabase/geography-import/repair-snapshot-pu-codes.mjs
// ============================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { INEC_ENDPOINTS, parseCascadeResponse } from "./inec-source.mjs";
import { fetchWithRetry, runBounded, checksumOf } from "./harden.mjs";
import { flattenSnapshot, preflightPuCodes } from "./import-plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, "snapshots");
const SNAPSHOT_PATH = join(SNAP_DIR, "national-snapshot.json");
const MANIFEST_PATH = join(SNAP_DIR, "manifest.json");

const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;
const REQUEST_STAGGER_MS = 80;

/**
 * PURE decision logic — given the originally-bad PU record and the
 * outcome of a fresh live re-fetch of its ward (already re-parsed by the
 * real parseCascadeResponse()), decides what to do. Never called with
 * network/file I/O itself — see repairAffectedPuCodes() below for that —
 * so this is exhaustively testable with synthetic inputs.
 *
 * @param existingPu   {inecPuId, code, name, ...} — the bad record as it
 *                     currently sits in the snapshot.
 * @param freshWard    the OUTCOME of re-fetching this PU's ward: either
 *                     `{ok:true, parsedPus:[{id,displayNumber,name}...]}`
 *                     on a successful live re-fetch, or `{ok:false}` if
 *                     the ward-level request failed after retries.
 */
export function derivePuCodePatch(existingPu, freshWard) {
  if (!freshWard.ok) return { action: "WARD_REFETCH_FAILED" };
  const freshPu = freshWard.parsedPus.find((p) => p.id === existingPu.inecPuId);
  if (!freshPu) return { action: "NOT_FOUND_IN_LIVE_REFETCH" };
  if (freshPu.displayNumber == null) return { action: "GENUINELY_MISSING_SOURCE_CODE", freshName: freshPu.name };
  return { action: "PATCHED", code: freshPu.displayNumber, name: freshPu.name };
}

/** Applies a PATCHED decision to the in-memory snapshot tree in place —
 *  pure mutation of the one matching PU record, nothing else touched. */
export function applyPatchToSnapshot(snapshot, patch) {
  const state = snapshot.states[patch.stateKey];
  const lga = state.lgas.find((l) => l.id === patch.inecLgaId);
  const ward = lga.wards.find((w) => w.id === patch.inecWardId);
  const pu = ward.pollingUnits.find((p) => p.id === patch.inecPuId);
  pu.code = patch.code;
  pu.name = patch.name;
}

async function fetchWardLive(wardId) {
  const result = await fetchWithRetry({
    url: INEC_ENDPOINTS.pollingUnits(wardId),
    fetchImpl: fetch,
    parseFn: parseCascadeResponse,
    timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES, baseBackoffMs: BASE_BACKOFF_MS,
  });
  return result.outcome === "OK" ? { ok: true, parsedPus: result.data } : { ok: false, outcome: result.outcome };
}

async function main() {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot found at ${SNAPSHOT_PATH} — run acquire-national-snapshot.mjs first.`);
    process.exitCode = 1;
    return;
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const { pollingUnits } = flattenSnapshot(snapshot.states);
  const { missing } = preflightPuCodes(pollingUnits); // the SAME check the importer's own preflight runs

  console.log(`\nSNAPSHOT PU-CODE REPAIR — targeted, read-only-against-INEC patch\n`);
  console.log(`Candidate PUs with missing/blank code in the CURRENT local snapshot: ${missing.length}`);
  if (missing.length === 0) {
    console.log("Nothing to repair — the local snapshot already has zero missing/blank PU codes.\n");
    return;
  }

  // We need each bad PU's real STATE KEY (the key into snapshot.states,
  // not necessarily == stateCode for every acquisition run) to patch it
  // back in place — flattenSnapshot doesn't carry that key, so rebuild
  // the mapping directly from the same tree flattenSnapshot walked.
  const puToStateKey = new Map();
  for (const [stateKey, state] of Object.entries(snapshot.states)) {
    for (const lga of state.lgas ?? []) {
      for (const ward of lga.wards ?? []) {
        for (const pu of ward.pollingUnits ?? []) puToStateKey.set(pu.id, stateKey);
      }
    }
  }

  const byWard = new Map();
  for (const pu of missing) {
    if (!byWard.has(pu.inecWardId)) byWard.set(pu.inecWardId, []);
    byWard.get(pu.inecWardId).push({ ...pu, stateKey: puToStateKey.get(pu.inecPuId) });
  }
  const affectedWardIds = [...byWard.keys()];
  console.log(`Affected wards to re-fetch live (bounded concurrency=${CONCURRENCY}, polite pacing): ${affectedWardIds.length}\n`);

  const { results } = await runBounded(affectedWardIds, async (wardId) => ({ wardId, fresh: await fetchWardLive(wardId) }), {
    concurrency: CONCURRENCY, staggerMs: REQUEST_STAGGER_MS,
  });
  const freshByWard = new Map(results.map((r) => [r.wardId, r.fresh]));

  const outcomes = { PATCHED: [], GENUINELY_MISSING_SOURCE_CODE: [], NOT_FOUND_IN_LIVE_REFETCH: [], WARD_REFETCH_FAILED: [] };
  for (const [wardId, pus] of byWard) {
    const fresh = freshByWard.get(wardId);
    for (const pu of pus) {
      const decision = derivePuCodePatch(pu, fresh);
      const record = { ...pu, decision: decision.action };
      if (decision.action === "PATCHED") {
        applyPatchToSnapshot(snapshot, { ...pu, code: decision.code, name: decision.name });
        record.newCode = decision.code;
        record.newName = decision.name;
      }
      outcomes[decision.action].push(record);
    }
  }

  console.log("REPAIR OUTCOME:");
  console.log(`  PATCHED (real live-sourced code recovered, applied)         : ${outcomes.PATCHED.length}`);
  console.log(`  GENUINELY_MISSING_SOURCE_CODE (no code fabricated, left as-is): ${outcomes.GENUINELY_MISSING_SOURCE_CODE.length}`);
  console.log(`  NOT_FOUND_IN_LIVE_REFETCH (left as-is)                        : ${outcomes.NOT_FOUND_IN_LIVE_REFETCH.length}`);
  console.log(`  WARD_REFETCH_FAILED (left as-is)                              : ${outcomes.WARD_REFETCH_FAILED.length}\n`);

  if (outcomes.PATCHED.length > 0) {
    const backupPath = SNAPSHOT_PATH.replace(/\.json$/, `.pre-pu-code-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json.bak`);
    copyFileSync(SNAPSHOT_PATH, backupPath);
    console.log(`Original snapshot backed up to: ${backupPath}`);
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));
    console.log(`Patched snapshot written to: ${SNAPSHOT_PATH}`);

    if (existsSync(MANIFEST_PATH)) {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      manifest.pu_code_repair_patches = manifest.pu_code_repair_patches ?? [];
      manifest.pu_code_repair_patches.push({
        appliedAt: new Date().toISOString(),
        reason: "parser fix (inec-source.mjs: '.' -> '[\\s\\S]' for embedded-newline PU labels) recovered via targeted live re-fetch of affected wards, not a full re-crawl",
        wardsRefetched: affectedWardIds.length,
        pusPatched: outcomes.PATCHED.length,
        genuinelyMissingSourceCode: outcomes.GENUINELY_MISSING_SOURCE_CODE.length,
        notFoundInLiveRefetch: outcomes.NOT_FOUND_IN_LIVE_REFETCH.length,
        wardRefetchFailed: outcomes.WARD_REFETCH_FAILED.length,
      });
      manifest.snapshot_sha256 = checksumOf(snapshot);
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      console.log(`Manifest updated with patch record and recomputed checksum: ${manifest.snapshot_sha256}`);
    }
  } else {
    console.log("No PU was patched — nothing written to the snapshot file.");
  }

  const reportPath = join(SNAP_DIR, "pu-code-repair-report.json");
  writeFileSync(reportPath, JSON.stringify(outcomes, null, 2));
  console.log(`\nFull forensic report: ${reportPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("PU-code repair run failed:", err);
    process.exitCode = 1;
  });
}
