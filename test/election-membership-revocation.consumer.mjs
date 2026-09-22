// ============================================================
// ELECTIONCANON — PILOT SAFETY PASS: MEMBERSHIP REVOCATION  (MOCK evidence
// for the RPC's authorization matrix + real-code evidence for post-
// revocation cutoff) + SQL/SOURCE-STRUCTURE evidence for the migration
// itself.
//
// SECTION 1 builds a fake `client.rpc("revoke_campaign_member", ...)`
// that mirrors revoke_campaign_member()'s own plpgsql instruction-for-
// instruction (same style as test/election-invitations.consumer.mjs) —
// this proves the AUTHORIZATION MATRIX, not merely that
// membership/write.js's thin wrapper passes arguments through.
//
// SECTION 2 calls the REAL resolveElectionScope()/readElectionCanon()/
// prepareElectionWrite()/approveElectionWrite() against a fake
// `campaign_members` table whose status this suite flips to 'revoked'
// directly (simulating what the RPC would have just done) — this proves
// the REAL, UNMODIFIED adapter code already stops a revoked member at
// PREPARE/APPROVE/read, exactly as electionWebAdapter.js's own comments
// claim, with no code change needed there for this specific guarantee.
//
// SECTION 3 is SQL/SOURCE-STRUCTURE evidence only (grep against
// comment-stripped migration text) — it proves the migration FILE
// contains the properties the task requires (SECURITY DEFINER, explicit
// EXECUTE grants, no client UPDATE/DELETE policy added to
// campaign_members). It does NOT prove live Postgres behavior — this
// repository's test harness has no live Supabase integration target;
// see this file's own final section for the explicit statement of that
// limitation.
//
// Run: node test/election-membership-revocation.consumer.mjs
// ============================================================

import { revokeCampaignMember } from "../src/domains/election/membership/write.js";
import { resolveElectionScope, ELECTION_SCOPE, isElectionScoped } from "../src/os/electionScope.js";
import { readElectionCanon, prepareElectionWrite, approveElectionWrite, WRITE_CHANNEL } from "../src/os/electionWebAdapter.js";
import { readFileSync } from "node:fs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const OWNER = "11111111-1111-1111-1111-111111111111";
const MANAGER = "22222222-2222-2222-2222-222222222222";
const STAFF_A = "33333333-3333-3333-3333-333333333333";
const STAFF_B = "44444444-4444-4444-4444-444444444444";
const OUTSIDER = "55555555-5555-5555-5555-555555555555"; // never a member of the campaign
const CAMPAIGN = "campaign-1";

console.log("\nELECTIONCANON — Pilot Safety Pass: Membership Revocation\n");

// ============================================================
console.log("SECTION 1 — RPC authorization matrix (MOCK evidence)");
// ============================================================

/** Mirrors revoke_campaign_member()'s own plpgsql, instruction for instruction. */
function freshMembers() {
  return [
    { campaign_id: CAMPAIGN, person: OWNER, member_role: "owner", status: "active", revoked_at: null, revoked_by: null },
    { campaign_id: CAMPAIGN, person: MANAGER, member_role: "manager", status: "active", revoked_at: null, revoked_by: null },
    { campaign_id: CAMPAIGN, person: STAFF_A, member_role: "staff", status: "active", revoked_at: null, revoked_by: null },
    { campaign_id: CAMPAIGN, person: STAFF_B, member_role: "staff", status: "active", revoked_at: null, revoked_by: null },
  ];
}

function fakeClient(members, asUser) {
  return {
    auth: { async getUser() { return { data: { user: asUser ? { id: asUser } : null }, error: null }; } },
    async rpc(name, params) {
      if (name !== "revoke_campaign_member") throw new Error(`unexpected rpc ${name}`);
      const uid = asUser;
      if (!uid) return { data: null, error: { message: "revoke_campaign_member requires an authenticated session" } };
      if (params.p_target_person === uid) {
        return { data: null, error: { message: "you cannot revoke your own membership" } };
      }
      const caller = members.find((m) => m.campaign_id === params.p_campaign_id && m.person === uid && m.status === "active");
      if (!caller) return { data: null, error: { message: "you are not an active member of this campaign" } };
      if (caller.member_role === "staff") return { data: null, error: { message: "staff may not revoke campaign members" } };

      const target = members.find((m) => m.campaign_id === params.p_campaign_id && m.person === params.p_target_person);
      if (!target) return { data: null, error: { message: "this person is not a member of this campaign" } };
      if (target.member_role === "owner") return { data: null, error: { message: "owner memberships cannot be revoked through this function" } };
      if (caller.member_role === "manager" && target.member_role !== "staff") {
        return { data: null, error: { message: "managers may only revoke staff members" } };
      }
      if (target.status === "revoked") return { data: [target], error: null };

      target.status = "revoked";
      target.revoked_at = new Date().toISOString();
      target.revoked_by = uid;
      return { data: [target], error: null };
    },
  };
}

{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, OWNER), campaignId: CAMPAIGN, targetPersonId: STAFF_A });
  ok("1. owner can revoke staff", r.revoked === true && members.find((m) => m.person === STAFF_A).status === "revoked");
}
{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, OWNER), campaignId: CAMPAIGN, targetPersonId: MANAGER });
  ok("2. owner can revoke manager", r.revoked === true && members.find((m) => m.person === MANAGER).status === "revoked");
}
{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, MANAGER), campaignId: CAMPAIGN, targetPersonId: STAFF_A });
  ok("3. manager can revoke staff", r.revoked === true && members.find((m) => m.person === STAFF_A).status === "revoked");
}
{
  // give this campaign a second manager so "manager cannot revoke manager" has a real target
  const members = freshMembers();
  members.push({ campaign_id: CAMPAIGN, person: OUTSIDER, member_role: "manager", status: "active", revoked_at: null, revoked_by: null });
  const r = await revokeCampaignMember({ client: fakeClient(members, MANAGER), campaignId: CAMPAIGN, targetPersonId: OUTSIDER });
  ok("4. manager cannot revoke manager", r.revoked === false && /only revoke staff/.test(r.error) &&
     members.find((m) => m.person === OUTSIDER).status === "active");
}
{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, MANAGER), campaignId: CAMPAIGN, targetPersonId: OWNER });
  ok("5. manager cannot revoke owner", r.revoked === false && members.find((m) => m.person === OWNER).status === "active");
}
{
  const members = freshMembers();
  const r1 = await revokeCampaignMember({ client: fakeClient(members, STAFF_A), campaignId: CAMPAIGN, targetPersonId: STAFF_B });
  const r2 = await revokeCampaignMember({ client: fakeClient(members, STAFF_A), campaignId: CAMPAIGN, targetPersonId: MANAGER });
  ok("6. staff cannot revoke anyone", r1.revoked === false && r2.revoked === false &&
     members.every((m) => m.status === "active"));
}
{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, OWNER), campaignId: CAMPAIGN, targetPersonId: OWNER });
  ok("7. self-revocation fails (even for an owner)", r.revoked === false && /cannot revoke your own membership/.test(r.error));
}
{
  const members = freshMembers();
  const r = await revokeCampaignMember({ client: fakeClient(members, OWNER), campaignId: CAMPAIGN, targetPersonId: OUTSIDER });
  ok("unknown/non-member target is rejected", r.revoked === false && /not a member of this campaign/.test(r.error));
}
{
  const members = freshMembers();
  members.find((m) => m.person === STAFF_A).status = "revoked";
  const r = await revokeCampaignMember({ client: fakeClient(members, OWNER), campaignId: CAMPAIGN, targetPersonId: STAFF_A });
  ok("already-revoked target is idempotent/safe (no error, no throw)", r.revoked === true && r.error === null);
}

// ============================================================
console.log("\nSECTION 2 — post-revocation cutoff, REAL adapter code (MOCK evidence)");
// ============================================================

function fakeMembershipOnlyClient(members, asUser) {
  return {
    auth: { async getUser() { return { data: { user: asUser ? { id: asUser } : null }, error: null }; } },
    from(table) {
      if (table !== "campaign_members") throw new Error(`unexpected table ${table} — this fake only backs the membership-cutoff path`);
      return {
        select() {
          return {
            eq(col1, val1) {
              return {
                eq(col2, val2) {
                  return (async () => ({
                    data: members.filter((m) => m[col1] === val1 && m[col2] === val2),
                    error: null,
                  }))();
                },
              };
            },
          };
        },
      };
    },
  };
}

{
  const members = freshMembers();
  members.find((m) => m.person === STAFF_A).status = "revoked"; // simulates what section 1's RPC just proved it does

  const scope = await resolveElectionScope({ userId: STAFF_A, client: fakeMembershipOnlyClient(members, STAFF_A), requested: CAMPAIGN });
  // A `requested` campaign id that no longer matches an ACTIVE membership row
  // resolves REFUSED, not NONE — resolveElectionScope's own documented
  // behavior for "an explicit request is never granted on its own word"
  // (electionScope.js). What matters for this pilot-safety guarantee is
  // isElectionScoped() being false either way — never SCOPED.
  ok("8. revoked membership no longer resolves as active (REFUSED, never SCOPED)",
     scope.outcome === ELECTION_SCOPE.REFUSED && !isElectionScoped(scope));

  const canon = await readElectionCanon({ client: fakeMembershipOnlyClient(members, STAFF_A), requestedCampaign: CAMPAIGN });
  ok("9. revoked member cannot read campaign Canon (view stays null)", canon.view === null);

  const prep = await prepareElectionWrite({ client: fakeMembershipOnlyClient(members, STAFF_A), requestedCampaign: CAMPAIGN, message: "Report ward Alpha as complete" });
  ok("10a. revoked member's PREPARE is refused (UNAUTHORIZED)", prep.status === WRITE_CHANNEL.UNAUTHORIZED);

  const approve = await approveElectionWrite({ client: fakeMembershipOnlyClient(members, STAFF_A), requestedCampaign: CAMPAIGN, draft: { type: "campaign.ward.status_reported" }, confirmationId: "x" });
  ok("10b. revoked member's APPROVE is refused (UNAUTHORIZED), never reaches execute", approve.success === false && approve.error === WRITE_CHANNEL.UNAUTHORIZED);
}

{
  // control: the SAME staff member, still active, is NOT blocked by scope resolution —
  // proves test 8/9/10 above are about revocation specifically, not a broken fake.
  const members = freshMembers();
  const scope = await resolveElectionScope({ userId: STAFF_A, client: fakeMembershipOnlyClient(members, STAFF_A), requested: CAMPAIGN });
  ok("control: a still-ACTIVE staff member resolves scope normally", scope.outcome === ELECTION_SCOPE.SCOPED && scope.role === "staff");
}

// ============================================================
console.log("\nSECTION 3 — migration source-structure evidence (NOT live-database verification)");
// ============================================================

const migration = src("../supabase/migrations/20260923000000_election_membership_revocation_and_write_rbac.sql");

ok("revoke_campaign_member() is SECURITY DEFINER", /create or replace function public\.revoke_campaign_member[\s\S]*?security definer/i.test(migration));
ok("revoke_campaign_member() EXECUTE is explicitly revoked from public, then granted to authenticated only",
   /revoke all on function public\.revoke_campaign_member\(uuid, uuid\) from public/i.test(migration) &&
   /grant execute on function public\.revoke_campaign_member\(uuid, uuid\) to authenticated/i.test(migration));
ok("no client UPDATE or DELETE policy is created on campaign_members anywhere in this migration",
   !/create policy[\s\S]*?on campaign_members[\s\S]*?for (update|delete)/i.test(migration));
ok("the target row is locked transactionally (SELECT ... FOR UPDATE) before any status transition",
   /for update;/i.test(migration));
ok("revoked_at and revoked_by columns are added idempotently (ADD COLUMN IF NOT EXISTS)",
   /add column if not exists revoked_at/i.test(migration) && /add column if not exists revoked_by/i.test(migration));
ok("revoked_by is recorded from auth.uid() captured server-side (v_uid), never a client-supplied column",
   /revoked_by\s*=\s*v_uid/i.test(migration));

console.log("\nLIVE-DATABASE LIMITATION (explicit, per this suite's own honesty discipline): " +
  "this repository's test harness has no live Supabase/Postgres integration target — every assertion above is either " +
  "MOCK evidence (a fake client mirroring the SQL instruction-for-instruction) or SQL SOURCE-STRUCTURE evidence " +
  "(comment-stripped text of the migration file itself). Neither proves the migration, once applied to a real " +
  "database, behaves identically to its mock — that would require applying this migration to a live Supabase " +
  "project and re-running an equivalent check against real RLS, which has not been done as part of this change.");

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
