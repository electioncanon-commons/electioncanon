// ============================================================
// OUTREACH ACTIVATION — CORE MODEL  (institutional/media/organizational
// letter tracking, distinct from src/domains/launch/)
//
// WHAT THIS IS NOT. This is NOT the public /launch distribution system
// (src/domains/launch/, launch_subscribers, launch_analytics_events) --
// that system is an anonymous, consent-based, double-opt-in public email
// funnel (ad stops -> signup -> confirm -> drip sequence) with no named
// recipients and no response tracking. This module is the opposite
// shape: a small, named, admin-only list of real organizations and real
// contacts ElectionCanon has already emailed directly (institutional,
// media, civic-tech, development, and open-source outreach), tracking
// what was sent, what came back, and what to do next. The two systems
// share no table, no row, no function, and no route logic -- see
// test/election-outreach-launch-separation.consumer.mjs for the source
// scan proving this.
//
// WHAT THIS ALSO IS NOT. This is NOT src/domains/election/ Canon data --
// it carries no campaign_id, no tenant scope, no PREPARE/APPROVE/EXECUTE
// event-sourcing discipline. An outreach contact record is a mutable
// administrative record (like a Campaign Studio draft or a launch
// subscription) that a human edits directly, append-only history kept
// only for the status column (see STATUS_TRANSITIONS below) so the
// "who told us what, when" trail survives even though the row itself is
// mutable.
//
// HONESTY DISCIPLINE. Nothing in this module invents data. Every
// optional/unknown field defaults to an explicit UNKNOWN-shaped enum
// value or null -- never a guessed date, a guessed name, or a fabricated
// "responded" status. Importing historical letters (Phase 7) must carry
// forward exactly what is known and leave the rest at these same
// defaults; it must never backfill a plausible-looking sent_at or
// response_at that nobody actually recorded.
//
// CLOSED VOCABULARIES, VALIDATOR PAIRS. Same discipline as every other
// domain module in this repo (design/composition.js, design/language.js,
// os/studio/languageCapability.js): every enum is a frozen list with an
// explicit export, every governed value gets a synchronous, pure
// defaultXFor()/validateX() pair returning {valid, error} and never
// mutating its input, and an error names the specific offending field.
//
// DOM-free, Supabase-free: this file imports nothing from react, never
// touches document/window, and never holds a Supabase client -- enforced
// the same way test/election-web-adapter.consumer.mjs enforces it for
// src/domains/election/.
// ============================================================

export const SECTOR = Object.freeze([
  "media",
  "civic_tech",
  "democracy_election_org",
  "development_org",
  "open_source_dev",
  "institutional_partner",
  "other",
  // Political-office categories (Launch Engine closed-loop, Workspace B) --
  // mirrors 20261014000000_election_outreach_message_activity.sql's
  // expanded check constraint exactly. These are OFFICE-mediated
  // categories, not a claim that any individual recipient is
  // candidate-specific -- see OutreachControlRoom.jsx's own labelling.
  "presidential_campaign",
  "governorship_campaign",
  "senate_campaign",
  "house_of_reps_campaign",
  "state_assembly_campaign",
  "party_secretariat",
]);

export const SECTOR_LABEL = Object.freeze({
  media: "Media",
  civic_tech: "Civic technology",
  democracy_election_org: "Democracy / election organization",
  development_org: "Development organization",
  open_source_dev: "Open-source / developer community",
  institutional_partner: "Institutional partner",
  other: "Other",
  presidential_campaign: "Presidential campaign",
  governorship_campaign: "Governorship campaign",
  senate_campaign: "Senate campaign",
  house_of_reps_campaign: "House of Representatives campaign",
  state_assembly_campaign: "State House of Assembly campaign",
  party_secretariat: "Party secretariat (office-mediated)",
});

// The full outreach pipeline (Phase 3). DRAFT is the only status with no
// sent_at; every other status implies the letter was actually sent.
export const PIPELINE_STATUS = Object.freeze([
  "DRAFT",
  "SENT",
  "DELIVERED",
  "ENGAGED",
  "RESPONDED",
  "FOLLOW_UP_DUE",
  "CONVERSATION",
  "DEMO",
  "EDITORIAL_INTEREST",
  "PARTNERSHIP_INTEREST",
  "CONTRIBUTOR_INTEREST",
  "PUBLISHED",
  "DECLINED",
  "NO_RESPONSE",
  "BOUNCED",
]);

export const PIPELINE_STATUS_LABEL = Object.freeze({
  DRAFT: "Draft",
  SENT: "Sent",
  DELIVERED: "Delivered",
  ENGAGED: "Engaged",
  RESPONDED: "Responded",
  FOLLOW_UP_DUE: "Follow-up due",
  CONVERSATION: "Conversation",
  DEMO: "Demo",
  EDITORIAL_INTEREST: "Editorial interest",
  PARTNERSHIP_INTEREST: "Partnership interest",
  CONTRIBUTOR_INTEREST: "Contributor interest",
  PUBLISHED: "Published",
  DECLINED: "Declined",
  NO_RESPONSE: "No response",
  BOUNCED: "Bounced",
});

// Terminal statuses are never eligible for a scheduled follow-up and
// accept no outgoing transition at all -- a decline or a bounce is
// respected, not retried by the system itself. A human can still create
// a brand-new record (e.g. a corrected email address) rather than
// reopening this one.
export const TERMINAL_PIPELINE_STATUS = Object.freeze(["PUBLISHED", "DECLINED", "BOUNCED"]);

// "Allow transitions only where logically appropriate" (Phase 3). This is
// the single closed transition graph every status change is checked
// against -- see validateStatusTransition() below.
export const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["SENT"]),
  SENT: Object.freeze(["DELIVERED", "BOUNCED", "NO_RESPONSE"]),
  DELIVERED: Object.freeze(["ENGAGED", "NO_RESPONSE", "FOLLOW_UP_DUE"]),
  ENGAGED: Object.freeze(["RESPONDED", "FOLLOW_UP_DUE", "NO_RESPONSE"]),
  NO_RESPONSE: Object.freeze(["FOLLOW_UP_DUE", "DECLINED"]),
  FOLLOW_UP_DUE: Object.freeze(["SENT", "RESPONDED", "NO_RESPONSE", "DECLINED"]),
  RESPONDED: Object.freeze([
    "CONVERSATION", "DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST",
    "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE",
  ]),
  CONVERSATION: Object.freeze([
    "DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE",
  ]),
  DEMO: Object.freeze([
    "CONVERSATION", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "DECLINED", "FOLLOW_UP_DUE",
  ]),
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

// Where a record's facts came from -- never left ambiguous, since Phase 7
// import data and hand-typed entries carry different trust levels.
export const SOURCE_OF_TRUTH = Object.freeze(["MANUAL_IMPORT", "MANUAL_ENTRY", "INBOUND_REPLY"]);

// Which real mailbox a letter was actually sent from (Launch Engine manual
// recovery, Phase 10). Closed to the two accounts ElectionCanon outreach has
// ever been sent from -- "UNKNOWN" is the honest default when a historical
// row doesn't say, never a guess between the two.
export const SENDER_ACCOUNT = Object.freeze(["sotinnovate@gmail.com", "admin@electioncanon.org", "UNKNOWN"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SHORT = 200;
const MAX_LONG = 4000;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function boundedString(v, max) {
  return typeof v === "string" && v.length <= max;
}

/** Pure defaulting -- never invents sent_at/response_at/follow_up_due_at or any other unknown fact. */
export function defaultContactFor({
  organization, recipientEmail, sector, sourceOfTruth,
  recipientName = null, country = null, campaign = null, letterVersion = null, subject = null,
  senderAccount = "UNKNOWN", sourceRecordRef = null,
}) {
  return {
    organization,
    recipientName,
    recipientEmail,
    sector,
    country,
    campaign,
    letterVersion,
    subject,
    senderAccount,
    sourceRecordRef,
    sentAt: null,
    deliveryStatus: "UNKNOWN",
    engagementStatus: "UNKNOWN",
    status: "DRAFT",
    responseStatus: "UNKNOWN",
    responseAt: null,
    followUpDueAt: null,
    followUpCount: 0,
    lastContactAt: null,
    demoSent: false,
    githubSent: false,
    evidencePackageSent: false,
    conversationStatus: "NONE",
    nextAction: null,
    notes: null,
    sourceOfTruth,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Validates a full outreach contact record. Returns {valid, error} and
 * never mutates `contact`. Unknown-but-present fields (recipientName,
 * country, campaign, letterVersion, subject, nextAction, notes) are
 * optional and may be null -- only organization, recipientEmail, sector,
 * and sourceOfTruth are required, because those four are exactly what
 * "we sent a letter to this organization" means.
 */
export function validateContact(contact) {
  if (!contact || typeof contact !== "object") return { valid: false, error: "contact is required" };

  if (!isNonEmptyString(contact.organization) || !boundedString(contact.organization, MAX_SHORT)) {
    return { valid: false, error: "organization is required" };
  }
  if (!isNonEmptyString(contact.recipientEmail) || !EMAIL_RE.test(contact.recipientEmail.trim())) {
    return { valid: false, error: "recipientEmail must be a valid email address" };
  }
  if (!SECTOR.includes(contact.sector)) {
    return { valid: false, error: `sector must be one of: ${SECTOR.join(", ")}` };
  }
  if (!SOURCE_OF_TRUTH.includes(contact.sourceOfTruth)) {
    return { valid: false, error: `sourceOfTruth must be one of: ${SOURCE_OF_TRUTH.join(", ")}` };
  }
  if (contact.recipientName != null && !boundedString(contact.recipientName, MAX_SHORT)) {
    return { valid: false, error: "recipientName is too long" };
  }
  if (contact.country != null && !boundedString(contact.country, MAX_SHORT)) {
    return { valid: false, error: "country is too long" };
  }
  if (contact.campaign != null && !boundedString(contact.campaign, MAX_SHORT)) {
    return { valid: false, error: "campaign is too long" };
  }
  if (contact.letterVersion != null && !boundedString(contact.letterVersion, MAX_SHORT)) {
    return { valid: false, error: "letterVersion is too long" };
  }
  if (contact.subject != null && !boundedString(contact.subject, MAX_SHORT)) {
    return { valid: false, error: "subject is too long" };
  }
  if (contact.senderAccount !== undefined && !SENDER_ACCOUNT.includes(contact.senderAccount)) {
    return { valid: false, error: `senderAccount must be one of: ${SENDER_ACCOUNT.join(", ")}` };
  }
  if (contact.sourceRecordRef != null && !boundedString(contact.sourceRecordRef, MAX_SHORT)) {
    return { valid: false, error: "sourceRecordRef is too long" };
  }
  if (contact.status !== undefined && !PIPELINE_STATUS.includes(contact.status)) {
    return { valid: false, error: `status must be one of: ${PIPELINE_STATUS.join(", ")}` };
  }
  if (contact.deliveryStatus !== undefined && !DELIVERY_STATUS.includes(contact.deliveryStatus)) {
    return { valid: false, error: `deliveryStatus must be one of: ${DELIVERY_STATUS.join(", ")}` };
  }
  if (contact.engagementStatus !== undefined && !ENGAGEMENT_STATUS.includes(contact.engagementStatus)) {
    return { valid: false, error: `engagementStatus must be one of: ${ENGAGEMENT_STATUS.join(", ")}` };
  }
  if (contact.responseStatus !== undefined && !RESPONSE_STATUS.includes(contact.responseStatus)) {
    return { valid: false, error: `responseStatus must be one of: ${RESPONSE_STATUS.join(", ")}` };
  }
  if (contact.conversationStatus !== undefined && !CONVERSATION_STATUS.includes(contact.conversationStatus)) {
    return { valid: false, error: `conversationStatus must be one of: ${CONVERSATION_STATUS.join(", ")}` };
  }
  if (contact.nextAction != null && !boundedString(contact.nextAction, MAX_LONG)) {
    return { valid: false, error: "nextAction is too long" };
  }
  if (contact.notes != null && !boundedString(contact.notes, MAX_LONG)) {
    return { valid: false, error: "notes is too long" };
  }
  if (contact.followUpCount !== undefined && (!Number.isInteger(contact.followUpCount) || contact.followUpCount < 0)) {
    return { valid: false, error: "followUpCount must be a non-negative integer" };
  }

  return { valid: true, error: null };
}

/**
 * The single transition gate every status change in this subsystem must
 * pass through -- UI, edge function, and import all call this same
 * function rather than re-deriving the graph. A same-status "change" is
 * accepted as a no-op (recording a note without moving the pipeline
 * forward is a normal action, not an error).
 */
export function validateStatusTransition(fromStatus, toStatus) {
  if (!PIPELINE_STATUS.includes(fromStatus)) return { valid: false, error: `unknown current status: ${fromStatus}` };
  if (!PIPELINE_STATUS.includes(toStatus)) return { valid: false, error: `unknown target status: ${toStatus}` };
  if (fromStatus === toStatus) return { valid: true, error: null };
  const allowed = STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return { valid: false, error: `cannot move from ${fromStatus} to ${toStatus} -- allowed: ${allowed.length ? allowed.join(", ") : "(none, terminal)"}` };
  }
  return { valid: true, error: null };
}

/**
 * Phase 3/4/8 "who needs follow-up" -- a pure function over one contact
 * record and the current time, never a hidden clock, never a side
 * effect. A contact is eligible only when its status is non-terminal AND
 * a follow_up_due_at has actually been set AND that moment has passed.
 * A null follow_up_due_at is NOT eligible -- nobody scheduled one yet,
 * and this module never invents a due date on a record's behalf.
 */
export function computeFollowUpEligibility(contact, now = new Date()) {
  if (!contact || typeof contact !== "object") return { eligible: false, reason: "no contact given" };
  if (TERMINAL_PIPELINE_STATUS.includes(contact.status)) {
    return { eligible: false, reason: `${contact.status} is terminal -- no follow-up is scheduled by the system` };
  }
  if (!contact.followUpDueAt) return { eligible: false, reason: "no follow_up_due_at has been set" };
  const due = new Date(contact.followUpDueAt);
  if (Number.isNaN(due.getTime())) return { eligible: false, reason: "follow_up_due_at is not a valid date" };
  if (due.getTime() > now.getTime()) return { eligible: false, reason: "follow_up_due_at has not arrived yet" };
  return { eligible: true, reason: null };
}

export default {
  SECTOR, SECTOR_LABEL, PIPELINE_STATUS, PIPELINE_STATUS_LABEL, TERMINAL_PIPELINE_STATUS, STATUS_TRANSITIONS,
  DELIVERY_STATUS, ENGAGEMENT_STATUS, RESPONSE_STATUS, CONVERSATION_STATUS, SOURCE_OF_TRUTH, SENDER_ACCOUNT,
  defaultContactFor, validateContact, validateStatusTransition, computeFollowUpEligibility,
};
