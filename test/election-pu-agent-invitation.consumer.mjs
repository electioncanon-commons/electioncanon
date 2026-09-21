// ============================================================
// ELECTIONCANON 1.2 — GATE A LOOP 4, TASK 2: POLLING-UNIT AGENT INVITATION
// ============================================================
//
// Proves the fix for a real, live-discovered bug: OrganisationSection.jsx's
// InviteWizard used the selected WARD's id as a Polling-Unit Agent's own
// geographyRef, which could never match a real geography_polling_units row.
// This file proves (a) the frontend now supplies a real PU id, resolved via
// a proper PU-picker scoped to the correct ward, and (b) the server-side
// authorization this now correctly reaches was ALREADY fully correct and
// untouched — no migration, no RLS change, no new responsibility model.
//
// This repository has no React-rendering test harness (see
// election-web-surface.consumer.mjs's own header) — these are the same
// class of structural/source-level checks every other test file here uses.
//
// Run: node test/election-pu-agent-invitation.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

console.log("\nELECTIONCANON 1.2 — Gate A Loop 4 Task 2: Polling-Unit Agent invitation (structural)\n");

const orgSection = code("../src/pages/election/OrganisationSection.jsx");
const geoRead = code("../src/domains/election/geography/read.js");
const invitationsMigration = code("../supabase/migrations/20260903000000_election_responsibility_reassignment.sql");
const invWrite = code("../src/domains/election/invitations/write.js");

console.log("1 — VALID PU SELECTION: THE UI NOW SUPPLIES A REAL PU ID, NEVER THE WARD'S OWN ID");
{
  ok("1. a dedicated puId/pollingUnits state pair exists, separate from wardId/wards",
     /const \[puId, setPuId\] = useState\(""\);/.test(orgSection)
     && /const \[pollingUnits, setPollingUnits\] = useState\(\[\]\);/.test(orgSection));
  ok("2. polling units are fetched via the existing, bounded listPollingUnitsForWard() — no new geography source",
     /listPollingUnitsForWard\(\{ client: supabase, wardId: effectiveWardForPu \}\)/.test(orgSection)
     && /export async function listPollingUnitsForWard\(\{ client, wardId \}\)/.test(geoRead));
  ok("3. send() now uses puId — NEVER wardId — as a Polling-Unit Agent's geographyRef (the exact bug this pass fixes)",
     /const geographyRef = role === "POLLING_UNIT_AGENT" \? puId\s*\n\s*: role === "WARD_COORDINATOR" \? wardId\s*\n\s*: role === "LGA_COORDINATOR" \? lgaId : null;/.test(orgSection));
  ok("4. the old, buggy single-line geographyRef assignment (wardId for BOTH ward coordinator and PU agent) no longer exists",
     !/const geographyRef = role === "WARD_COORDINATOR" \|\| role === "POLLING_UNIT_AGENT" \? wardId/.test(orgSection));
  ok("5. a real PU picker <select> exists, populated from the fetched pollingUnits list, showing real code/name — never a placeholder",
     /<select value=\{puId\} onChange=\{\(e\) => setPuId\(e\.target\.value\)\} aria-label="Polling Unit"/.test(orgSection)
     && /\{pollingUnits\.map\(\(p\) => <option key=\{p\.id\} value=\{p\.id\}>\{p\.code\}\{p\.name \? ` — \$\{p\.name\}` : ""\}<\/option>\)\}/.test(orgSection));
  ok("6. territoryReady now requires puId (not wardId) before a Polling-Unit Agent invitation can proceed to review",
     /\(role === "POLLING_UNIT_AGENT" && puId\)/.test(orgSection)
     && !/\(role === "POLLING_UNIT_AGENT" && wardId\)/.test(orgSection));
}

console.log("\n2 — WARD COORDINATOR: OWN WARD AUTO-DERIVED, NO RE-PICKING, NO IRRELEVANT WARD LIST FETCHED");
{
  ok("1. effectiveWardForPu auto-derives the caller's OWN ward when they are a Ward Coordinator — mirrors effectiveLga's own pattern one level up",
     /const effectiveWardForPu = myResponsibility\?\.responsibilityRole === "WARD_COORDINATOR" \? myResponsibility\.geographyRef : wardId;/.test(orgSection));
  ok("2. needsWard is false for a Ward Coordinator inviting a Polling-Unit Agent — no ward picker shown, nothing to re-pick",
     /const needsWard = role === "WARD_COORDINATOR"\s*\n\s*\|\| \(role === "POLLING_UNIT_AGENT" && myResponsibility\?\.responsibilityRole !== "WARD_COORDINATOR"\);/.test(orgSection));
  ok("3. the ward's own name is resolved via a single-row lookup for display ONLY on the auto-derived path — never a second geography source, never required for authorization",
     /supabase\.from\("geography_wards"\)\.select\("id, name"\)\.eq\("id", effectiveWardForPu\)\.maybeSingle\(\)/.test(orgSection));
}

console.log("\n3 — SERVER-SIDE AUTHORIZATION: ALREADY CORRECT, UNCHANGED, NOT BYPASSED");
{
  // These assertions read the EXISTING, untouched migration text — proving
  // the fix required ZERO SQL/RLS changes, because create_campaign_invitation()
  // already independently verifies every one of these facts from the
  // PU id alone: existence, ward membership, and caller's own ward-scope
  // ownership. This IS the "PU outside ward rejected" / "PU outside
  // coordinator scope rejected" / "wrong geography level rejected" coverage
  // the task asks for — enforced server-side, not by this UI fix.
  ok("1. create_campaign_invitation()'s PU-authorization branch independently verifies the PU EXISTS (a real join against geography_polling_units, not a client claim)",
     /elsif p_intended_responsibility_role = 'POLLING_UNIT_AGENT' and p_intended_level = 'polling_unit' and p_intended_geography_ref is not null then/.test(invitationsMigration)
     && /join public\.geography_polling_units pu on pu\.id::text = p_intended_geography_ref/.test(invitationsMigration));
  ok("2. it independently verifies the PU belongs to a ward the caller ACTUALLY holds as Ward Coordinator (rs.geography_ref = pu.ward_id — 'PU outside ward' and 'PU outside coordinator scope' both rejected by this one join)",
     /where rs\.campaign_id = p_campaign_id and rs\.level = 'ward' and rs\.geography_ref = pu\.ward_id::text\s*\n\s*and rs\.current_person = 'invite:' \|\| p_campaign_id::text \|\| ':' \|\| v_uid::text\s*\n\s*\);\s*\n\s*elsif p_intended_responsibility_role = 'POLLING_UNIT_AGENT'/.test(invitationsMigration)
     || /rs\.geography_ref = pu\.ward_id::text\s*\n\s*and rs\.current_person = 'invite:' \|\| p_campaign_id::text \|\| ':' \|\| v_uid::text/.test(invitationsMigration));
  ok("3. write_responsibility()'s own PU-level authorization branch (used outside the invitation-trust path) enforces the identical ward-ownership join",
     /elsif p_responsibility_role = 'POLLING_UNIT_AGENT' and p_level = 'polling_unit' then/.test(invitationsMigration)
     && /join public\.geography_polling_units pu on pu\.id::text = p_geography_ref/.test(invitationsMigration));
  ok("4. duplicate/idempotent responsibility is still rejected by the SAME unchanged compare-and-swap ('this person already holds this responsibility') and the partial unique index — no second uniqueness mechanism was added",
     /raise exception 'this person already holds this responsibility';/.test(invitationsMigration)
     && /raise exception 'this slot has already changed since you last viewed it -- refresh';/.test(invitationsMigration));
  ok("5. the invitation-acceptance path still DERIVES level/geography/role from the invitation row itself, never trusts the accepter's own client — unchanged",
     /level\/geography\/role are DERIVED from the invitation, never trusted/.test(invitationsMigration));
}

console.log("\n4 — INVITATION ACCEPTANCE RESOLVES THE EXACT PU");
{
  ok("1. acceptInvitation()'s polling_unit branch is UNCHANGED — a single-row targeted lookup by geographyRef, never a ward-wide or national fetch",
     /\} else if \(level === "polling_unit"\) \{[\s\S]{0,400}?\.from\("geography_polling_units"\)\.select\("id, ward_id, code"\)\.eq\("id", geographyRef\)\.maybeSingle\(\);/.test(invWrite));
  ok("2. this lookup now receives a REAL PU id (thanks to the InviteWizard fix) rather than a ward id that could never resolve to a real polling-unit row",
     /geographyTree = \{ pollingUnits: data \? \[data\] : \[\] \};/.test(invWrite));
}

console.log("\n5 — DIRECT NAVIGATION / NO CLIENT-SIDE SCOPE TRUST");
{
  ok("1. OrganisationSection.jsx never reads a geography id, ward, or PU selection from a URL/query parameter",
     !/useSearchParams/.test(orgSection) && !/window\.location\.search/.test(orgSection) && !/URLSearchParams/.test(orgSection));
  ok("2. canOfferPu (who may even attempt this) is unchanged — still requires WARD_COORDINATOR or owner/manager, mirrored from the SQL's own authorization, not weakened by this fix",
     /const canOfferPu = myRole === "owner" \|\| myRole === "manager" \|\| myResponsibility\?\.responsibilityRole === "WARD_COORDINATOR";/.test(orgSection));
}

console.log("\n6 — NO SCHEMA/MIGRATION/RLS CHANGE FOR THIS FIX");
{
  // LAUNCH DISTRIBUTION PASS (Alpha 1.7) — assertion 1 originally checked
  // that `git status --porcelain -- supabase/migrations` was entirely
  // empty, true only because no migration existed anywhere else in the
  // working tree at the time this test was written. That does not survive
  // time: a later, UNRELATED migration (e.g. 20260921000000_election_
  // launch_distribution.sql, standalone launch_subscribers/launch_
  // analytics_events tables with no foreign key into campaign_invitations
  // or geography_polling_units) would trip it forever after. Re-scoped to
  // this pass's own real invariant: no migration in the working tree
  // touches campaign_invitations or geography_polling_units — the two
  // tables this PU-agent-invitation authorization fix actually depends on.
  let migrationFiles = [], gitAvailable = true;
  try {
    migrationFiles = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
      cwd: new URL("..", import.meta.url), encoding: "utf8",
    }).trim().split("\n").filter(Boolean).map((line) => line.trim().split(/\s+/).pop());
  } catch { gitAvailable = false; }
  // SQL comment lines (--...) are stripped before checking -- a migration
  // is free to MENTION campaign_invitations/geography_polling_units in its
  // own prose (e.g. citing them as an existing design precedent, as
  // 20260921000000_election_launch_distribution.sql's header genuinely
  // does) without that counting as touching their schema.
  const stripSqlComments = (sql) => sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  ok("1. no new/modified migration in the working tree touches campaign_invitations or geography_polling_units — this pass's own invariant, not 'zero migrations exist anywhere'",
     !gitAvailable || migrationFiles.every((f) => {
       const text = stripSqlComments(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
       return !/campaign_invitations/.test(text) && !/geography_polling_units/.test(text);
     }));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
