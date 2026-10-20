// ============================================================
// OUTREACH ACTIVATION — LOCAL FILE-PROCESSING WRAPPER TESTS  (Phase 12)
// Covers: supabase/outreach-recovery/reconcile-tracker.mjs
//
// NOT wired into package.json's test chain yet -- consistent with how
// src/domains/outreach/reconcile.js's own test was kept isolated until
// reviewed. Run directly: node test/election-outreach-reconcile-cli.consumer.mjs
//
// Needs supabase/outreach-recovery/node_modules installed (its own,
// separate package.json -- `cd supabase/outreach-recovery && npm install`
// once) since this file exercises real .xlsx read/write via that tool's
// re-exported XLSX.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  XLSX, readTrackerWorkbook, mapTrackerRow, mapPreviousOutreachRow, validateGmailMetadataRows,
  buildDryRunSummary, buildReportRows, reportRowsToCsv, buildProposedWorkbook, main,
} from "../supabase/outreach-recovery/reconcile-tracker.mjs";
import { matchTrackerToGmail, flagPriorOutreachConflicts, parseGmailMetadataRows } from "../src/domains/outreach/reconcile.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — local file-processing wrapper (reconcile-tracker.mjs)\n");

// ---------- fixture workbook ----------

const SUPER_TRACKER_ROWS = [
  { "Organisation": "Clean Org", "Category": "Observation", "Contact Person / Route": "A Person", "Email / Route": "clean@cleanorg.org", "Website": "", "Proposition": "", "Priority": "A", "Date Planned": "01-Oct-2026", "Date Sent": "", "Status": "READY", "Response": "", "Next Action": "", "Follow-up Date": "", "Meeting Date": "", "Contribution / Partnership Type": "", "Verification Notes": "" },
  { "Organisation": "Ambiguous Org A", "Category": "Industry", "Contact Person / Route": "", "Email / Route": "ambiguous@dup.org", "Website": "", "Proposition": "", "Priority": "B", "Date Planned": "01-Oct-2026", "Date Sent": "", "Status": "READY", "Response": "", "Next Action": "", "Follow-up Date": "", "Meeting Date": "", "Contribution / Partnership Type": "", "Verification Notes": "" },
  { "Organisation": "Ambiguous Org B", "Category": "Industry", "Contact Person / Route": "", "Email / Route": "ambiguous@dup.org", "Website": "", "Proposition": "", "Priority": "B", "Date Planned": "01-Oct-2026", "Date Sent": "", "Status": "READY", "Response": "", "Next Action": "", "Follow-up Date": "", "Meeting Date": "", "Contribution / Partnership Type": "", "Verification Notes": "" },
  { "Organisation": "NoMatch Org", "Category": "Development", "Contact Person / Route": "", "Email / Route": "nomatch@nowhere.org", "Website": "", "Proposition": "", "Priority": "C", "Date Planned": "01-Oct-2026", "Date Sent": "", "Status": "READY", "Response": "", "Next Action": "", "Follow-up Date": "", "Meeting Date": "", "Contribution / Partnership Type": "", "Verification Notes": "" },
  { "Organisation": "AfriLabs", "Category": "Industry", "Contact Person / Route": "", "Email / Route": "hello@afrilabs.com", "Website": "", "Proposition": "", "Priority": "A", "Date Planned": "01-Oct-2026", "Date Sent": "", "Status": "READY", "Response": "", "Next Action": "", "Follow-up Date": "", "Meeting Date": "", "Contribution / Partnership Type": "", "Verification Notes": "" },
];
const SEND_PLAN_ROWS = [{ "Date": "Mon 28 Sep 2026", "Wave": "1 — Observation", "Targets": "1 org", "Objective": "test" }];
const CONTACT_SOURCE_NOTES_ROWS = SUPER_TRACKER_ROWS.map((r) => ({ "Organisation": r["Organisation"], "Official route": r["Email / Route"], "Verification note": "test note" }));
const PREVIOUS_OUTREACH_ROWS = [{ "Organisation": "AfriLabs", "Status": "SENT", "Instruction": "Use a new EOC thread only if appropriate; do not duplicate the earlier introduction." }];

function buildFixtureWorkbook(sheets = {}) {
  const wb = XLSX.utils.book_new();
  const data = {
    "SUPER TRACKER": "superTracker" in sheets ? sheets.superTracker : SUPER_TRACKER_ROWS,
    "SEND PLAN": "sendPlan" in sheets ? sheets.sendPlan : SEND_PLAN_ROWS,
    "CONTACT SOURCE NOTES": "contactSourceNotes" in sheets ? sheets.contactSourceNotes : CONTACT_SOURCE_NOTES_ROWS,
    "PREVIOUS OUTREACH": "previousOutreach" in sheets ? sheets.previousOutreach : PREVIOUS_OUTREACH_ROWS,
  };
  for (const [name, rows] of Object.entries(data)) {
    if (rows === null) continue; // allows a test to omit a sheet entirely
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  return wb;
}

const GMAIL_CSV = [
  "recipients,subject,sent_at,gmail_message_id,gmail_thread_id,sender_account",
  "clean@cleanorg.org,Launch outreach,2026-09-15T10:00:00.000Z,msg-clean,thread-clean,admin@electioncanon.org",
  "clean@cleanorg.org,Launch outreach,2026-09-15T10:00:00.000Z,msg-clean,thread-clean,admin@electioncanon.org", // exact duplicate export row
  "ambiguous@dup.org,Launch outreach,2026-09-16T10:00:00.000Z,msg-ambiguous,thread-ambiguous,sotinnovate@gmail.com",
  "hello@afrilabs.com,ElectionCanon follow-up,2026-09-17T10:00:00.000Z,msg-afrilabs,thread-afrilabs,sotinnovate@gmail.com",
].join("\n");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "outreach-reconcile-cli-test-"));
const TRACKER_PATH = path.join(TMP_DIR, "tracker.xlsx");
const GMAIL_PATH = path.join(TMP_DIR, "gmail-export.csv");

try {
  XLSX.writeFile(buildFixtureWorkbook(), TRACKER_PATH);
  fs.writeFileSync(GMAIL_PATH, GMAIL_CSV, "utf8");
  const sourceBytesBefore = fs.readFileSync(TRACKER_PATH);

  console.log("A — readTrackerWorkbook(): all four sheets, deliberately");
  {
    const result = readTrackerWorkbook(TRACKER_PATH);
    ok("1. a well-formed workbook reads as valid", result.valid === true);
    ok("2. SUPER TRACKER rows are read", result.sheets.superTrackerRaw.length === 5);
    ok("3. SEND PLAN rows are read separately, not merged into SUPER TRACKER", result.sheets.sendPlanRaw.length === 1 && !("Wave" in result.sheets.superTrackerRaw[0]));
    ok("4. CONTACT SOURCE NOTES rows are read separately", result.sheets.contactSourceNotesRaw.length === 5);
    ok("5. PREVIOUS OUTREACH rows are read separately", result.sheets.previousOutreachRaw.length === 1);

    ok("6. a nonexistent file is reported clearly, not thrown", readTrackerWorkbook(path.join(TMP_DIR, "nope.xlsx")).valid === false);

    const noPrevOutreachPath = path.join(TMP_DIR, "missing-sheet.xlsx");
    XLSX.writeFile(buildFixtureWorkbook({ previousOutreach: null }), noPrevOutreachPath);
    const missingSheetResult = readTrackerWorkbook(noPrevOutreachPath);
    ok("7. a workbook missing a required sheet is rejected and names it", missingSheetResult.valid === false && /PREVIOUS OUTREACH/.test(missingSheetResult.error));

    const emptyTrackerPath = path.join(TMP_DIR, "empty-tracker.xlsx");
    XLSX.writeFile(buildFixtureWorkbook({ superTracker: [{ "Organisation": "" }].slice(0, 0) }), emptyTrackerPath);
    // json_to_sheet([]) produces a sheet with no rows at all
    const emptyResult = readTrackerWorkbook(emptyTrackerPath);
    ok("8. an empty SUPER TRACKER is rejected, not silently processed as zero rows", emptyResult.valid === false);
  }

  console.log("\nB — mapTrackerRow(): READY is never promoted to a recorded status; Date Planned never leaks into date_sent");
  {
    const mapped = mapTrackerRow(SUPER_TRACKER_ROWS[0]);
    ok("1. 'READY' (a planning label) does not become known_status", mapped.known_status === null);
    ok("2. Date Planned is never read as date_sent", mapped.date_sent === null);
    const withRealDateSent = mapTrackerRow({ ...SUPER_TRACKER_ROWS[0], "Date Sent": "15-Sep-2026", "Status": "Responded" });
    ok("3. an ACTUAL recognized status is carried through", withRealDateSent.known_status === "RESPONDED");
    ok("4. an actual Date Sent value IS carried through", withRealDateSent.date_sent === "15-Sep-2026");
  }

  console.log("\nC — validateGmailMetadataRows(): malformed export rows are caught, not silently accepted");
  {
    const parsed = parseGmailMetadataRows(GMAIL_CSV, "csv");
    ok("1. the CSV fixture itself parses", parsed.valid === true);
    ok("2. a well-formed export validates clean", validateGmailMetadataRows(parsed.rows).valid === true);

    const missingField = parsed.rows.map((r, i) => (i === 0 ? { ...r, sender_account: "" } : r));
    const badValidation = validateGmailMetadataRows(missingField);
    ok("3. a row missing a required field is flagged by name", badValidation.valid === false && /sender_account/.test(badValidation.errors[0]));

    ok("4. empty CSV text is rejected by the parser, not silently treated as zero rows", parseGmailMetadataRows("", "csv").valid === false);
  }

  console.log("\nD — end-to-end matching through the real tracker-shaped fixture");
  {
    const trackerResult = readTrackerWorkbook(TRACKER_PATH);
    const mappedTracker = trackerResult.sheets.superTrackerRaw.map(mapTrackerRow);
    const previousOutreach = trackerResult.sheets.previousOutreachRaw.map(mapPreviousOutreachRow);
    const parsedGmail = parseGmailMetadataRows(GMAIL_CSV, "csv");
    const matchResult = matchTrackerToGmail(mappedTracker, parsedGmail.rows);
    const priorConflicts = flagPriorOutreachConflicts(mappedTracker, previousOutreach);

    ok("1. Clean Org matches HIGH_CONFIDENCE", matchResult.highConfidence.some((m) => m.row.organization === "Clean Org"));
    ok("2. the duplicated Gmail export row (same message id) did NOT cause a false multi-candidate flag for Clean Org", !matchResult.needsReview.some((e) => e.row.organization === "Clean Org"));
    ok("3. both Ambiguous Org rows (shared tracker email) are NEEDS_REVIEW", matchResult.needsReview.filter((e) => /Ambiguous Org/.test(e.row.organization)).length === 2);
    ok("4. NoMatch Org is NO_MATCH", matchResult.noMatch.some((e) => e.row.organization === "NoMatch Org"));
    ok("5. AfriLabs still matches HIGH_CONFIDENCE on its own Gmail evidence", matchResult.highConfidence.some((m) => m.row.organization === "AfriLabs"));
    ok("6. AfriLabs is ALSO flagged as a prior-outreach conflict, independent of the match", priorConflicts.some((c) => c.row.organization === "AfriLabs"));
    ok("7. the conflict is reported, not resolved -- AfriLabs is still exactly the row that matched", priorConflicts.find((c) => c.row.organization === "AfriLabs").row === matchResult.highConfidence.find((m) => m.row.organization === "AfriLabs").row);

    const summary = buildDryRunSummary(mappedTracker, parsedGmail.rows, matchResult, priorConflicts);
    ok("8. the dry-run summary's counts add up to every tracker row exactly once", summary.highConfidence + summary.needsReview + summary.noMatch === summary.trackerRows);

    const reportRows = buildReportRows(matchResult, priorConflicts);
    ok("9. the report contains one row per tracker row", reportRows.length === mappedTracker.length);
    const afrilabsReportRow = reportRows.find((r) => r.organization === "AfriLabs");
    ok("10. the AfriLabs report row carries BOTH facts -- it is HIGH_CONFIDENCE AND flags the prior-outreach conflict in its reason", afrilabsReportRow.category === "HIGH_CONFIDENCE" && /PRIOR_OUTREACH_CONFLICT/.test(afrilabsReportRow.reason));

    const csv = reportRowsToCsv(reportRows);
    ok("11. the CSV serialization includes every category", ["HIGH_CONFIDENCE", "NEEDS_REVIEW", "NO_MATCH"].every((c) => csv.includes(c)));

    console.log("\nE — buildProposedWorkbook(): additive only, other sheets untouched");
    {
      const proposed = buildProposedWorkbook(trackerResult.workbook, trackerResult.sheets.superTrackerRaw, matchResult, priorConflicts);
      ok("1. SEND PLAN is the SAME sheet object, not rebuilt", proposed.Sheets["SEND PLAN"] === trackerResult.workbook.Sheets["SEND PLAN"]);
      ok("2. CONTACT SOURCE NOTES is the SAME sheet object, not rebuilt", proposed.Sheets["CONTACT SOURCE NOTES"] === trackerResult.workbook.Sheets["CONTACT SOURCE NOTES"]);
      ok("3. PREVIOUS OUTREACH is the SAME sheet object, not rebuilt", proposed.Sheets["PREVIOUS OUTREACH"] === trackerResult.workbook.Sheets["PREVIOUS OUTREACH"]);

      const proposedRows = XLSX.utils.sheet_to_json(proposed.Sheets["SUPER TRACKER"], { defval: "" });
      const cleanRow = proposedRows.find((r) => r.Organisation === "Clean Org");
      const ambiguousRow = proposedRows.find((r) => r.Organisation === "Ambiguous Org A");
      const noMatchRow = proposedRows.find((r) => r.Organisation === "NoMatch Org");

      ok("4. a HIGH_CONFIDENCE row's Date Sent is proposed", cleanRow["Date Sent"] === "15-Sep-2026");
      ok("5. a HIGH_CONFIDENCE row's Status becomes SENT", cleanRow["Status"] === "SENT");
      ok("6. a NEEDS_REVIEW row's Date Sent is left EXACTLY as the original (blank)", ambiguousRow["Date Sent"] === "");
      ok("7. a NEEDS_REVIEW row's Status is left EXACTLY as the original ('READY'), never promoted", ambiguousRow["Status"] === "READY");
      ok("8. a NO_MATCH row's Status is likewise untouched", noMatchRow["Status"] === "READY");
      ok("9. every row gets an informational Reconciliation Note, even unresolved ones", ambiguousRow["Reconciliation Note"].length > 0 && noMatchRow["Reconciliation Note"].length > 0);
      ok("10. this never sets any delivery/engagement/response status field on any row", proposedRows.every((r) => !("Delivery Status" in r) && !("Engagement Status" in r) && !("Response Status" in r)));
    }
  }

  console.log("\nF — main(): dry-run, file output separation, source preservation, repeated runs");
  {
    const dryRunCode = await main(["--tracker", TRACKER_PATH, "--gmail", GMAIL_PATH, "--outDir", TMP_DIR, "--dry-run"]);
    ok("1. --dry-run exits clean", dryRunCode === 0);
    ok("2. --dry-run writes nothing", !fs.existsSync(path.join(TMP_DIR, "reconciliation-report.csv")));

    const code1 = await main(["--tracker", TRACKER_PATH, "--gmail", GMAIL_PATH, "--outDir", TMP_DIR]);
    ok("3. a real run exits clean", code1 === 0);
    const reportPath = path.join(TMP_DIR, "reconciliation-report.csv");
    const trackerOutPath = path.join(TMP_DIR, "proposed-tracker.xlsx");
    ok("4. the report file was written", fs.existsSync(reportPath));
    ok("5. the proposed tracker file was written, at a DIFFERENT path than the source", fs.existsSync(trackerOutPath) && path.resolve(trackerOutPath) !== path.resolve(TRACKER_PATH));

    const sourceBytesAfter = fs.readFileSync(TRACKER_PATH);
    ok("6. the SOURCE tracker file is byte-for-byte unchanged after a real run", Buffer.compare(sourceBytesBefore, sourceBytesAfter) === 0);

    const refusedCode = await main(["--tracker", TRACKER_PATH, "--gmail", GMAIL_PATH, "--outDir", TMP_DIR, "--trackerOutName", path.basename(TRACKER_PATH)]);
    ok("7. an attempt to write the proposed tracker OVER the source path is refused", refusedCode === 1);
    const sourceBytesAfterRefusal = fs.readFileSync(TRACKER_PATH);
    ok("8. ...and the source file is still untouched even after that refusal", Buffer.compare(sourceBytesBefore, sourceBytesAfterRefusal) === 0);

    const reportContentsAfterFirstRun = fs.readFileSync(reportPath, "utf8");
    const code2 = await main(["--tracker", TRACKER_PATH, "--gmail", GMAIL_PATH, "--outDir", TMP_DIR]);
    const reportContentsAfterSecondRun = fs.readFileSync(reportPath, "utf8");
    ok("9. repeated runs are idempotent -- the report is byte-identical the second time", code2 === 0 && reportContentsAfterFirstRun === reportContentsAfterSecondRun);
  }
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
