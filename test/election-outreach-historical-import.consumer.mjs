// ============================================================
// OUTREACH ACTIVATION — HISTORICAL IMPORT RECONCILIATION TESTS
// Covers: src/domains/outreach/historicalImport.js -- the fix for the
// Phase 7 "duplicate_existing silently discarded" gap (see that file's
// own header for the full design).
// ============================================================

import { parseCsv } from "../src/domains/outreach/import.js";
import {
  countEmailAddresses, isUnknownPlaceholder, cleanPlaceholder, buildHistoricalNote,
  hasHistoricalEvent, classifyRawRow, buildContactPatch, planHistoricalReconciliation,
} from "../src/domains/outreach/historicalImport.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — historical import reconciliation\n");

console.log("A — CSV parsing correctness (quoted commas, embedded newlines, escaped quotes) -- reusing import.js's own parser");
{
  const csv = `organization,recipient,email,sector,country,campaign,subject,letter_version,date_sent,known_status,known_response,sender_account,source_record_ref,notes\n` +
    `"Acme, Inc.","Jane ""The Boss"" Doe",jane@acme.com,media,Nigeria,Launch,"Multi-line\nsubject",v1,2026-01-05T00:00:00Z,SENT,UNKNOWN,sotinnovate@gmail.com,msg-1,"note, with a comma"`;
  const parsed = parseCsv(csv);
  ok("1. parses a quoted field containing a comma", parsed.valid && parsed.rows[0].organization === "Acme, Inc.");
  ok("2. parses an escaped double-quote inside a quoted field", parsed.rows[0].recipient === 'Jane "The Boss" Doe');
  ok("3. parses an embedded newline inside a quoted field", parsed.rows[0].subject === "Multi-line\nsubject");
  ok("4. parses a comma inside a quoted notes field without shifting later columns", parsed.rows[0].notes === "note, with a comma");
  ok("5. the row still has exactly the 14 expected columns (no column shift)", Object.keys(parsed.rows[0]).length === 14);
}

console.log("\nB — malformed recipient email rejection without rejecting unrelated valid rows");
{
  const rows = [
    { organization: "Good Org", email: "good@org.com", sector: "media" },
    { organization: "Bad Org", email: "not-an-email", sector: "media" },
    { organization: "Also Good", email: "also@good.com", sector: "media" },
  ];
  const plan = planHistoricalReconciliation(rows, [], {});
  ok("1. the malformed-email row is rejected", plan.invalid.length === 1 && plan.invalid[0].raw.organization === "Bad Org");
  ok("2. the two valid rows either side of it are unaffected", plan.toCreate.length === 2);
  ok("3. the invalid row carries its REAL index in the original array (row 1, 0-based), not an index into a filtered sub-list",
     plan.invalid[0].rowIndex === 1);
}

console.log("\nC — multi-recipient email fields are flagged for review, never auto-assigned, never rejected as a generic invalid row");
{
  ok("1. countEmailAddresses finds 2 distinct addresses in a semicolon-separated field", countEmailAddresses("a@b.com; c@d.com") === 2);
  ok("2. countEmailAddresses finds 1 address in a normal field", countEmailAddresses("a@b.com") === 1);
  ok("3. countEmailAddresses finds 0 in an empty/garbage field", countEmailAddresses("not an email") === 0);

  const row = { organization: "UNDP", email: "registry.ng@undp.org; christabel.chanda-ginsberg@undp.org", sector: "development_org" };
  const classified = classifyRawRow(row, 0);
  ok("4. a row with two addresses in one field is 'needs_review', not 'invalid' and not silently split", classified.status === "needs_review");
  ok("5. the reason names the actual ambiguity, not a generic email-format error", /2 distinct recipient addresses/.test(classified.reason));

  const plan = planHistoricalReconciliation([row], [], {});
  ok("6. the same row surfaces in the plan's needsReview bucket, not invalid or toCreate", plan.needsReview.length === 1 && plan.invalid.length === 0 && plan.toCreate.length === 0);
}

console.log("\nD — UNKNOWN-placeholder sentences are cleaned to null, never stored verbatim in a data field");
{
  ok("1. a bare 'UNKNOWN' is recognized as a placeholder", isUnknownPlaceholder("UNKNOWN"));
  ok("2. the real candidate-file sentence is recognized as a placeholder", isUnknownPlaceholder("UNKNOWN — not present in source tracker"));
  ok("3. a real country name is never mistaken for a placeholder", !isUnknownPlaceholder("Nigeria"));
  ok("4. cleanPlaceholder() converts the placeholder sentence to null", cleanPlaceholder("UNKNOWN — not present in source tracker") === null);
  ok("5. cleanPlaceholder() leaves a real value untouched", cleanPlaceholder("Nigeria") === "Nigeria");

  const row = { organization: "Yiaga Africa", email: "info@yiaga.org", sector: "democracy_election_org", country: "UNKNOWN — not present in source tracker" };
  const classified = classifyRawRow(row, 0);
  ok("6. the placeholder never reaches the resulting contact's country field", classified.status === "ok" && classified.contact.country === null);
}

console.log("\nE — correct handling of an existing contact: no duplicate contact created, a historical event is recorded instead");
{
  const existing = [{ id: "contact-1", recipientEmail: "info@yiaga.org", status: "DRAFT", sentAt: null, senderAccount: "UNKNOWN", sourceRecordRef: null, subject: null, campaign: null, letterVersion: null, country: null }];
  const row = { organization: "Yiaga Africa", email: "info@yiaga.org", sector: "democracy_election_org", date_sent: "2026-09-28T07:08:08Z", subject: "First letter", sender_account: "sotinnovate@gmail.com", source_record_ref: "msg-1" };
  const plan = planHistoricalReconciliation([row], existing, {});
  ok("1. no new contact is proposed for an email that already has one", plan.toCreate.length === 0);
  ok("2. the row is routed to toAttachExisting, referencing the real existing contact id", plan.toAttachExisting.length === 1 && plan.toAttachExisting[0].existingContactId === "contact-1");
  ok("3. a contactPatch IS proposed, because the existing contact was DRAFT/unsent", plan.toAttachExisting[0].contactPatch !== null);
  ok("4. the proposed patch moves DRAFT -> SENT using the message's own sent date", plan.toAttachExisting[0].contactPatch.status === "SENT" && plan.toAttachExisting[0].contactPatch.sentAt === "2026-09-28T07:08:08.000Z");
}

console.log("\nF — no duplicate contact creation during historical reconciliation, across the whole dataset shape");
{
  const existing = [
    { id: "c1", recipientEmail: "a@org.com", status: "SENT", sentAt: "2026-01-01T00:00:00Z", senderAccount: "sotinnovate@gmail.com", sourceRecordRef: "old-ref", subject: "Old subject", campaign: null, letterVersion: null, country: null },
  ];
  const rows = [
    { organization: "Org A", email: "a@org.com", sector: "media", date_sent: "2026-02-01T00:00:00Z", source_record_ref: "new-ref" },
    { organization: "Org B", email: "b@org.com", sector: "media", date_sent: "2026-02-01T00:00:00Z", source_record_ref: "ref-b" },
  ];
  const plan = planHistoricalReconciliation(rows, existing, {});
  ok("1. the row matching an existing contact never appears in toCreate", plan.toCreate.every((r) => r.contact.recipientEmail !== "a@org.com"));
  ok("2. exactly one new contact is created, for the genuinely new email", plan.toCreate.length === 1 && plan.toCreate[0].contact.recipientEmail === "b@org.com");
  ok("3. the existing (already SENT) contact's fields are NOT patched -- it already moved past DRAFT", plan.toAttachExisting[0].contactPatch === null);
  ok("4. the historical event for the already-SENT contact is a same-status no-op (fromStatus === toStatus), never a regression",
     plan.toAttachExisting[0].historicalEvent.fromStatus === "SENT" && plan.toAttachExisting[0].historicalEvent.toStatus === "SENT");
}

console.log("\nG — idempotent re-import of the same source message id");
{
  const existing = [{ id: "c1", recipientEmail: "a@org.com", status: "SENT", sentAt: "2026-01-01T00:00:00Z", senderAccount: "sotinnovate@gmail.com", sourceRecordRef: "ref-1", subject: null, campaign: null, letterVersion: null, country: null }];
  const row = { organization: "Org A", email: "a@org.com", sector: "media", date_sent: "2026-01-01T00:00:00Z", source_record_ref: "ref-1" };

  const firstPlan = planHistoricalReconciliation([row], existing, {});
  ok("1. the first time, with no recorded history yet, the row is a genuine attach", firstPlan.toAttachExisting.length === 1 && firstPlan.alreadyRecorded.length === 0);

  const recordedNote = firstPlan.toAttachExisting[0].historicalEvent.note;
  ok("2. hasHistoricalEvent recognizes that exact note as already covering ref-1", hasHistoricalEvent([recordedNote], "ref-1"));
  ok("3. hasHistoricalEvent does not falsely match an unrelated ref", !hasHistoricalEvent([recordedNote], "ref-2"));

  const secondPlan = planHistoricalReconciliation([row], existing, { "a@org.com": [recordedNote] });
  ok("4. re-running the same plan, now that the event is recorded, classifies the row as alreadyRecorded", secondPlan.alreadyRecorded.length === 1 && secondPlan.toAttachExisting.length === 0);
  ok("5. re-running produces zero net-new actionable rows", secondPlan.summary.newContacts + secondPlan.summary.linkedToExisting + secondPlan.summary.linkedToNewBatch === 0);
}

console.log("\nH — distinct historical messages to the same recipient are preserved separately, not merged or overwritten");
{
  const existing = [{ id: "c1", recipientEmail: "info@yiaga.org", status: "DRAFT", sentAt: null, senderAccount: "UNKNOWN", sourceRecordRef: null, subject: null, campaign: null, letterVersion: null, country: null }];
  const rows = [
    { organization: "Yiaga Africa", email: "info@yiaga.org", sector: "democracy_election_org", date_sent: "2026-10-06T12:02:07Z", subject: "Second letter", source_record_ref: "ref-2" },
    { organization: "Yiaga Africa", email: "info@yiaga.org", sector: "democracy_election_org", date_sent: "2026-09-28T07:08:08Z", subject: "First letter", source_record_ref: "ref-1" },
  ];
  const plan = planHistoricalReconciliation(rows, existing, {});
  ok("1. both distinct messages produce their own toAttachExisting entry (neither is dropped as a duplicate)", plan.toAttachExisting.length === 2);
  ok("2. each entry keeps its own distinct sourceRecordRef", new Set(plan.toAttachExisting.map((r) => r.historicalEvent.sourceRecordRef)).size === 2);
  ok("3. the one-time DRAFT->SENT backfill is attributed to the EARLIEST message (ref-1, Sept), not the later one processed first in file order",
     plan.toAttachExisting.find((r) => r.historicalEvent.sourceRecordRef === "ref-1").contactPatch !== null &&
     plan.toAttachExisting.find((r) => r.historicalEvent.sourceRecordRef === "ref-2").contactPatch === null);
}

console.log("\nI — two distinct messages to the same BRAND-NEW email (no existing contact) never create two contacts");
{
  const rows = [
    { organization: "New Org", email: "new@org.com", sector: "media", date_sent: "2026-03-01T00:00:00Z", source_record_ref: "ref-later" },
    { organization: "New Org", email: "new@org.com", sector: "media", date_sent: "2026-01-01T00:00:00Z", source_record_ref: "ref-earlier" },
  ];
  const plan = planHistoricalReconciliation(rows, [], {});
  ok("1. exactly one contact-creation row is proposed for the shared new email", plan.toCreate.length === 1);
  ok("2. the earliest message becomes the contact-creation row", plan.toCreate[0].contact.sourceRecordRef === "ref-earlier");
  ok("3. the later message becomes a toAttachNewBatch row referencing the same group email, not a second contact", plan.toAttachNewBatch.length === 1 && plan.toAttachNewBatch[0].groupEmail === "new@org.com");
}

console.log("\nJ — multiple recipients / CC handling: a field with several addresses is never silently assigned to one of them");
{
  const row = { organization: "Org", email: "to@org.com, cc@org.com", sector: "media" };
  const classified = classifyRawRow(row, 0);
  ok("1. a comma-separated multi-address field is also caught (not only semicolon-separated)", classified.status === "needs_review");
}

console.log("\nK — unknown fields and missing values never crash the planner and never fabricate a value");
{
  const minimal = { organization: "Minimal Org", email: "min@org.com", sector: "media" };
  const plan = planHistoricalReconciliation([minimal], [], {});
  ok("1. a row with only organization/email/sector still produces a valid toCreate entry", plan.toCreate.length === 1);
  ok("2. sourceRecordRef stays null, never fabricated", plan.toCreate[0].contact.sourceRecordRef === null);
  ok("3. an undated row proposes no historicalEvent at all (nothing to log -- it was never evidenced as sent)", plan.toCreate[0].historicalEvent === null);
  ok("4. an empty row array never throws", (() => { planHistoricalReconciliation([], [], {}); return true; })());
  ok("5. undefined existingContacts/refs never throw (defaults apply)", (() => { planHistoricalReconciliation([minimal]); return true; })());
}

console.log("\nL — note encoding is stable and greppable (the idempotency key)");
{
  const note = buildHistoricalNote({ sourceRecordRef: "msg-42", subject: "Hello", sentAtIso: "2026-01-01T00:00:00.000Z", senderAccount: "admin@electioncanon.org", campaign: "Launch", letterVersion: "v2" });
  ok("1. the note contains the exact HISTORICAL_EVENT_PREFIX + ref", note.includes("[historical_import:msg-42]"));
  ok("2. the note includes the subject", note.includes("Hello"));
  ok("3. the note includes the sender account", note.includes("admin@electioncanon.org"));
  ok("4. buildContactPatch returns null for a contact that already has a sent_at", buildContactPatch({ status: "DRAFT", sentAt: "2026-01-01T00:00:00Z" }, { contact: { sentAt: "2026-02-01T00:00:00Z" } }) === null);
  ok("5. buildContactPatch returns null for a contact already past DRAFT", buildContactPatch({ status: "SENT", sentAt: null }, { contact: { sentAt: "2026-02-01T00:00:00Z" } }) === null);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
