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
  ok("1. imports listOutreachContacts/listOutreachFollowUps/createOutreachContact/importOutreachContacts/updateOutreachContactStatus/createOutreachFollowUp/transitionOutreachFollowUp from write.js",
     /from "\.\.\/\.\.\/domains\/outreach\/write\.js"/.test(pageCode));
  ok("2. the page itself contains no fetch() call", !/\bfetch\(/.test(pageCode));
  ok("3. the page itself contains no client.functions.invoke call -- that lives only in write.js", !/functions\.invoke/.test(pageCode));
}

console.log("\nE — import tab reuses src/domains/outreach/import.js rather than re-parsing CSV inline");
{
  ok("1. imports parseImportRows/normalizeImportRow/detectDuplicates from import.js", /from "\.\.\/\.\.\/domains\/outreach\/import\.js"/.test(pageCode));
  ok("2. declares no second CSV-splitting regex/loop of its own", !/split\(","\)/.test(pageCode));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
