// ============================================================
// FORGE ELECTION — SHARED RESPONSIBILITY RESOLVER  (Gate A, Part 1)
//
// Unlike most consumer tests in this repo (which do structural/source-level
// checks because the surrounding page has no React-rendering harness — see
// election-web-surface.consumer.mjs's own header), resolveMyResponsibility()
// is a pure function with no I/O and no JSX — so this test calls the REAL
// implementation directly against constructed `view` fixtures, the same way
// election-readiness.consumer.mjs tests deriveReadiness().
//
// Run: node test/election-responsibility-resolver.consumer.mjs
// ============================================================

import { resolveMyResponsibility, isScopedResponsibility, SCOPED_RESPONSIBILITY_ROLES } from "../src/domains/election/responsibility.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nFORGE ELECTION — Shared responsibility resolver\n");

const CAMPAIGN = "campaign-1";
const OTHER_CAMPAIGN = "campaign-2";
const USER = "user-abc";
const OTHER_USER = "user-xyz";

const slot = (over = {}) => ({
  level: "lga", geographyRef: "lga-somolu", responsibilityRole: "LGA_COORDINATOR",
  person: `invite:${CAMPAIGN}:${USER}`, ...over,
});

console.log("1. No responsibility");
{
  const view = { responsibilities: {} };
  ok("returns null when no slot names this user",
     resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER }) === null);
  ok("returns null when view has no responsibilities key at all",
     resolveMyResponsibility({ view: {}, campaignId: CAMPAIGN, userId: USER }) === null);
}

console.log("\n2. Constituency Lead");
{
  const view = { responsibilities: { c1: slot({ level: "constituency", geographyRef: "const-1", responsibilityRole: "CONSTITUENCY_LEAD" }) } };
  const r = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER });
  ok("resolves the Constituency Lead slot", r?.responsibilityRole === "CONSTITUENCY_LEAD" && r.level === "constituency");
  ok("Constituency Lead is NOT in the scoped-role set (treated like owner/manager)",
     !isScopedResponsibility(r));
}

console.log("\n3. LGA Coordinator");
{
  const view = { responsibilities: { l1: slot() } };
  const r = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER });
  ok("resolves level/geographyRef/responsibilityRole/currentPersonRef correctly",
     r?.level === "lga" && r.geographyRef === "lga-somolu" && r.responsibilityRole === "LGA_COORDINATOR"
     && r.currentPersonRef === `invite:${CAMPAIGN}:${USER}` && r.campaignId === CAMPAIGN);
  ok("LGA Coordinator IS in the scoped-role set", isScopedResponsibility(r));
}

console.log("\n4. Ward Coordinator");
{
  const view = { responsibilities: { w1: slot({ level: "ward", geographyRef: "ward-alade", responsibilityRole: "WARD_COORDINATOR" }) } };
  const r = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER });
  ok("resolves as ward-level", r?.level === "ward" && r.geographyRef === "ward-alade" && r.responsibilityRole === "WARD_COORDINATOR");
  ok("Ward Coordinator IS in the scoped-role set", isScopedResponsibility(r));
}

console.log("\n5. Polling Unit Agent");
{
  const view = { responsibilities: { p1: slot({ level: "polling_unit", geographyRef: "pu-001", responsibilityRole: "POLLING_UNIT_AGENT" }) } };
  const r = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER });
  ok("resolves as polling_unit-level", r?.level === "polling_unit" && r.geographyRef === "pu-001" && r.responsibilityRole === "POLLING_UNIT_AGENT");
  ok("Polling Unit Agent IS in the scoped-role set", isScopedResponsibility(r));
  ok("SCOPED_RESPONSIBILITY_ROLES contains exactly the three sub-campaign roles",
     SCOPED_RESPONSIBILITY_ROLES.length === 3
     && SCOPED_RESPONSIBILITY_ROLES.includes("LGA_COORDINATOR")
     && SCOPED_RESPONSIBILITY_ROLES.includes("WARD_COORDINATOR")
     && SCOPED_RESPONSIBILITY_ROLES.includes("POLLING_UNIT_AGENT")
     && !SCOPED_RESPONSIBILITY_ROLES.includes("CONSTITUENCY_LEAD"));
}

console.log("\n6. Reassigned responsibility — resolver reflects CURRENT holder only");
{
  // projectElection() already folds responsibility.assigned + a later
  // responsibility.reassigned event into ONE current-state map entry (last-
  // write-wins, oldest-first fold — see projections.js:83's own reversal),
  // so a reassigned-away former holder simply has no entry left to match —
  // this fixture models that already-folded state directly, exactly what
  // the resolver actually receives from getElectionContext() in production.
  const view = { responsibilities: { l1: slot({ person: `invite:${CAMPAIGN}:${OTHER_USER}` }) } };
  ok("the ORIGINAL holder (now reassigned away) no longer resolves to this slot",
     resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER }) === null);
  ok("the NEW holder resolves to it instead",
     resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: OTHER_USER })?.geographyRef === "lga-somolu");
}

console.log("\n7. Wrong campaign");
{
  // The SAME view (belonging to CAMPAIGN) must never match a caller who
  // supplies a DIFFERENT campaignId — the person-ref itself embeds the
  // campaign id, so a mismatched campaignId can never construct a matching
  // key. This proves a caller cannot pivot into a slot via campaign-id
  // confusion alone.
  const view = { responsibilities: { l1: slot() } };
  ok("resolving with a different campaignId returns null even though the SAME userId holds a real slot elsewhere",
     resolveMyResponsibility({ view, campaignId: OTHER_CAMPAIGN, userId: USER }) === null);
}

console.log("\n8. Inactive / non-member (no scope at all)");
{
  // getElectionContext() returns view: null whenever resolveElectionScope()
  // did not land on ELECTION_SCOPE.SCOPED (unauthenticated, no membership,
  // ambiguous, refused, or read-failed) — this is the exact shape the
  // resolver must handle without throwing.
  ok("view: null (no scope resolved at all) returns null, not a throw",
     resolveMyResponsibility({ view: null, campaignId: CAMPAIGN, userId: USER }) === null);
  ok("missing userId returns null",
     resolveMyResponsibility({ view: { responsibilities: { l1: slot() } }, campaignId: CAMPAIGN, userId: null }) === null);
  ok("missing campaignId returns null",
     resolveMyResponsibility({ view: { responsibilities: { l1: slot() } }, campaignId: null, userId: USER }) === null);
}

console.log("\n9. Multiple responsibility records — resolver finds the RIGHT one among many, ignores the rest");
{
  const view = {
    responsibilities: {
      other_lga: slot({ geographyRef: "lga-ikeja", person: `invite:${CAMPAIGN}:${OTHER_USER}` }),
      mine: slot({ geographyRef: "lga-somolu", person: `invite:${CAMPAIGN}:${USER}` }),
      other_ward: slot({ level: "ward", geographyRef: "ward-x", responsibilityRole: "WARD_COORDINATOR", person: `invite:${CAMPAIGN}:${OTHER_USER}` }),
    },
  };
  const r = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: USER });
  ok("resolves to the caller's OWN slot, not another member's, when several slots exist in the same campaign",
     r?.geographyRef === "lga-somolu" && r.responsibilityRole === "LGA_COORDINATOR");
  const r2 = resolveMyResponsibility({ view, campaignId: CAMPAIGN, userId: OTHER_USER });
  ok("resolves the OTHER member's own slot correctly too (first match among their own multiple slots — documented, existing behavior, not a new heuristic)",
     r2?.geographyRef === "lga-ikeja");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
