// ============================================================
// ELECTIONCANON 1.1 PHASE 1 — ORGANISATIONAL COVERAGE  (MOCK evidence)
//
// Proves src/domains/election/geography/coverage.js's read-only queries:
// exact coverage counts/ids, honest empty-territory behavior, and
// campaign isolation. Uses a plain fake Supabase client over an in-memory
// responsibility_slots table — no live database.
// ============================================================

import { getConstituencyCoverage, getLgaCoverage, getWardCoverage, getUncoveredTerritory, getWardResponsibilityMap } from "../src/domains/election/geography/coverage.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON 1.1 PHASE 1 — Organisational Coverage\n");

function fakeClient(slotRows = []) {
  return {
    from(table) {
      if (table !== "responsibility_slots") throw new Error(`unexpected table ${table}`);
      const builder = {
        _rows: slotRows,
        _filters: [],
        eq(key, value) { this._filters.push((r) => r[key] === value); return this; },
        in(key, values) { this._filters.push((r) => values.includes(r[key])); return this; },
        select() { return this; },
        async maybeSingle() {
          const matched = this._rows.filter((r) => this._filters.every((f) => f(r)));
          return { data: matched[0] ?? null, error: null };
        },
        then(resolve) {
          const matched = this._rows.filter((r) => this._filters.every((f) => f(r)));
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  };
}

const CAMPAIGN_A = "camp-a", CAMPAIGN_B = "camp-b";
const CONSTITUENCY = "constituency-osu";
const LGA_OKPE = "lga-okpe", LGA_SAPELE = "lga-sapele", LGA_UVWIE = "lga-uvwie";
const WARD_1 = "ward-1", WARD_2 = "ward-2", WARD_3 = "ward-3";

const TERRITORY = {
  constituency: { id: CONSTITUENCY, name: "Okpe/Sapele/Uvwie Federal Constituency" },
  lgas: [{ id: LGA_OKPE, name: "Okpe" }, { id: LGA_SAPELE, name: "Sapele" }, { id: LGA_UVWIE, name: "Uvwie" }],
  wards: [
    { id: WARD_1, name: "Ward 1", lgaId: LGA_OKPE },
    { id: WARD_2, name: "Ward 2", lgaId: LGA_OKPE },
    { id: WARD_3, name: "Ward 3", lgaId: LGA_SAPELE },
  ],
};

// ---------- constituency coverage ----------
{
  const covered = await getConstituencyCoverage({ client: fakeClient([{ campaign_id: CAMPAIGN_A, level: "constituency", geography_ref: CONSTITUENCY, current_person: "person-alice" }]), campaignId: CAMPAIGN_A, constituencyId: CONSTITUENCY });
  ok("A1. a constituency with a current lead reports covered: true", covered.data.covered === true);

  const uncovered = await getConstituencyCoverage({ client: fakeClient([]), campaignId: CAMPAIGN_A, constituencyId: CONSTITUENCY });
  ok("A2. a constituency with no responsibility_slots row reports covered: false, never an error", uncovered.data.covered === false && uncovered.error === null);

  const none = await getConstituencyCoverage({ client: fakeClient([]), campaignId: CAMPAIGN_A, constituencyId: null });
  ok("A3. no constituencyId at all returns data: null, never a fabricated result", none.data === null);
}

// ---------- LGA coverage: exact counts ----------
{
  const client = fakeClient([
    { campaign_id: CAMPAIGN_A, level: "lga", geography_ref: LGA_OKPE, current_person: "person-alice" },
    // Sapele and Uvwie deliberately have NO row — genuinely uncovered.
  ]);
  const result = await getLgaCoverage({ client, campaignId: CAMPAIGN_A, lgas: TERRITORY.lgas });
  ok("B1. exactly 3 LGAs returned, matching the supplied territory", result.data.length === 3);
  ok("B2. Okpe is covered", result.data.find((l) => l.id === LGA_OKPE).covered === true);
  ok("B3. Sapele is uncovered (no responsibility_slots row at all)", result.data.find((l) => l.id === LGA_SAPELE).covered === false);
  ok("B4. Uvwie is uncovered", result.data.find((l) => l.id === LGA_UVWIE).covered === false);

  const empty = await getLgaCoverage({ client, campaignId: CAMPAIGN_A, lgas: [] });
  ok("B5. an empty LGA list returns an empty array without querying, never an error", empty.data.length === 0 && empty.error === null);

  // HOME OPERATING CONSOLE — currentPerson exposed alongside covered.
  ok("B6. a covered LGA carries its real currentPerson through", result.data.find((l) => l.id === LGA_OKPE).currentPerson === "person-alice");
  ok("B7. an uncovered LGA's currentPerson is null, never undefined", result.data.find((l) => l.id === LGA_SAPELE).currentPerson === null);
}

// ---------- ward coverage: exact counts, uncovered ids ----------
{
  const client = fakeClient([
    { campaign_id: CAMPAIGN_A, level: "ward", geography_ref: WARD_1, current_person: "person-bob" },
    // A row that EXISTS but is currently VACATED (null person) must still
    // read as uncovered — a slot row existing is not the same as being covered.
    { campaign_id: CAMPAIGN_A, level: "ward", geography_ref: WARD_2, current_person: null },
  ]);
  const result = await getWardCoverage({ client, campaignId: CAMPAIGN_A, wards: TERRITORY.wards });
  ok("C1. exactly 3 wards returned", result.data.length === 3);
  ok("C2. Ward 1 is covered", result.data.find((w) => w.id === WARD_1).covered === true);
  ok("C3. Ward 2 (an EXISTING but vacated slot) correctly reads as uncovered, not covered", result.data.find((w) => w.id === WARD_2).covered === false);
  ok("C4. Ward 3 (no row at all) reads as uncovered", result.data.find((w) => w.id === WARD_3).covered === false);
  ok("C5. each ward carries its parent lgaId through, for grouping", result.data.find((w) => w.id === WARD_1).lgaId === LGA_OKPE);

  // HOME OPERATING CONSOLE — currentPerson exposed alongside covered.
  ok("C6. a covered ward carries its real currentPerson through", result.data.find((w) => w.id === WARD_1).currentPerson === "person-bob");
  ok("C7. an existing-but-vacated ward's currentPerson is null (matches covered: false)", result.data.find((w) => w.id === WARD_2).currentPerson === null);
  ok("C8. a ward with no row at all also reads currentPerson: null, never undefined", result.data.find((w) => w.id === WARD_3).currentPerson === null);
}

// ---------- getUncoveredTerritory: the approved contract ----------
{
  const client = fakeClient([
    { campaign_id: CAMPAIGN_A, level: "constituency", geography_ref: CONSTITUENCY, current_person: "person-alice" },
    { campaign_id: CAMPAIGN_A, level: "lga", geography_ref: LGA_OKPE, current_person: "person-alice" },
    { campaign_id: CAMPAIGN_A, level: "ward", geography_ref: WARD_1, current_person: "person-bob" },
  ]);
  const result = await getUncoveredTerritory({ client, campaignId: CAMPAIGN_A, territory: TERRITORY });
  ok("D1. established: true when a real territory is supplied", result.data.established === true);
  ok("D2. constituencyId is threaded through exactly", result.data.constituencyId === CONSTITUENCY);
  ok("D3. constituencyCovered reflects the real slot", result.data.constituencyCovered === true);
  ok("D4. lgas array has exactly 3 entries, exactly 1 covered", result.data.lgas.length === 3 && result.data.lgas.filter((l) => l.covered).length === 1);
  ok("D5. wards array has exactly 3 entries", result.data.wards.length === 3);
  ok("D6. totalWards is exact", result.data.totalWards === 3);
  ok("D7. coveredWards is exact — only Ward 1", result.data.coveredWards === 1);

  const emptyTerritoryResult = await getUncoveredTerritory({ client, campaignId: CAMPAIGN_A, territory: null });
  ok("D8. no territory set (territory: null) reports established: false — an honest empty state, never a fabricated 0%", emptyTerritoryResult.data.established === false);
  ok("D9. the honest-empty-state result carries zero totals, never undefined/NaN", emptyTerritoryResult.data.totalWards === 0 && emptyTerritoryResult.data.coveredWards === 0);
}

// ---------- getWardResponsibilityMap: the readiness-consumption contract ----------
{
  const client = fakeClient([
    { campaign_id: CAMPAIGN_A, level: "ward", geography_ref: WARD_1, current_person: "person-bob" },
    { campaign_id: CAMPAIGN_A, level: "ward", geography_ref: WARD_2, current_person: null },
  ]);
  const result = await getWardResponsibilityMap({ client, campaignId: CAMPAIGN_A, wardIds: [WARD_1, WARD_2, WARD_3] });
  ok("E1. the map correctly reflects a covered ward", result.data[WARD_1] === "person-bob");
  ok("E2. the map correctly reflects a vacated (existing row, null person) ward", result.data[WARD_2] === null);
  ok("E3. a ward with no row at all is absent from the map (readiness treats a missing key as null via ?? fallback)", !(WARD_3 in result.data));

  const empty = await getWardResponsibilityMap({ client, campaignId: CAMPAIGN_A, wardIds: [] });
  ok("E4. an empty wardIds list returns an empty map without querying", Object.keys(empty.data).length === 0);
}

// ---------- campaign isolation ----------
{
  const client = fakeClient([
    { campaign_id: CAMPAIGN_A, level: "lga", geography_ref: LGA_OKPE, current_person: "person-alice" },
    { campaign_id: CAMPAIGN_B, level: "lga", geography_ref: LGA_OKPE, current_person: null },
  ]);
  const resultA = await getLgaCoverage({ client, campaignId: CAMPAIGN_A, lgas: [{ id: LGA_OKPE, name: "Okpe" }] });
  const resultB = await getLgaCoverage({ client, campaignId: CAMPAIGN_B, lgas: [{ id: LGA_OKPE, name: "Okpe" }] });
  ok("F1. campaign A's coverage query sees only campaign A's own slot (covered)", resultA.data[0].covered === true);
  ok("F2. campaign B's coverage query, for the SAME real geography, sees only its OWN slot (uncovered) — never campaign A's", resultB.data[0].covered === false);
}

// ---------- bounded queries: never a scan of the national PU table ----------
{
  ok("G1. coverage.js never references geography_polling_units at all — PU-level responsibility is deliberately excluded from this aggregate",
     !/geography_polling_units/.test(await (await import("node:fs/promises")).readFile(new URL("../src/domains/election/geography/coverage.js", import.meta.url), "utf8")));
  ok("G2. every query is scoped by campaign_id (never a bare, unscoped select)",
     (await (await import("node:fs/promises")).readFile(new URL("../src/domains/election/geography/coverage.js", import.meta.url), "utf8")).match(/\.eq\("campaign_id"/g)?.length >= 4);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
