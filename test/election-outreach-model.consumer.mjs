// ============================================================
// OUTREACH ACTIVATION — CORE MODEL TESTS
// Covers: src/domains/outreach/model.js
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTOR, PIPELINE_STATUS, TERMINAL_PIPELINE_STATUS, STATUS_TRANSITIONS,
  DELIVERY_STATUS, ENGAGEMENT_STATUS, RESPONSE_STATUS, CONVERSATION_STATUS, SOURCE_OF_TRUTH, SENDER_ACCOUNT,
  defaultContactFor, validateContact, validateStatusTransition, computeFollowUpEligibility,
} from "../src/domains/outreach/model.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — core model\n");

console.log("A — closed vocabularies");
{
  ok("1. SECTOR has exactly the Phase 5 sectors plus 'other'", SECTOR.length === 7 && SECTOR.includes("other"));
  ok("2. PIPELINE_STATUS has exactly the 15 Phase 3 states", PIPELINE_STATUS.length === 15);
  ok("3. every PIPELINE_STATUS has a transition entry (possibly empty)", PIPELINE_STATUS.every((s) => Array.isArray(STATUS_TRANSITIONS[s])));
  ok("4. terminal statuses accept no outgoing transition", TERMINAL_PIPELINE_STATUS.every((s) => STATUS_TRANSITIONS[s].length === 0));
  ok("5. DELIVERY_STATUS/ENGAGEMENT_STATUS/RESPONSE_STATUS/CONVERSATION_STATUS/SOURCE_OF_TRUTH are frozen",
     Object.isFrozen(DELIVERY_STATUS) && Object.isFrozen(ENGAGEMENT_STATUS) && Object.isFrozen(RESPONSE_STATUS)
     && Object.isFrozen(CONVERSATION_STATUS) && Object.isFrozen(SOURCE_OF_TRUTH));
  ok("6. SENDER_ACCOUNT is exactly the two real outreach mailboxes plus UNKNOWN",
     Object.isFrozen(SENDER_ACCOUNT) && SENDER_ACCOUNT.length === 3
     && SENDER_ACCOUNT.includes("sotinnovate@gmail.com") && SENDER_ACCOUNT.includes("admin@electioncanon.org") && SENDER_ACCOUNT.includes("UNKNOWN"));
}

console.log("\nB — defaultContactFor() never invents a fact");
{
  const c = defaultContactFor({ organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY" });
  ok("1. status defaults to DRAFT", c.status === "DRAFT");
  ok("2. sentAt/responseAt/followUpDueAt/lastContactAt all default to null, never a guessed date",
     c.sentAt === null && c.responseAt === null && c.followUpDueAt === null && c.lastContactAt === null);
  ok("3. every *_status field defaults to its honest UNKNOWN/NONE value",
     c.deliveryStatus === "UNKNOWN" && c.engagementStatus === "UNKNOWN" && c.responseStatus === "UNKNOWN" && c.conversationStatus === "NONE");
  ok("4. followUpCount defaults to 0", c.followUpCount === 0);
  ok("5. demoSent/githubSent/evidencePackageSent all default to false", c.demoSent === false && c.githubSent === false && c.evidencePackageSent === false);
  ok("6. senderAccount defaults to UNKNOWN, sourceRecordRef defaults to null", c.senderAccount === "UNKNOWN" && c.sourceRecordRef === null);
}

console.log("\nC — validateContact()");
{
  const base = defaultContactFor({ organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY" });
  ok("1. a valid default contact passes", validateContact(base).valid === true);
  ok("2. missing organization is rejected", validateContact({ ...base, organization: "" }).valid === false);
  ok("3. a malformed email is rejected", validateContact({ ...base, recipientEmail: "not-an-email" }).valid === false);
  ok("4. a sector outside the closed vocabulary is rejected", validateContact({ ...base, sector: "bogus" }).valid === false);
  ok("5. a sourceOfTruth outside the closed vocabulary is rejected", validateContact({ ...base, sourceOfTruth: "bogus" }).valid === false);
  ok("6. an unrecognized status is rejected", validateContact({ ...base, status: "BOGUS" }).valid === false);
  ok("7. a negative followUpCount is rejected", validateContact({ ...base, followUpCount: -1 }).valid === false);
  ok("8. an error always names the offending field", /organization|recipientEmail|sector|sourceOfTruth|status|followUpCount/.test(validateContact({ ...base, organization: "" }).error));
  ok("9. validateContact never mutates its input", (() => { const copy = { ...base }; validateContact(copy); return JSON.stringify(copy) === JSON.stringify(base); })());
  ok("10. a senderAccount outside the closed vocabulary is rejected", validateContact({ ...base, senderAccount: "someone@example.com" }).valid === false);
  ok("11. a real senderAccount is accepted", validateContact({ ...base, senderAccount: "admin@electioncanon.org" }).valid === true);
  ok("12. an overlong sourceRecordRef is rejected", validateContact({ ...base, sourceRecordRef: "x".repeat(201) }).valid === false);
}

console.log("\nD — validateStatusTransition() (the closed Phase 3 graph)");
{
  ok("1. DRAFT -> SENT is allowed", validateStatusTransition("DRAFT", "SENT").valid === true);
  ok("2. DRAFT -> RESPONDED is refused (skips SENT)", validateStatusTransition("DRAFT", "RESPONDED").valid === false);
  ok("3. a same-status 'transition' is a no-op, not an error", validateStatusTransition("SENT", "SENT").valid === true);
  ok("4. PUBLISHED accepts no outgoing transition", validateStatusTransition("PUBLISHED", "SENT").valid === false);
  ok("5. DECLINED accepts no outgoing transition", validateStatusTransition("DECLINED", "SENT").valid === false);
  ok("6. an unknown fromStatus is refused", validateStatusTransition("BOGUS", "SENT").valid === false);
  ok("7. an unknown toStatus is refused", validateStatusTransition("SENT", "BOGUS").valid === false);
  ok("8. NO_RESPONSE -> FOLLOW_UP_DUE is allowed (the literal 'needs a follow-up' path)", validateStatusTransition("NO_RESPONSE", "FOLLOW_UP_DUE").valid === true);
  ok("9. RESPONDED -> CONVERSATION/DEMO/EDITORIAL_INTEREST/PARTNERSHIP_INTEREST/CONTRIBUTOR_INTEREST are all allowed",
     ["CONVERSATION", "DEMO", "EDITORIAL_INTEREST", "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST"].every((s) => validateStatusTransition("RESPONDED", s).valid));
}

console.log("\nE — computeFollowUpEligibility()");
{
  const now = new Date("2026-10-08T00:00:00Z");
  const base = defaultContactFor({ organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY" });
  ok("1. no follow_up_due_at set -> not eligible", computeFollowUpEligibility({ ...base, status: "SENT", followUpDueAt: null }, now).eligible === false);
  ok("2. a future follow_up_due_at -> not eligible yet", computeFollowUpEligibility({ ...base, status: "SENT", followUpDueAt: "2026-12-01T00:00:00Z" }, now).eligible === false);
  ok("3. a past follow_up_due_at on a non-terminal status -> eligible", computeFollowUpEligibility({ ...base, status: "SENT", followUpDueAt: "2026-01-01T00:00:00Z" }, now).eligible === true);
  ok("4. a terminal status is NEVER eligible even with a past due date", computeFollowUpEligibility({ ...base, status: "DECLINED", followUpDueAt: "2026-01-01T00:00:00Z" }, now).eligible === false);
  ok("5. an invalid date string is rejected, not silently treated as due", computeFollowUpEligibility({ ...base, status: "SENT", followUpDueAt: "not-a-date" }, now).eligible === false);
}

console.log("\nF — source scan: DOM-free, Supabase-free, no React");
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(__dirname, "..", "src/domains/outreach/model.js"), "utf8");
  const code = stripComments(src);
  ok("1. no React import", !/from ["']react["']/.test(code));
  ok("2. no document/window reference", !/\bdocument\.|\bwindow\./.test(code));
  ok("3. no Supabase import", !/supabase/i.test(code));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
