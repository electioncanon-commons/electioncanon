// ============================================================
// FORGE ELECTION — ACTIVATION BOUNDARY  (Loop 25)
//
// Exercises activateElectionCampaign()/getElectionContext() against a
// STATEFUL fake Supabase client covering all three Election tables
// (campaigns, campaign_members, election_events) — MOCK evidence, no live
// database (see the Loop 25 final report's honest classification).
//
// Also proves the CROSS-CHANNEL CONTRACT (Phase 12): a "Web" caller and a
// "WhatsApp" caller reach byte-identical domain results once they supply
// the same identity/scope, because the domain functions accept no
// channel-identifying parameter at all — the channel is outside the Canon.
//
// Run: node test/election-activation.consumer.mjs
// ============================================================

import { activateElectionCampaign, ACTIVATION, getElectionContext, loadElectionLog }
  from "../src/os/electionContext.js";
import { bootstrapCampaign, ACTOR_KIND } from "../src/os/electionBootstrap.js";
import { ELECTION_SCOPE } from "../src/os/electionScope.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../src/domains/election/studio/readiness.js";
import { candidateEvent } from "../src/domains/election/events.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [] }; }

/** A single stateful fake covering all three Election tables, bound to one
 *  simulated authenticated session (`asUser`), mirroring how a real
 *  Supabase client is bound to one session's auth.uid(). */
function fakeClient(store, asUser) {
  return {
    from(table) {
      if (table === "campaigns") {
        return {
          // Two DIFFERENT real call shapes share this table's select():
          // bootstrapCampaign()'s reuse-lookup (.eq().ilike().maybeSingle())
          // and getElectionContext()'s actor_kind read (.eq().maybeSingle()
          // directly, no .ilike()) — both are supported here.
          select() {
            return {
              eq(col1, val1) {
                return {
                  async maybeSingle() {
                    const rows = store.campaigns.filter((r) => r[col1] === val1);
                    return { data: rows[0] ?? null, error: null };
                  },
                  ilike(col2, val2) {
                    return {
                      async maybeSingle() {
                        const rows = store.campaigns.filter((r) =>
                          r[col1] === val1 && String(r[col2] ?? "").toLowerCase() === String(val2).toLowerCase());
                        return { data: rows[0] ?? null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(row) {
            return {
              select() {
                return {
                  async single() {
                    const id = randomUUID();
                    const newRow = { id, ...row };
                    store.campaigns.push(newRow);
                    return { data: { id, actor_kind: newRow.actor_kind }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "campaign_members") {
        return {
          select() {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    return (async () => ({
                      data: store.campaign_members.filter((r) => r[col1] === val1 && r[col2] === val2),
                      error: null,
                    }))();
                  },
                };
              },
            };
          },
        };
      }
      if (table === "election_events") {
        return {
          select() {
            return {
              eq(col1, val1) {
                return {
                  order() {
                    return (async () => {
                      const rows = store.election_events
                        .filter((r) => r[col1] === val1)
                        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
                      return { data: rows.map((r) => ({ payload: r.payload })), error: null };
                    })();
                  },
                };
              },
            };
          },
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
        // ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS F2) — getElectionContext()
        // now also queries this table (coverage.js's getWardResponsibilityMap())
        // for CANDIDATE_CAMPAIGN readiness. This fixture has none — an honest
        // empty result, exactly what a real campaign with no responsibility
        // data yet would see.
        return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }) };
      }
      throw new Error(`fakeClient: unexpected table "${table}"`);
    },
    async rpc(name, args) {
      if (name !== "ensure_campaign_owner") return { error: { message: `unknown rpc ${name}` } };
      const campaign = store.campaigns.find((c) => c.id === args.p_campaign_id);
      if (!campaign || campaign.created_by !== asUser) {
        return { error: { message: `ensure_campaign_owner: ${args.p_campaign_id} was not created by the caller` } };
      }
      const already = store.campaign_members.find(
        (m) => m.campaign_id === args.p_campaign_id && m.person === asUser);
      if (!already) {
        store.campaign_members.push({
          campaign_id: args.p_campaign_id, person: asUser, member_role: "owner", status: "active",
        });
      }
      return { error: null };
    },
  };
}

console.log("\nFORGE ELECTION — activation boundary\n");

// ============================================================
console.log("A1 — no authenticated user: activation and context both refuse");
// ============================================================
{
  const store = freshStore();
  const r = await activateElectionCampaign({ userId: null, client: fakeClient(store, null), name: "X" });
  ok("A1a. activateElectionCampaign with no userId -> UNAUTHENTICATED", r.outcome === ACTIVATION.UNAUTHENTICATED);
  ok("A1b. and touches no table at all", store.campaigns.length === 0 && store.campaign_members.length === 0);

  const ctx = await getElectionContext({ userId: null, client: fakeClient(store, null) });
  ok("A1c. getElectionContext with no userId -> unauthenticated scope, no view, no readiness",
     ctx.scope.outcome === ELECTION_SCOPE.UNAUTHENTICATED && ctx.view === null && ctx.readiness === null);
}

let storeA, campaignA;
// ============================================================
console.log("\nSETUP — activate a real campaign for OWNER_A (used by the rest of this suite)");
// ============================================================
{
  storeA = freshStore();
  const r = await activateElectionCampaign({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A), name: "Ada for LG Chair" });
  ok("SETUP. campaign A activates as CREATED", r.outcome === ACTIVATION.CREATED && Boolean(r.campaignId));
  campaignA = r.campaignId;
}

// ============================================================
console.log("\nA2/A3/A4 — a caller-, or 'model-', supplied campaign id never overrides real membership");
// ============================================================
{
  const clientForB = fakeClient(storeA, OWNER_B);
  const r = await activateElectionCampaign({ userId: OWNER_B, client: clientForB, requestedCampaign: campaignA });
  ok("A2. OWNER_B cannot activate/use campaign A merely by naming its real id", r.outcome === ACTIVATION.REFUSED);

  // A "conversation" object claiming a prior turn already established campaign
  // A as OWNER_B's scope — activateElectionCampaign() has no such parameter,
  // so this can only ever be an inert extra field, never a second authority
  // channel alongside requestedCampaign.
  const rWithConversation = await activateElectionCampaign({
    userId: OWNER_B, client: fakeClient(storeA, OWNER_B), requestedCampaign: campaignA,
    conversation: { lastCampaign: campaignA, subjects: [campaignA] },
  });
  ok("A2b. a hostile 'conversation' argument claiming prior campaign context is still REFUSED",
     rWithConversation.outcome === ACTIVATION.REFUSED);

  const ctx = await getElectionContext({ userId: OWNER_B, client: clientForB, requestedCampaign: campaignA });
  ok("A3. getElectionContext refuses the same way — no view, no readiness, whatever id is supplied",
     ctx.scope.outcome === ELECTION_SCOPE.REFUSED && ctx.view === null && ctx.readiness === null);

  // "Model-supplied" is not a distinct code path — there is exactly ONE
  // channel for any externally-sourced campaign id (`requestedCampaign`),
  // so a string a model invented is refused for the identical reason a
  // hand-typed one is. Proven by using the SAME parameter with a value that
  // corresponds to no real campaign at all.
  const modelGuess = "model-invented-campaign-id";
  const ctxModel = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A), requestedCampaign: modelGuess });
  ok("A4. a garbage/model-invented campaign id is REFUSED, not silently ignored in favour of OWNER_A's real campaign",
     ctxModel.scope.outcome === ELECTION_SCOPE.REFUSED && ctxModel.view === null);
}

// ============================================================
console.log("\nA5/A6/A7/A8 — hostile extra fields on the call itself have zero effect");
// ============================================================
{
  const store = freshStore();
  const client = fakeClient(store, OWNER_A);
  const hostile = await activateElectionCampaign({
    userId: OWNER_A, client, name: "Hostile Activation Test",
    candidate: { id: "fake-cand", name: "Fabricated Candidate" },
    ward: { id: "Ward 99", organisation: "Fabricated Org" },
    readiness: { candidateRegistered: true, score: 100 },
    organisationId: "org-HOSTILE", organisation_id: "org-HOSTILE",
  });
  ok("A5/A6. hostile candidate/ward fields change nothing about the outcome",
     hostile.outcome === ACTIVATION.CREATED);
  ok("A5. no candidate row/fact was fabricated anywhere reachable from this call",
     store.campaigns[0] && !("candidate" in store.campaigns[0]) && store.election_events.length === 0);

  const ctx = await getElectionContext({
    userId: OWNER_A, client: fakeClient(store, OWNER_A), requestedCampaign: hostile.campaignId,
    readiness: { candidateRegistered: true }, view: { candidates: { fake: {} } },
    organisationId: "org-HOSTILE",
  });
  ok("A7. a hostile 'readiness'/'view' argument on the call has zero effect — the real, honest Canon is still returned",
     ctx.readiness.candidateRegistered === false && Object.keys(ctx.view.candidates).length === 0);
  ok("A8. a hostile organisationId argument establishes nothing — scope still comes from campaign_members alone",
     ctx.scope.outcome === ELECTION_SCOPE.SCOPED && ctx.scope.campaignId === hostile.campaignId);
}

// ============================================================
console.log("\nA9 — conversation memory cannot establish Election scope (structural: no such parameter exists)");
// ============================================================
{
  ok("A9. electionContext.js accepts no conversation/session/memory parameter anywhere in its exported signatures",
     !/conversation|sessionMemory|chatHistory/i.test(src("../src/os/electionContext.js")));
}

// ============================================================
console.log("\nM3-TARGET — bootstrap's own campaignId is never trusted; scope is ALWAYS independently re-resolved");
// ============================================================
{
  // Structural companion to CBOOT-8 (electionBootstrap.js's own proof) at
  // THIS boundary: the create-path must call resolveElectionScope() AFTER
  // bootstrapCampaign(), in source order, not merely construct a SCOPED
  // result by hand from boot.campaignId.
  const activationSrc = src("../src/os/electionContext.js");
  // Bounded to JUST activateElectionCampaign()'s create-path — NOT to end of
  // file, which would also capture getElectionContext()'s own, unrelated
  // resolveElectionScope() call and let this check pass vacuously even if
  // the create-path's own re-verification were removed entirely.
  const createPath = activationSrc.slice(
    activationSrc.indexOf("const clean ="),
    activationSrc.indexOf("export async function loadElectionLog"),
  );
  const bootIdx = createPath.indexOf("bootstrapCampaign(");
  const scopeIdx = createPath.indexOf("resolveElectionScope(");
  ok("M3-TARGET. the create-path calls bootstrapCampaign() and THEN resolveElectionScope(), never skipping the re-check",
     bootIdx > -1 && scopeIdx > -1 && scopeIdx > bootIdx);
}

// ============================================================
console.log("\nM4-TARGET — activateElectionCampaign()'s own result never carries a readiness-shaped field");
// ============================================================
{
  // Distinct from A7/CBOOT-12 — those check getElectionContext()'s and
  // bootstrapCampaign()'s outputs respectively. activateElectionCampaign()
  // is a THIRD return surface and needs its own guarantee: activation
  // answers "do you now have a usable campaign?", never "what is its
  // readiness?" — that question belongs exclusively to
  // getElectionContext() -> deriveReadiness().
  const store = freshStore();
  const r = await activateElectionCampaign({ userId: OWNER_A, client: fakeClient(store, OWNER_A), name: "M4 Target Campaign" });
  ok("M4-TARGET. the activation result object carries no readiness/claims/gaps/candidateRegistered field",
     !("readiness" in r) && !("claims" in r) && !("gaps" in r) && !("candidateRegistered" in r));
}

// ============================================================
console.log("\nA10 — repeated activation never duplicates owner membership");
// ============================================================
{
  const client = fakeClient(storeA, OWNER_A);
  const repeat = await activateElectionCampaign({ userId: OWNER_A, client, name: "Ada for LG Chair" });
  ok("A10a. a second activation with the same name resolves to the SAME campaign, reported as ALREADY_MEMBER",
     repeat.outcome === ACTIVATION.ALREADY_MEMBER && repeat.campaignId === campaignA);
  ok("A10b. exactly one campaign row and one membership row exist after the repeat",
     storeA.campaigns.length === 1 && storeA.campaign_members.length === 1);
}

// ============================================================
console.log("\nA11 — campaign activation produces NO election events");
// ============================================================
{
  ok("A11a. after every activation in this suite so far, election_events remains empty",
     storeA.election_events.length === 0);
  ok("A11b. structural: activateElectionCampaign() never inserts into election_events — " +
     "only loadElectionLog()'s SELECT ever names that table for reading",
     !/from\(["']election_events["']\)\s*\n?\s*\.insert/.test(src("../src/os/electionContext.js")));
}

// ============================================================
console.log("\nA12 — an empty, freshly activated campaign produces an honest Canon end-to-end");
// ============================================================
{
  const ctx = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A) });
  ok("A12a. candidateRegistered is false through the FULL activation boundary, not just projectElection() directly",
     ctx.readiness.candidateRegistered === false);
  ok("A12b. the one claim is INCOMPLETE, per the existing readiness semantics — never fabricated",
     ctx.readiness.claims.length === 1 && ctx.readiness.claims[0].status === STATUS.INCOMPLETE);
  ok("A12c. no readiness score/probability field exists anywhere on the context result",
     !("score" in ctx.readiness) && !("percentReady" in ctx.readiness) && !("winProbability" in ctx.readiness));
}

// ============================================================
console.log("\nA13 — Canon refresh: a newly persisted event changes context output with NO cache");
// ============================================================
{
  const before = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A) });
  ok("A13a. before any event: candidateRegistered is false", before.readiness.candidateRegistered === false);

  const event = candidateEvent({
    candidate: "cand-ada", campaign: campaignA, name: "Ada Example",
    office: "LG Chair", constituency: "Ward 7", party: "Independent",
  });
  await fakeClient(storeA, OWNER_A).from("election_events").insert({
    event_id: event.eventId, campaign_id: campaignA, type: event.type,
    actor: OWNER_A, schema_version: "1", payload: event,
  });

  const after = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A) });
  ok("A13b. after the SAME event is persisted, a FRESH call reflects it immediately — candidateRegistered is now true",
     after.readiness.candidateRegistered === true);
  ok("A13c. this is a structurally different function-instance call, not a mutated cached object from `before`",
     before.readiness.candidateRegistered !== after.readiness.candidateRegistered);
}

// ============================================================
console.log("\nACTOR-KIND GATING (Loop 28) — an honest refusal for non-candidate actors, never fabricated readiness");
// ============================================================
{
  const storeNgo = freshStore();
  const clientNgo = fakeClient(storeNgo, OWNER_B);
  const ngoActivation = await activateElectionCampaign({
    userId: OWNER_B, client: clientNgo, name: "Election Watch NGO", actorKind: ACTOR_KIND.NGO_CSO,
  });
  ok("AK1. an NGO campaign activates successfully and reports its own actor kind",
     ngoActivation.outcome === ACTIVATION.CREATED && ngoActivation.actorKind === ACTOR_KIND.NGO_CSO);

  const ngoContext = await getElectionContext({ userId: OWNER_B, client: fakeClient(storeNgo, OWNER_B) });
  ok("AK2. getElectionContext() for a non-candidate actor returns readiness:null, view:null, unsupportedActorKind:true — " +
     "never a fabricated candidate/ward result",
     ngoContext.readiness === null && ngoContext.view === null && ngoContext.unsupportedActorKind === true &&
     ngoContext.actorKind === ACTOR_KIND.NGO_CSO);
  ok("AK3. the refusal is HONEST, not an error — scope itself is still correctly SCOPED (the campaign is real and accessible)",
     ngoContext.scope.outcome === ELECTION_SCOPE.SCOPED && ngoContext.error === null);

  const candidateContext = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A) });
  ok("AK4. a CANDIDATE_CAMPAIGN actor is COMPLETELY UNAFFECTED — full readiness computed exactly as every prior loop proved",
     candidateContext.actorKind === ACTOR_KIND.CANDIDATE_CAMPAIGN &&
     candidateContext.readiness !== null && !candidateContext.unsupportedActorKind);

  // TENANT ISOLATION ACROSS ACTOR KINDS — a candidate campaign and an NGO
  // campaign existing "around the same election" (Loop 28's own scenario)
  // must remain exactly as isolated as two candidate campaigns already are.
  // Not a new isolation mechanism — the SAME resolveElectionScope() check,
  // proven again at a new combination of tenants.
  const crossActor = await getElectionContext({
    userId: OWNER_A, client: fakeClient(storeA, OWNER_A), requestedCampaign: ngoActivation.campaignId,
  });
  ok("AK5. candidate A cannot read the NGO's campaign merely because both exist in the same Election Canon",
     crossActor.scope.outcome === ELECTION_SCOPE.REFUSED && crossActor.view === null);

  // LOOP 29 — OBSERVER_ORGANISATION gets its OWN readiness engine, not the
  // generic "unsupported" refusal every OTHER non-candidate kind still
  // gets. Detailed observer-specific coverage lives in
  // test/election-observer.consumer.mjs; this proves the ROUTING decision
  // itself, at the same layer AK1-AK5 already exercise.
  const storeObs = freshStore();
  const obsActivation = await activateElectionCampaign({
    userId: OWNER_A, client: fakeClient(storeObs, OWNER_A),
    name: "Election Watch Observers", actorKind: ACTOR_KIND.OBSERVER_ORGANISATION,
  });
  const obsContext = await getElectionContext({ userId: OWNER_A, client: fakeClient(storeObs, OWNER_A) });
  ok("AK6. OBSERVER_ORGANISATION is routed to its OWN readiness engine — not unsupported, not the candidate engine",
     obsContext.actorKind === ACTOR_KIND.OBSERVER_ORGANISATION && !obsContext.unsupportedActorKind &&
     obsContext.readiness !== null && obsContext.readiness.claims[0].dimension === "OBSERVER_ASSIGNMENT");
}

// ============================================================
console.log("\nPHASE 12 — CROSS-CHANNEL CONTRACT: Web and WhatsApp-style callers reach identical results");
// ============================================================
{
  // Two "channels" — neither passes anything the domain function even has a
  // parameter for. The only difference is cosmetic (which wrapper called
  // it); the arguments crossing into the domain are identical.
  async function webRequest({ userId, client, requestedCampaign }) {
    return getElectionContext({ userId, client, requestedCampaign });
  }
  async function whatsappRequest({ userId, client, requestedCampaign }) {
    return getElectionContext({ userId, client, requestedCampaign });
  }

  const webResult = await webRequest({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A), requestedCampaign: campaignA });
  const whatsappResult = await whatsappRequest({ userId: OWNER_A, client: fakeClient(storeA, OWNER_A), requestedCampaign: campaignA });

  ok("P12a. both channels resolve to the SAME campaign scope",
     webResult.scope.campaignId === whatsappResult.scope.campaignId);
  ok("P12b. both channels fold to structurally IDENTICAL readiness claims",
     JSON.stringify(webResult.readiness.claims) === JSON.stringify(whatsappResult.readiness.claims));
  ok("P12c. neither getElectionContext() nor activateElectionCampaign() accepts a channel/source parameter — " +
     "the domain cannot distinguish Web from WhatsApp from ForgeOS from API even if asked to",
     !/channel|source:\s*["'](web|whatsapp|forgeos|api)/i.test(src("../src/os/electionContext.js")));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
