// ============================================================
// FORGE ELECTION — THE FOLD  (MVP domain pack)
//
// The SAME PATTERN as src/os/projections.js's `project(log, missions)` — events
// are the only source of truth, the fold is the only Canon, absence is explicit
// — applied to a different event vocabulary. This is NOT a second engine: there
// is still exactly one rule (events write, the fold reads), just one more
// instance of it, the same way src/domains/production and src/domains/engineering
// are two instances of "a domain" rather than two competing kernels.
//
// Returns a `view` shaped `{ candidates, wards, observers, feed }` —
// `candidates`/`wards`/`observers` are maps keyed by id, the SAME shape
// entity.js's `DEFAULT_ENTITY_KINDS` already knows how to read
// (`Object.keys(view.components)`-style), so an election `kinds` list is
// three lines of data, not a new resolver.
//
// `observers` (LOOP 29) is folded by the SAME single function, unaware of
// actor_kind — this fold has NEVER known which kind of actor a campaign
// declares itself to be (that lives on `campaigns`, a different table
// entirely — see electionBootstrap.js). It folds whatever event TYPES
// actually appear in a campaign's own scoped log. In practice a
// candidate's campaign never contains an `observer.assignment.recorded`
// event (nothing in the write path lets it), so `observers` stays empty
// for one and `candidates`/`wards` stay empty for the other — separation
// comes from which events were ever WRITTEN into each tenant's log, not
// from a branch in this fold.
//
// LOOP (TENANT SCOPING) — `projectElection(log, campaign)`. Before this,
// isolation between two candidates/campaigns was pure caller discipline:
// nothing inside this function ever checked that every event in `log`
// actually belonged to the same campaign. That is exactly the gap this
// project's own Business Canon closed for itself with `projectBusiness(log,
// organisationId)` — the same pattern is copied here, field-for-field:
// fail-closed (a missing `campaign` scope folds an EMPTY Canon, never
// everyone's events), and the filter is the FIRST thing the fold does, so
// no branch below ever sees an event from a different campaign. Proven in
// test/election-readiness.consumer.mjs by folding a log that deliberately
// mixes two campaigns' events and confirming only one appears in the view.
// ============================================================

import { ELECTION_EVENT_TYPES } from "./events.js";

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

export function projectElection(log = [], campaign = null) {
  const candidates = {};
  const wards = {};
  const observers = {};
  // ALPHA 1.0 — Mobilization + Election Day, folded by the SAME function,
  // the SAME tenant filter, the SAME oldest-first discipline as every map
  // above. See events.js's own header note on why these reuse the existing
  // log rather than a new table.
  const people = {};
  const assignments = {};
  const tasks = {};
  const pollingUnits = {};
  const agents = {};
  const results = {};
  const incidents = {};
  // ELECTORAL GEOGRAPHY — `territory` is a SINGULAR field, not a map: a
  // campaign has exactly one active territory choice at a time (see
  // events.js's territorySetEvent header). `responsibilities` is a map,
  // same shape discipline as `assignments`/`agents` above.
  let territory = null;
  const responsibilities = {};
  const feed = [];

  // TENANT FILTER, FIRST — see the header note above. An event for a
  // different campaign, or with no campaign at all, never reaches a single
  // branch below.
  const scoped = campaign
    ? log.filter((e) => e?.campaign === campaign)
    : [];

  // Oldest first, so a later event correctly overwrites an earlier one's fields —
  // same fold discipline as os/projections.js.
  const ordered = [...scoped].reverse();

  for (const e of ordered) {
    if (e?.type === ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED) {
      candidates[e.candidate] = {
        id: e.candidate, name: e.name ?? null, office: e.office ?? null,
        constituency: e.constituency ?? null, party: e.party ?? null,
      };
    }
    // `person` (LOOP 34) — folded ONLY off WARD_ASSIGNED into the ward's
    // TOP-LEVEL `person`, the same last-value-wins discipline `organisation`
    // already gets. This is the wardAssignedEvent.person -> projectElection()
    // correctness fix: the factory has always accepted this field (see
    // events.js), but until now the fold silently discarded it. This is the
    // ASSIGNEE — "who is assigned to this ward" — a current-state fact,
    // last-value-wins like `organisation`.
    //
    // WARD_STATUS_REPORTED also carries its own `person` — the REPORTER of
    // one specific status update, a DIFFERENT fact from the assignee above.
    // LOOP 35 preserves it too, but NEVER into this same top-level field —
    // it is folded per-entry into `history[].person` instead (see below),
    // mirroring src/os/projections.js's own established `history.push({...,
    // by: e.person || e.human})` convention. The two `person` fields are
    // deliberately never merged into one Canon field.
    if (e?.type === ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED) {
      const prev = wards[e.ward] ?? { id: e.ward, name: null, organisation: null, person: null, status: null, history: [] };
      wards[e.ward] = {
        ...prev, name: e.name ?? prev.name, organisation: e.organisation ?? prev.organisation,
        person: e.person ?? prev.person,
      };
    }
    if (e?.type === ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED) {
      const prev = wards[e.ward] ?? { id: e.ward, name: null, organisation: null, person: null, status: null, history: [] };
      wards[e.ward] = {
        ...prev, status: e.status ?? prev.status, reason: e.reason ?? null,
        // `person` HERE is the REPORTER of THIS status report — a fact about
        // this one history entry, never the ward's top-level `person`
        // (LOOP 34's field, the ASSIGNEE). The two are deliberately never
        // merged into one field: mirrors src/os/projections.js's own
        // established convention of `history.push({..., by: e.person ||
        // e.human})` — a per-entry actor, not a folded current-state field.
        history: [...prev.history, { status: e.status ?? null, reason: e.reason ?? null, person: e.person ?? null, at: e.at ?? null }],
      };
    }
    // OBSERVER ASSIGNMENT (LOOP 29) — last-value-wins on `location`, the
    // SAME discipline WARD_ASSIGNED already uses (an assignment fact, not a
    // status-history fact — no `history` array here, mirroring
    // wardAssignedEvent's own shape rather than wardStatusEvent's).
    if (e?.type === ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED) {
      const prev = observers[e.observer] ?? { id: e.observer, location: null };
      observers[e.observer] = { ...prev, location: e.location ?? prev.location };
    }
    // ---------- Alpha 1.0 — Mobilization ----------
    if (e?.type === ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED) {
      people[e.person] = { id: e.person, name: e.name ?? null, roleType: e.roleType ?? null, contact: e.contact ?? null };
    }
    if (e?.type === ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED) {
      const prev = assignments[e.assignment] ?? { id: e.assignment, ward: null, assignee: null, status: "UNASSIGNED", history: [] };
      assignments[e.assignment] = { ...prev, ward: e.ward ?? prev.ward, assignee: e.assignee ?? prev.assignee, status: e.status ?? prev.status };
    }
    if (e?.type === ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED) {
      const prev = assignments[e.assignment] ?? { id: e.assignment, ward: null, assignee: null, status: "UNASSIGNED", history: [] };
      assignments[e.assignment] = { ...prev, status: e.status ?? prev.status,
        history: [...prev.history, { status: e.status ?? null, at: e.at ?? null }] };
    }
    if (e?.type === ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED) {
      const prev = tasks[e.task] ?? { id: e.task, title: null, description: null, owner: null, ward: null, priority: null, dueDate: null, status: "OPEN", history: [] };
      tasks[e.task] = { ...prev, title: e.title ?? prev.title, description: e.description ?? prev.description,
        owner: e.owner ?? prev.owner, ward: e.ward ?? prev.ward, priority: e.priority ?? prev.priority,
        dueDate: e.dueDate ?? prev.dueDate, status: e.status ?? prev.status };
    }
    if (e?.type === ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED) {
      const prev = tasks[e.task] ?? { id: e.task, title: null, description: null, owner: null, ward: null, priority: null, dueDate: null, status: "OPEN", history: [] };
      tasks[e.task] = { ...prev, status: e.status ?? prev.status,
        history: [...prev.history, { status: e.status ?? null, note: e.note ?? null, at: e.at ?? null }] };
    }

    // ---------- Alpha 1.0 — Election Day simulation ----------
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED) {
      pollingUnits[e.pollingUnit] = { id: e.pollingUnit, state: e.state ?? null, lga: e.lga ?? null,
        ward: e.ward ?? null, code: e.code ?? null, name: e.name ?? null,
        // ALPHA 1.2 — optional geography levels, null when the election
        // type/campaign never recorded one (never a false "not applicable").
        senatorialDistrict: e.senatorialDistrict ?? null, federalConstituency: e.federalConstituency ?? null,
        stateConstituency: e.stateConstituency ?? null };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED) {
      const prev = agents[e.agent] ?? { id: e.agent, pollingUnit: null, person: null, status: "ASSIGNED", history: [] };
      agents[e.agent] = { ...prev, pollingUnit: e.pollingUnit ?? prev.pollingUnit, person: e.person ?? prev.person };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED) {
      const prev = agents[e.agent] ?? { id: e.agent, pollingUnit: null, person: null, status: "ASSIGNED", history: [] };
      agents[e.agent] = { ...prev, status: e.status ?? prev.status,
        history: [...prev.history, { status: e.status ?? null, at: e.at ?? null }] };
    }
    // `ocr` — kept as its OWN sub-object, never merged into the top-level
    // result fields, so "what OCR read" and "what the human record says"
    // (`extractedFields`) are always two distinct, independently-readable
    // things — see RESULT_OCR_PROCESSED's own fold branch below.
    const RESULT_DEFAULT = { id: null, pollingUnit: null, submittedBy: null, simulated: true,
      evidenceImagePath: null, evidenceHash: null, extractedFields: null, verificationStatus: "PENDING", verifiedBy: null,
      ocr: { status: "NOT_RUN", provider: null, extractedFields: null, processedAt: null } };
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED) {
      const prev = results[e.result] ?? { ...RESULT_DEFAULT, id: e.result };
      results[e.result] = { ...prev, pollingUnit: e.pollingUnit ?? prev.pollingUnit, submittedBy: e.submittedBy ?? prev.submittedBy,
        simulated: e.simulated !== false, evidenceImagePath: e.evidenceImagePath ?? prev.evidenceImagePath,
        evidenceHash: e.evidenceHash ?? prev.evidenceHash,
        extractedFields: e.extractedFields ?? prev.extractedFields };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED) {
      const prev = results[e.result] ?? { ...RESULT_DEFAULT, id: e.result };
      results[e.result] = { ...prev, ocr: { status: e.ocrStatus ?? prev.ocr.status, provider: e.ocrProvider ?? prev.ocr.provider,
        extractedFields: e.ocrExtractedFields ?? prev.ocr.extractedFields, processedAt: e.at ?? prev.ocr.processedAt } };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED) {
      const prev = results[e.result] ?? { ...RESULT_DEFAULT, id: e.result };
      results[e.result] = { ...prev, verificationStatus: e.verificationStatus ?? prev.verificationStatus, verifiedBy: e.verifiedBy ?? prev.verifiedBy,
        // a review that carried reviewed field values REPLACES the
        // human-facing extractedFields (each entry now also carries
        // ocrValue/source) — a plain verify-with-no-review leaves them
        // exactly as RESULT_CAPTURED recorded them.
        extractedFields: e.extractedFields ?? prev.extractedFields };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED) {
      incidents[e.incident] = { id: e.incident, category: e.category ?? null, description: e.description ?? null,
        location: e.location ?? null, pollingUnit: e.pollingUnit ?? null, reportedBy: e.reportedBy ?? null,
        severity: e.severity ?? null, linkedResult: e.linkedResult ?? null, status: e.status ?? "REPORTED", escalatedTo: null, history: [] };
    }
    if (e?.type === ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED) {
      const prev = incidents[e.incident] ?? { id: e.incident, category: null, description: null, location: null, pollingUnit: null, reportedBy: null, severity: null, linkedResult: null, status: "REPORTED", escalatedTo: null, history: [] };
      incidents[e.incident] = { ...prev, status: e.status ?? prev.status,
        escalatedTo: e.escalatedTo ?? (e.status === "ESCALATED" ? prev.escalatedTo : null),
        history: [...prev.history, { status: e.status ?? null, note: e.note ?? null, escalatedTo: e.escalatedTo ?? null, at: e.at ?? null }] };
    }

    // ---------- Electoral Geography ----------
    // `territory` — last-value-wins, the SAME single-current-state
    // discipline `wards[id].organisation` already uses, just at the whole-
    // campaign level instead of per-entity.
    if (e?.type === ELECTION_EVENT_TYPES.TERRITORY.SET) {
      territory = { id: e.territory, election: e.election ?? null, office: e.office ?? null,
        state: e.state ?? null, constituency: e.constituency ?? null, at: e.at ?? null };
    }
    // `responsibilities` — same map + `history[]` shape `assignments`/
    // `agents` already establish. ASSIGNED sets the current-state fields;
    // STATUS_CHANGED only ever touches `status`/`trainingStatus` and appends
    // a history entry, never touching `person`/`level`/`geographyRef`/
    // `responsibilityRole` — an assignment is not silently reassigned by a
    // status update.
    const RESPONSIBILITY_DEFAULT = { person: null, level: null, geographyRef: null,
      responsibilityRole: null, status: "ASSIGNED", trainingStatus: "NOT_STARTED", history: [] };
    if (e?.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED) {
      const prev = responsibilities[e.responsibility] ?? { id: e.responsibility, ...RESPONSIBILITY_DEFAULT };
      responsibilities[e.responsibility] = { ...prev, person: e.person ?? prev.person, level: e.level ?? prev.level,
        geographyRef: e.geographyRef ?? prev.geographyRef, responsibilityRole: e.responsibilityRole ?? prev.responsibilityRole,
        status: e.status ?? prev.status, trainingStatus: e.trainingStatus ?? prev.trainingStatus };
    }
    if (e?.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED) {
      const prev = responsibilities[e.responsibility] ?? { id: e.responsibility, ...RESPONSIBILITY_DEFAULT };
      responsibilities[e.responsibility] = { ...prev, status: e.status ?? prev.status,
        trainingStatus: e.trainingStatus ?? prev.trainingStatus,
        history: [...prev.history, { status: e.status ?? null, trainingStatus: e.trainingStatus ?? null, note: e.note ?? null, at: e.at ?? null }] };
    }
    // ELECTIONCANON 1.1 PHASE 1 — REASSIGNED. `person` is set to `e.newPerson`
    // DIRECTLY, never `e.newPerson ?? prev.person` — a REASSIGNED event
    // ALWAYS carries a definitive newPerson (possibly null, meaning
    // "vacated"), unlike an optional field elsewhere that legitimately
    // omits itself. Using `??` here would silently treat a genuine vacate
    // (newPerson: null) as "no info given, keep the old person" — exactly
    // the split-brain-adjacent bug this event type exists to avoid.
    // level/geographyRef/responsibilityRole use `??` defensively (the
    // factory always requires them, but a fold must never crash on a
    // malformed event) — they never actually change across a slot's
    // reassignment history. history[] gets its own entry shape, distinct
    // from STATUS_CHANGED's, carrying the actual handoff (previousPerson ->
    // newPerson), never merged into the same history entries.
    if (e?.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED) {
      const prev = responsibilities[e.responsibility] ?? { id: e.responsibility, ...RESPONSIBILITY_DEFAULT };
      responsibilities[e.responsibility] = { ...prev, person: e.newPerson,
        level: e.level ?? prev.level, geographyRef: e.geographyRef ?? prev.geographyRef,
        responsibilityRole: e.responsibilityRole ?? prev.responsibilityRole,
        history: [...prev.history, { event: "reassigned", previousPerson: e.previousPerson ?? null,
          newPerson: e.newPerson ?? null, reason: e.reason ?? null, at: e.at ?? null }] };
    }

    if (e?.type) {
      feed.push({ at: e.at, eventId: e.eventId, type: e.type,
        subject: e.candidate || e.ward || e.observer || e.document ||
          e.person || e.assignment || e.task || e.pollingUnit || e.agent || e.result || e.incident ||
          e.territory || e.responsibility || null,
        actor: e.person || null, detail: e.summary || null });
    }
  }

  return deepFreeze({ candidates, wards, observers, people, assignments, tasks, pollingUnits, agents, results, incidents,
    territory, responsibilities, feed: feed.reverse() });
}

export default { projectElection };
