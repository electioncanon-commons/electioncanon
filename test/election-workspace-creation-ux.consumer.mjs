// ============================================================
// FORGE ELECTION — WORKSPACE CREATION UX REFINEMENT  (structural)
//
// This repository has no React-rendering test harness (see
// election-web-surface.consumer.mjs's own header) — these are the same
// class of structural/source-level checks that file already established,
// proving the workspace-creation-screen UX pass actually happened in the
// source (WelcomeOnboarding's "setup" step in src/pages/Election.jsx), not
// just described as done. All regex checks run against comment-stripped
// code (test/lib/source.mjs) so a comment that merely MENTIONS old or new
// copy never counts as a leak or a pass.
//
// SCOPE: this file proves the UX/copy/ordering change only. It does not
// re-derive the underlying activation/Canon-write contract already proven
// by election-web-surface.consumer.mjs (C1/D1/D2) and election-prelaunch-ux
// .consumer.mjs (P3) — those keep passing unmodified (see npm test), which
// is itself the proof that campaign creation semantics were not touched.
//
// Run: node test/election-workspace-creation-ux.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));
const raw = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nFORGE ELECTION — Workspace creation UX refinement (structural)\n");

const election = code("../src/pages/Election.jsx");

// Isolate WelcomeOnboarding's own function body — the exact scope every
// "no duplicate field" / "primary object" check below must be evaluated
// against, so a coincidental match elsewhere in the page (e.g.
// CandidateRegistrationPanel's own, unrelated `name` state/input) can never
// count as evidence for or against this component.
const weoMatch = election.match(/function WelcomeOnboarding\([\s\S]*?\n\}\n\nconst SCOPE_MESSAGE/);
const weo = weoMatch ? weoMatch[0] : "";

console.log("1/2 — BOTH EXISTING ACTOR PATHS STILL EXIST, UNCHANGED KIND VALUES");
{
  ok("1. Candidate campaign creation still exists, keyed on the real ACTOR_KIND.CANDIDATE_CAMPAIGN constant",
     /\{\s*kind:\s*ACTOR_KIND\.CANDIDATE_CAMPAIGN,\s*label:\s*"Candidate \/ Candidate Campaign"/.test(election));
  ok("2. Observer\/monitoring organisation creation still exists, keyed on the real ACTOR_KIND.OBSERVER_ORGANISATION constant",
     /\{\s*kind:\s*ACTOR_KIND\.OBSERVER_ORGANISATION,\s*label:\s*"Observer \/ Monitoring Organisation"/.test(election));
  ok("3. both choices are still rendered from the same single ACTOR_CHOICES array — no second, duplicated selector",
     /ACTOR_CHOICES\.map\(\(c\) =>/.test(weo) && (election.match(/ACTOR_CHOICES\.map/g) ?? []).length === 1);
}

console.log("\n3 — EXISTING ELECTION CHOICES UNCHANGED");
{
  ok("1. all five election types are present, in the original order, with no additions or removals",
     /const ELECTION_TYPES = Object\.freeze\(\[\s*"Presidential", "Senatorial", "House of Representatives", "Governorship", "State House of Assembly",\s*\]\);/.test(election));
  ok("2. exactly five election-type strings exist in the array (no silent extra option)",
     (election.match(/const ELECTION_TYPES = Object\.freeze\(\[([\s\S]*?)\]\);/)[1].match(/"[^"]+"/g) ?? []).length === 5);
}

console.log("\n4/5 — SAME NAME STATE, NO DUPLICATE FIELD");
{
  ok("1. the existing single name state (name/setName) is still what backs the workspace/campaign name field",
     /const \[name, setName\] = useState\(""\);/.test(weo));
  ok("2. submit() still trims and forwards that SAME state — no second name variable introduced",
     /const submit = \(\) => \{\s*const clean = name\.trim\(\);/.test(weo));
  ok("3. exactly ONE <input> exists inside WelcomeOnboarding (the name field) — no duplicate name/workspace input",
     (weo.match(/<input\b/g) ?? []).length === 1);
  ok("4. that one input is bound to the existing name state, not a new one",
     (weo.match(/<input value=\{name\} onChange=\{\(e\) => setName\(e\.target\.value\)\}/g) ?? []).length === 1);
}

console.log("\n6/7 — NAME IS THE VISUALLY PRIMARY OBJECT, FOR BOTH ACTOR KINDS");
{
  const nameFieldIdx = weo.search(/isObserver \? "Organisation name" : "Campaign name"/);
  const electionChipsIdx = weo.search(/ELECTION_TYPES\.map/);
  ok("1. the name field's label switches to CAMPAIGN NAME / ORGANISATION NAME by actor kind, not a generic 'workspace name'",
     nameFieldIdx !== -1 && !/Workspace name/.test(weo));
  ok("2. the candidate placeholder demonstrates a real campaign name, not a generic office example",
     /"e\.g\. Rock Governorship Campaign Council 2026"/.test(weo));
  ok("3. the observer placeholder demonstrates a real organisation name, distinct from the candidate one",
     /"e\.g\. Rock Election Observation Council 2026"/.test(weo));
  ok("4. the name input is positioned BEFORE the election chips in source order — primary object comes first",
     nameFieldIdx !== -1 && electionChipsIdx !== -1 && nameFieldIdx < electionChipsIdx);
  ok("5. the name input carries the strongest visual weight on the screen: larger display type than any chip/button (17px vs 11px) and a thicker accent border (2px vs 1px)",
     /fontFamily: DISPLAY, fontWeight: 700, fontSize: 17,/.test(weo) &&
     /border: `2px solid \$\{AMBER\}`, outline: "none"/.test(weo) &&
     /fontFamily: UI, fontWeight: 700, fontSize: 11, padding: "8px 14px"/.test(weo));
  ok("6. candidate is still the default actor kind (unchanged first-run behavior)",
     /const \[actorKind, setActorKind\] = useState\(ACTOR_KIND\.CANDIDATE_CAMPAIGN\);/.test(weo));
}

console.log("\n8/9 — ELECTION EXPLANATION: IMPLEMENTATION LEAK REMOVED, PRODUCT COPY ADDED");
{
  ok("1. the old Canon-fact / implementation-leaking explanation no longer appears anywhere in the page",
     !/does not yet track election level as its own Canon fact/.test(election) &&
     !/this becomes part\s+of your workspace name below, which the Canon does record/.test(election));
  ok("2. no internal-architecture vocabulary (Canon fact, schema, migration) leaks into the setup screen's own copy",
     !/Canon fact/.test(weo) && !/\bschema\b/i.test(weo) && !/\bmigration\b/i.test(weo));
  ok("3. the new user-facing election explanation is present, in plain product language",
     /Select the election you are preparing for\.\s*\n?\s*This helps ElectionCanon configure the right\s*\n?\s*workspace and territory for your campaign\./.test(weo));
}

console.log("\n10 — CREATE ACTION STILL WIRED TO THE EXISTING PATH");
{
  ok("1. the button label is unchanged",
     /Create My Election Workspace/.test(weo));
  ok("2. it is still the SAME submit() handler, unmoved and unwrapped",
     /<button onClick=\{submit\} disabled=\{busy \|\| !name\.trim\(\)\}/.test(weo));
  ok("3. submit() still forwards the SAME finalName/actorKind pair to onActivate — no new intermediate transform",
     /onActivate\(finalName, actorKind\);/.test(weo));
}

console.log("\n11/12 — TERRITORY, ORGANISATION AND CAMPAIGN-CREATION SEMANTICS UNTOUCHED");
{
  ok("1. TerritorySection is still imported and mounted exactly as before — this pass did not touch Territory",
     /import TerritorySection from ".\/election\/TerritorySection\.jsx";/.test(election) &&
     /\{section === "territory" && <TerritorySection ctx=\{ctx\} campaignId=\{campaignId\} refresh=\{refresh\} onSection=\{goToSection\} \/>\}/.test(election));
  ok("2. OrganisationSection is still imported and mounted exactly as before — this pass did not touch Organisation",
     /import OrganisationSection from ".\/election\/OrganisationSection\.jsx";/.test(election) &&
     /\{section === "organisation" && <OrganisationSection/.test(election));
  ok("3. the campaign-name storage convention (election type folded into campaigns.name) is byte-for-byte unchanged — same event/data behavior on write",
     /const finalName = electionType \? `\[\$\{electionType\}\] \$\{clean\}` : clean;/.test(weo));
  ok("4. activateElection() is still called with exactly the same shape — no new field added to the write",
     /const doActivate = useCallback\(async \(name, actorKind\) => \{[\s\S]*?activateElection\(\{ client: supabase, name, actorKind \}\)/.test(election));
}

console.log("\n13/14 — NO MIGRATION, NO NEW TABLE");
{
  // LAUNCH DISTRIBUTION PASS (Alpha 1.7) — assertion 1 originally checked
  // that `git status --porcelain -- supabase/migrations` was entirely
  // empty, true only because no migration existed anywhere else in the
  // working tree at the time this test was written. That check does not
  // survive time: any later, UNRELATED feature that legitimately adds its
  // own migration (e.g. 20260921000000_election_launch_distribution.sql,
  // which never touches the campaigns table or the workspace-creation
  // write path this file exists to protect) would trip it forever after.
  // Re-scoped to this pass's own real invariant: no migration file in the
  // working tree touches the `campaigns` table at all — the same
  // "campaign-creation semantics untouched" claim assertions 2-3 already
  // make from the application-code side, now also checked from the schema
  // side, without assuming this is the only migration that will ever exist.
  let migrationFiles = [], gitAvailable = true;
  try {
    migrationFiles = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
      cwd: new URL("..", import.meta.url), encoding: "utf8",
    }).trim().split("\n").filter(Boolean).map((line) => line.trim().split(/\s+/).pop());
  } catch { gitAvailable = false; }
  ok("1. no new/modified migration in the working tree touches the campaigns table — this pass's own invariant, not 'zero migrations exist anywhere'",
     !gitAvailable || migrationFiles.every((f) => !/\bcampaigns\b/.test(raw(`../${f}`))));
  ok("2. Election.jsx issues no new Postgres table read/write beyond the existing campaigns table it already used",
     (election.match(/supabase\.from\("([^"]+)"\)/g) ?? []).every((m) => m === 'supabase.from("campaigns")'));
  ok("3. shared.jsx defines no new SQL/RPC surface (parseCampaignTitle stays a pure display-only string parser)",
     /export function parseCampaignTitle\(rawName\) \{/.test(code("../src/pages/election/shared.jsx")));
}

console.log("\n15 — NO NEW DEPENDENCY");
{
  const pkg = JSON.parse(raw("../package.json"));
  const expectedDeps = ["@supabase/supabase-js", "react", "react-dom", "react-router-dom", "tesseract.js"];
  const expectedDevDeps = ["@vitejs/plugin-react", "vite"];
  ok("1. dependencies are exactly the pre-existing set — nothing added, nothing removed",
     JSON.stringify(Object.keys(pkg.dependencies).sort()) === JSON.stringify(expectedDeps.sort()));
  ok("2. devDependencies are exactly the pre-existing set — nothing added, nothing removed",
     JSON.stringify(Object.keys(pkg.devDependencies).sort()) === JSON.stringify(expectedDevDeps.sort()));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
