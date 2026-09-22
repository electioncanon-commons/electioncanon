// ============================================================
// FORGE ELECTION — WEB (SESSION-AUTHENTICATED CHANNEL) ADAPTER  (Loop 26)
//
// The FIRST real caller of the Loop 25 activation boundary
// (src/os/electionContext.js). Thin on purpose: every function here does
// exactly two things — (1) turn a real, injected Supabase client's OWN
// session into a `userId` never taken from a request body, and (2) call
// straight into the already-tested domain boundary (electionContext.js,
// electionScope.js, write.js) with it. No election fact, no readiness
// value, and no scope decision is computed HERE — this file only ever
// forwards to functions Loops 22-25 already proved.
//
// WHY THIS IS "WEB", BUT IMPORTS NO REACT. `ForgeBusinessAssistantRoom.jsx`
// is this repository's own existing channel-adapter precedent: it reads
// `useIdentity()`'s `user.id` (itself sourced from
// `supabase.auth.getSession()`, never a prop or a request body) and hands
// it to `resolveBusinessScope({userId, client: supabase})`. This module is
// that SAME pattern, one layer lower and channel-agnostic: instead of
// trusting a caller to have already extracted `user.id` from a React hook,
// it extracts it itself via `client.auth.getUser()` — the actual Supabase
// call that verifies a session's JWT server-side. A future WhatsApp
// adapter, given a Supabase client bound to a verified session by whatever
// means THAT channel authenticates, calls the exact same functions below
// unchanged — nothing here assumes a browser, a cookie, or React state.
//
// AUTHENTICATION AUTHORITY, STATED PLAINLY. `getAuthenticatedUserId()` is
// the ONLY source of `userId` anywhere in this file. No exported function
// accepts a `userId` parameter — there is nothing for a hostile request
// body, a model, or a stale prop to inject. If `client.auth.getUser()`
// disagrees, there is no `userId` to fall back to.
// ============================================================

import { activateElectionCampaign, getElectionContext, getCampaignActorKind, loadElectionLog } from "./electionContext.js";
import { resolveElectionScope, isElectionScoped } from "./electionScope.js";
import { proposeElectionWrite, executeElectionWrite } from "../domains/election/studio/write.js";
import { REQUIRED_ACTOR_KIND, STAFF_RESTRICTED_EVENT_TYPES } from "../domains/election/events.js";
import * as mobilizationWrite from "../domains/election/mobilization/write.js";
import * as electionDayWrite from "../domains/election/electionDay/write.js";
import * as geographyWrite from "../domains/election/geography/write.js";

/**
 * The ONE place a Supabase session becomes a `userId`. Never guessed, never
 * defaulted, never accepted as an argument by any other function in this
 * file — a caller with no real, valid session gets `null`, full stop.
 */
export async function getAuthenticatedUserId({ client } = {}) {
  if (!client?.auth?.getUser) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data?.user?.id ?? null;
}

/**
 * THE READ OPERATION (Phase 2). Authenticates from the client's own
 * session, then forwards straight to `getElectionContext()` — no fact, no
 * readiness value, and no campaign identity is computed in this function;
 * it exists only to supply a real `userId` that no caller could otherwise
 * smuggle in.
 */
export async function readElectionCanon({ client, requestedCampaign = null } = {}) {
  const userId = await getAuthenticatedUserId({ client });
  return getElectionContext({ userId, client, requestedCampaign });
}

/**
 * THE ACTIVATION OPERATION (Phase 4/5). Identical discipline: resolve the
 * real session, forward to `activateElectionCampaign()` unchanged.
 */
export async function activateElection({ client, name = null, requestedCampaign = null, actorKind } = {}) {
  const userId = await getAuthenticatedUserId({ client });
  return activateElectionCampaign({ userId, client, name, requestedCampaign, actorKind });
}

/**
 * ALPHA 1.0 — the raw, tenant-scoped event log, for the ONE surface that
 * needs it directly rather than only its folded `view`: Intelligence's
 * "Ask Election Forge" panel, which grounds every answer against real
 * source events (see os/studio/infer.js's runInference and grounding.js).
 * Same authentication/scope discipline as readElectionCanon() — resolves
 * its own userId and scope, never trusts a caller-supplied campaign id
 * without re-verifying real membership first.
 */
export async function readElectionLog({ client, requestedCampaign = null } = {}) {
  const userId = await getAuthenticatedUserId({ client });
  if (!userId) return { log: [], error: "no authenticated session" };
  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) return { log: [], error: scope.error ?? scope.reason ?? "no verified campaign membership" };
  return loadElectionLog({ client, campaignId: scope.campaignId });
}

/** Adapter-level refusal states — auth/scope concerns, never a write-content concern (that stays write.js's own vocabulary). */
export const WRITE_CHANNEL = Object.freeze({
  UNAUTHENTICATED:      "unauthenticated",
  UNAUTHORIZED:         "unauthorized",
  // LOOP 30 — distinct from UNAUTHORIZED: the caller IS a verified member
  // of a REAL campaign (scope resolved fine), but that campaign's OWN
  // declared actor_kind does not hold the capability this draft type
  // requires. A real, named refusal reason, not a re-use of "no
  // membership" for a genuinely different fact.
  UNAUTHORIZED_ACTOR_KIND: "unauthorized-actor-kind",
  // PILOT SAFETY PASS — distinct from both refusals above: the caller IS
  // a verified, ACTIVE member of a REAL campaign, and that campaign's
  // actor_kind DOES authorise this draft type, but the caller's own
  // campaign_member_role ('staff') does not. See
  // STAFF_RESTRICTED_EVENT_TYPES in events.js for the exact, narrow list
  // this refusal guards — the same list the election_events INSERT RLS
  // policy independently enforces (supabase/migrations/20260923000000_
  // election_membership_revocation_and_write_rbac.sql) as the
  // authoritative backstop this check exists only to pre-empt.
  UNAUTHORIZED_ROLE: "unauthorized-role",
});

/**
 * The ONE place a draft type's required actor_kind is checked against a
 * campaign's REAL, persisted declaration (LOOP 30). Pure, no I/O of its
 * own — `actorKind` must already have been read (by the caller) via
 * `getCampaignActorKind()`/`getElectionContext()`, the SAME authoritative
 * source `campaigns.actor_kind` everywhere else in this codebase. A draft
 * type with NO entry in `REQUIRED_ACTOR_KIND` (there is none today) is
 * treated as requiring no specific kind — fail-open only for a category
 * that does not exist yet, never for one of the three real types.
 */
function actorKindAuthorised(draftType, actorKind) {
  const required = REQUIRED_ACTOR_KIND[draftType];
  return !required || required === actorKind;
}

/**
 * PILOT SAFETY PASS — the application-layer mirror of the election_events
 * INSERT RLS policy's own election_event_writable_by_role() check (see
 * that migration). This function exists only to refuse earlier, with a
 * clearer reason, than a bare RLS-denied insert would — the database
 * policy is the authoritative enforcement, not this. `scope.role` is
 * already returned by resolveElectionScope() (electionScope.js) for
 * every SCOPED outcome, so no extra query is needed to check it here.
 */
function roleAuthorised(draftType, role) {
  return !(role === "staff" && STAFF_RESTRICTED_EVENT_TYPES.includes(draftType));
}

/**
 * PREPARE, ADAPTER-WRAPPED (Phase 6). Authenticates, independently
 * re-resolves scope (never trusts a `requestedCampaign` string on its own
 * word — the exact discipline `resolveElectionScope()` already enforces),
 * loads the CURRENT Canon view AND the campaign's own real `actor_kind`,
 * forwards to `proposeElectionWrite()`, and — LOOP 30 — refuses to hand
 * back a draft the resolved actor_kind is not authorised to make.
 *
 * THE DRAFT'S OWN CLAIMED TYPE IS NEVER TRUSTED AS AUTHORITY. `proposeElectionWrite()`
 * determines a draft's `type` purely from the MESSAGE TEXT (write.js's own
 * anchored patterns) — it has no concept of "who is allowed to say this."
 * This function is where that gap closes: after a draft exists, its
 * `type` is checked against the CAMPAIGN'S OWN persisted actor_kind
 * (`getElectionContext()`'s own read of `campaigns.actor_kind` — never a
 * caller-supplied `actorKind`/`organisationKind`/`role` field, because no
 * parameter of that name exists anywhere in this file for a hostile
 * request or model proposal to set).
 *
 * THIS FUNCTION NEVER MUTATES ANYTHING. `proposeElectionWrite()` itself
 * imports no client (proven by test/election-readiness.consumer.mjs's H1),
 * and this wrapper adds nothing that could reach one either — it only
 * reads (`getElectionContext()`) before calling it.
 */
export async function prepareElectionWrite({ client, requestedCampaign, message } = {}) {
  const userId = await getAuthenticatedUserId({ client });
  if (!userId) return { status: WRITE_CHANNEL.UNAUTHENTICATED, draft: null, reason: "no authenticated session" };

  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED, draft: null,
      reason: scope.error ?? scope.reason ?? "no verified campaign membership" };
  }

  const ctx = await getElectionContext({ userId, client, requestedCampaign: scope.campaignId });
  const proposed = await proposeElectionWrite({ message, view: ctx.view ?? {} });
  if (proposed.status !== "PREPARED") return proposed;

  if (!actorKindAuthorised(proposed.draft.draft.type, ctx.actorKind)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND, draft: null,
      reason: `this campaign (${ctx.actorKind ?? "unknown actor kind"}) is not authorised to record a ` +
              `"${proposed.draft.draft.type}" event` };
  }
  if (!roleAuthorised(proposed.draft.draft.type, scope.role)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED_ROLE, draft: null,
      reason: `your role in this campaign is not authorised to record a "${proposed.draft.draft.type}" event` };
  }
  return proposed;
}

/**
 * EXECUTE, ADAPTER-WRAPPED (Phase 6/8) — the ONLY function in this file
 * that can result in a persisted event, and it does so by calling
 * `executeElectionWrite()` exactly once, unchanged. It is a SEPARATE
 * function from `prepareElectionWrite()` — calling this one is the
 * explicit approval act itself; nothing in `prepareElectionWrite()`'s own
 * return value can trigger it. A caller (a UI's "Approve" button, an API
 * route) must construct this call deliberately, supplying the SAME draft
 * `prepareElectionWrite()` returned and its own `confirmationId`.
 *
 * SCOPE AND ACTOR_KIND ARE BOTH RE-RESOLVED HERE TOO, independently of
 * whatever `prepareElectionWrite()` found moments earlier — a membership
 * revoked, or (structurally, even though actor_kind itself is immutable
 * once set — 20260824000000_campaign_actor_kind.sql grants no UPDATE
 * policy) any authority fact that could in principle have changed between
 * PREPARE and APPROVAL, is caught HERE, never assumed unchanged from a
 * stale earlier read. `draft.type` — never a caller-supplied `actorKind`
 * field, which this function also has no parameter for — is what gets
 * checked against the freshly re-read `actor_kind`.
 */
export async function approveElectionWrite({ client, requestedCampaign, draft, confirmationId } = {}) {
  const userId = await getAuthenticatedUserId({ client });
  if (!userId) return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHENTICATED };

  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED };
  }

  const actorKind = await getCampaignActorKind({ client, campaignId: scope.campaignId });
  if (!actorKindAuthorised(draft?.type, actorKind)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND };
  }
  if (!roleAuthorised(draft?.type, scope.role)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED_ROLE };
  }

  return executeElectionWrite({ draft, campaign: scope.campaignId, userId, client, confirmationId });
}

// ============================================================
// ALPHA 1.0 — MOBILIZATION / ELECTION DAY STRUCTURED WRITES
//
// Same architecture as prepareElectionWrite/approveElectionWrite above —
// auth -> resolveElectionScope -> getElectionContext/getCampaignActorKind
// -> actorKindAuthorised -> execute — extended to operate on a caller-chosen
// `operation` + structured `fields` object instead of free-text `message`
// (see mobilization/write.js and electionDay/write.js for why: these
// actions carry too many independent fields for a single-sentence parser).
// Existing exports above (readElectionCanon, activateElection,
// prepareElectionWrite, approveElectionWrite) are UNCHANGED.
// ============================================================

export const MOBILIZATION_OPERATION = Object.freeze({
  ADD_PERSON: "add_person",
  CREATE_ASSIGNMENT: "create_assignment",
  CHANGE_ASSIGNMENT_STATUS: "change_assignment_status",
  CREATE_TASK: "create_task",
  CHANGE_TASK_STATUS: "change_task_status",
});

const MOBILIZATION_HANDLERS = Object.freeze({
  [MOBILIZATION_OPERATION.ADD_PERSON]: { propose: mobilizationWrite.proposeAddPerson, execute: mobilizationWrite.executeAddPerson },
  [MOBILIZATION_OPERATION.CREATE_ASSIGNMENT]: { propose: mobilizationWrite.proposeCreateAssignment, execute: mobilizationWrite.executeCreateAssignment },
  [MOBILIZATION_OPERATION.CHANGE_ASSIGNMENT_STATUS]: { propose: mobilizationWrite.proposeChangeAssignmentStatus, execute: mobilizationWrite.executeChangeAssignmentStatus },
  [MOBILIZATION_OPERATION.CREATE_TASK]: { propose: mobilizationWrite.proposeCreateTask, execute: mobilizationWrite.executeCreateTask },
  [MOBILIZATION_OPERATION.CHANGE_TASK_STATUS]: { propose: mobilizationWrite.proposeChangeTaskStatus, execute: mobilizationWrite.executeChangeTaskStatus },
});

export const ELECTION_DAY_OPERATION = Object.freeze({
  ADD_POLLING_UNIT: "add_polling_unit",
  ASSIGN_AGENT: "assign_agent",
  CHANGE_AGENT_STATUS: "change_agent_status",
  CAPTURE_RESULT: "capture_result",
  RECORD_OCR_EXTRACTION: "record_ocr_extraction",
  VERIFY_RESULT: "verify_result",
  REPORT_INCIDENT: "report_incident",
  CHANGE_INCIDENT_STATUS: "change_incident_status",
});

const ELECTION_DAY_HANDLERS = Object.freeze({
  [ELECTION_DAY_OPERATION.ADD_POLLING_UNIT]: { propose: electionDayWrite.proposeAddPollingUnit, execute: electionDayWrite.executeAddPollingUnit },
  [ELECTION_DAY_OPERATION.ASSIGN_AGENT]: { propose: electionDayWrite.proposeAssignAgent, execute: electionDayWrite.executeAssignAgent },
  [ELECTION_DAY_OPERATION.CHANGE_AGENT_STATUS]: { propose: electionDayWrite.proposeChangeAgentStatus, execute: electionDayWrite.executeChangeAgentStatus },
  [ELECTION_DAY_OPERATION.CAPTURE_RESULT]: { propose: electionDayWrite.proposeCaptureResult, execute: electionDayWrite.executeCaptureResult },
  [ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION]: { propose: electionDayWrite.proposeRecordOcrExtraction, execute: electionDayWrite.executeRecordOcrExtraction },
  [ELECTION_DAY_OPERATION.VERIFY_RESULT]: { propose: electionDayWrite.proposeVerifyResult, execute: electionDayWrite.executeVerifyResult },
  [ELECTION_DAY_OPERATION.REPORT_INCIDENT]: { propose: electionDayWrite.proposeReportIncident, execute: electionDayWrite.executeReportIncident },
  [ELECTION_DAY_OPERATION.CHANGE_INCIDENT_STATUS]: { propose: electionDayWrite.proposeChangeIncidentStatus, execute: electionDayWrite.executeChangeIncidentStatus },
});

// ELECTORAL GEOGRAPHY — same structured-write shape as Mobilization/Election
// Day above. `offices`/`states`/`constituencies`/`geographyTree` are the
// small reference-data lookups the UI already fetched via
// domains/election/geography/read.js (public-read, no adapter wrapping
// needed for reads themselves — see that module's own header); `roster` is
// the existing Mobilization roster (view.people). All passed through the
// SAME generic `extra`-bag prepareStructuredWrite() already supports.
export const GEOGRAPHY_OPERATION = Object.freeze({
  SET_TERRITORY: "set_territory",
  ASSIGN_RESPONSIBILITY: "assign_responsibility",
  // ELECTIONCANON 1.1 PHASE 1 — same generic PREPARE -> APPROVE -> EXECUTE
  // shape as every other geography operation; write_responsibility()
  // (called by executeReassignResponsibility) is what makes this safe
  // under concurrency/authorization, not this adapter layer.
  REASSIGN_RESPONSIBILITY: "reassign_responsibility",
  CHANGE_RESPONSIBILITY_STATUS: "change_responsibility_status",
});

const GEOGRAPHY_HANDLERS = Object.freeze({
  [GEOGRAPHY_OPERATION.SET_TERRITORY]: { propose: geographyWrite.proposeSetTerritory, execute: geographyWrite.executeSetTerritory },
  [GEOGRAPHY_OPERATION.ASSIGN_RESPONSIBILITY]: { propose: geographyWrite.proposeAssignResponsibility, execute: geographyWrite.executeAssignResponsibility },
  [GEOGRAPHY_OPERATION.REASSIGN_RESPONSIBILITY]: { propose: geographyWrite.proposeReassignResponsibility, execute: geographyWrite.executeReassignResponsibility },
  [GEOGRAPHY_OPERATION.CHANGE_RESPONSIBILITY_STATUS]: { propose: geographyWrite.proposeChangeResponsibilityStatus, execute: geographyWrite.executeChangeResponsibilityStatus },
});

async function prepareStructuredWrite({ client, requestedCampaign, fields, proposeFn, extra }) {
  const userId = await getAuthenticatedUserId({ client });
  if (!userId) return { status: WRITE_CHANNEL.UNAUTHENTICATED, draft: null, reason: "no authenticated session" };

  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED, draft: null,
      reason: scope.error ?? scope.reason ?? "no verified campaign membership" };
  }

  const ctx = await getElectionContext({ userId, client, requestedCampaign: scope.campaignId });
  // `extra` (e.g. { roster } or { knownResultIds }) is spread in
  // unconditionally — only the specific propose* that reads a given key
  // uses it, every other propose* still destructures {fields} and simply
  // ignores the rest, exactly like an extra unused fetch arg. This is a
  // generic passthrough, not a per-operation special case to maintain.
  const proposed = await proposeFn({ fields, ...extra });
  if (proposed.status !== "PREPARED") return proposed;

  if (!actorKindAuthorised(proposed.draft.draft.type, ctx.actorKind)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND, draft: null,
      reason: `this campaign (${ctx.actorKind ?? "unknown actor kind"}) is not authorised to record a ` +
              `"${proposed.draft.draft.type}" event` };
  }
  if (!roleAuthorised(proposed.draft.draft.type, scope.role)) {
    return { status: WRITE_CHANNEL.UNAUTHORIZED_ROLE, draft: null,
      reason: `your role in this campaign is not authorised to record a "${proposed.draft.draft.type}" event` };
  }
  return proposed;
}

async function approveStructuredWrite({ client, requestedCampaign, draft, confirmationId, executeFn }) {
  const userId = await getAuthenticatedUserId({ client });
  if (!userId) return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHENTICATED };

  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED };
  }

  const actorKind = await getCampaignActorKind({ client, campaignId: scope.campaignId });
  if (!actorKindAuthorised(draft?.type, actorKind)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND };
  }
  if (!roleAuthorised(draft?.type, scope.role)) {
    return { success: false, alreadyRecorded: false, error: WRITE_CHANNEL.UNAUTHORIZED_ROLE };
  }

  return executeFn({ draft, campaign: scope.campaignId, userId, client, confirmationId });
}

export async function prepareMobilizationWrite({ client, requestedCampaign, operation, fields } = {}) {
  const handler = MOBILIZATION_HANDLERS[operation];
  if (!handler) return { status: "NOT_UNDERSTOOD", draft: null, reason: `"${operation}" is not a recognised mobilization operation` };
  return prepareStructuredWrite({ client, requestedCampaign, fields, proposeFn: handler.propose });
}

export async function approveMobilizationWrite({ client, requestedCampaign, operation, draft, confirmationId } = {}) {
  const handler = MOBILIZATION_HANDLERS[operation];
  if (!handler) return { success: false, alreadyRecorded: false, error: `"${operation}" is not a recognised mobilization operation` };
  return approveStructuredWrite({ client, requestedCampaign, draft, confirmationId, executeFn: handler.execute });
}

export async function prepareElectionDayWrite({ client, requestedCampaign, operation, fields, roster, knownResultIds, knownEvidenceHashes } = {}) {
  const handler = ELECTION_DAY_HANDLERS[operation];
  if (!handler) return { status: "NOT_UNDERSTOOD", draft: null, reason: `"${operation}" is not a recognised election day operation` };
  const extra = {};
  if (roster !== undefined) extra.roster = roster;
  if (knownResultIds !== undefined) extra.knownResultIds = knownResultIds;
  if (knownEvidenceHashes !== undefined) extra.knownEvidenceHashes = knownEvidenceHashes;
  return prepareStructuredWrite({ client, requestedCampaign, fields, proposeFn: handler.propose, extra });
}

export async function approveElectionDayWrite({ client, requestedCampaign, operation, draft, confirmationId } = {}) {
  const handler = ELECTION_DAY_HANDLERS[operation];
  if (!handler) return { success: false, alreadyRecorded: false, error: `"${operation}" is not a recognised election day operation` };
  return approveStructuredWrite({ client, requestedCampaign, draft, confirmationId, executeFn: handler.execute });
}

export async function prepareGeographyWrite({ client, requestedCampaign, operation, fields, offices, states, constituencies, roster, geographyTree } = {}) {
  const handler = GEOGRAPHY_HANDLERS[operation];
  if (!handler) return { status: "NOT_UNDERSTOOD", draft: null, reason: `"${operation}" is not a recognised geography operation` };
  const extra = {};
  if (offices !== undefined) extra.offices = offices;
  if (states !== undefined) extra.states = states;
  if (constituencies !== undefined) extra.constituencies = constituencies;
  if (roster !== undefined) extra.roster = roster;
  if (geographyTree !== undefined) extra.geographyTree = geographyTree;
  return prepareStructuredWrite({ client, requestedCampaign, fields, proposeFn: handler.propose, extra });
}

export async function approveGeographyWrite({ client, requestedCampaign, operation, draft, confirmationId } = {}) {
  const handler = GEOGRAPHY_HANDLERS[operation];
  if (!handler) return { success: false, alreadyRecorded: false, error: `"${operation}" is not a recognised geography operation` };
  return approveStructuredWrite({ client, requestedCampaign, draft, confirmationId, executeFn: handler.execute });
}

export default {
  getAuthenticatedUserId, readElectionCanon, activateElection, readElectionLog,
  WRITE_CHANNEL, prepareElectionWrite, approveElectionWrite,
  MOBILIZATION_OPERATION, prepareMobilizationWrite, approveMobilizationWrite,
  ELECTION_DAY_OPERATION, prepareElectionDayWrite, approveElectionDayWrite,
  GEOGRAPHY_OPERATION, prepareGeographyWrite, approveGeographyWrite,
};
