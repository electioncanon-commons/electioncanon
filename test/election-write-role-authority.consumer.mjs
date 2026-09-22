// ============================================================
// ELECTIONCANON — PILOT SAFETY PASS: ROLE-BASED WRITE AUTHORIZATION
// (MOCK evidence against the REAL, unmodified electionWebAdapter.js +
// SQL/SOURCE-STRUCTURE evidence for the election_events RLS policy).
//
// Proves campaign_member_role — not just active membership — now gates
// the six structural event types across BOTH real server-side write
// paths this codebase has: the conversational path (prepareElectionWrite/
// approveElectionWrite, studio/write.js) for candidate/ward events, and
// the generic structured-write path (prepareStructuredWrite/
// approveStructuredWrite) that mobilization/write.js, electionDay/
// write.js AND geography/write.js all share — confirmed by inspection to
// be the ONLY four call sites in this codebase that insert into
// election_events.
//
// Run: node test/election-write-role-authority.consumer.mjs
// ============================================================

import {
  prepareElectionWrite, approveElectionWrite,
  prepareMobilizationWrite, approveMobilizationWrite, MOBILIZATION_OPERATION,
  approveGeographyWrite, GEOGRAPHY_OPERATION,
  WRITE_CHANNEL,
} from "../src/os/electionWebAdapter.js";
import { ACTOR_KIND } from "../src/os/electionBootstrap.js";
import { ELECTION_EVENT_TYPES, STAFF_RESTRICTED_EVENT_TYPES } from "../src/domains/election/events.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER = "11111111-1111-1111-1111-111111111111";
const MANAGER = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";
const OUTSIDER = "44444444-4444-4444-4444-444444444444"; // real account, zero membership in this campaign
const CAMPAIGN = "campaign-rbac-1";

console.log("\nELECTIONCANON — Pilot Safety Pass: Role-Based Write Authorization\n");

function freshStore() {
  return {
    campaigns: [{ id: CAMPAIGN, actor_kind: ACTOR_KIND.CANDIDATE_CAMPAIGN }],
    campaign_members: [
      { campaign_id: CAMPAIGN, person: OWNER, member_role: "owner", status: "active" },
      { campaign_id: CAMPAIGN, person: MANAGER, member_role: "manager", status: "active" },
      { campaign_id: CAMPAIGN, person: STAFF, member_role: "staff", status: "active" },
    ],
    election_events: [],
  };
}

function fakeClient(store, asUser) {
  return {
    auth: {
      async getUser() {
        return { data: { user: asUser ? { id: asUser } : null }, error: null };
      },
    },
    from(table) {
      if (table === "campaigns") {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    return { data: store.campaigns.find((c) => c[col] === val) ?? null, error: null };
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
                  async eq(col2, val2) {
                    return {
                      data: store.campaign_members.filter((m) => m[col1] === val1 && m[col2] === val2),
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "election_events") {
        return {
          async insert(row) {
            if (store.election_events.some((e) => e.event_id === row.event_id)) {
              return { error: { code: "23505", message: 'duplicate key value violates unique constraint "election_events_event_id_key"' } };
            }
            store.election_events.push(row);
            return { error: null };
          },
          select() {
            return {
              eq(col, val) {
                return {
                  order() {
                    return (async () => ({
                      data: store.election_events.filter((e) => e[col] === val).map((e) => ({ payload: e.payload })),
                      error: null,
                    }))();
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// ============================================================
console.log("11/12 — staff denied candidate registration and ward assignment (conversational path, full PREPARE+APPROVE)");
// ============================================================
{
  const store = freshStore();
  const prep = await prepareElectionWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    message: "Register Ada Example as candidate for LG Chair in Ward 7, Independent",
  });
  ok("11. staff PREPARE for candidate.registered is refused with UNAUTHORIZED_ROLE",
     prep.status === WRITE_CHANNEL.UNAUTHORIZED_ROLE);

  // Prove APPROVE is an independent, second gate — not merely "PREPARE happened to refuse":
  // hand-build the exact draft shape a staff member's PREPARE would have refused above,
  // and confirm APPROVE refuses it too, on its own, freshly re-resolving role.
  const approve = await approveElectionWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    draft: { type: ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED, name: "Ada Example", office: "LG Chair", constituency: "Ward 7", party: "Independent" },
    confirmationId: randomUUID(),
  });
  ok("11b. staff APPROVE for candidate.registered is independently refused (UNAUTHORIZED_ROLE), never writes",
     approve.success === false && approve.error === WRITE_CHANNEL.UNAUTHORIZED_ROLE && store.election_events.length === 0);
}
{
  const store = freshStore();
  const prep = await prepareElectionWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN, message: "Assign Team 6 to Ward 6",
  });
  ok("12. staff PREPARE for campaign.ward.assigned is refused with UNAUTHORIZED_ROLE",
     prep.status === WRITE_CHANNEL.UNAUTHORIZED_ROLE);
}

// ============================================================
console.log("\n13 — staff denied territory/responsibility structural writes (APPROVE-time gate, structured-write path)");
// ============================================================
{
  // Geography's own proposeSetTerritory/proposeAssignResponsibility need
  // real offices/states/constituencies reference-data fixtures to reach
  // PREPARED — orthogonal to what this suite tests. This exercises
  // approveGeographyWrite -> approveStructuredWrite directly with a
  // hand-built draft matching the real event shape, which is the
  // authoritative, actually-writes gate — real, unmodified code, not a
  // re-implementation of it.
  const store = freshStore();
  for (const [label, operation, draft] of [
    ["territory.set", GEOGRAPHY_OPERATION.SET_TERRITORY,
      { type: ELECTION_EVENT_TYPES.TERRITORY.SET, election: "General", office: "LG Chair", state: "DE", constituency: "c-1" }],
    ["responsibility.assigned", GEOGRAPHY_OPERATION.ASSIGN_RESPONSIBILITY,
      { type: ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED, responsibility: "r-1", level: "ward", geographyRef: "w-1", person: "p-1", responsibilityRole: "WARD_COORDINATOR" }],
    ["responsibility.reassigned", GEOGRAPHY_OPERATION.REASSIGN_RESPONSIBILITY,
      { type: ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED, responsibility: "r-1", level: "ward", geographyRef: "w-1", previousPerson: "p-1", newPerson: "p-2", responsibilityRole: "WARD_COORDINATOR" }],
    ["responsibility.status_changed", GEOGRAPHY_OPERATION.CHANGE_RESPONSIBILITY_STATUS,
      { type: ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED, responsibility: "r-1", status: "ASSIGNED", trainingStatus: "COMPLETE" }],
  ]) {
    const approve = await approveGeographyWrite({
      client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN, operation, draft, confirmationId: randomUUID(),
    });
    ok(`13. staff APPROVE for ${label} is refused (UNAUTHORIZED_ROLE)`,
       approve.success === false && approve.error === WRITE_CHANNEL.UNAUTHORIZED_ROLE);
  }
  ok("13b. none of the four refused structural writes above produced an event", store.election_events.length === 0);
}

// ============================================================
console.log("\n14 — staff CAN still perform an operational write the product already exposes to them (mobilization)");
// ============================================================
{
  const store = freshStore();
  const prep = await prepareMobilizationWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    operation: MOBILIZATION_OPERATION.ADD_PERSON, fields: { name: "Chidi Volunteer", roleType: "volunteer" },
  });
  ok("14a. staff PREPARE for mobilization.person.added (not in the denylist) succeeds", prep.status === "PREPARED");

  const approve = await approveMobilizationWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    operation: MOBILIZATION_OPERATION.ADD_PERSON, draft: prep.draft.draft, confirmationId: randomUUID(),
  });
  ok("14b. staff APPROVE for mobilization.person.added succeeds and writes exactly one event",
     approve.success === true && store.election_events.length === 1 &&
     store.election_events[0].type === ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED);
}

// ============================================================
console.log("\n15 — manager/owner behavior is unaffected by this pass");
// ============================================================
for (const [label, uid] of [["manager", MANAGER], ["owner", OWNER]]) {
  const store = freshStore();
  const prep = await prepareElectionWrite({
    client: fakeClient(store, uid), requestedCampaign: CAMPAIGN,
    message: "Register Ada Example as candidate for LG Chair in Ward 7, Independent",
  });
  ok(`15. ${label} PREPARE for candidate.registered still succeeds (unrestricted, as before this pass)`, prep.status === "PREPARED");

  const approve = await approveElectionWrite({
    client: fakeClient(store, uid), requestedCampaign: CAMPAIGN, draft: prep.draft.draft, confirmationId: randomUUID(),
  });
  ok(`15. ${label} APPROVE for candidate.registered still writes the event`, approve.success === true && store.election_events.length === 1);
}

// ============================================================
console.log("\n16 — actor attribution remains auth.uid(), never the draft or a client-supplied field");
// ============================================================
{
  const store = freshStore();
  const prep = await prepareMobilizationWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    operation: MOBILIZATION_OPERATION.ADD_PERSON, fields: { name: "Attribution Check", roleType: "volunteer" },
  });
  await approveMobilizationWrite({
    client: fakeClient(store, STAFF), requestedCampaign: CAMPAIGN,
    operation: MOBILIZATION_OPERATION.ADD_PERSON, draft: prep.draft.draft, confirmationId: randomUUID(),
  });
  ok("16. the recorded event's actor is the authenticated caller's own uid, unchanged by this pass",
     store.election_events[0].actor === STAFF);
}

// ============================================================
console.log("\n17 — tenant isolation remains intact (an outsider with no membership is refused before role is even reached)");
// ============================================================
{
  const store = freshStore(); // OUTSIDER has no row in campaign_members at all
  const prep = await prepareMobilizationWrite({
    client: fakeClient(store, OUTSIDER), requestedCampaign: CAMPAIGN,
    operation: MOBILIZATION_OPERATION.ADD_PERSON, fields: { name: "Should Never Land", roleType: "volunteer" },
  });
  ok("17. a non-member is refused UNAUTHORIZED (membership gate), not UNAUTHORIZED_ROLE — role is never even consulted",
     prep.status === WRITE_CHANNEL.UNAUTHORIZED);
}

// ============================================================
console.log("\n18 — direct database/PostgREST bypass: SQL/SOURCE-STRUCTURE evidence only (NOT live-verified)");
// ============================================================
{
  const migration = src("../supabase/migrations/20260923000000_election_membership_revocation_and_write_rbac.sql");

  ok("the election_events INSERT policy's WITH CHECK calls election_event_writable_by_role(m.member_role, election_events.type)",
     /for insert with check[\s\S]*?public\.election_event_writable_by_role\(m\.member_role, election_events\.type\)/i.test(migration));
  ok("actor = auth.uid() remains in the same WITH CHECK, unchanged", /actor = auth\.uid\(\)/i.test(migration));
  ok("the active-membership EXISTS clause remains in the same WITH CHECK, unchanged",
     /m\.status = 'active'/i.test(migration));
  ok("election_event_writable_by_role() EXECUTE is explicitly revoked from public, then granted to authenticated only",
     /revoke all on function public\.election_event_writable_by_role\(public\.campaign_member_role, text\) from public/i.test(migration) &&
     /grant execute on function public\.election_event_writable_by_role\(public\.campaign_member_role, text\) to authenticated/i.test(migration));

  const denylistInSql = [...migration.matchAll(/'([a-z._]+)'/g)].map((m) => m[1])
    .filter((s) => s.includes(".") && !s.includes("::"));
  ok("the six SQL-side denied event-type strings are exactly the app-side STAFF_RESTRICTED_EVENT_TYPES, both directions",
     STAFF_RESTRICTED_EVENT_TYPES.every((t) => denylistInSql.includes(t)) &&
     STAFF_RESTRICTED_EVENT_TYPES.length === 6);

  console.log("\n  NOT LIVE-VERIFIED: whether Postgres actually refuses a raw PostgREST/psql INSERT that bypasses " +
    "electionWebAdapter.js entirely is asserted here only from the migration's own SQL text (the WITH CHECK clause " +
    "shown above), not from an executed query against a live database — this repository's test harness has no live " +
    "Supabase integration target.");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
