// ============================================================
// OUTREACH ACTIVATION — ADMIN EDGE FUNCTION TESTS
// Covers: supabase/functions/outreach-admin/contract.mjs (validators),
// and a source scan of index.ts proving the admin gate, dispatch shape,
// and absence of any email-sending capability.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTOR, PIPELINE_STATUS, ASSET_CODE, FOLLOWUP_STATE, MAX_IMPORT_BATCH, MAX_HISTORICAL_BATCH, HISTORICAL_EVENT_PREFIX,
  validateContactPayload, validateListContactsRequest, validateImportRequest, validateStatusTransition,
  validateUpdateStatusRequest, validateCreateFollowUpRequest, validateFollowUpTransition, validateTransitionFollowUpRequest,
  validateHistoricalReconcileRequest, hasHistoricalEvent,
  validateRecordMessageEventRequest, validateListMessageEventsRequest,
} from "../supabase/functions/outreach-admin/contract.mjs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const indexTs = readSrc("supabase/functions/outreach-admin/index.ts");
const indexCode = stripComments(indexTs);

console.log("\nOUTREACH ACTIVATION — admin edge function\n");

console.log("A — validateContactPayload()");
{
  const base = { organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY" };
  ok("1. a valid payload passes", validateContactPayload(base).valid === true);
  ok("2. missing organization is rejected", validateContactPayload({ ...base, organization: "" }).valid === false);
  ok("3. a malformed email is rejected", validateContactPayload({ ...base, recipientEmail: "nope" }).valid === false);
  ok("4. an out-of-vocabulary sector is rejected", validateContactPayload({ ...base, sector: "bogus" }).valid === false);
  ok("5. an out-of-vocabulary sourceOfTruth is rejected", validateContactPayload({ ...base, sourceOfTruth: "bogus" }).valid === false);
  ok("6. an out-of-vocabulary senderAccount is rejected", validateContactPayload({ ...base, senderAccount: "someone@example.com" }).valid === false);
  ok("7. a real senderAccount is accepted", validateContactPayload({ ...base, senderAccount: "sotinnovate@gmail.com" }).valid === true);
  ok("8. an overlong sourceRecordRef is rejected", validateContactPayload({ ...base, sourceRecordRef: "x".repeat(201) }).valid === false);
}

console.log("\nB — validateListContactsRequest() / validateImportRequest()");
{
  ok("1. no filters is valid (lists everything)", validateListContactsRequest({}).valid === true);
  ok("2. a bogus status filter is rejected", validateListContactsRequest({ status: "BOGUS" }).valid === false);
  ok("3. import requires a non-empty array", validateImportRequest({ contacts: [] }).valid === false);
  ok("4. import rejects more than MAX_IMPORT_BATCH", validateImportRequest({ contacts: Array.from({ length: MAX_IMPORT_BATCH + 1 }, () => ({})) }).valid === false);
  ok("5. MAX_IMPORT_BATCH is exactly 500", MAX_IMPORT_BATCH === 500);
}

console.log("\nC — validateStatusTransition() / validateUpdateStatusRequest()");
{
  ok("1. DRAFT -> SENT allowed", validateStatusTransition("DRAFT", "SENT").valid === true);
  ok("2. DRAFT -> PUBLISHED refused", validateStatusTransition("DRAFT", "PUBLISHED").valid === false);
  ok("3. a missing contactId is rejected", validateUpdateStatusRequest({ toStatus: "SENT" }).valid === false);
  ok("4. an out-of-vocabulary toStatus is rejected", validateUpdateStatusRequest({ contactId: "c1", toStatus: "BOGUS" }).valid === false);
  ok("5. an out-of-vocabulary responseStatus field is rejected", validateUpdateStatusRequest({ contactId: "c1", toStatus: "SENT", responseStatus: "BOGUS" }).valid === false);
  ok("6. a valid responseStatus is carried through in .fields", validateUpdateStatusRequest({ contactId: "c1", toStatus: "RESPONDED", responseStatus: "RESPONDED" }).fields.responseStatus === "RESPONDED");
}

console.log("\nD — follow-up request validators");
{
  ok("1. create_followup requires a known assetCode", validateCreateFollowUpRequest({ contactId: "c1", assetCode: "BOGUS", subject: "s", body: "b" }).valid === false);
  ok("2. create_followup accepts every real ASSET_CODE", ASSET_CODE.every((code) => validateCreateFollowUpRequest({ contactId: "c1", assetCode: code, subject: "s", body: "b" }).valid));
  ok("3. DRAFT -> SENT is refused at the transition-validator level too (defense in depth)", validateFollowUpTransition("DRAFT", "SENT").valid === false);
  ok("4. transition request requires a followUpId", validateTransitionFollowUpRequest({ toState: "REVIEW" }).valid === false);
  ok("5. transition request requires a known toState", validateTransitionFollowUpRequest({ followUpId: "f1", toState: "BOGUS" }).valid === false);
}

console.log("\nE0 — validateHistoricalReconcileRequest() / hasHistoricalEvent() (Phase 7 historical-reconciliation fix)");
{
  const contact = { organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_IMPORT" };
  const event = { sourceRecordRef: "msg-1", note: "[historical_import:msg-1] test", fromStatus: "DRAFT", toStatus: "SENT", changedAt: "2026-01-01T00:00:00Z" };

  ok("1. at least one of the three arrays must contain a row", validateHistoricalReconcileRequest({}).valid === false);
  ok("2. a well-formed toCreate row is accepted", validateHistoricalReconcileRequest({ toCreate: [{ contact, groupEmail: "a@b.com", historicalEvent: event }] }).valid === true);
  ok("3. toCreate rejects an invalid contact payload", validateHistoricalReconcileRequest({ toCreate: [{ contact: { ...contact, organization: "" }, groupEmail: "a@b.com" }] }).valid === false);
  ok("4. toCreate requires a groupEmail", validateHistoricalReconcileRequest({ toCreate: [{ contact, historicalEvent: event }] }).valid === false);
  ok("5. toAttachExisting requires an existingContactId", validateHistoricalReconcileRequest({ toAttachExisting: [{ historicalEvent: event }] }).valid === false);
  ok("6. toAttachExisting requires a historicalEvent", validateHistoricalReconcileRequest({ toAttachExisting: [{ existingContactId: "c1" }] }).valid === false);
  ok("7. a well-formed toAttachExisting row is accepted", validateHistoricalReconcileRequest({ toAttachExisting: [{ existingContactId: "c1", contactPatch: null, historicalEvent: event }] }).valid === true);
  ok("8. an invalid status transition inside historicalEvent is rejected (defense in depth)",
     validateHistoricalReconcileRequest({ toAttachExisting: [{ existingContactId: "c1", historicalEvent: { ...event, fromStatus: "DRAFT", toStatus: "PUBLISHED" } }] }).valid === false);
  ok("9. a same-status (no-op) historicalEvent transition is accepted -- this is how a historical event is logged against a contact that must not move",
     validateHistoricalReconcileRequest({ toAttachExisting: [{ existingContactId: "c1", historicalEvent: { ...event, fromStatus: "SENT", toStatus: "SENT" } }] }).valid === true);
  ok("10. contactPatch rejects an unexpected field name", validateHistoricalReconcileRequest({ toAttachExisting: [{ existingContactId: "c1", contactPatch: { bogusField: 1 }, historicalEvent: event }] }).valid === false);
  ok("11. toAttachNewBatch requires a groupEmail and a historicalEvent", validateHistoricalReconcileRequest({ toAttachNewBatch: [{}] }).valid === false);
  ok("12. MAX_HISTORICAL_BATCH is enforced", validateHistoricalReconcileRequest({ toCreate: Array.from({ length: MAX_HISTORICAL_BATCH + 1 }, () => ({ contact, groupEmail: "a@b.com" })) }).valid === false);
  ok("13. HISTORICAL_EVENT_PREFIX matches the convention historicalImport.js (src/) independently declares", HISTORICAL_EVENT_PREFIX === "[historical_import:");
  ok("14. hasHistoricalEvent recognizes a note carrying the exact source ref", hasHistoricalEvent(["[historical_import:msg-1] whatever"], "msg-1") === true);
  ok("15. hasHistoricalEvent does not match a different ref", hasHistoricalEvent(["[historical_import:msg-1] whatever"], "msg-2") === false);
  ok("16. hasHistoricalEvent with no sourceRecordRef is always false (never a false positive on empty)", hasHistoricalEvent(["anything"], null) === false);
}

console.log("\nE — source scan: admin gate, dispatch, and NO email-sending capability");
{
  ok("1. requires OUTREACH_ADMIN_SECRET as a bearer token BEFORE reading the request body",
     /const adminSecret = Deno\.env\.get\("OUTREACH_ADMIN_SECRET"\)[\s\S]{0,200}UNAUTHENTICATED[\s\S]{0,400}await req\.json\(\)/.test(indexCode));
  ok("2. an incorrect/missing secret is refused with UNAUTHENTICATED/401", /authHeader !== `Bearer \$\{adminSecret\}`[\s\S]{0,200}"UNAUTHENTICATED",\s*401/.test(indexCode));
  ok("3. every documented action is dispatched", [
    "list_contacts", "list_followups", "create_contact", "import_contacts", "reconcile_historical_import",
    "update_contact_status", "create_followup", "transition_followup", "record_message_event", "list_message_events",
  ].every((a) => indexCode.includes(`"${a}"`)));
  ok("4. an unrecognized action falls through to a BAD_REQUEST refusal", /unknown action:/.test(indexCode));
  ok("5. no fetch() call anywhere -- this function cannot call any external provider", !/\bfetch\(/.test(indexCode));
  ok("6. no email-provider reference anywhere (brevo/resend/smtp)", !/brevo|resend|smtp/i.test(indexCode));
  ok("7. no console.log/error/warn -- no secret, email, or token can be logged", !/console\.(log|error|warn)/.test(indexTs));
  ok("8. status transition is validated server-side before any update is issued",
     /validateStatusTransition\(contact\.status, validation\.toStatus\)/.test(indexCode));
  ok("9. a status change always writes to outreach_status_changes (history preserved)",
     /outreach_status_changes/.test(indexCode) && /from_status: contact\.status, to_status: validation\.toStatus/.test(indexCode));
  ok("10. follow-up transition is validated server-side before any update is issued",
     /validateFollowUpTransition\(followUp\.state, validation\.toState\)/.test(indexCode));
  ok("11. import_contacts processes one contact at a time (for...of), never a single bulk statement",
     /for \(const raw of validation\.contacts\)/.test(indexCode));
  ok("12. import_contacts classifies duplicate_existing and duplicate_in_batch separately",
     /duplicateExisting\+\+/.test(indexCode) && /duplicateInBatch\+\+/.test(indexCode));
}

console.log("\nF — source scan: reconcile_historical_import (Phase 7 historical-reconciliation fix)");
{
  ok("1. the request is validated via validateHistoricalReconcileRequest before any write", /validateHistoricalReconcileRequest\(body\)/.test(indexCode));
  ok("2. re-reads each existing contact fresh from the database before deciding anything (never trusts the client's stale snapshot)",
     /outreach_contacts"\)\.select\("id, status, sent_at"\)\.eq\("id", row\.existingContactId\)/.test(indexCode));
  ok("3. re-reads existing outreach_status_changes notes fresh before every idempotency check (not just once, not from client input)",
     (indexCode.match(/outreach_status_changes"\)\.select\("note"\)\.eq\("contact_id"/g) || []).length >= 3);
  ok("4. calls hasHistoricalEvent (the shared idempotency check) before writing any historical event",
     (indexCode.match(/hasHistoricalEvent\(existingNotes, row\.historicalEvent\.sourceRecordRef\)/g) || []).length >= 2);
  ok("5. a contact that is no longer DRAFT/unsent server-side is NEVER patched, even if the client proposed a patch",
     /const stillUnsent = contact\.status === "DRAFT" && !contact\.sent_at/.test(indexCode) && /const applyPatch = stillUnsent && row\.contactPatch/.test(indexCode));
  ok("6. the contact-field patch path still re-validates the transition server-side (defense in depth, same as update_contact_status)",
     /validateStatusTransition\(contact\.status, toStatus\)/.test(indexCode));
  ok("7. every historical event insert sets changed_at from the row's OWN historical timestamp, never bare now() as the primary value",
     (indexCode.match(/changed_at: row\.historicalEvent\.changedAt \?\? new Date\(\)\.toISOString\(\)/g) || []).length >= 3);
  ok("8. new contacts are created one at a time (for...of), never a single bulk statement, same discipline as import_contacts",
     /for \(const row of validation\.toCreate\)/.test(indexCode));
  ok("9. no fetch() call was introduced by this action either", !/\bfetch\(/.test(indexCode));
  ok("10. no email-provider reference was introduced by this action either", !/brevo|resend|smtp/i.test(indexCode));
  ok("11. the response reports created/linked/alreadyRecorded/failed counts, not a generic 'ok' with no detail",
     /created, linked_existing: linkedExisting, linked_new_batch: linkedNewBatch,\s*already_recorded: alreadyRecorded, failed,/.test(indexCode));
}

console.log("\nG — validateRecordMessageEventRequest() / validateListMessageEventsRequest() (Launch Engine closed-loop, Phase 3)");
{
  ok("1. SECTOR now includes the five political-office categories plus party_secretariat",
     ["presidential_campaign", "governorship_campaign", "senate_campaign", "house_of_reps_campaign", "state_assembly_campaign", "party_secretariat"]
       .every((s) => SECTOR.includes(s)));

  const base = { contactId: "c1", direction: "OUTBOUND", activityState: "PREPARED", provider: "GMAIL", idempotencyKey: "k1" };
  ok("2. a PREPARED event needs no providerMessageId", validateRecordMessageEventRequest(base).valid === true);
  ok("3. a GMAIL SENT event with no providerMessageId is refused",
     validateRecordMessageEventRequest({ ...base, activityState: "SENT" }).valid === false);
  ok("4. a GMAIL SENT event with a providerMessageId is accepted",
     validateRecordMessageEventRequest({ ...base, activityState: "SENT", providerMessageId: "18x" }).valid === true);
  ok("5. a MANUAL_ATTESTATION SENT event needs occurredAt, not a providerMessageId",
     validateRecordMessageEventRequest({ ...base, activityState: "SENT", provider: "MANUAL_ATTESTATION" }).valid === false);
  ok("6. ...and passes once occurredAt is supplied",
     validateRecordMessageEventRequest({ ...base, activityState: "SENT", provider: "MANUAL_ATTESTATION", occurredAt: "2026-10-14T00:00:00Z" }).valid === true);
  ok("7. an INBOUND event must be REPLY_RECEIVED",
     validateRecordMessageEventRequest({ ...base, direction: "INBOUND", activityState: "SENT", providerMessageId: "x" }).valid === false);
  ok("8. a missing idempotencyKey is always rejected", validateRecordMessageEventRequest({ ...base, idempotencyKey: "" }).valid === false);
  ok("9. an out-of-vocabulary provider is rejected", validateRecordMessageEventRequest({ ...base, provider: "BOGUS" }).valid === false);
  ok("10. list_message_events with no filters is valid", validateListMessageEventsRequest({}).valid === true);
  ok("11. list_message_events accepts a contactId filter", validateListMessageEventsRequest({ contactId: "c1" }).valid === true);
}

console.log("\nH — source scan: record_message_event / list_message_events (evidence layer, still no sending)");
{
  ok("1. record_message_event is validated server-side before any write", /validateRecordMessageEventRequest\(body\)/.test(indexCode));
  ok("2. a duplicate idempotency_key is checked BEFORE insert, and reported as already-recorded rather than erroring",
     /idempotency_key", validation\.idempotencyKey\)[\s\S]{0,120}alreadyRecorded: true/.test(indexCode));
  ok("3. the contact must exist before a message event can be recorded against it",
     /outreach_contacts"\)\.select\("id"\)\.eq\("id", validation\.contactId\)\.maybeSingle\(\)/.test(indexCode));
  ok("4. list_message_events is validated server-side too", /validateListMessageEventsRequest\(body\)/.test(indexCode));
  ok("5. still no fetch() call anywhere in this file after adding the evidence-layer actions", !/\bfetch\(/.test(indexCode));
  ok("6. still no email-provider reference anywhere", !/brevo|resend|smtp/i.test(indexCode));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
