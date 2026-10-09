// ============================================================
// OUTREACH ACTIVATION — FOLLOW-UP WORKFLOW TESTS
// Covers: src/domains/outreach/followup.js, and a source scan proving
// "no automatic sending" across the whole outreach subsystem.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOLLOWUP_STATE, FOLLOWUP_TRANSITIONS, defaultFollowUpFor, validateFollowUp, validateFollowUpTransition,
} from "../src/domains/outreach/followup.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

console.log("\nOUTREACH ACTIVATION — follow-up workflow\n");

console.log("A — FOLLOWUP_STATE / FOLLOWUP_TRANSITIONS");
{
  ok("1. exactly the five Phase 8 states", FOLLOWUP_STATE.length === 5 && FOLLOWUP_STATE.includes("DRAFT") && FOLLOWUP_STATE.includes("SENT"));
  ok("2. SENT and CANCELLED are terminal", FOLLOWUP_TRANSITIONS.SENT.length === 0 && FOLLOWUP_TRANSITIONS.CANCELLED.length === 0);
  ok("3. DRAFT cannot jump straight to SENT or APPROVED", !FOLLOWUP_TRANSITIONS.DRAFT.includes("SENT") && !FOLLOWUP_TRANSITIONS.DRAFT.includes("APPROVED"));
  ok("4. APPROVED -> SENT is the only way to reach SENT", FOLLOWUP_STATE.filter((s) => FOLLOWUP_TRANSITIONS[s].includes("SENT")).every((s) => s === "APPROVED"));
}

console.log("\nB — defaultFollowUpFor() / validateFollowUp()");
{
  const f = defaultFollowUpFor({ contactId: "c1", assetCode: "A_INSTITUTIONAL_FOLLOWUP", subject: "Hi", body: "Body" });
  ok("1. defaults to DRAFT with no approvedAt/sentAt", f.state === "DRAFT" && f.approvedAt === null && f.sentAt === null);
  ok("2. a valid follow-up passes", validateFollowUp(f).valid === true);
  ok("3. a missing body is rejected", validateFollowUp({ ...f, body: "" }).valid === false);
  ok("4. an unrecognized state is rejected", validateFollowUp({ ...f, state: "BOGUS" }).valid === false);
}

console.log("\nC — validateFollowUpTransition() (DRAFT -> REVIEW -> APPROVED -> SEND discipline)");
{
  ok("1. DRAFT -> REVIEW allowed", validateFollowUpTransition("DRAFT", "REVIEW").valid === true);
  ok("2. DRAFT -> SENT refused (must pass through REVIEW/APPROVED)", validateFollowUpTransition("DRAFT", "SENT").valid === false);
  ok("3. REVIEW -> APPROVED allowed", validateFollowUpTransition("REVIEW", "APPROVED").valid === true);
  ok("4. APPROVED -> SENT allowed", validateFollowUpTransition("APPROVED", "SENT").valid === true);
  ok("5. SENT accepts no further transition", validateFollowUpTransition("SENT", "DRAFT").valid === false);
  ok("6. any non-terminal state can move to CANCELLED", ["DRAFT", "REVIEW", "APPROVED"].every((s) => validateFollowUpTransition(s, "CANCELLED").valid));
}

console.log("\nD — source scan: NO automatic sending anywhere in the outreach subsystem");
{
  const followupSrc = stripComments(readSrc("src/domains/outreach/followup.js"));
  const writeSrc = stripComments(readSrc("src/domains/outreach/write.js"));
  const indexTs = stripComments(readSrc("supabase/functions/outreach-admin/index.ts"));
  const contractMjs = stripComments(readSrc("supabase/functions/outreach-admin/contract.mjs"));

  ok("1. followup.js contains no fetch call", !/\bfetch\(/.test(followupSrc));
  ok("2. followup.js contains no email-provider reference (brevo/resend/smtp)", !/brevo|resend|smtp/i.test(followupSrc));
  ok("3. outreach-admin/index.ts contains NO fetch() call of any kind -- it cannot dispatch anything itself",
     !/\bfetch\(/.test(indexTs));
  ok("4. outreach-admin/index.ts never references an email provider (brevo/resend/smtp)", !/brevo|resend|smtp/i.test(indexTs));
  ok("5. outreach-admin/contract.mjs contains no fetch call either", !/\bfetch\(/.test(contractMjs));
  ok("6. src/domains/outreach/write.js (the browser-side caller) never calls fetch directly -- only client.functions.invoke",
     !/[^.]fetch\(/.test(writeSrc));
  ok("7. the admin secret gate in index.ts runs before request.json() is awaited",
     /OUTREACH_ADMIN_SECRET[\s\S]{0,300}UNAUTHENTICATED[\s\S]{0,400}await req\.json\(\)/.test(indexTs));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
