// ============================================================
// FORGE ELECTION — CANDIDATE READINESS ENGINE  (read-only derivation)
//
// deriveReadiness(view) is a PURE, READ-ONLY projection of the Election
// Canon (`projectElection`'s own output) into evidence-backed readiness
// claims. It is not a second Canon — it computes nothing that isn't already
// sitting in `view`, and it persists nothing anywhere. Calling it twice with
// the same `view` always returns the same result; calling it with a fresh
// `view` after a new event is folded is how "readiness recomputation"
// happens — there is no separate readiness store to keep in sync.
//
// ONLY THREE DIMENSIONS ARE IMPLEMENTED, BECAUSE ONLY THREE ARE REAL. Every
// prior reconnaissance pass against this repository (see the loop reports
// this module's own history is built on) checked the full election-industry
// checklist — eligibility, nomination, documentation, deadlines, polling
// units, agents, volunteers, compliance, logistics, funding, election-day
// operations, results — against the actual Election Canon
// (`src/domains/election/events.js`/`projections.js`) and found NO Canon
// field, event, or fold path backing any of them. Only these three survive
// that test:
//
//   CANDIDATE_REGISTERED — binary: does `candidates{}` hold a record at all.
//   WARD_ASSIGNMENT      — per ward: is `organisation` (the assigned field
//                          team) set.
//   WARD_STATUS_HEALTH   — per ward: does the last reported `status` match
//                          a declared "healthy" value.
//
// Every other dimension a readiness engine might plausibly want renders
// NOT_ESTABLISHED — never a fabricated 0%, never silently omitted. Adding a
// new dimension here without first adding the Canon evidence it would read
// is exactly the failure this module exists to refuse.
//
// THE "HEALTHY" STATUS VOCABULARY IS A CONFIGURATION CONSTANT, NEVER A
// MODEL DECISION. `status` on a ward is free text (no enum is enforced
// anywhere in events.js) — if the model, rather than this fixed list, were
// allowed to decide what counts as "healthy", it would be handed exactly
// the kind of Canon authority the whole architecture (see
// os/studio/request.js's ASSERTIONS blocklist) exists to deny it.
//
// NO WRITE. NO CONVERSATION READ. This file imports nothing from
// conversation.js, write.js, or any provider/model module — it takes a
// `view` object and returns claims. Nothing here can mutate the Canon,
// because nothing here can reach anything that could.
// ============================================================

const HEALTHY_STATUS_VALUES = Object.freeze(["on-track"]);

const READINESS_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
  AT_RISK: "AT_RISK",
  UNKNOWN: "UNKNOWN",
});

/** One evidence-backed claim, exactly the shape every prior design report specified. */
function claim({ dimension, status, value, threshold, sourceEntity, sourceEvent, calculation, confidence }) {
  return Object.freeze({
    dimension, status, value, threshold: threshold ?? null,
    source: "fold", source_entity: sourceEntity, source_event: sourceEvent,
    calculation, timestamp: null, confidence,
  });
}

function candidateClaim(candidate) {
  return claim({
    dimension: "CANDIDATE_REGISTERED",
    status: candidate ? READINESS_STATUS.COMPLETE : READINESS_STATUS.INCOMPLETE,
    value: candidate
      ? `${candidate.name ?? "A candidate"} is registered for this campaign`
      : "No candidate registration has been recorded for this campaign.",
    threshold: "candidates{} is non-empty",
    sourceEntity: "candidates", sourceEvent: "candidate.registered",
    calculation: "Object.keys(view.candidates).length > 0",
    confidence: "CANON",
  });
}

// ELECTIONCANON 1.1 PHASE 1 — WARD_ASSIGNMENT now reads from
// responsibility_slots (the real, geography-validated Organisation system
// — see src/domains/election/geography/write.js/coverage.js), NOT the
// legacy `ward.organisation` free-text field. That field was set by the
// OLDER campaign.ward.assigned event type and was never connected to real
// imported geography or to a real campaign member — a ward could show
// COMPLETE purely because some string was once written there, with no
// check that it named a real person or that any accountability record
// backed it. `wardResponsibility` is a plain map, {[wardGeographyRef]:
// currentPersonOrNull}, pre-fetched by the CALLER (coverage.js's
// getWardResponsibilityMap()) — this function stays pure/synchronous,
// exactly like deriveTerritoryReadiness({view, geographyTree}) already
// takes geographyTree as an external argument rather than fetching it
// itself. `ward.organisation` is deliberately left untouched elsewhere
// (not deleted, not migrated) — see this repository's Design Gate 1 Part
// 10 for why replacing the DATA SOURCE, not the field itself, was the
// approved design.
function wardAssignmentClaim(ward, wardResponsibility = {}) {
  const currentPerson = wardResponsibility[ward.id] ?? null;
  const assigned = currentPerson != null;
  return claim({
    dimension: "WARD_ASSIGNMENT",
    status: assigned ? READINESS_STATUS.COMPLETE : READINESS_STATUS.INCOMPLETE,
    value: assigned
      ? `${ward.id} has a current ward coordinator`
      : `${ward.id} has no current ward coordinator`,
    threshold: "responsibility_slots[level=ward, geography_ref=id].current_person != null",
    sourceEntity: `responsibility_slots.ward.${ward.id}`, sourceEvent: "responsibility.assigned|responsibility.reassigned",
    calculation: "wardResponsibility[id] != null",
    confidence: "CANON",
  });
}

function wardStatusClaim(ward) {
  const reported = ward.status != null;
  const healthy = reported && HEALTHY_STATUS_VALUES.includes(ward.status);
  return claim({
    dimension: "WARD_STATUS_HEALTH",
    status: !reported ? READINESS_STATUS.UNKNOWN : healthy ? READINESS_STATUS.COMPLETE : READINESS_STATUS.AT_RISK,
    value: reported ? `${ward.id} last reported status "${ward.status}"` : `${ward.id} has never been status-reported`,
    threshold: `status is one of [${HEALTHY_STATUS_VALUES.join(", ")}]`,
    sourceEntity: `wards.${ward.id}`, sourceEvent: "campaign.ward.status_reported",
    calculation: `HEALTHY_STATUS_VALUES.includes(wards[id].status)`,
    confidence: reported ? "CANON" : "UNKNOWN",
  });
}

/**
 * One GAP per non-COMPLETE claim, exactly the shape prior design reports
 * specified. `owner`/`deadline`/`dependency` are ALWAYS "UNKNOWN" today —
 * no Canon field carries an assignee, a deadline, or a dependency graph for
 * anything Election tracks, so populating them with a guess would be
 * exactly the fabrication this module refuses everywhere else.
 */
function gapFor(claimObj, ward = null) {
  if (claimObj.status === READINESS_STATUS.COMPLETE) return null;
  const isCandidate = claimObj.dimension === "CANDIDATE_REGISTERED";
  return Object.freeze({
    what: claimObj.value,
    why_it_matters: isCandidate
      ? "no candidate record means no campaign the Canon can evaluate readiness for at all"
      : claimObj.dimension === "WARD_ASSIGNMENT"
        ? `${ward.id} has no team responsible for it`
        : ward.reason
          ? `${ward.id} is not on-track: ${ward.reason}`
          : `${ward.id} is not on-track and no reason has been recorded`,
    canon_evidence: `${claimObj.source_entity}`,
    action: isCandidate
      ? "register the candidate"
      : claimObj.dimension === "WARD_ASSIGNMENT"
        ? `assign a team to ${ward.id}`
        : `follow up with the team responsible for ${ward.id}`,
    owner: "UNKNOWN",
    deadline: "UNKNOWN",
    dependency: "UNKNOWN",
    status: claimObj.status,
    resolves_when: isCandidate
      ? "a candidate.registered event exists"
      : claimObj.dimension === "WARD_ASSIGNMENT"
        ? "a current WARD_COORDINATOR responsibility is recorded for this ward"
        : "status becomes one of the declared healthy values",
  });
}

/**
 * The single entry point. Pure function: `view` in, claims/gaps/overall out.
 * Never throws on an empty Canon — an empty `view` produces claims that are
 * honestly INCOMPLETE/UNKNOWN, never a crash and never a fabricated pass.
 *
 * ELECTIONCANON 1.1 PHASE 1 — `wardResponsibility` is a NEW, OPTIONAL second
 * argument, defaulting to `{}` (so every EXISTING caller passing only
 * `view` keeps working, unchanged, with WARD_ASSIGNMENT honestly reporting
 * INCOMPLETE everywhere until a caller is updated to supply real data — the
 * same "never fabricate" discipline as every other dimension here, never a
 * crash from a missing argument). This keeps deriveReadiness() PURE and
 * SYNCHRONOUS — it still does not import a client, still cannot reach
 * anything that could mutate the Canon (see this module's own header) — the
 * actual responsibility_slots read happens in coverage.js, at the call
 * site, not here.
 */
export function deriveReadiness(view = {}, wardResponsibility = {}) {
  const candidates = Object.values(view?.candidates ?? {});
  const wards = Object.values(view?.wards ?? {});
  const candidate = candidates[0] ?? null;

  const candClaim = candidateClaim(candidate);
  const wardDimensions = wards.map((w) => ({
    ward: w,
    assignment: wardAssignmentClaim(w, wardResponsibility),
    statusHealth: wardStatusClaim(w),
  }));

  const gaps = [
    gapFor(candClaim),
    ...wardDimensions.flatMap(({ ward, assignment, statusHealth }) =>
      [gapFor(assignment, ward), gapFor(statusHealth, ward)]),
  ].filter(Boolean);

  const assignedCount = wardDimensions.filter((d) => d.assignment.status === READINESS_STATUS.COMPLETE).length;
  const healthyCount = wardDimensions.filter((d) => d.statusHealth.status === READINESS_STATUS.COMPLETE).length;
  const atRiskCount = wardDimensions.filter((d) => d.statusHealth.status === READINESS_STATUS.AT_RISK).length;
  const unreportedCount = wardDimensions.filter((d) => d.statusHealth.status === READINESS_STATUS.UNKNOWN).length;

  // NEVER a single opaque percentage. A ratio is reported ONLY over the
  // wards Canon already knows about, always paired with the disclosure —
  // see the module header. No total-constituency denominator exists to
  // compute a true coverage percentage against.
  const knownWardCoverage = wards.length > 0
    ? Object.freeze({
        knownWards: wards.length,
        assignedWards: assignedCount,
        healthyWards: healthyCount,
        atRiskWards: atRiskCount,
        unreportedWards: unreportedCount,
        note: "This reflects only the wards already recorded for this campaign. " +
              "The true total number of wards in the constituency is not a Canon fact " +
              "and is not represented here — this is not full constituency coverage.",
      })
    : Object.freeze({
        knownWards: 0, assignedWards: 0, healthyWards: 0, atRiskWards: 0, unreportedWards: 0,
        note: "No wards recorded for this campaign yet.",
      });

  return Object.freeze({
    candidateRegistered: Boolean(candidate),
    claims: Object.freeze([candClaim, ...wardDimensions.flatMap((d) => [d.assignment, d.statusHealth])]),
    gaps: Object.freeze(gaps),
    knownWardCoverage,
    // Explicitly NOT a win probability, NOT a percentage of true readiness —
    // see the header. Every field here is a raw count derived from a claim
    // already in `claims`, never an independently invented number.
    unsupportedDimensions: Object.freeze([
      "LEGAL_ELIGIBILITY", "NOMINATION", "PARTY_PRIMARY", "CONSTITUENCY_INTELLIGENCE",
      "POLLING_UNIT_COVERAGE", "VOLUNTEER_ORGANISATION", "POLLING_AGENT_COVERAGE",
      "STAKEHOLDER_ENGAGEMENT", "ISSUE_MANIFESTO", "CAMPAIGN_CALENDAR", "COMMUNICATIONS",
      "FUNDING", "LOGISTICS", "ELECTION_DAY_OPERATIONS", "RESULTS_COLLATION",
      "RISK_MANAGEMENT_STRUCTURED", "COMPLIANCE", "CONTINGENCY",
    ]),
  });
}

export const READINESS_DIMENSION_STATUS = READINESS_STATUS;
export const READINESS_HEALTHY_STATUS_VALUES = HEALTHY_STATUS_VALUES;

export default { deriveReadiness, READINESS_DIMENSION_STATUS, READINESS_HEALTHY_STATUS_VALUES };
