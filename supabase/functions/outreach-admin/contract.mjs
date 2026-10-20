// ============================================================
// OUTREACH ACTIVATION — ADMIN CONTRACT  (Launch Engine, Outreach
// Activation 1.0)
//
// Plain JavaScript, no Deno APIs -- same split as every other
// supabase/functions/*/contract.mjs in this repo (modelled on
// election-invitation-email/contract.mjs): Deno runs this file in
// production, and the Node test suite runs the EXACT same code.
//
// This file deliberately re-declares the closed vocabularies already
// declared in src/domains/outreach/model.js and followup.js, rather than
// importing them. supabase/functions/* is a separately-deployed Deno
// boundary that cannot depend on src/ -- every existing contract.mjs in
// this repo (launch-subscribe, launch-invite-audience) follows the same
// "this boundary owns its own copy of the vocabulary" discipline (see
// e.g. launch-subscribe/contract.mjs's own SOURCE_CAMPAIGNS, duplicated
// again in src/pages/launch/shared.jsx). The SQL check constraints in
// 20261008000000_election_outreach_activation.sql are the third,
// independent copy -- belt and suspenders, same as every other table in
// this project.
//
// SINGLE ENDPOINT, MULTIPLE ACTIONS. Unlike the public launch functions
// (one narrow public contract each), this is an admin-only surface
// behind one shared secret, serving one small internal tool -- one
// Edge Function with an `action` dispatch is the "no new architecture"
// choice here, not a shortcut around validation: every action has its
// own request validator below, and index.ts never trusts the action
// string itself to imply the caller is authorized -- the
// OUTREACH_ADMIN_SECRET gate runs first, for every action, before any
// of this file is reached.
// ============================================================

export const SECTOR = Object.freeze([
  "media", "civic_tech", "democracy_election_org", "development_org",
  "open_source_dev", "institutional_partner", "other",
  // Political-office categories (Launch Engine closed-loop, Workspace B) --
  // mirrors 20261014000000_election_outreach_message_activity.sql's
  // expanded check constraint exactly.
  "presidential_campaign", "governorship_campaign", "senate_campaign",
  "house_of_reps_campaign", "state_assembly_campaign", "party_secretariat",
]);

export const PIPELINE_STATUS = Object.freeze([
  "DRAFT", "SENT", "DELIVERED", "ENGAGED", "RESPONDED", "FOLLOW_UP_DUE",
  "CONVERSATION", "DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST",
  "CONTRIBUTOR_INTEREST", "PUBLISHED", "DECLINED", "NO_RESPONSE", "BOUNCED",
]);

export const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["SENT"]),
  SENT: Object.freeze(["DELIVERED", "BOUNCED", "NO_RESPONSE"]),
  DELIVERED: Object.freeze(["ENGAGED", "NO_RESPONSE", "FOLLOW_UP_DUE"]),
  ENGAGED: Object.freeze(["RESPONDED", "FOLLOW_UP_DUE", "NO_RESPONSE"]),
  NO_RESPONSE: Object.freeze(["FOLLOW_UP_DUE", "DECLINED"]),
  FOLLOW_UP_DUE: Object.freeze(["SENT", "RESPONDED", "NO_RESPONSE", "DECLINED"]),
  RESPONDED: Object.freeze(["CONVERSATION", "DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE"]),
  CONVERSATION: Object.freeze(["DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE"]),
  DEMO: Object.freeze(["CONVERSATION", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE"]),
  EDITORIAL_INTEREST: Object.freeze(["PUBLISHED", "DECLINED", "FOLLOW_UP_DUE"]),
  PARTNERSHIP_INTEREST: Object.freeze(["PUBLISHED", "DECLINED", "FOLLOW_UP_DUE"]),
  CONTRIBUTOR_INTEREST: Object.freeze(["PUBLISHED", "DECLINED", "FOLLOW_UP_DUE"]),
  PUBLISHED: Object.freeze([]),
  DECLINED: Object.freeze([]),
  BOUNCED: Object.freeze([]),
});

export const DELIVERY_STATUS = Object.freeze(["UNKNOWN", "SENT", "DELIVERED", "BOUNCED", "FAILED"]);
export const ENGAGEMENT_STATUS = Object.freeze(["UNKNOWN", "NONE", "ACKNOWLEDGED"]);
export const RESPONSE_STATUS = Object.freeze(["UNKNOWN", "NONE", "RESPONDED", "DECLINED"]);
export const CONVERSATION_STATUS = Object.freeze(["NONE", "REQUESTED", "SCHEDULED", "ACTIVE", "ENDED"]);
export const SOURCE_OF_TRUTH = Object.freeze(["MANUAL_IMPORT", "MANUAL_ENTRY", "INBOUND_REPLY"]);
export const SENDER_ACCOUNT = Object.freeze(["sotinnovate@gmail.com", "admin@electioncanon.org", "UNKNOWN"]);

export const ASSET_CODE = Object.freeze([
  "A_INSTITUTIONAL_FOLLOWUP", "B_CIVIC_TECH_FOLLOWUP", "C_MEDIA_FOLLOWUP", "D_OPEN_SOURCE_FOLLOWUP",
  "E_ACKNOWLEDGEMENT_FOLLOWUP", "F_DEMO_REQUEST_RESPONSE", "G_CONVERSATION_REQUEST_RESPONSE",
]);

export const FOLLOWUP_STATE = Object.freeze(["DRAFT", "REVIEW", "APPROVED", "SENT", "CANCELLED"]);

export const FOLLOWUP_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["REVIEW", "CANCELLED"]),
  REVIEW: Object.freeze(["DRAFT", "APPROVED", "CANCELLED"]),
  APPROVED: Object.freeze(["SENT", "DRAFT", "CANCELLED"]),
  SENT: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SHORT = 200;
const MAX_LONG = 4000;

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function boundedString(v, max) { return typeof v === "string" && v.length <= max; }

/** Shared by create_contact (one row) and import_contacts (many rows, one at a time). */
export function validateContactPayload(c) {
  if (!c || typeof c !== "object") return { valid: false, error: "contact is required" };
  if (!isNonEmptyString(c.organization) || !boundedString(c.organization, MAX_SHORT)) {
    return { valid: false, error: "organization is required" };
  }
  if (!isNonEmptyString(c.recipientEmail) || !EMAIL_RE.test(c.recipientEmail.trim())) {
    return { valid: false, error: "recipientEmail must be a valid email address" };
  }
  if (!SECTOR.includes(c.sector)) return { valid: false, error: `sector must be one of: ${SECTOR.join(", ")}` };
  if (!SOURCE_OF_TRUTH.includes(c.sourceOfTruth)) return { valid: false, error: `sourceOfTruth must be one of: ${SOURCE_OF_TRUTH.join(", ")}` };
  if (c.status !== undefined && !PIPELINE_STATUS.includes(c.status)) return { valid: false, error: `status must be one of: ${PIPELINE_STATUS.join(", ")}` };
  if (c.recipientName != null && !boundedString(c.recipientName, MAX_SHORT)) return { valid: false, error: "recipientName is too long" };
  if (c.senderAccount !== undefined && !SENDER_ACCOUNT.includes(c.senderAccount)) return { valid: false, error: `senderAccount must be one of: ${SENDER_ACCOUNT.join(", ")}` };
  if (c.sourceRecordRef != null && !boundedString(c.sourceRecordRef, MAX_SHORT)) return { valid: false, error: "sourceRecordRef is too long" };
  if (c.notes != null && !boundedString(c.notes, MAX_LONG)) return { valid: false, error: "notes is too long" };
  if (c.nextAction != null && !boundedString(c.nextAction, MAX_LONG)) return { valid: false, error: "nextAction is too long" };
  return { valid: true, error: null };
}

export function validateListContactsRequest(body) {
  const status = body && typeof body === "object" ? body.status : undefined;
  const sector = body && typeof body === "object" ? body.sector : undefined;
  if (status !== undefined && status !== null && !PIPELINE_STATUS.includes(status)) {
    return { valid: false, error: `status filter must be one of: ${PIPELINE_STATUS.join(", ")}` };
  }
  if (sector !== undefined && sector !== null && !SECTOR.includes(sector)) {
    return { valid: false, error: `sector filter must be one of: ${SECTOR.join(", ")}` };
  }
  return { valid: true, error: null, status: status || null, sector: sector || null };
}

export const MAX_IMPORT_BATCH = 500;

export function validateImportRequest(body) {
  const contacts = body && typeof body === "object" ? body.contacts : undefined;
  if (!Array.isArray(contacts) || contacts.length === 0) return { valid: false, error: "contacts must be a non-empty array" };
  if (contacts.length > MAX_IMPORT_BATCH) return { valid: false, error: `at most ${MAX_IMPORT_BATCH} contacts may be imported per request` };
  return { valid: true, error: null, contacts };
}

// ---------- historical import reconciliation (Phase 7 fix) ----------
// Mirrors src/domains/outreach/historicalImport.js's note convention
// exactly (this boundary cannot import src/, per this file's own header
// -- same duplication discipline as every vocabulary above). A historical
// event is identified only by this exact prefix; see hasHistoricalEvent().

export const HISTORICAL_EVENT_PREFIX = "[historical_import:";
export const MAX_HISTORICAL_BATCH = 500;

export function hasHistoricalEvent(existingNotes, sourceRecordRef) {
  if (!sourceRecordRef) return false;
  const needle = `${HISTORICAL_EVENT_PREFIX}${sourceRecordRef}]`;
  for (const note of existingNotes || []) {
    if (typeof note === "string" && note.includes(needle)) return true;
  }
  return false;
}

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

/** A historical event is optional (a brand-new DRAFT-only contact with no sentAt proposes none) but must be well-formed when present. */
function validateHistoricalEvent(ev) {
  if (ev == null) return { valid: true, error: null };
  if (!isPlainObject(ev)) return { valid: false, error: "historicalEvent must be an object or null" };
  if (!isNonEmptyString(ev.sourceRecordRef) || !boundedString(ev.sourceRecordRef, MAX_SHORT)) {
    return { valid: false, error: "historicalEvent.sourceRecordRef is required" };
  }
  if (!isNonEmptyString(ev.note) || !boundedString(ev.note, 2000)) {
    return { valid: false, error: "historicalEvent.note is required (max 2000 chars)" };
  }
  if (!PIPELINE_STATUS.includes(ev.fromStatus)) return { valid: false, error: `historicalEvent.fromStatus must be one of: ${PIPELINE_STATUS.join(", ")}` };
  if (!PIPELINE_STATUS.includes(ev.toStatus)) return { valid: false, error: `historicalEvent.toStatus must be one of: ${PIPELINE_STATUS.join(", ")}` };
  const transitionCheck = validateStatusTransition(ev.fromStatus, ev.toStatus);
  if (!transitionCheck.valid) return { valid: false, error: `historicalEvent transition rejected: ${transitionCheck.error}` };
  if (ev.changedAt != null) {
    const d = new Date(ev.changedAt);
    if (Number.isNaN(d.getTime())) return { valid: false, error: "historicalEvent.changedAt is not a valid date" };
  }
  return { valid: true, error: null };
}

/** Only an empty/UNKNOWN slot may ever be proposed as a patch target -- checked again server-side against the live row in index.ts before writing. */
const CONTACT_PATCH_FIELDS = Object.freeze(["status", "sentAt", "deliveryStatus", "senderAccount", "sourceRecordRef", "subject", "campaign", "letterVersion", "country"]);

function validateContactPatch(patch) {
  if (patch == null) return { valid: true, error: null };
  if (!isPlainObject(patch)) return { valid: false, error: "contactPatch must be an object or null" };
  for (const key of Object.keys(patch)) {
    if (!CONTACT_PATCH_FIELDS.includes(key)) return { valid: false, error: `contactPatch has an unexpected field: ${key}` };
  }
  if (patch.status !== undefined && !PIPELINE_STATUS.includes(patch.status)) return { valid: false, error: `contactPatch.status must be one of: ${PIPELINE_STATUS.join(", ")}` };
  if (patch.deliveryStatus !== undefined && !DELIVERY_STATUS.includes(patch.deliveryStatus)) return { valid: false, error: `contactPatch.deliveryStatus must be one of: ${DELIVERY_STATUS.join(", ")}` };
  if (patch.senderAccount !== undefined && !SENDER_ACCOUNT.includes(patch.senderAccount)) return { valid: false, error: `contactPatch.senderAccount must be one of: ${SENDER_ACCOUNT.join(", ")}` };
  return { valid: true, error: null };
}

/**
 * Validates the full historical-reconciliation request built by
 * src/domains/outreach/historicalImport.js's planHistoricalReconciliation().
 * toCreate: [{ contact, historicalEvent }]
 * toAttachExisting: [{ existingContactId, contactPatch, historicalEvent }]
 * toAttachNewBatch: [{ groupEmail, historicalEvent }] -- resolved against a
 *   toCreate row sharing the same groupEmail, applied only after that
 *   row's contact has actually been inserted (index.ts's job, not this
 *   validator's).
 */
export function validateHistoricalReconcileRequest(body) {
  const toCreate = body && typeof body === "object" ? body.toCreate : undefined;
  const toAttachExisting = body && typeof body === "object" ? body.toAttachExisting : undefined;
  const toAttachNewBatch = body && typeof body === "object" ? body.toAttachNewBatch : undefined;

  if (toCreate !== undefined && !Array.isArray(toCreate)) return { valid: false, error: "toCreate must be an array" };
  if (toAttachExisting !== undefined && !Array.isArray(toAttachExisting)) return { valid: false, error: "toAttachExisting must be an array" };
  if (toAttachNewBatch !== undefined && !Array.isArray(toAttachNewBatch)) return { valid: false, error: "toAttachNewBatch must be an array" };

  const create = toCreate || [];
  const attachExisting = toAttachExisting || [];
  const attachNewBatch = toAttachNewBatch || [];
  const total = create.length + attachExisting.length + attachNewBatch.length;
  if (total === 0) return { valid: false, error: "at least one of toCreate/toAttachExisting/toAttachNewBatch must contain a row" };
  if (total > MAX_HISTORICAL_BATCH) return { valid: false, error: `at most ${MAX_HISTORICAL_BATCH} rows may be reconciled per request` };

  for (const [i, row] of create.entries()) {
    const payloadCheck = validateContactPayload(row?.contact);
    if (!payloadCheck.valid) return { valid: false, error: `toCreate[${i}]: ${payloadCheck.error}` };
    const eventCheck = validateHistoricalEvent(row?.historicalEvent);
    if (!eventCheck.valid) return { valid: false, error: `toCreate[${i}]: ${eventCheck.error}` };
    if (!isNonEmptyString(row?.groupEmail)) return { valid: false, error: `toCreate[${i}]: groupEmail is required` };
  }
  for (const [i, row] of attachExisting.entries()) {
    if (!isNonEmptyString(row?.existingContactId)) return { valid: false, error: `toAttachExisting[${i}]: existingContactId is required` };
    const patchCheck = validateContactPatch(row?.contactPatch);
    if (!patchCheck.valid) return { valid: false, error: `toAttachExisting[${i}]: ${patchCheck.error}` };
    const eventCheck = validateHistoricalEvent(row?.historicalEvent);
    if (!eventCheck.valid) return { valid: false, error: `toAttachExisting[${i}]: ${eventCheck.error}` };
    if (!row?.historicalEvent) return { valid: false, error: `toAttachExisting[${i}]: historicalEvent is required for an existing-contact attachment` };
  }
  for (const [i, row] of attachNewBatch.entries()) {
    if (!isNonEmptyString(row?.groupEmail)) return { valid: false, error: `toAttachNewBatch[${i}]: groupEmail is required` };
    const eventCheck = validateHistoricalEvent(row?.historicalEvent);
    if (!eventCheck.valid) return { valid: false, error: `toAttachNewBatch[${i}]: ${eventCheck.error}` };
    if (!row?.historicalEvent) return { valid: false, error: `toAttachNewBatch[${i}]: historicalEvent is required` };
  }

  return { valid: true, error: null, toCreate: create, toAttachExisting: attachExisting, toAttachNewBatch: attachNewBatch };
}

export function validateStatusTransition(fromStatus, toStatus) {
  if (!PIPELINE_STATUS.includes(fromStatus)) return { valid: false, error: `unknown current status: ${fromStatus}` };
  if (!PIPELINE_STATUS.includes(toStatus)) return { valid: false, error: `unknown target status: ${toStatus}` };
  if (fromStatus === toStatus) return { valid: true, error: null };
  const allowed = STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) return { valid: false, error: `cannot move from ${fromStatus} to ${toStatus}` };
  return { valid: true, error: null };
}

export function validateUpdateStatusRequest(body) {
  const contactId = body && typeof body === "object" ? body.contactId : undefined;
  const toStatus = body && typeof body === "object" ? body.toStatus : undefined;
  if (!isNonEmptyString(contactId)) return { valid: false, error: "contactId is required" };
  if (!PIPELINE_STATUS.includes(toStatus)) return { valid: false, error: `toStatus must be one of: ${PIPELINE_STATUS.join(", ")}` };
  const note = body.note != null ? String(body.note).slice(0, 2000) : null;
  const fields = {};
  if (body.responseStatus !== undefined) {
    if (!RESPONSE_STATUS.includes(body.responseStatus)) return { valid: false, error: `responseStatus must be one of: ${RESPONSE_STATUS.join(", ")}` };
    fields.responseStatus = body.responseStatus;
  }
  if (body.deliveryStatus !== undefined) {
    if (!DELIVERY_STATUS.includes(body.deliveryStatus)) return { valid: false, error: `deliveryStatus must be one of: ${DELIVERY_STATUS.join(", ")}` };
    fields.deliveryStatus = body.deliveryStatus;
  }
  if (body.engagementStatus !== undefined) {
    if (!ENGAGEMENT_STATUS.includes(body.engagementStatus)) return { valid: false, error: `engagementStatus must be one of: ${ENGAGEMENT_STATUS.join(", ")}` };
    fields.engagementStatus = body.engagementStatus;
  }
  if (body.conversationStatus !== undefined) {
    if (!CONVERSATION_STATUS.includes(body.conversationStatus)) return { valid: false, error: `conversationStatus must be one of: ${CONVERSATION_STATUS.join(", ")}` };
    fields.conversationStatus = body.conversationStatus;
  }
  if (body.followUpDueAt !== undefined) fields.followUpDueAt = body.followUpDueAt;
  if (body.nextAction !== undefined) fields.nextAction = body.nextAction != null ? String(body.nextAction).slice(0, 4000) : null;
  if (body.demoSent !== undefined) fields.demoSent = !!body.demoSent;
  if (body.githubSent !== undefined) fields.githubSent = !!body.githubSent;
  if (body.evidencePackageSent !== undefined) fields.evidencePackageSent = !!body.evidencePackageSent;

  return { valid: true, error: null, contactId, toStatus, note, fields };
}

export function validateCreateFollowUpRequest(body) {
  const contactId = body && typeof body === "object" ? body.contactId : undefined;
  const assetCode = body && typeof body === "object" ? body.assetCode : undefined;
  const subject = body && typeof body === "object" ? body.subject : undefined;
  const text = body && typeof body === "object" ? body.body : undefined;
  if (!isNonEmptyString(contactId)) return { valid: false, error: "contactId is required" };
  if (!ASSET_CODE.includes(assetCode)) return { valid: false, error: `assetCode must be one of: ${ASSET_CODE.join(", ")}` };
  if (!isNonEmptyString(subject) || subject.length > 300) return { valid: false, error: "subject is required (max 300 chars)" };
  if (!isNonEmptyString(text) || text.length > 8000) return { valid: false, error: "body is required (max 8000 chars)" };
  return { valid: true, error: null, contactId, assetCode, subject, body: text };
}

export function validateFollowUpTransition(fromState, toState) {
  if (!FOLLOWUP_STATE.includes(fromState)) return { valid: false, error: `unknown current state: ${fromState}` };
  if (!FOLLOWUP_STATE.includes(toState)) return { valid: false, error: `unknown target state: ${toState}` };
  if (fromState === toState) return { valid: true, error: null };
  const allowed = FOLLOWUP_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) return { valid: false, error: `cannot move from ${fromState} to ${toState}` };
  return { valid: true, error: null };
}

export function validateTransitionFollowUpRequest(body) {
  const followUpId = body && typeof body === "object" ? body.followUpId : undefined;
  const toState = body && typeof body === "object" ? body.toState : undefined;
  if (!isNonEmptyString(followUpId)) return { valid: false, error: "followUpId is required" };
  if (!FOLLOWUP_STATE.includes(toState)) return { valid: false, error: `toState must be one of: ${FOLLOWUP_STATE.join(", ")}` };
  const approvedBy = body.approvedBy != null ? String(body.approvedBy).slice(0, 200) : null;
  return { valid: true, error: null, followUpId, toState, approvedBy };
}

// ---------- message activity (Launch Engine closed-loop, Phase 3) ----------
// Third independent copy of messageActivity.js's vocabulary -- same
// belt-and-suspenders discipline as every other vocabulary in this file
// (src/ cannot be imported from this Deno boundary).

export const DIRECTION = Object.freeze(["OUTBOUND", "INBOUND"]);
export const ACTIVITY_STATE = Object.freeze(["PREPARED", "SENT", "REPLY_RECEIVED"]);
export const MESSAGE_PROVIDER = Object.freeze(["GMAIL", "BREVO", "MANUAL_ATTESTATION"]);
export const MATCH_CONFIDENCE = Object.freeze(["HIGH_CONFIDENCE", "NEEDS_REVIEW"]);
export const MAX_EVENT_BATCH = 100;

/**
 * Validates a record_message_event request. Re-enforces, server-side,
 * the EXACT same evidence rule messageActivity.js's validateMessageEvent()
 * enforces client-side: a SENT/REPLY_RECEIVED claim from a live provider
 * must carry a real providerMessageId -- never trusted from the client
 * alone, since a compromised or buggy caller could otherwise fabricate a
 * SENT row with no real evidence behind it.
 */
export function validateRecordMessageEventRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!isNonEmptyString(b.contactId)) return { valid: false, error: "contactId is required" };
  if (!DIRECTION.includes(b.direction)) return { valid: false, error: `direction must be one of: ${DIRECTION.join(", ")}` };
  if (!ACTIVITY_STATE.includes(b.activityState)) return { valid: false, error: `activityState must be one of: ${ACTIVITY_STATE.join(", ")}` };
  if (!MESSAGE_PROVIDER.includes(b.provider)) return { valid: false, error: `provider must be one of: ${MESSAGE_PROVIDER.join(", ")}` };
  if (!isNonEmptyString(b.idempotencyKey) || !boundedString(b.idempotencyKey, 300)) {
    return { valid: false, error: "idempotencyKey is required" };
  }
  if (b.direction === "INBOUND" && b.activityState !== "REPLY_RECEIVED") {
    return { valid: false, error: "an INBOUND event must have activityState REPLY_RECEIVED" };
  }
  if (b.activityState !== "PREPARED" && b.provider !== "MANUAL_ATTESTATION" && !isNonEmptyString(b.providerMessageId)) {
    return { valid: false, error: `a ${b.activityState} event from provider ${b.provider} requires a real providerMessageId` };
  }
  if (b.provider === "MANUAL_ATTESTATION" && !b.occurredAt) {
    return { valid: false, error: "a MANUAL_ATTESTATION event requires occurredAt" };
  }
  if (b.followupId != null && !isNonEmptyString(b.followupId)) return { valid: false, error: "followupId must be a non-empty string when present" };
  if (b.providerMessageId != null && !boundedString(b.providerMessageId, MAX_SHORT)) return { valid: false, error: "providerMessageId is too long" };
  if (b.providerThreadId != null && !boundedString(b.providerThreadId, MAX_SHORT)) return { valid: false, error: "providerThreadId is too long" };
  if (b.rfcMessageId != null && !boundedString(b.rfcMessageId, 500)) return { valid: false, error: "rfcMessageId is too long" };
  if (b.senderIdentity != null && !SENDER_ACCOUNT.includes(b.senderIdentity)) return { valid: false, error: `senderIdentity must be one of: ${SENDER_ACCOUNT.join(", ")}` };
  if (b.matchConfidence !== undefined && !MATCH_CONFIDENCE.includes(b.matchConfidence)) return { valid: false, error: `matchConfidence must be one of: ${MATCH_CONFIDENCE.join(", ")}` };
  if (b.occurredAt != null && Number.isNaN(new Date(b.occurredAt).getTime())) return { valid: false, error: "occurredAt is not a valid date" };

  return {
    valid: true, error: null,
    contactId: b.contactId, followupId: b.followupId ?? null, direction: b.direction, activityState: b.activityState,
    provider: b.provider, providerMessageId: b.providerMessageId ?? null, providerThreadId: b.providerThreadId ?? null,
    rfcMessageId: b.rfcMessageId ?? null, inReplyTo: b.inReplyTo ?? null, referencesHeader: b.referencesHeader ?? null,
    senderIdentity: b.senderIdentity ?? "UNKNOWN", recipientEmail: b.recipientEmail ?? null, subject: b.subject ?? null,
    occurredAt: b.occurredAt ?? null, matchConfidence: b.matchConfidence ?? "HIGH_CONFIDENCE", idempotencyKey: b.idempotencyKey,
  };
}

export function validateListMessageEventsRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.contactId != null && !isNonEmptyString(b.contactId)) return { valid: false, error: "contactId must be a non-empty string when present" };
  if (b.followupId != null && !isNonEmptyString(b.followupId)) return { valid: false, error: "followupId must be a non-empty string when present" };
  return { valid: true, error: null, contactId: b.contactId ?? null, followupId: b.followupId ?? null };
}

export default {
  SECTOR, PIPELINE_STATUS, STATUS_TRANSITIONS, DELIVERY_STATUS, ENGAGEMENT_STATUS, RESPONSE_STATUS,
  CONVERSATION_STATUS, SOURCE_OF_TRUTH, SENDER_ACCOUNT, ASSET_CODE, FOLLOWUP_STATE, FOLLOWUP_TRANSITIONS, MAX_IMPORT_BATCH,
  HISTORICAL_EVENT_PREFIX, MAX_HISTORICAL_BATCH, DIRECTION, ACTIVITY_STATE, MESSAGE_PROVIDER, MATCH_CONFIDENCE, MAX_EVENT_BATCH,
  validateContactPayload, validateListContactsRequest, validateImportRequest, validateStatusTransition,
  validateUpdateStatusRequest, validateCreateFollowUpRequest, validateFollowUpTransition, validateTransitionFollowUpRequest,
  hasHistoricalEvent, validateHistoricalReconcileRequest, validateRecordMessageEventRequest, validateListMessageEventsRequest,
};
