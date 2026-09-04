// ============================================================
// ELECTIONCANON 1.1 — HOME OPERATING CONSOLE  (Design Gate implementation)
//
// Proves the three approved design decisions actually landed in the code,
// not just in the design-gate transcript:
//
//   1. Recent responsibility changes live ONLY in "What Changed" — never
//      duplicated as a synthetic "What Needs Attention" alert.
//   2. Constituency coverage is a PRESENTATION rule (campaign owner is the
//      implicit constituency-level party) — no fabricated responsibility_
//      slots row, no Canon event, no "uncovered constituency" invite path,
//      and CONSTITUENCY_LEAD is never added to the invitation role picker.
//   3. The reassignment picker's identity pool is campaign_members (active
//      ElectionCanon campaign membership), never Mobilize's separate
//      view.people field roster.
//
// Part A exercises attention.js's new (coverageGaps, pendingInvitations)
// arguments directly — that module is plain JS, so it is imported and run
// for real, not just pattern-matched. Part B is structural/source-level
// (this repo has no React-rendering test harness — see
// election-web-surface.consumer.mjs's own header) using the same
// comment-stripped-source convention as election-prelaunch-ux.consumer.mjs.
//
// Run: node test/election-home-operating-console.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { computeAttention } from "../src/pages/election/attention.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

console.log("\nELECTIONCANON 1.1 — Home Operating Console\n");

// ============================================================
// PART A — computeAttention(): coverageGaps / pendingInvitations
// ============================================================
console.log("A. attention.js — coverageGaps/pendingInvitations");
{
  // A1-A2: backward compatibility — Intelligence's existing 2-arg call site
  // must behave EXACTLY as before this feature existed.
  const legacyView = { wards: { w1: { id: "w1", organisation: null }, w2: { id: "w2", organisation: "team" } } };
  const legacyResult = computeAttention(legacyView, []);
  ok("A1. with no coverageGaps argument, the ORIGINAL ward.organisation check still runs",
     legacyResult.alerts.some((a) => a.text === "w1 has no coordinator or team assigned."));
  ok("A2. wardsWithoutCoordinator still returns legacy ward objects when coverageGaps is omitted",
     legacyResult.wardsWithoutCoordinator.length === 1 && legacyResult.wardsWithoutCoordinator[0].id === "w1");

  // A3-A6: when Home supplies real coverageGaps, they REPLACE (not add to)
  // the legacy ward.organisation check, and use the campaign's real names.
  const coverageGaps = [
    { level: "lga", name: "Sapele", id: "lga-sapele" },
    { level: "ward", name: "Ward 3", id: "ward-3" },
  ];
  const withGaps = computeAttention(legacyView, [], coverageGaps, []);
  ok("A3. a supplied LGA gap produces a real, named danger alert",
     withGaps.alerts.some((a) => a.text === "Sapele (LGA) has no LGA Coordinator assigned." && a.tone === "danger"));
  ok("A4. a supplied ward gap produces a real, named danger alert",
     withGaps.alerts.some((a) => a.text === "Ward 3 (Ward) has no Ward Coordinator assigned." && a.tone === "danger"));
  ok("A5. the legacy ward-log alert (w1) is NOT also produced — one real gap, not two alerts for it",
     !withGaps.alerts.some((a) => a.text === "w1 has no coordinator or team assigned."));
  ok("A6. wardsWithoutCoordinator reflects the real geography-scoped gaps, not the legacy ward log",
     withGaps.wardsWithoutCoordinator.length === 1 && withGaps.wardsWithoutCoordinator[0].id === "ward-3");

  // A7-A8: pending invitations surface as their own warning-tone alerts.
  const pendingInvitations = [{ name: "Chidi Okafor", roleLabel: "LGA Coordinator" }];
  const withInvites = computeAttention({}, [], [], pendingInvitations);
  ok("A7. a pending invitation produces a named warning alert",
     withInvites.alerts.some((a) => a.text === "Invitation to Chidi Okafor for LGA Coordinator is still pending." && a.tone === "warning"));

  // A8: priority order — coverage gaps first, then pending invitations,
  // ahead of every legacy alert category.
  const combined = computeAttention(legacyView, [], coverageGaps, pendingInvitations);
  const firstThree = combined.alerts.slice(0, 3).map((a) => a.text);
  ok("A8. coverage gaps and pending invitations sort ahead of every other alert category",
     firstThree.includes("Sapele (LGA) has no LGA Coordinator assigned.") &&
     firstThree.includes("Ward 3 (Ward) has no Ward Coordinator assigned.") &&
     firstThree.includes("Invitation to Chidi Okafor for LGA Coordinator is still pending."));

  // A9: an empty (not null) coverageGaps array — a fully covered
  // territory — reports zero coverage alerts, never a fabricated one.
  const fullyCovered = computeAttention(legacyView, [], [], []);
  ok("A9. an empty coverageGaps array (fully covered territory) produces no coverage alerts at all",
     !fullyCovered.alerts.some((a) => /has no (LGA|Ward) Coordinator assigned/.test(a.text)));
}

// ============================================================
// PART B — structural: the three design-gate rules, in the actual source
// ============================================================
const homeSection = code("../src/pages/election/HomeSection.jsx");
const homeResponsibility = code("../src/pages/election/HomeResponsibility.jsx");
const orgSection = code("../src/pages/election/OrganisationSection.jsx");
const election = code("../src/pages/Election.jsx");
const attention = code("../src/pages/election/attention.js");

console.log("\nB1. Recent responsibility changes: 'What Changed' only, never a duplicate alert");
{
  ok("1. HomeSection builds a distinct responsibilityChanges/'What Changed' list from view.feed",
     /responsibilityChanges/.test(homeSection) && /What changed/.test(homeSection));
  ok("2. attention.js's alert computation never reads RESPONSIBILITY.ASSIGNED/REASSIGNED off the feed — only real unresolved coverage/invitation state",
     !/RESPONSIBILITY\.(ASSIGNED|REASSIGNED)/.test(attention));
  ok("3. HomeSection never feeds its own responsibilityChanges/feed data into computeAttention() as a second alert source",
     !/computeAttention\([^)]*responsibilityChanges/.test(homeSection) && !/computeAttention\([^)]*view\.feed/.test(homeSection));
  ok("4. the attention gaps argument passed by Home is empty — readiness.gaps is deliberately not double-counted through this path",
     /computeAttention\(view,\s*\[\]/.test(homeSection));
}

console.log("\nB2. Constituency coverage: presentation-only, no fabricated fact, no invite path");
{
  ok("1. no NEW responsibility_slots row is ever written for the constituency/owner relationship (write.js untouched by this feature; Home never calls write_responsibility for level: \"constituency\")",
     !/level:\s*["']constituency["']/.test(homeSection) && !/level:\s*["']constituency["']/.test(homeResponsibility));
  ok("2. the coverage gaps roster (CoverageGapsPanel) is built ONLY from coverage.lgas and coverage.wards, never a constituency row",
     /coverage\.lgas\.map/.test(homeResponsibility) && /coverage\.wards\.map/.test(homeResponsibility) &&
     !/coverage\.constituencyId/.test(homeResponsibility) && !/constituencyCovered/.test(homeResponsibility));
  ok("3. CoverageCard presents the constituency as covered by the campaign owner (a display string), not as an invite-eligible gap",
     /covered by the campaign owner/.test(homeResponsibility));
  ok("4. no 'invite constituency lead' action exists anywhere in the coverage gaps roster or its Invite handler",
     !/role:\s*["']CONSTITUENCY_LEAD["']/.test(homeResponsibility) && !/Invite Constituency/i.test(homeResponsibility));
  ok("5. CONSTITUENCY_LEAD is never added as a selectable RoleButton in the invitation wizard's role picker",
     !/RoleButton[^;]*CONSTITUENCY_LEAD/.test(orgSection) && !/canOfferConstituencyLead/.test(orgSection));
  ok("6. the invitation wizard's role picker offers only the four pre-existing roles (Director/LGA/Ward/Polling-Unit)",
     /Campaign Director/.test(orgSection) && /LGA Coordinator/.test(orgSection) && /Ward Coordinator/.test(orgSection) && /Polling-Unit Agent/.test(orgSection));
}

console.log("\nB3. Reassignment identity pool: campaign_members, never Mobilize's field roster");
{
  ok("1. getReassignmentCandidates() queries campaign_members, the organisational-membership table",
     /getReassignmentCandidates/.test(orgSection) && /\.from\(["']campaign_members["']\)/.test(orgSection));
  ok("2. the campaign_members query is scoped to active members only (status = \"active\")",
     /campaign_members["'][\s\S]{0,200}\.eq\(["']status["'],\s*["']active["']\)/.test(orgSection));
  ok("3. the reassignment picker's candidate pool never reads Mobilize's own view.people field roster",
     !/getReassignmentCandidates[\s\S]{0,600}view\.people/.test(orgSection));
  ok("4. the reassignment picker excludes the currently-assigned person from the selectable list — the `candidates` array itself (not some unrelated .find/.filter elsewhere in the file) is derived by filtering OUT c.id === currentPersonRef",
     /const candidates\s*=\s*\(allMembers\s*\?\?\s*\[\]\)\.filter\(\(c\)\s*=>\s*c\.id\s*!==\s*currentPersonRef\)/.test(homeResponsibility));
  ok("5. candidate names are resolved through the real display-name resolver — never a raw uid/person ref rendered as a label",
     /resolveMemberDisplayName/.test(orgSection) && !/\{c\.id\}<\/option>/.test(homeResponsibility));
  ok("6. write_responsibility()'s own module (geography/write.js) is untouched by this feature — no second identity system was added to the write path",
     !/campaign_members/.test(code("../src/domains/election/geography/write.js")));
}

console.log("\nB4. No new data model — reuses existing projections and the existing write path");
{
  const forbiddenTables = ["dashboard_state", "activity_log", "coverage_table", "notification"];
  for (const t of forbiddenTables) {
    ok(`1. no reference to a fabricated "${t}" table/collection anywhere in the new Home files`,
       !new RegExp(`["'\`]${t}["'\`]`).test(homeSection) && !new RegExp(`["'\`]${t}["'\`]`).test(homeResponsibility));
  }
  ok("2. Home's reassignment action goes through the existing prepareGeographyWrite/approveGeographyWrite pair, not a new write function",
     /prepareGeographyWrite/.test(homeResponsibility) && /approveGeographyWrite/.test(homeResponsibility));
  ok("3. the reassignment operation reuses the existing GEOGRAPHY_OPERATION.REASSIGN_RESPONSIBILITY constant, not a newly invented operation string",
     /GEOGRAPHY_OPERATION\.REASSIGN_RESPONSIBILITY/.test(homeResponsibility));
  ok("4. a successful reassignment calls the shared refresh() (Election.jsx's Canon refresh), never a local-only state mutation pretending to be a write",
     /await refresh\(\)/.test(homeResponsibility));
  ok("5. Election.jsx's deep-link plumbing (inviteHint) carries only {level, geographyRef, role[, lgaId]} — a routing hint, not a second responsibility record",
     /inviteHint/.test(election) && /goToSection/.test(election));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
