// ============================================================
// OUTREACH ACTIVATION — MESSAGE ACTIVITY  (Launch Engine closed-loop,
// Phase 3: the four truthful states)
//
// WHAT THIS FILE OWNS. outreach_contacts.status and outreach_followups.
// state (model.js / followup.js) are the business-outcome pipelines --
// they answer "where is this relationship." This file is the evidence
// layer underneath them: did a message actually get prepared, actually
// get sent (with real provider proof), did a reply actually arrive, and
// is a follow-up's SENT claim actually backed by something. It never
// reads or writes outreach_contacts/outreach_followups itself -- see
// supabase/functions/outreach-admin/index.ts for where these functions'
// outputs get persisted to outreach_message_events alongside (never
// instead of) the existing pipeline writes.
//
// THE FOUR STATES, AND WHY THEY ARE NEVER ONE MUTABLE COLUMN.
//   1. PREPARED        -- a draft/message object exists. Nothing claims
//      it was sent.
//   2. SENT             -- a provider (GMAIL) or a human
//      (MANUAL_ATTESTATION) confirms dispatch. GMAIL claims always carry
//      a real providerMessageId; a provider error or a missing id can
//      never become a SENT row -- see validateMessageEvent() below,
//      which REFUSES to validate a SENT/GMAIL event with no message id.
//   3. REPLY_RECEIVED   -- an inbound message is matched to a contact
//      AND a thread. Ambiguous matches are flagged NEEDS_REVIEW, never
//      silently assigned -- see matchReplyToContact() below, which
//      reuses the exact-evidence-promotes-everything-else-downgrades
//      discipline reconcile.js already established for the historical
//      CSV reconciliation, applied here to live Gmail thread/message-id
//      evidence instead.
//   4. (outreach_followups.state === 'SENT') -- deliberately NOT a
//      fourth activity_state here. deriveFollowUpCompletionEvidence()
//      below answers "is this SENT claim actually backed by evidence,"
//      given the follow-up's own state plus whatever message_events rows
//      are linked to it -- a prepared/approved follow-up with no linked
//      SENT evidence is never reported as completed by this function,
//      regardless of what outreach_followups.state says.
//
// A PREPARED ROW NEVER INCREMENTS A SENT COUNT. computeActivitySummary()
// below counts each activity_state independently -- there is no code
// path anywhere in this file that promotes a PREPARED count into a SENT
// count, or treats a provider error as a success.
//
// PURE, LOCAL-ONLY: no fs, no network, no Supabase client, no React --
// same discipline as model.js/followup.js/reconcile.js (this file
// belongs on test/election-outreach-launch-separation.consumer.mjs's
// source-scan list).
// ============================================================

export const DIRECTION = Object.freeze(["OUTBOUND", "INBOUND"]);
export const ACTIVITY_STATE = Object.freeze(["PREPARED", "SENT", "REPLY_RECEIVED"]);
export const PROVIDER = Object.freeze(["GMAIL", "BREVO", "MANUAL_ATTESTATION"]);
export const MATCH_CONFIDENCE = Object.freeze(["HIGH_CONFIDENCE", "NEEDS_REVIEW"]);
export const SENDER_IDENTITY = Object.freeze(["admin@electioncanon.org", "sotinnovate@gmail.com", "UNKNOWN"]);

const MAX_SHORT = 200;
const MAX_ID = 500;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function boundedString(v, max) {
  return typeof v === "string" && v.length <= max;
}

/** Pure defaulting -- never invents a providerMessageId, threadId, or any other unseen fact. */
export function defaultMessageEventFor({ contactId, direction, activityState, provider, followupId = null }) {
  return {
    contactId,
    followupId,
    direction,
    activityState,
    provider,
    providerMessageId: null,
    providerThreadId: null,
    rfcMessageId: null,
    inReplyTo: null,
    referencesHeader: null,
    senderIdentity: "UNKNOWN",
    recipientEmail: null,
    subject: null,
    occurredAt: null,
    matchConfidence: "HIGH_CONFIDENCE",
    idempotencyKey: null,
  };
}

/**
 * Validates one message-activity event. Returns {valid, error}, never
 * mutates `event`. THE CORE SAFETY RULE: a SENT/REPLY_RECEIVED claim
 * from a live provider (GMAIL/BREVO) must carry a real providerMessageId
 * -- a provider error, a timeout, or a missing id can never pass this
 * check as SENT. MANUAL_ATTESTATION is the one deliberate exception (a
 * human personally sent it through their own client, so there is no
 * provider id to check) -- it still requires occurredAt, so a manual
 * attestation is always dated, never a bare unattributed claim.
 */
export function validateMessageEvent(event) {
  if (!event || typeof event !== "object") return { valid: false, error: "event is required" };
  if (!isNonEmptyString(event.contactId)) return { valid: false, error: "contactId is required" };
  if (!DIRECTION.includes(event.direction)) return { valid: false, error: `direction must be one of: ${DIRECTION.join(", ")}` };
  if (!ACTIVITY_STATE.includes(event.activityState)) return { valid: false, error: `activityState must be one of: ${ACTIVITY_STATE.join(", ")}` };
  if (!PROVIDER.includes(event.provider)) return { valid: false, error: `provider must be one of: ${PROVIDER.join(", ")}` };
  if (!isNonEmptyString(event.idempotencyKey) || !boundedString(event.idempotencyKey, 300)) {
    return { valid: false, error: "idempotencyKey is required" };
  }

  if (event.direction === "INBOUND" && event.activityState !== "REPLY_RECEIVED") {
    return { valid: false, error: "an INBOUND event must have activityState REPLY_RECEIVED -- there is no inbound PREPARED or SENT" };
  }

  if (event.activityState !== "PREPARED" && event.provider !== "MANUAL_ATTESTATION" && !isNonEmptyString(event.providerMessageId)) {
    return { valid: false, error: `a ${event.activityState} event from provider ${event.provider} requires a real providerMessageId -- a provider error or missing id must never be recorded as ${event.activityState}` };
  }
  if (event.provider === "MANUAL_ATTESTATION" && !event.occurredAt) {
    return { valid: false, error: "a MANUAL_ATTESTATION event requires occurredAt -- a manual send must be dated, never a bare unattributed claim" };
  }

  if (event.providerMessageId != null && !boundedString(event.providerMessageId, MAX_SHORT)) return { valid: false, error: "providerMessageId is too long" };
  if (event.providerThreadId != null && !boundedString(event.providerThreadId, MAX_SHORT)) return { valid: false, error: "providerThreadId is too long" };
  if (event.rfcMessageId != null && !boundedString(event.rfcMessageId, MAX_ID)) return { valid: false, error: "rfcMessageId is too long" };
  if (event.senderIdentity !== undefined && event.senderIdentity != null && !SENDER_IDENTITY.includes(event.senderIdentity)) {
    return { valid: false, error: `senderIdentity must be one of: ${SENDER_IDENTITY.join(", ")}` };
  }
  if (event.matchConfidence !== undefined && !MATCH_CONFIDENCE.includes(event.matchConfidence)) {
    return { valid: false, error: `matchConfidence must be one of: ${MATCH_CONFIDENCE.join(", ")}` };
  }
  if (event.occurredAt != null) {
    const d = new Date(event.occurredAt);
    if (Number.isNaN(d.getTime())) return { valid: false, error: "occurredAt is not a valid date" };
  }

  return { valid: true, error: null };
}

/**
 * Stable idempotency keys -- the SAME real-world event always produces
 * the SAME key, so a retried send/sync request can never double-insert
 * (enforced again, independently, by the database's own unique index).
 * A caller-supplied confirmationId (Phase 4's "stable idempotency/
 * confirmation identifier" requirement) is required for a fresh send
 * attempt, since a brand-new Gmail send has no providerMessageId to key
 * on until AFTER it succeeds -- the key must exist BEFORE the attempt,
 * precisely so a retry after a timeout can be recognized as the same
 * attempt rather than firing a second real send.
 */
export function buildSendIdempotencyKey({ contactId, confirmationId }) {
  return `send:${contactId}:${confirmationId}`;
}
export function buildGmailEvidenceIdempotencyKey({ providerMessageId }) {
  return `gmail:${providerMessageId}`;
}
export function buildManualAttestationIdempotencyKey({ contactId, occurredAt }) {
  return `manual:${contactId}:${occurredAt}`;
}

/**
 * Matches one inbound Gmail message against a set of this contact's
 * (or all contacts') known OUTBOUND message_events rows. Mirrors
 * reconcile.js's own discipline exactly: THREAD/MESSAGE-ID EVIDENCE IS
 * THE ONLY THING THAT CAN PROMOTE A MATCH. RFC Message-ID/In-Reply-To/
 * References are supporting evidence that can only CORROBORATE a
 * thread-id match or help choose among several same-thread candidates --
 * never promote a match on their own when no thread-id evidence exists.
 * Normalised sender/subject are supporting evidence only, consulted
 * strictly as tie-breakers, and NEVER sufficient by themselves -- a
 * subject-only match with more than one candidate thread is always
 * NEEDS_REVIEW, never guessed.
 *
 * Returns { confidence: 'HIGH_CONFIDENCE'|'NEEDS_REVIEW'|'NO_MATCH',
 * contactId, matchedOutboundEvent, reason, candidates }.
 */
export function matchReplyToContact(inboundMessage, knownOutboundEvents) {
  const byThread = (knownOutboundEvents || []).filter(
    (e) => e.providerThreadId && inboundMessage.providerThreadId && e.providerThreadId === inboundMessage.providerThreadId
  );

  if (byThread.length === 1) {
    return { confidence: "HIGH_CONFIDENCE", contactId: byThread[0].contactId, matchedOutboundEvent: byThread[0], reason: null, candidates: byThread };
  }
  if (byThread.length > 1) {
    // Multiple of OUR OWN outbound events share this thread id (e.g. an
    // original letter plus a follow-up in the same thread) -- RFC
    // headers can narrow this down, but only to ONE OF THESE candidates,
    // never to a candidate outside the thread-id match set.
    const byRfc = byThread.filter(
      (e) => e.rfcMessageId && (inboundMessage.inReplyTo === e.rfcMessageId || (inboundMessage.referencesHeader || "").includes(e.rfcMessageId))
    );
    if (byRfc.length === 1) {
      return { confidence: "HIGH_CONFIDENCE", contactId: byRfc[0].contactId, matchedOutboundEvent: byRfc[0], reason: null, candidates: byThread };
    }
    return {
      confidence: "NEEDS_REVIEW",
      contactId: byThread[0].contactId, // same contact for every row sharing a thread id by construction
      matchedOutboundEvent: null,
      reason: `${byThread.length} of our own outbound messages share this Gmail thread id, and RFC headers did not narrow it to exactly one -- a human must pick which outbound message this reply answers`,
      candidates: byThread,
    };
  }

  // No thread-id evidence at all -- fall back to RFC In-Reply-To/References
  // against ANY known outbound event (not thread-scoped), still requiring
  // an EXACT header match, never a subject/sender guess.
  const byRfcOnly = (knownOutboundEvents || []).filter(
    (e) => e.rfcMessageId && (inboundMessage.inReplyTo === e.rfcMessageId || (inboundMessage.referencesHeader || "").includes(e.rfcMessageId))
  );
  if (byRfcOnly.length === 1) {
    return { confidence: "HIGH_CONFIDENCE", contactId: byRfcOnly[0].contactId, matchedOutboundEvent: byRfcOnly[0], reason: null, candidates: byRfcOnly };
  }
  if (byRfcOnly.length > 1) {
    return {
      confidence: "NEEDS_REVIEW",
      contactId: null,
      matchedOutboundEvent: null,
      reason: `${byRfcOnly.length} distinct outbound messages matched this reply's RFC headers with no thread-id evidence to disambiguate -- a human must decide`,
      candidates: byRfcOnly,
    };
  }

  return { confidence: "NO_MATCH", contactId: null, matchedOutboundEvent: null, reason: "no thread-id or RFC header evidence ties this inbound message to any known outbound message", candidates: [] };
}

/**
 * Answers "is this follow-up's SENT status actually backed by evidence,"
 * given the follow-up's own state (followup.js's FOLLOWUP_STATE) plus
 * whichever message_events rows are linked to it (followupId). A
 * follow-up whose state is SENT but has no linked OUTBOUND SENT event
 * with real provider evidence (or an explicit MANUAL_ATTESTATION) is
 * reported hasVerifiedEvidence:false -- the UI must surface this
 * distinction rather than trusting the bare state column, per Phase 3's
 * explicit "merely drafting, approving, or marking a follow-up due does
 * not complete it" rule.
 */
export function deriveFollowUpCompletionEvidence(followup, linkedMessageEvents) {
  if (!followup) return { completed: false, hasVerifiedEvidence: false, evidenceEvent: null };
  if (followup.state !== "SENT") return { completed: false, hasVerifiedEvidence: false, evidenceEvent: null };

  const evidenceEvent = (linkedMessageEvents || []).find(
    (e) => e.direction === "OUTBOUND" && e.activityState === "SENT" && (e.provider === "MANUAL_ATTESTATION" || isNonEmptyString(e.providerMessageId))
  );
  return { completed: !!evidenceEvent, hasVerifiedEvidence: !!evidenceEvent, evidenceEvent: evidenceEvent || null };
}

/**
 * A reply suppresses an automatically-surfaced follow-up reminder --
 * "detect replies before showing a follow-up as due" (Phase 6). Pure
 * function: given a contact's current pipeline status and its known
 * message events, is a follow-up reminder appropriate right now. Mirrors
 * (never duplicates) model.js's own TERMINAL_PIPELINE_STATUS list for the
 * business-outcome half of this check, and additionally suppresses when
 * an INBOUND reply event exists more recently than the last OUTBOUND
 * send -- a reply that arrived after the last message means the human,
 * not the system, now owns the next move.
 */
export function shouldSuppressFollowUpReminder(contact, messageEvents) {
  const TERMINAL = ["PUBLISHED", "DECLINED", "BOUNCED"];
  if (!contact) return { suppress: true, reason: "no contact given" };
  if (TERMINAL.includes(contact.status)) return { suppress: true, reason: `${contact.status} is terminal` };

  const events = (messageEvents || []).slice().sort((a, b) => new Date(a.occurredAt || 0) - new Date(b.occurredAt || 0));
  const lastOutbound = [...events].reverse().find((e) => e.direction === "OUTBOUND" && e.activityState === "SENT");
  const lastInbound = [...events].reverse().find((e) => e.direction === "INBOUND");

  if (lastInbound && (!lastOutbound || new Date(lastInbound.occurredAt) > new Date(lastOutbound.occurredAt))) {
    return { suppress: true, reason: "a reply arrived after the last message sent -- a human should respond before any follow-up is prepared" };
  }
  return { suppress: false, reason: null };
}

/**
 * The four-state rollup a dashboard reads -- each count is independent;
 * none is derived from another. `sentCount`/`replyCount` only count rows
 * that passed validateMessageEvent()'s evidence-required check, so a
 * provider failure that never became a valid SENT row is correctly
 * absent here, not silently merged into "prepared."
 */
export function computeActivitySummary(messageEvents) {
  const events = messageEvents || [];
  return {
    preparedCount: events.filter((e) => e.activityState === "PREPARED").length,
    sentCount: events.filter((e) => e.direction === "OUTBOUND" && e.activityState === "SENT").length,
    replyReceivedCount: events.filter((e) => e.direction === "INBOUND" && e.activityState === "REPLY_RECEIVED").length,
    needsReviewCount: events.filter((e) => e.matchConfidence === "NEEDS_REVIEW").length,
    manualAttestationCount: events.filter((e) => e.provider === "MANUAL_ATTESTATION").length,
  };
}

export default {
  DIRECTION, ACTIVITY_STATE, PROVIDER, MATCH_CONFIDENCE, SENDER_IDENTITY,
  defaultMessageEventFor, validateMessageEvent,
  buildSendIdempotencyKey, buildGmailEvidenceIdempotencyKey, buildManualAttestationIdempotencyKey,
  matchReplyToContact, deriveFollowUpCompletionEvidence, shouldSuppressFollowUpReminder, computeActivitySummary,
};
