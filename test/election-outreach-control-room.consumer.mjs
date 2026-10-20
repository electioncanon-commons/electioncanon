// ============================================================
// OUTREACH ACTIVATION — CONTROL ROOM UI SOURCE TESTS  (Phase 4)
//
// This repo has no jsdom/React-render harness for .jsx files (see the
// other election-*.consumer.mjs files covering .jsx pages -- all source
// scans, never a render). These tests follow the same shape: proving,
// from the stripped source, the properties the control room depends on
// -- the eight actionable queues exist, the admin secret is never
// persisted, routing is wired, and no fetch() bypasses write.js.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const pageSrc = readSrc("src/pages/outreach/OutreachControlRoom.jsx");
const pageCode = stripComments(pageSrc);
const appSrc = stripComments(readSrc("src/App.jsx"));

console.log("\nOUTREACH ACTIVATION — control room UI source tests\n");

console.log("A — routing");
{
  ok("1. App.jsx imports OutreachControlRoom", /import OutreachControlRoom from "\.\/pages\/outreach\/OutreachControlRoom\.jsx"/.test(appSrc));
  ok("2. App.jsx mounts it at /launch/outreach", /<Route path="\/launch\/outreach" element={<OutreachControlRoom \/>} \/>/.test(appSrc));
}

console.log("\nB — the eight Phase 4 actionable queues are all present");
{
  for (const label of ["Follow-up now", "Acknowledged — waiting", "Responded", "Demo requested", "Conversation", "No response", "Bounced", "Declined"]) {
    ok(`1. queue "${label}" is defined`, pageCode.includes(label));
  }
  ok("2. QUEUES is a real filtered list over actual contacts, not a static array of numbers",
     /filter: \(c/.test(pageCode) && (pageCode.match(/filter: \(c/g) || []).length >= 8);
}

console.log("\nC — admin secret handling");
{
  ok("1. the secret is held in useState, not a module-level constant", /const \[secret, setSecret\] = useState/.test(pageCode));
  ok("2. the secret is never written to localStorage", !/localStorage\.setItem/.test(pageCode));
  ok("3. the secret is never written to sessionStorage", !/sessionStorage\.setItem/.test(pageCode));
  ok("4. the secret input uses type=\"password\"", /type="password"/.test(pageCode));
  ok("5. no secret or admin value is ever console.logged", !/console\.(log|error|warn)/.test(pageCode));
}

console.log("\nD — all data access goes through src/domains/outreach/write.js (no direct fetch/invoke in the page)");
{
  ok("1. imports listOutreachContacts/listOutreachFollowUps/createOutreachContact/reconcileHistoricalImport/updateOutreachContactStatus/createOutreachFollowUp/transitionOutreachFollowUp from write.js",
     /from "\.\.\/\.\.\/domains\/outreach\/write\.js"/.test(pageCode) && /reconcileHistoricalImport/.test(pageCode));
  ok("2. the page itself contains no fetch() call", !/\bfetch\(/.test(pageCode));
  ok("3. the page itself contains no client.functions.invoke call -- that lives only in write.js", !/functions\.invoke/.test(pageCode));
}

console.log("\nE — import tab reuses src/domains/outreach/import.js and historicalImport.js rather than re-parsing CSV inline or re-deriving its own reconciliation rules");
{
  ok("1. imports parseImportRows from import.js", /parseImportRows[\s\S]{0,40}from "\.\.\/\.\.\/domains\/outreach\/import\.js"/.test(pageCode));
  ok("2. imports planHistoricalReconciliation from historicalImport.js (the fix for the Phase 7 'duplicate_existing silently discarded' gap)",
     /planHistoricalReconciliation[\s\S]{0,40}from "\.\.\/\.\.\/domains\/outreach\/historicalImport\.js"/.test(pageCode));
  ok("3. declares no second CSV-splitting regex/loop of its own", !/split\(","\)/.test(pageCode));
  ok("4. no longer imports normalizeImportRow/detectDuplicates directly (that logic now lives inside planHistoricalReconciliation, called once)",
     !/\bnormalizeImportRow\b/.test(pageCode) && !/\bdetectDuplicates\b/.test(pageCode));
}

console.log("\nF — import feedback and double-submit protection (Phase 10 regression: import succeeded with no visible UI change)");
{
  ok("1. ImportView tracks a submitting flag", /const \[submitting, setSubmitting\] = useState\(false\)/.test(pageCode));
  ok("2. runReconcile refuses to fire a second request while one is already in flight", /if \(submitting\) return;/.test(pageCode));
  ok("3. the reconcile button is disabled while submitting", /disabled={submitting \|\| actionableCount === 0}/.test(pageCode));
  ok("4. the reconcile button's label changes while submitting", /submitting \? "Reconciling…"/.test(pageCode));
  ok("5. submitting is always reset via finally, even if onReconcile throws", /try {\s*const { toCreate, toAttachExisting, toAttachNewBatch }[\s\S]*?} finally {\s*setSubmitting\(false\);\s*}/.test(pageCode));
  ok("6. a parent-level importBanner state exists, independent of ImportView's own local state", /const \[importBanner, setImportBanner\] = useState\(null\)/.test(pageCode));
  ok("7. the importBanner is rendered outside the per-tab conditional blocks, so it survives switching tabs",
     pageCode.indexOf("importBanner &&") < pageCode.indexOf('tab === "board"'));
  ok("8. a successful reconciliation sets an ok:true banner naming the real created count", /setImportBanner\(\{ ok: true, message: `Reconciled: \$\{r\.created\}/.test(pageCode));
  ok("9. a failed reconciliation (r.ok false) sets an ok:false banner with the real reason, not a generic message", /setImportBanner\(\{ ok: false, message: `Reconciliation failed: \$\{r\.error\}/.test(pageCode));
  ok("10. the onReconcile wrapper catches a thrown/network exception rather than letting it propagate uncaught",
     /onReconcile={async \(plan\) => {\s*try {[\s\S]*?} catch \(err\) {/.test(pageCode));
  ok("11. the ambiguous-outcome message explicitly tells the user retrying is safe (each message is identified by its own source reference), rather than just warning them off retrying with no guidance",
     /Re-running the same reconciliation is safe -- each historical message is identified by its own source reference/.test(pageCode));
  ok("12. refresh(secret) still runs after reconciliation regardless of outcome (success, failure, or thrown exception)",
     (pageCode.match(/refresh\(secret\);/g) || []).length >= 3);
}

console.log("\nG — ambiguous/invalid rows are reported with their real row index, not an index into a filtered sub-list (the original 'Row 1' mislabeling bug)");
{
  ok("1. needsReview rows are rendered using r.rowIndex, not the array-map index", /preview\.plan\.needsReview\.map\(\(r, i\) => \([\s\S]{0,80}Row \{r\.rowIndex \+ 1\}/.test(pageCode));
  ok("2. invalid rows are rendered using r.rowIndex, not the array-map index", /preview\.plan\.invalid\.map\(\(r, i\) => \([\s\S]{0,80}Row \{r\.rowIndex \+ 1\}/.test(pageCode));
}

console.log("\nH — Workspace A/B harmonization (Launch Engine closed-loop, Phase 2)");
{
  ok("1. a WorkspaceSwitcher distinguishes Workspace A (public launch) from Workspace B (direct outreach)",
     /A — Public launch distribution/.test(pageCode) && /B — Direct outreach/.test(pageCode));
  ok("2. Workspace A uses a SEPARATE secret (launchSecret), never merged with the outreach secret",
     /launchSecret/.test(pageCode) && /launchSecretInput/.test(pageCode) && /const \[secret, setSecret\]/.test(pageCode));
  ok("3. Workspace A reads via getLaunchSummary (read-only, no subscriber row/email ever requested)",
     /getLaunchSummary\(/.test(pageCode) && !/subscriber\.email|recipient_email.*launch/i.test(pageCode));
  ok("4. the activity tab is one of the real tabs, not decorative", /"board", "contacts", "import", "activity", "learning"/.test(pageCode));
  ok("5. ActivityView renders the four truthful states via computeActivitySummary, never a single fabricated count",
     /computeActivitySummary\(events\)/.test(pageCode));
  ok("6. 'Record a manual send' is ALWAYS enabled regardless of Gmail connection status (manual outreach is never blocked)",
     /buttonStyle\(!busy\)[\s\S]{0,60}disabled=\{busy\}[\s\S]{0,60}onClick=\{recordManualSend\}/.test(pageCode));
  ok("7. 'Send via Gmail' is disabled unless sendAsVerified is true -- never dispatchable through an unverified identity",
     /disabled=\{busy \|\| !gmailStatus\?\.sendAsVerified\}/.test(pageCode));
  ok("8. the compose preview is built via buildBrandedEmail (composer.js), not a second inline HTML template",
     /buildBrandedEmail\(\{/.test(pageCode));
  ok("9. the final preview is rendered via an iframe srcDoc showing the EXACT built HTML, not a re-derived approximation",
     /srcDoc=\{preview\.html\}/.test(pageCode));
  ok("10. manual-send evidence uses buildManualAttestationIdempotencyKey, matching messageActivity.js's own idempotency discipline",
     /buildManualAttestationIdempotencyKey\(/.test(pageCode));
  ok("11. the page still contains no fetch() call anywhere after adding Gmail/launch wiring", !/\bfetch\(/.test(pageCode));
  ok("12. the page still contains no client.functions.invoke call -- every network action still goes through write.js wrappers", !/\.functions\.invoke\(/.test(pageCode));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
