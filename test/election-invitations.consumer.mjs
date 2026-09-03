// ============================================================
// CAMPAIGN ORGANISATION ONBOARDING — INVITATIONS  (MOCK evidence)
//
// The security-critical logic (who may invite whom, token/email
// verification, idempotent acceptance, expiry/revocation) lives in SQL
// (20260831000000_election_campaign_invitations.sql's create_campaign_
// invitation()/accept_campaign_invitation()). This suite builds a fake
// `client.rpc()` that mirrors that plpgsql logic instruction-for-
// instruction, so these tests prove the AUTHORIZATION RULES themselves,
// not merely that the thin JS wrappers in invitations/write.js pass
// arguments through correctly.
// ============================================================

import { createInvitation, revokeInvitation, acceptInvitation } from "../src/domains/election/invitations/write.js";
import { projectElection } from "../src/domains/election/projections.js";
import { ELECTION_EVENT_TYPES } from "../src/domains/election/events.js";
import { backfillResponsibilitySlots, makeWriteResponsibilityHandler } from "./lib/fakeWriteResponsibility.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nCAMPAIGN ORGANISATION ONBOARDING — Invitations\n");

// ---------- fake environment: campaign_members + election_events + campaign_invitations + geography ----------
function fakeEnv({ campaignMembers = [], events = [], geography = {} } = {}) {
  const invitations = [];
  const eventRows = events.map((e) => ({ event_id: e.eventId, campaign_id: e.campaign, type: e.type, actor: e.actor ?? null, payload: e }));
  const authUsersByUid = new Map(); // uid -> email
  // ELECTIONCANON 1.1 PHASE 1 — the responsibility_slots current-state
  // projection, backfilled once from `events` exactly like the real
  // migration's own one-time backfill, then mutated live by
  // write_responsibility() below.
  const responsibilitySlots = backfillResponsibilitySlots(eventRows);
  const writeResponsibilityRpc = makeWriteResponsibilityHandler({
    campaignMembers, eventRows, invitations, geography, slots: responsibilitySlots,
  });

  function currentMemberRole(campaignId, uid) {
    return campaignMembers.find((m) => m.campaign_id === campaignId && m.person === uid && m.status === "active")?.member_role ?? null;
  }
  // ELECTIONCANON 1.1 PHASE 1 — also checks responsibilitySlots (the
  // current-state projection), not only raw responsibility.assigned
  // events, mirroring create_campaign_invitation()'s own real-SQL update
  // in supabase/migrations/20260903000000_election_responsibility_
  // reassignment.sql — a coordinator who arrived via reassignment must be
  // able to delegate invitations exactly like one who arrived via the
  // original first assignment.
  function hasResponsibility(campaignId, level, geographyRef, uid) {
    const role = currentMemberRole(campaignId, uid);
    if (role === "owner" || role === "manager") return true;
    const slot = responsibilitySlots.get(`${campaignId}|${level}|${geographyRef}`);
    if (slot?.current_person === `invite:${campaignId}:${uid}`) return true;
    return eventRows.some((r) => r.campaign_id === campaignId && r.type === "responsibility.assigned" &&
      r.payload.level === level && r.payload.geographyRef === geographyRef &&
      r.payload.person === `invite:${campaignId}:${uid}`);
  }

  function geographyWardLga(wardId) { return (geography.wards ?? []).find((w) => w.id === wardId)?.lgaId ?? null; }
  function geographyPuWard(puId) { return (geography.pollingUnits ?? []).find((p) => p.id === puId)?.wardId ?? null; }

  const client = {
    __uid: null,
    __setUser(uid, email) { client.__uid = uid; if (uid) authUsersByUid.set(uid, email); },
    __events: eventRows,
    __invitations: invitations,
    __memberRows: campaignMembers,
    auth: {
      getUser: async () => ({ data: { user: client.__uid ? { id: client.__uid } : null } }),
    },
    async rpc(name, params) {
      if (name === "create_campaign_invitation") {
        const uid = client.__uid;
        if (!uid) return { data: null, error: { message: "create_campaign_invitation requires an authenticated session" } };
        const role = currentMemberRole(params.p_campaign_id, uid);
        if (!role) return { data: null, error: { message: "you are not an active member of this campaign" } };
        if (!["manager", "staff"].includes(params.p_intended_member_role)) {
          return { data: null, error: { message: "intended_member_role must be manager or staff" } };
        }
        let authorised = false;
        if (role === "owner" || role === "manager") {
          authorised = true;
        } else if (params.p_intended_member_role === "manager") {
          authorised = false;
        } else if (params.p_intended_responsibility_role === "WARD_COORDINATOR" && params.p_intended_level === "ward" && params.p_intended_geography_ref) {
          const parentLga = geographyWardLga(params.p_intended_geography_ref);
          authorised = parentLga != null && hasResponsibility(params.p_campaign_id, "lga", parentLga, uid);
        } else if (params.p_intended_responsibility_role === "POLLING_UNIT_AGENT" && params.p_intended_level === "polling_unit" && params.p_intended_geography_ref) {
          const parentWard = geographyPuWard(params.p_intended_geography_ref);
          authorised = parentWard != null && hasResponsibility(params.p_campaign_id, "ward", parentWard, uid);
        }
        if (!authorised) return { data: null, error: { message: "you are not authorised to invite this role/geography combination" } };

        const row = {
          id: `inv-${invitations.length + 1}`, campaign_id: params.p_campaign_id, token: `tok-${invitations.length + 1}-${Math.random().toString(36).slice(2)}`,
          invited_name: params.p_invited_name.trim(), invited_email: params.p_invited_email.trim(),
          intended_member_role: params.p_intended_member_role, intended_responsibility_role: params.p_intended_responsibility_role,
          intended_level: params.p_intended_level, intended_geography_ref: params.p_intended_geography_ref,
          status: "pending", invited_by: uid, created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + (params.p_expires_in_days ?? 14) * 86400000).toISOString(),
          accepted_at: null, accepted_by: null,
        };
        invitations.push(row);
        return { data: row, error: null };
      }

      if (name === "accept_campaign_invitation") {
        const uid = client.__uid;
        if (!uid) return { data: null, error: { message: "accept_campaign_invitation requires an authenticated session" } };
        const inv = invitations.find((i) => i.token === params.p_token);
        if (!inv) return { data: null, error: { message: "this invitation does not exist" } };
        if (inv.status === "accepted") {
          if (inv.accepted_by === uid) {
            return { data: [{ id: inv.id, campaign_id: inv.campaign_id, intended_member_role: inv.intended_member_role, intended_responsibility_role: inv.intended_responsibility_role, intended_level: inv.intended_level, intended_geography_ref: inv.intended_geography_ref, invited_name: inv.invited_name }], error: null };
          }
          return { data: null, error: { message: "this invitation has already been accepted" } };
        }
        if (inv.status === "revoked") return { data: null, error: { message: "this invitation has been revoked" } };
        if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
          inv.status = "expired";
          return { data: null, error: { message: "this invitation has expired" } };
        }
        const email = authUsersByUid.get(uid) ?? "";
        if (email.toLowerCase() !== inv.invited_email.toLowerCase()) {
          return { data: null, error: { message: "this invitation was sent to a different email address than your signed-in account" } };
        }
        if (!campaignMembers.some((m) => m.campaign_id === inv.campaign_id && m.person === uid)) {
          campaignMembers.push({ campaign_id: inv.campaign_id, person: uid, member_role: inv.intended_member_role, status: "active" });
        }
        inv.status = "accepted"; inv.accepted_at = new Date().toISOString(); inv.accepted_by = uid;
        return { data: [{ id: inv.id, campaign_id: inv.campaign_id, intended_member_role: inv.intended_member_role, intended_responsibility_role: inv.intended_responsibility_role, intended_level: inv.intended_level, intended_geography_ref: inv.intended_geography_ref, invited_name: inv.invited_name }], error: null };
      }

      if (name === "write_responsibility") return writeResponsibilityRpc(client.__uid, params);

      if (name === "revoke_campaign_invitation") {
        const uid = client.__uid;
        const inv = invitations.find((i) => i.id === params.p_invitation_id);
        if (!inv) return { data: null, error: { message: "this invitation does not exist" } };
        const role = currentMemberRole(inv.campaign_id, uid);
        if (!["owner", "manager"].includes(role)) return { data: null, error: { message: "you are not authorised to revoke invitations in this campaign" } };
        if (inv.status === "pending") inv.status = "revoked";
        return { data: null, error: null };
      }

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
            eventRows.push({ event_id: row.event_id, campaign_id: row.campaign_id, type: row.type, payload: row.payload });
            return { error: null };
          },
          select() {
            const builder = {
              _rows: eventRows,
              eq(key, value) { this._rows = this._rows.filter((r) => r[key] === value || r.campaign_id === value); return this; },
              order() { return this; },
              then(resolve) { resolve({ data: this._rows.map((r) => r.payload), error: null }); },
            };
            return builder;
          },
        };
      }
      if (table === "geography_polling_units") {
        return {
          select() {
            const builder = {
              eq(key, value) { this._id = value; return this; },
              async maybeSingle() {
                const pu = (geography.pollingUnits ?? []).find((p) => p.id === this._id);
                return { data: pu ? { id: pu.id, ward_id: pu.wardId, code: pu.code } : null, error: null };
              },
            };
            return builder;
          },
        };
      }
      return { select: () => ({ eq: () => ({ order: () => ({ then: (r) => r({ data: [], error: null }) }) }) }) };
    },
  };
  return client;
}

const CAMPAIGN_A = "camp-a", CAMPAIGN_B = "camp-b";
const OWNER = "owner-uid", STAFF_NO_ROLE = "staff-no-role-uid", LGA_COORD = "lga-coord-uid", INVITEE = "invitee-uid";
const OKPE = "lga-okpe", SAPELE = "lga-sapele";
const WARD_1 = "ward-1"; // in Okpe

const GEOGRAPHY = {
  lgas: [{ id: OKPE }, { id: SAPELE }],
  wards: [{ id: WARD_1, lgaId: OKPE }],
  pollingUnits: [{ id: "pu-1", wardId: WARD_1, code: "PU001" }],
};

function baseEnv() {
  return fakeEnv({
    campaignMembers: [
      { campaign_id: CAMPAIGN_A, person: OWNER, member_role: "owner", status: "active" },
      { campaign_id: CAMPAIGN_A, person: STAFF_NO_ROLE, member_role: "staff", status: "active" },
      { campaign_id: CAMPAIGN_A, person: LGA_COORD, member_role: "staff", status: "active" },
    ],
    events: [
      { type: ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED, eventId: "resp-okpe", campaign: CAMPAIGN_A,
        responsibility: "resp-okpe", person: `invite:${CAMPAIGN_A}:${LGA_COORD}`, level: "lga", geographyRef: OKPE,
        responsibilityRole: "LGA_COORDINATOR", status: "ASSIGNED" },
    ],
    geography: GEOGRAPHY,
  });
}

// ---------- 1-2. who may create ----------
{
  const client = baseEnv();
  client.__setUser(OWNER, "owner@example.com");
  const ownerInvite = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Amaka", invitedEmail: "amaka@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "LGA_COORDINATOR", intendedLevel: "lga", intendedGeographyRef: SAPELE });
  ok("1. owner can create an invitation for ANY role/geography", ownerInvite.invitation != null && ownerInvite.error === null);

  client.__setUser(STAFF_NO_ROLE, "staff@example.com");
  const staffInvite = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Bello", invitedEmail: "bello@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "WARD_COORDINATOR", intendedLevel: "ward", intendedGeographyRef: WARD_1 });
  ok("2. a staff member with NO responsibility cannot create any invitation", staffInvite.invitation === null && /not authorised/.test(staffInvite.error));

  client.__setUser(LGA_COORD, "lgacoord@example.com");
  const goodWardInvite = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Chidi", invitedEmail: "chidi@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "WARD_COORDINATOR", intendedLevel: "ward", intendedGeographyRef: WARD_1 });
  ok("14. LGA Coordinator for Okpe CAN invite a Ward Coordinator for a ward INSIDE Okpe", goodWardInvite.invitation != null);

  const badLgaInvite = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Dayo", invitedEmail: "dayo@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "LGA_COORDINATOR", intendedLevel: "lga", intendedGeographyRef: SAPELE });
  ok("15. LGA Coordinator CANNOT invite another LGA Coordinator (privilege escalation refused)", badLgaInvite.invitation === null);

  const directorInvite = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Eze", invitedEmail: "eze@example.com", intendedMemberRole: "manager" });
  ok("16. LGA Coordinator CANNOT invite a Campaign Director (only owner/manager may)", directorInvite.invitation === null);
}

// ---------- 3-5. invitation content ----------
{
  const client = baseEnv();
  client.__setUser(OWNER, "owner@example.com");
  const { invitation } = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Amaka", invitedEmail: "amaka@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "LGA_COORDINATOR", intendedLevel: "lga", intendedGeographyRef: SAPELE });
  ok("3. invitation belongs to the correct campaign", invitation.campaign_id === CAMPAIGN_A);
  ok("4. invitation carries the correct role", invitation.intended_responsibility_role === "LGA_COORDINATOR");
  ok("5. invitation carries the correct geography", invitation.intended_level === "lga" && invitation.intended_geography_ref === SAPELE);
}

// ---------- 6-11. acceptance ----------
{
  const client = baseEnv();
  client.__setUser(OWNER, "owner@example.com");
  const { invitation } = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Amaka Obi", invitedEmail: "amaka@example.com", intendedMemberRole: "staff", intendedResponsibilityRole: "LGA_COORDINATOR", intendedLevel: "lga", intendedGeographyRef: SAPELE });

  client.__setUser(null, null);
  const unauth = await acceptInvitation({ client, token: invitation.token });
  ok("6. an unauthenticated caller cannot accept", unauth.accepted === false && /authenticated session/.test(unauth.error));

  client.__setUser(INVITEE, "wrong-person@example.com");
  const wrongEmail = await acceptInvitation({ client, token: invitation.token });
  ok("7. the wrong authenticated identity (email mismatch) cannot accept", wrongEmail.accepted === false && /different email/.test(wrongEmail.error));

  client.__setUser(INVITEE, "amaka@example.com");
  const good = await acceptInvitation({ client, token: invitation.token });
  ok("8. the correct authenticated identity CAN accept", good.accepted === true && good.error === null);
  ok("9. acceptance creates the correct campaign_members row", client.__memberRows.some((m) => m.campaign_id === CAMPAIGN_A && m.person === INVITEE && m.member_role === "staff"));

  const view = projectElection(client.__events.map((r) => r.payload).filter((e) => e.campaign === CAMPAIGN_A), CAMPAIGN_A);
  const myResp = Object.values(view.responsibilities).find((r) => r.person === `invite:${CAMPAIGN_A}:${INVITEE}`);
  ok("10. acceptance creates the correct responsibility (LGA_COORDINATOR for Sapele)", myResp?.level === "lga" && myResp?.geographyRef === SAPELE && myResp?.responsibilityRole === "LGA_COORDINATOR");
  ok("10b. acceptance also creates a resolvable roster entry for the SAME real identity", view.people[`invite:${CAMPAIGN_A}:${INVITEE}`]?.name === "Amaka Obi");

  const replay = await acceptInvitation({ client, token: invitation.token });
  ok("11. duplicate acceptance by the SAME person is idempotent, not an error", replay.accepted === true && replay.error === null);
  ok("11b. no duplicate campaign_members row was created", client.__memberRows.filter((m) => m.campaign_id === CAMPAIGN_A && m.person === INVITEE).length === 1);
}

// ---------- 12-13. expiry / revocation ----------
{
  const client = baseEnv();
  client.__setUser(OWNER, "owner@example.com");
  const { invitation: expiring } = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Fola", invitedEmail: "fola@example.com", intendedMemberRole: "staff", expiresInDays: -1 });
  client.__setUser(INVITEE, "fola@example.com");
  const expiredResult = await acceptInvitation({ client, token: expiring.token });
  ok("12. an expired invitation is rejected", expiredResult.accepted === false && /expired/.test(expiredResult.error));

  client.__setUser(OWNER, "owner@example.com");
  const { invitation: toRevoke } = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Gina", invitedEmail: "gina@example.com", intendedMemberRole: "staff" });
  await revokeInvitation({ client, invitationId: toRevoke.id });
  client.__setUser(INVITEE, "gina@example.com");
  const revokedResult = await acceptInvitation({ client, token: toRevoke.token });
  ok("13. a revoked invitation is rejected", revokedResult.accepted === false && /revoked/.test(revokedResult.error));
}

// ---------- second acceptor cannot reuse an already-accepted token ----------
{
  const client = baseEnv();
  client.__setUser(OWNER, "owner@example.com");
  const { invitation } = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Hassan", invitedEmail: "hassan@example.com", intendedMemberRole: "staff" });
  client.__setUser(INVITEE, "hassan@example.com");
  await acceptInvitation({ client, token: invitation.token });
  client.__setUser("second-account-uid", "hassan@example.com"); // even with a matching email on a DIFFERENT account
  const reuse = await acceptInvitation({ client, token: invitation.token });
  ok("6b. an invitation cannot be reused by a second account once accepted", reuse.accepted === false && /already been accepted/.test(reuse.error));
}

// ---------- tenant isolation between two campaigns' invitations ----------
{
  const client = fakeEnv({
    campaignMembers: [
      { campaign_id: CAMPAIGN_A, person: OWNER, member_role: "owner", status: "active" },
      { campaign_id: CAMPAIGN_B, person: OWNER, member_role: "owner", status: "active" },
    ],
  });
  client.__setUser(OWNER, "owner@example.com");
  const invA = await createInvitation({ client, campaignId: CAMPAIGN_A, invitedName: "Ike", invitedEmail: "ike@example.com", intendedMemberRole: "staff" });
  const invB = await createInvitation({ client, campaignId: CAMPAIGN_B, invitedName: "Joy", invitedEmail: "joy@example.com", intendedMemberRole: "staff" });
  ok("19. invitations stay scoped to their own campaign", invA.invitation.campaign_id === CAMPAIGN_A && invB.invitation.campaign_id === CAMPAIGN_B);
  ok("19b. campaign A's own invitation list never includes campaign B's", client.__invitations.filter((i) => i.campaign_id === CAMPAIGN_A).length === 1);
}

// ---------- no service-role, no fabricated geography (static checks) ----------
{
  ok("20. write.js never imports or constructs a service-role credential",
     !/service_role|SUPABASE_SERVICE_ROLE/i.test(await (await import("node:fs/promises")).readFile(new URL("../src/domains/election/invitations/write.js", import.meta.url), "utf8")));
  ok("21. accept sequencing resolves geography via REAL reads (getConstituencyTerritory), never a hardcoded/fabricated tree",
     /getConstituencyTerritory/.test(await (await import("node:fs/promises")).readFile(new URL("../src/domains/election/invitations/write.js", import.meta.url), "utf8")));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
