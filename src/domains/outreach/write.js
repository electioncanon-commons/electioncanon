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

async function invoke(client, adminSecret, body) {
  if (!client) return { ok: false, error: "outreach admin actions are not available in this preview" };
  if (!adminSecret) return { ok: false, error: "an outreach admin secret is required" };
  try {
    const { data, error } = await client.functions.invoke("outreach-admin", {
      body, headers: { Authorization: `Bearer ${adminSecret}` },
    });
    if (error) return { ok: false, error: error.message || "the request failed" };
    if (!data?.ok) return { ok: false, error: data?.reason || "the request failed" };
    return { ok: true, error: null, data };
  } catch (err) {
    return { ok: false, error: err?.message || "the request failed" };
  }
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
