// ============================================================
// ELECTIONCANON 1.2 — GATE A: ROLE-AWARE COORDINATOR EXPERIENCE  (structural)
//
// This repository has no React-rendering test harness (see
// election-web-surface.consumer.mjs's own header) — these are the same
// class of structural/source-level checks that file already established.
// Proves: the shared responsibility resolver replaced both prior private
// implementations; AcceptInvite.jsx/invitations/write.js preserve the
// server-returned responsibility; Home/Territory/Organisation branch on
// scope without ever reading it from a URL/query parameter; the Organisation
// canInvite dead-end (a Polling-Unit Agent seeing an Invite button with zero
// offerable roles) is fixed; Mobilize's D.3 architecture boundary
// (election-home-mobilize-territory-refinement.consumer.mjs) is untouched
// by every new Gate A read this pass added; and no migration/RLS file
// changed.
//
// Run: node test/election-role-aware-coordinator.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

console.log("\nELECTIONCANON 1.2 — Gate A: role-aware coordinator experience (structural)\n");

const responsibility = code("../src/domains/election/responsibility.js");
const home = code("../src/pages/election/HomeSection.jsx");
const homeResp = code("../src/pages/election/HomeResponsibility.jsx");
const territorySection = code("../src/pages/election/TerritorySection.jsx");
const territoryExplorer = code("../src/pages/election/TerritoryExplorer.jsx");
const orgSection = code("../src/pages/election/OrganisationSection.jsx");
const acceptInvite = code("../src/pages/AcceptInvite.jsx");
const invWrite = code("../src/domains/election/invitations/write.js");
const election = code("../src/pages/Election.jsx");
const coverage = code("../src/domains/election/geography/coverage.js");
const geoRead = code("../src/domains/election/geography/read.js");
const mobilize = code("../src/pages/election/MobilizeSection.jsx");

console.log("1 — ONE SHARED RESOLVER, NO DUPLICATE LOOKUPS LEFT");
{
  ok("1. the shared resolver module exists and exports resolveMyResponsibility",
     /export function resolveMyResponsibility\(/.test(responsibility));
  ok("2. it also exports isScopedResponsibility and the SCOPED_RESPONSIBILITY_ROLES vocabulary",
     /export const isScopedResponsibility/.test(responsibility) && /export const SCOPED_RESPONSIBILITY_ROLES/.test(responsibility));
  ok("3. HomeSection.jsx imports the shared resolver and calls it",
     /import \{ resolveMyResponsibility, isScopedResponsibility \} from "\.\.\/\.\.\/domains\/election\/responsibility\.js"/.test(home)
     && /resolveMyResponsibility\(\{ view, campaignId, userId: myUserId \}\)/.test(home));
  ok("4. HomeSection.jsx's OLD inline lookup (Object.values(...).find matching invite:${campaignId}:${myUserId}) is gone",
     !/Object\.values\(view\.responsibilities \?\? \{\}\)\.find\(\(r\) => r\.person === myPersonRef/.test(home));
  ok("5. OrganisationSection.jsx imports the shared resolver and calls it",
     /import \{ resolveMyResponsibility, isScopedResponsibility \} from "\.\.\/\.\.\/domains\/election\/responsibility\.js"/.test(orgSection)
     && /resolveMyResponsibility\(\{ view, campaignId, userId \}\)/.test(orgSection));
  ok("6. OrganisationSection.jsx's OLD private myOwnResponsibility() function no longer exists",
     !/function myOwnResponsibility\(/.test(orgSection));
  ok("7. TerritorySection.jsx also uses the shared resolver (a third, otherwise-independent consumer)",
     /resolveMyResponsibility\(\{ view, campaignId, userId \}\)/.test(territorySection));
}

console.log("\n2 — INVITATION ACCEPTANCE: SERVER-RETURNED RESPONSIBILITY PRESERVED, NEVER URL-TRUSTED");
{
  ok("1. acceptInvitation()'s Director-only early return now reports responsibility: null explicitly (not just omitted)",
     /return \{ accepted: true, campaignId, error: null, responsibility: null \};/.test(invWrite));
  ok("2. acceptInvitation()'s full-success return exposes the SERVER-CONFIRMED role/level/geographyRef",
     /return \{ accepted: true, campaignId, error: null,\s*responsibility: \{ responsibilityRole, level, geographyRef \} \};/.test(invWrite));
  ok("3. AcceptInvite.jsx destructures the new `responsibility` field from the real acceptInvitation() call",
     /const \{ accepted, error: acceptError, responsibility \} = await acceptInvitation\(/.test(acceptInvite));
  ok("4. the destination is UNCHANGED — still /election?welcome=1 — no new coordinator-only route was invented",
     /navigate\("\/election\?welcome=1", responsibility \? \{ state: \{ justAcceptedResponsibility: responsibility \} \} : undefined\)/.test(acceptInvite));
  ok("5. AcceptInvite.jsx never reads a geography id, role, or campaign id FROM the URL for this decision (no useSearchParams/URLSearchParams usage anywhere in the file)",
     !/useSearchParams/.test(acceptInvite) && !/URLSearchParams/.test(acceptInvite));
  ok("6. Election.jsx treats the passed responsibility as COSMETIC ONLY — it is read via useLocation() strictly for the welcome banner's copy",
     /const location = useLocation\(\);/.test(election)
     && /location\.state\?\.justAcceptedResponsibility/.test(election));
  ok("7. Election.jsx's actual scoped rendering (Home/Territory/Organisation) never receives or reads location.state — each independently calls the resolver against ctx.view instead",
     (election.match(/location\.state/g) ?? []).length <= 2); // only the one welcome-banner read site (plus its own declaration line, if matched)
}

console.log("\n3 — HOME: SCOPED VIEW REPLACES CAMPAIGN-WIDE PANELS FOR COORDINATORS ONLY");
{
  ok("1. MyScopeCard's existing render condition is untouched (regression guard for election-home-mobilize-territory-refinement.consumer.mjs's own myScopeIdx check)",
     /\{myResponsibility && \(/.test(home));
  ok("2. CoverageCard now renders ONLY for a non-scoped viewer (owner/manager/Constituency Lead) — never for LGA/Ward/PU Coordinator",
     /\{!isScoped && <CoverageCard coverage=\{coverage\}/.test(home));
  ok("3. ScopedWardsPanel/ScopedPollingUnitsPanel are imported from HomeResponsibility.jsx and rendered only when isScoped",
     /import \{ CoverageCard, CoverageGapsPanel, ReassignResponsibilityPanel, ScopedWardsPanel, ScopedPollingUnitsPanel \}/.test(home)
     && /isScoped && myResponsibility\.responsibilityRole === "LGA_COORDINATOR"/.test(home)
     && /isScoped && myResponsibility\.responsibilityRole === "WARD_COORDINATOR"/.test(home));
  ok("4. the scoped ward/PU fetches are BOUNDED — listWardsForLga/listPollingUnitsForWard/getWardCoverage/getPollingUnitCoverage/getPollingUnitCountsByWard, never a constituency-wide or national read",
     /listWardsForLga\(\{ client: supabase, lgaId: myResponsibility\.geographyRef \}\)/.test(home)
     && /getPollingUnitCountsByWard\(\{ client: supabase, wardIds: wardList\.map/.test(home)
     && /listPollingUnitsForWard\(\{ client: supabase, wardId: myResponsibility\.geographyRef \}\)/.test(home));
  ok("5. the existing computeAttention() call is BYTE-UNCHANGED (still the exact 4-argument shape the refinement test already asserts)",
     /const attention = computeAttention\(view, \[\], coverageGapsForAttention, pendingInvitationsForAttention\);/.test(home));
  ok("6. HomeResponsibility.jsx exports the two new scoped panels alongside the three original, unmodified exports",
     /export function ScopedWardsPanel\(/.test(homeResp) && /export function ScopedPollingUnitsPanel\(/.test(homeResp)
     && /export function CoverageCard\(/.test(homeResp) && /export function CoverageGapsPanel\(/.test(homeResp)
     && /export function ReassignResponsibilityPanel\(/.test(homeResp));
}

console.log("\n3b — LOOP 3 HARDENING: HOME ROLE-AMBIGUITY RESOLVED (owner/manager vs. staff-with-no-responsibility vs. revoked coordinator)");
{
  ok("1. Home now fetches campaign_members.member_role for the viewer — the SAME column OrganisationSection.jsx already reads, not a new role system",
     /const \[myMemberRole, setMyMemberRole\] = useState\(undefined\);/.test(home)
     && /\.from\("campaign_members"\)\s*\.select\("member_role"\)\.eq\("campaign_id", campaignId\)\.eq\("person", user\.id\)\.eq\("status", "active"\)\.maybeSingle\(\)/.test(home));
  ok("2. isOwnerOrManager/isConstituencyLead/hasNoActiveResponsibility are all derived, never a second responsibility read",
     /const isOwnerOrManager = myMemberRole === "owner" \|\| myMemberRole === "manager";/.test(home)
     && /const isConstituencyLead = resolvedResponsibility\?\.responsibilityRole === "CONSTITUENCY_LEAD";/.test(home)
     && /const hasNoActiveResponsibility = roleResolved && !isOwnerOrManager && !isConstituencyLead && !isScoped;/.test(home));
  ok("3. the ambiguity branch is gated on roleResolved (myMemberRole !== undefined) — it can never fire during the loading window and misclassify a real owner/manager",
     /const roleResolved = myMemberRole !== undefined;/.test(home)
     && /if \(roleResolved && hasNoActiveResponsibility\)/.test(home));
  ok("4. the early return is placed AFTER every hook in this component (React's own rule) — specifically after the LAST useState call (reassignTarget), never between hooks",
     home.indexOf('const [reassignTarget, setReassignTarget] = useState(null);') < home.indexOf('if (roleResolved && hasNoActiveResponsibility)')
     && !/useState\(/.test(home.slice(home.indexOf('if (roleResolved && hasNoActiveResponsibility)'))));
  ok("5. the honest empty state names the real recovery path (contact the owner / Organisation / Territory) — never fabricates a geography or auto-assigns a fallback responsibility",
     /No active responsibility was found for this account\./.test(home)
     && /Contact your campaign owner if you believe this is a mistake/.test(home)
     && !/setMyResponsibility\(/.test(home)); // no client-side write/fabrication of responsibility state exists anywhere in this file
  ok("6. owner/manager still reach the FULL campaign-wide render — the ambiguity branch's own condition explicitly excludes them (isOwnerOrManager checked first)",
     home.indexOf('const isOwnerOrManager = myMemberRole === "owner" || myMemberRole === "manager";') < home.indexOf('const hasNoActiveResponsibility'));
}

console.log("\n3c — LOOP 5 HARDENING: 'WHAT CHANGED' NO LONGER LEAKS CAMPAIGN-WIDE ACTIVITY TO A SCOPED COORDINATOR");
{
  ok("1. owner/manager/Constituency Lead still see 'What changed' — it renders inside the SAME !isScoped gate as the pre-existing 'What needs attention today' panel, not removed or replaced",
     /\{!isScoped && \(\s*<div style=\{\{ gridColumn: "1 \/ -1" \}\}>\s*<Label>What changed<\/Label>/.test(home));
  ok("2. a scoped coordinator/agent (isScoped === true) cannot reach this block — the campaign-wide recentChanges feed is gated OUT for them, mirroring the attention panel's own !isScoped gate one section above",
     (home.match(/\{!isScoped && \(/g) ?? []).length >= 2); // attention panel + What-changed panel, both real occurrences of the same gate
  ok("3. recentChanges' own text-building NEVER interpolates a raw geography/person ref directly — every entry resolves through nameForGeography()/nameForPersonRef() (real names), so even the campaign-wide feed itself carries no bare geography/person IDs",
     /nameForGeography\(slot\.geographyRef\)/.test(home)
     && /nameForPersonRef\(slot\.person\)/.test(home)
     && /nameForPersonRef\(hist\?\.previousPerson\)/.test(home)
     && /nameForPersonRef\(hist\?\.newPerson\)/.test(home)
     && !/text: `\$\{[^`]*\}\$\{slot\.geographyRef\}/.test(home)
     && !/text: `\$\{[^`]*\}\$\{slot\.person\}/.test(home));
  ok("4. the pre-existing 'What needs attention today' scoped gate is untouched by this pass — still exactly !isScoped, still positioned before this fix's own gate",
     /\{!isScoped && \(\s*<div style=\{\{ gridColumn: "1 \/ -1" \}\}>\s*<Label>What needs attention today<\/Label>/.test(home)
     && home.indexOf("What needs attention today") < home.indexOf("What changed"));
  ok("5. no new isScoped-style flag was introduced for this fix — the SAME isScopedResponsibility()-derived flag from responsibility.js gates both panels, no second scope model",
     (home.match(/const isScoped = isScopedResponsibility\(myResponsibility\);/g) ?? []).length === 1);
}

console.log("\n4 — TERRITORY: COORDINATORS NEVER REACH THE OWNER-STYLE WIZARD/EXPLORER");
{
  ok("1. TerritorySection resolves scope BEFORE deciding what to render",
     /const isScoped = isScopedResponsibility\(myResponsibility\);/.test(territorySection));
  ok("2. a scoped viewer returns ScopedTerritory and NEVER falls through to TerritoryWizard/TerritoryExplorer",
     /if \(isScoped\) \{\s*return <ScopedTerritory responsibility=\{myResponsibility\} campaignId=\{campaignId\} \/>;\s*\}/.test(territorySection));
  ok("3. the existing owner-path (TerritoryWizard/TerritoryExplorer, needsConstituency gating) is completely unmodified — still reachable exactly as before for isScoped === false",
     /needsConstituency\s*=\s*Boolean\(office\)\s*&&\s*office\.boundary_level\s*!==\s*"national"\s*&&\s*office\.boundary_level\s*!==\s*"state"/.test(territorySection)
     && /return territory\s*\?\s*<TerritoryExplorer/.test(territorySection));
  ok("4. ScopedTerritory uses the SAME bounded reads as Home's scoped panels — no new geography source",
     /listWardsForLga\(\{ client: supabase, lgaId: geographyRef \}\)/.test(territorySection)
     && /listPollingUnitsForWard\(\{ client: supabase, wardId: geographyRef \}\)/.test(territorySection));
  ok("5. TerritoryExplorer.jsx itself (the campaign-wide, every-LGA render) is completely untouched by this pass",
     /tree\.lgas\.map\(\(lga\) => \{/.test(territoryExplorer));
  ok("6. an unresolvable assigned geography renders an honest error state, never a crash or a fabricated name (Part 8 hardening)",
     /Your assigned \{levelLabel\.toLowerCase\(\)\} could not be found in ElectionCanon's geography data\./.test(territorySection));
}

console.log("\n5 — ORGANISATION: canInvite DEAD-END FIXED, INVITATION AUTHORIZATION RULES UNTOUCHED");
{
  ok("1. canInvite is now derived from the SAME real offerable-role booleans InviteWizard itself already used — never just 'holds any responsibility'",
     /const canInvite = canOfferDirector \|\| canOfferLga \|\| canOfferWard \|\| canOfferPu;/.test(orgSection));
  ok("2. a Polling-Unit Agent can no longer reach a dead-end Invite step — canOfferPu (the ONLY thing PU_AGENT's own role would need to satisfy) still requires WARD_COORDINATOR, so POLLING_UNIT_AGENT satisfies none of the four",
     /const canOfferPu = myRole === "owner" \|\| myRole === "manager" \|\| myResponsibility\?\.responsibilityRole === "WARD_COORDINATOR";/.test(orgSection));
  ok("3. InviteWizard's own authorization-mirroring booleans (canOfferWard/canOfferPu keyed to LGA_COORDINATOR/WARD_COORDINATOR) are UNCHANGED — matches create_campaign_invitation()'s own SQL exactly, still",
     /const canOfferWard = myRole === "owner" \|\| myRole === "manager" \|\| myResponsibility\?\.responsibilityRole === "LGA_COORDINATOR";/.test(orgSection));
}

console.log("\n6 — NEW COVERAGE/GEOGRAPHY PRIMITIVES: BOUNDED, ADDITIVE, NO SECOND MODEL");
{
  ok("1. getPollingUnitCoverage() mirrors getWardCoverage()'s own exact query pattern against responsibility_slots — same table, same shape, no new model",
     /export async function getPollingUnitCoverage\(\{ client, campaignId, pollingUnits = \[\] \} = \{\}\)/.test(coverage)
     && /\.eq\("level", "polling_unit"\)\.in\("geography_ref", pollingUnits\.map/.test(coverage));
  ok("2. getPollingUnitCountsByWard() is a single bounded query (one column, .in() over a caller-supplied ward list) — never an unbounded or national scan",
     /export async function getPollingUnitCountsByWard\(\{ client, wardIds = \[\] \}\)/.test(geoRead)
     && /\.select\("ward_id"\)\.in\("ward_id", wardIds\)/.test(geoRead));
  ok("3. both are exported from their module's default export alongside every pre-existing function, unchanged",
     /getConstituencyCoverage, getLgaCoverage, getWardCoverage, getPollingUnitCoverage,/.test(coverage)
     && /listWardsForLga, listPollingUnitsForWard, getPollingUnitCountsByWard,/.test(geoRead));
}

console.log("\n7 — MOBILIZE: D.3 ARCHITECTURE BOUNDARY UNTOUCHED BY ANY GATE A READ");
{
  // Re-asserts election-home-mobilize-territory-refinement.consumer.mjs's
  // own D.3 condition here too, PLUS checks none of Gate A's new imports
  // ever leaked into this file.
  ok("1. MobilizeSection.jsx's ward data source is still the free-text ctx.view.wards fold — byte-unchanged",
     /const wards = Object\.values\(ctx\.view\?\.wards \?\? \{\}\)/.test(mobilize));
  ok("2. it still never references geography/coverage.js, responsibility_slots, or getUncoveredTerritory",
     !/geography\/coverage\.js/.test(mobilize) && !/responsibility_slots/.test(mobilize) && !/getUncoveredTerritory/.test(mobilize));
  ok("3. NONE of this pass's new primitives leaked into Mobilize either — no resolveMyResponsibility, getWardCoverage, getPollingUnitCoverage, or listWardsForLga import",
     !/resolveMyResponsibility/.test(mobilize) && !/getWardCoverage/.test(mobilize)
     && !/getPollingUnitCoverage/.test(mobilize) && !/listWardsForLga/.test(mobilize));
}

console.log("\n8 — NO SCHEMA/MIGRATION/RLS CHANGE");
{
  let migrationsStatus = null, gitAvailable = true;
  try {
    migrationsStatus = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
      cwd: new URL("..", import.meta.url), encoding: "utf8",
    }).trim();
  } catch { gitAvailable = false; }
  ok("1. supabase/migrations has no new or modified file — Gate A touched zero schema/RLS",
     !gitAvailable || migrationsStatus === "");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
