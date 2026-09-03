// ============================================================
// FORGE ELECTION — CANDIDATE REGISTRATION ACTIVATION  (Loop 32)
//
// Proves Loop 31's identified gap is closed: `candidate.registered` — a
// dimension that already existed, correctly derived, since Loop 22 — now
// has a real PREPARE -> APPROVAL -> EXECUTE write path, reusing every
// existing mechanism unchanged (proposeElectionWrite/executeElectionWrite,
// actorKindAuthorised, resolveElectionScope, getElectionContext,
// projectElection, deriveReadiness). No new readiness dimension, no new
// identity system, no new authorization engine was introduced.
//
// MOCK evidence only — a stateful fake Supabase client, no live database
// (see the Loop 32 final report's honest classification).
//
// Run: node test/election-candidate-registration.consumer.mjs
// ============================================================

import {
  activateElection, prepareElectionWrite, approveElectionWrite, readElectionCanon, WRITE_CHANNEL,
} from "../src/os/electionWebAdapter.js";
import { ACTOR_KIND } from "../src/os/electionBootstrap.js";
import { ELECTION_EVENT_TYPES, validateElectionEvent } from "../src/domains/election/events.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../src/domains/election/studio/readiness.js";
import { proposeElectionWrite, executeElectionWrite } from "../src/domains/election/studio/write.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [] }; }

/** Identical shape to test/election-write-authority.consumer.mjs's own fakeClient. */
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

console.log("\nFORGE ELECTION — candidate registration activation\n");

const LEGIT = "Register Ada Example as candidate for LG Chair in Ward 7, Independent";

// ============================================================
console.log("1 — the legitimate command produces a correct, inert draft");
// ============================================================
{
  const p = await proposeElectionWrite({ message: LEGIT });
  ok("1a. PREPARE recognises the command and produces a draft of the RIGHT type",
     p.status === "PREPARED" && p.draft.draft.type === ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED);
  ok("1b. the draft carries exactly the four content fields — no candidate/campaign id",
     Object.keys(p.draft.draft).sort().join(",") === "constituency,name,office,party,type" &&
     p.draft.draft.name === "Ada Example" && p.draft.draft.office === "LG Chair" &&
     p.draft.draft.constituency === "Ward 7" && p.draft.draft.party === "Independent");
  ok("1c. the draft is inert — published:false, authorised:false", p.draft.published === false && p.draft.authorised === false);
}

// ============================================================
console.log("\n2 — collision protection: natural questions/statements never become write commands");
// ============================================================
{
  const questions = [
    "Did I register as a candidate?",
    "Is the candidate registered?",
    "Was the candidate registered?",
    "Why is the candidate registered?",
    "Candidate registration is complete.",
    "Tell me whether the candidate is registered.",
    "Please remember to register Ada Example as candidate for LG Chair in Ward 7, Independent tomorrow.",
  ];
  for (const q of questions) {
    const r = await proposeElectionWrite({ message: q });
    ok(`2. '${q}' is never recognised as a write command`, r.status === "NOT_UNDERSTOOD" && r.draft === null);
  }
}

// ============================================================
console.log("\n3 — PREPARE field validation (missing pieces refused, never fabricated)");
// ============================================================
{
  // Whitespace-only-after-trim cases for name/office are reliably
  // constructible against matchCandidateRegister's regex (verified
  // empirically); the trailing party group interacts with the matcher's
  // own outer .trim() in a way that makes an analogous whitespace-only
  // construction unreliable — party's validation uses the SAME
  // validateFreeText() function proven generically elsewhere (e.g.
  // election-observer.consumer.mjs's W5), so this is not a coverage gap,
  // just an avoided fragile test construction.
  ok("3a. a whitespace-only name (empty after trim) is refused (NEEDS_NAME)",
     (await proposeElectionWrite({ message: "Register   as candidate for LG Chair in Ward 7, Independent" })).status === "NEEDS_NAME");
  ok("3b. a whitespace-only office (empty after trim) is refused (NEEDS_OFFICE)",
     (await proposeElectionWrite({ message: "Register Ada Example as candidate for    in Ward 7, Independent" })).status === "NEEDS_OFFICE");
}

// ============================================================
console.log("\n4 — hostile model proposal fields have zero effect on the resolved draft");
// ============================================================
{
  const hostile = await proposeElectionWrite({
    message: LEGIT,
    organisation_id: "org-HOSTILE", campaign_id: "campaign-HOSTILE", candidate_id: "cand-HOSTILE",
    actor_kind: "observer_organisation", is_candidate: true, registered: true, authorised: true,
    approved: true, execute: true, verified: true, event_id: "evt-HOSTILE",
    title: "Fake Title", at: "1999-01-01T00:00:00.000Z",
  });
  ok("4. every hostile field (organisation_id/campaign_id/candidate_id/actor_kind/is_candidate/registered/" +
     "authorised/approved/execute/verified/event_id/fake title/fake timestamp) has zero effect",
     hostile.status === "PREPARED" &&
     Object.keys(hostile.draft.draft).sort().join(",") === "constituency,name,office,party,type");
}

let storeCand, campaignCand, storeObs, campaignObs;
// ============================================================
console.log("\nSETUP — one candidate campaign, one observer campaign");
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
}

// ============================================================
console.log("\n5 — actor-kind isolation: only a candidate campaign may register a candidate");
// ============================================================
{
  const wrongKind = await prepareElectionWrite({ client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, message: LEGIT });
  ok("5a. an OBSERVER campaign attempting candidate registration is refused with the SPECIFIC actor-kind reason",
     wrongKind.status === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND && wrongKind.draft === null);

  const rightKind = await prepareElectionWrite({ client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand, message: LEGIT });
  ok("5b. the CANDIDATE campaign attempting the SAME command is allowed through to PREPARED", rightKind.status === "PREPARED");
}

// ============================================================
console.log("\n6 — PREPARE remains DB-inert");
// ============================================================
{
  ok("6. no election_events exist in either store after every PREPARE attempt above",
     storeCand.election_events.length === 0 && storeObs.election_events.length === 0);
}

// ============================================================
console.log("\n7 — APPROVAL independently re-checks authority, even for a hand-crafted hostile draft");
// ============================================================
{
  const hostileDraft = { type: ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED, name: "Ghost", office: "X", constituency: "Y", party: "Z" };
  const result = await approveElectionWrite({
    client: fakeClient(storeObs, OWNER_B), requestedCampaign: campaignObs, draft: hostileDraft, confirmationId: "hostile-7",
  });
  ok("7. APPROVAL refuses a candidate-registration draft for the OBSERVER campaign, with no prior PREPARE at all",
     result.success === false && result.error === WRITE_CHANNEL.UNAUTHORIZED_ACTOR_KIND && storeObs.election_events.length === 0);
}

// ============================================================
console.log("\n8 — cross-tenant: candidate A cannot register into campaign B via a hostile campaign field");
// ============================================================
{
  const storeCandB = freshStore();
  const candB = await activateElection({ client: fakeClient(storeCandB, OWNER_B), name: "Bayo for Senate" });

  const draft = { type: ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED, name: "Ada Example", office: "LG Chair", constituency: "Ward 7", party: "Independent" };
  const crossTenant = await approveElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand,
    draft, confirmationId: "cross-8", campaign: candB.campaignId, campaign_id: candB.campaignId,
  });
  ok("8. a hostile 'campaign'/'campaign_id' field claiming to redirect this approval to campaign B has zero effect",
     crossTenant.success === true && storeCand.election_events.some((e) => e.campaign_id === campaignCand) &&
     storeCandB.election_events.length === 0);

  // M3-TARGET — the hostile field this time lives INSIDE the draft object
  // itself (draft.campaign), a DIFFERENT injection point than test 8's
  // (which hostilely supplies campaign/campaign_id as call arguments,
  // never read by executeElectionWrite at all). executeElectionWrite's own
  // candidate branch must ignore draft.campaign exactly as thoroughly.
  const hostileDraftCampaign = {
    type: ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED, name: "Chidi Example",
    office: "Senate", constituency: "District 1", party: "Independent", campaign: candB.campaignId,
  };
  const draftCampaignAttack = await approveElectionWrite({
    client: fakeClient(storeCand, OWNER_A), requestedCampaign: campaignCand,
    draft: hostileDraftCampaign, confirmationId: "cross-8b",
  });
  // Checked via a REAL FOLD, not merely the stored row's campaign_id
  // column — projectElection() filters on the EVENT PAYLOAD's own
  // `campaign` field, so a hostile draft.campaign that corrupted only the
  // payload (while the stored row's campaign_id column stayed correct)
  // would make the event silently vanish from every tenant's Canon without
  // ever tripping a check that only inspects storage, not the fold. A
  // fresh read of campaignCand's OWN Canon must show the registration
  // actually landed, with the right content.
  const freshCanon = await readElectionCanon({ client: fakeClient(storeCand, OWNER_A) });
  ok("M3-TARGET. a hostile draft.campaign field has zero effect — a FRESH FOLD of campaignCand's own Canon " +
     "shows the registration, uncorrupted, and campaign B's Canon remains untouched",
     draftCampaignAttack.success === true &&
     freshCanon.view.candidates[campaignCand]?.name === "Chidi Example" &&
     storeCandB.election_events.length === 0);
}

let confirmationId9;
// ============================================================
console.log("\n9 — full lifecycle: empty Canon -> PREPARE -> unchanged -> APPROVAL -> fresh Canon COMPLETE");
// ============================================================
{
  const storeLife = freshStore();
  const life = await activateElection({ client: fakeClient(storeLife, OWNER_A), name: "Life Cycle Test Campaign" });

  const before = await readElectionCanon({ client: fakeClient(storeLife, OWNER_A) });
  ok("9a. before registration, CANDIDATE_REGISTERED reads INCOMPLETE — the EXISTING readiness semantics, not altered",
     before.readiness.claims[0].dimension === "CANDIDATE_REGISTERED" && before.readiness.claims[0].status === STATUS.INCOMPLETE &&
     before.readiness.candidateRegistered === false);

  const prep = await prepareElectionWrite({ client: fakeClient(storeLife, OWNER_A), requestedCampaign: life.campaignId, message: LEGIT });
  ok("9b. PREPARE succeeds; Canon is still unchanged", prep.status === "PREPARED" && storeLife.election_events.length === 0);

  const midCheck = await readElectionCanon({ client: fakeClient(storeLife, OWNER_A) });
  ok("9c. re-reading mid-PREPARE is UNCHANGED — still INCOMPLETE, proving PREPARE is DB-inert",
     midCheck.readiness.claims[0].status === STATUS.INCOMPLETE);

  confirmationId9 = randomUUID();
  const approve = await approveElectionWrite({
    client: fakeClient(storeLife, OWNER_A), requestedCampaign: life.campaignId, draft: prep.draft.draft, confirmationId: confirmationId9,
  });
  ok("9d. approval writes EXACTLY one event", approve.success === true && storeLife.election_events.length === 1);
  ok("9e. the stored event is a real, validated candidate.registered event with candidate === campaign",
     storeLife.election_events[0].type === ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED &&
     validateElectionEvent(storeLife.election_events[0].payload).valid === true &&
     storeLife.election_events[0].payload.candidate === life.campaignId);

  const after = await readElectionCanon({ client: fakeClient(storeLife, OWNER_A) });
  ok("9f. a FRESH Canon read now shows COMPLETE — from re-folding the persisted event, never a local patch",
     after.readiness.claims[0].status === STATUS.COMPLETE && after.readiness.candidateRegistered === true);
  ok("9g. this is a structurally NEW object, not `before`/`midCheck` mutated in place",
     before !== after && before.readiness.claims[0].status !== after.readiness.claims[0].status);

  // 10 — idempotent replay
  const replay = await approveElectionWrite({
    client: fakeClient(storeLife, OWNER_A), requestedCampaign: life.campaignId, draft: prep.draft.draft, confirmationId: confirmationId9,
  });
  ok("10. replaying the SAME confirmationId is reported already-recorded, never a second event",
     replay.success === true && replay.alreadyRecorded === true && storeLife.election_events.length === 1);

  // 13 — cross-domain non-interference
  const wardEvent = await prepareElectionWrite({ client: fakeClient(storeLife, OWNER_A), requestedCampaign: life.campaignId, message: "Assign Team 6 to Ward 6" });
  await approveElectionWrite({ client: fakeClient(storeLife, OWNER_A), requestedCampaign: life.campaignId, draft: wardEvent.draft.draft, confirmationId: randomUUID() });
  const finalCanon = await readElectionCanon({ client: fakeClient(storeLife, OWNER_A) });
  ok("13. candidate registration changed ONLY candidates{} — wards{} independently reflects its OWN event, no cross-contamination",
     Object.keys(finalCanon.view.candidates).length === 1 && "Ward 6" in finalCanon.view.wards &&
     finalCanon.view.candidates[life.campaignId].name === "Ada Example");
}

// ============================================================
console.log("\n11 — non-fabrication: registration implies nothing beyond the declaration itself");
// ============================================================
{
  ok("11a. write.js contains no eligibility/nomination/party-approval/INEC vocabulary",
     !/eligib|nominat|party.approv|inec/i.test(src("../src/domains/election/studio/write.js")));
  ok("11b. events.js's REQUIRED_ACTOR_KIND is unchanged — still exactly the pre-existing four entries",
     Object.values(JSON.parse(JSON.stringify(
       (await import("../src/domains/election/events.js")).REQUIRED_ACTOR_KIND))).length === 4);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
