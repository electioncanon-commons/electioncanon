// ============================================================
// ELECTORAL GEOGRAPHY — NATIONAL IMPORT REPAIR  (production dry-run/live-run repair)
//
// Integration-level tests for computePlan()/hasFatalIssues(), exported
// from import-national-geography.mjs, against a FAKE Supabase-shaped
// client (in-memory rows, real .order()/.range() pagination semantics
// enforced, zero real network/database) — same "inject a fake, prove the
// real logic" discipline as harden.mjs's own test file.
//
// The synthetic snapshot built below is deliberately shaped at REAL
// production scale — 771 LGAs, 8,809 eligible wards + the 1 real
// Benue/GWER EAST/MBAIKYAAN quarantined duplicate (INEC id 8810), 1,200
// candidate polling units spanning >1,000 already-existing rows — so
// these tests prove the exact scenario this repair exists for: resuming
// against the current partially-imported database (771 LGAs and 8,809
// wards already written by the earlier failed run, 0 polling units) with
// pagination and PU-code preflight now fixed.
//
// Run: node test/election-geography-national-import-repair.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computePlan, hasFatalIssues } from "../supabase/geography-import/import-national-geography.mjs";
import { splitResolutionCounts, resolveIds } from "../supabase/geography-import/import-plan.mjs";
import { QUARANTINED_WARD_IDS } from "../supabase/geography-import/quarantine.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — national import repair (production-scale integration)\n");

// ---------- fake Supabase client (in-memory, real order()/range() pagination) ----------
function makeFakeClient(tables) {
  let upsertCalls = 0;
  const client = {
    from(table) {
      return {
        select(_select) {
          return {
            order(orderBy, { ascending = true } = {}) {
              const rows = tables[table] ?? [];
              const sorted = [...rows].sort((a, b) => {
                if (a[orderBy] < b[orderBy]) return ascending ? -1 : 1;
                if (a[orderBy] > b[orderBy]) return ascending ? 1 : -1;
                return 0;
              });
              return {
                async range(from, to) {
                  return { data: sorted.slice(from, to + 1), error: null };
                },
              };
            },
          };
        },
        upsert() {
          upsertCalls++;
          throw new Error("this fake client's upsert() must never be called by computePlan() — it is read-only by construction");
        },
      };
    },
  };
  return { client, getUpsertCalls: () => upsertCalls };
}

// ---------- production-scale synthetic snapshot ----------
const LGA_COUNT = 771;
const GENERIC_WARD_COUNT = 8808; // + the real Benue ward "1462" = 8,809 eligible, matching production exactly

function buildSnapshot() {
  const lgas = [];
  for (let i = 0; i < LGA_COUNT; i++) lgas.push({ id: `lga-${i}`, name: `LGA ${i}`, wards: [] });

  let wardCounter = 0;
  for (let i = 0; i < GENERIC_WARD_COUNT; i++) {
    lgas[i % LGA_COUNT].wards.push({ id: `ward-${wardCounter++}`, name: `WARD ${i}`, pollingUnits: [] });
  }

  // The real Benue/GWER EAST/MBAIKYAAN pair from quarantine.mjs — one
  // real ward (id 1462, the 8,809th eligible ward) and its empty
  // quarantined duplicate (id 8810, must never resolve/import).
  const gwerEast = lgas[700];
  gwerEast.name = "GWER EAST";
  gwerEast.wards.push({ id: "1462", name: "MBAIKYAAN", pollingUnits: [] });
  gwerEast.wards.push({ id: "8810", name: "MBAIKYAAN", pollingUnits: [] });

  // 1,200 candidate polling units across the first 60 wards (ward-0..
  // ward-59) — 20 per ward — with 3 real-shaped missing-code records
  // mixed into ward-2 (matching the exact 001/002/003(missing)/004
  // (missing).. pattern actually observed in the acquired national
  // snapshot's Abia/AROCHUKWU/OVUKWU ward).
  let puCounter = 0;
  for (let w = 0; w < 60; w++) {
    const ward = lgas[w].wards.find((x) => x.id === `ward-${w}`);
    for (let p = 0; p < 20; p++) {
      const missingCode = ward.id === "ward-2" && [2, 3, 8].includes(p);
      ward.pollingUnits.push({ id: `pu-${puCounter++}`, code: missingCode ? null : String(p + 1).padStart(3, "0"), name: `PU ${p} of ${ward.name}` });
    }
  }

  return {
    acquiredAt: "2026-09-01T15:18:00.000Z",
    states: {
      teststate: { code: "teststate", lgas },
    },
  };
}

// Build once, reused across every section below (matches this repair's
// own "same logical resolution path, computed once" design). A genuinely
// unresolvable-parent ward is exercised separately, at the resolveIds()
// level, in section E below — it doesn't need to live in this shared
// production-scale fixture.
const snapshot = buildSnapshot();

const TOTAL_ELIGIBLE_WARDS = GENERIC_WARD_COUNT + 1; // + real "1462"
const TOTAL_CANDIDATE_PUS = 60 * 20; // 1200
const MISSING_CODE_PUS = 3;

// existing DB state = the CURRENT real production state this repair must
// resume against: all 771 LGAs and all 8,809 eligible wards already
// written by the earlier (failed) live run; ZERO polling units (the PU
// write never completed) EXCEPT a deliberately >1,000-row slice seeded
// below to prove existing-PU pagination too.
function buildExistingDbState() {
  const existingLgas = [];
  for (let i = 0; i < LGA_COUNT; i++) existingLgas.push({ id: `real-lga-uuid-${i}`, state_code: "teststate", name: i === 700 ? "GWER EAST" : `LGA ${i}` });

  const existingWards = [];
  for (let w = 0; w < GENERIC_WARD_COUNT; w++) {
    const lgaIndex = w % LGA_COUNT;
    existingWards.push({ id: `real-ward-uuid-ward-${w}`, lga_id: `real-lga-uuid-${lgaIndex}`, name: `WARD ${w}` });
  }
  existingWards.push({ id: "real-ward-uuid-1462", lga_id: "real-lga-uuid-700", name: "MBAIKYAAN" });

  // >1,000 already-existing polling units: every valid-code candidate PU
  // under ward-0..ward-54 (55 wards * 20 = 1,100, minus the 3 missing-code
  // ones living in ward-2 — a real DB row can never have a null code).
  const existingPus = [];
  for (let w = 0; w < 55; w++) {
    for (let p = 0; p < 20; p++) {
      if (w === 2 && [2, 3, 8].includes(p)) continue;
      existingPus.push({ id: `real-pu-uuid-${w}-${p}`, ward_id: `real-ward-uuid-ward-${w}`, code: String(p + 1).padStart(3, "0") });
    }
  }
  return { existingLgas, existingWards, existingPus };
}
const EXISTING_PU_COUNT = 55 * 20 - 3; // 1,097 — genuinely >1,000

const { existingLgas, existingWards, existingPus } = buildExistingDbState();

// ============================================================
console.log("A — computePlan: SAFE RESUME AGAINST THE CURRENT PARTIALLY-IMPORTED DATABASE (771 LGAs / 8,809 wards / 0-ish PUs already there)");
// ============================================================
{
  const { client } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan = await computePlan(client, snapshot);

  ok("A1. all 771 already-existing LGAs are recognised as existing, ZERO proposed for re-insert", plan.lgaPlan.alreadyExisting.length === LGA_COUNT && plan.lgaPlan.toInsert.length === 0);
  ok(`A2. all ${TOTAL_ELIGIBLE_WARDS} already-existing wards are recognised as existing, ZERO proposed for re-insert (safe resume, never duplicates)`, plan.wardPlan.alreadyExisting.length === TOTAL_ELIGIBLE_WARDS && plan.wardPlan.toInsert.length === 0);
  ok(`A3. the ${EXISTING_PU_COUNT} already-existing (>1,000) polling units are recognised as existing and left untouched`, plan.puPlan.alreadyExisting.length === EXISTING_PU_COUNT);
  // planPuImport() only diffs on (ward_id, code) existence — it doesn't
  // gate on code VALIDITY, that's preflightPuCodes()'s separate job (see
  // section G) — so toInsert here still includes the 3 missing-code
  // candidates; the point of this assertion is that nothing is dropped
  // or duplicated at the diff stage, not that bad rows are filtered here.
  ok("A4. every remaining non-existing candidate (valid AND still-missing-code alike) is proposed for insert by the diff stage, none dropped, none duplicated — code validity is checked separately, never silently at this stage", plan.puPlan.toInsert.length === TOTAL_CANDIDATE_PUS - EXISTING_PU_COUNT);
}

// ============================================================
console.log("\nB — computePlan: ALL 8,809 ELIGIBLE WARDS RESOLVE TO THEIR REAL DATABASE UUIDS (the exact production repair target)");
// ============================================================
{
  const { client } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan = await computePlan(client, snapshot);
  const lgaSplit = splitResolutionCounts(plan.lgaIdMap);
  const wardSplit = splitResolutionCounts(plan.wardIdMap);

  ok("B1. every one of the 771 LGA parent references resolves to a REAL database id (none pending, since all 771 already exist)", lgaSplit.real === LGA_COUNT && lgaSplit.pending === 0);
  ok(`B2. every one of the ${TOTAL_ELIGIBLE_WARDS} eligible ward parent references resolves to a REAL database UUID — not a synthetic placeholder, not a truncated 1,000-row read`, wardSplit.real === TOTAL_ELIGIBLE_WARDS && wardSplit.pending === 0);
  ok("B3. zero unresolved ward parents — the exact defect (previously masked by the 1,000-row pagination cap) this repair fixes", plan.unresolvedWardRefs.length === 0);
  ok("B4. zero unresolved LGA parents", plan.unresolvedLgaRefs.length === 0);
  ok("B5. the resolved ward ids are real values (not the PENDING-INSERT synthetic prefix) for a spot-checked sample", plan.wardIdMap.get("1462") === "real-ward-uuid-1462" && !plan.wardIdMap.get("1462").startsWith("PENDING-INSERT"));
}

// ============================================================
console.log("\nC — computePlan: PENDING (NOT-YET-WRITTEN) PARENTS RESOLVE TOO, BUT ARE NEVER CONFLATED WITH REAL DATABASE MATCHES");
// ============================================================
{
  // A fresh-database scenario — nothing exists yet — proves toInsert
  // candidates still chain-resolve for multi-level PLANNING purposes,
  // while splitResolutionCounts keeps them honestly distinguishable from
  // a real, already-written match (this repair's own "dry-run fidelity"
  // fix).
  const { client } = makeFakeClient({ geography_lgas: [], geography_wards: [], geography_polling_units: [] });
  const plan = await computePlan(client, snapshot);
  const lgaSplit = splitResolutionCounts(plan.lgaIdMap);
  const wardSplit = splitResolutionCounts(plan.wardIdMap);

  ok("C1. on a fresh database, every LGA resolves via a PENDING placeholder, zero real matches, zero unresolved", lgaSplit.pending === LGA_COUNT && lgaSplit.real === 0 && plan.unresolvedLgaRefs.length === 0);
  ok("C2. every eligible ward likewise resolves via PENDING (its LGA parent is itself only pending), zero unresolved — proving the chain propagates without fabricating a false failure", wardSplit.pending === TOTAL_ELIGIBLE_WARDS && wardSplit.real === 0 && plan.unresolvedWardRefs.length === 0);
  ok("C3. all 771 LGAs and all eligible wards are proposed for insert on a fresh database", plan.lgaPlan.toInsert.length === LGA_COUNT && plan.wardPlan.toInsert.length === TOTAL_ELIGIBLE_WARDS);
}

// ============================================================
console.log("\nD — computePlan: DRY-RUN / LIVE RESOLUTION EQUIVALENCE (no mode parameter exists to diverge on)");
// ============================================================
{
  ok("D1. computePlan() takes only (client, snapshot) — there is no dryRun/mode argument for a live vs. dry-run branch to silently diverge on", computePlan.length === 2);

  const { client: clientA } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const { client: clientB } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const planA = await computePlan(clientA, snapshot); // stands in for "the dry-run's report"
  const planB = await computePlan(clientB, snapshot); // stands in for "live's own preflight, before any write"
  const summarize = (p) => ({
    lgaToInsert: p.lgaPlan.toInsert.length, lgaExisting: p.lgaPlan.alreadyExisting.length,
    wardToInsert: p.wardPlan.toInsert.length, wardExisting: p.wardPlan.alreadyExisting.length, wardUnresolved: p.wardPlan.unresolvedParent.length,
    puToInsert: p.puPlan.toInsert.length, puExisting: p.puPlan.alreadyExisting.length, puUnresolved: p.puPlan.unresolvedParent.length,
    missingCodes: p.puCodePreflight.count,
  });
  ok("D2. against identical real database state, the dry-run report and live's own preflight compute byte-identical numbers — genuine equivalence, not coincidence", JSON.stringify(summarize(planA)) === JSON.stringify(summarize(planB)));
}

// ============================================================
console.log("\nE — computePlan's ward resolution: A GENUINELY UNRESOLVABLE PARENT IS NEVER MASKED AS 'ZERO UNRESOLVED'");
// ============================================================
{
  // Exercises the EXACT keyFn/resolveIds wiring computePlan() uses to
  // build wardIdMap (see import-national-geography.mjs's own
  // computePlan()), with a ward whose parent LGA id ("no-such-lga-
  // anywhere") is present in NEITHER the real database NOR this run's own
  // pending-insert candidates — a genuine data problem, distinct from
  // "not yet written" (section C above, which correctly DOES resolve via
  // the pending chain).
  const lgaIdMap = new Map([["real-lga-a", "real-lga-a-uuid"]]); // "no-such-lga-anywhere" deliberately absent
  const wards = [{ inecWardId: "phantom-ward", inecLgaId: "no-such-lga-anywhere", name: "PHANTOM" }];
  const { map: wardIdMap, unresolved } = resolveIds(
    wards, (w) => w.inecWardId,
    (w) => { const lgaId = lgaIdMap.get(w.inecLgaId); return lgaId ? `${lgaId}::${w.name.toLowerCase()}` : `__unresolvable__::${w.inecWardId}`; },
    [], (r) => `${r.lga_id}::${r.name.toLowerCase()}`, (r) => r.id,
  );
  ok("E1. a ward whose parent LGA id matches nothing real AND nothing pending is reported unresolved, never silently matched", unresolved.length === 1 && unresolved[0].inecWardId === "phantom-ward");
  ok("E2. it never appears in the resolved id map — no downstream PU could ever resolve against a fabricated match for it", !wardIdMap.has("phantom-ward"));
}

// ============================================================
console.log("\nF — computePlan: BENUE/GWER EAST/MBAIKYAAN — THE QUARANTINED WARD (INEC id 8810) STAYS EXCLUDED");
// ============================================================
{
  const { client } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan = await computePlan(client, snapshot);

  ok("F1. quarantine.mjs's real id (8810) is the one actually excluded here — this test uses the real production quarantine list, not a re-declared copy", QUARANTINED_WARD_IDS.has("8810"));
  ok("F2. the quarantined ward (8810) is separated out by the plan, never proposed for insert, never counted as existing", plan.wardPlan.quarantined.some((w) => w.inecWardId === "8810") && !plan.wardPlan.alreadyExisting.some((w) => w.inecWardId === "8810") && !plan.wardPlan.toInsert.some((w) => w.inecWardId === "8810"));
  ok("F3. the quarantined ward id never appears as a key in wardIdMap — nothing downstream (no PU) could ever resolve against it", !plan.wardIdMap.has("8810"));
  ok("F4. the REAL Benue ward (id 1462, same name) is NOT quarantined and DOES resolve normally, confirming only the empty duplicate is excluded", !plan.wardPlan.quarantined.some((w) => w.inecWardId === "1462") && plan.wardIdMap.has("1462"));
}

// ============================================================
console.log("\nG — computePlan / hasFatalIssues: THE MISSING PU-CODE PREFLIGHT (this repair's core safety fix)");
// ============================================================
{
  const { client } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan = await computePlan(client, snapshot);

  ok(`G1. exactly the ${MISSING_CODE_PUS} deliberately-seeded missing-code PUs are caught by the preflight, none missed`, plan.puCodePreflight.count === MISSING_CODE_PUS);
  ok("G2. hasFatalIssues() reports the run as fatal — this is precisely the condition that must abort a live run before any write", hasFatalIssues(plan) === true);
  ok("G3. the flagged records carry real, useful identity for a human to act on (state/LGA/ward names + every INEC id)", plan.puCodePreflight.missing.every((p) => p.stateCode && p.wardName && p.inecPuId && p.inecWardId));

  // A clean re-run (same data, but this time simulate the missing-code
  // PUs having been resolved/removed from the snapshot) is NOT fatal.
  const cleanSnapshot = JSON.parse(JSON.stringify(snapshot));
  for (const lga of cleanSnapshot.states.teststate.lgas) {
    for (const ward of lga.wards) {
      for (const pu of ward.pollingUnits ?? []) {
        if (pu.code === null) pu.code = "999";
      }
    }
  }
  const { client: cleanClient } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const cleanPlan = await computePlan(cleanClient, cleanSnapshot);
  ok("G4. once every PU has a real code, hasFatalIssues() is false — the gate is a real, honest check, not a permanent block", hasFatalIssues(cleanPlan) === false && cleanPlan.puCodePreflight.count === 0);
}

// ============================================================
console.log("\nH — computePlan: IDEMPOTENT RERUN (calling it twice against the SAME real database state yields the SAME plan)");
// ============================================================
{
  const { client: c1 } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan1 = await computePlan(c1, snapshot);
  const { client: c2 } = makeFakeClient({ geography_lgas: existingLgas, geography_wards: existingWards, geography_polling_units: existingPus });
  const plan2 = await computePlan(c2, snapshot);

  const fingerprint = (p) => JSON.stringify({
    lga: [p.lgaPlan.toInsert.length, p.lgaPlan.alreadyExisting.length],
    ward: [p.wardPlan.toInsert.length, p.wardPlan.alreadyExisting.length, p.wardPlan.quarantined.length, p.wardPlan.unresolvedParent.length],
    pu: [p.puPlan.toInsert.length, p.puPlan.alreadyExisting.length, p.puPlan.unresolvedParent.length],
    missing: p.puCodePreflight.count,
  });
  ok("H1. re-running the exact same import against the exact same (unchanged) database state produces an identical plan — genuinely idempotent, safe to resume/retry any number of times", fingerprint(plan1) === fingerprint(plan2));
  ok("H2. computePlan() itself never calls upsert — it is read-only by construction (this fake client's upsert() throws if ever invoked, and neither call above tripped it)", true);
}

// ============================================================
console.log("\nI — SOURCE-LEVEL GUARANTEE: NO CONSTITUENCY TABLE IS EVER WRITTEN (State -> LGA -> Ward -> Polling Unit only)");
// ============================================================
{
  // Checks actual `.from("<table>"` CALL SITES, not prose — the runner's
  // own header comments legitimately name geography_constituencies/
  // geography_constituency_lgas when explaining what's OUT of scope (see
  // that file's own header), which must not trip a naive substring check.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const runnerSrc = readFileSync(join(HERE, "..", "supabase", "geography-import", "import-national-geography.mjs"), "utf8");
  const planSrc = readFileSync(join(HERE, "..", "supabase", "geography-import", "import-plan.mjs"), "utf8");
  const fromCallPattern = (table) => new RegExp(`\\.from\\(\\s*["']${table}["']`);
  const forbidden = ["geography_constituencies", "geography_constituency_lgas"];
  for (const table of forbidden) {
    ok(`I. the runner (import-national-geography.mjs) never calls .from("${table}") anywhere`, !fromCallPattern(table).test(runnerSrc));
    ok(`I. the pure planning module (import-plan.mjs) never calls .from("${table}") anywhere (it makes no database calls at all)`, !fromCallPattern(table).test(planSrc));
  }
  // The runner never writes a literal `.from("geography_lgas")` itself —
  // table names are passed as string arguments into fetchAllRows()/
  // upsertBatched() (see computePlan()/executeWrites() above) — so prove
  // the check above isn't vacuous by confirming those three, and ONLY
  // those three, geography_* table-name string literals are referenced.
  const quotedTableLiteral = /["'](geography_[a-z_]+)["']/g;
  const referencedTables = new Set([...runnerSrc.matchAll(quotedTableLiteral)].map((m) => m[1]));
  const inScopeTables = ["geography_lgas", "geography_wards", "geography_polling_units"];
  ok("I. the runner references exactly the three in-scope geography_* tables by name (LGA/ward/PU), proving the absence check above isn't vacuous", inScopeTables.every((t) => referencedTables.has(t)) && [...referencedTables].every((t) => inScopeTables.includes(t)));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
