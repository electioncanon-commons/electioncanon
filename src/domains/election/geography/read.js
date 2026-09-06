// ============================================================
// FORGE ELECTION — ELECTORAL GEOGRAPHY READS
//
// Plain reads against the geography_* reference tables (supabase/
// migrations/20260829000000_election_geography.sql). This is NOT Canon
// data — it carries no campaign scope, no PREPARE/APPROVE step, because it
// is objective shared reference data, not a fact about any one campaign
// (see that migration's own header). RLS at the database layer (public SELECT
// to any authenticated user) is the entire access-control story here; no
// adapter wrapping is needed, the same precedent Election.jsx already sets
// for a plain `supabase.from("campaigns").select("name")` read.
//
// Every function returns `{ data, error }` verbatim from the underlying
// Supabase call (never throws) so callers can render an honest error state
// rather than a silent empty list.
// ============================================================

export async function listOffices({ client }) {
  return client.from("geography_offices").select("id, name, boundary_level, sort_order").order("sort_order");
}

export async function listStates({ client }) {
  return client.from("geography_states").select("code, name, sort_order").order("sort_order");
}

export async function listConstituencies({ client, officeId, stateCode }) {
  if (!officeId || !stateCode) return { data: [], error: null };
  return client.from("geography_constituencies").select("id, office_id, state_code, name")
    .eq("office_id", officeId).eq("state_code", stateCode).order("name");
}

/** Returns the real LGAs and wards under a constituency, plus a
 *  polling-unit TOTAL (count only, never the full row list — see the
 *  scale-hardening note below), and the naturally-empty results (until a
 *  real import lands) show as zero — see supabase/geography-import/README.md.
 *  Never fabricates a row that isn't actually in the table.
 *
 *  SCALE NOTE: LGAs and wards are fetched as full rows because they stay
 *  small and bounded (a federal constituency has a handful of LGAs, at
 *  most a few dozen wards) and the Territory Explorer needs their names/ids
 *  immediately to render the LGA -> ward drill-down. Polling units are
 *  DIFFERENT — a single constituency can have hundreds to low thousands of
 *  them, so this function never fetches that full list; only a bounded
 *  count (`{count:'exact', head:true}`, no row data transferred). The
 *  actual polling-unit ROWS for one specific ward are fetched lazily, only
 *  when a user expands that ward — see listPollingUnitsForWard() below,
 *  used by TerritoryExplorer.jsx's ward-click handler. This is the
 *  "Ward -> polling units" progressive-disclosure step; "Constituency ->
 *  everything" is exactly the unbounded pattern this function avoids. */
export async function getConstituencyTerritory({ client, constituencyId }) {
  if (!constituencyId) return { data: null, error: null };

  const { data: constituency, error: constituencyError } = await client
    .from("geography_constituencies").select("id, office_id, state_code, name").eq("id", constituencyId).maybeSingle();
  if (constituencyError) return { data: null, error: constituencyError };
  if (!constituency) return { data: null, error: null };

  const { data: lgaLinks, error: lgaLinksError } = await client
    .from("geography_constituency_lgas").select("lga_id, geography_lgas(id, name, state_code)").eq("constituency_id", constituencyId);
  if (lgaLinksError) return { data: null, error: lgaLinksError };

  const lgas = (lgaLinks ?? [])
    .map((row) => row.geography_lgas)
    .filter(Boolean)
    .map((row) => ({ id: row.id, name: row.name, stateCode: row.state_code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lgaIds = lgas.map((l) => l.id);
  let wards = [];
  if (lgaIds.length > 0) {
    const { data: wardRows, error: wardsError } = await client
      .from("geography_wards").select("id, lga_id, name").in("lga_id", lgaIds).order("name");
    if (wardsError) return { data: null, error: wardsError };
    wards = wardRows ?? [];
  }

  const wardIds = wards.map((w) => w.id);
  let pollingUnitTotal = 0;
  if (wardIds.length > 0) {
    const { count, error: puCountError } = await client
      .from("geography_polling_units").select("id", { count: "exact", head: true }).in("ward_id", wardIds);
    if (puCountError) return { data: null, error: puCountError };
    pollingUnitTotal = count ?? 0;
  }

  return { data: { constituency, lgas, wards, pollingUnitTotal }, error: null };
}

/** State-level territory (Governor/President — office.boundary_level is
 *  'state'/'national', so TERRITORY.SET carries no constituency). Mirrors
 *  getConstituencyTerritory()'s exact return shape AND exact ward/PU-total
 *  logic ({lgas, wards, pollingUnitTotal} — full ward rows, PU count-only,
 *  same scale-hardening reasoning) — the only difference is resolving LGAs
 *  DIRECTLY from geography_lgas by state_code instead of through
 *  geography_constituency_lgas, since a state-wide office's territory isn't
 *  scoped to any one constituency. */
export async function getStateTerritory({ client, stateCode }) {
  if (!stateCode) return { data: null, error: null };

  const { data: lgaRows, error: lgaError } = await client
    .from("geography_lgas").select("id, name, state_code").eq("state_code", stateCode).order("name");
  if (lgaError) return { data: null, error: lgaError };
  const lgas = (lgaRows ?? []).map((row) => ({ id: row.id, name: row.name, stateCode: row.state_code }));

  const lgaIds = lgas.map((l) => l.id);
  let wards = [];
  if (lgaIds.length > 0) {
    const { data: wardRows, error: wardsError } = await client
      .from("geography_wards").select("id, lga_id, name").in("lga_id", lgaIds).order("name");
    if (wardsError) return { data: null, error: wardsError };
    wards = wardRows ?? [];
  }

  const wardIds = wards.map((w) => w.id);
  let pollingUnitTotal = 0;
  if (wardIds.length > 0) {
    const { count, error: puCountError } = await client
      .from("geography_polling_units").select("id", { count: "exact", head: true }).in("ward_id", wardIds);
    if (puCountError) return { data: null, error: puCountError };
    pollingUnitTotal = count ?? 0;
  }

  return { data: { lgas, wards, pollingUnitTotal }, error: null };
}

export async function listWardsForLga({ client, lgaId }) {
  if (!lgaId) return { data: [], error: null };
  return client.from("geography_wards").select("id, lga_id, name").eq("lga_id", lgaId).order("name");
}

export async function listPollingUnitsForWard({ client, wardId }) {
  if (!wardId) return { data: [], error: null };
  return client.from("geography_polling_units").select("id, ward_id, code, name").eq("ward_id", wardId).order("code");
}

/** Polling-unit COUNTS for every ward in a caller-supplied, already-bounded
 *  list — e.g. an LGA Coordinator's own ~12 wards, never a state or
 *  national list. One query, one column (`ward_id`), never a full PU row —
 *  the exact scale-hardening discipline getConstituencyTerritory()'s own
 *  header already documents, extended to a per-ward breakdown instead of a
 *  single grand total. Avoids the N+1 alternative (one count query per
 *  ward) a naive "show each ward's PU count" list would otherwise need. */
export async function getPollingUnitCountsByWard({ client, wardIds = [] }) {
  if (wardIds.length === 0) return { data: {}, error: null };
  const { data, error } = await client
    .from("geography_polling_units").select("ward_id").in("ward_id", wardIds);
  if (error) return { data: null, error };
  const counts = {};
  for (const id of wardIds) counts[id] = 0;
  for (const row of data ?? []) counts[row.ward_id] = (counts[row.ward_id] ?? 0) + 1;
  return { data: counts, error: null };
}

export default {
  listOffices, listStates, listConstituencies, getConstituencyTerritory, getStateTerritory,
  listWardsForLga, listPollingUnitsForWard, getPollingUnitCountsByWard,
};
