// ============================================================
// ELECTORAL GEOGRAPHY — PAGINATED REFERENCE-TABLE READS  (National import repair)
//
// Tests fetchAllRows() directly against a FAKE Supabase-shaped client
// (in-memory rows, no real network/database) — proves it genuinely pages
// past PostgREST's real 1,000-row default cap rather than trusting a
// single big response, and that it never raises the page-size setting to
// work around the cap (see paginated-read.mjs's own header).
//
// Run: node test/election-geography-paginated-read.consumer.mjs
// ============================================================

import { fetchAllRows } from "../supabase/geography-import/paginated-read.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — paginated reference-table reads\n");

/** A fake client shaped exactly like the real @supabase/supabase-js chain
 *  `.from(table).select(select).order(orderBy, {ascending}).range(from,to)`
 *  -> Promise<{data, error}>, backed by an in-memory row array. Counts
 *  every `.range()` call made so tests can prove pagination genuinely
 *  happened (multiple round trips), not just that all rows came back. */
function makeFakeClient(rows, { errorOnPage = null } = {}) {
  let rangeCalls = 0;
  const client = {
    from(table) {
      return {
        select(_select) {
          return {
            order(orderBy, { ascending = true } = {}) {
              const sorted = [...rows].sort((a, b) => {
                if (a[orderBy] < b[orderBy]) return ascending ? -1 : 1;
                if (a[orderBy] > b[orderBy]) return ascending ? 1 : -1;
                return 0;
              });
              return {
                async range(from, to) {
                  rangeCalls++;
                  if (errorOnPage !== null && rangeCalls === errorOnPage) {
                    return { data: null, error: { message: `simulated failure on page ${rangeCalls}` } };
                  }
                  return { data: sorted.slice(from, to + 1), error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, getRangeCalls: () => rangeCalls };
}

// ============================================================
console.log("A — fetchAllRows: RETRIEVES EVERY ROW PAST THE 1,000-ROW DEFAULT CAP");
// ============================================================
{
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(6, "0"), name: `row-${i}` }));
  const { client, getRangeCalls } = makeFakeClient(rows);
  const result = await fetchAllRows(client, "geography_wards", { select: "id, name" });
  ok("A1. all 2,500 rows are returned, none dropped by a 1,000-row cap", result.length === 2500);
  ok("A2. rows come back in the requested deterministic order", result[0].id === "000000" && result[2499].id === "002499");
  ok("A3. pagination genuinely happened — more than one real page fetch, not one big response", getRangeCalls() >= 3);
}

// ============================================================
console.log("\nB — fetchAllRows: THE EXACT 8,809-WARD PRODUCTION SCALE");
// ============================================================
{
  const rows = Array.from({ length: 8809 }, (_, i) => ({ id: String(i).padStart(6, "0"), lga_id: `lga-${i % 771}`, name: `ward-${i}` }));
  const { client } = makeFakeClient(rows);
  const result = await fetchAllRows(client, "geography_wards", { select: "id, lga_id, name" });
  ok("B1. all 8,809 real production-scale wards are retrieved, not just the first 1,000", result.length === 8809);
}

// ============================================================
console.log("\nC — fetchAllRows: >1,000 EXISTING POLLING UNITS");
// ============================================================
{
  const rows = Array.from({ length: 17280 }, (_, i) => ({ id: String(i).padStart(6, "0"), ward_id: `ward-${i % 8809}`, code: String((i % 999) + 1).padStart(3, "0") }));
  const { client } = makeFakeClient(rows);
  const result = await fetchAllRows(client, "geography_polling_units", { select: "id, ward_id, code" });
  ok("C1. all 17,280 existing/candidate polling units are retrieved across many pages", result.length === 17280);
}

// ============================================================
console.log("\nD — fetchAllRows: BOUNDARY AND EMPTY-TABLE BEHAVIOR");
// ============================================================
{
  const exactlyOnePage = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, "0") }));
  const { client: c1, getRangeCalls: calls1 } = makeFakeClient(exactlyOnePage);
  const r1 = await fetchAllRows(c1, "geography_lgas", { select: "id" });
  ok("D1. a table with EXACTLY one page's worth of rows returns all of them, correctly detecting the end (an extra empty page fetch, not an off-by-one drop)", r1.length === 1000 && calls1() === 2);

  const { client: c2 } = makeFakeClient([]);
  const r2 = await fetchAllRows(c2, "geography_lgas", { select: "id" });
  ok("D2. an empty table resolves to an empty array, never throws, never loops forever", Array.isArray(r2) && r2.length === 0);

  const small = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const { client: c3 } = makeFakeClient(small);
  const r3 = await fetchAllRows(c3, "geography_lgas", { select: "id" });
  ok("D3. a table smaller than one page returns exactly its own rows", r3.length === 3);
}

// ============================================================
console.log("\nE — fetchAllRows: A REAL PAGE-LEVEL ERROR PROPAGATES, NEVER SILENTLY TRUNCATES");
// ============================================================
{
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i) }));
  const { client } = makeFakeClient(rows, { errorOnPage: 2 });
  let threw = false;
  try {
    await fetchAllRows(client, "geography_wards", { select: "id" });
  } catch (err) {
    threw = true;
    ok("E1. the thrown error names the table and the failing range, not a generic message", /geography_wards/.test(err.message) && /range/.test(err.message));
  }
  ok("E2. a mid-pagination read error throws rather than silently returning a truncated result", threw);
}

// ============================================================
console.log("\nF — fetchAllRows: DOES NOT WORK AROUND THE CAP BY RAISING PAGE SIZE PAST 1,000 ITSELF");
// ============================================================
{
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: String(i).padStart(4, "0") }));
  const { client, getRangeCalls } = makeFakeClient(rows);
  await fetchAllRows(client, "geography_polling_units", { select: "id" }); // default pageSize, no override
  ok("F1. the default page size stays at (or under) PostgREST's own 1,000-row cap, real pagination does the work instead", getRangeCalls() === 4);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
