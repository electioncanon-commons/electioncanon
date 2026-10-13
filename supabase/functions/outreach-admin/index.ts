// ============================================================
// OUTREACH ACTIVATION — ADMIN TRANSPORT BOUNDARY  (Launch Engine,
// Outreach Activation 1.0)
//
// OWNER-TRIGGERED ONLY. Requires an OUTREACH_ADMIN_SECRET bearer token,
// checked BEFORE the request body is even read -- same gate shape as
// launch-invite-audience/index.ts and launch-send-campaign-email/
// index.ts. No anon/authenticated grant exists, nothing in the browser
// bundle can call this without the secret, and the secret itself is
// never persisted anywhere by this function (the control-room UI holds
// it in memory only -- see src/domains/outreach/write.js's own header).
//
// NO EMAIL PROVIDER ANYWHERE IN THIS FILE. There is no fetch() call, no
// Brevo/Resend import, nothing that could dispatch a message to a real
// recipient. "transition_followup" moving a row to state: "SENT" records
// a human's attestation that they personally sent the message through
// their own mail client -- it never sends anything itself. This is the
// literal enforcement of "Do not send emails" / "No mass automatic
// sending" from the outreach brief, not just a comment -- see
// test/election-outreach-admin-function.consumer.mjs's source scan.
//
// SERVICE ROLE, SAME REASONING AS THE OTHER ADMIN FUNCTIONS: the caller
// here is the project owner via a shared secret, not a Supabase Auth
// session, and outreach_contacts/outreach_status_changes/
// outreach_followups carry no client policy at all by design (see the
// migration's own header) -- reading and writing requires the service
// role.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  validateContactPayload, validateListContactsRequest, validateImportRequest, validateStatusTransition,
  validateUpdateStatusRequest, validateCreateFollowUpRequest, validateFollowUpTransition, validateTransitionFollowUpRequest,
  validateHistoricalReconcileRequest, hasHistoricalEvent,
} from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (reason: string, code: string, status = 200) => json({ ok: false, code, reason }, status);

function contactToRow(c: Record<string, unknown>) {
  return {
    organization: c.organization,
    recipient_name: c.recipientName ?? null,
    recipient_email: String(c.recipientEmail).trim().toLowerCase(),
    sector: c.sector,
    country: c.country ?? null,
    campaign: c.campaign ?? null,
    letter_version: c.letterVersion ?? null,
    subject: c.subject ?? null,
    sender_account: c.senderAccount ?? "UNKNOWN",
    source_record_ref: c.sourceRecordRef ?? null,
    sent_at: c.sentAt ?? null,
    delivery_status: c.deliveryStatus ?? "UNKNOWN",
    engagement_status: c.engagementStatus ?? "UNKNOWN",
    status: c.status ?? "DRAFT",
    response_status: c.responseStatus ?? "UNKNOWN",
    response_at: c.responseAt ?? null,
    follow_up_due_at: c.followUpDueAt ?? null,
    next_action: c.nextAction ?? null,
    notes: c.notes ?? null,
    source_of_truth: c.sourceOfTruth,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return refuse("only POST is accepted", "METHOD_NOT_ALLOWED", 405);

  const adminSecret = Deno.env.get("OUTREACH_ADMIN_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return refuse("this action requires the outreach admin secret", "UNAUTHENTICATED", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const action = typeof body?.action === "string" ? body.action : "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return refuse("supabase is not configured", "PROVIDER_NOT_CONFIGURED", 200);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (action === "list_contacts") {
    const validation = validateListContactsRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);
    let query = supabase.from("outreach_contacts").select("*").order("created_at", { ascending: false });
    if (validation.status) query = query.eq("status", validation.status);
    if (validation.sector) query = query.eq("sector", validation.sector);
    const { data, error } = await query;
    if (error) return refuse("could not read outreach_contacts", "PROVIDER_ERROR", 200);
    return json({ ok: true, contacts: data ?? [] });
  }

  if (action === "list_followups") {
    const contactId = typeof body.contactId === "string" ? body.contactId : null;
    let query = supabase.from("outreach_followups").select("*").order("created_at", { ascending: false });
    if (contactId) query = query.eq("contact_id", contactId);
    const { data, error } = await query;
    if (error) return refuse("could not read outreach_followups", "PROVIDER_ERROR", 200);
    return json({ ok: true, followUps: data ?? [] });
  }

  if (action === "create_contact") {
    const payload = (body.contact ?? {}) as Record<string, unknown>;
    const validation = validateContactPayload(payload);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);
    const { data: existing } = await supabase
      .from("outreach_contacts").select("id").eq("recipient_email", String(payload.recipientEmail).trim().toLowerCase()).maybeSingle();
    if (existing) return refuse("a contact with this email already exists", "DUPLICATE", 200);
    const { data, error } = await supabase.from("outreach_contacts").insert(contactToRow(payload)).select("*").single();
    if (error) return refuse("could not create contact", "PROVIDER_ERROR", 200);
    return json({ ok: true, contact: data });
  }

  if (action === "import_contacts") {
    const validation = validateImportRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    let imported = 0, duplicateExisting = 0, duplicateInBatch = 0, invalid = 0, failed = 0;
    const seenThisRequest = new Set<string>();

    for (const raw of validation.contacts) {
      const payloadValidation = validateContactPayload(raw);
      if (!payloadValidation.valid) { invalid++; continue; }
      const email = String((raw as Record<string, unknown>).recipientEmail).trim().toLowerCase();
      if (seenThisRequest.has(email)) { duplicateInBatch++; continue; }
      seenThisRequest.add(email);

      const { data: existing, error: readError } = await supabase
        .from("outreach_contacts").select("id").eq("recipient_email", email).maybeSingle();
      if (readError) { failed++; continue; }
      if (existing) { duplicateExisting++; continue; }

      const { error: insertError } = await supabase.from("outreach_contacts").insert(contactToRow(raw as Record<string, unknown>));
      if (insertError) { failed++; continue; }
      imported++;
    }

    return json({ ok: true, submitted: validation.contacts.length, imported, duplicate_existing: duplicateExisting, duplicate_in_batch: duplicateInBatch, invalid, failed });
  }

  if (action === "reconcile_historical_import") {
    // THE FIX for the Phase 7 historical-import gap: a historical message
    // whose recipient already has a contact record (client-classified as
    // "duplicate_existing" by detectDuplicates()) is no longer silently
    // discarded. It becomes an append-only outreach_status_changes row
    // against the SAME contact -- never a second contact row for the same
    // email (the unique index on lower(recipient_email) would reject that
    // anyway), and never a change to a contact that has already moved past
    // DRAFT in its real pipeline. See src/domains/outreach/
    // historicalImport.js's own header for the full design and
    // supabase/functions/outreach-admin/contract.mjs's
    // validateHistoricalReconcileRequest() for the request shape.
    //
    // SERVER-SIDE RE-VALIDATION, NOT TRUST IN THE CLIENT'S PLAN. The client
    // builds its plan from a Preview-time snapshot of outreach_contacts and
    // outreach_status_changes, which can be stale by the time this request
    // arrives (another import running concurrently, a human editing the
    // contact in the meantime). Every contact this handles is re-read
    // fresh immediately before any write, every idempotency check is
    // re-run against freshly-read notes, and a contact that has moved past
    // DRAFT since the client's snapshot is NEVER patched, even if the
    // client proposed a patch -- only the historical event itself (a
    // same-status no-op entry) is still recorded, because the message was
    // still genuinely sent.
    const validation = validateHistoricalReconcileRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    let created = 0, linkedExisting = 0, linkedNewBatch = 0, alreadyRecorded = 0, failed = 0;
    const createdIdByEmail = new Map<string, string>();

    // ---- phase 1: toCreate (brand-new contacts; at most one per groupEmail) ----
    for (const row of validation.toCreate) {
      const email = String(row.contact.recipientEmail).trim().toLowerCase();
      const { data: existing, error: readError } = await supabase
        .from("outreach_contacts").select("id").eq("recipient_email", email).maybeSingle();
      if (readError) { failed++; continue; }
      if (existing) {
        // Someone else created this contact between preview and submit -- fall through to the
        // existing-contact path for this one row rather than failing the whole request.
        createdIdByEmail.set(String(row.groupEmail).trim().toLowerCase(), existing.id);
        const { data: notesRows } = await supabase.from("outreach_status_changes").select("note").eq("contact_id", existing.id);
        const existingNotes = (notesRows ?? []).map((r: { note: string | null }) => r.note).filter((n: string | null): n is string => !!n);
        if (row.historicalEvent && !hasHistoricalEvent(existingNotes, row.historicalEvent.sourceRecordRef)) {
          await supabase.from("outreach_status_changes").insert({
            contact_id: existing.id, from_status: row.historicalEvent.fromStatus, to_status: row.historicalEvent.toStatus,
            changed_at: row.historicalEvent.changedAt ?? new Date().toISOString(), note: row.historicalEvent.note,
          });
          linkedExisting++;
        } else if (row.historicalEvent) {
          alreadyRecorded++;
        }
        continue;
      }

      const { data: insertedContact, error: insertError } = await supabase
        .from("outreach_contacts").insert(contactToRow(row.contact)).select("id").single();
      if (insertError || !insertedContact) { failed++; continue; }
      created++;
      createdIdByEmail.set(String(row.groupEmail).trim().toLowerCase(), insertedContact.id);

      if (row.historicalEvent) {
        await supabase.from("outreach_status_changes").insert({
          contact_id: insertedContact.id, from_status: row.historicalEvent.fromStatus, to_status: row.historicalEvent.toStatus,
          changed_at: row.historicalEvent.changedAt ?? new Date().toISOString(), note: row.historicalEvent.note,
        });
      }
    }

    // ---- phase 2: toAttachExisting (contacts that already existed before this request) ----
    for (const row of validation.toAttachExisting) {
      const { data: contact, error: readError } = await supabase
        .from("outreach_contacts").select("id, status, sent_at").eq("id", row.existingContactId).maybeSingle();
      if (readError || !contact) { failed++; continue; }

      const { data: notesRows } = await supabase.from("outreach_status_changes").select("note").eq("contact_id", contact.id);
      const existingNotes = (notesRows ?? []).map((r: { note: string | null }) => r.note).filter((n: string | null): n is string => !!n);
      if (hasHistoricalEvent(existingNotes, row.historicalEvent.sourceRecordRef)) { alreadyRecorded++; continue; }

      // Re-derive from/to against the FRESH server-side status -- never trust the client's
      // (possibly stale) fromStatus, and never apply a patch to a contact no longer DRAFT.
      const stillUnsent = contact.status === "DRAFT" && !contact.sent_at;
      const applyPatch = stillUnsent && row.contactPatch;
      const toStatus = applyPatch ? "SENT" : contact.status;

      if (applyPatch) {
        const transitionCheck = validateStatusTransition(contact.status, toStatus);
        if (!transitionCheck.valid) { failed++; continue; }
        const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (row.contactPatch.status !== undefined) updateFields.status = row.contactPatch.status;
        if (row.contactPatch.sentAt !== undefined) updateFields.sent_at = row.contactPatch.sentAt;
        if (row.contactPatch.deliveryStatus !== undefined) updateFields.delivery_status = row.contactPatch.deliveryStatus;
        if (row.contactPatch.senderAccount !== undefined) updateFields.sender_account = row.contactPatch.senderAccount;
        if (row.contactPatch.sourceRecordRef !== undefined) updateFields.source_record_ref = row.contactPatch.sourceRecordRef;
        if (row.contactPatch.subject !== undefined) updateFields.subject = row.contactPatch.subject;
        if (row.contactPatch.campaign !== undefined) updateFields.campaign = row.contactPatch.campaign;
        if (row.contactPatch.letterVersion !== undefined) updateFields.letter_version = row.contactPatch.letterVersion;
        if (row.contactPatch.country !== undefined) updateFields.country = row.contactPatch.country;
        const { error: updateError } = await supabase.from("outreach_contacts").update(updateFields).eq("id", contact.id);
        if (updateError) { failed++; continue; }
      }

      await supabase.from("outreach_status_changes").insert({
        contact_id: contact.id, from_status: contact.status, to_status: toStatus,
        changed_at: row.historicalEvent.changedAt ?? new Date().toISOString(), note: row.historicalEvent.note,
      });
      linkedExisting++;
    }

    // ---- phase 3: toAttachNewBatch (second+ historical message to an email created in phase 1) ----
    for (const row of validation.toAttachNewBatch) {
      const email = String(row.groupEmail).trim().toLowerCase();
      let contactId = createdIdByEmail.get(email);
      if (!contactId) {
        const { data: existing } = await supabase.from("outreach_contacts").select("id").eq("recipient_email", email).maybeSingle();
        if (!existing) { failed++; continue; }
        contactId = existing.id;
      }
      const { data: notesRows } = await supabase.from("outreach_status_changes").select("note").eq("contact_id", contactId);
      const existingNotes = (notesRows ?? []).map((r: { note: string | null }) => r.note).filter((n: string | null): n is string => !!n);
      if (hasHistoricalEvent(existingNotes, row.historicalEvent.sourceRecordRef)) { alreadyRecorded++; continue; }

      const { data: contact } = await supabase.from("outreach_contacts").select("status").eq("id", contactId).maybeSingle();
      const currentStatus = contact?.status ?? row.historicalEvent.fromStatus;
      await supabase.from("outreach_status_changes").insert({
        contact_id: contactId, from_status: currentStatus, to_status: currentStatus,
        changed_at: row.historicalEvent.changedAt ?? new Date().toISOString(), note: row.historicalEvent.note,
      });
      linkedNewBatch++;
    }

    return json({
      ok: true,
      created, linked_existing: linkedExisting, linked_new_batch: linkedNewBatch,
      already_recorded: alreadyRecorded, failed,
    });
  }

  if (action === "update_contact_status") {
    const validation = validateUpdateStatusRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    const { data: contact, error: readError } = await supabase
      .from("outreach_contacts").select("id, status, follow_up_count").eq("id", validation.contactId).maybeSingle();
    if (readError || !contact) return refuse("contact not found", "NOT_FOUND", 404);

    const transitionCheck = validateStatusTransition(contact.status, validation.toStatus);
    if (!transitionCheck.valid) return refuse(transitionCheck.error, "INVALID_TRANSITION", 200);

    const updateFields: Record<string, unknown> = {
      status: validation.toStatus,
      updated_at: new Date().toISOString(),
      last_contact_at: new Date().toISOString(),
    };
    if (validation.fields.responseStatus !== undefined) {
      updateFields.response_status = validation.fields.responseStatus;
      if (validation.fields.responseStatus === "RESPONDED") updateFields.response_at = new Date().toISOString();
    }
    if (validation.fields.deliveryStatus !== undefined) updateFields.delivery_status = validation.fields.deliveryStatus;
    if (validation.fields.engagementStatus !== undefined) updateFields.engagement_status = validation.fields.engagementStatus;
    if (validation.fields.conversationStatus !== undefined) updateFields.conversation_status = validation.fields.conversationStatus;
    if (validation.fields.followUpDueAt !== undefined) updateFields.follow_up_due_at = validation.fields.followUpDueAt;
    if (validation.fields.nextAction !== undefined) updateFields.next_action = validation.fields.nextAction;
    if (validation.fields.demoSent !== undefined) updateFields.demo_sent = validation.fields.demoSent;
    if (validation.fields.githubSent !== undefined) updateFields.github_sent = validation.fields.githubSent;
    if (validation.fields.evidencePackageSent !== undefined) updateFields.evidence_package_sent = validation.fields.evidencePackageSent;
    if (contact.status === "FOLLOW_UP_DUE" && validation.toStatus === "SENT") {
      updateFields.follow_up_count = (contact.follow_up_count ?? 0) + 1;
    }

    const { data: updated, error: updateError } = await supabase
      .from("outreach_contacts").update(updateFields).eq("id", validation.contactId).select("*").single();
    if (updateError) return refuse("could not update contact", "PROVIDER_ERROR", 200);

    await supabase.from("outreach_status_changes").insert({
      contact_id: validation.contactId, from_status: contact.status, to_status: validation.toStatus, note: validation.note,
    });

    return json({ ok: true, contact: updated });
  }

  if (action === "create_followup") {
    const validation = validateCreateFollowUpRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);
    const { data: contact } = await supabase.from("outreach_contacts").select("id").eq("id", validation.contactId).maybeSingle();
    if (!contact) return refuse("contact not found", "NOT_FOUND", 404);
    const { data, error } = await supabase.from("outreach_followups").insert({
      contact_id: validation.contactId, asset_code: validation.assetCode, subject: validation.subject, body: validation.body, state: "DRAFT",
    }).select("*").single();
    if (error) return refuse("could not create follow-up", "PROVIDER_ERROR", 200);
    return json({ ok: true, followUp: data });
  }

  if (action === "transition_followup") {
    const validation = validateTransitionFollowUpRequest(body);
    if (!validation.valid) return refuse(validation.error, "BAD_REQUEST", 400);

    const { data: followUp, error: readError } = await supabase
      .from("outreach_followups").select("*").eq("id", validation.followUpId).maybeSingle();
    if (readError || !followUp) return refuse("follow-up not found", "NOT_FOUND", 404);

    const transitionCheck = validateFollowUpTransition(followUp.state, validation.toState);
    if (!transitionCheck.valid) return refuse(transitionCheck.error, "INVALID_TRANSITION", 200);

    const now = new Date().toISOString();
    const updateFields: Record<string, unknown> = { state: validation.toState };
    if (validation.toState === "REVIEW") updateFields.reviewed_at = now;
    if (validation.toState === "APPROVED") { updateFields.approved_at = now; updateFields.approved_by = validation.approvedBy; }
    if (validation.toState === "SENT") updateFields.sent_at = now;
    if (validation.toState === "CANCELLED") updateFields.cancelled_at = now;

    const { data: updated, error: updateError } = await supabase
      .from("outreach_followups").update(updateFields).eq("id", validation.followUpId).select("*").single();
    if (updateError) return refuse("could not update follow-up", "PROVIDER_ERROR", 200);

    if (validation.toState === "SENT") {
      const { data: contact } = await supabase.from("outreach_contacts").select("follow_up_count").eq("id", followUp.contact_id).maybeSingle();
      await supabase.from("outreach_contacts").update({
        follow_up_count: (contact?.follow_up_count ?? 0) + 1,
        last_contact_at: now,
      }).eq("id", followUp.contact_id);
    }

    return json({ ok: true, followUp: updated });
  }

  return refuse(`unknown action: ${action}`, "BAD_REQUEST", 400);
});
