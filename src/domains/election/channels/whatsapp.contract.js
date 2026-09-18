// ============================================================
// ELECTIONCANON — WHATSAPP CHANNEL CONTRACT (STUB, NOT WIRED)
//
// This file is NOT imported anywhere in the app. It exists only to make
// the shape of a future WhatsApp channel adapter concrete in code, next
// to the prose contract in docs/WHATSAPP.md (read that
// file first — this stub follows it function-for-function).
//
// No WhatsApp Business API credentials exist in this codebase. No
// message has ever been sent or received through WhatsApp by
// ElectionCanon. Every function below is an unimplemented shape, not a
// working adapter — each throws if actually called, so an accidental
// import cannot silently pretend to be a real channel.
//
// The point of this file: when real WhatsApp integration work happens,
// it should be "implement these functions against real credentials,"
// not "invent the contract from scratch." Every function here forwards
// to the SAME channel-agnostic domain functions the web UI already
// calls (src/os/electionWebAdapter.js, src/domains/election/*/write.js,
// src/domains/election/electionDay/evidence.js) — a WhatsApp adapter
// must never re-implement election business logic, RLS, or the
// PREPARE -> APPROVE discipline of its own.
// ============================================================

function notImplemented(name) {
  throw new Error(`election channel-adapter contract: ${name} is a documented shape, not an implemented channel — see this file's own header comment for the channel contract doc`);
}

/**
 * Resolve an inbound WhatsApp sender's phone number to an already-
 * registered campaign member. Never auto-creates an actor — identity is
 * established through the existing Access.jsx registration flow, exactly
 * as on the web channel. Returns { userId, campaignId } or a not-found
 * outcome; never invents an actor from a webhook payload alone.
 */
export async function resolveSenderToActor({ client, fromPhoneNumber } = {}) {
  notImplemented("resolveSenderToActor");
}

/**
 * Handle one inbound WhatsApp message (text or media). Translates the
 * webhook payload into the SAME { client, message } / { client, fields }
 * shape prepareElectionWrite / prepareMobilizationWrite /
 * prepareElectionDayWrite already accept — this function is a transport
 * translator, not a second business-logic path. Returns a PREPARE-shaped
 * result to be sent back as a WhatsApp reply; never performs the write.
 */
export async function handleInboundMessage({ client, fromPhoneNumber, campaignId, text, mediaUrl } = {}) {
  notImplemented("handleInboundMessage");
}

/**
 * Handle an explicit affirmative reply confirming a previously-PREPAREd
 * action. Requires the SAME confirmationId issued at prepare time — a
 * channel adapter must never collapse PREPARE+APPROVE into a single
 * inbound message, matching every other write path's idempotency
 * discipline (see write-discipline section of ARCHITECTURE.md).
 */
export async function handleApprovalReply({ client, fromPhoneNumber, campaignId, confirmationId } = {}) {
  notImplemented("handleApprovalReply");
}

/**
 * Push a read-only Canon fact (a verified result, a new incident, an
 * assignment change) out as an outbound WhatsApp notification. Always a
 * read of the same projectElection() fold every other surface reads —
 * never a second source of truth, never a write.
 */
export async function sendOutboundNotification({ client, campaignId, toPhoneNumber, fact } = {}) {
  notImplemented("sendOutboundNotification");
}

/**
 * Upload a WhatsApp media attachment (e.g. a result-sheet photo) using
 * the SAME uploadResultEvidence() helper the web UI's CaptureResultPanel
 * calls — same bucket, same RLS, same upload-state honesty. An upload
 * failure must be reported back to the sender, never silently dropped.
 */
export async function uploadInboundMedia({ client, campaignId, resultId, mediaUrl } = {}) {
  notImplemented("uploadInboundMedia");
}

export default {
  resolveSenderToActor,
  handleInboundMessage,
  handleApprovalReply,
  sendOutboundNotification,
  uploadInboundMedia,
};
