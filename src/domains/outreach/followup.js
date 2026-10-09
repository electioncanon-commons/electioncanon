// ============================================================
// OUTREACH ACTIVATION — FOLLOW-UP WORKFLOW  (Phase 8)
//
// DRAFT -> REVIEW -> APPROVED -> SENT, with CANCELLED reachable from any
// non-terminal state. "SEND" is a human attestation, never a dispatch:
// transitioning a follow-up to SENT only records that a person sent the
// message themselves (through their own email client) and marks
// sent_at/sent_by -- this file contains no fetch, no client.functions.
// invoke, no email-provider call of any kind. See
// test/election-outreach-followup.consumer.mjs's source scan (section D)
// for the enforcement of that property.
//
// "No mass automatic sending" is therefore true by construction: there
// is no code path anywhere in this subsystem that can reach SENT without
// a human calling transitionFollowUp(..., "SENT") one record at a time,
// and no scheduler/cron in this repository calls that function at all.
// ============================================================

export const FOLLOWUP_STATE = Object.freeze(["DRAFT", "REVIEW", "APPROVED", "SENT", "CANCELLED"]);

export const FOLLOWUP_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["REVIEW", "CANCELLED"]),
  REVIEW: Object.freeze(["DRAFT", "APPROVED", "CANCELLED"]),
  APPROVED: Object.freeze(["SENT", "DRAFT", "CANCELLED"]),
  SENT: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

/** Pure defaulting for a new follow-up draft -- never pre-fills approvedAt/sentAt. */
export function defaultFollowUpFor({ contactId, assetCode, body, subject }) {
  return {
    contactId,
    assetCode,
    subject,
    body,
    state: "DRAFT",
    createdAt: null,
    reviewedAt: null,
    approvedAt: null,
    approvedBy: null,
    sentAt: null,
    cancelledAt: null,
  };
}

export function validateFollowUp(followUp) {
  if (!followUp || typeof followUp !== "object") return { valid: false, error: "followUp is required" };
  if (typeof followUp.contactId !== "string" || !followUp.contactId.trim()) {
    return { valid: false, error: "contactId is required" };
  }
  if (typeof followUp.subject !== "string" || !followUp.subject.trim()) {
    return { valid: false, error: "subject is required" };
  }
  if (typeof followUp.body !== "string" || !followUp.body.trim()) {
    return { valid: false, error: "body is required" };
  }
  if (followUp.state !== undefined && !FOLLOWUP_STATE.includes(followUp.state)) {
    return { valid: false, error: `state must be one of: ${FOLLOWUP_STATE.join(", ")}` };
  }
  return { valid: true, error: null };
}

/** The single transition gate for the DRAFT -> REVIEW -> APPROVED -> SEND discipline Phase 8 requires. */
export function validateFollowUpTransition(fromState, toState) {
  if (!FOLLOWUP_STATE.includes(fromState)) return { valid: false, error: `unknown current state: ${fromState}` };
  if (!FOLLOWUP_STATE.includes(toState)) return { valid: false, error: `unknown target state: ${toState}` };
  if (fromState === toState) return { valid: true, error: null };
  const allowed = FOLLOWUP_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    return { valid: false, error: `cannot move from ${fromState} to ${toState} -- allowed: ${allowed.length ? allowed.join(", ") : "(none, terminal)"}` };
  }
  return { valid: true, error: null };
}

export default { FOLLOWUP_STATE, FOLLOWUP_TRANSITIONS, defaultFollowUpFor, validateFollowUp, validateFollowUpTransition };
