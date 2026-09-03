// ============================================================
// ELECTORAL GEOGRAPHY — RESPONSIBILITY + TERRITORY READINESS  (MOCK evidence)
//
// Same fake-client pattern as election-mobilization.consumer.mjs and
// election-geography.consumer.mjs. Proves: responsibility assignment/status
// folds correctly, ward/polling-unit assignment is REFUSED (not fabricated)
// while no real geography is imported, deriveTerritoryReadiness computes a
// real percentage from real rows, and tenant isolation holds.
// ============================================================

import {
  proposeAssignResponsibility, executeAssignResponsibility,
  proposeChangeResponsibilityStatus, executeChangeResponsibilityStatus,
  RESPONSIBILITY_ROLE,
} from "../src/domains/election/geography/write.js";
import { deriveTerritoryReadiness } from "../src/domains/election/studio/territoryReadiness.js";
import { projectElection } from "../src/domains/election/projections.js";
import { ELECTION_EVENT_TYPES } from "../src/domains/election/events.js";
import { backfillResponsibilitySlots, makeWriteResponsibilityHandler } from "./lib/fakeWriteResponsibility.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTORAL GEOGRAPHY — Responsibility + Territory Readiness\n");

// ELECTIONCANON 1.1 PHASE 1 — executeAssignResponsibility() now calls
// client.rpc('write_responsibility', ...) instead of a raw
// election_events insert (see geography/write.js's own header on why:
// the split-brain-consistency fix this project's Design Gate 1A found).
// This fake client's `.rpc()` handler is test/lib/
// fakeWriteResponsibility.mjs's shared, instruction-for-instruction
// mirror of the real SQL function — the SAME "prove the real security
// logic" discipline test/election-invitations.consumer.mjs's own header
// already established. `.from('election_events').insert()` is STILL used
// directly by this file's own territory-readiness fixture (TERRITORY.SET
// events, seeded directly, not through any propose/execute pair) and
// still simulates the event_id uniqueness constraint for that path — it
// is UNCHANGED for anything that isn't a responsibility write.
function fakeEventClient() {
  const eventRows = [];
  const campaignMembers = [
    { campaign_id: CAMPAIGN_A, person: USER, member_role: "owner", status: "active" },
    { campaign_id: CAMPAIGN_B, person: USER, member_role: "owner", status: "active" },
  ];
  const geography = { lgas: [{ id: LGA_OKPE }, { id: LGA_SAPELE }, { id: LGA_UVWIE }], wards: [{ id: "ward-1", lgaId: LGA_OKPE }] };
  const slots = backfillResponsibilitySlots(eventRows);
  const writeResponsibility = makeWriteResponsibilityHandler({ campaignMembers, eventRows, geography, slots });

  const client = {
    __uid: USER,
    // A LIVE getter, not a snapshot — logFor() (below) reads `client.rows`
    // AFTER writes have happened, so this must reflect eventRows at
    // access time, not at fakeEventClient() construction time.
    get rows() { return eventRows.map((r) => ({ table: "election_events", ...r })); },
    async rpc(name, params) {
      if (name === "write_responsibility") return writeResponsibility(client.__uid, params);
      return { data: null, error: { message: `unmocked rpc ${name}` } };
    },
    from(table) {
      return {
        insert: async (row) => {
          if (eventRows.some((r) => r.event_id === row.event_id)) {
            const err = new Error('duplicate key value violates unique constraint "election_events_event_id_key"');
            err.code = "23505";
            return { error: err };
          }
          eventRows.push({ event_id: row.event_id, campaign_id: row.campaign_id, type: row.type, actor: row.actor, payload: row.payload });
          return { error: null };
        },
      };
    },
  };
  return client;
}
const logFor = (client, campaignId) =>
  client.rows.filter((r) => r.table === "election_events" && r.campaign_id === campaignId).map((r) => r.payload).reverse();

const CAMPAIGN_A = "camp-a";
const CAMPAIGN_B = "camp-b";
const USER = "user-1";

const ROSTER = [{ id: "person-1", name: "Amaka Obi", roleType: "lga_coordinator" }];
const LGA_OKPE = "lga-okpe", LGA_SAPELE = "lga-sapele", LGA_UVWIE = "lga-uvwie";
// Empty wards/pollingUnits, exactly as the real project stands today (no
// authoritative import yet) — see supabase/geography-import/README.md.
const GEOGRAPHY_TREE = {
  constituency: { id: "constituency-osu", name: "Okpe/Sapele/Uvwie Federal Constituency" },
  lgas: [{ id: LGA_OKPE, name: "Okpe" }, { id: LGA_SAPELE, name: "Sapele" }, { id: LGA_UVWIE, name: "Uvwie" }],
  wards: [], pollingUnits: [],
};

// ---------- LGA-level assignment succeeds ----------
{
  const client = fakeEventClient();
  const prepared = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  ok("A1. proposeAssignResponsibility at level=lga with a real LGA id is PREPARED", prepared.status === "PREPARED");
  ok("A2. the role is auto-set to LGA_COORDINATOR, paired 1:1 with level", prepared.draft.draft.responsibilityRole === RESPONSIBILITY_ROLE.LGA_COORDINATOR);

  const result = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-1" });
  ok("A3. executeAssignResponsibility succeeds and inserts a responsibility.assigned event",
     result.success && result.event.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED);

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("A4. the fold reconstructs the responsibility with person/level/geographyRef intact",
     view.responsibilities["resp-1"]?.person === "person-1" && view.responsibilities["resp-1"]?.level === "lga" &&
     view.responsibilities["resp-1"]?.geographyRef === LGA_OKPE && view.responsibilities["resp-1"]?.status === "ASSIGNED");
}

// ---------- unknown person / unrecognised LGA refused ----------
{
  const unknownPerson = await proposeAssignResponsibility({
    fields: { personId: "not-on-roster", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  ok("B1. an assignee not on the campaign's own roster is refused (NEEDS_PERSON), never a partial draft",
     unknownPerson.status === "NEEDS_PERSON" && unknownPerson.draft === null);

  const unknownLga = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: "not-a-real-lga" }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  ok("B2. an LGA id not in this constituency's own resolved territory is refused (NEEDS_GEOGRAPHY_REF)", unknownLga.status === "NEEDS_GEOGRAPHY_REF");
}

// ---------- ward/polling-unit assignment refused — NEVER fabricated ----------
{
  const wardAttempt = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "ward", geographyRef: "any-ward-id" }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  ok("C1. assigning at ward level against an empty geography_wards fixture is REFUSED, not accepted with a free-text fallback",
     wardAttempt.status === "NO_GEOGRAPHY_DATA_IMPORTED" && wardAttempt.draft === null);

  const puAttempt = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "polling_unit", geographyRef: "any-pu-id" }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  ok("C2. assigning at polling-unit level against an empty geography_polling_units fixture is REFUSED the same way",
     puAttempt.status === "NO_GEOGRAPHY_DATA_IMPORTED");

  // Once real rows exist for a level, the SAME code path accepts a real id —
  // proving the refusal above is genuinely data-driven, not level-hardcoded.
  const treeWithWards = { ...GEOGRAPHY_TREE, wards: [{ id: "ward-1", name: "Ward 1" }] };
  const wardOk = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "ward", geographyRef: "ward-1" }, roster: ROSTER, geographyTree: treeWithWards,
  });
  ok("C3. once a real ward row exists, the identical operation is PREPARED — the refusal above was data-driven, not a hardcoded block",
     wardOk.status === "PREPARED");
}

// ---------- status / training change ----------
{
  const client = fakeEventClient();
  const assign = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  await executeAssignResponsibility({ draft: assign.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-status-1" });

  const neither = await proposeChangeResponsibilityStatus({ fields: { responsibilityId: "resp-status-1" } });
  ok("D1. a status change with neither status nor trainingStatus is refused (NEEDS_STATUS)", neither.status === "NEEDS_STATUS");

  const trainingOnly = await proposeChangeResponsibilityStatus({ fields: { responsibilityId: "resp-status-1", trainingStatus: "COMPLETE" } });
  ok("D2. a training-only update (no status change) is PREPARED", trainingOnly.status === "PREPARED" && trainingOnly.draft.draft.status === null);
  await executeChangeResponsibilityStatus({ draft: trainingOnly.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-status-1-training" });

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("D3. the fold shows trainingStatus updated while status/person/level/geographyRef stay untouched (never silently reassigned)",
     view.responsibilities["resp-status-1"]?.trainingStatus === "COMPLETE" &&
     view.responsibilities["resp-status-1"]?.status === "ASSIGNED" &&
     view.responsibilities["resp-status-1"]?.geographyRef === LGA_OKPE &&
     view.responsibilities["resp-status-1"]?.history.length === 1);
}

// ---------- territory readiness: a real percentage, never fabricated ----------
{
  const client = fakeEventClient();
  const territoryEvent = { type: ELECTION_EVENT_TYPES.TERRITORY.SET, territory: "t-1", campaign: CAMPAIGN_A,
    election: "2027 General Election", office: "house_of_reps", state: "delta", constituency: "constituency-osu", at: new Date().toISOString(), eventId: "t-1" };
  await client.from("election_events").insert({ event_id: "t-1", campaign_id: CAMPAIGN_A, type: territoryEvent.type, actor: USER, schema_version: "1", payload: territoryEvent });

  const assign = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  await executeAssignResponsibility({ draft: assign.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-ready-1" });

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const readiness = deriveTerritoryReadiness({ view, geographyTree: GEOGRAPHY_TREE });

  ok("E1. lgaCoverage is a REAL percentage: 1 of 3 real LGAs assigned = 33%",
     readiness.lgaCoverage.totalLgas === 3 && readiness.lgaCoverage.assigned === 1 && readiness.lgaCoverage.percent === 33);
  ok("E2. wardCoverage renders NOT_ESTABLISHED — never a fabricated 0%/100% over zero imported wards",
     readiness.wardCoverage.status === "NOT_ESTABLISHED");
  ok("E3. pollingUnitCoverage renders NOT_ESTABLISHED the same way", readiness.pollingUnitCoverage.status === "NOT_ESTABLISHED");
  ok("E4. the gap list names the 2 unassigned LGAs (Sapele, Uvwie) plus the missing constituency lead",
     readiness.gaps.filter((g) => /Sapele|Uvwie/.test(g.what)).length === 2 &&
     readiness.gaps.some((g) => /constituency has no lead/.test(g.what)));
  ok("E5. every gap carries owner/deadline/dependency UNKNOWN, never a guessed value",
     readiness.gaps.every((g) => g.owner === "UNKNOWN" && g.deadline === "UNKNOWN" && g.dependency === "UNKNOWN"));
}

// ---------- concurrency: one responsibility per (campaign, level, geographyRef) slot ----------
{
  const client = fakeEventClient();
  const roster2 = [...ROSTER, { id: "person-2", name: "Bello Musa", roleType: "lga_coordinator" }];

  const first = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_UVWIE }, roster: roster2, geographyTree: GEOGRAPHY_TREE,
  });
  const firstResult = await executeAssignResponsibility({ draft: first.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-concurrent-1" });
  ok("G1. the first assignment to Uvwie succeeds", firstResult.success);

  // A DIFFERENT person, a DIFFERENT confirmationId/event_id, but the SAME
  // slot (campaign A, level=lga, geographyRef=Uvwie) — simulating two users
  // racing to assign the same LGA. This must be REFUSED, not silently
  // treated as an idempotent replay (it is a genuinely different event).
  const second = await proposeAssignResponsibility({
    fields: { personId: "person-2", level: "lga", geographyRef: LGA_UVWIE }, roster: roster2, geographyTree: GEOGRAPHY_TREE,
  });
  const secondResult = await executeAssignResponsibility({ draft: second.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-concurrent-2" });
  ok("G2. a second, different person assigned to the SAME slot is REFUSED, not silently accepted",
     secondResult.success === false && secondResult.alreadyRecorded === false);
  ok("G3. the refusal is reported as a real error, never mistaken for an idempotent replay",
     typeof secondResult.error === "string" && secondResult.error.length > 0);

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("G4. exactly ONE responsibility exists for Uvwie in the fold — person-1's, never overwritten or duplicated by the refused attempt",
     Object.values(view.responsibilities).filter((r) => r.geographyRef === LGA_UVWIE).length === 1 &&
     Object.values(view.responsibilities).find((r) => r.geographyRef === LGA_UVWIE)?.person === "person-1");

  // A genuinely different slot for the same campaign is unaffected.
  const different = await proposeAssignResponsibility({
    fields: { personId: "person-2", level: "lga", geographyRef: LGA_SAPELE }, roster: roster2, geographyTree: GEOGRAPHY_TREE,
  });
  const differentResult = await executeAssignResponsibility({ draft: different.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-concurrent-3" });
  ok("G5. assigning a DIFFERENT LGA in the same campaign is unaffected by the slot constraint", differentResult.success);

  // TEST C — the slot-uniqueness index is scoped to (campaign_id, level,
  // geographyRef) TOGETHER, never geographyRef alone. Two campaigns
  // legitimately operating in the same real LGA (e.g. a candidate campaign
  // and an observer organisation both referencing Okpe) must each be able
  // to record their OWN LGA Coordinator for it — this is not a conflict,
  // it is two independent tenants' own accountability records for a piece
  // of shared, public geography.
  const crossCampaign = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_UVWIE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  const crossCampaignResult = await executeAssignResponsibility({ draft: crossCampaign.draft.draft, campaign: CAMPAIGN_B, userId: USER, client, confirmationId: "resp-concurrent-crosscampaign" });
  ok("G6 (TEST C). a DIFFERENT campaign assigning the SAME geography (Uvwie, already taken in campaign A) succeeds — the slot constraint is per-tenant, not global",
     crossCampaignResult.success);
  const viewB = projectElection(logFor(client, CAMPAIGN_B), CAMPAIGN_B);
  ok("G6b. campaign B's own fold shows its own Uvwie assignment, independent of campaign A's",
     viewB.responsibilities["resp-concurrent-crosscampaign"]?.geographyRef === LGA_UVWIE);
}

// ---------- TEST D — idempotent replay of responsibility.assigned specifically ----------
// (proposeSetTerritory's own replay is already covered in election-geography.
// consumer.mjs's T4; this proves the SAME guarantee holds for the newer
// RESPONSIBILITY.ASSIGNED type, which now shares election_events with a
// SECOND unique constraint — the exact scenario insertEvent()'s
// constraint-name check exists to get right.)
{
  const client = fakeEventClient();
  const prepared = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  const first = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-replay-1" });
  ok("H1 (TEST D). the first approval succeeds", first.success && first.alreadyRecorded === false);

  // The EXACT same confirmationId/event_id, replayed — e.g. a UI retry
  // after a dropped response. Must be recognised as the SAME event
  // (event_id constraint), never refused as a slot conflict.
  const replay = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-replay-1" });
  ok("H2. replaying the SAME confirmationId is idempotent — success, alreadyRecorded, no error",
     replay.success && replay.alreadyRecorded === true && replay.error === null);

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const rows = logFor(client, CAMPAIGN_A).filter((e) => e.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED);
  ok("H3. exactly ONE responsibility.assigned event was actually persisted, never two", rows.length === 1);
  ok("H4. the fold shows exactly one responsibility for Okpe, no corruption, no duplicate history",
     Object.keys(view.responsibilities).length === 1 && view.responsibilities["resp-replay-1"]?.geographyRef === LGA_OKPE);
}

// ---------- tenant isolation ----------
{
  const client = fakeEventClient();
  const respA = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  await executeAssignResponsibility({ draft: respA.draft.draft, campaign: CAMPAIGN_A, userId: USER, client, confirmationId: "resp-a" });

  const respB = await proposeAssignResponsibility({
    fields: { personId: "person-1", level: "lga", geographyRef: LGA_SAPELE }, roster: ROSTER, geographyTree: GEOGRAPHY_TREE,
  });
  await executeAssignResponsibility({ draft: respB.draft.draft, campaign: CAMPAIGN_B, userId: USER, client, confirmationId: "resp-b" });

  const mixedLog = client.rows.filter((r) => r.table === "election_events").map((r) => r.payload);
  const viewA = projectElection(mixedLog, CAMPAIGN_A);
  const viewB = projectElection(mixedLog, CAMPAIGN_B);
  ok("F1. campaign A's fold contains ONLY campaign A's responsibility",
     Object.keys(viewA.responsibilities).length === 1 && viewA.responsibilities["resp-a"]?.geographyRef === LGA_OKPE);
  ok("F2. campaign B's fold contains ONLY campaign B's responsibility, never A's",
     Object.keys(viewB.responsibilities).length === 1 && viewB.responsibilities["resp-b"]?.geographyRef === LGA_SAPELE);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
