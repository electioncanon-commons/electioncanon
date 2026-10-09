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
  SECTOR, PIPELINE_STATUS, ASSET_CODE, FOLLOWUP_STATE, MAX_IMPORT_BATCH,
  validateContactPayload, validateListContactsRequest, validateImportRequest, validateStatusTransition,
  validateUpdateStatusRequest, validateCreateFollowUpRequest, validateFollowUpTransition, validateTransitionFollowUpRequest,
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

console.log("\nE — source scan: admin gate, dispatch, and NO email-sending capability");
{
  ok("1. requires OUTREACH_ADMIN_SECRET as a bearer token BEFORE reading the request body",
     /const adminSecret = Deno\.env\.get\("OUTREACH_ADMIN_SECRET"\)[\s\S]{0,200}UNAUTHENTICATED[\s\S]{0,400}await req\.json\(\)/.test(indexCode));
  ok("2. an incorrect/missing secret is refused with UNAUTHENTICATED/401", /authHeader !== `Bearer \$\{adminSecret\}`[\s\S]{0,200}"UNAUTHENTICATED",\s*401/.test(indexCode));
  ok("3. every documented action is dispatched", [
    "list_contacts", "list_followups", "create_contact", "import_contacts", "update_contact_status", "create_followup", "transition_followup",
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

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
