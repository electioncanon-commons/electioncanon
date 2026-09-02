// ============================================================
// ELECTORAL GEOGRAPHY — INEC OFFICIAL SOURCE CLIENT  (National geography pass, Phase B research)
//
// cvr.inecnigeria.org/PublicApi/ is INEC's OWN live, unauthenticated,
// public JSON API — the backend behind their own official Polling Unit
// Locator (cvr.inecnigeria.org/pu). Discovered by inspecting the network
// traffic that page's own State/LGA/Ward/Polling-Unit cascading dropdown
// makes; not documented publicly by INEC as a formal API, but it is
// INEC's own infrastructure, serving INEC's own live data, with no
// authentication and no rate-limit login wall — this is not a scrape of a
// secondary/community dataset (Wikipedia, Kaggle, GitHub), it IS the
// primary source, machine-readable, confirmed live on 2026-09-01.
//
// ENDPOINTS (state_id / lga_id / ward_id are INEC's own internal numeric
// database ids, not the same as the "01/02/03..." display numbers shown
// in each label — see parseCascadeResponse()'s own header):
//   GET /PublicApi/lgas/1/Search?data[Search][state_id]=<state_id>
//   GET /PublicApi/wards/1/Search?data[Search][local_government_id]=<lga_id>
//   GET /PublicApi/pus/1/Search?data[Search][registration_area_id]=<ward_id>
//
// STATE IDS observed directly from the live dropdown's own DOM (cvr.
// inecnigeria.org/pu), NOT re-derived or guessed — 36 states + FCT, 37
// entries. NOTE INEC's own numbering quirk: FCT is labelled "37 - FCT" in
// the display text (alphabetically last) but its internal state_id is 15
// (between Enugu=14 and Gombe=16) — recorded here exactly as INEC's own
// page renders it, not "corrected."
//
// THIS FILE IS THE ONLY PLACE THAT TALKS TO THE LIVE INEC API. Every
// function here does real network I/O and is therefore NOT covered by
// `npm test` (which never hits a real network — the same discipline every
// other test in this repo already follows). What IS tested is
// parseCascadeResponse() (pure) and the validation/reconciliation logic in
// validate.mjs / reconcile-delta.mjs, against REAL DATA CAPTURED FROM THIS
// SOURCE and persisted as fixtures (see fixtures/inec-delta-*-live.json) —
// so the tests prove the logic against real INEC output, without needing
// live network access to run.
// ============================================================

export const INEC_STATE_IDS = Object.freeze([
  { stateId: 1, code: "abia", label: "01 - ABIA" },
  { stateId: 2, code: "adamawa", label: "02 - ADAMAWA" },
  { stateId: 3, code: "akwa_ibom", label: "03 - AKWA IBOM" },
  { stateId: 4, code: "anambra", label: "04 - ANAMBRA" },
  { stateId: 5, code: "bauchi", label: "05 - BAUCHI" },
  { stateId: 6, code: "bayelsa", label: "06 - BAYELSA" },
  { stateId: 7, code: "benue", label: "07 - BENUE" },
  { stateId: 8, code: "borno", label: "08 - BORNO" },
  { stateId: 9, code: "cross_river", label: "09 - CROSS RIVER" },
  { stateId: 10, code: "delta", label: "10 - DELTA" },
  { stateId: 11, code: "ebonyi", label: "11 - EBONYI" },
  { stateId: 12, code: "edo", label: "12 - EDO" },
  { stateId: 13, code: "ekiti", label: "13 - EKITI" },
  { stateId: 14, code: "enugu", label: "14 - ENUGU" },
  { stateId: 15, code: "fct", label: "37 - FCT" }, // INEC's own numbering: internal id 15, display number 37 — see header
  { stateId: 16, code: "gombe", label: "15 - GOMBE" },
  { stateId: 17, code: "imo", label: "16 - IMO" },
  { stateId: 18, code: "jigawa", label: "17 - JIGAWA" },
  { stateId: 19, code: "kaduna", label: "18 - KADUNA" },
  { stateId: 20, code: "kano", label: "19 - KANO" },
  { stateId: 21, code: "katsina", label: "20 - KATSINA" },
  { stateId: 22, code: "kebbi", label: "21 - KEBBI" },
  { stateId: 23, code: "kogi", label: "22 - KOGI" },
  { stateId: 24, code: "kwara", label: "23 - KWARA" },
  { stateId: 25, code: "lagos", label: "24 - LAGOS" },
  { stateId: 26, code: "nasarawa", label: "25 - NASARAWA" },
  { stateId: 27, code: "niger", label: "26 - NIGER" },
  { stateId: 28, code: "ogun", label: "27 - OGUN" },
  { stateId: 29, code: "ondo", label: "28 - ONDO" },
  { stateId: 30, code: "osun", label: "29 - OSUN" },
  { stateId: 31, code: "oyo", label: "30 - OYO" },
  { stateId: 32, code: "plateau", label: "31 - PLATEAU" },
  { stateId: 33, code: "rivers", label: "32 - RIVERS" },
  { stateId: 34, code: "sokoto", label: "33 - SOKOTO" },
  { stateId: 35, code: "taraba", label: "34 - TARABA" },
  { stateId: 36, code: "yobe", label: "35 - YOBE" },
  { stateId: 37, code: "zamfara", label: "36 - ZAMFARA" },
]);

export const INEC_ENDPOINTS = Object.freeze({
  lgas: (stateId) => `https://cvr.inecnigeria.org/PublicApi/lgas/1/Search?data%5BSearch%5D%5Bstate_id%5D=${stateId}`,
  wards: (lgaId) => `https://cvr.inecnigeria.org/PublicApi/wards/1/Search?data%5BSearch%5D%5Blocal_government_id%5D=${lgaId}`,
  pollingUnits: (wardId) => `https://cvr.inecnigeria.org/PublicApi/pus/1/Search?data%5BSearch%5D%5Bregistration_area_id%5D=${wardId}`,
});

/**
 * PARSES INEC's own idiosyncratic response shape: a JSON array containing
 * exactly one object, whose keys are the INTERNAL DATABASE ID (as a
 * string) and whose values are "NN - DISPLAY NAME" labels — plus a
 * "0"/"selected" pair that is always present (the dropdown's own
 * "--SELECT--" placeholder option) and must be stripped, never treated as
 * a real row. This is INEC's own live format, not invented by this
 * project — captured verbatim from cvr.inecnigeria.org/PublicApi/ on
 * 2026-09-01 (see fixtures/*-live.json for real captured examples).
 *
 * BUG FIXED (national import repair, 2026-09-02): a real, live polling-
 * unit label can wrap onto a second physical line INSIDE INEC's own JSON
 * string value (e.g. `"003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM."`
 * — a literal embedded newline before the rest of the address). The
 * original pattern used `.` for the name capture, which in JavaScript
 * never matches `\n` without the `s` (dotAll) flag — so on any label with
 * an embedded newline the WHOLE match failed, `displayNumber` fell back
 * to null, and the raw, still-prefixed label became `name` instead. This
 * was NOT missing source data — the display number was always there,
 * immediately after the leading digits — it was a parsing bug. Because
 * `code` downstream is exactly this `displayNumber` (see
 * acquire-national-snapshot.mjs's own `code: pu.displayNumber`), the bug
 * is what produced `NULL` `code`s that later violated
 * `geography_polling_units.code`'s `NOT NULL` constraint at write time.
 * Fixed by capturing with `[\s\S]` (matches everything, including
 * newlines) instead of `.`, and normalizing any internal whitespace run
 * (including the embedded newline itself) down to a single space in the
 * extracted name. See
 * test/election-geography-inec-reconciliation.consumer.mjs's own A8/A9
 * for the real captured example this fixes, and this repair's own
 * preflight (import-plan.mjs's `preflightPuCodes`) for how any PU whose
 * code is STILL missing (a genuinely different problem, not this one) is
 * surfaced honestly rather than silently written as null or fabricated.
 *
 * @returns [{ id, displayNumber, name }] — `name` has the leading
 *   "NN - " display-number prefix stripped (kept separately as
 *   `displayNumber`, INEC's own within-parent sequence number, distinct
 *   from `id`, the real database id).
 */
export function parseCascadeResponse(json) {
  const obj = Array.isArray(json) ? json[0] : json;
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([key]) => key !== "0" && key !== "selected")
    .map(([id, label]) => {
      const match = String(label ?? "").match(/^(\d+)\s*-\s*([\s\S]+)$/);
      return match
        ? { id, displayNumber: match[1], name: match[2].replace(/\s+/g, " ").trim() }
        : { id, displayNumber: null, name: String(label ?? "").replace(/\s+/g, " ").trim() };
    });
}

/** Live fetch — LGAs for a state. Real network I/O, not unit-tested (see this file's own header). */
export async function fetchLgasForState(stateId) {
  const res = await fetch(INEC_ENDPOINTS.lgas(stateId));
  if (!res.ok) throw new Error(`INEC lgas endpoint returned HTTP ${res.status}`);
  return parseCascadeResponse(await res.json());
}

/** Live fetch — wards/registration areas for an LGA. */
export async function fetchWardsForLga(lgaId) {
  const res = await fetch(INEC_ENDPOINTS.wards(lgaId));
  if (!res.ok) throw new Error(`INEC wards endpoint returned HTTP ${res.status}`);
  return parseCascadeResponse(await res.json());
}

/** Live fetch — polling units for a ward. */
export async function fetchPollingUnitsForWard(wardId) {
  const res = await fetch(INEC_ENDPOINTS.pollingUnits(wardId));
  if (!res.ok) throw new Error(`INEC pus endpoint returned HTTP ${res.status}`);
  return parseCascadeResponse(await res.json());
}

export default { INEC_STATE_IDS, INEC_ENDPOINTS, parseCascadeResponse, fetchLgasForState, fetchWardsForLga, fetchPollingUnitsForWard };
