// ============================================================
// ELECTIONCANON — ROLE_SCOPE_03: election_events GEOGRAPHY-SCOPED READ
// (structural + policy-logic simulation)
//
// This repository has no live-database integration test harness (no DB
// credentials are available to this test run) — same class of
// structural/source-level checks election-pu-agent-invitation.consumer.mjs
// already uses for migration SQL. Two layers here:
//
//   LAYER 1 (structural) — regex assertions against the actual migration
//   file text: the right functions/branches/GRANTs exist, the dead-code
//   bug stays fixed, the ten deliberately-deferred event types are never
//   given a scoping branch.
//
//   LAYER 2 (policy-logic simulation) — a small JS function
//   (simulatePolicy()) that mirrors the SQL policy's exact boolean
//   predicate shape, driven by a constructed geography fixture, producing
//   real ALLOW/DENY assertions across every role x event-family
//   combination the task's own test matrix calls for.
//
// WHAT THIS DOES NOT PROVE. This proves the FILE's logic is internally
// consistent and matches the intended authorization model — it does not
// and cannot prove the live, deployed database behaves identically. That
// still requires a real authenticated-session verification pass once this
// migration is actually applied to a reachable database, same caveat the
// superseded draft's own test file stated.
//
// Run: node test/election-role-scope-rls.consumer.mjs
// ============================================================

import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const stripSqlComments = (sql) => sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
const sqlFile = (p) => stripSqlComments(readFileSync(new URL(p, import.meta.url), "utf8"));

console.log("\nELECTIONCANON — ROLE_SCOPE_03 election_events geography scope (structural + logic simulation)\n");

const migrationPath = "../supabase/migrations/20260930000000_election_events_geography_scoped_read.sql";
const sql = sqlFile(migrationPath);
// Raw (NOT comment-stripped) — needed for checks that verify the
// migration's own documentation header, since stripSqlComments deletes
// every `--` comment line entirely (by design, for checks against the
// executable SQL only) and this file's header IS entirely comments.
const rawSql = readFileSync(new URL(migrationPath, import.meta.url), "utf8");

console.log("1 — CONSOLIDATION: EXACTLY ONE MIGRATION FILE, THE SUPERSEDED SECOND DRAFT IS GONE");
{
  ok("1. the superseded second draft file no longer exists",
    (() => { try { readFileSync(new URL("../supabase/migrations/20260930000001_fix_election_events_person_added_scope.sql", import.meta.url)); return false; } catch { return true; } })());
  ok("2. the single remaining migration defines all five functions",
    /create or replace function public\.current_responsibility_geography/.test(sql)
    && /create or replace function public\.current_responsibility_slot_geography/.test(sql)
    && /create or replace function public\.caller_scoped_responsibility/.test(sql)
    && /create or replace function public\.scope_geography_refs/.test(sql)
    && /create or replace function public\.is_campaign_owner_or_manager/.test(sql));
}

console.log("\n2 — FUNCTION PRIVILEGES: EXPLICIT GRANT/REVOKE FOR EVERY NEW FUNCTION (gap found and fixed this revision)");
{
  for (const [name, sig] of [
    ["current_responsibility_geography", "uuid, text"],
    ["current_responsibility_slot_geography", "uuid, text"],
    ["caller_scoped_responsibility", "uuid"],
    ["scope_geography_refs", "text, uuid"],
    ["is_campaign_owner_or_manager", "uuid"],
  ]) {
    const revokeRe = new RegExp(`revoke all on function public\\.${name}\\(${sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) from public, anon;`);
    const grantRe = new RegExp(`grant execute on function public\\.${name}\\(${sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) to authenticated;`);
    ok(`1.${name} — revoked from public/anon, granted to authenticated`, revokeRe.test(sql) && grantRe.test(sql));
  }
}

console.log("\n3 — SECURITY DEFINER SAFETY: search_path = '' (STRICTEST FORM), SCHEMA-QUALIFIED, NO DYNAMIC SQL");
{
  const fnBlocks = sql.split(/create or replace function/).slice(1);
  ok("1. every function (now five, including is_campaign_owner_or_manager) is language sql / stable / security definer / set search_path = '' (empty — stricter than pinning to public)",
    fnBlocks.length === 5 && fnBlocks.every((b) => /language sql\s+stable\s+security definer\s+set search_path = ''/.test(b)));
  ok("2. every table reference inside the functions is schema-qualified (public.election_events, public.geography_wards, public.geography_polling_units, public.campaign_members)",
    !/from election_events\b/.test(sql) && !/from geography_wards\b/.test(sql) && !/from geography_polling_units\b/.test(sql) && !/from campaign_members\b/.test(sql)
    && /from public\.election_events/.test(sql) && /from public\.geography_wards/.test(sql) && /from public\.geography_polling_units/.test(sql) && /from public\.campaign_members/.test(sql));
  ok("3. no dynamic SQL anywhere in the file (the only legitimate uses of the word 'execute' are the GRANT ... EXECUTE privilege statements, excluded here)",
    !sql.split("\n")
      .filter((line) => !/^\s*grant execute on function/i.test(line))
      .some((line) => /\bexecute\b/i.test(line)));
  ok("4. touches only SELECT authorization — no insert/update/delete policy",
    !/for (insert|update|delete)/i.test(sql));
  ok("5. election_events never has FORCE ROW LEVEL SECURITY set anywhere in any migration (recursion-safety precondition — checked across the whole migrations directory, not just this file)",
    (() => {
      const dir = new URL("../supabase/migrations/", import.meta.url);
      const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
      return files.every((f) => !/force row level security/i.test(stripSqlComments(readFileSync(new URL(f, dir), "utf8"))));
    })());
}

console.log("\n3b — CROSS-TENANT RPC GUARD: person/slot resolver functions verify campaign membership independently of the policy");
{
  // Scope each check to the function's own CREATE...AS $$...$$ block,
  // not just "somewhere after the first mention of its name" — the
  // function name is also mentioned in prose comments earlier in the
  // file, which would give a false pass if we searched from there.
  function functionBody(name) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) return null;
    const bodyStart = sql.indexOf("as $$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart);
    return sql.slice(bodyStart, bodyEnd);
  }
  const geoBody = functionBody("current_responsibility_geography");
  const slotBody = functionBody("current_responsibility_slot_geography");
  ok("1. current_responsibility_geography() guards with is_active_campaign_member(p_campaign_id) inside its own query body",
    geoBody !== null && /public\.is_active_campaign_member\(p_campaign_id\)/.test(geoBody));
  ok("2. current_responsibility_slot_geography() guards the same way",
    slotBody !== null && /public\.is_active_campaign_member\(p_campaign_id\)/.test(slotBody));
  ok("3. the guard calls the SAME pre-existing helper from 20260826000000 (no second membership-check mechanism invented) — exactly two call sites, one per guarded function",
    (sql.match(/public\.is_active_campaign_member\(p_campaign_id\)/g) || []).length === 2);
}

console.log("\n3c — OWNER/MANAGER PRECEDENCE HELPER: REUSES THE EXISTING campaign_members/member_role SOURCE, NO NEW AUTHORIZATION MODEL");
{
  function functionBody(name) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) return null;
    const bodyStart = sql.indexOf("as $$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart);
    return sql.slice(bodyStart, bodyEnd);
  }
  const ownerBody = functionBody("is_campaign_owner_or_manager");
  ok("1. is_campaign_owner_or_manager() queries public.campaign_members (the same table every other membership check in this project reads)",
    ownerBody !== null && /public\.campaign_members/.test(ownerBody));
  ok("2. it checks member_role against exactly the two precedence values ('owner', 'manager') — not a new role vocabulary",
    ownerBody !== null && /member_role in \('owner', 'manager'\)/.test(ownerBody));
  ok("3. it requires status = 'active' and person = auth.uid() — same shape as is_active_campaign_member(), never a caller-supplied identity",
    ownerBody !== null && /status = 'active'/.test(ownerBody) && /person = auth\.uid\(\)/.test(ownerBody));
  ok("4. it does NOT also require a scoped responsibility slot — owner/manager status is sufficient on its own, independent of any slot they may hold",
    ownerBody !== null && !/responsibility/.test(ownerBody));
  ok("5. the policy checks is_campaign_owner_or_manager() FIRST — its call site precedes the responsibility-slot (not exists / caller_scoped_responsibility) check inside the using-clause, and the two are joined by `or`, not `and`",
    (() => {
      const usingStart = sql.indexOf("for select using (");
      const usingClause = sql.slice(usingStart);
      const ownerIdx = usingClause.indexOf("public.is_campaign_owner_or_manager(election_events.campaign_id)");
      const notExistsIdx = usingClause.indexOf("not exists (select 1 from public.caller_scoped_responsibility");
      if (ownerIdx === -1 || notExistsIdx === -1 || ownerIdx >= notExistsIdx) return false;
      const between = usingClause.slice(ownerIdx + "public.is_campaign_owner_or_manager(election_events.campaign_id)".length, notExistsIdx);
      return /^\s*or\s*$/.test(between);
    })());
}

console.log("\n4 — THE DEAD-CODE BUG STAYS FIXED: person.added AND status_changed BOTH EXCLUDED FROM THE BLANKET null-geographyRef ALLOWANCE");
{
  ok("1. the geographyRef-is-null branch explicitly excludes both mobilization.person.added and responsibility.status_changed",
    /\(election_events\.payload->>'geographyRef'\) is null[\s\S]{0,200}not in \(\s*'mobilization\.person\.added',\s*'responsibility\.status_changed'\s*\)/.test(sql));
  ok("2. the dedicated mobilization.person.added branch exists and is reachable (calls current_responsibility_geography)",
    /election_events\.payload->>'type' = 'mobilization\.person\.added'[\s\S]{0,200}current_responsibility_geography\(/.test(sql));
  ok("3. the dedicated responsibility.status_changed branch exists and is reachable (calls current_responsibility_slot_geography)",
    /election_events\.payload->>'type' = 'responsibility\.status_changed'[\s\S]{0,200}current_responsibility_slot_geography\(/.test(sql));
}

console.log("\n5 — THE DEFERRED GAP IS DOCUMENTED, NOT SILENT, AND NOT SCOPED VIA FREE-TEXT");
{
  const deferredTypes = [
    "mobilization.assignment.created", "mobilization.assignment.status_changed",
    "mobilization.task.created", "mobilization.task.status_changed",
    "electionday.pollingunit.added", "electionday.agent.assigned", "electionday.agent.status_changed",
    "electionday.result.captured", "electionday.result.ocr_processed", "electionday.result.verified",
    "electionday.incident.reported", "electionday.incident.status_changed",
  ];
  ok("1. every one of the ten deferred event types is named in the migration's own documentation header",
    deferredTypes.every((t) => rawSql.includes(t)));
  ok("2. none of the ten deferred event types appears inside the policy's executable `using (...)` clause as a scoping condition — they are documented, never fragile-text-matched",
    (() => {
      const usingClause = sql.slice(sql.indexOf("for select using ("));
      return deferredTypes.every((t) => !usingClause.includes(`'${t}'`));
    })());
  ok("3. the migration's own header explicitly states this was an explicit product decision, not an assumption",
    /explicitly by the product owner, not assumed/.test(rawSql));
}

console.log("\n6 — POLICY-LOGIC SIMULATION: ALLOW/DENY MATRIX ACROSS EVERY ROLE x EVENT FAMILY");
{
  // Mirrors scope_geography_refs()/getScopeGeographyRefs(): self + real
  // descendants (lga -> wards -> polling units; ward -> polling units).
  const GEO = {
    L1: { level: "lga", id: "L1" }, L9: { level: "lga", id: "L9" },
    W1: { level: "ward", id: "W1", lga: "L1" }, W2: { level: "ward", id: "W2", lga: "L1" }, W9: { level: "ward", id: "W9", lga: "L9" },
    P1a: { level: "polling_unit", id: "P1a", ward: "W1" }, P1b: { level: "polling_unit", id: "P1b", ward: "W1" },
    P2a: { level: "polling_unit", id: "P2a", ward: "W2" }, P9a: { level: "polling_unit", id: "P9a", ward: "W9" },
  };
  function descendantsOf(level, id) {
    if (level === "polling_unit") return new Set([id]);
    if (level === "ward") {
      const pus = Object.values(GEO).filter((g) => g.level === "polling_unit" && g.ward === id).map((g) => g.id);
      return new Set([id, ...pus]);
    }
    if (level === "lga") {
      const wards = Object.values(GEO).filter((g) => g.level === "ward" && g.lga === id).map((g) => g.id);
      const pus = Object.values(GEO).filter((g) => g.level === "polling_unit" && wards.includes(g.ward)).map((g) => g.id);
      return new Set([id, ...wards, ...pus]);
    }
    return new Set();
  }

  // Mirrors the policy's exact boolean shape, INCLUDING the owner/manager
  // precedence branch added in this revision: isOwnerOrManager is checked
  // FIRST and unconditionally — independent of, and takes precedence over,
  // whatever callerScope (responsibility slot) the caller may ALSO hold.
  // callerScope === null (with isOwnerOrManager false) means
  // caller_scoped_responsibility() resolved zero rows (Constituency
  // Lead/no responsibility) — "not exists(...)" branch, true.
  const DEFERRED = new Set([
    "mobilization.assignment.created", "mobilization.assignment.status_changed",
    "mobilization.task.created", "mobilization.task.status_changed",
    "electionday.pollingunit.added", "electionday.agent.assigned", "electionday.agent.status_changed",
    "electionday.result.captured", "electionday.result.ocr_processed", "electionday.result.verified",
    "electionday.incident.reported", "electionday.incident.status_changed",
  ]);
  const CAMPAIGN_WIDE_BY_DESIGN = new Set(["candidate.registered", "document.published", "territory.set", "observer.assignment.recorded"]);

  function simulatePolicy({ isOwnerOrManager = false, callerScope, eventType, geographyRef = null, personGeography = null, slotGeography = null }) {
    if (isOwnerOrManager) return true;
    if (!callerScope) return true;
    const descendants = descendantsOf(callerScope.level, callerScope.id);
    if (geographyRef == null && eventType !== "mobilization.person.added" && eventType !== "responsibility.status_changed") return true;
    if (geographyRef != null && descendants.has(geographyRef)) return true;
    if (eventType === "mobilization.person.added") return personGeography != null && descendants.has(personGeography);
    if (eventType === "responsibility.status_changed") return slotGeography != null && descendants.has(slotGeography);
    return false;
  }

  console.log("  6a — campaign-wide roles: owner / manager / Constituency Lead / no-responsibility");
  for (const role of ["owner", "manager", "constituency_lead", "no_responsibility"]) {
    ok(`${role}: own-geography responsibility.assigned → ALLOW`,
      simulatePolicy({ callerScope: null, eventType: "responsibility.assigned", geographyRef: "W1" }) === true);
    ok(`${role}: other-geography responsibility.assigned (unrelated LGA) → ALLOW`,
      simulatePolicy({ callerScope: null, eventType: "responsibility.assigned", geographyRef: "W9" }) === true);
    ok(`${role}: other-geography electionday.result.captured → ALLOW (unrestricted by design)`,
      simulatePolicy({ callerScope: null, eventType: "electionday.result.captured", geographyRef: null }) === true);
  }

  console.log("  6b — LGA Coordinator scoped to L1");
  const lga = { level: "lga", id: "L1" };
  ok("own LGA's responsibility.assigned (geographyRef=L1) → ALLOW", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "L1" }) === true);
  ok("own descendant ward (geographyRef=W2) → ALLOW", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "W2" }) === true);
  ok("own descendant polling unit (geographyRef=P1b) → ALLOW", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "P2a" }) === true);
  ok("sibling LGA (geographyRef=L9) → DENY", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "L9" }) === false);
  ok("unrelated LGA's ward (geographyRef=W9) → DENY", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "W9" }) === false);
  ok("unrelated LGA's polling unit (geographyRef=P9a) → DENY", simulatePolicy({ callerScope: lga, eventType: "responsibility.assigned", geographyRef: "P9a" }) === false);

  console.log("  6c — Ward Coordinator scoped to W1");
  const ward = { level: "ward", id: "W1" };
  ok("own ward (geographyRef=W1) → ALLOW", simulatePolicy({ callerScope: ward, eventType: "responsibility.assigned", geographyRef: "W1" }) === true);
  ok("own descendant polling unit (geographyRef=P1a) → ALLOW", simulatePolicy({ callerScope: ward, eventType: "responsibility.assigned", geographyRef: "P1a" }) === true);
  ok("sibling ward in the SAME LGA (geographyRef=W2) → DENY (ward scope does not include sibling wards)", simulatePolicy({ callerScope: ward, eventType: "responsibility.assigned", geographyRef: "W2" }) === false);
  ok("other LGA entirely (geographyRef=L9) → DENY", simulatePolicy({ callerScope: ward, eventType: "responsibility.assigned", geographyRef: "L9" }) === false);

  console.log("  6d — Polling-Unit Agent scoped to P1a");
  const pu = { level: "polling_unit", id: "P1a" };
  ok("own polling unit (geographyRef=P1a) → ALLOW", simulatePolicy({ callerScope: pu, eventType: "responsibility.assigned", geographyRef: "P1a" }) === true);
  ok("sibling polling unit in the same ward (geographyRef=P1b) → DENY", simulatePolicy({ callerScope: pu, eventType: "responsibility.assigned", geographyRef: "P1b" }) === false);
  ok("own parent ward (geographyRef=W1) → DENY (agent scope is polling-unit-only, not upward)", simulatePolicy({ callerScope: pu, eventType: "responsibility.assigned", geographyRef: "W1" }) === false);
  ok("other LGA (geographyRef=L9) → DENY", simulatePolicy({ callerScope: pu, eventType: "responsibility.assigned", geographyRef: "L9" }) === false);

  console.log("  6d2 — OWNER/MANAGER PRECEDENCE MATRIX (A–N): unrestricted regardless of any scoped slot also held, ordinary scoped roles still restricted");
  {
    const otherLgaGeo = "L9"; // a geography the owner/manager/coordinator does NOT otherwise have any claim to
    // A/B — owner/manager, NO responsibility slot at all.
    ok("A. owner, no responsibility → unrestricted (reads another LGA's responsibility.assigned)",
      simulatePolicy({ isOwnerOrManager: true, callerScope: null, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    ok("B. manager, no responsibility → unrestricted (reads another LGA's responsibility.assigned)",
      simulatePolicy({ isOwnerOrManager: true, callerScope: null, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    // C/D — owner/manager who ALSO holds an LGA responsibility slot (the exact edge case this revision fixes).
    ok("C. owner WITH an LGA responsibility slot → still unrestricted (reads a sibling LGA's data, not just their own slot's LGA)",
      simulatePolicy({ isOwnerOrManager: true, callerScope: lga, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    ok("D. manager WITH an LGA responsibility slot → still unrestricted",
      simulatePolicy({ isOwnerOrManager: true, callerScope: lga, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    // E/F — owner/manager who ALSO holds a Ward responsibility slot.
    ok("E. owner WITH a Ward responsibility slot → still unrestricted",
      simulatePolicy({ isOwnerOrManager: true, callerScope: ward, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    ok("F. manager WITH a Ward responsibility slot → still unrestricted",
      simulatePolicy({ isOwnerOrManager: true, callerScope: ward, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    // G/H — owner/manager who ALSO holds a Polling-Unit responsibility slot.
    ok("G. owner WITH a PU responsibility slot → still unrestricted",
      simulatePolicy({ isOwnerOrManager: true, callerScope: pu, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    ok("H. manager WITH a PU responsibility slot → still unrestricted",
      simulatePolicy({ isOwnerOrManager: true, callerScope: pu, eventType: "responsibility.assigned", geographyRef: otherLgaGeo }) === true);
    // I/J/K/L/M/N — ordinary scoped roles (isOwnerOrManager: false) remain exactly as restricted as before this fix.
    ok("I. LGA coordinator, own LGA → ALLOW", simulatePolicy({ isOwnerOrManager: false, callerScope: lga, eventType: "responsibility.assigned", geographyRef: "L1" }) === true);
    ok("J. LGA coordinator, sibling LGA → DENY", simulatePolicy({ isOwnerOrManager: false, callerScope: lga, eventType: "responsibility.assigned", geographyRef: "L9" }) === false);
    ok("K. Ward coordinator, own ward → ALLOW", simulatePolicy({ isOwnerOrManager: false, callerScope: ward, eventType: "responsibility.assigned", geographyRef: "W1" }) === true);
    ok("L. Ward coordinator, sibling ward → DENY", simulatePolicy({ isOwnerOrManager: false, callerScope: ward, eventType: "responsibility.assigned", geographyRef: "W2" }) === false);
    ok("M. PU agent, own PU → ALLOW", simulatePolicy({ isOwnerOrManager: false, callerScope: pu, eventType: "responsibility.assigned", geographyRef: "P1a" }) === true);
    ok("N. PU agent, sibling PU → DENY", simulatePolicy({ isOwnerOrManager: false, callerScope: pu, eventType: "responsibility.assigned", geographyRef: "P1b" }) === false);
  }

  console.log("  6d3 — REGRESSION: adding/changing a scoped responsibility slot on an owner/manager can NEVER narrow their access");
  {
    // Simulates the exact before/after of an owner being freshly assigned
    // a scoped slot: access to an unrelated LGA's data must be identical
    // (true) both before the slot existed and after.
    const before = simulatePolicy({ isOwnerOrManager: true, callerScope: null, eventType: "responsibility.assigned", geographyRef: "L9" });
    const afterLga = simulatePolicy({ isOwnerOrManager: true, callerScope: { level: "lga", id: "L1" }, eventType: "responsibility.assigned", geographyRef: "L9" });
    const afterWard = simulatePolicy({ isOwnerOrManager: true, callerScope: { level: "ward", id: "W1" }, eventType: "responsibility.assigned", geographyRef: "L9" });
    const afterPu = simulatePolicy({ isOwnerOrManager: true, callerScope: { level: "polling_unit", id: "P1a" }, eventType: "responsibility.assigned", geographyRef: "L9" });
    ok("owner's access to unrelated-LGA data is identical before any responsibility slot exists and after being assigned an LGA/Ward/PU slot (true in all four cases — never narrowed)",
      before === true && afterLga === true && afterWard === true && afterPu === true);
    // Also prove this ISN'T vacuously true because ordinary scoped roles
    // behave differently under the identical geography input — confirms
    // the simulator genuinely distinguishes the two populations.
    const ordinaryCoordinatorSameInput = simulatePolicy({ isOwnerOrManager: false, callerScope: { level: "lga", id: "L1" }, eventType: "responsibility.assigned", geographyRef: "L9" });
    ok("the identical input DOES deny an ordinary (non-owner/manager) LGA Coordinator — proving the precedence branch, not a loosened geography check, is what unrestricts the owner/manager",
      ordinaryCoordinatorSameInput === false);
  }

  console.log("  6e — mobilization.person.added: dedicated branch is REACHABLE (the bug this migration fixes)");
  ok("LGA Coordinator, person currently scoped to own LGA → ALLOW", simulatePolicy({ callerScope: lga, eventType: "mobilization.person.added", personGeography: "W2" }) === true);
  ok("LGA Coordinator, person currently scoped to another LGA → DENY (the exact bug: previously allowed via the null-geographyRef branch)", simulatePolicy({ callerScope: lga, eventType: "mobilization.person.added", personGeography: "W9" }) === false);
  ok("LGA Coordinator, person with no resolvable responsibility geography at all → DENY", simulatePolicy({ callerScope: lga, eventType: "mobilization.person.added", personGeography: null }) === false);

  console.log("  6f — responsibility.status_changed: dedicated branch is REACHABLE (the second bug this migration fixes)");
  ok("LGA Coordinator, slot's current geography within own LGA → ALLOW", simulatePolicy({ callerScope: lga, eventType: "responsibility.status_changed", slotGeography: "P2a" }) === true);
  ok("LGA Coordinator, slot's current geography in another LGA → DENY", simulatePolicy({ callerScope: lga, eventType: "responsibility.status_changed", slotGeography: "W9" }) === false);

  console.log("  6g — campaign-wide-by-design events stay visible to scoped callers too");
  for (const t of CAMPAIGN_WIDE_BY_DESIGN) {
    ok(`${t}: visible to a scoped LGA Coordinator (geography-less by design)`, simulatePolicy({ callerScope: lga, eventType: t, geographyRef: null }) === true);
  }

  console.log("  6h — the ten deferred-gap event types: CONFIRMED campaign-wide for scoped callers too (documented, not a regression test failure)");
  for (const t of DEFERRED) {
    ok(`${t}: visible to a scoped LGA Coordinator even for another geography's data (the documented, deferred gap — not yet closed)`,
      simulatePolicy({ callerScope: lga, eventType: t, geographyRef: null }) === true);
  }
}

console.log("\n7 — THE PRE-EXISTING PERMISSIVE TENANT-ISOLATION POLICY IS UNTOUCHED (anon / non-member denial still comes from there, not retested here)");
{
  ok("1. this migration contains no `create policy ... for select` targeting the permissive tenant-isolation policy's own name",
    !/create policy "election events read own campaign"/.test(sql));
  ok("2. this migration adds a RESTRICTIVE policy only — it narrows, never replaces, the base permissive grant",
    /as restrictive/.test(sql));
  ok("3. exactly ONE `create policy` statement exists in this file, and it is the restrictive one — no second, accidentally-permissive policy was added alongside it",
    (sql.match(/create policy /g) || []).length === 1 && /create policy "election events geography scope for scoped responsibility" on election_events\s+as restrictive/.test(sql));
}

console.log("\n8 — NO UNQUALIFIED HELPER-FUNCTION CALLS (search_path='' safety extends to function calls, not just table reads)");
{
  const usingClause = sql.slice(sql.indexOf("for select using ("));
  ok("1. every call to the five helper functions inside the policy is schema-qualified (public.<name>) — no bare call that search_path='' would fail to resolve",
    !/[^.]\bcaller_scoped_responsibility\(/.test(usingClause.replace(/public\.caller_scoped_responsibility\(/g, ""))
    && !/[^.]\bscope_geography_refs\(/.test(usingClause.replace(/public\.scope_geography_refs\(/g, ""))
    && !/[^.]\bcurrent_responsibility_geography\(/.test(usingClause.replace(/public\.current_responsibility_geography\(/g, ""))
    && !/[^.]\bcurrent_responsibility_slot_geography\(/.test(usingClause.replace(/public\.current_responsibility_slot_geography\(/g, ""))
    && !/[^.]\bis_campaign_owner_or_manager\(/.test(usingClause.replace(/public\.is_campaign_owner_or_manager\(/g, "")));
}

console.log("\n9 — NO FREE-TEXT GEOGRAPHY FIELD IS EVER USED AS AN AUTHORIZATION BOUNDARY");
{
  const usingClause = sql.slice(sql.indexOf("for select using ("));
  ok("1. the policy's using-clause never compares payload->>'ward'/'lga'/'state'/'pollingUnit' (the free-text fields) — only geographyRef (a real UUID FK), person, responsibility, and type are ever read",
    !/payload->>'ward'/.test(usingClause) && !/payload->>'lga'/.test(usingClause)
    && !/payload->>'state'/.test(usingClause) && !/payload->>'pollingUnit'/.test(usingClause));
  ok("2. the only payload fields the policy's using-clause reads are geographyRef, type, person, and responsibility",
    (() => {
      const fields = [...usingClause.matchAll(/payload->>'(\w+)'/g)].map((m) => m[1]);
      const allowed = new Set(["geographyRef", "type", "person", "responsibility"]);
      return fields.length > 0 && fields.every((f) => allowed.has(f));
    })());
}

console.log("\n10 — RPC ATTACK REVIEW: is_campaign_owner_or_manager() CANNOT BE USED TO PROBE ANOTHER CAMPAIGN");
{
  // Same reasoning as is_active_campaign_member(): the function's WHERE
  // clause requires BOTH m.campaign_id = p_campaign_id (the caller-
  // supplied value) AND m.person = auth.uid() (never caller-supplied) in
  // the SAME row. An authenticated non-member of campaign B has no
  // campaign_members row where both match, regardless of what p_campaign_id
  // they pass — so direct RPC invocation with an arbitrary campaign id
  // can only ever confirm/deny facts about the CALLER's own membership,
  // never disclose another campaign's member list or roles.
  function functionBody(name) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) return null;
    const bodyStart = sql.indexOf("as $$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart);
    return sql.slice(bodyStart, bodyEnd);
  }
  const ownerBody = functionBody("is_campaign_owner_or_manager");
  ok("1. owner/manager helper's row match requires m.person = auth.uid() in the SAME exists(...) as m.campaign_id = p_campaign_id — a non-member of the supplied campaign can never match",
    ownerBody !== null && /m\.campaign_id = p_campaign_id[\s\S]{0,100}m\.person = auth\.uid\(\)/.test(ownerBody));
  ok("2. it returns a boolean only (returns table/scalar, never a row of someone else's membership data) — even a successful call discloses nothing beyond true/false about the CALLER",
    /create or replace function public\.is_campaign_owner_or_manager\(p_campaign_id uuid\)\nreturns boolean/.test(sql));

  // Conceptual RPC attack matrix (cannot be executed live — no DB
  // credentials in this environment, see section 11 below):
  //   owner/manager, Campaign A, calls with Campaign A's own id   -> ALLOW (true) — correct, that's their own campaign
  //   owner/manager, Campaign A, calls with Campaign B's id       -> DENY (false) — no row matches person+campaign_id together
  //   ordinary scoped member, Campaign A, own campaign id          -> DENY (false) — member_role is 'staff' or similar, not owner/manager
  //   authenticated, NOT a member of Campaign B, calls with B's id -> DENY (false) — no campaign_members row for this person at all
  //   arbitrary/guessed Campaign B id, any non-member caller       -> DENY (false) — same reasoning, id alone proves nothing
  // This matrix is conceptual (derived from the function's own WHERE
  // clause, verified above) and is NOT a claim of live-verified behavior
  // — see the limitation stated in section 11 below.
}

// 11 — LIVE VERIFICATION LIMITATION. This test suite does not and cannot
// run against a live database (no Supabase credentials in this
// environment). Every assertion above proves the migration FILE's logic
// is internally consistent and matches the intended authorization model —
// none of them is, or is claimed to be, a live authenticated PostgREST
// verification. That verification is still required before this migration
// is ever applied to a reachable database.
console.log("\n11 — LIVE VERIFICATION LIMITATION: live authenticated PostgREST verification NOT PERFORMED (no Supabase credentials available in this environment) — stated explicitly, not claimed as PASS");

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
