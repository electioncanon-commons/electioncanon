// ============================================================
// OUTREACH ACTIVATION — TRACKER / GMAIL RECONCILIATION TESTS  (Phase 11)
// Covers: src/domains/outreach/reconcile.js
// ============================================================

import {
  MATCH_CONFIDENCE, parseGmailMetadataRows, extractEmails, dedupeGmailRows, indexGmailByRecipient,
  matchTrackerToGmail, findUnrepresentedGmailRows, buildReconciledRow, buildProposedTracker,
  buildReconciliationReport, flagPriorOutreachConflicts,
} from "../src/domains/outreach/reconcile.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — tracker/Gmail reconciliation\n");

function trackerRow(overrides) {
  return { organization: "Acme Media", email: "jane@acme-media.org", subject: "Launch outreach", date_sent: null, ...overrides };
}
function gmailRow(overrides) {
  return {
    recipients: "jane@acme-media.org", subject: "ElectionCanon launch", sent_at: "2026-09-15T10:00:00.000Z",
    gmail_message_id: "msg-1", gmail_thread_id: "thread-1", sender_account: "admin@electioncanon.org",
    organization: null, ...overrides,
  };
}

console.log("A — MATCH_CONFIDENCE / extractEmails()");
{
  ok("1. MATCH_CONFIDENCE is exactly the three required categories", Object.isFrozen(MATCH_CONFIDENCE)
    && MATCH_CONFIDENCE.length === 3 && ["HIGH_CONFIDENCE", "NEEDS_REVIEW", "NO_MATCH"].every((c) => MATCH_CONFIDENCE.includes(c)));
  ok("2. extracts a display-name-wrapped address", extractEmails('"Jane Doe" <jane@x.org>')[0] === "jane@x.org");
  ok("3. extracts multiple addresses from a comma-joined header", extractEmails("a@x.org, b@y.org").length === 2);
  ok("4. de-duplicates case-insensitively", extractEmails("A@X.org, a@x.org").length === 1);
  ok("5. a non-string input never throws", extractEmails(undefined).length === 0 && extractEmails(null).length === 0);
}

console.log("\nB — dedupeGmailRows() (duplicate messages in the export)");
{
  const g1 = gmailRow({ gmail_message_id: "dup-1" });
  const g2 = gmailRow({ gmail_message_id: "dup-1" }); // same message, exported twice
  const g3 = gmailRow({ gmail_message_id: "other" });
  const deduped = dedupeGmailRows([g1, g2, g3]);
  ok("1. an exact repeated gmail_message_id collapses to one row", deduped.length === 2);
  ok("2. the FIRST occurrence is the one kept", deduped[0] === g1);
  ok("3. a row with no gmail_message_id at all is never silently dropped", dedupeGmailRows([{ recipients: "x@y.com" }, { recipients: "x@y.com" }]).length === 2);
}

console.log("\nC — matchTrackerToGmail(): the basic cases");
{
  const { highConfidence, needsReview, noMatch } = matchTrackerToGmail([trackerRow()], [gmailRow()]);
  ok("1. an exact single recipient-email match is HIGH_CONFIDENCE", highConfidence.length === 1 && needsReview.length === 0 && noMatch.length === 0);
  ok("2. the match carries the real gmailRow as evidence", highConfidence[0].gmailRow.gmail_message_id === "msg-1");

  const noneSent = matchTrackerToGmail([trackerRow({ email: "nobody@nowhere.org" })], [gmailRow()]);
  ok("3. a tracker row with no Gmail evidence at all is NO_MATCH, not a guess", noneSent.noMatch.length === 1 && noneSent.highConfidence.length === 0);

  const blankEmail = matchTrackerToGmail([trackerRow({ email: "" })], [gmailRow()]);
  ok("4. a tracker row with no usable email is NO_MATCH, never crashes", blankEmail.noMatch.length === 1);
}

console.log("\nD — multiple recipients on one sent message (legitimate, not a conflict)");
{
  const shared = gmailRow({ recipients: "alice@orga.org, bob@orgb.org", gmail_message_id: "shared-1" });
  const rowA = trackerRow({ organization: "Org A", email: "alice@orga.org" });
  const rowB = trackerRow({ organization: "Org B", email: "bob@orgb.org" });
  const { highConfidence, needsReview } = matchTrackerToGmail([rowA, rowB], [shared]);
  ok("1. BOTH distinct recipients on one cc'd message become HIGH_CONFIDENCE independently", highConfidence.length === 2);
  ok("2. this is never mistaken for a conflict", needsReview.length === 0);
  ok("3. both cite the exact same underlying Gmail message as their evidence", highConfidence[0].gmailRow === highConfidence[1].gmailRow);
}

console.log("\nE — forwarded/replied threads: the SAME recipient with two distinct sent messages");
{
  const original = gmailRow({ gmail_message_id: "orig-1", gmail_thread_id: "t-1", sent_at: "2026-09-10T00:00:00.000Z" });
  const resend = gmailRow({ gmail_message_id: "resend-1", gmail_thread_id: "t-1", sent_at: "2026-09-20T00:00:00.000Z" }); // same thread, forwarded/resent later
  const { needsReview, highConfidence } = matchTrackerToGmail([trackerRow()], [original, resend]);
  ok("1. two distinct messages to the same recipient is NEEDS_REVIEW, never an auto-pick", needsReview.length === 1 && highConfidence.length === 0);
  ok("2. the reason names both candidates so a human can choose", needsReview[0].candidates.length === 2);
}

console.log("\nF — date discrepancies: an existing tracker date_sent is never silently overwritten");
{
  const conflicting = matchTrackerToGmail([trackerRow({ date_sent: "2026-08-01T00:00:00.000Z" })], [gmailRow({ sent_at: "2026-09-15T10:00:00.000Z" })]);
  ok("1. a tracker row with its own conflicting date_sent is downgraded to NEEDS_REVIEW", conflicting.needsReview.length === 1 && conflicting.highConfidence.length === 0);
  ok("2. the reason names both the existing and the new date", /2026-08-01/.test(conflicting.needsReview[0].reason) && /2026-09-15/.test(conflicting.needsReview[0].reason));

  const agreeing = matchTrackerToGmail([trackerRow({ date_sent: "2026-09-15T09:00:00.000Z" })], [gmailRow({ sent_at: "2026-09-15T10:00:00.000Z" })]);
  ok("3. a date within the same day is NOT treated as a conflict", agreeing.highConfidence.length === 1);

  const neverRecorded = matchTrackerToGmail([trackerRow({ date_sent: null })], [gmailRow()]);
  ok("4. no existing date_sent at all is never a conflict", neverRecorded.highConfidence.length === 1);
}

console.log("\nG — missing subjects never crash the matcher and never block a clean match");
{
  const noSubjectEither = matchTrackerToGmail(
    [trackerRow({ subject: null })],
    [gmailRow({ subject: "" })]
  );
  ok("1. both subjects empty -> still a clean HIGH_CONFIDENCE match, no throw", noSubjectEither.highConfidence.length === 1);
}

console.log("\nH — ambiguous organizations");
{
  const conflictingOrg = matchTrackerToGmail(
    [trackerRow({ organization: "Acme Media" })],
    [gmailRow({ organization: "Completely Different Org" })]
  );
  ok("1. a real, disagreeing organization on the Gmail side downgrades to NEEDS_REVIEW", conflictingOrg.needsReview.length === 1 && conflictingOrg.highConfidence.length === 0);

  const noOrgOnGmailSide = matchTrackerToGmail([trackerRow({ organization: "Acme Media" })], [gmailRow({ organization: null })]);
  ok("2. a missing organization on the Gmail side ('where available') is never treated as a conflict", noOrgOnGmailSide.highConfidence.length === 1);

  const sharedToken = matchTrackerToGmail([trackerRow({ organization: "Acme Media Group" })], [gmailRow({ organization: "Acme Media" })]);
  ok("3. organizations sharing at least one real word are not flagged as conflicting", sharedToken.highConfidence.length === 1);
}

console.log("\nI — duplicate recipient email WITHIN the tracker itself");
{
  const rowA = trackerRow({ organization: "Org A" });
  const rowB = trackerRow({ organization: "Org B" }); // same email as rowA by mistake
  const { needsReview, highConfidence } = matchTrackerToGmail([rowA, rowB], [gmailRow()]);
  ok("1. both tracker rows sharing one recipient email are flagged, not auto-picked", needsReview.length === 2 && highConfidence.length === 0);
}

console.log("\nJ — buildReconciledRow() / buildProposedTracker()");
{
  const row = trackerRow({ known_status: null, notes: "Website: https://acme-media.org" });
  const g = gmailRow();
  const reconciled = buildReconciledRow(row, g);
  ok("1. date_sent/sender_account/source_record_ref are carried from the Gmail evidence", reconciled.date_sent === g.sent_at && reconciled.sender_account === g.sender_account && reconciled.source_record_ref === g.gmail_message_id);
  ok("2. known_status defaults to 'sent' only when the tracker row had none", reconciled.known_status === "sent");
  ok("3. existing notes are preserved, the Gmail thread is appended, never replaced", reconciled.notes.startsWith("Website:") && /thread-1/.test(reconciled.notes));
  ok("4. the ORIGINAL trackerRow is never mutated", row.date_sent === null && row.known_status === null);
  ok("5. never claims a delivery/engagement/response status beyond what Sent-folder evidence proves",
     !("deliveryStatus" in reconciled && reconciled.deliveryStatus === "DELIVERED")
     && !("engagementStatus" in reconciled) && !("responseStatus" in reconciled));
  ok("6. a tracker row with its OWN already-recorded known_status is never overwritten",
     buildReconciledRow(trackerRow({ known_status: "conversation" }), g).known_status === "conversation");

  const rowNoMatch = trackerRow({ organization: "Untouched Org", email: "nobody@nowhere.org" });
  const matchResult = matchTrackerToGmail([row, rowNoMatch], [g]);
  const proposed = buildProposedTracker([row, rowNoMatch], matchResult);
  ok("7. the resolved row is updated in the proposed tracker", proposed[0].date_sent === g.sent_at);
  ok("8. an unmatched row passes through completely unchanged (same reference, not a copy)", proposed[1] === rowNoMatch);
}

console.log("\nK — buildReconciliationReport()");
{
  const matched = trackerRow();
  const unmatched = trackerRow({ organization: "Nobody Org", email: "ghost@nowhere.org" });
  const gUnrepresented = gmailRow({ recipients: "extra@unlisted.org", gmail_message_id: "unlisted-1" });
  const g = gmailRow();
  const result = matchTrackerToGmail([matched, unmatched], [g, gUnrepresented]);
  const report = buildReconciliationReport([matched, unmatched], [g, gUnrepresented], result);
  ok("1. summary counts match the underlying classification exactly", report.summary.highConfidence === 1 && report.summary.noMatch === 1 && report.summary.needsReview === 0);
  ok("2. a Gmail message sent to nobody in the tracker is surfaced, not dropped", report.summary.unrepresentedGmailMessages === 1 && report.unrepresentedGmailMessages[0].recipients === "extra@unlisted.org");
}

console.log("\nL — flagPriorOutreachConflicts() (the AfriLabs-shaped case, generalized — not hardcoded to one org)");
{
  const afrilabsRow = trackerRow({ organization: "AfriLabs", email: "hello@afrilabs.com" });
  const previousOutreach = [{ organization: "AfriLabs", status: "SENT", instruction: "Use a new EOC thread only if appropriate; do not duplicate the earlier introduction." }];
  const conflicts = flagPriorOutreachConflicts([afrilabsRow, trackerRow({ organization: "Brand New Org" })], previousOutreach);
  ok("1. the real AfriLabs scenario is caught", conflicts.length === 1 && conflicts[0].row.organization === "AfriLabs");
  ok("2. it is reported, never resolved -- the row itself is untouched", conflicts[0].row === afrilabsRow);
  ok("3. the reason explicitly defers to a human", /human must decide/.test(conflicts[0].reason));
  ok("4. an unrelated organization with no prior-outreach history is not flagged", conflicts.every((c) => c.row.organization !== "Brand New Org"));
}

console.log("\nM — repeated runs are idempotent (and mutate nothing)");
{
  const rows = [trackerRow(), trackerRow({ organization: "Org 2", email: "second@org2.org" })];
  const gmail = [gmailRow(), gmailRow({ recipients: "second@org2.org", gmail_message_id: "msg-2" })];
  const snapshotRows = JSON.parse(JSON.stringify(rows));
  const snapshotGmail = JSON.parse(JSON.stringify(gmail));

  const run1 = matchTrackerToGmail(rows, gmail);
  const run2 = matchTrackerToGmail(rows, gmail);
  ok("1. two runs over the same input produce the same counts", run1.highConfidence.length === run2.highConfidence.length && run1.needsReview.length === run2.needsReview.length && run1.noMatch.length === run2.noMatch.length);
  ok("2. neither run mutated the tracker rows", JSON.stringify(rows) === JSON.stringify(snapshotRows));
  ok("3. neither run mutated the Gmail rows", JSON.stringify(gmail) === JSON.stringify(snapshotGmail));

  const report1 = buildReconciliationReport(rows, gmail, run1);
  const report2 = buildReconciliationReport(rows, gmail, run2);
  ok("4. the reconciliation report itself is identical across repeated runs", JSON.stringify(report1) === JSON.stringify(report2));
}

console.log("\nN — parseGmailMetadataRows() reuses import.js's existing parser (no second CSV/JSON parser declared)");
{
  const csv = "recipients,subject,sent_at,gmail_message_id,gmail_thread_id,sender_account\njane@acme.org,Hi,2026-09-15T10:00:00.000Z,m1,t1,admin@electioncanon.org";
  const parsedCsv = parseGmailMetadataRows(csv, "csv");
  ok("1. parses a CSV export", parsedCsv.valid && parsedCsv.rows[0].recipients === "jane@acme.org");

  const parsedJson = parseGmailMetadataRows([{ recipients: "jane@acme.org" }], "json");
  ok("2. parses a JSON array export", parsedJson.valid && parsedJson.rows[0].recipients === "jane@acme.org");

  ok("3. rejects an unknown format rather than guessing", parseGmailMetadataRows("x", "xml").valid === false);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
