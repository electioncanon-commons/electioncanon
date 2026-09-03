// ============================================================
// ELECTIONCANON 1.1 PHASE 1 — RESPONSIBILITY REASSIGNMENT  (MOCK evidence)
//
// The security-critical logic lives in SQL (public.write_responsibility(),
// supabase/migrations/20260903000000_election_responsibility_reassignment.
// sql). This suite drives that logic through test/lib/
// fakeWriteResponsibility.mjs's instruction-for-instruction mirror — the
// SAME discipline test/election-invitations.consumer.mjs already
// established — so these tests prove the REAL security ordering,
// authorization matrix, compare-and-swap, and idempotency rules, not
// merely that geography/write.js's thin JS wrappers pass arguments
// through correctly.
// ============================================================

import {
  proposeAssignResponsibility, executeAssignResponsibility,
  proposeReassignResponsibility, executeReassignResponsibility,
} from "../src/domains/election/geography/write.js";
import { projectElection } from "../src/domains/election/projections.js";
import { ELECTION_EVENT_TYPES, responsibilityReassignedEvent } from "../src/domains/election/events.js";
import { backfillResponsibilitySlots, makeWriteResponsibilityHandler } from "./lib/fakeWriteResponsibility.mjs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON 1.1 PHASE 1 — Responsibility Reassignment\n");

// `geography` defaults to the module-level GEOGRAPHY fixture (defined
// below — safe: default parameter values are evaluated at CALL time, and
// every call to fakeClient() in this file happens after that `const` has
// been assigned) so a test only needs to override it when it deliberately
// wants a DIFFERENT geography fixture.
function fakeClient({ campaignMembers = [], events = [], invitations = [], geography = GEOGRAPHY } = {}) {
  const eventRows = events.map((e) => ({ event_id: e.eventId, campaign_id: e.campaign, type: e.type, actor: e.actor ?? null, payload: e }));
  const slots = backfillResponsibilitySlots(eventRows);
  const writeResponsibility = makeWriteResponsibilityHandler({ campaignMembers, eventRows, invitations, geography, slots });

  const client = {
    __uid: null,
    __setUser(uid) { client.__uid = uid; },
    __events: eventRows,
    __slots: slots,
    async rpc(name, params) {
      if (name === "write_responsibility") return writeResponsibility(client.__uid, params);
      return { data: null, error: { message: `unmocked rpc ${name}` } };
    },
    from(table) {
      if (table === "election_events") {
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
      }
      return { select: () => ({ eq: () => ({ order: () => ({ then: (r) => r({ data: [], error: null }) }) }) }) };
    },
  };
  return client;
}
// projectElection() expects its input log NEWEST-FIRST (it reverses
// internally to fold oldest-first — see projections.js's own header) —
// eventRows.push() naturally accumulates OLDEST-first, so this must
// .reverse() before returning, exactly like every sibling test file's own
// logFor() already does.
const logFor = (client, campaignId) => client.__events.filter((r) => r.campaign_id === campaignId).map((r) => r.payload).reverse();

const CAMPAIGN_A = "camp-a", CAMPAIGN_B = "camp-b";
const OWNER = "owner-uid", MANAGER = "manager-uid", LGA_COORD = "lga-coord-uid", WARD_COORD = "ward-coord-uid", OUTSIDER = "outsider-uid";
const OKPE = "lga-okpe", SAPELE = "lga-sapele";
const WARD_1 = "ward-1"; // in Okpe
const PU_1 = "pu-1"; // in ward-1

const GEOGRAPHY = {
  lgas: [{ id: OKPE }, { id: SAPELE }],
  wards: [{ id: WARD_1, lgaId: OKPE }],
  pollingUnits: [{ id: PU_1, wardId: WARD_1 }],
  constituencies: [{ id: "constituency-osu" }],
};

const ROSTER = [
  { id: "person-alice", name: "Alice" }, { id: "person-bob", name: "Bob" }, { id: "person-carol", name: "Carol" },
];

function baseMembers() {
  return [
    { campaign_id: CAMPAIGN_A, person: OWNER, member_role: "owner", status: "active" },
    { campaign_id: CAMPAIGN_A, person: MANAGER, member_role: "manager", status: "active" },
    { campaign_id: CAMPAIGN_A, person: LGA_COORD, member_role: "staff", status: "active" },
    { campaign_id: CAMPAIGN_A, person: WARD_COORD, member_role: "staff", status: "active" },
    { campaign_id: CAMPAIGN_A, person: OUTSIDER, member_role: "staff", status: "active" },
  ];
}

// ============================================================
// A — FOLD: A -> B, A -> null, A -> B -> C, history ordering, immutability
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);

  const assignPrepared = await proposeAssignResponsibility({
    fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY,
  });
  const assignResult = await executeAssignResponsibility({ draft: assignPrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-fold-1" });
  ok("A1. first assignment (Alice) succeeds and writes responsibility.assigned", assignResult.success && assignResult.event.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED);

  const view1 = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("A2. fold shows Alice as current person for the LGA slot", Object.values(view1.responsibilities).find((r) => r.geographyRef === OKPE)?.person === "person-alice");

  // A -> B
  const reassignABPrepared = await proposeReassignResponsibility({
    fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY,
  });
  ok("A3. proposeReassignResponsibility PREPARED for Alice -> Bob", reassignABPrepared.status === "PREPARED");
  const reassignABResult = await executeReassignResponsibility({ draft: reassignABPrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-fold-2" });
  ok("A4. Alice -> Bob reassignment succeeds and writes responsibility.reassigned", reassignABResult.success && reassignABResult.event.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED);

  const view2 = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const slot2 = Object.values(view2.responsibilities).find((r) => r.geographyRef === OKPE);
  ok("A5. fold shows Bob as current person after reassignment", slot2?.person === "person-bob");
  ok("A6. the SAME responsibility id is reused across assign -> reassign (slot identity persists)", Object.keys(view1.responsibilities)[0] === Object.keys(view2.responsibilities).find((k) => view2.responsibilities[k].geographyRef === OKPE));
  ok("A7. history records the Alice -> Bob handoff", slot2.history.length === 1 && slot2.history[0].previousPerson === "person-alice" && slot2.history[0].newPerson === "person-bob");

  // A -> null (vacate directly from Bob, i.e. B -> null)
  const vacatePrepared = await proposeReassignResponsibility({
    fields: { level: "lga", geographyRef: OKPE, newPersonId: null, expectedCurrentPerson: "person-bob" }, roster: ROSTER, geographyTree: GEOGRAPHY,
  });
  ok("A8. vacating (newPersonId omitted) is PREPARED, never refused as invalid", vacatePrepared.status === "PREPARED");
  const vacateResult = await executeReassignResponsibility({ draft: vacatePrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-fold-3" });
  ok("A9. vacate succeeds", vacateResult.success);
  const view3 = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const slot3 = Object.values(view3.responsibilities).find((r) => r.geographyRef === OKPE);
  ok("A10. fold shows the slot as vacant (person === null) after vacating, never falling back to Bob via `??`", slot3.person === null);
  ok("A11. history now has 2 entries, ordered oldest-first", slot3.history.length === 2 && slot3.history[0].newPerson === "person-bob" && slot3.history[1].newPerson === null);

  // vacant -> Carol (A -> B -> C chain's final leg, reassigning FROM a vacated state)
  const refillPrepared = await proposeReassignResponsibility({
    fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-carol", expectedCurrentPerson: null }, roster: ROSTER, geographyTree: GEOGRAPHY,
  });
  const refillResult = await executeReassignResponsibility({ draft: refillPrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-fold-4" });
  ok("A12. reassigning FROM a vacated slot (expectedCurrentPerson: null) to Carol succeeds", refillResult.success);
  const view4 = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const slot4 = Object.values(view4.responsibilities).find((r) => r.geographyRef === OKPE);
  ok("A13. fold shows Carol as current holder — full A -> B -> null -> C chain resolved correctly", slot4.person === "person-carol");
  const expectedChain = JSON.stringify(["person-bob", null, "person-carol"]);
  ok("A14. history has all 3 handoffs, in the exact order they happened (Bob, then vacate, then Carol)",
     slot4.history.length === 3 && JSON.stringify(slot4.history.map((h) => h.newPerson)) === expectedChain);

  // Historical event immutability — the ORIGINAL responsibility.assigned
  // event for this slot is still present, byte-identical, never edited.
  const originalEvent = logFor(client, CAMPAIGN_A).find((e) => e.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED && e.geographyRef === OKPE);
  ok("A15. the ORIGINAL responsibility.assigned event for this slot is still present and still names Alice as `person` — reassignment never edits history", originalEvent?.person === "person-alice");
  ok("A16. exactly 4 responsibility.assigned/reassigned events exist for this one slot (1 assign + 3 reassign), all immutable, all present", logFor(client, CAMPAIGN_A).filter((e) => e.geographyRef === OKPE && (e.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED || e.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED)).length === 4);
}

// ============================================================
// B — PROJECTION CONSISTENCY: election_events state == responsibility_slots state, after every op
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);

  async function assertConsistent(label, campaignId, level, geographyRef) {
    const view = projectElection(logFor(client, campaignId), campaignId);
    const foldPerson = Object.values(view.responsibilities).find((r) => r.level === level && r.geographyRef === geographyRef)?.person ?? null;
    const slot = client.__slots.get(`${campaignId}|${level}|${geographyRef}`);
    ok(label, (slot?.current_person ?? null) === foldPerson);
  }

  const assign = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeAssignResponsibility({ draft: assign.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-consistency-1" });
  await assertConsistent("B1. after first assignment, election_events fold and responsibility_slots agree", CAMPAIGN_A, "lga", OKPE);

  const reassign = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeReassignResponsibility({ draft: reassign.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-consistency-2" });
  await assertConsistent("B2. after reassignment, election_events fold and responsibility_slots agree", CAMPAIGN_A, "lga", OKPE);

  const vacate = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: null, expectedCurrentPerson: "person-bob" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeReassignResponsibility({ draft: vacate.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-consistency-3" });
  await assertConsistent("B3. after vacating, election_events fold and responsibility_slots agree (both null)", CAMPAIGN_A, "lga", OKPE);

  // A rejected write must leave BOTH sides exactly as they were.
  const before = { ...client.__slots.get(`${CAMPAIGN_A}|lga|${OKPE}`) };
  const beforeCount = logFor(client, CAMPAIGN_A).length;
  const badReassign = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-alice", expectedCurrentPerson: "person-bob" /* STALE — actually vacant now */ }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const badResult = await executeReassignResponsibility({ draft: badReassign.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-consistency-4" });
  ok("B4. a stale-expectation reassignment is refused", badResult.success === false);
  ok("B5. a refused write leaves responsibility_slots byte-identical to before the attempt", JSON.stringify(client.__slots.get(`${CAMPAIGN_A}|lga|${OKPE}`)) === JSON.stringify(before));
  ok("B6. a refused write appends NO new event — election_events count is unchanged", logFor(client, CAMPAIGN_A).length === beforeCount);
}

// ============================================================
// C — AUTHORIZATION
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);
  const seedAssign = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeAssignResponsibility({ draft: seedAssign.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-auth-seed" });

  client.__setUser(MANAGER);
  const managerReassign = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const managerResult = await executeReassignResponsibility({ draft: managerReassign.draft.draft, campaign: CAMPAIGN_A, userId: MANAGER, client, confirmationId: "resp-auth-manager" });
  ok("C1. manager can reassign an LGA slot", managerResult.success);

  client.__setUser(OUTSIDER);
  const outsiderReassign = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-carol", expectedCurrentPerson: "person-bob" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const outsiderResult = await executeReassignResponsibility({ draft: outsiderReassign.draft.draft, campaign: CAMPAIGN_A, userId: OUTSIDER, client, confirmationId: "resp-auth-outsider" });
  ok("C2. a staff member with no responsibility CANNOT reassign an LGA slot", outsiderResult.success === false && /not authorised/.test(outsiderResult.error));

  // Give LGA_COORD real, current authority over Okpe (via a fresh assign,
  // since Bob currently holds it — first vacate, then assign LGA_COORD's
  // own invite-linked responsibility so the ward-delegation check can see it).
  client.__setUser(OWNER);
  const givenToLgaCoord = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: `invite:${CAMPAIGN_A}:${LGA_COORD}`, expectedCurrentPerson: "person-bob" }, roster: [...ROSTER, { id: `invite:${CAMPAIGN_A}:${LGA_COORD}`, name: "LGA Coord" }], geographyTree: GEOGRAPHY });
  await executeReassignResponsibility({ draft: givenToLgaCoord.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-auth-give-lga" });

  client.__setUser(LGA_COORD);
  const wardAssignByLga = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "ward", geographyRef: WARD_1 }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const wardAssignByLgaResult = await executeAssignResponsibility({ draft: wardAssignByLga.draft.draft, campaign: CAMPAIGN_A, userId: LGA_COORD, client, confirmationId: "resp-auth-ward-by-lga" });
  ok("C3. the LGA Coordinator for Okpe CAN assign a Ward Coordinator for a ward INSIDE Okpe", wardAssignByLgaResult.success);

  client.__setUser(WARD_COORD);
  const wardReassignByOutsiderStaff = await proposeReassignResponsibility({ fields: { level: "ward", geographyRef: WARD_1, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const wardReassignByOutsiderStaffResult = await executeReassignResponsibility({ draft: wardReassignByOutsiderStaff.draft.draft, campaign: CAMPAIGN_A, userId: WARD_COORD, client, confirmationId: "resp-auth-ward-outsider" });
  ok("C4. a staff member with NO responsibility over the parent LGA cannot reassign a ward inside it, even if they hold a DIFFERENT ward elsewhere", wardReassignByOutsiderStaffResult.success === false);

  // unauthorized geography: a nonexistent ward id
  client.__setUser(OWNER);
  const badGeoPrepare = await proposeReassignResponsibility({ fields: { level: "ward", geographyRef: "not-a-real-ward", newPersonId: "person-bob", expectedCurrentPerson: null }, roster: ROSTER, geographyTree: GEOGRAPHY });
  ok("C5. an unrecognised ward geography reference is refused at PREPARE time (client-side validation)", badGeoPrepare.status === "NEEDS_GEOGRAPHY_REF");
}

// ============================================================
// D — INVITATION TRUST
// ============================================================
{
  const members = baseMembers();
  const invitations = [
    { id: "inv-1", campaign_id: CAMPAIGN_A, status: "accepted", accepted_by: "invitee-uid", intended_level: "ward", intended_geography_ref: WARD_1, intended_responsibility_role: "WARD_COORDINATOR" },
    { id: "inv-not-accepted", campaign_id: CAMPAIGN_A, status: "pending", accepted_by: null, intended_level: "ward", intended_geography_ref: WARD_1, intended_responsibility_role: "WARD_COORDINATOR" },
    { id: "inv-wrong-campaign", campaign_id: CAMPAIGN_B, status: "accepted", accepted_by: "invitee-uid", intended_level: "ward", intended_geography_ref: WARD_1, intended_responsibility_role: "WARD_COORDINATOR" },
  ];
  // Every identity used below (including the ones deliberately trying to
  // abuse a mismatched/foreign/forged invitation) must be a real active
  // member of CAMPAIGN_A — these tests target step 3 (invitation-trust
  // validation), not step 2 (membership guard), which would otherwise
  // reject them earlier for an unrelated reason.
  const client = fakeClient({
    campaignMembers: [...members,
      { campaign_id: CAMPAIGN_A, person: "invitee-uid", member_role: "staff", status: "active" },
      { campaign_id: CAMPAIGN_A, person: "forger-uid", member_role: "staff", status: "active" },
      { campaign_id: CAMPAIGN_A, person: "wrong-campaign-uid", member_role: "staff", status: "active" },
      { campaign_id: CAMPAIGN_A, person: "wrong-accepter-uid", member_role: "staff", status: "active" },
    ],
    invitations, geography: GEOGRAPHY,
  });

  client.__setUser("invitee-uid");
  const prepared = await proposeAssignResponsibility({ fields: { personId: `invite:${CAMPAIGN_A}:invitee-uid`, level: "ward", geographyRef: WARD_1 }, roster: [{ id: `invite:${CAMPAIGN_A}:invitee-uid`, name: "Invitee" }], geographyTree: GEOGRAPHY });
  const result = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: "invitee-uid", client, confirmationId: "resp-inv-1", viaInvitationId: "inv-1" });
  ok("D1. a valid, accepted invitation succeeds even though the accepter holds NO delegation authority (plain staff, no responsibility)", result.success);

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const written = Object.values(view.responsibilities).find((r) => r.geographyRef === WARD_1);
  ok("D2. the responsibility is created for the ACCEPTER's own invite:<campaign>:<uid> identity, never whatever the client's draft.person claimed", written?.person === `invite:${CAMPAIGN_A}:invitee-uid`);

  // D3 — p_new_person is ignored: simulate a hostile client passing a
  // DIFFERENT target person alongside a valid invitation, on a FRESH slot.
  client.__setUser("invitee2-uid");
  const invitations2 = [{ id: "inv-2", campaign_id: CAMPAIGN_A, status: "accepted", accepted_by: "invitee2-uid", intended_level: "ward", intended_geography_ref: "ward-2", intended_responsibility_role: "WARD_COORDINATOR" }];
  const geography2 = { ...GEOGRAPHY, wards: [...GEOGRAPHY.wards, { id: "ward-2", lgaId: OKPE }] };
  const client2 = fakeClient({ campaignMembers: [...members, { campaign_id: CAMPAIGN_A, person: "invitee2-uid", member_role: "staff", status: "active" }], invitations: invitations2, geography: geography2 });
  client2.__setUser("invitee2-uid");
  const hostileResult2 = await client2.rpc("write_responsibility", {
    p_campaign_id: CAMPAIGN_A, p_level: "ward", p_geography_ref: "ward-2", p_responsibility_role: "WARD_COORDINATOR",
    p_new_person: "person-someone-else-entirely", p_expected_current_person: null, p_event_id: "evt-hostile-2",
    p_via_invitation_id: "inv-2",
  });
  ok("D3. write_responsibility() ignores a hostile p_new_person on the invitation-trust path — the created responsibility names the AUTHENTICATED ACCEPTER, never the client-supplied value", hostileResult2.data?.current_person === `invite:${CAMPAIGN_A}:invitee2-uid` && hostileResult2.data?.current_person !== "person-someone-else-entirely");

  client.__setUser("forger-uid");
  const forgedPrepared = await proposeAssignResponsibility({ fields: { personId: `invite:${CAMPAIGN_A}:forger-uid`, level: "ward", geographyRef: WARD_1 }, roster: [{ id: `invite:${CAMPAIGN_A}:forger-uid`, name: "Forger" }], geographyTree: GEOGRAPHY });
  const forgedResult = await executeAssignResponsibility({ draft: forgedPrepared.draft.draft, campaign: CAMPAIGN_A, userId: "forger-uid", client, confirmationId: "resp-inv-forged", viaInvitationId: "does-not-exist" });
  ok("D4. a forged/nonexistent invitation id is rejected", forgedResult.success === false && /does not exist/.test(forgedResult.error));

  client.__setUser("wrong-campaign-uid");
  const wrongCampaignPrepared = await proposeAssignResponsibility({ fields: { personId: `invite:${CAMPAIGN_A}:wrong-campaign-uid`, level: "ward", geographyRef: WARD_1 }, roster: [{ id: `invite:${CAMPAIGN_A}:wrong-campaign-uid`, name: "X" }], geographyTree: GEOGRAPHY });
  const wrongCampaignResult = await executeAssignResponsibility({ draft: wrongCampaignPrepared.draft.draft, campaign: CAMPAIGN_A, userId: "wrong-campaign-uid", client, confirmationId: "resp-inv-wrong-campaign", viaInvitationId: "inv-wrong-campaign" });
  ok("D5. an invitation belonging to a DIFFERENT campaign is rejected", wrongCampaignResult.success === false && /does not belong to this campaign/.test(wrongCampaignResult.error));

  client.__setUser("wrong-accepter-uid");
  const wrongAccepterPrepared = await proposeAssignResponsibility({ fields: { personId: `invite:${CAMPAIGN_A}:wrong-accepter-uid`, level: "ward", geographyRef: WARD_1 }, roster: [{ id: `invite:${CAMPAIGN_A}:wrong-accepter-uid`, name: "Y" }], geographyTree: GEOGRAPHY });
  const wrongAccepterResult = await executeAssignResponsibility({ draft: wrongAccepterPrepared.draft.draft, campaign: CAMPAIGN_A, userId: "wrong-accepter-uid", client, confirmationId: "resp-inv-wrong-accepter", viaInvitationId: "inv-1" });
  ok("D6. an invitation accepted by a DIFFERENT person than the caller is rejected", wrongAccepterResult.success === false && /not accepted by the caller/.test(wrongAccepterResult.error));

  client.__setUser("invitee-uid");
  const notAcceptedPrepared = await proposeAssignResponsibility({ fields: { personId: `invite:${CAMPAIGN_A}:invitee-uid`, level: "ward", geographyRef: WARD_1 }, roster: [{ id: `invite:${CAMPAIGN_A}:invitee-uid`, name: "Invitee" }], geographyTree: GEOGRAPHY });
  const notAcceptedResult = await executeAssignResponsibility({ draft: notAcceptedPrepared.draft.draft, campaign: CAMPAIGN_A, userId: "invitee-uid", client, confirmationId: "resp-inv-not-accepted", viaInvitationId: "inv-not-accepted" });
  ok("D7. a still-pending (not yet accepted) invitation is rejected", notAcceptedResult.success === false && /has not been accepted/.test(notAcceptedResult.error));

  // wrong role/geography: a valid, accepted invitation for ward WARD_1,
  // but the write attempt claims a different geography ref.
  const mismatchClient = fakeClient({ campaignMembers: [...members, { campaign_id: CAMPAIGN_A, person: "invitee3-uid", member_role: "staff", status: "active" }], invitations: [{ id: "inv-3", campaign_id: CAMPAIGN_A, status: "accepted", accepted_by: "invitee3-uid", intended_level: "ward", intended_geography_ref: WARD_1, intended_responsibility_role: "WARD_COORDINATOR" }], geography: GEOGRAPHY });
  mismatchClient.__setUser("invitee3-uid");
  const mismatchResult = await mismatchClient.rpc("write_responsibility", {
    p_campaign_id: CAMPAIGN_A, p_level: "lga", p_geography_ref: OKPE, p_responsibility_role: "LGA_COORDINATOR",
    p_new_person: null, p_expected_current_person: null, p_event_id: "evt-mismatch-1", p_via_invitation_id: "inv-3",
  });
  ok("D8. an invitation cannot be used to write a DIFFERENT role/geography than it actually grants", mismatchResult.error != null && /does not grant this role\/geography/.test(mismatchResult.error.message));
}

// ============================================================
// E — IDEMPOTENCY
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);
  const prepared = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const first = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-idem-1" });
  ok("E1. first write succeeds", first.success && first.alreadyRecorded === false);

  const replay = await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-idem-1" });
  ok("E2. a legitimate retry with the SAME event_id/context is idempotent — success, alreadyRecorded, no error", replay.success && replay.alreadyRecorded === true && replay.error === null);

  ok("E3. exactly one responsibility.assigned event was actually persisted, never two", logFor(client, CAMPAIGN_A).filter((e) => e.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED).length === 1);

  // Foreign event_id: a DIFFERENT campaign's write reuses the SAME event_id.
  client.__setUser(OWNER);
  const foreignMembers = [...baseMembers(), { campaign_id: CAMPAIGN_B, person: OWNER, member_role: "owner", status: "active" }];
  const client2 = fakeClient({ campaignMembers: foreignMembers, geography: GEOGRAPHY });
  client2.__setUser(OWNER);
  const preparedA = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeAssignResponsibility({ draft: preparedA.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client: client2, confirmationId: "resp-idem-shared-id" });

  const preparedB = await proposeAssignResponsibility({ fields: { personId: "person-bob", level: "lga", geographyRef: SAPELE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const foreignAttempt = await executeAssignResponsibility({ draft: preparedB.draft.draft, campaign: CAMPAIGN_B, userId: OWNER, client: client2, confirmationId: "resp-idem-shared-id" });
  ok("E4. an event_id already used by a DIFFERENT campaign/slot is never treated as an idempotent replay — it fails as a genuine collision", foreignAttempt.success === false && foreignAttempt.alreadyRecorded === false);
  ok("E5. the collision error never discloses the foreign event's contents (no campaign/person/geography leaked in the message)", !/camp-a|person-alice|lga-okpe/.test(foreignAttempt.error ?? ""));
  const viewB = projectElection(logFor(client2, CAMPAIGN_B), CAMPAIGN_B);
  ok("E6. no responsibility was created for campaign B from the failed collision attempt", Object.keys(viewB.responsibilities).length === 0);
}

// ============================================================
// F — CONCURRENCY: two simultaneous writes to one slot, exactly one wins
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);
  const prepared = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeAssignResponsibility({ draft: prepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-concurrency-seed" });

  // Both "requests" read the SAME stale expectedCurrentPerson (Alice)
  // before either write lands — exactly the real race two users clicking
  // "reassign" within milliseconds of each other would produce.
  const reassignToBob = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const reassignToCarol = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-carol", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });

  const [resultBob, resultCarol] = await Promise.all([
    executeReassignResponsibility({ draft: reassignToBob.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-concurrency-1" }),
    executeReassignResponsibility({ draft: reassignToCarol.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-concurrency-2" }),
  ]);

  const successes = [resultBob, resultCarol].filter((r) => r.success);
  const failures = [resultBob, resultCarol].filter((r) => !r.success);
  ok("F1. exactly ONE of the two concurrent reassignment attempts succeeds", successes.length === 1);
  ok("F2. the loser receives a safe 'already changed' outcome, never a silent partial success", failures.length === 1 && /already has a responsibility recorded|already changed/.test(failures[0].error));

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  const finalHolder = Object.values(view.responsibilities).find((r) => r.geographyRef === OKPE)?.person;
  ok("F3. the fold shows exactly ONE final holder (whichever writer's atomic compare-and-swap actually landed first), never both / never corrupted", finalHolder === "person-bob" || finalHolder === "person-carol");
}

// ============================================================
// G — responsibilityReassignedEvent() factory: null-safety, required-argument discipline
// ============================================================
{
  ok("G1. responsibilityReassignedEvent requires previousPerson to be genuinely PROVIDED (undefined rejected)", (() => {
    try { responsibilityReassignedEvent({ responsibility: "r1", campaign: CAMPAIGN_A, level: "ward", geographyRef: WARD_1, responsibilityRole: "WARD_COORDINATOR", newPerson: "x" }); return false; }
    catch (e) { return /previousPerson/.test(e.message); }
  })());
  ok("G2. responsibilityReassignedEvent ACCEPTS previousPerson: null (an already-vacant slot) without throwing", (() => {
    const e = responsibilityReassignedEvent({ responsibility: "r1", campaign: CAMPAIGN_A, level: "ward", geographyRef: WARD_1, responsibilityRole: "WARD_COORDINATOR", previousPerson: null, newPerson: "x" });
    return e.previousPerson === null;
  })());
  ok("G3. responsibilityReassignedEvent ACCEPTS newPerson: null (a genuine vacate) without throwing, and the field is explicitly present, not stripped", (() => {
    const e = responsibilityReassignedEvent({ responsibility: "r1", campaign: CAMPAIGN_A, level: "ward", geographyRef: WARD_1, responsibilityRole: "WARD_COORDINATOR", previousPerson: "x", newPerson: null });
    return "newPerson" in e && e.newPerson === null;
  })());
}

// ============================================================
// PART H — BLOCKER FIX PASS F1: event_id/responsibility_id type consistency
//
// The forensic audit found write_responsibility()'s original p_event_id
// declared `uuid`, while the REAL election_events.event_id column
// (20260823000001_election_events.sql:53) is `text`, and this project's
// own live invitation-acceptance code has ALWAYS used a non-UUID
// confirmationId ('invite-resp:<campaign>:<uid>') for exactly this write.
// Fixed by making responsibility_slots.responsibility_id,
// responsibility_slots.current_event_id, and write_responsibility()'s
// p_event_id all `text` — no value in this chain is ever cast to uuid.
// ============================================================
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);

  // H1 — a UUID-SHAPED event id (the manual-UI path's real convention,
  // TerritorySection.jsx/shared.jsx's crypto.randomUUID()) still works.
  const uuidId = randomUUID();
  const uuidPrepared = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const uuidResult = await executeAssignResponsibility({ draft: uuidPrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: uuidId });
  ok("H1. a UUID-shaped confirmationId/event_id succeeds", uuidResult.success);
  const viewUuid = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("H1b. the responsibility subject id is the EXACT UUID string used as the confirmationId, unmodified", viewUuid.responsibilities[uuidId]?.geographyRef === OKPE);

  // H2 — the EXISTING, real invitation-acceptance confirmationId shape
  // ('invite-resp:<campaign>:<uid>') — not a UUID, must still succeed.
  const inviteShapedId = `invite-resp:${CAMPAIGN_A}:some-invitee-uid`;
  const invitePrepared = await proposeAssignResponsibility({ fields: { personId: "person-bob", level: "lga", geographyRef: SAPELE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  const inviteResult = await executeAssignResponsibility({ draft: invitePrepared.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: inviteShapedId });
  ok("H2. the REAL existing invitation-acceptance confirmationId shape ('invite-resp:<campaign>:<uid>', NOT a UUID) succeeds — this is the exact string invitations/write.js actually constructs", inviteResult.success);
  const viewInvite = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("H2b. the responsibility subject id is the EXACT non-UUID string, never coerced/rejected/truncated", viewInvite.responsibilities[inviteShapedId]?.geographyRef === SAPELE);
}

// H3 — historical backfill tolerates a non-UUID `responsibility` value
// (mirrors the migration's own backfill SELECT, which now copies
// `payload ->> 'responsibility'` with NO ::uuid cast).
{
  const historicalInviteShapedId = "invite-resp:camp-historical:some-old-uid";
  const historicalEvents = [{
    event_id: historicalInviteShapedId, campaign_id: "camp-historical", type: "responsibility.assigned",
    actor: "some-old-uid",
    payload: {
      type: "responsibility.assigned", responsibility: historicalInviteShapedId, campaign: "camp-historical",
      level: "ward", geographyRef: "ward-historical", responsibilityRole: "WARD_COORDINATOR",
      person: "invite:camp-historical:some-old-uid", status: "ASSIGNED", eventId: historicalInviteShapedId,
    },
  }];
  const backfilled = (() => { try { return backfillResponsibilitySlots(historicalEvents); } catch (e) { return e; } })();
  ok("H3. backfilling a historical, NON-UUID, invitation-shaped responsibility.assigned event never throws", !(backfilled instanceof Error));
  const slot = backfilled.get?.("camp-historical|ward|ward-historical");
  ok("H3b. the backfilled row's responsibility_id is the EXACT historical text value, never cast/rejected", slot?.responsibility_id === historicalInviteShapedId);
}

// H4 — A -> B -> C preserves the EXACT SAME non-UUID text responsibility
// subject id across every reassignment in the chain.
{
  const client = fakeClient({ campaignMembers: baseMembers() });
  client.__setUser(OWNER);
  const textId = "invite-resp:camp-a:first-holder-uid";

  const assign = await proposeAssignResponsibility({ fields: { personId: "person-alice", level: "lga", geographyRef: OKPE }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeAssignResponsibility({ draft: assign.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: textId });

  const reassignAB = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-bob", expectedCurrentPerson: "person-alice" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeReassignResponsibility({ draft: reassignAB.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-h4-2" });

  const reassignBC = await proposeReassignResponsibility({ fields: { level: "lga", geographyRef: OKPE, newPersonId: "person-carol", expectedCurrentPerson: "person-bob" }, roster: ROSTER, geographyTree: GEOGRAPHY });
  await executeReassignResponsibility({ draft: reassignBC.draft.draft, campaign: CAMPAIGN_A, userId: OWNER, client, confirmationId: "resp-h4-3" });

  const view = projectElection(logFor(client, CAMPAIGN_A), CAMPAIGN_A);
  ok("H4. the EXACT original non-UUID text subject id (from the first assignment's own confirmationId) is preserved unchanged across A -> B -> C",
     view.responsibilities[textId]?.person === "person-carol" && view.responsibilities[textId]?.history.length === 2);
}

// H5 — structural proof, against the REAL migration file text, that no
// value in this chain is ever cast to uuid.
{
  const migrationSrc = readFileSync(new URL("../supabase/migrations/20260903000000_election_responsibility_reassignment.sql", import.meta.url), "utf8");
  ok("H5a. responsibility_slots.responsibility_id is declared `text`, not `uuid`", /responsibility_id\s+text not null/.test(migrationSrc));
  ok("H5b. responsibility_slots.current_event_id is declared `text`, not `uuid`", /current_event_id\s+text not null/.test(migrationSrc));
  ok("H5c. write_responsibility()'s p_event_id parameter is declared `text`, not `uuid`", /p_event_id text/.test(migrationSrc));
  ok("H5d. NO ::uuid cast is applied to the backfill's `responsibility` column anywhere in this file",
     !/\(payload\s*->>\s*'responsibility'\)::uuid/.test(migrationSrc));
  ok("H5e. the grant/revoke statements for write_responsibility were updated to match the new text-typed signature (7th positional arg is text, not uuid)",
     migrationSrc.includes("function public.write_responsibility(uuid, text, text, text, text, text, text, text, uuid)"));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
