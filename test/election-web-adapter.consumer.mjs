// ============================================================
// FORGE ELECTION — WEB ADAPTER  (Loop 26)
//
// Exercises electionWebAdapter.js against a STATEFUL fake Supabase client
// that now also simulates `.auth.getUser()` — MOCK evidence, no live
// database or live session (see the Loop 26 final report's honest
// classification).
//
// Run: node test/election-web-adapter.consumer.mjs
// ============================================================

import {
  getAuthenticatedUserId, readElectionCanon, activateElection,
  WRITE_CHANNEL, prepareElectionWrite, approveElectionWrite,
} from "../src/os/electionWebAdapter.js";
import { ACTIVATION } from "../src/os/electionContext.js";
import { ELECTION_SCOPE } from "../src/os/electionScope.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../src/domains/election/studio/readiness.js";
import { candidateEvent } from "../src/domains/election/events.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [] }; }

/** SAME table-behavior fake as test/election-activation.consumer.mjs, plus
 *  `.auth.getUser()` — the ONE new surface this loop's adapter calls. */
function fakeClient(store, asUser, { authError = null } = {}) {
  return {
    auth: {
      async getUser() {
        if (authError) return { data: { user: null }, error: { message: authError } };
        if (!asUser) return { data: { user: null }, error: null };
        return { data: { user: { id: asUser } }, error: null };
      },
    },
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
        // ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS F2) — see
        // election-activation.consumer.mjs's identical comment.
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

console.log("\nFORGE ELECTION — Web (session-authenticated channel) adapter\n");

// ============================================================
console.log("A — AUTHENTICATION");
// ============================================================
{
  const store = freshStore();
  const anon = fakeClient(store, null);
  ok("A1a. getAuthenticatedUserId with no session -> null", (await getAuthenticatedUserId({ client: anon })) === null);
  ok("A1b. getAuthenticatedUserId with a client that has no .auth at all -> null (never throws)",
     (await getAuthenticatedUserId({ client: {} })) === null);

  const errored = fakeClient(store, OWNER_A, { authError: "invalid or expired token" });
  ok("A1c. an auth ERROR (not merely absent) also resolves to null — never falls back to whatever id was attempted",
     (await getAuthenticatedUserId({ client: errored })) === null);

  const unauthed = await readElectionCanon({ client: anon });
  ok("A1d. readElectionCanon with no session -> UNAUTHENTICATED scope, no view, no readiness",
     unauthed.scope.outcome === ELECTION_SCOPE.UNAUTHENTICATED && unauthed.view === null && unauthed.readiness === null);

  const real = fakeClient(store, OWNER_A);
  ok("A2. getAuthenticatedUserId with a real session -> the actual session's user id",
     (await getAuthenticatedUserId({ client: real })) === OWNER_A);
}

let storeA, campaignA;
// ============================================================
console.log("\nD — ACTIVATION (via the Web adapter)");
// ============================================================
{
  storeA = freshStore();
  const r1 = await activateElection({ client: fakeClient(storeA, OWNER_A), name: "Ada for LG Chair" });
  ok("D1a. first activation via the adapter -> CREATED", r1.outcome === ACTIVATION.CREATED && Boolean(r1.campaignId));
  ok("D1b. exactly one campaign row and one owner membership row exist",
     storeA.campaigns.length === 1 && storeA.campaign_members.length === 1 &&
     storeA.campaign_members[0].person === OWNER_A && storeA.campaign_members[0].member_role === "owner");
  ok("D2. activation created NO election_events", storeA.election_events.length === 0);
  campaignA = r1.campaignId;

  const r2 = await activateElection({ client: fakeClient(storeA, OWNER_A), name: "Ada for LG Chair" });
  ok("D3a. a repeated activation resolves to the SAME campaign, reported ALREADY_MEMBER",
     r2.outcome === ACTIVATION.ALREADY_MEMBER && r2.campaignId === campaignA);
  ok("D3b. still exactly one campaign row and one membership row after the repeat",
     storeA.campaigns.length === 1 && storeA.campaign_members.length === 1);

  // Distinct from C1/C2 (readElectionCanon's readiness integrity) —
  // activateElection() is a SEPARATE return surface and must not answer a
  // question it was never asked: "does this campaign exist?" is not
  // "is it election-ready?". That question belongs exclusively to
  // readElectionCanon() -> getElectionContext() -> deriveReadiness().
  ok("D4. activateElection()'s own result never carries a readiness/claims/gaps field",
     !("readiness" in r1) && !("claims" in r1) && !("gaps" in r1) && !("candidateRegistered" in r1));
}

// ============================================================
console.log("\nB — CAMPAIGN SCOPE");
// ============================================================
{
  const own = await readElectionCanon({ client: fakeClient(storeA, OWNER_A), requestedCampaign: campaignA });
  ok("B1. OWNER_A's own campaign is accepted", own.scope.outcome === ELECTION_SCOPE.SCOPED && own.scope.campaignId === campaignA);

  const storeB = freshStore();
  const rB = await activateElection({ client: fakeClient(storeB, OWNER_B), name: "Bayo for State House" });
  const otherAttempt = await readElectionCanon({ client: fakeClient(storeA, OWNER_B), requestedCampaign: campaignA });
  ok("B2. OWNER_B requesting OWNER_A's real campaign id is REFUSED, not silently scoped",
     otherAttempt.scope.outcome === ELECTION_SCOPE.REFUSED && otherAttempt.view === null);

  const fabricated = await readElectionCanon({ client: fakeClient(storeA, OWNER_A), requestedCampaign: "fabricated-campaign-id" });
  ok("B3. a fabricated/garbage campaign id is REFUSED for OWNER_A too — no partial trust of an unknown id",
     fabricated.scope.outcome === ELECTION_SCOPE.REFUSED && fabricated.view === null);

  // M1-TARGET — a hostile 'userId' argument alongside a REAL session must
  // have zero effect. The session client here is authenticated as OWNER_A;
  // a caller also passing `userId: OWNER_B` (who has no membership in
  // campaign A) must not cause a refusal, because the only userId that is
  // ever meant to matter is the one the session itself proves.
  const hostileUserId = await readElectionCanon({
    client: fakeClient(storeA, OWNER_A), requestedCampaign: campaignA, userId: OWNER_B,
  });
  ok("M1-TARGET. a hostile 'userId' argument does not override the session's own authenticated identity",
     hostileUserId.scope.outcome === ELECTION_SCOPE.SCOPED && hostileUserId.scope.campaignId === campaignA);
}

// ============================================================
console.log("\nC — CANON INTEGRITY");
// ============================================================
{
  const result = await readElectionCanon({ client: fakeClient(storeA, OWNER_A) });
  ok("C1. an empty campaign's Canon through the adapter is honest — candidateRegistered false, one INCOMPLETE claim",
     result.readiness.candidateRegistered === false &&
     result.readiness.claims.length === 1 && result.readiness.claims[0].status === STATUS.INCOMPLETE);

  const hostile = await readElectionCanon({
    client: fakeClient(storeA, OWNER_A),
    readiness: { candidateRegistered: true, score: 100 }, view: { candidates: { fake: {} } },
    organisationId: "org-HOSTILE",
  });
  ok("C2. hostile readiness/view/organisationId arguments on the call have zero effect",
     hostile.readiness.candidateRegistered === false && Object.keys(hostile.view.candidates).length === 0);
}

// ============================================================
console.log("\nE — CANON REFRESH (no cache, through the Web adapter)");
// ============================================================
{
  const before = await readElectionCanon({ client: fakeClient(storeA, OWNER_A) });
  ok("E1a. before any event, candidateRegistered is false", before.readiness.candidateRegistered === false);

  const event = candidateEvent({
    candidate: "cand-ada", campaign: campaignA, name: "Ada Example",
    office: "LG Chair", constituency: "Ward 7", party: "Independent",
  });
  await fakeClient(storeA, OWNER_A).from("election_events").insert({
    event_id: event.eventId, campaign_id: campaignA, type: event.type,
    actor: OWNER_A, schema_version: "1", payload: event,
  });

  const after = await readElectionCanon({ client: fakeClient(storeA, OWNER_A) });
  ok("E1b. immediately after, a FRESH adapter call reflects the new event — candidateRegistered is now true",
     after.readiness.candidateRegistered === true);
  ok("E2. the two results are not the same object and do not share the stale value",
     before !== after && before.readiness.candidateRegistered !== after.readiness.candidateRegistered);
}

// ============================================================
console.log("\nF — CHANNEL INDEPENDENCE (structural)");
// ============================================================
{
  ok("F1. electionWebAdapter.js imports no React", !/from ["']react["']|import React/.test(src("../src/os/electionWebAdapter.js")));

  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const electionDir = join(repoRoot, "src", "domains", "election");
  const osFiles = ["electionContext.js", "electionScope.js", "electionBootstrap.js", "electionWebAdapter.js"]
    .map((f) => join(repoRoot, "src", "os", f));
  const walk = (d) => readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
  // Specific DOM/React/browser APIs, not the bare substrings "document."/
  // "window." — events.js's own DOCUMENT.PUBLISHED ("document.published",
  // a campaign situation report) legitimately contains "document." and is
  // not evidence of anything. CODE ONLY, via stripComments() — this file's
  // OWN header prose mentions "a future WhatsApp channel" as architecture
  // documentation, and scanning raw text would fail this check on a
  // comment, the exact R7 failure test/lib/source.mjs exists to prevent.
  const domainFiles = walk(electionDir);
  const offenders = [...domainFiles, ...osFiles].filter((f) =>
    /from ["']react["']|import React|\buseState\(|\buseEffect\(|whatsapp|browserState|window\.(location|navigator|localStorage)|document\.(getElementById|querySelector|createElement|cookie)/i
      .test(stripComments(readFileSync(f, "utf8"))));
  ok("F2. no Election domain/boundary module's CODE imports React, WhatsApp, browser state, or the DOM",
     offenders.length === 0);
}

// ============================================================
console.log("\nG — WRITE SAFETY (PREPARE/APPROVAL separation)");
// ============================================================
{
  const store = freshStore();
  const client = fakeClient(store, OWNER_A);
  const boot = await activateElection({ client, name: "Write Safety Test" });

  // M2-TARGET — an unauthorized caller must be refused at PREPARE time too,
  // not only at APPROVAL (G4 covers approveElectionWrite; this covers the
  // separate prepareElectionWrite code path, which has its own
  // resolveElectionScope() call).
  const unauthorizedPrepare = await prepareElectionWrite({
    client: fakeClient(store, OWNER_B), requestedCampaign: boot.campaignId,
    message: "Assign Team 6 to Ward 6",
  });
  ok("M2-TARGET. prepareElectionWrite refuses an unauthorized campaign BEFORE ever building a draft",
     unauthorizedPrepare.status === WRITE_CHANNEL.UNAUTHORIZED && unauthorizedPrepare.draft === null);

  const prepared = await prepareElectionWrite({
    client: fakeClient(store, OWNER_A), requestedCampaign: boot.campaignId,
    message: "Assign Team 6 to Ward 6",
  });
  ok("G1a. PREPARE returns a draft", prepared.status === "PREPARED" && prepared.draft?.draft);
  ok("G1b. PREPARE produced NO mutation — election_events is still empty", store.election_events.length === 0);
  ok("G1c. the draft is inert — published:false, authorised:false",
     prepared.draft.published === false && prepared.draft.authorised === false);

  ok("G2. prepareElectionWrite()'s own source never calls executeElectionWrite — structurally cannot auto-execute",
     !/prepareElectionWrite[\s\S]*?executeElectionWrite/.test(src("../src/os/electionWebAdapter.js").split("export async function approveElectionWrite")[0]));

  ok("G3. exactly ONE function in this file calls executeElectionWrite()",
     (src("../src/os/electionWebAdapter.js").match(/executeElectionWrite\(/g) ?? []).length === 1);

  // The unauthorized-approval guard: OWNER_B must not be able to execute
  // into campaign A's log merely by supplying its id alongside a draft.
  const hostileApproval = await approveElectionWrite({
    client: fakeClient(store, OWNER_B), requestedCampaign: boot.campaignId,
    draft: prepared.draft.draft, confirmationId: "hostile-confirm-1",
  });
  ok("G4. an unauthorized approval attempt is refused BEFORE reaching executeElectionWrite — no event is written",
     hostileApproval.success === false && hostileApproval.error === WRITE_CHANNEL.UNAUTHORIZED &&
     store.election_events.length === 0);

  const approved = await approveElectionWrite({
    client: fakeClient(store, OWNER_A), requestedCampaign: boot.campaignId,
    draft: prepared.draft.draft, confirmationId: "real-confirm-1",
  });
  ok("G5. a legitimate, explicit approval call succeeds and writes EXACTLY one event",
     approved.success === true && store.election_events.length === 1);

  const replay = await approveElectionWrite({
    client: fakeClient(store, OWNER_A), requestedCampaign: boot.campaignId,
    draft: prepared.draft.draft, confirmationId: "real-confirm-1",
  });
  ok("G6. replaying the SAME confirmationId is reported already-recorded, never a second event",
     replay.success === true && replay.alreadyRecorded === true && store.election_events.length === 1);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
