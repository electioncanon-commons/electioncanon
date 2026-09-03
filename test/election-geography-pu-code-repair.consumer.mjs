// ============================================================
// ELECTORAL GEOGRAPHY — TARGETED PU-CODE REPAIR  (National import repair, follow-up pass)
//
// Tests derivePuCodePatch()/applyPatchToSnapshot() from
// repair-snapshot-pu-codes.mjs directly — pure logic, no network, no file
// I/O, synthetic inputs. Proves the repair tool's core decision (PATCHED
// vs. GENUINELY_MISSING_SOURCE_CODE vs. NOT_FOUND_IN_LIVE_REFETCH vs.
// WARD_REFETCH_FAILED) is correct and NEVER fabricates a code, matching
// the same "never guess, only report" discipline as the rest of this
// importer's tooling.
//
// Run: node test/election-geography-pu-code-repair.consumer.mjs
// ============================================================

import { derivePuCodePatch, applyPatchToSnapshot } from "../supabase/geography-import/repair-snapshot-pu-codes.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — targeted PU-code repair\n");

// ============================================================
console.log("A — derivePuCodePatch: PATCHED (a real, live-sourced code is recovered)");
// ============================================================
{
  const existingPu = { inecPuId: "612", code: null, name: "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM." };
  const freshWard = { ok: true, parsedPus: [{ id: "612", displayNumber: "003", name: "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM." }] };
  const decision = derivePuCodePatch(existingPu, freshWard);
  ok("A1. a fresh live re-fetch that now yields a real displayNumber is classified PATCHED", decision.action === "PATCHED");
  ok("A2. the patched code is EXACTLY the real INEC display number recovered from the live re-fetch, nothing else", decision.code === "003");
  ok("A3. the patched name is the freshly re-parsed, whitespace-normalized name", decision.name === "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM.");
}

// ============================================================
console.log("\nB — derivePuCodePatch: GENUINELY_MISSING_SOURCE_CODE (never fabricates)");
// ============================================================
{
  const existingPu = { inecPuId: "999999", code: null, name: "SOME PLACE WITH NO NUMBER PREFIX" };
  const freshWard = { ok: true, parsedPus: [{ id: "999999", displayNumber: null, name: "SOME PLACE WITH NO NUMBER PREFIX" }] };
  const decision = derivePuCodePatch(existingPu, freshWard);
  ok("B1. a PU whose live-refetched label STILL has no leading numeric prefix is classified GENUINELY_MISSING_SOURCE_CODE, never PATCHED", decision.action === "GENUINELY_MISSING_SOURCE_CODE");
  ok("B2. no `code` field is present on a GENUINELY_MISSING_SOURCE_CODE decision — nothing to apply, nothing fabricated", decision.code === undefined);
}

// ============================================================
console.log("\nC — derivePuCodePatch: NOT_FOUND_IN_LIVE_REFETCH (never silently dropped)");
// ============================================================
{
  const existingPu = { inecPuId: "612", code: null, name: "OLD LABEL" };
  const freshWard = { ok: true, parsedPus: [{ id: "613", displayNumber: "004", name: "A DIFFERENT PU ENTIRELY" }] }; // 612 no longer present
  const decision = derivePuCodePatch(existingPu, freshWard);
  ok("C1. a PU id that no longer appears in a successful live re-fetch of its own ward is reported, not silently ignored", decision.action === "NOT_FOUND_IN_LIVE_REFETCH");
}

// ============================================================
console.log("\nD — derivePuCodePatch: WARD_REFETCH_FAILED (never guesses on a failed request)");
// ============================================================
{
  const existingPu = { inecPuId: "612", code: null, name: "OLD LABEL" };
  const freshWard = { ok: false, outcome: "REQUEST_FAILED" };
  const decision = derivePuCodePatch(existingPu, freshWard);
  ok("D1. a failed live re-fetch of the parent ward is honestly reported as WARD_REFETCH_FAILED, never treated as 'genuinely missing'", decision.action === "WARD_REFETCH_FAILED");
}

// ============================================================
console.log("\nE — derivePuCodePatch: NEVER FABRICATES — only a real parsed displayNumber is ever used as `code`");
// ============================================================
{
  const cases = [
    { existingPu: { inecPuId: "1", code: null }, freshWard: { ok: true, parsedPus: [{ id: "1", displayNumber: "042", name: "REAL PLACE" }] } },
  ];
  for (const { existingPu, freshWard } of cases) {
    const decision = derivePuCodePatch(existingPu, freshWard);
    ok("E1. the patched code is never the PU's own inecPuId/UUID", decision.code !== existingPu.inecPuId);
    ok("E2. the patched code is never an array index or a bare sequence number invented by this tool", decision.code === "042" && typeof decision.code === "string");
  }
}

// ============================================================
console.log("\nF — applyPatchToSnapshot: MUTATES EXACTLY THE ONE MATCHING RECORD, NOTHING ELSE");
// ============================================================
{
  const snapshot = {
    states: {
      abia: {
        lgas: [{
          id: "l1", name: "AROCHUKWU",
          wards: [{
            id: "25", name: "OVUKWU",
            pollingUnits: [
              { id: "610", code: "001", name: "UNTOUCHED PU" },
              { id: "612", code: null, name: "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM." },
            ],
          }],
        }],
      },
    },
  };
  const before = JSON.parse(JSON.stringify(snapshot)); // deep clone for comparison

  applyPatchToSnapshot(snapshot, { stateKey: "abia", inecLgaId: "l1", inecWardId: "25", inecPuId: "612", code: "003", name: "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM." });

  const patchedPu = snapshot.states.abia.lgas[0].wards[0].pollingUnits.find((p) => p.id === "612");
  const untouchedPu = snapshot.states.abia.lgas[0].wards[0].pollingUnits.find((p) => p.id === "610");
  ok("F1. the targeted PU's code is updated to the real recovered value", patchedPu.code === "003");
  ok("F2. the targeted PU's name is updated to the freshly re-parsed name", patchedPu.name === "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM.");
  ok("F3. every OTHER PU in the same ward is left byte-for-byte untouched", JSON.stringify(untouchedPu) === JSON.stringify(before.states.abia.lgas[0].wards[0].pollingUnits[0]));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
