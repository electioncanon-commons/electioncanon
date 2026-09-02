#!/usr/bin/env node
// ============================================================
// ELECTORAL GEOGRAPHY — NATIONAL ADMINISTRATIVE GEOGRAPHY IMPORT  (Production import pass — REPAIRED)
//
// TRANSPORT ONLY. Every decision (what to insert, what already exists,
// what's quarantined, how a child resolves to its parent) is made by
// import-plan.mjs's pure, independently-tested functions
// (test/election-geography-national-import-plan.consumer.mjs) — this
// file reads the local snapshot, reads real existing rows, calls those
// functions, and either PRINTS the resulting plan (dry run, the default)
// or EXECUTES it (only with DRY_RUN=false, explicit and unambiguous).
//
// SCOPE: State -> LGA -> Ward -> Polling Unit ONLY. This script never
// touches geography_constituencies / geography_constituency_lgas —
// constituency delimitation is a separate, still-unqualified problem
// (see supabase/geography-import/README.md's own section on this) and
// this script has no code path that could write to those tables even by
// accident (it never imports write logic for them).
//
// MUST BE RUN LOCALLY, BY THE OPERATOR, WITH A SERVICE-ROLE KEY — same
// discipline as import-lgas.mjs. The key is read only from the
// environment, never logged, never written to a file, never a CLI arg.
//
// SAFE RESUME, BY CONSTRUCTION. 771 LGAs and 8,809 wards may already be
// sitting in the database from an earlier partial run — this importer
// treats every already-existing row as EXISTING, never re-inserts or
// alters it: every write is `.upsert(rows, {onConflict, ignoreDuplicates:
// true})` against the SAME real unique constraints the original migration
// defined, so re-running this script (after an interruption, after this
// repair, or just to pick up a later re-acquired snapshot) can only ever
// add rows that don't already exist; it can never create a duplicate,
// and it never deletes or updates an existing row.
//
// ---- WHAT THIS REPAIR CHANGED (see each imported module's own header
// for the full rationale) ----
//   1. Every read of geography_lgas/geography_wards/geography_polling_units
//      — in BOTH dry-run and live mode, no exceptions — now goes through
//      paginated-read.mjs's fetchAllRows(), which pages with .range()
//      until it observes the real end of the table. The previous bare
//      .select() silently truncated at PostgREST's 1,000-row default,
//      which is exactly what produced the "unresolved parent: 159566"
//      figure from today's failed run (only ~1,000 of 8,809 real wards
//      were ever visible to the id-resolution step).
//   2. computePlan() below is now the ONE place that reads existing rows
//      and resolves INEC ids to database ids — called identically by
//      dry-run (which stops there) and by live (which additionally
//      executes writes and re-resolves against the newly-real rows). The
//      previous dry-run branch fabricated its own "WOULD-INSERT:..." ids
//      inline; that's gone. Resolution against a row this run PLANS to
//      insert (but hasn't yet) is still needed to preview a multi-level
//      plan, so it's still done — but tagged with
//      import-plan.mjs's PENDING_INSERT_PREFIX and counted SEPARATELY
//      from real database matches (see splitResolutionCounts()), so a
//      dry run can never present a synthetic match as if it were a
//      confirmed one.
//   3. Strict PU-code preflight (import-plan.mjs's preflightPuCodes())
//      runs as part of computePlan() — before ANY write, in live mode —
//      and, if it finds even one candidate polling unit with a missing/
//      blank code, ABORTS THE ENTIRE RUN before the first LGA is
//      written. Today's failure wrote 771 LGAs and 8,809 wards before
//      discovering the PU-level NOT NULL violation; this repair makes
//      that ordering impossible — the whole plan (all three levels) is
//      computed and validated first, and only executed if clean.
//
// Usage (dry run — the default, safe, no writes):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node supabase/geography-import/import-national-geography.mjs
//
// Usage (real import — explicit opt-in required):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DRY_RUN=false \
//     node supabase/geography-import/import-national-geography.mjs
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  flattenSnapshot, resolveIds, planLgaImport, planWardImport, planPuImport, chunk,
  preflightPuCodes, splitResolutionCounts, PENDING_INSERT_PREFIX, normalizeGeographyName,
} from "./import-plan.mjs";
import { fetchAllRows } from "./paginated-read.mjs";
import { QUARANTINED_WARDS, QUARANTINED_WARD_IDS } from "./quarantine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(HERE, "snapshots", "national-snapshot.json");
const SOURCE_TAG = "inec-cvr-publicapi-live-2026-09-01";
const BATCH_SIZE = 500;
const DRY_RUN = process.env.DRY_RUN !== "false"; // default TRUE — writes require an explicit, unambiguous opt-out

const LGA_SELECT = "id, state_code, name";
const WARD_SELECT = "id, lga_id, name";
const PU_SELECT = "id, ward_id, code";

async function upsertBatched(client, table, rows, onConflict) {
  let inserted = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { data, error } = await client.from(table).upsert(batch, { onConflict, ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`upsert into ${table} failed: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

/**
 * READ-ONLY, mode-agnostic. Computes the FULL three-level plan (LGAs,
 * wards, polling units) against the current REAL database state, using
 * paginated-read.mjs's fetchAllRows() for every read — never a bare,
 * 1,000-row-capped `.select()`. This is called identically by dry-run
 * (which only ever calls this) and by live (which calls this FIRST, as a
 * preflight, before deciding whether to write anything at all — see
 * main()). Because this function performs no writes and is called from
 * exactly one place regardless of DRY_RUN, dry-run and live are
 * guaranteed to compute the identical plan from identical inputs — that
 * guarantee IS the dry-run/live fidelity fix (see this file's own header,
 * point 2).
 *
 * A row this run PLANS to insert (e.g. a genuinely new ward) does not
 * have a real database id yet — id resolution for anything depending on
 * it uses a placeholder tagged with import-plan.mjs's
 * PENDING_INSERT_PREFIX, built from the exact same natural key
 * planXImport() already used to decide it was new (so it can never
 * collide with something real). splitResolutionCounts() lets a caller
 * report exactly how many resolutions were REAL vs. PENDING — never
 * conflated into one falsely-reassuring number.
 */
export async function computePlan(client, snapshot) {
  const { lgas, wards, pollingUnits } = flattenSnapshot(snapshot.states);

  // ---------- LGAs ----------
  const existingLgas = await fetchAllRows(client, "geography_lgas", { select: LGA_SELECT });
  const lgaPlan = planLgaImport(lgas, existingLgas);
  const lgaResolutionRows = [
    ...existingLgas,
    ...lgaPlan.toInsert.map((l) => ({
      id: `${PENDING_INSERT_PREFIX}${l.stateCode}::${normalizeGeographyName(l.name).toLowerCase()}`,
      state_code: l.stateCode, name: l.name,
    })),
  ];
  const { map: lgaIdMap, unresolved: unresolvedLgaRefs } = resolveIds(
    lgas, (l) => l.inecLgaId, (l) => `${l.stateCode}::${normalizeGeographyName(l.name).toLowerCase()}`,
    lgaResolutionRows, (r) => `${r.state_code}::${normalizeGeographyName(r.name).toLowerCase()}`, (r) => r.id,
  );

  // ---------- Wards ----------
  const existingWards = await fetchAllRows(client, "geography_wards", { select: WARD_SELECT });
  const wardPlan = planWardImport(wards, lgaIdMap, existingWards, QUARANTINED_WARD_IDS);
  const wardResolutionRows = [
    ...existingWards,
    ...wardPlan.toInsert.map((w) => ({
      id: `${PENDING_INSERT_PREFIX}${w.lgaId}::${normalizeGeographyName(w.name).toLowerCase()}`,
      lga_id: w.lgaId, name: w.name,
    })),
  ];
  const { map: wardIdMap, unresolved: unresolvedWardRefs } = resolveIds(
    wards.filter((w) => !QUARANTINED_WARD_IDS.has(w.inecWardId)),
    (w) => w.inecWardId,
    (w) => {
      const lgaId = lgaIdMap.get(w.inecLgaId);
      return lgaId ? `${lgaId}::${normalizeGeographyName(w.name).toLowerCase()}` : `__unresolvable__::${w.inecWardId}`;
    },
    wardResolutionRows, (r) => `${r.lga_id}::${normalizeGeographyName(r.name).toLowerCase()}`, (r) => r.id,
  );

  // ---------- Polling Units ----------
  const existingPus = await fetchAllRows(client, "geography_polling_units", { select: PU_SELECT });
  const puPlan = planPuImport(pollingUnits, wardIdMap, existingPus);
  const puCodePreflight = preflightPuCodes(pollingUnits);

  return {
    lgas, wards, pollingUnits,
    existingLgas, lgaPlan, lgaIdMap, unresolvedLgaRefs,
    existingWards, wardPlan, wardIdMap, unresolvedWardRefs,
    existingPus, puPlan, puCodePreflight,
  };
}

/** The ONE fatal condition this repair enforces before any live write:
 *  a missing/blank polling-unit code, which would violate
 *  geography_polling_units.code's NOT NULL constraint (never relaxed —
 *  see import-plan.mjs's preflightPuCodes() header). */
export function hasFatalIssues(plan) {
  return plan.puCodePreflight.count > 0;
}

function printPreflightReport(plan) {
  const lgaSplit = splitResolutionCounts(plan.lgaIdMap);
  const wardSplit = splitResolutionCounts(plan.wardIdMap);

  console.log("PREFLIGHT — computed via the SAME read-only, fully-paginated resolution path in both dry-run and live mode:\n");
  console.log(`  LGAs           — existing: ${plan.lgaPlan.alreadyExisting.length}, new: ${plan.lgaPlan.toInsert.length}`);
  console.log(`    LGA parent resolution   — via real DB rows: ${lgaSplit.real}, via this run's own pending insert: ${lgaSplit.pending}, unresolved: ${plan.unresolvedLgaRefs.length}`);
  console.log(`  Wards          — existing: ${plan.wardPlan.alreadyExisting.length}, new: ${plan.wardPlan.toInsert.length}, quarantined: ${plan.wardPlan.quarantined.length}, unresolved parent: ${plan.wardPlan.unresolvedParent.length}`);
  console.log(`    Ward parent resolution  — via real DB rows: ${wardSplit.real}, via this run's own pending insert: ${wardSplit.pending}, unresolved: ${plan.unresolvedWardRefs.length}`);
  console.log(`  Polling Units  — existing: ${plan.puPlan.alreadyExisting.length}, new: ${plan.puPlan.toInsert.length}, unresolved parent: ${plan.puPlan.unresolvedParent.length}`);
  console.log(`  PUs with missing/blank code (checked against every source candidate, not just resolvable ones): ${plan.puCodePreflight.count}`);
  if (plan.puCodePreflight.count > 0) {
    console.log(`    Every affected source record (state/LGA/ward/INEC ids and names — no code was fabricated for any of these):`);
    for (const pu of plan.puCodePreflight.missing.slice(0, 50)) {
      console.log(`      - ${pu.stateCode}/${pu.lgaName}/${pu.wardName} (INEC lga id ${pu.inecLgaId}, ward id ${pu.inecWardId}, PU id ${pu.inecPuId}): "${pu.name}"`);
    }
    if (plan.puCodePreflight.count > 50) {
      console.log(`      ...and ${plan.puCodePreflight.count - 50} more (full list is plan.puCodePreflight.missing).`);
    }
  }
  console.log("");
}

/**
 * LIVE-ONLY. Only ever reached from main() after computePlan()'s
 * preflight has already confirmed zero missing PU codes. Writes level by
 * level (LGAs, then wards, then polling units), paginated-re-reading real
 * rows after each write to resolve the next level — never a fabricated
 * id, because at this point every write is real.
 */
async function executeWrites(client, plan) {
  // ---------- LGAs ----------
  // l.name is already whitespace-normalized by planLgaImport() itself —
  // normalizeGeographyName() re-applied here too, so the ACTUAL write
  // payload can never regress to an un-normalized value even if some
  // future caller ever constructs toInsert rows a different way.
  const lgaPayload = plan.lgaPlan.toInsert.map((l) => ({ state_code: l.stateCode, name: normalizeGeographyName(l.name), source: SOURCE_TAG }));
  const lgaInsertedCount = await upsertBatched(client, "geography_lgas", lgaPayload, "state_code,name");
  console.log(`LGAs — inserted: ${lgaInsertedCount}`);

  const realLgas = await fetchAllRows(client, "geography_lgas", { select: LGA_SELECT });
  const { map: lgaIdMap, unresolved: unresolvedLgaRefs } = resolveIds(
    plan.lgas, (l) => l.inecLgaId, (l) => `${l.stateCode}::${normalizeGeographyName(l.name).toLowerCase()}`,
    realLgas, (r) => `${r.state_code}::${normalizeGeographyName(r.name).toLowerCase()}`, (r) => r.id,
  );
  if (unresolvedLgaRefs.length > 0) {
    throw new Error(`SAFETY STOP: ${unresolvedLgaRefs.length} LGA(s) failed to resolve to a real id immediately after write — this should be impossible if the preflight passed. Aborting before any ward/PU write.`);
  }

  // ---------- Wards ----------
  const existingWardsBeforeWrite = await fetchAllRows(client, "geography_wards", { select: WARD_SELECT });
  const wardPlan = planWardImport(plan.wards, lgaIdMap, existingWardsBeforeWrite, QUARANTINED_WARD_IDS);
  const wardPayload = wardPlan.toInsert.map((w) => ({ lga_id: w.lgaId, name: normalizeGeographyName(w.name), source: SOURCE_TAG }));
  const wardInsertedCount = await upsertBatched(client, "geography_wards", wardPayload, "lga_id,name");
  console.log(`Wards — inserted: ${wardInsertedCount}`);
  if (wardPlan.unresolvedParent.length > 0) {
    console.log(`  WARNING: ${wardPlan.unresolvedParent.length} ward(s) have no resolvable parent LGA — NOT imported.`);
  }

  const realWards = await fetchAllRows(client, "geography_wards", { select: WARD_SELECT });
  const { map: wardIdMap } = resolveIds(
    plan.wards.filter((w) => !QUARANTINED_WARD_IDS.has(w.inecWardId)),
    (w) => w.inecWardId,
    (w) => {
      const lgaId = lgaIdMap.get(w.inecLgaId);
      return lgaId ? `${lgaId}::${normalizeGeographyName(w.name).toLowerCase()}` : `__unresolvable__::${w.inecWardId}`;
    },
    realWards, (r) => `${r.lga_id}::${normalizeGeographyName(r.name).toLowerCase()}`, (r) => r.id,
  );

  // ---------- Polling Units ----------
  const existingPusBeforeWrite = await fetchAllRows(client, "geography_polling_units", { select: PU_SELECT });
  const puPlan = planPuImport(plan.pollingUnits, wardIdMap, existingPusBeforeWrite);
  const puPayload = puPlan.toInsert.map((p) => ({ ward_id: p.wardId, code: p.code, name: normalizeGeographyName(p.name), source: SOURCE_TAG }));
  const puInsertedCount = await upsertBatched(client, "geography_polling_units", puPayload, "ward_id,code");
  console.log(`Polling Units — inserted: ${puInsertedCount}`);
  if (puPlan.unresolvedParent.length > 0) {
    console.log(`  WARNING: ${puPlan.unresolvedParent.length} polling unit(s) have no resolvable parent ward — NOT imported.`);
  }

  console.log(`\nIMPORT COMPLETE.\n`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in the environment (never on the command line, never committed).");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot found at ${SNAPSHOT_PATH} — run acquire-national-snapshot.mjs first.`);
    process.exitCode = 1;
    return;
  }
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));

  console.log(`\nELECTORAL GEOGRAPHY — NATIONAL ADMINISTRATIVE GEOGRAPHY IMPORT ${DRY_RUN ? "(DRY RUN — no writes)" : "(LIVE — WRITING)"}\n`);
  console.log(`Snapshot acquired at: ${snapshot.acquiredAt}`);
  const { lgas, wards, pollingUnits } = flattenSnapshot(snapshot.states);
  console.log(`Candidates — LGAs: ${lgas.length}, wards: ${wards.length}, polling units: ${pollingUnits.length}`);
  console.log(`Quarantined wards (excluded, never imported): ${QUARANTINED_WARDS.length}`);
  for (const q of QUARANTINED_WARDS) console.log(`  - ${q.state}/${q.lga}/${q.name} (INEC id ${q.inecWardId}): ${q.reason.slice(0, 90)}...`);
  console.log("");

  // Preflight — ALWAYS computed, in both modes, via the exact same
  // read-only function (see this file's own header, point 2/3).
  const plan = await computePlan(client, snapshot);
  printPreflightReport(plan);

  if (DRY_RUN) {
    console.log("DRY RUN COMPLETE — no writes were performed. Re-run with DRY_RUN=false to execute for real.\n");
    return;
  }

  console.log(`SAFE RESUME MODE — ${plan.lgaPlan.alreadyExisting.length} LGA(s) and ${plan.wardPlan.alreadyExisting.length} ward(s) already in the database are left completely untouched; only genuinely new rows (by the database's own unique constraints, via upsert/ignoreDuplicates) will be written.\n`);

  if (hasFatalIssues(plan)) {
    console.error(`ABORTING BEFORE ANY WRITE — ${plan.puCodePreflight.count} polling unit(s) have a missing/blank code and cannot be inserted (geography_polling_units.code is NOT NULL, and this importer will never fabricate one). See the PREFLIGHT report above for exactly which source records need resolution. NO rows were written — not LGAs, not wards, not polling units.\n`);
    process.exitCode = 1;
    return;
  }

  await executeWrites(client, plan);
}

// Only runs the real CLI/database path when executed directly (`node
// import-national-geography.mjs`) — importing this module for its
// exported computePlan()/hasFatalIssues() (see the test suite) must never
// trigger a real run against real environment variables.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Import run failed:", err);
    process.exitCode = 1;
  });
}
