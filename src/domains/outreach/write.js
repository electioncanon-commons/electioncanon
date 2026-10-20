// ============================================================
// OUTREACH ACTIVATION — WRITES  (Launch Engine, Outreach Activation 1.0)
//
// Thin wrappers around the outreach-admin Edge Function. All
// authorization/validation logic lives there (and in
// supabase/functions/outreach-admin/contract.mjs), not here -- same
// division of responsibility as src/domains/launch/write.js.
//
// adminSecret IS NEVER PERSISTED BY THIS FILE. It is passed in by the
// caller (the control-room UI holds it in React state only, entered
// fresh each session -- see src/pages/outreach/OutreachControlRoom.jsx's
// own header) and forwarded as a bearer token on every call. Nothing
// here writes it to localStorage/sessionStorage/a cookie, and nothing
// here logs it.
//
// Every function returns a plain {ok, ..., error} shape and never throws
// for an expected failure -- same "channel independence" contract every
// other write module in this project follows.
// ============================================================

async function invokeFn(client, functionName, adminSecret, body) {
  if (!client) return { ok: false, error: "outreach admin actions are not available in this preview" };
  if (!adminSecret) return { ok: false, error: "an outreach admin secret is required" };
  try {
    const { data, error } = await client.functions.invoke(functionName, {
      body, headers: { Authorization: `Bearer ${adminSecret}` },
    });
    if (error) return { ok: false, error: error.message || "the request failed" };
    if (!data?.ok) return { ok: false, error: data?.reason || "the request failed" };
    return { ok: true, error: null, data };
  } catch (err) {
    return { ok: false, error: err?.message || "the request failed" };
  }
}

async function invoke(client, adminSecret, body) {
  return invokeFn(client, "outreach-admin", adminSecret, body);
}

/** Same OUTREACH_ADMIN_SECRET, the separate outreach-gmail Edge Function -- see that function's own header for why dispatch/reconciliation lives in a different function from the fetch-free admin CRUD surface. */
async function invokeGmail(client, adminSecret, body) {
  return invokeFn(client, "outreach-gmail", adminSecret, body);
}

export async function listOutreachContacts({ client, adminSecret, status = null, sector = null }) {
  const result = await invoke(client, adminSecret, { action: "list_contacts", status, sector });
  return result.ok ? { ok: true, error: null, contacts: result.data.contacts } : { ok: false, error: result.error, contacts: [] };
}

export async function listOutreachFollowUps({ client, adminSecret, contactId = null }) {
  const result = await invoke(client, adminSecret, { action: "list_followups", contactId });
  return result.ok ? { ok: true, error: null, followUps: result.data.followUps } : { ok: false, error: result.error, followUps: [] };
}

export async function createOutreachContact({ client, adminSecret, contact }) {
  const result = await invoke(client, adminSecret, { action: "create_contact", contact });
  return result.ok ? { ok: true, error: null, contact: result.data.contact } : { ok: false, error: result.error, contact: null };
}

export async function importOutreachContacts({ client, adminSecret, contacts }) {
  const result = await invoke(client, adminSecret, { action: "import_contacts", contacts });
  if (!result.ok) return { ok: false, error: result.error };
  const { submitted, imported, duplicate_existing, duplicate_in_batch, invalid, failed } = result.data;
  return { ok: true, error: null, submitted, imported, duplicateExisting: duplicate_existing, duplicateInBatch: duplicate_in_batch, invalid, failed };
}

/**
 * Submits a historical-import reconciliation plan built by
 * planHistoricalReconciliation() (src/domains/outreach/historicalImport.js).
 * Unlike importOutreachContacts(), this never discards a row whose email
 * already matches an existing contact -- see that function's own header
 * for the full "why".
 */
export async function reconcileHistoricalImport({ client, adminSecret, toCreate = [], toAttachExisting = [], toAttachNewBatch = [] }) {
  const result = await invoke(client, adminSecret, { action: "reconcile_historical_import", toCreate, toAttachExisting, toAttachNewBatch });
  if (!result.ok) return { ok: false, error: result.error };
  const { created, linked_existing, linked_new_batch, already_recorded, failed } = result.data;
  return { ok: true, error: null, created, linkedExisting: linked_existing, linkedNewBatch: linked_new_batch, alreadyRecorded: already_recorded, failed };
}

export async function updateOutreachContactStatus({ client, adminSecret, contactId, toStatus, note = null, fields = {} }) {
  const result = await invoke(client, adminSecret, { action: "update_contact_status", contactId, toStatus, note, ...fields });
  return result.ok ? { ok: true, error: null, contact: result.data.contact } : { ok: false, error: result.error, contact: null };
}

export async function createOutreachFollowUp({ client, adminSecret, contactId, assetCode, subject, body }) {
  const result = await invoke(client, adminSecret, { action: "create_followup", contactId, assetCode, subject, body });
  return result.ok ? { ok: true, error: null, followUp: result.data.followUp } : { ok: false, error: result.error, followUp: null };
}

export async function transitionOutreachFollowUp({ client, adminSecret, followUpId, toState, approvedBy = null }) {
  const result = await invoke(client, adminSecret, { action: "transition_followup", followUpId, toState, approvedBy });
  return result.ok ? { ok: true, error: null, followUp: result.data.followUp } : { ok: false, error: result.error, followUp: null };
}

/**
 * Records one message-activity event (Launch Engine closed-loop, Phase
 * 3) -- never sends anything itself, only records a fact that already
 * happened. Idempotent: a repeated call with the same `idempotencyKey`
 * returns { ok: true, alreadyRecorded: true, event: null } rather than
 * creating a second row or erroring.
 */
export async function recordOutreachMessageEvent({
  client, adminSecret, contactId, followupId = null, direction, activityState, provider,
  providerMessageId = null, providerThreadId = null, rfcMessageId = null, inReplyTo = null, referencesHeader = null,
  senderIdentity = "UNKNOWN", recipientEmail = null, subject = null, occurredAt = null, matchConfidence = "HIGH_CONFIDENCE",
  idempotencyKey,
}) {
  const result = await invoke(client, adminSecret, {
    action: "record_message_event", contactId, followupId, direction, activityState, provider,
    providerMessageId, providerThreadId, rfcMessageId, inReplyTo, referencesHeader,
    senderIdentity, recipientEmail, subject, occurredAt, matchConfidence, idempotencyKey,
  });
  if (!result.ok) return { ok: false, error: result.error, event: null, alreadyRecorded: false };
  return { ok: true, error: null, event: result.data.event, alreadyRecorded: !!result.data.alreadyRecorded };
}

export async function listOutreachMessageEvents({ client, adminSecret, contactId = null, followupId = null }) {
  const result = await invoke(client, adminSecret, { action: "list_message_events", contactId, followupId });
  return result.ok ? { ok: true, error: null, events: result.data.events } : { ok: false, error: result.error, events: [] };
}

// ---------- Gmail dispatch/reconciliation (outreach-gmail Edge Function) ----------

export async function getGmailConnectionStatus({ client, adminSecret }) {
  const result = await invokeGmail(client, adminSecret, { action: "get_connection_status" });
  return result.ok ? { ok: true, error: null, status: result.data } : { ok: false, error: result.error, status: null };
}

export async function getGmailAuthUrl({ client, adminSecret }) {
  const result = await invokeGmail(client, adminSecret, { action: "get_auth_url" });
  return result.ok ? { ok: true, error: null, authUrl: result.data.authUrl } : { ok: false, error: result.error, authUrl: null };
}

export async function verifyGmailSendAs({ client, adminSecret, identity = "admin@electioncanon.org" }) {
  const result = await invokeGmail(client, adminSecret, { action: "verify_send_as", identity });
  return result.ok
    ? { ok: true, error: null, found: result.data.found, verified: result.data.verified }
    : { ok: false, error: result.error, found: false, verified: false };
}

/**
 * Dispatches one real message through the authorized Gmail identity.
 * `confirmationId` MUST be stable across a retry of the SAME approved
 * send (e.g. generated once when the human clicks "Send" and reused if
 * the UI retries after a timeout) -- see outreach-gmail/contract.mjs's
 * own header for why. `approved` must be explicitly true; there is no
 * default.
 */
export async function sendOutreachGmailMessage({
  client, adminSecret, contactId, followupId = null, to, subject, html, text, confirmationId, approved,
  senderIdentity = "admin@electioncanon.org", inReplyTo = null, references = null,
}) {
  const result = await invokeGmail(client, adminSecret, {
    action: "send_message", contactId, followupId, to, subject, html, text, confirmationId, approved, senderIdentity, inReplyTo, references,
  });
  if (!result.ok) return { ok: false, error: result.error, alreadySent: false, event: null };
  return { ok: true, error: null, alreadySent: !!result.data.alreadySent, providerMessageId: result.data.providerMessageId ?? null, event: result.data.event ?? null };
}

export async function syncGmailReplies({ client, adminSecret, forceFullSync = false }) {
  const result = await invokeGmail(client, adminSecret, { action: "sync_replies", forceFullSync });
  return result.ok ? { ok: true, error: null, historyId: result.data.historyId } : { ok: false, error: result.error, historyId: null };
}
