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
