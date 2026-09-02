// ============================================================
// ELECTORAL GEOGRAPHY — PAGINATED REFERENCE-TABLE READS  (National import repair)
//
// Supabase/PostgREST caps every unpaginated `.select()` response at 1,000
// rows by default (the API's own max-rows setting — NOT raised here, on
// purpose: pagination is the correct fix, not a server-config workaround).
// Every table this importer re-reads to build an id-resolution map can
// exceed that cap in real production state today — geography_lgas: 771
// rows, geography_wards: 8,809, geography_polling_units: up to 176,846
// once fully imported — and a silently truncated read produces a
// silently truncated resolution map. That is exactly what produced this
// repair's own "Polling Units — unresolved parent: 159566": only the
// first ~1,000 (of 8,809) real wards were visible to the read that built
// the ward_id map PUs resolve against, so ~88% of every polling unit
// candidate appeared to have no resolvable parent, even though the
// parent ward existed all along.
//
// fetchAllRows() is the ONE place in this importer that reads a
// potentially-large reference table: deterministic order (`.order(...)`)
// plus `.range()` pagination, looping until a page comes back with FEWER
// rows than the page size — the real, observed end of the table, never
// an assumed row count. import-national-geography.mjs calls this SAME
// function for every geography_lgas / geography_wards /
// geography_polling_units read, in BOTH dry-run and live mode — there is
// no other, unpaginated code path left anywhere in that file (see its
// own header on why that symmetry is itself part of this repair's
// dry-run-fidelity fix).
// ============================================================

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Reads every row of `table` via `client`, paginating with `.range()`
 * under a deterministic `.order(orderBy)` so a table with more rows than
 * one page is never silently truncated.
 *
 * `client` only needs to support the exact chain
 * `.from(table).select(select).order(orderBy, {ascending}).range(from, to)`
 * resolving to `{ data, error }` — a real `@supabase/supabase-js` client
 * satisfies this, and so does a small fake object in tests (see
 * test/election-geography-paginated-read.consumer.mjs).
 *
 * @returns Promise<row[]> — every row, in the deterministic order requested.
 */
export async function fetchAllRows(client, table, { select = "*", orderBy = "id", ascending = true, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`fetchAllRows: pageSize must be a positive integer, got ${pageSize}`);
  }
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(select).order(orderBy, { ascending }).range(from, to);
    if (error) throw new Error(`paginated read of ${table} failed at range [${from}, ${to}]: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break; // fewer rows than a full page — the real end of the table, not a guess
    from += pageSize;
  }
  return rows;
}

export default { fetchAllRows };
