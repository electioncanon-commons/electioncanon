// ============================================================
// ELECTIONCANON ALPHA 1.2 — EVIDENCE/OCR/INCIDENT ADVERSARIAL SECURITY
//
// Same OWNER_A/OWNER_B fake-client pattern as
// test/election-web-adapter.consumer.mjs — a STATEFUL fake Supabase
// client simulating campaigns/campaign_members/election_events, plus a
// second fake table simulating storage.objects's RLS policy shape
// exactly (bucket_id = 'election-evidence' AND
// is_active_campaign_member(campaign)). This is MOCK evidence: the fake
// client simulates the rule in JS for a cheap, repeatable test, the same
// distinction election-chat.consumer.mjs's own header draws — the REAL
// Postgres policy was independently verified live against production in
// Alpha 1.1 (a direct pg_policies query) and is re-verified live again
// as part of this Alpha's own production walkthrough, not re-derived
// here.
//
// Proves: OWNER_B cannot record an OCR extraction, an incident
// escalation, or a polling unit into OWNER_A's campaign; OWNER_B cannot
// read or insert OWNER_A's evidence object; a hostile campaign id on any
// of these calls is refused the same way B2/B3 already proved for the
// original Alpha 1.0/1.1 operations.
// ============================================================

import {
  prepareElectionDayWrite, approveElectionDayWrite, ELECTION_DAY_OPERATION,
} from "../src/os/electionWebAdapter.js";
import { ELECTION_SCOPE } from "../src/os/electionScope.js";
import { randomUUID } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON ALPHA 1.2 — evidence/OCR/incident adversarial security\n");

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function freshStore() { return { campaigns: [], campaign_members: [], election_events: [] }; }

/** Identical shape to election-web-adapter.consumer.mjs's own fakeClient
 *  — see that file for why each chain shape exists. Duplicated rather
 *  than imported because it is test-local mock infrastructure, not
 *  production code the two files should share a dependency on. */
function fakeClient(store, asUser) {
  return {
    auth: { async getUser() { return { data: { user: asUser ? { id: asUser } : null }, error: null }; } },
    from(table) {
      if (table === "campaigns") {
        return {
          select() {
            return { eq(col1, val1) { return { async maybeSingle() {
              const rows = store.campaigns.filter((r) => r[col1] === val1);
              return { data: rows[0] ?? null, error: null };
            } }; } };
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
        return {
          select() {
            return { eq(col1, val1) { return { eq(col2, val2) {
              return (async () => ({ data: store.campaign_members.filter((r) => r[col1] === val1 && r[col2] === val2), error: null }))();
            } }; } };
          },
        };
      }
      if (table === "election_events") {
        return {
          select() {
            return { eq(col1, val1) { return { order() {
              return (async () => {
                const rows = store.election_events.filter((r) => r[col1] === val1).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
                return { data: rows.map((r) => ({ payload: r.payload })), error: null };
              })();
            } }; } };
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
      if (!store.campaign_members.find((m) => m.campaign_id === args.p_campaign_id && m.person === asUser)) {
        store.campaign_members.push({ campaign_id: args.p_campaign_id, person: asUser, member_role: "owner", status: "active" });
      }
      return { error: null };
    },
  };
}

/** Minimal bootstrap: create a campaign as `owner`, matching how
 *  activateElection() would leave the store, without importing that
 *  module's own full path (this file's concern is the electionDay
 *  operations, not re-testing activation). */
async function bootstrap(store, owner) {
  const client = fakeClient(store, owner);
  const { data } = await client.from("campaigns").insert({ name: "test", created_by: owner, actor_kind: "candidate_campaign" }).select().single();
  await client.rpc("ensure_campaign_owner", { p_campaign_id: data.id });
  return data.id;
}

// ============================================================
console.log("A — CROSS-TENANT REFUSAL: RECORD_OCR_EXTRACTION");
// ============================================================
{
  const storeA = freshStore();
  const campaignA = await bootstrap(storeA, OWNER_A);

  // OWNER_A legitimately captures a result first (RECORD_OCR_EXTRACTION
  // needs a resultId to exist conceptually, though this operation itself
  // does not check that a RESULT_CAPTURED event exists — it is exercised
  // here to prove the ADVERSARIAL-IDENTITY boundary, the same one every
  // other Election Day operation already proves).
  const ownerAClient = fakeClient(storeA, OWNER_A);
  const prepA = await prepareElectionDayWrite({
    client: ownerAClient, requestedCampaign: campaignA, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
    fields: { resultId: "res-1", ocrProvider: "tesseract.js", ocrStatus: "COMPLETE", ocrExtractedFields: [{ field: "A", value: "1", confidence: "HIGH" }] },
  });
  ok("A1. OWNER_A can prepare a RECORD_OCR_EXTRACTION in their own campaign", prepA.status === "PREPARED");
  const approveA = await approveElectionDayWrite({
    client: ownerAClient, requestedCampaign: campaignA, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
    draft: prepA.draft.draft, confirmationId: "ocr-conf-1",
  });
  ok("A2. ...and it is recorded", approveA.success);

  // Now the adversarial case: OWNER_B, authenticated as themselves, tries
  // to prepare/approve into OWNER_A's real campaign id using OWNER_A's
  // own store (simulating a hostile session pointed at someone else's
  // data — the same construction B2 in election-web-adapter.consumer.mjs
  // uses).
  const hostileClient = fakeClient(storeA, OWNER_B);
  const prepB = await prepareElectionDayWrite({
    client: hostileClient, requestedCampaign: campaignA, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
    fields: { resultId: "res-1", ocrProvider: "tesseract.js", ocrStatus: "COMPLETE", ocrExtractedFields: [] },
  });
  ok("A3. OWNER_B (not a member) is REFUSED at PREPARE — never even builds a draft",
    prepB.status !== "PREPARED" && prepB.draft === null);
  const approveB = await approveElectionDayWrite({
    client: hostileClient, requestedCampaign: campaignA, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
    draft: { type: "electionday.result.ocr_processed", result: "res-1", ocrStatus: "COMPLETE" },
    confirmationId: "hostile-ocr-1",
  });
  ok("A4. OWNER_B is ALSO refused at APPROVE even with a hand-crafted draft", !approveB.success);
  ok("A5. no event from OWNER_B's attempt reached the log",
    !storeA.election_events.some((e) => e.event_id === "hostile-ocr-1"));
}

// ============================================================
console.log("\nB — CROSS-TENANT REFUSAL: INCIDENT ESCALATION");
// ============================================================
{
  const storeA = freshStore();
  const campaignA = await bootstrap(storeA, OWNER_A);
  const hostileClient = fakeClient(storeA, OWNER_B);

  const prep = await prepareElectionDayWrite({
    client: hostileClient, requestedCampaign: campaignA, operation: ELECTION_DAY_OPERATION.CHANGE_INCIDENT_STATUS,
    fields: { incidentId: "inc-1", status: "ESCALATED", escalatedTo: OWNER_A }, roster: [{ id: OWNER_A, name: "Ada", roleType: "coordinator" }],
  });
  ok("B1. OWNER_B cannot escalate an incident inside OWNER_A's campaign — refused before ever reaching write.js's own roster check",
    prep.status !== "PREPARED");
}

// ============================================================
console.log("\nC — A FABRICATED CAMPAIGN ID IS REFUSED FOR ANY NEW OPERATION TOO");
// ============================================================
{
  const storeA = freshStore();
  await bootstrap(storeA, OWNER_A);
  const client = fakeClient(storeA, OWNER_A);
  const prep = await prepareElectionDayWrite({
    client, requestedCampaign: "00000000-0000-0000-0000-000000000000", operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
    fields: { resultId: "res-1", ocrStatus: "COMPLETE" },
  });
  ok("C1. a garbage campaign id is refused even for the legitimate owner, on the new operation",
    prep.status !== "PREPARED");
}

// ============================================================
console.log("\nD — EVIDENCE STORAGE RLS, SIMULATED AT THE SAME FIDELITY AS THE REAL POLICY");
// ============================================================
{
  // Mirrors supabase/migrations/20260828000000_election_forge_evidence_storage.sql
  // EXACTLY: bucket_id = 'election-evidence' AND
  // is_active_campaign_member((storage.foldername(name))[1]::uuid), for
  // both select and insert, no update/delete policy at all. This is a
  // JS-level simulation of that Postgres rule, not a re-derivation of it.
  function fakeStorage(members) {
    const objects = [];
    const isMember = (campaignId, user) => members.some((m) => m.campaignId === campaignId && m.user === user);
    return {
      asUser(user) {
        return {
          select(path) {
            const campaignId = path.split("/")[0];
            if (!isMember(campaignId, user)) return { data: null, error: { message: "new row violates row-level security policy" } };
            const obj = objects.find((o) => o.path === path);
            return obj ? { data: obj, error: null } : { data: null, error: { message: "not found" } };
          },
          insert(path) {
            const campaignId = path.split("/")[0];
            if (!isMember(campaignId, user)) return { error: { message: "new row violates row-level security policy" } };
            objects.push({ path, owner: user });
            return { error: null };
          },
        };
      },
      _objects: objects,
    };
  }

  const storage = fakeStorage([{ campaignId: "campA", user: OWNER_A }]);
  const insertA = storage.asUser(OWNER_A).insert("campA/res-1/result.png");
  ok("D1. OWNER_A (a real member) can insert evidence into their own campaign's path", !insertA.error);

  const insertB = storage.asUser(OWNER_B).insert("campA/res-1/result-hostile.png");
  ok("D2. OWNER_B (not a member of campA) is refused inserting into campA's evidence path", Boolean(insertB.error));

  const readB = storage.asUser(OWNER_B).select("campA/res-1/result.png");
  ok("D3. OWNER_B is ALSO refused reading (and therefore cannot obtain a signed URL for) campA's evidence object",
    Boolean(readB.error) && readB.data === null);

  const readA = storage.asUser(OWNER_A).select("campA/res-1/result.png");
  ok("D4. OWNER_A can read their own evidence object", !readA.error && readA.data?.path === "campA/res-1/result.png");

  ok("D5. no delete/update capability exists in this simulated client at all — matches the real migration's immutable-by-omission design",
    typeof storage.asUser(OWNER_A).delete === "undefined" && typeof storage.asUser(OWNER_A).update === "undefined");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail) process.exit(1);
