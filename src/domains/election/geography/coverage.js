// ============================================================
// FORGE ELECTION — ORGANISATIONAL COVERAGE  (ElectionCanon 1.1 Phase 1)
//
// Read-only, derived from responsibility_slots (the current-state
// projection over responsibility.assigned/responsibility.reassigned
// events — see supabase/migrations/20260903000000_election_
// responsibility_reassignment.sql) joined against the campaign's own
// already-resolved territory. This computes nothing new — a slot is
// "covered" purely because a real, currently-active responsibility exists
// for it, exactly the same fact Organisation itself already records; this
// module is a read model over that fact, not a second one.
//
// SCOPE: constituency lead, LGA coordinators, ward coordinators only.
// Polling-unit-level responsibility coverage is DELIBERATELY excluded —
// 176,846 PUs nationally makes PU-level organisational coverage
// impractical as a glance-able aggregate, and Mobilize's own existing
// Coverage tab already answers a related but different question (agent
// field-coverage, via ELECTION_DAY.AGENT_ASSIGNED) — this module does not
// duplicate it. A POLLING_UNIT_AGENT responsibility slot can still be
// individually assigned/reassigned; it is just not aggregated here.
//
// PERFORMANCE. Every query below is scoped to ONE campaign's OWN selected
// constituency — a bounded handful of LGAs and, at most, a few dozen to
// low-hundred wards, never the 176,846-row national polling-unit table.
// No caching, no materialization — see this repository's Design Gate 1
// Part 2 for the full reasoning (a plain indexed join at this scale is
// sub-millisecond; materializing would solve a problem that doesn't
// exist at single-campaign scope).
//
// Every function returns `{ data, error }` verbatim (never throws),
// matching every other read module's own convention (geography/read.js).
// ============================================================

/** Constituency-lead coverage — a single boolean. */
export async function getConstituencyCoverage({ client, campaignId, constituencyId }) {
  if (!constituencyId) return { data: null, error: null };
  const { data, error } = await client
    .from("responsibility_slots")
    .select("current_person")
    .eq("campaign_id", campaignId).eq("level", "constituency").eq("geography_ref", constituencyId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: { constituencyId, covered: Boolean(data?.current_person) }, error: null };
}

/** LGA coverage for every LGA the caller supplies (the campaign's own
 *  already-resolved constituency's LGAs — see getConstituencyTerritory()). */
export async function getLgaCoverage({ client, campaignId, lgas = [] } = {}) {
  if (lgas.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from("responsibility_slots")
    .select("geography_ref, current_person")
    .eq("campaign_id", campaignId).eq("level", "lga").in("geography_ref", lgas.map((l) => l.id));
  if (error) return { data: null, error };
  const byRef = new Map((data ?? []).map((r) => [r.geography_ref, r.current_person]));
  return { data: lgas.map((l) => ({ id: l.id, name: l.name, covered: Boolean(byRef.get(l.id)) })), error: null };
}

/** Ward coverage for every ward the caller supplies. */
export async function getWardCoverage({ client, campaignId, wards = [] } = {}) {
  if (wards.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from("responsibility_slots")
    .select("geography_ref, current_person")
    .eq("campaign_id", campaignId).eq("level", "ward").in("geography_ref", wards.map((w) => w.id));
  if (error) return { data: null, error };
  const byRef = new Map((data ?? []).map((r) => [r.geography_ref, r.current_person]));
  return {
    data: wards.map((w) => ({ id: w.id, name: w.name, lgaId: w.lgaId ?? w.lga_id ?? null, covered: Boolean(byRef.get(w.id)) })),
    error: null,
  };
}

/**
 * THE APPROVED CONTRACT (Design Gate 1 Part 2/21) — the one entry point a
 * future Home console will consume. Composes the three queries above
 * against a campaign's own already-resolved territory (the SAME
 * {constituency, lgas, wards} shape geography/read.js's
 * getConstituencyTerritory() already returns — this function does not
 * fetch geography itself, matching every other read module's convention
 * of taking real reference data as an argument rather than re-deriving
 * it).
 *
 * HONEST EMPTY STATE. If `territory` is null (no TERRITORY.SET event
 * recorded yet), returns `established: false` — never a fabricated 0% and
 * never an empty table silently pretending there is nothing to cover.
 */
export async function getUncoveredTerritory({ client, campaignId, territory = null } = {}) {
  if (!territory) {
    return {
      data: { established: false, constituencyId: null, constituencyCovered: false, lgas: [], wards: [], totalWards: 0, coveredWards: 0 },
      error: null,
    };
  }
  const { constituency = null, lgas = [], wards = [] } = territory;
  const constituencyId = constituency?.id ?? null;

  const [constResult, lgaResult, wardResult] = await Promise.all([
    getConstituencyCoverage({ client, campaignId, constituencyId }),
    getLgaCoverage({ client, campaignId, lgas }),
    getWardCoverage({ client, campaignId, wards }),
  ]);
  if (constResult.error) return { data: null, error: constResult.error };
  if (lgaResult.error) return { data: null, error: lgaResult.error };
  if (wardResult.error) return { data: null, error: wardResult.error };

  const coveredWards = wardResult.data.filter((w) => w.covered).length;

  return {
    data: {
      established: true,
      constituencyId,
      constituencyCovered: constResult.data?.covered ?? false,
      lgas: lgaResult.data,
      wards: wardResult.data,
      totalWards: wardResult.data.length,
      coveredWards,
    },
    error: null,
  };
}

/** Current-responsibility-per-ward map — `{[wardGeographyRef]:
 *  currentPersonOrNull}` — the exact shape studio/readiness.js's
 *  deriveReadiness()'s new `wardResponsibility` parameter expects. Kept
 *  separate from getWardCoverage() (which returns an array shaped for
 *  display) since a map is what a pure fold-consuming function needs to
 *  index by ward id in O(1), not re-scan a list per ward. */
export async function getWardResponsibilityMap({ client, campaignId, wardIds = [] } = {}) {
  if (wardIds.length === 0) return { data: {}, error: null };
  const { data, error } = await client
    .from("responsibility_slots")
    .select("geography_ref, current_person")
    .eq("campaign_id", campaignId).eq("level", "ward").in("geography_ref", wardIds);
  if (error) return { data: null, error };
  const map = {};
  for (const row of data ?? []) map[row.geography_ref] = row.current_person ?? null;
  return { data: map, error: null };
}

export default { getConstituencyCoverage, getLgaCoverage, getWardCoverage, getUncoveredTerritory, getWardResponsibilityMap };
