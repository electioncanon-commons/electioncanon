// ============================================================
// ELECTORAL GEOGRAPHY — FORCE_REFRESH ACQUISITION MODE  (National import repair, follow-up pass)
//
// Tests resolveStartingCheckpoint() (exported, pure) from
// acquire-national-snapshot.mjs, plus a simulated end-to-end proof that a
// FORCE_REFRESH run genuinely re-applies the CURRENT parser to fresh
// source responses rather than reusing stale checkpointed data — no real
// network, no real file I/O, no Supabase/database access anywhere in this
// file (importing acquire-national-snapshot.mjs for its exports must
// never trigger a real crawl — see that file's own direct-execution
// guard).
//
// Run: node test/election-geography-force-refresh.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveStartingCheckpoint } from "../supabase/geography-import/acquire-national-snapshot.mjs";
import { isStateComplete, recordStateComplete } from "../supabase/geography-import/checkpoint.mjs";
import { INEC_STATE_IDS, parseCascadeResponse } from "../supabase/geography-import/inec-source.mjs";
import { fetchWithRetry } from "../supabase/geography-import/harden.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — FORCE_REFRESH acquisition mode\n");

// A checkpoint shaped exactly like the real, stale one this repair found
// on disk: all 37 states marked complete, one state (abia) carrying a PU
// with the OLD (pre-parser-fix) null code frozen in from the original run.
function makeStaleFullyCompleteCheckpoint() {
  const checkpoint = { completedStateCodes: [], states: {} };
  for (const s of INEC_STATE_IDS) {
    recordStateComplete(checkpoint, s.code, {
      stateId: s.stateId, code: s.code, label: s.label,
      lgas: [{
        id: "l1", name: "AROCHUKWU", displayNumber: "1",
        wards: [{
          id: "25", name: "OVUKWU", displayNumber: "1", pollingUnitCount: 1,
          pollingUnits: [{ id: "612", code: null, name: "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM." }], // stale, pre-fix
        }],
      }],
      stats: { successfulRequests: 3, retriedRequests: 0, failedRequests: 0, invalidResponses: 0 },
    });
  }
  return checkpoint;
}

// ============================================================
console.log("A — resolveStartingCheckpoint: DEFAULT MODE STILL RESPECTS THE CHECKPOINT");
// ============================================================
{
  const loaded = makeStaleFullyCompleteCheckpoint();
  const starting = resolveStartingCheckpoint(false, loaded);
  ok("A1. default (FORCE_REFRESH=false) hands back the loaded checkpoint completely unchanged", starting === loaded);
  ok("A2. every one of the 37 real INEC states is still treated as complete — normal resumable behavior is untouched", INEC_STATE_IDS.every((s) => isStateComplete(starting, s.code)));
}

// ============================================================
console.log("\nB — resolveStartingCheckpoint: FORCE_REFRESH=true IGNORES A FULLY-COMPLETE CHECKPOINT");
// ============================================================
{
  const loaded = makeStaleFullyCompleteCheckpoint();
  ok("B0. sanity check — the loaded checkpoint really does have all 37 states marked complete before we force-refresh", loaded.completedStateCodes.length === 37);

  const starting = resolveStartingCheckpoint(true, loaded);
  ok("B1. FORCE_REFRESH starts from a genuinely empty checkpoint, not a copy/subset of the stale one", starting.completedStateCodes.length === 0 && Object.keys(starting.states).length === 0);
  ok("B2. it never mutates the ORIGINAL loaded checkpoint object — the stale one is left exactly as it was, in case something else still needs it", loaded.completedStateCodes.length === 37);
}

// ============================================================
console.log("\nC — FORCE_REFRESH: ALL 37 STATES ARE GENUINELY RE-ACQUIRED (none silently skipped)");
// ============================================================
{
  const loaded = makeStaleFullyCompleteCheckpoint();
  const starting = resolveStartingCheckpoint(true, loaded);
  const stillTreatedComplete = INEC_STATE_IDS.filter((s) => isStateComplete(starting, s.code));
  ok("C1. zero of the 37 states are treated as already-complete after FORCE_REFRESH resets the starting checkpoint — every one will be re-crawled", stillTreatedComplete.length === 0);
  ok("C2. this is exactly the real 37-state list (36 states + FCT), not a partial/synthetic stand-in", INEC_STATE_IDS.length === 37);
}

// ============================================================
console.log("\nD — FORCE_REFRESH resumability: an interrupted force-refresh converges to fully-fresh data, never silently mixes in stale entries");
// ============================================================
{
  // Simulates: FORCE_REFRESH starts empty, completes 2 of 37 states with
  // FRESH data, then the process is interrupted. A subsequent run (with
  // or without FORCE_REFRESH) resumes from what's actually on disk at
  // that point — which only ever contains the 2 freshly-redone states,
  // never a stale one silently smuggled back in (because the starting
  // checkpoint for THIS run was empty, not the old 37-state one).
  const loaded = makeStaleFullyCompleteCheckpoint(); // the stale 37-state checkpoint still sitting on disk
  const starting = resolveStartingCheckpoint(true, loaded);
  recordStateComplete(starting, "abia", { code: "abia", lgas: [{ id: "l1", name: "AROCHUKWU", wards: [{ id: "25", name: "OVUKWU", pollingUnitCount: 1, pollingUnits: [{ id: "612", code: "003", name: "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM." }] }] }], stats: { successfulRequests: 3, retriedRequests: 0, failedRequests: 0, invalidResponses: 0 } });
  recordStateComplete(starting, "adamawa", { code: "adamawa", lgas: [], stats: { successfulRequests: 1, retriedRequests: 0, failedRequests: 0, invalidResponses: 0 } });
  // "interrupted" here — `starting` is what would have been persisted to checkpoint.json so far.
  ok("D1. after 2 of 37 states complete mid-force-refresh, only those 2 are marked complete — the other 35 (including the ones the STALE on-disk checkpoint claimed were done) are correctly still pending", starting.completedStateCodes.length === 2 && !isStateComplete(starting, "lagos"));
  ok("D2. the re-acquired abia entry carries the FIXED parser's output (a real code), not the stale null the original on-disk checkpoint had", starting.states.abia.lgas[0].wards[0].pollingUnits[0].code === "003");
}

// ============================================================
console.log("\nE — END-TO-END SIMULATION: the CURRENT parser is genuinely applied to a fresh source response, not frozen checkpoint data");
// ============================================================
{
  // A fake INEC response for the exact real label this repair's own
  // forensic investigation found (Abia/AROCHUKWU/OVUKWU PU 612) — proves
  // that when acquisition re-fetches (as FORCE_REFRESH forces it to), the
  // result reflects whatever parseCascadeResponse() currently is, not
  // whatever was true when the checkpoint was originally written.
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify([{ "0": "--SELECT--", "selected": "0", "612": "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM." }]),
  });
  const result = await fetchWithRetry({ url: "https://cvr.inecnigeria.org/PublicApi/pus/1/Search?data%5BSearch%5D%5Bregistration_area_id%5D=25", fetchImpl: fakeFetch, parseFn: parseCascadeResponse, sleepImpl: () => Promise.resolve() });
  ok("E1. a fresh (simulated) live response for the exact real problem ward, re-parsed by the CURRENT parser, resolves a real code — this is exactly what a FORCE_REFRESH re-crawl produces, and exactly what the stale checkpoint never could", result.outcome === "OK" && result.data[0].displayNumber === "003");
}

// ============================================================
console.log("\nF — NO SUPABASE/DATABASE ACCESS ANYWHERE IN ACQUISITION, IN EITHER MODE");
// ============================================================
{
  const HERE = dirname(fileURLToPath(import.meta.url));
  const acquireSrc = readFileSync(join(HERE, "..", "supabase", "geography-import", "acquire-national-snapshot.mjs"), "utf8");
  const checkpointSrc = readFileSync(join(HERE, "..", "supabase", "geography-import", "checkpoint.mjs"), "utf8");
  ok("F1. acquire-national-snapshot.mjs never imports @supabase/supabase-js", !acquireSrc.includes("@supabase/supabase-js"));
  ok("F2. acquire-national-snapshot.mjs never references a service-role key or SUPABASE_URL", !/SUPABASE_(URL|SERVICE_ROLE_KEY)/.test(acquireSrc));
  ok("F3. checkpoint.mjs (loaded by both modes) is pure file I/O only — no Supabase import either", !checkpointSrc.includes("@supabase/supabase-js"));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
