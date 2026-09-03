// ============================================================
// ELECTIONCANON 1.1 PHASE 1 — BLOCKER FIX PASS F2  (live readiness wiring)
//
// The forensic audit found deriveReadiness() itself correct but never
// actually fed real responsibility_slots data in the live app —
// electionContext.js's getElectionContext() called deriveFor(view) with a
// single argument. This suite exercises the ACTUAL composition path
// (getElectionContext() end-to-end), not deriveReadiness() in isolation —
// proving the real wire, via the SAME stateful fake-client pattern
// election-activation.consumer.mjs already established for this exact
// function, extended with REAL responsibility_slots rows (that file's own
// fixture deliberately has none).
// ============================================================

import { activateElectionCampaign, ACTIVATION, getElectionContext } from "../src/os/electionContext.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../src/domains/election/studio/readiness.js";
import { getWardResponsibilityMap } from "../src/domains/election/geography/coverage.js";
import { candidateEvent, wardAssignedEvent } from "../src/domains/election/events.js";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON 1.1 PHASE 1 — BLOCKER FIX PASS F2 — live readiness wiring\n");

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [], responsibility_slots: [] }; }

/** Same stateful fake as election-activation.consumer.mjs, extended with a
 *  REAL (not always-empty) responsibility_slots table. */
function fakeClient(store, asUser) {
  return {
    from(table) {
      if (table === "campaigns") {
        return {
          select() { return { eq(col1, val1) { return {
            async maybeSingle() {
              const rows = store.campaigns.filter((r) => r[col1] === val1);
              return { data: rows[0] ?? null, error: null };
            },
            ilike(col2, val2) { return { async maybeSingle() {
              const rows = store.campaigns.filter((r) => r[col1] === val1 && String(r[col2] ?? "").toLowerCase() === String(val2).toLowerCase());
              return { data: rows[0] ?? null, error: null };
            } }; },
          }; } }; },
          insert(row) { return { select() { return { async single() {
            const id = randomUUID();
            const newRow = { id, ...row };
            store.campaigns.push(newRow);
            return { data: { id, actor_kind: newRow.actor_kind }, error: null };
          } }; } }; },
        };
      }
      if (table === "campaign_members") {
        return { select() { return { eq(col1, val1) { return { eq(col2, val2) {
          return (async () => ({ data: store.campaign_members.filter((r) => r[col1] === val1 && r[col2] === val2), error: null }))();
        } }; } }; } };
      }
      if (table === "election_events") {
        return {
          select() { return { eq(col1, val1) { return { order() {
            return (async () => {
              const rows = store.election_events.filter((r) => r[col1] === val1).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
              return { data: rows.map((r) => ({ payload: r.payload })), error: null };
            })();
          } }; } }; },
          async insert(row) {
            if (store.election_events.some((r) => r.event_id === row.event_id)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
            store.election_events.push({ ...row, created_at: new Date().toISOString() });
            return { error: null };
          },
        };
      }
      if (table === "responsibility_slots") {
        // THE REAL FIXTURE, unlike election-activation.consumer.mjs's
        // always-empty stub — this is what proves the live wire.
        return { select: () => ({ eq: (k1, v1) => ({ eq: (k2, v2) => ({ in: async (k3, v3) => ({
          data: store.responsibility_slots.filter((r) => r[k1] === v1 && r[k2] === v2 && v3.includes(r[k3])), error: null,
        }) }) }) }) };
      }
      throw new Error(`fakeClient: unexpected table "${table}"`);
    },
    async rpc(name, args) {
      if (name !== "ensure_campaign_owner") return { error: { message: `unknown rpc ${name}` } };
      const campaign = store.campaigns.find((c) => c.id === args.p_campaign_id);
      if (!campaign || campaign.created_by !== asUser) {
        return { error: { message: `ensure_campaign_owner: ${args.p_campaign_id} was not created by the caller` } };
      }
      if (!store.campaign_members.find((m) => m.campaign_id === args.p_campaign_id && m.person === asUser)) {
        store.campaign_members.push({ campaign_id: args.p_campaign_id, person: asUser, member_role: "owner", status: "active" });
      }
      return { error: null };
    },
  };
}

const OWNER = "11111111-1111-1111-1111-111111111111";

let store, campaignId, client;
// ============================================================
console.log("SETUP — one real campaign, one candidate, one ward known to the fold");
// ============================================================
{
  store = freshStore();
  client = fakeClient(store, OWNER);
  const r = await activateElectionCampaign({ userId: OWNER, client, name: "Ada for LG Chair" });
  ok("SETUP1. campaign activates", r.outcome === ACTIVATION.CREATED && Boolean(r.campaignId));
  campaignId = r.campaignId;

  store.election_events.push({
    event_id: "cand-1", campaign_id: campaignId, type: "candidate.registered", actor: OWNER, schema_version: "1",
    payload: candidateEvent({ candidate: campaignId, campaign: campaignId, name: "Ada", office: "chair", constituency: "LG-1", party: "PTY" }),
    created_at: new Date().toISOString(),
  });
  // Ward W1 enters the fold via the legacy CAMPAIGN.WARD_ASSIGNED event
  // (exactly like every other readiness test in this repo does) — this
  // fixture's `organisation` field is DELIBERATELY populated to prove
  // WARD_ASSIGNMENT genuinely ignores it now (Design Gate 1/readiness.js).
  store.election_events.push({
    event_id: "ward-1", campaign_id: campaignId, type: "campaign.ward.assigned", actor: OWNER, schema_version: "1",
    payload: wardAssignedEvent({ ward: "W1", campaign: campaignId, organisation: "Legacy Org — must not make this COMPLETE" }),
    created_at: new Date().toISOString(),
  });
}

// ============================================================
console.log("\nCASE 1 — no responsibility_slots row for W1: WARD_ASSIGNMENT is INCOMPLETE via the REAL getElectionContext() path");
// ============================================================
{
  const ctx = await getElectionContext({ userId: OWNER, client, requestedCampaign: campaignId });
  const claim = ctx.readiness.claims.find((c) => c.dimension === "WARD_ASSIGNMENT" && c.source_entity.includes("W1"));
  ok("1a. getElectionContext() itself (not deriveReadiness() called directly) reports INCOMPLETE", claim.status === STATUS.INCOMPLETE);
  ok("1b. this is despite the legacy `organisation` field being populated — proves the live path reads the NEW source, not the old one",
     claim.value.includes("no current ward coordinator"));
  ok("1c. CANDIDATE_REGISTERED is unaffected by any of this — still COMPLETE", ctx.readiness.candidateRegistered === true);
}

// ============================================================
console.log("\nCASE 2 — a real responsibility_slots row for W1 (Alice): WARD_ASSIGNMENT becomes COMPLETE, live, no code change needed");
// ============================================================
{
  store.responsibility_slots.push({
    campaign_id: campaignId, level: "ward", geography_ref: "W1", responsibility_id: "resp-w1",
    current_person: `invite:${campaignId}:alice-uid`, responsibility_role: "WARD_COORDINATOR",
    current_event_id: `invite-resp:${campaignId}:alice-uid`, updated_at: new Date().toISOString(),
  });
  const ctx = await getElectionContext({ userId: OWNER, client, requestedCampaign: campaignId });
  const claim = ctx.readiness.claims.find((c) => c.dimension === "WARD_ASSIGNMENT" && c.source_entity.includes("W1"));
  ok("2a. the SAME getElectionContext() call, against the SAME campaign, now reports COMPLETE purely because responsibility_slots changed",
     claim.status === STATUS.COMPLETE);

  // Layer 2: the map itself, exactly as readiness consumed it.
  const map = await getWardResponsibilityMap({ client, campaignId, wardIds: ["W1"] });
  ok("2b. getWardResponsibilityMap() (the SAME function getElectionContext() calls internally) independently confirms Alice",
     map.data.W1 === `invite:${campaignId}:alice-uid`);
}

// ============================================================
console.log("\nCASE 3 — Alice -> Bob: live readiness immediately follows the new holder");
// ============================================================
{
  const slot = store.responsibility_slots.find((r) => r.campaign_id === campaignId && r.level === "ward" && r.geography_ref === "W1");
  slot.current_person = `invite:${campaignId}:bob-uid`; // simulates write_responsibility()'s own upsert
  const ctx = await getElectionContext({ userId: OWNER, client, requestedCampaign: campaignId });
  const claim = ctx.readiness.claims.find((c) => c.dimension === "WARD_ASSIGNMENT" && c.source_entity.includes("W1"));
  ok("3a. readiness still reports COMPLETE after the handoff — the slot is covered by SOMEONE, not specifically checking identity here",
     claim.status === STATUS.COMPLETE);
  const map = await getWardResponsibilityMap({ client, campaignId, wardIds: ["W1"] });
  ok("3b. the underlying map — what readiness actually reads — now shows Bob, not Alice, confirming the LIVE (not cached) value is followed",
     map.data.W1 === `invite:${campaignId}:bob-uid` && map.data.W1 !== `invite:${campaignId}:alice-uid`);
}

// ============================================================
console.log("\nCASE 4 — vacate (Bob -> null): live readiness becomes INCOMPLETE again");
// ============================================================
{
  const slot = store.responsibility_slots.find((r) => r.campaign_id === campaignId && r.level === "ward" && r.geography_ref === "W1");
  slot.current_person = null; // simulates a vacate
  const ctx = await getElectionContext({ userId: OWNER, client, requestedCampaign: campaignId });
  const claim = ctx.readiness.claims.find((c) => c.dimension === "WARD_ASSIGNMENT" && c.source_entity.includes("W1"));
  ok("4a. a vacated slot reads INCOMPLETE via the real live path, not a crash and not a stale COMPLETE",
     claim.status === STATUS.INCOMPLETE);
}

// ============================================================
console.log("\nCASE 5 — no-territory / empty-campaign honesty is preserved (F2 must not break this)");
// ============================================================
{
  const emptyStore = freshStore();
  const emptyClient = fakeClient(emptyStore, OWNER);
  const r = await activateElectionCampaign({ userId: OWNER, client: emptyClient, name: "Empty Campaign" });
  const ctx = await getElectionContext({ userId: OWNER, client: emptyClient, requestedCampaign: r.campaignId });
  ok("5a. a brand-new campaign with zero events still returns a real (non-null) readiness object, honestly all-incomplete",
     ctx.readiness !== null && ctx.readiness.candidateRegistered === false && ctx.readiness.claims.length === 1);
  ok("5b. no wards exist yet, so no WARD_ASSIGNMENT claim is fabricated for one", !ctx.readiness.claims.some((c) => c.dimension === "WARD_ASSIGNMENT"));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
