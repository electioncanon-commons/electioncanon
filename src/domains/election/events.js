// ============================================================
// FORGE ELECTION — CANONICAL EVENT SCHEMA  (MVP domain pack)
//
// A SIBLING to src/os/events.js, not an extension of it. The manufacturing
// EVENT_TYPES vocabulary is frozen at 34 types and asserted so by 7 test files —
// this module never imports or merges into it. It reuses only the GENERIC event
// mechanics (createEvent, makeEventId, EVENT_SCHEMA_VERSION, and the
// MISSION_POLICY_LEVEL enum, which is domain-neutral vocabulary about a concept —
// "may this event belong to a mission?" — not about manufacturing specifically).
//
// SELF-CONTAINED, LIKE ITS SIBLING. It does not import a registry or a studio
// topology, for the same reason: producers should not be broken by modules that
// do not exist yet, and this should not need rewriting when they arrive.
//
// MVP SCOPE. Just enough event types to make the demo candidate's Canon real:
// registering a candidate, assigning a ward to a responsible party, and
// reporting a ward's status. Not exhaustive — see docs/BUSINESS-AI-DOMAIN-CONTRACT.md
// for the sibling contract this pack's shape is meant to be copied for.
//
// CAPABILITY IS DECLARED, NOT YET WIRED. `EVENT_CAPABILITY` below is shaped
// exactly like src/os/events.js's own map (event type -> capability string) so
// it can be merged into policy.js's live check later — but this MVP phase does
// not touch events.js/Roles.js/policy.js, so nothing here is currently enforced
// by requireCapability. No live write path is exercised by the demo or the
// tests; this is the explicit, honest gap TRANSITIONAL.md-style documentation
// exists to name rather than to quietly assume closed.
//
// LOOP (TENANT SCOPING) adds `campaign` — REQUIRED on every event type,
// mirroring Business's `organisation` field on `projectBusiness(log,
// organisationId)`. Before this, `projectElection` folded whatever log it
// was handed with no internal scope check at all; isolation was pure
// caller discipline (never mixing two candidates' events into one array).
// See projections.js for the fold-side half of this.
//
// LOOP 29 adds `observer.assignment.recorded` — the FIRST non-candidate
// preparedness fact. Reconnaissance (this loop) found no authoritative
// source for anything richer (accreditation, training, deployment
// coverage, a polling-unit master geography) — see
// src/domains/election/studio/observerReadiness.js's own header for the
// full list of what stays explicitly unsupported. This event establishes
// exactly ONE fact: an identified observer has a recorded assignment to an
// operational location. `location` is free text, the SAME honesty
// `ward`/`constituency` already carry (no geographic hierarchy exists to
// validate against) — never called `polling_unit`, because no polling-unit
// master geography exists in this repository to make that name true.
// ============================================================

import { createEvent, makeEventId, EVENT_SCHEMA_VERSION, MISSION_POLICY_LEVEL } from "../../os/events.js";

export { makeEventId, EVENT_SCHEMA_VERSION, MISSION_POLICY_LEVEL };

export const ELECTION_EVENT_TYPES = Object.freeze({
  CANDIDATE: Object.freeze({
    REGISTERED: "candidate.registered",
  }),
  CAMPAIGN: Object.freeze({
    WARD_ASSIGNED:        "campaign.ward.assigned",
    WARD_STATUS_REPORTED: "campaign.ward.status_reported",
  }),
  DOCUMENT: Object.freeze({
    // Recorded ONLY once a real document/creative engine exists (not built this
    // phase — see docs/FORGE-AI-SERVICE-CONTRACT.md's "deliberately not built"
    // discipline). Declared now so the vocabulary has a name to grow into,
    // exactly as manufacturing's PROGRAM/mission fields existed before V1
    // populated them.
    PUBLISHED: "document.published",
  }),
  OBSERVER: Object.freeze({
    ASSIGNED: "observer.assignment.recorded",
  }),
  // ALPHA 1.0 — MOBILIZATION. Folded through the SAME election_events log
  // and the SAME projectElection() tenant-scoped fold as every type above —
  // no new table, no new RLS. People/assignments/tasks are operational
  // roster/coordination facts, not readiness dimensions; they do not appear
  // in deriveReadiness()/deriveObserverReadiness() and are read only by the
  // new Mobilize/Home/Intelligence surfaces.
  MOBILIZATION: Object.freeze({
    PERSON_ADDED:             "mobilization.person.added",
    ASSIGNMENT_CREATED:       "mobilization.assignment.created",
    ASSIGNMENT_STATUS_CHANGED: "mobilization.assignment.status_changed",
    TASK_CREATED:             "mobilization.task.created",
    TASK_STATUS_CHANGED:      "mobilization.task.status_changed",
  }),
  // ALPHA 1.0 — ELECTION DAY SIMULATION. Every fact here is explicitly
  // simulation/demonstration data (see RESULT_CAPTURED's own `simulated`
  // field) — never presented as an official INEC result. Same log, same
  // fold, same RLS as every other Election event type.
  ELECTION_DAY: Object.freeze({
    POLLING_UNIT_ADDED:    "electionday.pollingunit.added",
    AGENT_ASSIGNED:        "electionday.agent.assigned",
    AGENT_STATUS_CHANGED:  "electionday.agent.status_changed",
    RESULT_CAPTURED:       "electionday.result.captured",
    RESULT_OCR_PROCESSED:  "electionday.result.ocr_processed",
    RESULT_VERIFIED:       "electionday.result.verified",
    INCIDENT_REPORTED:     "electionday.incident.reported",
    INCIDENT_STATUS_CHANGED: "electionday.incident.status_changed",
  }),
  // ELECTORAL GEOGRAPHY — a campaign's own SELECTION against the new
  // geography_* reference tables (supabase/migrations/20260829000000_
  // election_geography.sql; src/domains/election/geography/read.js), and
  // the accountability layer built on top of it. Same log, same fold, same
  // RLS as every type above — the reference tables themselves are a
  // DIFFERENT, non-event-sourced, public-read layer (objective shared data,
  // not a Canon fact about any one campaign); only the campaign's CHOICE of
  // territory, and WHO is responsible for which part of it, are Canon facts
  // recorded here. See geography/write.js's own header for why `level`/
  // `geographyRef` are validated at PREPARE time against those tables and
  // never as a database FK on this event's jsonb payload.
  TERRITORY: Object.freeze({
    SET: "territory.set",
  }),
  RESPONSIBILITY: Object.freeze({
    ASSIGNED:       "responsibility.assigned",
    STATUS_CHANGED: "responsibility.status_changed",
    // ELECTIONCANON 1.1 PHASE 1 — closes the "assignment is permanent"
    // gap a slot's first responsibility.assigned event created (see
    // supabase/migrations/20260830000000_election_responsibility_slot_
    // uniqueness.sql's own header: "it does not add a reassign/unassign
    // event/mechanism — that is a real product decision this pass does
    // not make silently"). This is that decision. `previousPerson`/
    // `newPerson` are DELIBERATELY absent from REQUIRED_FIELDS_BY_TYPE
    // below — both can legitimately be null (a vacate, or reassigning
    // FROM an already-vacated slot), and the generic validator's
    // `== null` check would wrongly treat that as "missing" rather than
    // "explicitly stated." responsibilityReassignedEvent() itself
    // enforces both are genuinely PROVIDED (undefined is rejected; null
    // is accepted) — see its own header.
    REASSIGNED: "responsibility.reassigned",
  }),
});

/**
 * Every field REQUIRED for a type to be a complete record, mirroring
 * src/os/events.js's REQUIRED_FIELDS_BY_TYPE_PREFIX — a producer that omits one
 * of these publishes nothing, loudly, rather than a record with a silent hole.
 */
const REQUIRED_FIELDS_BY_TYPE = Object.freeze({
  [ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED]:
    ["candidate", "campaign", "name", "office", "constituency", "party", "summary"],
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED]:
    ["ward", "campaign", "name", "organisation", "summary"],
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED]:
    ["ward", "campaign", "status", "summary"],
  [ELECTION_EVENT_TYPES.DOCUMENT.PUBLISHED]:
    ["document", "campaign", "summary"],
  [ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED]:
    ["observer", "campaign", "location", "summary"],
  [ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED]:
    ["person", "campaign", "name", "roleType", "summary"],
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED]:
    ["assignment", "campaign", "ward", "assignee", "summary"],
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED]:
    ["assignment", "campaign", "status", "summary"],
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED]:
    ["task", "campaign", "title", "summary"],
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED]:
    ["task", "campaign", "status", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED]:
    ["pollingUnit", "campaign", "state", "lga", "ward", "code", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED]:
    ["agent", "campaign", "pollingUnit", "person", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED]:
    ["agent", "campaign", "status", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED]:
    ["result", "campaign", "pollingUnit", "submittedBy", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED]:
    ["result", "campaign", "ocrStatus", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED]:
    ["result", "campaign", "verificationStatus", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED]:
    ["incident", "campaign", "category", "description", "summary"],
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED]:
    ["incident", "campaign", "status", "summary"],
  [ELECTION_EVENT_TYPES.TERRITORY.SET]:
    ["territory", "campaign", "election", "office", "state", "summary"],
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED]:
    ["responsibility", "campaign", "person", "level", "geographyRef", "responsibilityRole", "summary"],
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED]:
    ["responsibility", "campaign", "summary"],
  // previousPerson/newPerson intentionally excluded — see this event
  // type's own declaration above for why.
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED]:
    ["responsibility", "campaign", "level", "geographyRef", "responsibilityRole", "summary"],
});

/**
 * MISSION RELATIONSHIP, EXPLICIT PER TYPE (per the task's own instruction: "Every
 * event type must have explicit mission relationship... UNKNOWN must remain
 * distinct from OPTIONAL").
 *
 * This MVP declares NO mission concept for Election yet — a campaign's own
 * strategic hierarchy (does a ward belong to a "mission"-equivalent?) is a real
 * domain question this phase does not answer, matching TRANSITIONAL.md's D2
 * pattern: FORBIDDEN is not the same claim as "we haven't decided", so every
 * type here is explicitly FORBIDDEN, not silently OPTIONAL. Revisit when a real
 * campaign-strategy hierarchy is designed — a domain decision, not a derivation.
 */
export const MISSION_POLICY = Object.freeze({
  [ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED]:        MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED]:       MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED]: MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.DOCUMENT.PUBLISHED]:            MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED]:             MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED]:              MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED]:        MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED]: MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED]:               MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED]:        MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED]:      MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED]:          MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED]:    MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED]:         MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED]:    MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED]:         MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED]:       MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED]: MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.TERRITORY.SET]:                  MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED]:        MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED]:  MISSION_POLICY_LEVEL.FORBIDDEN,
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED]:      MISSION_POLICY_LEVEL.FORBIDDEN,
});

/**
 * CAPABILITY, DECLARED (see module header — not yet wired into policy.js).
 * Shaped exactly like events.js's EVENT_CAPABILITY: event type -> capability
 * string a role must hold.
 */
export const EVENT_CAPABILITY = Object.freeze({
  [ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED]:         "election.register",
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED]:        "election.assign",
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED]: "election.report",
  [ELECTION_EVENT_TYPES.DOCUMENT.PUBLISHED]:            "election.publish",
  [ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED]:             "election.observer_assign",
  [ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED]:              "election.mobilize.person_add",
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED]:        "election.mobilize.assignment_create",
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED]: "election.mobilize.assignment_status",
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED]:               "election.mobilize.task_create",
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED]:        "election.mobilize.task_status",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED]:      "election.day.polling_unit_add",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED]:          "election.day.agent_assign",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED]:    "election.day.agent_status",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED]:         "election.day.result_capture",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED]:    "election.day.result_ocr_process",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED]:         "election.day.result_verify",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED]:       "election.day.incident_report",
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED]: "election.day.incident_status",
  [ELECTION_EVENT_TYPES.TERRITORY.SET]:                 "election.geography.territory_set",
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED]:       "election.geography.responsibility_assign",
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED]: "election.geography.responsibility_status",
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED]:     "election.geography.responsibility_reassign",
});

// ALPHA 1.0 — Mobilization and Election Day carry NO REQUIRED_ACTOR_KIND
// entry (see actorKindAuthorised() in electionWebAdapter.js: an absent
// entry authorises ANY actor kind, mirroring DOCUMENT.PUBLISHED's own
// existing fail-open-for-unlisted-types precedent). Both actor kinds with a
// live readiness engine — candidate_campaign and observer_organisation —
// legitimately mobilize people and run election-day operations; there is
// no reason to restrict either capability to one of them.

/**
 * REQUIRED ACTOR KIND, DECLARED (LOOP 30) — event type -> the ONLY
 * `campaigns.actor_kind` value (electionBootstrap.js's ACTOR_KIND, plain
 * string literals here rather than an import — this module stays
 * self-contained, per its own header, the same reason EVENT_CAPABILITY
 * above never imports Roles.js) that may cause this event to be written.
 *
 * WHY THIS LIVES HERE, NOT IN write.js. This is a fact about the EVENT
 * TYPE's own authority requirement, the same category `EVENT_CAPABILITY`
 * already is — not a fact about how a message is parsed (write.js's own
 * concern) or about how a client checks it (electionWebAdapter.js's own
 * concern, since checking requires a database read this file must never
 * perform). `DOCUMENT.PUBLISHED` has no entry: no document/creative engine
 * exists to write it yet (see its own declaration), so there is nothing to
 * gate.
 *
 * THIS MAP IS DATA, NOT ENFORCEMENT. Nothing in this file, or in write.js,
 * ever reads `campaigns.actor_kind` — only `electionWebAdapter.js` does,
 * because only it holds the `client` a real check requires. This mirrors
 * `EVENT_CAPABILITY`'s own "declared, not yet wired into policy.js"
 * status, except this loop DOES wire it — at the one layer capable of it.
 */
export const REQUIRED_ACTOR_KIND = Object.freeze({
  [ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED]:          "candidate_campaign",
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED]:        "candidate_campaign",
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED]: "candidate_campaign",
  [ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED]:             "observer_organisation",
  // TERRITORY.SET / RESPONSIBILITY.* carry NO entry — same fail-open
  // precedent as Mobilization/Election Day above: both actor kinds with a
  // live readiness engine legitimately operate a territory.
});

/**
 * STAFF-RESTRICTED EVENT TYPES (pilot safety pass) — the MINIMUM set of
 * structural/high-authority event types a 'staff'-tier campaign_members
 * row (campaign_member_role) may never write, regardless of actor_kind.
 * This is NOT the full EVENT_CAPABILITY matrix wired up — EVENT_CAPABILITY
 * above remains exactly as declared-but-not-wired as it always has been.
 * This is a narrow, explicit denylist sized for a 25-person preparation-
 * phase operator pilot: 'owner' and 'manager' are unrestricted here,
 * unchanged from current behavior.
 *
 * WIRED IN TWO PLACES, DELIBERATELY: electionWebAdapter.js's
 * roleAuthorised() (this file has no client, so it cannot read a role
 * itself — same reason REQUIRED_ACTOR_KIND above is data, not
 * enforcement, here), AND the election_events INSERT RLS policy
 * (election_event_writable_by_role(), supabase/migrations/20260923000000_
 * election_membership_revocation_and_write_rbac.sql) — the database is
 * the authoritative enforcement point; the application-layer check exists
 * only to fail earlier with a clearer reason. Keep this exact list in
 * sync with that SQL array by hand; nothing generates one from the other.
 */
export const STAFF_RESTRICTED_EVENT_TYPES = Object.freeze([
  ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED,
  ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED,
  ELECTION_EVENT_TYPES.TERRITORY.SET,
  ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED,
  ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED,
  ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED,
]);

function compact(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

// ---------- validation (mirrors events.js's validateEvent shape) ----------
export function validateElectionEvent(event) {
  const issues = [];
  if (!event || typeof event !== "object" || typeof event.type !== "string" || !event.type) {
    return { valid: false, issues: [{ severity: "error", message: "event has no `type`" }] };
  }
  const required = REQUIRED_FIELDS_BY_TYPE[event.type];
  if (!required) {
    issues.push({ severity: "error", message: `"${event.type}" is not a canonical Election event type` });
  } else {
    for (const field of required) {
      if (event[field] == null || event[field] === "") {
        issues.push({ severity: "error", message: `event type "${event.type}" requires field "${field}"` });
      }
    }
  }
  if (event.mission != null && event.mission !== "" &&
      MISSION_POLICY[event.type] === MISSION_POLICY_LEVEL.FORBIDDEN) {
    issues.push({ severity: "error",
      message: `event type "${event.type}" is MISSION_FORBIDDEN and must not carry a mission` });
  }
  return { valid: issues.every((i) => i.severity !== "error"), issues };
}

export function assertElectionEvent(event) {
  const { valid, issues } = validateElectionEvent(event);
  if (!valid) {
    throw new Error(`Invalid Election event: ${issues.filter((i) => i.severity === "error")
      .map((i) => i.message).join("; ")}`);
  }
  return event;
}

// ---------- domain factories ----------
//
// `campaign` — TENANT SCOPE, ADDED THIS LOOP. Deliberately NOT named
// `organisation`: that field already exists on `wardAssignedEvent` and means
// something else entirely (the ward's own assigned field team, e.g. "Demo
// Field Org") — reusing it for tenant scope would silently collide two
// unrelated meanings under one field name, exactly the kind of defect this
// project's own history has found and fixed before (Business's Loop 21
// phrase collisions were the same failure shape, one layer up). `campaign`
// is required, explicitly thrown on when absent (the same elevated
// treatment `candidate`/`ward`/`status` already get), and is the ONLY field
// `projectElection` trusts to scope a fold — see projections.js.
export function candidateEvent({ candidate, campaign, name, office, constituency, party, summary, ...extra }) {
  if (candidate == null) throw new Error("candidateEvent: `candidate` is required");
  if (campaign == null) throw new Error("candidateEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED,
    candidate, campaign, name, office, constituency, party,
    summary: summary ?? `${name} registered to contest ${office} (${constituency})`,
    ...extra,
  });
}

export function wardAssignedEvent({ ward, campaign, name, organisation, person, status, summary, ...extra }) {
  if (ward == null) throw new Error("wardAssignedEvent: `ward` is required");
  if (campaign == null) throw new Error("wardAssignedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED,
    ward, campaign, name, organisation, person, status,
    summary: summary ?? `${organisation ?? "an organisation"} assigned to ${ward}`,
    ...extra,
  });
}

export function wardStatusEvent({ ward, campaign, status, reason, person, summary, ...extra }) {
  if (ward == null) throw new Error("wardStatusEvent: `ward` is required");
  if (campaign == null) throw new Error("wardStatusEvent: `campaign` is required");
  if (status == null) throw new Error("wardStatusEvent: `status` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED,
    ward, campaign, status, reason, person,
    summary: summary ?? `${ward} reported ${status}`,
    ...extra,
  });
}

// `observer` — the SUBJECT identifier, the same role `ward`/`candidate` play
// for their own event types: a caller-chosen id for THIS specific observer
// (a person or a named team), never invented by this factory. `location` is
// the operational location this observer is assigned to — free text, exactly
// as honest as `ward`, because no polling-unit master geography exists to
// validate it against. No `status`/`history` field exists here, mirroring
// `wardAssignedEvent` (assignment, not health) rather than `wardStatusEvent`
// — a second, richer "observer status" fact is a future, deliberate decision,
// not something this factory should quietly grow toward.
export function observerAssignedEvent({ observer, campaign, location, person, summary, ...extra }) {
  if (observer == null) throw new Error("observerAssignedEvent: `observer` is required");
  if (campaign == null) throw new Error("observerAssignedEvent: `campaign` is required");
  if (location == null) throw new Error("observerAssignedEvent: `location` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED,
    observer, campaign, location, person,
    summary: summary ?? `${observer} assigned to ${location}`,
    ...extra,
  });
}

// ---------- Alpha 1.0 — Mobilization factories ----------

export function personAddedEvent({ person, campaign, name, roleType, contact, summary, ...extra }) {
  if (person == null) throw new Error("personAddedEvent: `person` is required");
  if (campaign == null) throw new Error("personAddedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED,
    person, campaign, name, roleType, ...compact({ contact }),
    summary: summary ?? `${name} added as ${roleType}`,
    ...extra,
  });
}

export function assignmentCreatedEvent({ assignment, campaign, ward, assignee, status, summary, ...extra }) {
  if (assignment == null) throw new Error("assignmentCreatedEvent: `assignment` is required");
  if (campaign == null) throw new Error("assignmentCreatedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED,
    assignment, campaign, ward, assignee, status: status ?? "UNASSIGNED",
    summary: summary ?? `${assignee} assigned to ${ward}`,
    ...extra,
  });
}

export function assignmentStatusEvent({ assignment, campaign, status, summary, ...extra }) {
  if (assignment == null) throw new Error("assignmentStatusEvent: `assignment` is required");
  if (campaign == null) throw new Error("assignmentStatusEvent: `campaign` is required");
  if (status == null) throw new Error("assignmentStatusEvent: `status` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED,
    assignment, campaign, status,
    summary: summary ?? `assignment ${assignment} status changed to ${status}`,
    ...extra,
  });
}

export function taskCreatedEvent({ task, campaign, title, description, owner, ward, priority, dueDate, status, summary, ...extra }) {
  if (task == null) throw new Error("taskCreatedEvent: `task` is required");
  if (campaign == null) throw new Error("taskCreatedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED,
    task, campaign, title, status: status ?? "OPEN",
    ...compact({ description, owner, ward, priority, dueDate }),
    summary: summary ?? `task created: ${title}`,
    ...extra,
  });
}

export function taskStatusEvent({ task, campaign, status, note, summary, ...extra }) {
  if (task == null) throw new Error("taskStatusEvent: `task` is required");
  if (campaign == null) throw new Error("taskStatusEvent: `campaign` is required");
  if (status == null) throw new Error("taskStatusEvent: `status` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED,
    task, campaign, status, ...compact({ note }),
    summary: summary ?? `task ${task} status changed to ${status}`,
    ...extra,
  });
}

// ---------- Alpha 1.0 — Election Day simulation factories ----------
// Every factory below is written into `election_events` exactly like any
// other Election event — the SIMULATION labelling lives in the data itself
// (`simulated: true` on RESULT_CAPTURED) and in every UI surface that reads
// it, never by using a different, less-audited write path.

// ALPHA 1.2 — `senatorialDistrict`/`federalConstituency`/`stateConstituency`
// are OPTIONAL, additive geography fields (compacted like `name` already
// was) — a polling unit recorded before this loop, or for an election type
// where one of these levels doesn't apply, still validates with none of
// them present. No migration: these are jsonb payload fields on the SAME
// event type, exactly the zero-migration pattern Alpha 1.1 used to extend
// `PERSON_ROLE_TYPES`.
export function pollingUnitAddedEvent({ pollingUnit, campaign, state, lga, ward, code, name,
  senatorialDistrict, federalConstituency, stateConstituency, summary, ...extra }) {
  if (pollingUnit == null) throw new Error("pollingUnitAddedEvent: `pollingUnit` is required");
  if (campaign == null) throw new Error("pollingUnitAddedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED,
    pollingUnit, campaign, state, lga, ward, code,
    ...compact({ name, senatorialDistrict, federalConstituency, stateConstituency }),
    summary: summary ?? `polling unit ${code} added (${ward}, ${lga}, ${state})`,
    ...extra,
  });
}

export function agentAssignedEvent({ agent, campaign, pollingUnit, person, summary, ...extra }) {
  if (agent == null) throw new Error("agentAssignedEvent: `agent` is required");
  if (campaign == null) throw new Error("agentAssignedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED,
    agent, campaign, pollingUnit, person,
    summary: summary ?? `agent assigned to ${pollingUnit}`,
    ...extra,
  });
}

export function agentStatusEvent({ agent, campaign, status, summary, ...extra }) {
  if (agent == null) throw new Error("agentStatusEvent: `agent` is required");
  if (campaign == null) throw new Error("agentStatusEvent: `campaign` is required");
  if (status == null) throw new Error("agentStatusEvent: `status` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED,
    agent, campaign, status,
    summary: summary ?? `agent ${agent} status changed to ${status}`,
    ...extra,
  });
}

/** `simulated` defaults true and stays true throughout Alpha 1.1/1.2 — see
 *  the module-level note above events.js's Election Day section: the
 *  CONTENT recorded through this Alpha is always test/demonstration data,
 *  even once the MECHANICS below it are genuinely real. `evidenceImagePath`
 *  (Alpha 1.1) is the private Storage object path of the uploaded
 *  result-sheet photo — uploaded by the caller BEFORE this event is
 *  written (see electionDay/evidence.js); this event only ever records the
 *  resulting path, never the image bytes. `extractedFields` is an array of
 *  `{ field, value, ocrValue, confidence, source }` — `source` is one of
 *  "manual" (nothing OCR-derived), "ocr_confirmed" (a human accepted the
 *  OCR value as-is), or "ocr_corrected" (a human typed a different value
 *  than OCR read); `ocrValue` is only ever present alongside the latter two
 *  and is never overwritten — a correction changes `value`, never erases
 *  what OCR actually said. `confidence` on a human-facing field entry
 *  stays whatever the OCR pass reported (HIGH/MEDIUM/LOW) or `null` for a
 *  purely manual entry — this factory itself does not compute it.
 *  `evidenceHash` (Alpha 1.3) is a SHA-256 of the uploaded photo's raw
 *  bytes (see electionDay/evidence.js's `hashResultEvidence`) — recorded
 *  purely as a duplicate-evidence SIGNAL for reviewers, never used to
 *  reject or merge events; two results may legitimately share a hash
 *  (a retake of the same real sheet). */
export function resultCapturedEvent({ result, campaign, pollingUnit, submittedBy, evidenceImagePath, evidenceHash, extractedFields, simulated, summary, ...extra }) {
  if (result == null) throw new Error("resultCapturedEvent: `result` is required");
  if (campaign == null) throw new Error("resultCapturedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED,
    result, campaign, pollingUnit, submittedBy, simulated: simulated !== false,
    ...compact({ evidenceImagePath, evidenceHash, extractedFields }),
    summary: summary ?? `simulated result captured for ${pollingUnit}`,
    ...extra,
  });
}

/** ALPHA 1.2 — records that an OCR pass ran against an already-uploaded
 *  evidence photo. Always a NEW, separate, immutable event — never mutates
 *  `RESULT_CAPTURED`, so a re-run (e.g. after a failed first attempt) is
 *  just another `RESULT_OCR_PROCESSED` event for the same `result` id, and
 *  the fold keeps the latest. `ocrExtractedFields` is
 *  `{ field, value, confidence: "HIGH"|"MEDIUM"|"LOW"|"UNKNOWN" }[]` — the
 *  RAW machine reading, kept separate from the human-facing
 *  `extractedFields` on `RESULT_CAPTURED`/this event's own consumers so
 *  "what OCR said" and "what a human confirmed" are never collapsed into
 *  one mutable value. `ocrProvider` names the extraction engine (e.g.
 *  "tesseract.js") for audit purposes only — never surfaced as a claim of
 *  accuracy. `ocrStatus` is required and is one of NOT_RUN/PROCESSING/
 *  COMPLETE/FAILED/UNAVAILABLE (see electionDay/ocr.js's `OCR_STATUS`). */
export function resultOcrProcessedEvent({ result, campaign, ocrProvider, ocrStatus, ocrExtractedFields, summary, ...extra }) {
  if (result == null) throw new Error("resultOcrProcessedEvent: `result` is required");
  if (campaign == null) throw new Error("resultOcrProcessedEvent: `campaign` is required");
  if (ocrStatus == null) throw new Error("resultOcrProcessedEvent: `ocrStatus` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED,
    result, campaign, ocrStatus, ...compact({ ocrProvider, ocrExtractedFields }),
    summary: summary ?? `OCR ${ocrStatus.toLowerCase()} for result ${result}`,
    ...extra,
  });
}

// ALPHA 1.2 — `extractedFields` is OPTIONAL here too: when a human review
// (CONFIRM/CORRECT/DISPUTE) accompanies the verification decision, this is
// where the FINAL human-reviewed field values are recorded, each carrying
// `ocrValue` (untouched, whatever OCR originally read) alongside `value`
// (what the human confirmed or corrected) and `source: "ocr_confirmed"|
// "ocr_corrected"|"manual"`. Omitting it (the common case for a plain
// VERIFIED/DISPUTED/REJECTED call with no field-level changes) leaves the
// fields recorded on RESULT_CAPTURED untouched — this is a review of an
// existing capture, never a second capture.
export function resultVerifiedEvent({ result, campaign, verificationStatus, verifiedBy, extractedFields, summary, ...extra }) {
  if (result == null) throw new Error("resultVerifiedEvent: `result` is required");
  if (campaign == null) throw new Error("resultVerifiedEvent: `campaign` is required");
  if (verificationStatus == null) throw new Error("resultVerifiedEvent: `verificationStatus` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED,
    result, campaign, verificationStatus, ...compact({ verifiedBy, extractedFields }),
    summary: summary ?? `result ${result} marked ${verificationStatus}`,
    ...extra,
  });
}

// ALPHA 1.2 — `severity` is OPTIONAL (compacted); an incident reported
// before this loop, or one whose reporter declines to grade it, still
// validates. When present it must be one of LOW/MEDIUM/HIGH/CRITICAL (see
// electionDay/write.js's `INCIDENT_SEVERITY`) — this factory does not
// enforce the enum itself (write.js's proposeReportIncident does, before
// ever calling this), matching every other enum field in this file.
//
// ALPHA 1.3 — `linkedResult` is OPTIONAL: when an incident concerns a
// SPECIFIC captured result (e.g. category "result_sheet_dispute"), this
// names that result's id, so the incident and the disputed result stay
// connected in the fold without either record owning the other. This is
// a REFERENCE, not authority — recording `linkedResult` here never
// changes the result's own `verificationStatus`; a human still marks
// the result DISPUTED separately via proposeVerifyResult, exactly as
// before. ElectionCanon records the connection, it does not infer one
// fact from the other.
export function incidentReportedEvent({ incident, campaign, category, description, location, pollingUnit,
  reportedBy, severity, linkedResult, summary, ...extra }) {
  if (incident == null) throw new Error("incidentReportedEvent: `incident` is required");
  if (campaign == null) throw new Error("incidentReportedEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED,
    incident, campaign, category, description, status: "REPORTED",
    ...compact({ location, pollingUnit, reportedBy, severity, linkedResult }),
    summary: summary ?? `incident reported: ${category}`,
    ...extra,
  });
}

// `escalatedTo` — OPTIONAL, the person/role id the incident was escalated
// to (only meaningful alongside `status: "ESCALATED"`). Like `location`/
// `pollingUnit` elsewhere in this file, this is a caller-supplied
// identifier this factory never validates against a real roster — see
// write.js's `proposeChangeIncidentStatus`, which checks the target
// actually exists in the reporter's own coordination hierarchy BEFORE
// this factory is ever called.
export function incidentStatusEvent({ incident, campaign, status, note, escalatedTo, summary, ...extra }) {
  if (incident == null) throw new Error("incidentStatusEvent: `incident` is required");
  if (campaign == null) throw new Error("incidentStatusEvent: `campaign` is required");
  if (status == null) throw new Error("incidentStatusEvent: `status` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED,
    incident, campaign, status, ...compact({ note, escalatedTo }),
    summary: summary ?? `incident ${incident} status changed to ${status}`,
    ...extra,
  });
}

// ---------- Electoral Geography factories ----------
//
// `territory` is the SUBJECT identifier for this campaign's own territory
// choice (the same role `candidate`/`ward` play for their own event types) —
// a caller-chosen id. `projectElection()` folds this to a SINGULAR field,
// not a map: a campaign has exactly one active territory at a time (see
// projections.js). `election` stays FREE TEXT — no election-calendar
// reference table exists this pass, the same honesty every other undated
// fact in this file already carries. `office`/`state`/`constituency` are
// real ids resolved by the caller against the new geography_* reference
// tables BEFORE this factory is ever called (geography/write.js's
// proposeSetTerritory) — this factory performs no validation itself,
// consistent with `roleType` against PERSON_ROLE_TYPES and every other
// event-carried reference in this codebase: enforcement is at PREPARE
// time, never a database FK on the jsonb payload. `constituency` is
// OPTIONAL/compacted — President and Governor resolve directly to a
// state, with no sub-state constituency to name.
export function territorySetEvent({ territory, campaign, election, office, state, constituency, summary, ...extra }) {
  if (territory == null) throw new Error("territorySetEvent: `territory` is required");
  if (campaign == null) throw new Error("territorySetEvent: `campaign` is required");
  if (election == null) throw new Error("territorySetEvent: `election` is required");
  if (office == null) throw new Error("territorySetEvent: `office` is required");
  if (state == null) throw new Error("territorySetEvent: `state` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.TERRITORY.SET,
    territory, campaign, election, office, state, ...compact({ constituency }),
    summary: summary ?? `territory set: ${office} / ${state}${constituency ? ` / ${constituency}` : ""}`,
    ...extra,
  });
}

// `responsibility` — the SUBJECT identifier, the same role `assignment`
// plays for MOBILIZATION.ASSIGNMENT_CREATED — a DIFFERENT, independent fact
// (see that type's own header); do not confuse the two "assignment"
// concepts. `person` references an existing Mobilization roster entry
// (`view.people`, from PERSON_ADDED) — this factory does not create a
// person, only names one that must already exist (checked by
// geography/write.js's proposeAssignResponsibility, the same
// caller-validates-before-the-factory discipline as everywhere else in this
// file). `level` is one of 'constituency'|'lga'|'ward'|'polling_unit';
// `geographyRef` is the real geography_* table row id for that level — a
// plain string/uuid payload field, not a database FK, same reasoning as
// `territorySetEvent` above. `responsibilityRole` is a NEW, separate
// vocabulary from Mobilization's PERSON_ROLE_TYPES (that describes a
// person's general roster role, e.g. "volunteer"; this describes what THIS
// specific assignment means — see geography/write.js's
// RESPONSIBILITY_ROLE). `status` defaults to "ASSIGNED", reusing
// Mobilization's ASSIGNMENT_STATUS vocabulary verbatim (imported, not
// redeclared here) so the two systems' status words never drift apart even
// though the two facts are otherwise fully independent.
export function responsibilityAssignedEvent({ responsibility, campaign, person, level, geographyRef,
  responsibilityRole, status, trainingStatus, summary, ...extra }) {
  if (responsibility == null) throw new Error("responsibilityAssignedEvent: `responsibility` is required");
  if (campaign == null) throw new Error("responsibilityAssignedEvent: `campaign` is required");
  if (person == null) throw new Error("responsibilityAssignedEvent: `person` is required");
  if (level == null) throw new Error("responsibilityAssignedEvent: `level` is required");
  if (geographyRef == null) throw new Error("responsibilityAssignedEvent: `geographyRef` is required");
  if (responsibilityRole == null) throw new Error("responsibilityAssignedEvent: `responsibilityRole` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED,
    responsibility, campaign, person, level, geographyRef, responsibilityRole,
    status: status ?? "ASSIGNED", ...compact({ trainingStatus }),
    summary: summary ?? `${responsibilityRole} assigned for ${level} ${geographyRef}`,
    ...extra,
  });
}

// ELECTIONCANON 1.1 PHASE 1 — the reassignment/handoff/vacate event. Reuses
// the SAME `responsibility` subject id as the slot's original ASSIGNED
// event (never a fresh id) — the slot's identity persists across its whole
// lifetime, exactly how STATUS_CHANGED already reuses it. `level`/
// `geographyRef`/`responsibilityRole` are carried forward unchanged (a
// WARD_COORDINATOR slot stays a WARD_COORDINATOR slot; reassignment
// replaces the PERSON, never the slot's own identity). `previousPerson`/
// `newPerson` are BOTH required ARGUMENTS (rejecting `undefined`) but both
// may legitimately be `null` — `previousPerson: null` means reassigning
// from an already-vacated slot; `newPerson: null` means vacating with no
// replacement yet (see this codebase's Design Gate 1 Part 7: 1.1
// deliberately supports exactly one handoff mechanism, not a richer
// temporary/scheduled vocabulary). Both are written EXPLICITLY into the
// payload (never compacted away), because for this one event type `null`
// is meaningfully different from "field absent" — see REQUIRED_FIELDS_BY_
// TYPE's own comment on why these two fields are deliberately excluded
// from that generic, null-means-missing check. `reason` stays honestly
// optional free text, matching `incidentReportedEvent`'s own `severity`
// precedent — never inferred, never categorised into an invented enum.
export function responsibilityReassignedEvent({ responsibility, campaign, level, geographyRef, responsibilityRole,
  previousPerson, newPerson, reason, summary, ...extra }) {
  if (responsibility == null) throw new Error("responsibilityReassignedEvent: `responsibility` is required");
  if (campaign == null) throw new Error("responsibilityReassignedEvent: `campaign` is required");
  if (level == null) throw new Error("responsibilityReassignedEvent: `level` is required");
  if (geographyRef == null) throw new Error("responsibilityReassignedEvent: `geographyRef` is required");
  if (responsibilityRole == null) throw new Error("responsibilityReassignedEvent: `responsibilityRole` is required");
  if (previousPerson === undefined) throw new Error("responsibilityReassignedEvent: `previousPerson` is required (pass null for an already-vacant slot)");
  if (newPerson === undefined) throw new Error("responsibilityReassignedEvent: `newPerson` is required (pass null to vacate)");
  const event = createEvent({
    type: ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED,
    responsibility, campaign, level, geographyRef, responsibilityRole, ...compact({ reason }),
    summary: summary ?? (newPerson
      ? `${level} ${geographyRef} reassigned from ${previousPerson ?? "vacant"} to ${newPerson}`
      : `${level} ${geographyRef} vacated (previously ${previousPerson ?? "vacant"})`),
    ...extra,
  });
  // createEvent()'s OWN ...compact(fields) would silently strip
  // previousPerson/newPerson whenever either is null — exactly the
  // "explicitly null" state this event type must preserve (a vacate, or
  // reassigning FROM an already-vacant slot). Set both directly on the
  // returned object, the SAME "explicit null, never absent" technique
  // createEvent() already uses for its own `correlationId` field (see
  // that function's own comment in os/events.js).
  event.previousPerson = previousPerson;
  event.newPerson = newPerson;
  return event;
}

// `status`/`trainingStatus` are BOTH optional here — unlike
// assignmentStatusEvent's hard-required `status`, a status-change event may
// report only a training-completion update with no status change, or vice
// versa. geography/write.js's proposeChangeResponsibilityStatus enforces
// "at least one of the two is present" as a business rule before this
// factory is ever called — the same caller-validates-first discipline every
// soft-optional field in this file already follows. Both are compacted so a
// status-only update carries no stray `trainingStatus: undefined` field.
export function responsibilityStatusEvent({ responsibility, campaign, status, trainingStatus, note, summary, ...extra }) {
  if (responsibility == null) throw new Error("responsibilityStatusEvent: `responsibility` is required");
  if (campaign == null) throw new Error("responsibilityStatusEvent: `campaign` is required");
  return createEvent({
    type: ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED,
    responsibility, campaign, ...compact({ status, trainingStatus, note }),
    summary: summary ?? `responsibility ${responsibility} status updated`,
    ...extra,
  });
}

export default {
  ELECTION_EVENT_TYPES, MISSION_POLICY, EVENT_CAPABILITY, REQUIRED_ACTOR_KIND, STAFF_RESTRICTED_EVENT_TYPES,
  validateElectionEvent, assertElectionEvent,
  candidateEvent, wardAssignedEvent, wardStatusEvent, observerAssignedEvent,
  personAddedEvent, assignmentCreatedEvent, assignmentStatusEvent, taskCreatedEvent, taskStatusEvent,
  pollingUnitAddedEvent, agentAssignedEvent, agentStatusEvent, resultCapturedEvent, resultOcrProcessedEvent, resultVerifiedEvent,
  incidentReportedEvent, incidentStatusEvent,
  territorySetEvent, responsibilityAssignedEvent, responsibilityStatusEvent, responsibilityReassignedEvent,
  makeEventId, EVENT_SCHEMA_VERSION,
};
