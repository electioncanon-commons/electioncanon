// ============================================================
// FORGE ELECTION — WARD ASSIGNMENT CANON INTEGRITY  (Loop 34)
//
// Proves the Loop 34 correctness fix, and ONLY that fix. Loop 33 found that
// `wardAssignedEvent`'s own `person` field — accepted by the factory since
// the field was first declared — was silently discarded before it could
// ever become part of the Canon. Reconnaissance for this loop found the
// drop actually happens at TWO points, not one:
//
//   1. `executeElectionWrite()` (studio/write.js) never forwarded a draft's
//      `person` to `wardAssignedEvent()` — so even a caller-populated draft
//      lost it before an event was ever built.
//   2. `projectElection()` (projections.js) never folded `event.person`
//      into `wards[id]` — so even a hand-authored event with `person` set
//      lost it at read time.
//
// Both are fixed together here; fixing only one would leave `person`
// unreachable through the real pipeline (fix #2 alone) or unreadable after
// being reachable (fix #1 alone). Neither fix touches PREPARE
// (`proposeElectionWrite`/`matchWardAssign`) — the natural-language grammar
// still never produces a `person` field (see test J2/B8 in the sibling
// suites, unchanged and still passing), so this is Canon PRESERVATION of
// already-declared event information, never a new write capability, never
// a new event type, and — proven below — never a new readiness dimension.
//
// Run: node test/election-ward-person.consumer.mjs
// ============================================================

import { wardAssignedEvent, wardStatusEvent } from "../src/domains/election/events.js";
import { projectElection } from "../src/domains/election/projections.js";
import { deriveReadiness, READINESS_DIMENSION_STATUS as STATUS } from "../src/domains/election/studio/readiness.js";
import { executeElectionWrite } from "../src/domains/election/studio/write.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

function fakeClient(store) {
  return { from: () => ({ insert: async (row) => {
    if (store.some((r) => r.event_id === row.event_id)) {
      return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    store.push(row); return { error: null };
  } }) };
}

const CAMPAIGN_A = "campaign-A";
const CAMPAIGN_B = "campaign-B";
const stamp = (e, i, prefix) => Object.freeze({ ...e, eventId: `${prefix}-${i}`, at: `2026-02-0${i}T00:00:00.000Z` });

// =================================================================
// PART U1 — the fold: an event authored directly with `person` now
// resolves back out of `wards[id]`, the same last-value-wins discipline
// `organisation` already had.
// =================================================================
{
  const log = [stamp(wardAssignedEvent({ ward: "Ward P1", campaign: CAMPAIGN_A, organisation: "Team P1", person: "Alice" }), 1, "u1")].reverse();
  const view = projectElection(log, CAMPAIGN_A);
  ok("U1a. a ward-assignment event carrying `person` resolves it in the folded ward",
     view.wards["Ward P1"].person === "Alice");

  const logNoPerson = [stamp(wardAssignedEvent({ ward: "Ward P2", campaign: CAMPAIGN_A, organisation: "Team P2" }), 1, "u1b")].reverse();
  const viewNoPerson = projectElection(logNoPerson, CAMPAIGN_A);
  ok("U1b. an assignment event that never named a person folds an honest null, never a fabricated one",
     viewNoPerson.wards["Ward P2"].person === null);

  // last-value-wins, the SAME discipline `organisation`/`name` already use.
  const logOverwrite = [
    stamp(wardAssignedEvent({ ward: "Ward P3", campaign: CAMPAIGN_A, organisation: "Team P3", person: "Bola" }), 1, "u1c"),
    stamp(wardAssignedEvent({ ward: "Ward P3", campaign: CAMPAIGN_A, organisation: "Team P3", person: "Chidi" }), 2, "u1c"),
  ].reverse();
  const viewOverwrite = projectElection(logOverwrite, CAMPAIGN_A);
  ok("U1c. a later assignment's person overwrites an earlier one — last-value-wins, never merged/averaged",
     viewOverwrite.wards["Ward P3"].person === "Chidi");

  // WARD_STATUS_REPORTED's OWN `person` (the reporter) is a DIFFERENT fact —
  // deliberately left unfolded this loop (out of the named scope). Proves
  // the fix did not accidentally widen beyond WARD_ASSIGNED.
  const logStatusPerson = [
    stamp(wardAssignedEvent({ ward: "Ward P4", campaign: CAMPAIGN_A, organisation: "Team P4", person: "Ada" }), 1, "u1d"),
    stamp(wardStatusEvent({ ward: "Ward P4", campaign: CAMPAIGN_A, status: "on-track", person: "SomeReporter" }), 2, "u1d"),
  ].reverse();
  const viewStatusPerson = projectElection(logStatusPerson, CAMPAIGN_A);
  ok("U1d. a status report's OWN person (the reporter) never overwrites the ward's assignment person — out of scope, untouched",
     viewStatusPerson.wards["Ward P4"].person === "Ada");
}

// =================================================================
// PART U2 — the entire pipeline: EXECUTE -> election_events -> fresh
// projectElection() -> Canon. A draft carrying `person` (never producible
// by the real NL grammar, but a legitimate shape for a future channel or a
// direct caller) now survives EXECUTE instead of being silently dropped.
// =================================================================
{
  const store = [];
  const draft = { type: "campaign.ward.assigned", ward: "Ward P10", organisation: "Team P10", person: "Deji" };
  const before = projectElection([], CAMPAIGN_A);
  ok("U2a. before execution, Canon has no record of Ward P10 at all", !("Ward P10" in before.wards));

  const exec = await executeElectionWrite({
    draft, campaign: CAMPAIGN_A, userId: "user-1", client: fakeClient(store), confirmationId: "confirm-u2-1",
  });
  ok("U2b. execution succeeds and writes EXACTLY one event", exec.success === true && store.length === 1);
  ok("U2c. the stored event's payload carries the person exactly as drafted",
     store[0].payload.person === "Deji" && store[0].payload.ward === "Ward P10" && store[0].payload.organisation === "Team P10");

  // NEVER locally patch. The only honest next state is a FRESH fold of the
  // persisted event, exactly the discipline election-readiness.consumer.mjs's
  // own M1/L6 assertions already require of every other Election write.
  const freshLog = [store[0].payload];
  const after = projectElection(freshLog, CAMPAIGN_A);
  ok("U2d. a FRESH Canon read now shows the assignment WITH its person — from re-folding the persisted event",
     after.wards["Ward P10"].person === "Deji" && after.wards["Ward P10"].organisation === "Team P10");
}

// =================================================================
// PART U3 — readiness stays byte-for-byte unchanged. WARD_ASSIGNMENT's
// COMPLETE/INCOMPLETE verdict, and every other claim, depends ONLY on
// `organisation` — exactly as before this loop. `person` enriches the
// Canon's factual record without creating a new readiness condition.
// =================================================================
{
  const logWithPerson = [stamp(wardAssignedEvent({ ward: "Ward P20", campaign: CAMPAIGN_A, organisation: "Team P20", person: "Emeka" }), 1, "u3a")].reverse();
  const logNoPerson = [stamp(wardAssignedEvent({ ward: "Ward P20", campaign: CAMPAIGN_A, organisation: "Team P20" }), 1, "u3b")].reverse();

  // ELECTIONCANON 1.1 PHASE 1 — WARD_ASSIGNMENT now sources from
  // responsibility_slots (deriveReadiness()'s new, optional second
  // argument), never `ward.organisation` — see studio/readiness.js's own
  // header. This test's actual subject is whether the UNRELATED `person`
  // field affects WARD_ASSIGNMENT (it must not) — supplying the SAME
  // wardResponsibility for both fixtures preserves that original intent
  // without conflating it with the (separately, dedicatedly tested —
  // see election-readiness.consumer.mjs's PART B2) data-source change.
  const wardResponsibility = { "Ward P20": "invite:camp-a:some-coordinator-uid" };
  const rWith = deriveReadiness(projectElection(logWithPerson, CAMPAIGN_A), wardResponsibility);
  const rWithout = deriveReadiness(projectElection(logNoPerson, CAMPAIGN_A), wardResponsibility);
  const claimWith = rWith.claims.find((c) => c.dimension === "WARD_ASSIGNMENT");
  const claimWithout = rWithout.claims.find((c) => c.dimension === "WARD_ASSIGNMENT");

  ok("U3a. WARD_ASSIGNMENT reads COMPLETE identically whether person is present or absent",
     claimWith.status === STATUS.COMPLETE && claimWithout.status === STATUS.COMPLETE);
  ok("U3b. the claim's own stated VALUE text is unchanged by person's presence — organisation is still the only thing spoken",
     claimWith.value === claimWithout.value);
  ok("U3c. the exact set of claim dimensions is unchanged — no WARD_PERSONNEL/CANDIDATE_TEAM/etc. dimension exists",
     rWith.claims.map((c) => c.dimension).sort().join(",") === "CANDIDATE_REGISTERED,WARD_ASSIGNMENT,WARD_STATUS_HEALTH");
  ok("U3d. unsupportedDimensions is unchanged — still exactly the pre-Loop-34 list, nothing added or removed",
     rWith.unsupportedDimensions.length === 18 && !rWith.unsupportedDimensions.some((d) => /PERSON|CONTACT|TEAM/i.test(d)));
}

// =================================================================
// PART U4 — tenant isolation: the SAME ward id, in TWO different
// campaigns, with DIFFERENT persons, must never cross-contaminate.
// =================================================================
{
  const mixedLog = [
    stamp(wardAssignedEvent({ ward: "Ward Shared", campaign: CAMPAIGN_A, organisation: "Org A", person: "Alice" }), 1, "u4a"),
    stamp(wardAssignedEvent({ ward: "Ward Shared", campaign: CAMPAIGN_B, organisation: "Org B", person: "Bob" }), 1, "u4b"),
  ].reverse();
  const viewA = projectElection(mixedLog, CAMPAIGN_A);
  const viewB = projectElection(mixedLog, CAMPAIGN_B);
  ok("U4a. campaign A's identically-named ward shows ONLY Alice, never Bob",
     viewA.wards["Ward Shared"].person === "Alice");
  ok("U4b. campaign B's identically-named ward shows ONLY Bob, never Alice",
     viewB.wards["Ward Shared"].person === "Bob");

  // Same isolation proven through the EXECUTE path, not just the fold.
  const storeA = [], storeB = [];
  await executeElectionWrite({
    draft: { type: "campaign.ward.assigned", ward: "Ward Shared2", organisation: "Org A2", person: "Alice2" },
    campaign: CAMPAIGN_A, userId: "user-1", client: fakeClient(storeA), confirmationId: "confirm-u4-a",
  });
  await executeElectionWrite({
    draft: { type: "campaign.ward.assigned", ward: "Ward Shared2", organisation: "Org B2", person: "Bob2" },
    campaign: CAMPAIGN_B, userId: "user-2", client: fakeClient(storeB), confirmationId: "confirm-u4-b",
  });
  const freshA = projectElection([storeA[0].payload], CAMPAIGN_A);
  const freshB = projectElection([storeB[0].payload], CAMPAIGN_B);
  ok("U4c. EXECUTE-then-fresh-fold: campaign A's store never leaks into campaign B's Canon",
     freshA.wards["Ward Shared2"].person === "Alice2" && !("Ward Shared2" in projectElection([storeA[0].payload], CAMPAIGN_B).wards));
  ok("U4d. EXECUTE-then-fresh-fold: campaign B's store never leaks into campaign A's Canon",
     freshB.wards["Ward Shared2"].person === "Bob2" && !("Ward Shared2" in projectElection([storeB[0].payload], CAMPAIGN_A).wards));
}

// =================================================================
// PART U5 — hostile `person` values. A `person` string may be stored as
// event data. It must NEVER become an authority-bearing field: it cannot
// redirect campaign scope, cannot alter actor-kind, cannot mutate the
// resolved organisation/ward, and cannot influence readiness.
// =================================================================
{
  const HOSTILE_PERSONS = [
    "campaign-B",                       // looks like another real campaign id
    "observer_organisation",            // looks like an actor_kind value
    "candidate_campaign",               // looks like an actor_kind value
    "admin",
    { hostile: "object", campaign: CAMPAIGN_B, actor_kind: "observer_organisation" }, // non-string
  ];

  for (const hostilePerson of HOSTILE_PERSONS) {
    const store = [];
    const exec = await executeElectionWrite({
      draft: { type: "campaign.ward.assigned", ward: "Ward Hostile", organisation: "Org Hostile", person: hostilePerson },
      campaign: CAMPAIGN_A, userId: "user-1", client: fakeClient(store), confirmationId: `confirm-u5-${JSON.stringify(hostilePerson)}`,
    });
    ok(`U5. hostile person ${JSON.stringify(hostilePerson)} is stored as inert data, never redirects the campaign`,
       exec.success === true && store[0].campaign_id === CAMPAIGN_A && store[0].payload.campaign === CAMPAIGN_A);

    const fresh = projectElection([store[0].payload], CAMPAIGN_A);
    ok(`U5b. hostile person ${JSON.stringify(hostilePerson)} does not appear as a SECOND campaign's ward`,
       !("Ward Hostile" in projectElection([store[0].payload], CAMPAIGN_B).wards));
  }

  // A hostile `person` naming another campaign's id must not make THAT
  // campaign's Canon show the ward either — it is scoped by the caller's
  // own authenticated `campaign` argument alone, never by anything inside
  // the draft (mirrors O5 in election-readiness.consumer.mjs for `organisation`).
  const storeRedirect = [];
  await executeElectionWrite({
    draft: { type: "campaign.ward.assigned", ward: "Ward Redirect", organisation: "Org R", person: CAMPAIGN_B },
    campaign: CAMPAIGN_A, userId: "user-1", client: fakeClient(storeRedirect), confirmationId: "confirm-u5-redirect",
  });
  ok("U5c. a person value that IS a real campaign id has zero effect on which campaign the event belongs to",
     storeRedirect[0].campaign_id === CAMPAIGN_A);
}

// =================================================================
// PART U6 — PREPARE remains DB-inert and unchanged: the natural-language
// grammar still never produces a `person` field (inherited guarantee,
// re-verified after this loop's change — not a new assertion, the SAME
// check J2/B8 already make, repeated here so this file is self-contained
// proof that Loop 34 did not touch PREPARE's output shape).
// =================================================================
{
  const { proposeElectionWrite } = await import("../src/domains/election/studio/write.js");
  const view = projectElection([], CAMPAIGN_A);
  const prepared = await proposeElectionWrite({ message: "Assign Team Z to Ward Z", view });
  ok("U6. the NL ward-assign draft STILL names no `person` — PREPARE's grammar is untouched by this loop's fix",
     prepared.status === "PREPARED" && !("person" in prepared.draft.draft));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
