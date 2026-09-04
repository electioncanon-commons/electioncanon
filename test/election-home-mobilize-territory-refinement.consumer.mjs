// ============================================================
// ELECTIONCANON 1.1.1 PHASE B — HOME / MOBILIZE / TERRITORY REFINEMENT
//
// Structural/source-level (this repo has no React-rendering harness — see
// election-web-surface.consumer.mjs's own header). Proves the approved
// Phase B scope: Home's attention section is positioned before secondary
// Coverage/MyScope content and its actionable items reuse the EXISTING
// coverageGapsForAttention/onInvite/onReassign machinery (no fabricated
// counts, no second coverage source); Mobilize's copy is user-centered
// while its data source (ctx.view.wards) stays untouched; Territory's
// intro copy is clearer while its conditional geography flow is untouched.
//
// Run: node test/election-home-mobilize-territory-refinement.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"), { css: false });

console.log("\nELECTIONCANON 1.1.1 PHASE B — Home / Mobilize / Territory Refinement\n");

const home = code("../src/pages/election/HomeSection.jsx");
const mobilize = code("../src/pages/election/MobilizeSection.jsx");
const territory = code("../src/pages/election/TerritorySection.jsx");

console.log("A. Home: attention positioned before secondary content");
{
  const attentionIdx = home.indexOf('Label>What needs attention today');
  const myScopeIdx = home.indexOf("myResponsibility &&");
  const coverageCardIdx = home.indexOf("<CoverageCard");
  ok("1. 'What needs attention today' appears in the render output before MyScopeCard's conditional render",
     attentionIdx !== -1 && myScopeIdx !== -1 && attentionIdx < myScopeIdx);
  ok("2. 'What needs attention today' appears before <CoverageCard",
     attentionIdx !== -1 && coverageCardIdx !== -1 && attentionIdx < coverageCardIdx);
  ok("3. the 'Your election' hero panel still comes first — attention is prominent, not literally the top of the page (it follows the campaign identity panel, per the approved scope: 'appears before secondary Coverage/MyScope content')",
     home.indexOf("Label>Your election") < attentionIdx);
}

console.log("\nB. Home: attention actions reuse existing handlers, no fabricated data");
{
  ok("1. uncoveredForActions is derived from the SAME coverage.lgas/coverage.wards this file already computed — no second coverage read",
     /uncoveredForActions\s*=\s*\[[\s\S]{0,80}coverage\.lgas\.filter\(\(l\)\s*=>\s*!l\.covered\)/.test(home) &&
     /coverage\.wards\.filter\(\(w\)\s*=>\s*!w\.covered\)/.test(home));
  ok("2. the invite action calls the EXISTING handleInvite (which itself just calls onSection('organisation', hint)) — no second invitation-entry mechanism",
     /handleInvite\(\{\s*level:\s*gap\.level,\s*geographyRef:\s*gap\.geographyRef,\s*role:\s*gap\.role,\s*lgaId:\s*gap\.lgaId\s*\}\)/.test(home) &&
     /const handleInvite = \(hint\) => onSection\("organisation", hint\)/.test(home));
  ok("3. the review action for pending invitations navigates via the EXISTING onSection to Organisation — no new review surface invented",
     /onClick:\s*\(\)\s*=>\s*onSection\("organisation"\)/.test(home));
  ok("4. attentionAction() is index-scoped to real counts (uncoveredForActions.length, then pendingInvitationsForAttention.length) — it cannot attach an action to an alert beyond what real coverage/invitation data actually produced",
     /index < uncoveredForActions\.length/.test(home) &&
     /pendingInviteAlertEnd = pendingInviteAlertStart \+ pendingInvitationsForAttention\.length/.test(home));
  ok("5. HomeSection.jsx's own computeAttention() call is unchanged (same 4-argument shape) — the action wiring changed only how alerts are RENDERED, not how they are computed",
     /const attention = computeAttention\(view, \[\], coverageGapsForAttention, pendingInvitationsForAttention\)/.test(home));
}

console.log("\nC. attention.js itself is untouched by this pass (shared with IntelligenceSection.jsx)");
{
  const attentionJs = code("../src/pages/election/attention.js");
  ok("1. computeAttention()'s own priority-order logic (coverage gaps, then invitations, then everything else) is unchanged — still the exact shape Home's index-based action wiring depends on",
     /if \(coverageGaps\) \{/.test(attentionJs) &&
     /for \(const inv of pendingInvitations \?\? \[\]\)/.test(attentionJs));
}

console.log("\nD. Mobilize: user-centered copy, unchanged data source");
{
  ok("1. the label reads 'Your wards', not the old system-centric 'Wards known to ElectionCanon'",
     /Label>Your wards</.test(mobilize) && !/Wards known to ElectionCanon/.test(mobilize));
  ok("2. the empty state is user-centered ('Responsibilities will appear here when ElectionCanon assigns them to you')",
     /No ward responsibility assigned yet\. Responsibilities will appear here when ElectionCanon assigns them to you\./.test(mobilize));
  // NOTE: this file already legitimately imports a DIFFERENT, pre-existing
  // coverage.js (domains/election/mobilization/coverage.js — Election Day's
  // own polling-unit/agent coverage, unrelated to geography-scoped
  // responsibility coverage) — a bare "coverage.js" substring check would
  // false-fail against that real, untouched import. This checks specifically
  // for the GEOGRAPHY coverage module and responsibility_slots.
  ok("3. the data source is UNCHANGED — still ctx.view.wards, never geography/coverage.js or responsibility_slots",
     /const wards = Object\.values\(ctx\.view\?\.wards \?\? \{\}\)/.test(mobilize) &&
     !/geography\/coverage\.js/.test(mobilize) && !/responsibility_slots/.test(mobilize) && !/getUncoveredTerritory/.test(mobilize));
}

console.log("\nE. Territory: clearer intro copy, unchanged geography flow");
{
  ok("1. the intro copy communicates the real purpose ('Tell ElectionCanon where this campaign operates')",
     /Tell ElectionCanon where this campaign operates/.test(territory));
  ok("2. the conditional constituency step (needsConstituency) is unchanged — the flow is NOT flattened to three fields",
     /needsConstituency\s*=\s*Boolean\(office\)\s*&&\s*office\.boundary_level\s*!==\s*"national"\s*&&\s*office\.boundary_level\s*!==\s*"state"/.test(territory));
  ok("3. Election/Office/State/Constituency fields all still exist in the wizard",
     /aria-label="Election"/.test(territory) && /aria-label="Office"/.test(territory) &&
     /aria-label="State"/.test(territory) && /aria-label="Constituency"/.test(territory));
  ok("4. the write path (prepareGeographyWrite/approveGeographyWrite, SET_TERRITORY) is untouched",
     /GEOGRAPHY_OPERATION\.SET_TERRITORY/.test(territory) && /prepareGeographyWrite/.test(territory) && /approveGeographyWrite/.test(territory));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
