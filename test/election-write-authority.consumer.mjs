// ============================================================
// FORGE ELECTION — WRITE-TIME ACTOR-KIND AUTHORITY  (Loop 30)
//
// Proves the gap Loop 29 identified is closed: observer/candidate writes
// now require the CALLER's REAL, persisted campaign actor_kind
// (campaigns.actor_kind, read fresh via getCampaignActorKind()) to match
// what the draft's event TYPE requires (events.js's new
// REQUIRED_ACTOR_KIND map) — checked independently at BOTH
// prepareElectionWrite() and approveElectionWrite(), never trusted from a
// caller-supplied field of any name.
//
// MOCK evidence only — a stateful fake Supabase client, no live database
// (see the Loop 30 final report's honest classification).
//
// Run: node test/election-write-authority.consumer.mjs
// ============================================================

import {
  getAuthenticatedUserId, activateElection, prepareElectionWrite, approveElectionWrite, WRITE_CHANNEL,
} from "../src/os/electionWebAdapter.js";
import { readElectionCanon } from "../src/os/electionWebAdapter.js";
import { ACTOR_KIND } from "../src/os/electionBootstrap.js";
import { ELECTION_EVENT_TYPES } from "../src/domains/election/events.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [] }; }

/** Identical shape to test/election-web-adapter.consumer.mjs's own fakeClient. */
function fakeClient(store, asUser) {
  return {
    auth: { async getUser() {
      if (!asUser) return { data: { user: null }, error: null };
      return { data: { user: { id: asUser } }, error: null };
    } },
    from(table) {
      if (table === "campaigns") {
        return {
          select() {
            return {
              eq(col1, val1) {
                return {
                  async maybeSingle() {
                    const rows = store.campaigns.filter((r) => r[col1] === val1);
                    return { data: rows[0] ?? null, error: null };
                  },
                  ilike(col2, val2) {
                    return { async maybeSingle() {
                      const rows = store.campaigns.filter((r) =>
                        r[col1] === val1 && String(r[col2] ?? "").toLowerCase() === String(val2).toLowerCase());
                      return { data: rows[0] ?? null, error: null };
                    } };
                  },
                };
              },
            };
          },
          insert(row) {
            return { select() { return { async single() {
              const id = randomUUID();
              const newRow = { id, ...row };
              store.campaigns.push(newRow);
              return { data: { id, actor_kind: newRow.actor_kind }, error: null };
            } }; } };
          },
        };
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
    async rpc(name, args) {
      if (name !== "ensure_campaign_owner") return { error: { message: `unknown rpc ${name}` } };
      const campaign = store.campaigns.find((c) => c.id === args.p_campaign_id);
      if (!campaign || campaign.created_by !== asUser) {
        return { error: { message: `ensure_campaign_owner: ${args.p_campaign_id} was not created by the caller` } };
      }
      const already = store.campaign_members.find((m) => m.campaign_id === args.p_campaign_id && m.person === asUser);
      if (!already) store.campaign_members.push({ campaign_id: args.p_campaign_id, person: asUser, member_role: "owner", status: "active" });
      return { error: null };
    },
  };
}

console.log("\nFORGE ELECTION — write-time actor-kind authority\n");

let storeCand, campaignCand, storeObs, campaignObs;
// ============================================================
console.log("SETUP — one candidate campaign, one observer campaign");
// ============================================================
{
  storeCand = freshStore();
  const cand = await activateElection({ client: fakeClient(storeCand, OWNER_A), name: "Ada for LG Chair" });
  campaignCand = cand.campaignId;

  storeObs = freshStore();
  const obs = await activateElection({
    client: fakeClient(storeObs, OWNER_B), name: "Election Watch Observers", actorKind: ACTOR_KIND.OBSERVER_ORGANISATION,
  });
  campaignObs = obs.campaignId;
  ok("SETUP. both campaigns activate with their declared actor kinds",
     cand.actorKind === ACTOR_KIND.CANDIDATE_CAMPAIGN && obs.actorKind === ACTOR_KIND.OBSERVER_ORGANISATION);
}

// ============================================================
console.log("\n1 — unauthenticated caller refused at both PREPARE and APPROVAL");
// ============================================================
{
  const p = await prepareElectionWrite({ client: fakeClient(storeObs, null), requestedCampaign: campaignObs, message: "Assign observer Jane to PU 004" });
  ok("1a. PREPARE with no session -> UNAUTHENTICATED", p.status === WRITE_CHANNEL.UNAUTHENTICATED && p.draft === null);
  const a = await approveElectionWrite({ client: fakeClient(storeObs, null), requestedCampaign: campaignObs, draft: { type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED, observer: "Jane", location: "PU 004" }, confirmationId: "x" });
  ok("1b. APPROVAL with no session -> UNAUTHENTICATED, no event written",
     a.success === false && a.error === WRITE_CHANNEL.UNAUTHENTICATED && storeObs.election_events.length === 0);
}

// ============================================================
console.log("\n2/3 — actor-kind gate: wrong kind refused, right kind allowed");
// ============================================================
{
  const wrongKind = await prepareElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand, message: "Assign observer Jane to PU 004",
  });
  ok("2. a CANDIDATE campaign attempting an observer.assign is refused with the SPECIFIC actor-kind reason",
     wrongKind.status === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND && wrongKind.draft === null);

  const rightKind = await prepareElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, message: "Assign observer Jane to PU 004",
  });
  ok("3. an OBSERVER campaign attempting the SAME command is allowed through to PREPARED",
     rightKind.status === "PREPARED" && rightKind.draft.draft.type === ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED);

  // Reverse direction — the write-time gate is symmetric, not observer-only.
  const observerTriesWard = await prepareElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, message: "Assign Team 6 to Ward 6",
  });
  ok("2b. an OBSERVER campaign attempting a WARD assignment is refused too — the gate is symmetric",
     observerTriesWard.status === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND);
}

// ============================================================
console.log("\n4 — PREPARE produces zero DB mutations, authorized or not");
// ============================================================
{
  ok("4. no election_events exist in either store after every PREPARE attempt above",
     storeCand.election_events.length === 0 && storeObs.election_events.length === 0);
}

// ============================================================
console.log("\n5 — APPROVAL independently re-checks authority, even for a hand-crafted draft that skipped PREPARE");
// ============================================================
{
  // A draft claiming to be an observer assignment, submitted directly to
  // APPROVAL for the CANDIDATE campaign — as if PREPARE's own check had
  // somehow been bypassed entirely. Approval must refuse it on its own.
  const hostileDraft = { type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED, observer: "Ghost", location: "PU 999" };
  const result = await approveElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand, draft: hostileDraft, confirmationId: "hostile-5",
  });
  ok("5. APPROVAL refuses a draft type the campaign's REAL actor_kind does not authorise, with no prior PREPARE at all",
     result.success === false && result.error === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND &&
     storeCand.election_events.length === 0);
}

// ============================================================
console.log("\n6/7/8 — model-supplied actorKind/organisation_id/campaign_id cannot elevate or redirect authority");
// ============================================================
{
  const hostilePrepare = await prepareElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand, message: "Assign observer Jane to PU 004",
    actorKind: ACTOR_KIND.OBSERVER_ORGANISATION, organisationKind: "observer_organisation", role: "observer",
    isObserver: true, authorised: true, approved: true, user_id: OWNER_B,
  });
  ok("6/7. hostile actorKind/organisationKind/role/isObserver/authorised/approved/user_id arguments change nothing — " +
     "still refused, because none of these parameters exist for prepareElectionWrite() to read",
     hostilePrepare.status === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND);

  const hostileApprove = await approveElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand,
    draft: { type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED, observer: "Jane", location: "PU 004" },
    confirmationId: "hostile-8", campaign_id: campaignObs, organisation_id: "org-HOSTILE",
  });
  ok("8. a hostile campaign_id claiming to redirect this approval to the OBSERVER campaign has zero effect — " +
     "the ONLY campaign ever used is requestedCampaign, independently re-verified",
     hostileApprove.success === false && hostileApprove.error === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND &&
     storeObs.election_events.length === 0);

  ok("N/A-4 (organisation_id has no authority pathway to mutate meaningfully): approveElectionWrite's own " +
     "signature destructures only {client, requestedCampaign, draft, confirmationId} — verified structurally",
     /export async function approveElectionWrite\(\{ client, requestedCampaign, draft, confirmationId \} = \{\}\)/
       .test(src("../src/os/electionWebAdapter.js")));
}

// ============================================================
console.log("\n12 — cross-tenant observer authority cannot leak");
// ============================================================
{
  const storeObsB = freshStore();
  const obsB = await activateElection({
    client: fakeClient(storeObsB, OWNER_A), name: "Rival Observers", actorKind: ACTOR_KIND.OBSERVER_ORGANISATION,
  });
  const crossTenant = await approveElectionWrite({
    client: fakeClient(storeObs, OWNER_A), // OWNER_A has no membership in campaignObs (OWNER_B's campaign)
    requestedCampaign: campaignObs, draft: { type: ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED, observer: "X", location: "Y" },
    confirmationId: "cross-12",
  });
  ok("12. an observer-kind actor (OWNER_A, owner of a DIFFERENT observer campaign) cannot approve into campaignObs — " +
     "membership, not merely matching actor_kind, is required",
     crossTenant.success === false && crossTenant.error === WRITE_CHANNEL.UNAUTHORIZED && storeObs.election_events.length === 0);
}

let confirmationId13;
// ============================================================
console.log("\n13 — a changed actor_kind between PREPARE and APPROVAL is caught fresh, never trusted stale");
// ============================================================
{
  const prep = await prepareElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, message: "Assign observer Deploy-1 to PU 020",
  });
  ok("13a. PREPARE succeeds while the campaign is genuinely OBSERVER_ORGANISATION", prep.status === "PREPARED");
  confirmationId13 = randomUUID();

  // Simulate the campaign's authority fact changing after PREPARE (in a
  // real deployment this cannot happen — no UPDATE policy exists on
  // actor_kind — but proving APPROVAL re-reads fresh, rather than trusting
  // anything computed during PREPARE, is the actual safety property this
  // test protects, independent of whether the mutation is reachable live).
  const realRow = storeObs.campaigns.find((c) => c.id === campaignObs);
  realRow.actor_kind = ACTOR_KIND.NGO_CSO;

  const approve = await approveElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs,
    draft: prep.draft.draft, confirmationId: confirmationId13,
  });
  ok("13b. APPROVAL reflects the CURRENT actor_kind, not whatever PREPARE saw a moment earlier — refused",
     approve.success === false && approve.error === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND);

  realRow.actor_kind = ACTOR_KIND.OBSERVER_ORGANISATION; // restore for the remaining tests
}

// ============================================================
console.log("\n14/15/16 — idempotent replay, exactly one event, fresh Canon reflects it");
// ============================================================
{
  const prep = await prepareElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, message: "Assign observer Deploy-2 to PU 021",
  });
  const confirmationId = randomUUID();
  const first = await approveElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, draft: prep.draft.draft, confirmationId,
  });
  ok("15. a legitimate, authorised approval writes EXACTLY one event", first.success === true && storeObs.election_events.length === 1);

  const replay = await approveElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, draft: prep.draft.draft, confirmationId,
  });
  ok("14. replaying the SAME confirmationId is reported already-recorded, never a second event",
     replay.success === true && replay.alreadyRecorded === true && storeObs.election_events.length === 1);

  const canon = await readElectionCanon({ client: fakeClient(storeObs, OWNER_B) });
  ok("16. a fresh Canon read reflects the new assignment — from re-folding the persisted event",
     canon.view.observers["Deploy-2"]?.location === "PU 021" && canon.readiness.claims[0].status === "COMPLETE");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
