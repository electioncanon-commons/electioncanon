// ============================================================
// OUTREACH ACTIVATION — HISTORICAL IMPORT TESTS  (Phase 7)
// Covers: src/domains/outreach/import.js
// ============================================================

import { parseCsv, parseImportRows, normalizeImportRow, mapKnownStatus, mapKnownResponse, mapKnownSenderAccount, detectDuplicates } from "../src/domains/outreach/import.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — historical import\n");

console.log("A — parseCsv()");
{
  const csv = `organization,email,sector,date_sent\n"Acme, Inc.",a@acme.com,media,2026-01-05\nOpen Org,b@open.org,open_source_dev,`;
  const parsed = parseCsv(csv);
  ok("1. parses a quoted field containing a comma", parsed.valid && parsed.rows[0].organization === "Acme, Inc.");
  ok("2. parses an unquoted row normally", parsed.rows[1].organization === "Open Org");
  ok("3. a blank trailing field parses as empty string, not undefined", parsed.rows[1].date_sent === "");
  ok("4. empty input is rejected", parseCsv("").valid === false);
  ok("5. header-only input yields zero rows, not an error", parseCsv("organization,email").valid === true && parseCsv("organization,email").rows.length === 0);
}

console.log("\nB — parseImportRows()");
{
  ok("1. json format requires an array", parseImportRows({ not: "an array" }, "json").valid === false);
  ok("2. json format accepts an array", parseImportRows([{ organization: "X" }], "json").valid === true);
  ok("3. an unknown format is refused", parseImportRows("x", "xml").valid === false);
}

console.log("\nC — mapKnownStatus() / mapKnownResponse() (unknown stays unknown, never guessed)");
{
  ok("1. 'responded' maps to RESPONDED", mapKnownStatus("responded") === "RESPONDED");
  ok("2. 'No Response' (mixed case) maps to NO_RESPONSE", mapKnownStatus("No Response") === "NO_RESPONSE");
  ok("3. an unrecognized string maps to null, not a guess", mapKnownStatus("somewhat interested") === null);
  ok("4. empty/undefined maps to null", mapKnownStatus("") === null && mapKnownStatus(undefined) === null);
  ok("5. 'declined' response maps to DECLINED", mapKnownResponse("declined") === "DECLINED");
  ok("6. an unrecognized response string maps to null", mapKnownResponse("sort of") === null);
  ok("7. 'admin@electioncanon.org' maps to itself", mapKnownSenderAccount("admin@electioncanon.org") === "admin@electioncanon.org");
  ok("8. a mixed-case known sender account still matches", mapKnownSenderAccount("SOTINNOVATE@GMAIL.COM") === "sotinnovate@gmail.com");
  ok("9. an unrecognized sender account maps to null, not a guess", mapKnownSenderAccount("someone@example.com") === null);
}

console.log("\nD — normalizeImportRow() (the one documented inference, and nothing more)");
{
  const dated = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", date_sent: "2026-01-05" });
  ok("1. a dated row with no known_status infers SENT (the one documented inference)", dated.valid && dated.contact.status === "SENT");
  ok("2. a dated row also infers deliveryStatus SENT", dated.contact.deliveryStatus === "SENT");

  const undated = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media" });
  ok("3. an undated row with no known_status defaults to DRAFT, not SENT", undated.contact.status === "DRAFT");
  ok("4. an undated row's deliveryStatus stays UNKNOWN", undated.contact.deliveryStatus === "UNKNOWN");

  const recognized = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", known_status: "Conversation" });
  ok("5. a recognized known_status is used verbatim", recognized.contact.status === "CONVERSATION");

  const unrecognized = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", known_status: "somewhat warm" });
  ok("6. an unrecognized known_status is preserved in notes, never silently mapped", /somewhat warm/.test(unrecognized.contact.notes));
  ok("7. an unrecognized known_status still falls back to DRAFT (undated)", unrecognized.contact.status === "DRAFT");

  const missingOrg = normalizeImportRow({ email: "a@acme.com", sector: "media" });
  ok("8. a row missing organization is rejected, not defaulted", missingOrg.valid === false);

  const badSector = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "not_a_sector" });
  ok("9. an unrecognized sector falls back to 'other', not rejected (sector is informational, not identity)", badSector.valid === true && badSector.contact.sector === "other");

  const sourced = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media" });
  ok("10. every imported contact is tagged sourceOfTruth MANUAL_IMPORT", sourced.contact.sourceOfTruth === "MANUAL_IMPORT");

  const withSender = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", sender_account: "admin@electioncanon.org" });
  ok("11. a recognized sender_account is carried forward", withSender.contact.senderAccount === "admin@electioncanon.org");

  const noSender = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media" });
  ok("12. a missing sender_account defaults to UNKNOWN, never a guess", noSender.contact.senderAccount === "UNKNOWN");

  const badSender = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", sender_account: "someone@else.com" });
  ok("13. an unrecognized sender_account is preserved verbatim in notes, not silently mapped", /someone@else\.com/.test(badSender.contact.notes));
  ok("14. an unrecognized sender_account still defaults to UNKNOWN, not a guess between the two real accounts", badSender.contact.senderAccount === "UNKNOWN");

  const withRef = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", source_record_ref: "gmail-msg-id-123" });
  ok("15. source_record_ref is carried forward verbatim when supplied", withRef.contact.sourceRecordRef === "gmail-msg-id-123");

  const noRef = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media" });
  ok("16. a missing source_record_ref stays null, never fabricated", noRef.contact.sourceRecordRef === null);

  const withNotes = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", notes: "Website: https://acme.com; Priority: A" });
  ok("17. a supplied notes column is carried forward verbatim", withNotes.contact.notes === "Website: https://acme.com; Priority: A");

  const notesPlusUnrecognized = normalizeImportRow({ organization: "Acme", email: "a@acme.com", sector: "media", notes: "Priority: A", known_status: "somewhat warm" });
  ok("18. supplied notes come first, auto-generated notes are appended after, never replacing them",
     notesPlusUnrecognized.contact.notes.startsWith("Priority: A") && /somewhat warm/.test(notesPlusUnrecognized.contact.notes));
}

console.log("\nE — detectDuplicates()");
{
  const a = { recipientEmail: "a@acme.com" };
  const b = { recipientEmail: "A@Acme.com" }; // same address, different case
  const c = { recipientEmail: "c@other.com" };
  const classified = detectDuplicates([a, b, c], [{ recipientEmail: "c@other.com" }]);
  ok("1. the first occurrence of an email is 'new'", classified[0].classification === "new");
  ok("2. a case-insensitive repeat within the same batch is 'duplicate_in_batch'", classified[1].classification === "duplicate_in_batch");
  ok("3. a row matching an existing contact's email is 'duplicate_existing'", classified[2].classification === "duplicate_existing");
  ok("4. detectDuplicates never merges fields -- it only classifies", classified.every((r) => Object.keys(r).length === 2));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
