// ============================================================
// ELECTORAL GEOGRAPHY — NATIONAL IMPORT PLANNING  (Production import pass)
//
// Tests import-plan.mjs's pure functions directly — no network, no
// database, synthetic data only. This is what proves import idempotency,
// quarantine handling, parent-integrity resolution, and duplicate
// prevention BEFORE any of it runs against a real database.
//
// Run: node test/election-geography-national-import-plan.consumer.mjs
// ============================================================

import {
  resolveIds, flattenSnapshot, planLgaImport, planWardImport, planPuImport, chunk,
  preflightPuCodes, splitResolutionCounts, PENDING_INSERT_PREFIX, normalizeGeographyName,
} from "../supabase/geography-import/import-plan.mjs";
import { QUARANTINED_WARD_IDS } from "../supabase/geography-import/quarantine.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — national import planning\n");

// ============================================================
console.log("A — flattenSnapshot: NESTED -> FLAT, PARENT REFERENCES PRESERVED");
// ============================================================
{
  const states = {
    delta: {
      code: "delta",
      lgas: [{
        id: "199", name: "Okpe",
        wards: [{ id: "2298", name: "OREROKPE", pollingUnits: [{ id: "30405", code: "001", name: "PAVILION" }] }],
      }],
    },
  };
  const flat = flattenSnapshot(states);
  ok("A1. one LGA, one ward, one PU, all present", flat.lgas.length === 1 && flat.wards.length === 1 && flat.pollingUnits.length === 1);
  ok("A2. the ward carries its real INEC parent lga id forward", flat.wards[0].inecLgaId === "199");
  ok("A3. the PU carries its real INEC parent ward id forward", flat.pollingUnits[0].inecWardId === "2298");
  ok("A4. the LGA carries its state code forward", flat.lgas[0].stateCode === "delta");
  ok("A5. the PU also carries its full ancestry (state/LGA) forward — needed by preflightPuCodes()'s report",
    flat.pollingUnits[0].stateCode === "delta" && flat.pollingUnits[0].inecLgaId === "199" && flat.pollingUnits[0].lgaName === "Okpe" && flat.pollingUnits[0].wardName === "OREROKPE");
}

// ============================================================
console.log("\nB — resolveIds: INEC ID -> REAL DATABASE ID, BY NAME UNDER THE CORRECT SCOPE");
// ============================================================
{
  const items = [{ inecId: "199", key: "delta::okpe" }, { inecId: "203", key: "delta::sapele" }];
  const dbRows = [{ id: "uuid-okpe", key: "delta::okpe" }]; // Sapele not yet in the DB
  const { map, unresolved } = resolveIds(items, (i) => i.inecId, (i) => i.key, dbRows, (r) => r.key, (r) => r.id);
  ok("B1. a real match resolves to the real database id", map.get("199") === "uuid-okpe");
  ok("B2. no match for Sapele -> reported as unresolved, never silently dropped or guessed", unresolved.length === 1 && unresolved[0].inecId === "203");
  ok("B3. resolveIds never invents an id for something it can't find", !map.has("203"));
}

// ============================================================
console.log("\nC — planLgaImport: IDEMPOTENCY / NO DUPLICATE CREATION");
// ============================================================
{
  const flatLgas = [
    { stateCode: "delta", name: "Okpe" }, { stateCode: "delta", name: "Sapele" }, { stateCode: "delta", name: "Uvwie" },
  ];
  const existingLgas = [{ state_code: "delta", name: "Okpe" }, { state_code: "delta", name: "Sapele" }, { state_code: "delta", name: "Uvwie" }];
  const plan = planLgaImport(flatLgas, existingLgas);
  ok("C1. all 3 already-existing Delta LGAs are recognised as existing, ZERO proposed for insert (the exact Okpe/Sapele/Uvwie reconciliation this pass exists to prove)",
    plan.toInsert.length === 0 && plan.alreadyExisting.length === 3);

  const withNewState = [...flatLgas, { stateCode: "bayelsa", name: "Brass" }];
  const plan2 = planLgaImport(withNewState, existingLgas);
  ok("C2. a genuinely new LGA (different state) IS proposed for insert", plan2.toInsert.length === 1 && plan2.toInsert[0].name === "Brass");
  ok("C3. running the SAME plan twice is idempotent — identical result both times",
    JSON.stringify(planLgaImport(withNewState, existingLgas)) === JSON.stringify(plan2));
}

// ============================================================
console.log("\nD — planWardImport: QUARANTINE, PARENT RESOLUTION, DUPLICATE PREVENTION");
// ============================================================
{
  const flatWards = [
    { inecWardId: "1462", inecLgaId: "1000", stateCode: "benue", lgaName: "GWER EAST", name: "MBAIKYAAN" },
    { inecWardId: "8810", inecLgaId: "1000", stateCode: "benue", lgaName: "GWER EAST", name: "MBAIKYAAN" }, // the quarantined duplicate
    { inecWardId: "2298", inecLgaId: "199", stateCode: "delta", lgaName: "Okpe", name: "OREROKPE" },
    { inecWardId: "9999", inecLgaId: "no-such-lga", stateCode: "nowhere", lgaName: "GHOST", name: "PHANTOM WARD" },
  ];
  const lgaIdMap = new Map([["1000", "uuid-gwer-east"], ["199", "uuid-okpe"]]); // "no-such-lga" deliberately unresolved
  const existingWards = []; // fresh import — nothing exists yet
  const quarantinedIds = new Set(["8810"]);

  const plan = planWardImport(flatWards, lgaIdMap, existingWards, quarantinedIds);
  ok("D1. the quarantined ward (INEC id 8810) is separated out, never proposed for insert", plan.quarantined.length === 1 && plan.quarantined[0].inecWardId === "8810");
  ok("D2. the REAL Benue ward (id 1462) is NOT quarantined — only the empty duplicate is", !plan.quarantined.some((w) => w.inecWardId === "1462"));
  ok("D3. a ward whose parent LGA never resolved is reported as unresolvedParent, never silently inserted with a null/guessed lga_id",
    plan.unresolvedParent.length === 1 && plan.unresolvedParent[0].inecWardId === "9999");
  ok("D4. the two genuinely resolvable, non-quarantined wards are proposed for insert (against a fresh/empty existing set)", plan.toInsert.length === 2);
  ok("D5. the resolved wards carry the REAL database lga_id, not the INEC one", plan.toInsert.every((w) => w.lgaId.startsWith("uuid-")));

  // Idempotency: re-running against a DB that now has those 2 wards -> 0 new inserts, 2 already-existing, quarantine/unresolved unchanged.
  const existingAfterFirstRun = [{ lga_id: "uuid-gwer-east", name: "MBAIKYAAN" }, { lga_id: "uuid-okpe", name: "OREROKPE" }];
  const plan2 = planWardImport(flatWards, lgaIdMap, existingAfterFirstRun, quarantinedIds);
  ok("D6. re-running the SAME import after a successful first run proposes ZERO new inserts (idempotent, no duplicate creation)",
    plan2.toInsert.length === 0 && plan2.alreadyExisting.length === 2);
  ok("D7. the quarantine decision is stable across re-runs — still 1 quarantined, not reconsidered", plan2.quarantined.length === 1);
}

// ============================================================
console.log("\nE — planPuImport: PARENT RESOLUTION, DUPLICATE PREVENTION");
// ============================================================
{
  const flatPus = [
    { inecPuId: "30405", inecWardId: "2298", wardName: "OREROKPE", code: "001", name: "PAVILION POLICE STATION I" },
    { inecPuId: "30406", inecWardId: "2298", wardName: "OREROKPE", code: "002", name: "PAVILION POLICE STATION II" },
    { inecPuId: "99999", inecWardId: "no-such-ward", wardName: "GHOST", code: "001", name: "PHANTOM PU" },
  ];
  const wardIdMap = new Map([["2298", "uuid-orerokpe"]]);
  const plan = planPuImport(flatPus, wardIdMap, []);
  ok("E1. both real PUs resolve and are proposed for insert", plan.toInsert.length === 2);
  ok("E2. a PU whose parent ward never resolved is reported, not inserted with a guessed parent", plan.unresolvedParent.length === 1);

  const existingAfterRun = [{ ward_id: "uuid-orerokpe", code: "001" }, { ward_id: "uuid-orerokpe", code: "002" }];
  const plan2 = planPuImport(flatPus, wardIdMap, existingAfterRun);
  ok("E3. idempotent re-run — both already-imported PUs recognised as existing, zero new inserts", plan2.toInsert.length === 0 && plan2.alreadyExisting.length === 2);
}

// ============================================================
console.log("\nF — chunk: BOUNDED BATCH SIZES FOR LARGE-SCALE WRITES");
// ============================================================
{
  const items = Array.from({ length: 176846 }, (_, i) => i);
  const chunks = chunk(items, 1000);
  ok("F1. every item is preserved across all chunks, none dropped/duplicated", chunks.reduce((s, c) => s + c.length, 0) === 176846);
  ok("F2. no chunk exceeds the configured size", chunks.every((c) => c.length <= 1000));
  ok("F3. the last chunk correctly holds the remainder", chunks[chunks.length - 1].length === 176846 % 1000);
  ok("F4. an empty list produces zero chunks, never a single empty chunk", chunk([], 500).length === 0);
}

// ============================================================
console.log("\nG — preflightPuCodes: STRICT PU-IDENTITY PREFLIGHT (never fabricates, never drops)");
// ============================================================
{
  const flatPus = [
    { inecPuId: "1", inecWardId: "w1", wardName: "OREROKPE", inecLgaId: "l1", lgaName: "Okpe", stateCode: "delta", code: "001", name: "PAVILION I" },
    { inecPuId: "2", inecWardId: "w1", wardName: "OREROKPE", inecLgaId: "l1", lgaName: "Okpe", stateCode: "delta", code: null, name: "003 - NDI OJI ABAM" },
    { inecPuId: "3", inecWardId: "w1", wardName: "OREROKPE", inecLgaId: "l1", lgaName: "Okpe", stateCode: "delta", code: "", name: "BLANK CODE PU" },
    { inecPuId: "4", inecWardId: "w1", wardName: "OREROKPE", inecLgaId: "l1", lgaName: "Okpe", stateCode: "delta", code: "   ", name: "WHITESPACE-ONLY CODE PU" },
    { inecPuId: "5", inecWardId: "w1", wardName: "OREROKPE", inecLgaId: "l1", lgaName: "Okpe", stateCode: "delta", code: undefined, name: "UNDEFINED CODE PU" },
  ];
  const { missing, count } = preflightPuCodes(flatPus);
  ok("G1. exactly the 4 null/blank/whitespace/undefined-code PUs are flagged, the 1 valid one is not", count === 4 && !missing.some((p) => p.inecPuId === "1"));
  ok("G2. every flagged record retains its full state/LGA/ward/INEC-id identity for the report — nothing stripped down", missing.every((p) => p.stateCode === "delta" && p.lgaName === "Okpe" && p.wardName === "OREROKPE" && p.inecLgaId === "l1" && p.inecWardId === "w1"));
  ok("G3. never fabricates a code — the flagged records' own `code` field is untouched (still null/blank/whitespace), never a guessed value", missing.find((p) => p.inecPuId === "2").code === null);
  ok("G4. never silently drops a bad record — the length of `missing` matches `count` exactly, both auditable", missing.length === count);

  const clean = [{ inecPuId: "9", code: "010", name: "OK" }];
  ok("G5. a fully clean candidate list reports zero, not omitted", preflightPuCodes(clean).count === 0);
  ok("G6. an empty/null input never throws", preflightPuCodes([]).count === 0 && preflightPuCodes(null).count === 0);
}

// ============================================================
console.log("\nH — splitResolutionCounts / PENDING_INSERT_PREFIX: REAL vs. PENDING RESOLUTION, NEVER CONFLATED");
// ============================================================
{
  ok("H1. PENDING_INSERT_PREFIX is a real, non-empty, distinctive tag", typeof PENDING_INSERT_PREFIX === "string" && PENDING_INSERT_PREFIX.length > 0);

  const map = new Map([
    ["inec-1", "real-uuid-aaa"],
    ["inec-2", "real-uuid-bbb"],
    ["inec-3", `${PENDING_INSERT_PREFIX}delta::sapele`],
  ]);
  const { real, pending, total } = splitResolutionCounts(map);
  ok("H2. real database matches and pending (not-yet-written) matches are counted separately, not merged into one number", real === 2 && pending === 1);
  ok("H3. total always equals the full map size — nothing lost between the two buckets", total === map.size && real + pending === total);

  ok("H4. an all-real map reports zero pending — a genuinely fully-resolved-against-the-database state is honestly distinguishable from a partially-synthetic one",
    splitResolutionCounts(new Map([["a", "uuid-1"], ["b", "uuid-2"]])).pending === 0);
  ok("H5. an empty map reports zero/zero/zero, never throws", (() => { const r = splitResolutionCounts(new Map()); return r.real === 0 && r.pending === 0 && r.total === 0; })());
}

// ============================================================
console.log("\nI — WHITESPACE-NORMALIZED GEOGRAPHY IDENTITY  (production cleanup, 2026-09-02)");
// ============================================================
// A real production incident: a pre-fix parser preserved an embedded
// double space in a handful of live INEC labels (e.g. "UKWA  WEST"). A
// later, correctly-parsed re-import ("UKWA WEST") built a DIFFERENT
// planLgaImport()/planWardImport() dedup key against the exact same
// real-world LGA/ward, so both were accepted as distinct rows — 9 stale
// LGAs and 744 stale wards, all confirmed carrying zero polling units,
// removed by exact UUID after an exhaustive read-only forensic audit
// (not by this test suite — this suite only proves the CODE fix).
{
  // ---- TEST 1: whitespace normalization ----
  ok("I1 [TEST 1] a double internal space collapses to one — the exact production example", normalizeGeographyName("UKWA  WEST") === "UKWA WEST");

  // ---- TEST 2: leading/trailing whitespace ----
  ok("I2 [TEST 2] leading and trailing whitespace is trimmed", normalizeGeographyName("  UKWA WEST  ") === "UKWA WEST");

  // ---- TEST 3: multiple internal whitespace characters (tabs, newlines, repeated runs) ----
  ok("I3 [TEST 3] a mix of tabs/newlines/repeated spaces all collapse to one plain space",
    normalizeGeographyName("  UKWA \t\n  WEST  ") === "UKWA WEST");
  ok("I3b meaningful characters are preserved exactly — case, punctuation, official spelling untouched",
    normalizeGeographyName("Obio/Akpor  -  Port Harcourt") === "Obio/Akpor - Port Harcourt");
  ok("I3c never lowercases the stored display name — normalizeGeographyName is whitespace-only, case stays exactly as given",
    normalizeGeographyName("UKWA  WEST") === "UKWA WEST" && normalizeGeographyName("UKWA  WEST") !== "ukwa west");
  ok("I3d empty/null/undefined never throws, normalizes to an empty string",
    normalizeGeographyName(null) === "" && normalizeGeographyName(undefined) === "" && normalizeGeographyName("") === "");

  // ---- TEST 4: repeated import does not create duplicates, INCLUDING across a whitespace variant ----
  {
    const candidateDoubleSpace = [{ inecLgaId: "l-1", stateCode: "abia", name: "UKWA  WEST" }];
    const noExisting = [];
    const firstRun = planLgaImport(candidateDoubleSpace, noExisting);
    ok("I4a. first import of a double-space-named LGA proposes exactly one insert", firstRun.toInsert.length === 1);
    ok("I4b. the row actually written is the NORMALIZED (single-space) name — the payload itself is clean, not just the comparison", firstRun.toInsert[0].name === "UKWA WEST");

    // Simulate the DB now holding that (correctly normalized) row, then
    // re-run the SAME import (IMPORT(snapshot); IMPORT(snapshot) again).
    const existingAfterFirstRun = [{ state_code: "abia", name: "UKWA WEST" }];
    const secondRunSameCandidate = planLgaImport(candidateDoubleSpace, existingAfterFirstRun);
    ok("I4c. IMPORT(snapshot) twice proposes ZERO new inserts the second time — no duplicate, matching the row the first run actually wrote", secondRunSameCandidate.toInsert.length === 0 && secondRunSameCandidate.alreadyExisting.length === 1);

    // The exact production scenario: a STALE double-space row already
    // exists in the DB (from an old, pre-fix run) and the CURRENT
    // (fixed) candidate is single-space — must be recognized as the
    // same LGA, never proposed as a second insert.
    const staleExisting = [{ state_code: "abia", name: "UKWA  WEST" }]; // stale, double-space, as production actually had
    const freshCandidate = [{ inecLgaId: "l-1", stateCode: "abia", name: "UKWA WEST" }]; // fixed parser output
    const planAgainstStale = planLgaImport(freshCandidate, staleExisting);
    ok("I4d. a whitespace-variant candidate against an existing whitespace-variant row is recognized as the SAME LGA — the exact bug that produced 9 stale duplicates in production, now closed",
      planAgainstStale.toInsert.length === 0 && planAgainstStale.alreadyExisting.length === 1);
  }

  // ---- TEST 5: parent-child identity remains stable across a whitespace variant ----
  {
    const lgaIdMap = new Map([["l-1", "real-lga-uuid-1"]]);
    const staleExistingWards = [{ lga_id: "real-lga-uuid-1", name: "Orile  Agege" }]; // stale double-space ward already in DB
    const freshWardCandidate = [{ inecWardId: "w-1", inecLgaId: "l-1", stateCode: "lagos", lgaName: "Agege", name: "Orile Agege" }]; // fixed candidate
    const wardPlan = planWardImport(freshWardCandidate, lgaIdMap, staleExistingWards, new Set());
    ok("I5a. a whitespace-variant ward candidate resolves to the SAME existing ward, not a second insert under the same LGA",
      wardPlan.toInsert.length === 0 && wardPlan.alreadyExisting.length === 1);
    ok("I5b. the parent LGA id used for matching is the real, stable one from lgaIdMap — parent-child identity never drifts because of a name-whitespace difference",
      wardPlan.alreadyExisting[0].lgaId === "real-lga-uuid-1");
  }

  // ---- TEST 6: polling-unit import still resolves to the correct canonical ward ----
  {
    const wardIdMap = new Map([["w-1", "real-ward-uuid-1"]]);
    const puCandidate = [{ inecPuId: "pu-1", inecWardId: "w-1", wardName: "Orile Agege", code: "001", name: "Orile Agege Primary School" }];
    const puPlan = planPuImport(puCandidate, wardIdMap, []);
    ok("I6. a PU still resolves to its real canonical ward_id after the normalization change — parent resolution for PUs is unaffected by the LGA/ward-level fix",
      puPlan.toInsert.length === 1 && puPlan.toInsert[0].wardId === "real-ward-uuid-1");
  }

  // ---- TEST 7: Benue/GWER EAST/MBAIKYAAN quarantine unaffected by whitespace normalization ----
  {
    ok("I7a. the real production quarantine list still excludes INEC ward id 8810", QUARANTINED_WARD_IDS.has("8810"));
    const lgaIdMap = new Map([["gwer-east", "real-gwer-east-uuid"]]);
    const wards = [
      { inecWardId: "1462", inecLgaId: "gwer-east", stateCode: "benue", lgaName: "GWER EAST", name: "MBAIKYAAN" }, // real, populated
      { inecWardId: "8810", inecLgaId: "gwer-east", stateCode: "benue", lgaName: "GWER EAST", name: "  MBAIKYAAN  " }, // quarantined, even with stray whitespace
    ];
    const plan = planWardImport(wards, lgaIdMap, [], QUARANTINED_WARD_IDS);
    ok("I7b. id 8810 is still quarantined regardless of any whitespace in its own name — quarantine matches by INEC id, never by (normalized) name", plan.quarantined.length === 1 && plan.quarantined[0].inecWardId === "8810");
    ok("I7c. the real ward (1462) is NOT quarantined and IS proposed for insert, name-normalized", plan.toInsert.length === 1 && plan.toInsert[0].inecWardId === "1462" && plan.toInsert[0].name === "MBAIKYAAN");
    ok("I7d. the quarantined duplicate is never merged into or revives as the real ward — it stays completely separate, not silently combined", !plan.toInsert.some((w) => w.inecWardId === "8810") && !plan.alreadyExisting.some((w) => w.inecWardId === "8810"));
  }

  // ---- TEST 8: existing manual Delta seed records remain protected ----
  {
    const manualSeedExisting = [
      { state_code: "delta", name: "Okpe" }, { state_code: "delta", name: "Sapele" }, { state_code: "delta", name: "Uvwie" },
    ];
    const inecCandidates = [
      { inecLgaId: "d-1", stateCode: "delta", name: "Okpe" },
      { inecLgaId: "d-2", stateCode: "delta", name: "Sapele" },
      { inecLgaId: "d-3", stateCode: "delta", name: "Uvwie" },
    ];
    const plan = planLgaImport(inecCandidates, manualSeedExisting);
    ok("I8a. the 3 manual Delta seed LGAs (Okpe/Sapele/Uvwie) are recognized as already-existing, never re-inserted, even after the normalization change", plan.toInsert.length === 0 && plan.alreadyExisting.length === 3);
    ok("I8b. planLgaImport never proposes an UPDATE/rename of an existing row — its return shape has no such action, only toInsert/alreadyExisting; an existing row's own stored name is never touched by this function",
      Object.keys(plan).sort().join(",") === "alreadyExisting,toInsert");
  }
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
