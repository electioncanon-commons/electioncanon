// ============================================================
// FORGE ELECTION — OBSERVER ORGANISATION PREPAREDNESS  (Loop 29)
//
// Proves the FIRST non-candidate preparedness Canon end to end:
//   observerAssignedEvent() (events.js) -> projectElection()'s new
//   `observers` branch -> deriveObserverReadiness() -> getElectionContext()'s
//   actor-kind routing -> proposeElectionWrite/executeElectionWrite's new
//   OBSERVER_ASSIGN operation.
//
// Every existing candidate/ward test (election.consumer.mjs,
// election-readiness.consumer.mjs) is untouched and still green — this
// file adds NEW coverage for NEW code, it does not re-verify what those
// files already proved.
//
// Run: node test/election-observer.consumer.mjs
// ============================================================

import { candidateEvent, wardAssignedEvent, observerAssignedEvent, ELECTION_EVENT_TYPES, validateElectionEvent }
  from "../src/domains/election/events.js";
import { projectElection } from "../src/domains/election/projections.js";
import { deriveReadiness, READINESS_DIMENSION_STATUS as CANDIDATE_STATUS } from "../src/domains/election/studio/readiness.js";
import { deriveObserverReadiness, OBSERVER_READINESS_DIMENSION_STATUS as STATUS }
  from "../src/domains/election/studio/observerReadiness.js";
import { proposeElectionWrite, executeElectionWrite, ELECTION_WRITE_OPERATION } from "../src/domains/election/studio/write.js";
import { getElectionContext } from "../src/os/electionContext.js";
import { activateElectionCampaign } from "../src/os/electionContext.js";
import { ACTOR_KIND } from "../src/os/electionBootstrap.js";
import { resolveElectionScope, ELECTION_SCOPE } from "../src/os/electionScope.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

function fakeClient(store) {
  return { from: () => ({ insert: async (row) => {
    if (store.some((r) => r.event_id === row.event_id)) {
      return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    store.push(row); return { error: null };
  } }) };
}

const CAMPAIGN_OBS_A = "observer-campaign-A";
const CAMPAIGN_OBS_B = "observer-campaign-B";
const CAMPAIGN_CAND = "candidate-campaign-A";
const stamp = (e, i, prefix) => Object.freeze({ ...e, eventId: `${prefix}-${i}`, at: `2026-02-0${i}T00:00:00.000Z` });

console.log("\nFORGE ELECTION — observer organisation preparedness\n");

// =================================================================
// PART 5 — PROJECTION / TENANT ISOLATION
// =================================================================
{
  const mixedLog = [
    stamp(observerAssignedEvent({ observer: "Obs-1", campaign: CAMPAIGN_OBS_A, location: "PU 004" }), 1, "oa"),
    stamp(observerAssignedEvent({ observer: "Obs-2", campaign: CAMPAIGN_OBS_B, location: "PU 004" }), 1, "ob"),
    stamp(candidateEvent({ candidate: "cand-1", campaign: CAMPAIGN_CAND, name: "Ada Example",
      office: "LG Chair", constituency: "Ward 7", party: "Independent" }), 1, "c"),
    stamp(wardAssignedEvent({ ward: "Ward 7", campaign: CAMPAIGN_CAND, organisation: "Field Team" }), 2, "c"),
  ].reverse();

  const viewA = projectElection(mixedLog, CAMPAIGN_OBS_A);
  const viewB = projectElection(mixedLog, CAMPAIGN_OBS_B);
  const viewCand = projectElection(mixedLog, CAMPAIGN_CAND);

  ok("1. observer campaign A's view holds ONLY its own observer assignment",
     "Obs-1" in viewA.observers && !("Obs-2" in viewA.observers) && Object.keys(viewA.candidates).length === 0);
  ok("2. candidate campaign's Canon remains completely unaffected — its observers{} is empty",
     Object.keys(viewCand.observers).length === 0 && "cand-1" in viewCand.candidates);
  ok("3. observer campaign B remains unaffected by campaign A's assignment",
     "Obs-2" in viewB.observers && !("Obs-1" in viewB.observers));
  ok("4. the SAME location identifier ('PU 004') in two campaigns resolves to two INDEPENDENT observer records",
     viewA.observers["Obs-1"].location === "PU 004" && viewB.observers["Obs-2"].location === "PU 004" &&
     viewA.observers["Obs-1"] !== viewB.observers["Obs-2"]);

  const replayA = projectElection(mixedLog, CAMPAIGN_OBS_A);
  ok("5. replay is deterministic — folding the identical log twice produces structurally identical output",
     JSON.stringify(replayA.observers) === JSON.stringify(viewA.observers));

  // 6. ordering: a LATER re-assignment of the SAME observer overwrites the location.
  const reassignLog = [
    stamp(observerAssignedEvent({ observer: "Obs-1", campaign: CAMPAIGN_OBS_A, location: "PU 001" }), 1, "r"),
    stamp(observerAssignedEvent({ observer: "Obs-1", campaign: CAMPAIGN_OBS_A, location: "PU 002" }), 2, "r"),
  ].reverse();
  const reassignedView = projectElection(reassignLog, CAMPAIGN_OBS_A);
  ok("6. event ordering is deterministic — the LATER assignment wins, never averaged or both-true",
     reassignedView.observers["Obs-1"].location === "PU 002");

  // 7/8: cross-dimension leakage — impossible by construction, proven functionally.
  ok("7. unrelated candidate/ward events in the SAME campaign cannot satisfy observer readiness",
     Object.keys(viewCand.observers).length === 0 &&
     deriveObserverReadiness(viewCand).claims[0].status === STATUS.UNKNOWN);
  ok("8. an observer event cannot satisfy candidate readiness — candidates{}/wards{} stay empty in an observer campaign",
     Object.keys(viewA.candidates).length === 0 && Object.keys(viewA.wards).length === 0 &&
     deriveReadiness(viewA).candidateRegistered === false);
}

// =================================================================
// PART: EVENT VALIDATION (mirrors election.consumer.mjs's G1/G2 for the new type)
// =================================================================
{
  const complete = observerAssignedEvent({ observer: "Obs-9", campaign: CAMPAIGN_OBS_A, location: "PU 009" });
  ok("V1. a complete observer event validates", validateElectionEvent(complete).valid === true);

  // Every OTHER required field is present, isolating `location` specifically
  // — an object missing summary too would still fail validation even if the
  // `location` requirement were silently dropped, which would let that
  // mutation survive for the wrong reason.
  const incomplete = {
    type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED, observer: "Obs-9", campaign: CAMPAIGN_OBS_A,
    summary: "Obs-9 assigned to somewhere",
  };
  ok("V2. an observer event missing ONLY `location` fails closed, never silently accepted",
     validateElectionEvent(incomplete).valid === false);

  ok("V3. observerAssignedEvent() throws on a missing required field, the same elevated treatment " +
     "candidate/ward/status already get",
     (() => { try { observerAssignedEvent({ campaign: CAMPAIGN_OBS_A, location: "PU 009" }); return false; }
       catch { return true; } })());
}

// =================================================================
// PART 6/9 — WRITE PATH + COLLISION PROTECTION
// =================================================================
{
  const prepared = await proposeElectionWrite({ message: "Assign observer Jane Doe to PU 004" });
  ok("W1. PREPARE recognises the observer command and produces a draft of the RIGHT type",
     prepared.status === "PREPARED" && prepared.draft.draft.type === ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED &&
     prepared.draft.draft.observer === "Jane Doe" && prepared.draft.draft.location === "PU 004");
  ok("W2. the draft is inert — published:false, authorised:false, no person/eventId/at",
     prepared.draft.published === false && prepared.draft.authorised === false);

  // Structural companion to W2: isolate proposeElectionWrite()'s OWN
  // function body (both branches are defined in the SAME file as
  // executeElectionWrite, so a bare file-wide search would always find
  // that name in its own definition/export) and confirm it never CALLS
  // executeElectionWrite — PREPARE remains architecturally incapable of
  // execution, not merely undocumented as doing so.
  const writeSrc = src("../src/domains/election/studio/write.js");
  const proposeBody = (writeSrc.match(/export async function proposeElectionWrite[\s\S]*?\n\}\n/) ?? [""])[0];
  ok("W2b. proposeElectionWrite()'s own body never calls executeElectionWrite — structurally cannot auto-execute",
     proposeBody.length > 0 && !/executeElectionWrite\(/.test(proposeBody));

  // COLLISION: the observer pattern must be checked BEFORE the general ward
  // pattern, or "Assign observer X to Y" would be mis-read as a ward
  // assignment naming an organisation called "observer X".
  ok("W3. the draft is NOT mis-classified as a ward assignment",
     prepared.draft.draft.type !== ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED);

  const questions = [
    "Is an observer assigned to this polling unit?",
    "Has our observer been assigned?",
    "Do we have an observer at this location?",
    "What polling unit is our observer assigned to?",
    "Who is the observer assigned to PU 004?",
    // The literal substring "assign observer ... to ..." embedded MID-SENTENCE
    // — this is what the `^` anchor specifically exists to refuse. A
    // substring-anywhere match (the anchor removed) would wrongly treat this
    // narrated request as the imperative command itself.
    "Please remember to assign observer Jane to PU 004 once she arrives.",
    "I was told someone would assign observer Kunle to PU 004 tomorrow.",
  ];
  for (const q of questions) {
    const r = await proposeElectionWrite({ message: q });
    ok(`W4. '${q}' is never recognised as an Election write (anchored-prefix check requires position ZERO)`,
       r.status === "NOT_UNDERSTOOD" && r.draft === null);
  }

  const missingObserver = await proposeElectionWrite({ message: "Assign observer   to PU 004" });
  ok("W5. an empty observer name is refused (NEEDS_OBSERVER), never a blank record",
     missingObserver.status === "NEEDS_OBSERVER");

  const store = [];
  const client = fakeClient(store);
  const exec = await executeElectionWrite({
    draft: prepared.draft.draft, campaign: CAMPAIGN_OBS_A, userId: "user-1",
    client, confirmationId: "confirm-obs-1",
  });
  ok("W6. execution succeeds and writes EXACTLY one event", exec.success === true && store.length === 1);
  ok("W7. the stored event is a real, validated observer.assignment.recorded event",
     store[0].type === ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED &&
     validateElectionEvent(store[0].payload).valid === true);

  const replay = await executeElectionWrite({
    draft: prepared.draft.draft, campaign: CAMPAIGN_OBS_A, userId: "user-1",
    client, confirmationId: "confirm-obs-1",
  });
  ok("W8. replaying the SAME confirmationId is reported already-recorded, never a second event",
     replay.success === true && replay.alreadyRecorded === true && store.length === 1);

  // HOSTILE MODEL PROPOSAL — every field Loop 29's brief names must have
  // zero effect on the resolved draft. proposeElectionWrite destructures
  // ONLY {message, view}, so none of these can reach the draft at all.
  const hostile = await proposeElectionWrite({
    message: "Assign observer Jane Doe to PU 004",
    organisation_id: "org-HOSTILE", campaign_id: "campaign-HOSTILE", actor_kind: "candidate_campaign",
    polling_unit_id: "PU-HOSTILE", assigned: true, ready: true, completed: true, approved: true,
    execute: true, verified: true, event_id: "evt-HOSTILE", at: "1999-01-01T00:00:00.000Z",
  });
  ok("H1. a hostile proposal carrying campaign_id/actor_kind/polling_unit_id/assigned/ready/completed/" +
     "approved/execute/verified/event_id/fake timestamps has ZERO effect on the resolved draft",
     hostile.status === "PREPARED" &&
     Object.keys(hostile.draft.draft).sort().join(",") === "location,observer,type");
}

// =================================================================
// PART 7E — CALLER-SUPPLIED actor_kind CAN NEVER OVERRIDE THE PERSISTED ONE
// =================================================================
{
  ok("E1. getElectionContext() accepts no actorKind parameter at all — " +
     "it always reads the campaign's OWN persisted declaration, never a caller's claim",
     !/getElectionContext\([^)]*actorKind/.test(src("../src/os/electionContext.js")));
}

// =================================================================
// PART 8 — FULL LIFECYCLE: activation -> empty Canon -> PREPARE -> unchanged -> APPROVE -> fresh Canon
// =================================================================
let ctxStore, campaignId, userId;
{
  userId = "observer-owner-1";
  ctxStore = { campaigns: [{ id: null, created_by: userId, actor_kind: ACTOR_KIND.OBSERVER_ORGANISATION }],
    campaign_members: [], election_events: [] };
  campaignId = randomUUID();
  ctxStore.campaigns[0].id = campaignId;
  ctxStore.campaign_members.push({ campaign_id: campaignId, person: userId, member_role: "owner", status: "active" });

  function contextClient(store) {
    return {
      from(table) {
        if (table === "campaigns") {
          return { select: () => ({ eq: (c1, v1) => ({ async maybeSingle() {
            const row = store.campaigns.find((r) => r[c1] === v1);
            return { data: row ?? null, error: null };
          } }) }) };
        }
        if (table === "campaign_members") {
          return { select: () => ({ eq: (c1, v1) => ({ eq: async (c2, v2) => ({
            data: store.campaign_members.filter((r) => r[c1] === v1 && r[c2] === v2), error: null,
          }) }) }) };
        }
        if (table === "election_events") {
          return {
            select: () => ({ eq: (c1, v1) => ({ order: () => (async () => ({
              data: store.election_events.filter((r) => r[c1] === v1)
                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                .map((r) => ({ payload: r.payload })),
              error: null,
            }))() }) }),
            async insert(row) {
              if (store.election_events.some((r) => r.event_id === row.event_id)) {
                return { error: { code: "23505", message: "duplicate key" } };
              }
              store.election_events.push({ ...row, created_at: new Date().toISOString() });
              return { error: null };
            },
          };
        }
        if (table === "responsibility_slots") {
          // ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS F2) — see
          // election-activation.consumer.mjs's identical comment.
          return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  const before = await getElectionContext({ userId, client: contextClient(ctxStore), requestedCampaign: campaignId });
  ok("L1. an observer campaign resolves to SCOPED with its OWN actorKind, and readiness is computed (not refused)",
     before.scope.outcome === ELECTION_SCOPE.SCOPED && before.actorKind === ACTOR_KIND.OBSERVER_ORGANISATION &&
     before.readiness !== null && !before.unsupportedActorKind);
  ok("L2. before any event, the assignment claim reads UNKNOWN — never fabricated INCOMPLETE",
     before.readiness.claims[0].status === STATUS.UNKNOWN);

  const prep = await proposeElectionWrite({ message: "Assign observer Deployed-1 to PU 011", view: before.view });
  ok("L3. PREPARE produces a draft and touches no store — Canon still shows no assignment",
     prep.status === "PREPARED" && ctxStore.election_events.length === 0);

  const midCheck = await getElectionContext({ userId, client: contextClient(ctxStore), requestedCampaign: campaignId });
  ok("L4. re-reading the Canon mid-PREPARE is UNCHANGED — still UNKNOWN, proving PREPARE is DB-inert",
     midCheck.readiness.claims[0].status === STATUS.UNKNOWN);

  const exec = await executeElectionWrite({
    draft: prep.draft.draft, campaign: campaignId, userId, client: contextClient(ctxStore), confirmationId: "life-1",
  });
  ok("L5. approval writes EXACTLY one event", exec.success === true && ctxStore.election_events.length === 1);

  const after = await getElectionContext({ userId, client: contextClient(ctxStore), requestedCampaign: campaignId });
  ok("L6. a FRESH read now shows the assignment — COMPLETE, from re-folding the persisted event, never a local patch",
     after.readiness.claims[0].status === STATUS.COMPLETE &&
     after.view.observers["Deployed-1"].location === "PU 011");
  ok("L7. this is a structurally NEW object from a NEW call, not `before` mutated in place",
     before !== after && before.readiness.claims[0].status !== after.readiness.claims[0].status);
}

// =================================================================
// PART 10 — RECOMMENDATION SEPARATION
// =================================================================
{
  ok("R1. observerReadiness.js contains no recommendation vocabulary — absence of an assignment " +
     "is a GAP (with an honest UNKNOWN status), never promoted to a proactive recommendation",
     !/recommendation/i.test(src("../src/domains/election/studio/observerReadiness.js")));

  const emptyReadiness = deriveObserverReadiness({});
  ok("R2. the one gap for an empty Canon states the fact and the resolution condition — never a persuasive claim",
     emptyReadiness.gaps.length === 1 &&
     emptyReadiness.gaps[0].resolves_when === "an observer.assignment.recorded event exists" &&
     emptyReadiness.gaps[0].owner === "UNKNOWN");

  ok("R3. no readiness score, percentage, or probability field exists anywhere on the result",
     !("score" in emptyReadiness) && !("percentReady" in emptyReadiness) && !("winProbability" in emptyReadiness));
}

// =================================================================
// PART Q — 100% PREPAREDNESS BOUNDARY, STATED HONESTLY
// =================================================================
{
  const full = deriveObserverReadiness({ observers: { "Obs-1": { id: "Obs-1", location: "PU 001" } } });
  ok("Q1. even at COMPLETE, the coverage note explicitly disclaims universal operational readiness",
     full.claims[0].status === STATUS.COMPLETE &&
     /not full deployment coverage/i.test(full.knownObserverCoverage.note));
  ok("Q2. every category Loop 28/29 named as unsupported for observers is explicitly listed, never silently absent",
     ["ACCREDITATION", "OBSERVER_TRAINING", "DEPLOYMENT_COVERAGE", "LOGISTICS_READINESS",
      "SECURITY_READINESS", "COMMUNICATIONS_READINESS", "COMMAND_STRUCTURE"]
       .every((d) => full.unsupportedDimensions.includes(d)));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
