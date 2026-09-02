// ============================================================
// ELECTORAL GEOGRAPHY — NATIONAL IMPORT PLANNING  (Production import pass)
//
// Pure functions, no network, no database — everything a real import
// decides (what to insert, what already exists, what's quarantined,
// which parent a child resolves to) is computed here and independently
// tested (test/election-geography-national-import-plan.consumer.mjs)
// against synthetic data. import-national-geography.mjs (the runner) is
// TRANSPORT ONLY: read the snapshot, call these functions, execute (or,
// in dry-run mode, only print) the resulting plan.
//
// WHY ID RESOLUTION IS A SEPARATE STEP FROM DIFFING. The snapshot's
// nested structure uses INEC's OWN internal ids as foreign keys (a
// ward's `lgaId` is the INEC lga id it was fetched under). The database
// uses its own generated uuids. A real import must resolve INEC id ->
// real database id (by NAME, under the correct real parent scope) BEFORE
// it can build a valid ward/PU insert payload — resolveIds() does
// exactly this, and reports anything it can't resolve rather than
// silently dropping it.
// ============================================================

/**
 * CANONICAL WHITESPACE NORMALIZATION (production geography cleanup,
 * 2026-09-02). The root cause of a real production duplication incident:
 * a pre-fix parser preserved an embedded double space in a handful of
 * live INEC labels (e.g. "UKWA  WEST"), so a later, correctly-parsed
 * re-import ("UKWA WEST") built a DIFFERENT dedup key against the exact
 * same real-world LGA/ward — neither planLgaImport()'s/planWardImport()'s
 * own key construction nor the database's `unique(...)` constraints are
 * whitespace-insensitive, so both variants were accepted as distinct rows.
 *
 * This function is the ONE place whitespace gets collapsed for BOTH sides
 * of every dedup comparison from now on — applied to freshly-parsed
 * candidate names (defense in depth alongside inec-source.mjs's own
 * parseCascadeResponse() normalization) AND to real names already read
 * back from the database, so an import is robust even against a row an
 * earlier, less-careful run already wrote. It is deliberately NOT the
 * same thing as the case-insensitive comparison every planXImport()
 * already does (`.toLowerCase()`) — that stays a separate step, applied
 * on top of this, so the two concerns (whitespace vs. case) stay legible
 * independently.
 *
 * NEVER changes meaningful characters: trims leading/trailing whitespace,
 * collapses any run of internal whitespace to one plain space, preserves
 * every other character (case, punctuation, official spelling) exactly.
 * "UKWA  WEST" -> "UKWA WEST". "  UKWA   WEST  " -> "UKWA WEST".
 */
export function normalizeGeographyName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Resolves each snapshot item's INEC id to the real database id of the
 * matching already-existing-or-just-inserted parent row, by NAME under
 * the correct composite scope (e.g. LGAs scoped by state_code, wards
 * scoped by their real parent lga_id) — never by name alone, since names
 * repeat across different parents by design (the database's own
 * `unique(parent_id, name)` constraints say so).
 *
 * @param items    snapshot items needing resolution, each with an
 *                 inecId (via idFn) and a scope+name (via keyFn)
 * @param dbRows   real rows already read back from the database, each
 *                 with the SAME scope+name shape (via dbKeyFn) and a
 *                 real id (via dbIdFn)
 * @returns { map: Map<inecId, realDbId>, unresolved: [items with no match] }
 */
export function resolveIds(items, idFn, keyFn, dbRows, dbKeyFn, dbIdFn) {
  const byKey = new Map(dbRows.map((row) => [dbKeyFn(row), dbIdFn(row)]));
  const map = new Map();
  const unresolved = [];
  for (const item of items) {
    const key = keyFn(item);
    const dbId = byKey.get(key);
    if (dbId) map.set(idFn(item), dbId);
    else unresolved.push(item);
  }
  return { map, unresolved };
}

/** Flattens the acquired national snapshot's nested {states:{lgas:{wards:{pollingUnits}}}}
 *  shape into flat arrays, one per level — makes every downstream planning
 *  function operate on plain lists instead of re-walking the tree.
 *  Polling-unit records also carry their full ancestry (stateCode,
 *  inecLgaId, lgaName, inecWardId, wardName) — not needed for the
 *  resolution logic itself (which only needs inecWardId), but required by
 *  preflightPuCodes() so a missing-code report can name exactly which
 *  state/LGA/ward/INEC-id a bad source record belongs to. */
export function flattenSnapshot(states) {
  const lgas = [];
  const wards = [];
  const pollingUnits = [];
  for (const state of Object.values(states)) {
    for (const lga of state.lgas ?? []) {
      lgas.push({ inecLgaId: lga.id, stateCode: state.code, name: lga.name });
      for (const ward of lga.wards ?? []) {
        wards.push({ inecWardId: ward.id, inecLgaId: lga.id, stateCode: state.code, lgaName: lga.name, name: ward.name });
        for (const pu of ward.pollingUnits ?? []) {
          pollingUnits.push({
            inecPuId: pu.id, inecWardId: ward.id, wardName: ward.name,
            inecLgaId: lga.id, lgaName: lga.name, stateCode: state.code,
            code: pu.code, name: pu.name,
          });
        }
      }
    }
  }
  return { lgas, wards, pollingUnits };
}

/** LGA import plan — key = (state_code, name), the database's own real
 *  unique constraint. `existingLgas` are real rows read from
 *  geography_lgas ({state_code, name}). Both sides of the key are run
 *  through normalizeGeographyName() first (see its own header) — a
 *  candidate is recognized as already-existing even if either name
 *  carries whitespace the other doesn't, closing exactly the gap that
 *  produced 9 duplicate LGA rows in production. Every `toInsert` row also
 *  carries its OWN name already normalized, so the payload actually
 *  written is never the source of a future whitespace mismatch either. */
export function planLgaImport(flatLgas, existingLgas) {
  const existingKeys = new Set(existingLgas.map((l) => `${l.state_code}::${normalizeGeographyName(l.name).toLowerCase()}`));
  const toInsert = [];
  const alreadyExisting = [];
  for (const lga of flatLgas) {
    const normalizedName = normalizeGeographyName(lga.name);
    const key = `${lga.stateCode}::${normalizedName.toLowerCase()}`;
    (existingKeys.has(key) ? alreadyExisting : toInsert).push({ ...lga, name: normalizedName });
  }
  return { toInsert, alreadyExisting };
}

/**
 * Ward import plan — separates quarantine from everything else FIRST
 * (a quarantined ward is never even considered for insert/existing
 * classification), then resolves each remaining ward's real lga_id via
 * `lgaIdMap` (built by resolveIds() against the just-upserted/existing
 * LGA rows), then diffs against real existing ward rows scoped by
 * (lga_id, name) — the database's own unique constraint.
 */
export function planWardImport(flatWards, lgaIdMap, existingWards, quarantinedWardIds) {
  const quarantined = [];
  const candidates = [];
  for (const ward of flatWards) {
    if (quarantinedWardIds.has(ward.inecWardId)) quarantined.push(ward);
    else candidates.push(ward);
  }

  const unresolvedParent = [];
  const resolved = [];
  for (const ward of candidates) {
    const lgaId = lgaIdMap.get(ward.inecLgaId);
    if (!lgaId) unresolvedParent.push(ward);
    else resolved.push({ ...ward, lgaId });
  }

  // Same whitespace-normalized-key discipline as planLgaImport() above —
  // see normalizeGeographyName()'s own header. This is what stops a ward
  // whose LGA got correctly deduplicated from itself becoming one of the
  // 744 stale duplicates production hit.
  const existingKeys = new Set(existingWards.map((w) => `${w.lga_id}::${normalizeGeographyName(w.name).toLowerCase()}`));
  const toInsert = [];
  const alreadyExisting = [];
  for (const ward of resolved) {
    const normalizedName = normalizeGeographyName(ward.name);
    const key = `${ward.lgaId}::${normalizedName.toLowerCase()}`;
    (existingKeys.has(key) ? alreadyExisting : toInsert).push({ ...ward, name: normalizedName });
  }
  return { toInsert, alreadyExisting, quarantined, unresolvedParent };
}

/** Polling-unit import plan — same shape as planWardImport, minus
 *  quarantine (none declared at PU level this pass), keyed by
 *  (ward_id, code) — the database's own real unique constraint. */
export function planPuImport(flatPus, wardIdMap, existingPus) {
  const unresolvedParent = [];
  const resolved = [];
  for (const pu of flatPus) {
    const wardId = wardIdMap.get(pu.inecWardId);
    if (!wardId) unresolvedParent.push(pu);
    else resolved.push({ ...pu, wardId });
  }

  // `code` is normalized the same defensive way (trim/collapse whitespace)
  // as LGA/ward names for consistency, even though the real 396-record
  // production incident this repair already fixed was a parsing/null
  // issue, not a whitespace one — see preflightPuCodes() above for that.
  // A null/undefined code is deliberately left AS-IS, never coerced to an
  // empty string — preflightPuCodes() (run separately, over the same
  // unmutated candidate list) is what must catch and report it; this
  // function must never quietly turn "missing" into "present but blank".
  // `name` (descriptive text, not part of the unique key) is normalized
  // too, purely for stored-value hygiene.
  const normalizeCode = (code) => (code == null ? code : normalizeGeographyName(code));
  const existingKeys = new Set(existingPus.map((p) => `${p.ward_id}::${normalizeCode(p.code)}`));
  const toInsert = [];
  const alreadyExisting = [];
  for (const pu of resolved) {
    const normalizedCode = normalizeCode(pu.code);
    const key = `${pu.wardId}::${normalizedCode}`;
    (existingKeys.has(key) ? alreadyExisting : toInsert).push({ ...pu, code: normalizedCode, name: normalizeGeographyName(pu.name) });
  }
  return { toInsert, alreadyExisting, unresolvedParent };
}

/** Splits `items` into `chunkSize`-sized arrays — used to keep each
 *  upsert request a bounded size against a database with 176,846+
 *  candidate polling-unit rows. */
export function chunk(items, chunkSize) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize));
  return out;
}

/**
 * STRICT PU-IDENTITY PREFLIGHT (National import repair). Run over the
 * FULL candidate polling-unit list — not just this run's toInsert subset
 * — so the report stays honest about every source record that needs
 * resolution, independent of whether its parent ward has resolved yet.
 * NEVER fabricates a code (no PU UUID, array index, hash, name, or
 * sequence is ever substituted in) and NEVER silently drops a flagged
 * row — this only reports; import-national-geography.mjs is the caller
 * that refuses to perform ANY write (not just the PU write — see that
 * file's own header) while this returns a non-empty `missing` list.
 *
 * `geography_polling_units.code` is `NOT NULL` in the schema (see
 * supabase/migrations/20260829000000_election_geography.sql) — that
 * constraint is not, and must not be, changed; this preflight exists so
 * the importer discovers the same fact BEFORE attempting a write, not
 * from a thrown Postgres error mid-batch (see this repair's own root
 * cause: acquire-national-snapshot.mjs maps INEC's own `displayNumber` to
 * `code`, and a handful of real live labels didn't parse a
 * `displayNumber` at all — see inec-source.mjs's own header for the
 * parsing bug this repair fixes, and why some already-acquired snapshot
 * records may still show up here until a fresh acquisition re-runs with
 * the fix).
 */
export function preflightPuCodes(flatPus) {
  const missing = (flatPus ?? []).filter((pu) => pu.code == null || String(pu.code).trim() === "");
  return { missing, count: missing.length };
}

/**
 * Tags a not-yet-written row's placeholder id so it can never be
 * confused with a real database id returned from an actual read/write —
 * see splitResolutionCounts() and import-national-geography.mjs's own
 * header ("Fix dry-run fidelity") for why this distinction has to be
 * visible, not just internally consistent.
 */
export const PENDING_INSERT_PREFIX = "PENDING-INSERT::";

/**
 * Counts how many resolved ids inside a resolveIds() `map` came from a
 * REAL, already-written database row versus a PENDING placeholder (a row
 * this run PLANS to insert but has not yet — see PENDING_INSERT_PREFIX).
 * Lets a report say "X resolved against the real database, Y will only
 * resolve once this run's own insert executes, Z genuinely unresolved"
 * instead of one opaque number that could hide a synthetic-id match
 * behind what looks like a real one. This is what makes dry-run
 * genuinely unable to "falsely report zero unresolved parents merely
 * because of synthetic IDs" — the synthetic ones are always separately,
 * honestly counted, never merged into the same bucket as a real match.
 */
export function splitResolutionCounts(map) {
  let real = 0, pending = 0;
  for (const id of map.values()) {
    if (typeof id === "string" && id.startsWith(PENDING_INSERT_PREFIX)) pending++;
    else real++;
  }
  return { real, pending, total: map.size };
}

export default {
  normalizeGeographyName, resolveIds, flattenSnapshot, planLgaImport, planWardImport, planPuImport, chunk,
  preflightPuCodes, splitResolutionCounts, PENDING_INSERT_PREFIX,
};
