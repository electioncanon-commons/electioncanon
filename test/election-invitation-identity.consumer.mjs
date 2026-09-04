// ============================================================
// ELECTIONCANON 1.1.1 PHASE A — INVITATION-FIRST EXPERIENCE
//
// Proves the approved diagnosis actually landed in the code: campaigns.name
// was always the right field and was always wired in correctly; the real
// gap was the auth handoff losing that context. This file does NOT
// re-prove invitation security (token secrecy, email-match, expiry,
// revocation, one-time acceptance) — that is already covered by 60
// existing assertions across election-invitations.consumer.mjs (23) and
// election-organisation-invite-geography.consumer.mjs (37). Instead it
// proves: (a) the ONE new SQL column never touches any of that machinery,
// by grepping the new migration for the functions that machinery lives
// in, and (b) the presentation-layer facts this pass actually changed.
//
// Part A is FUNCTIONAL — getInvitationPreview() (plain JS, no JSX) is
// imported and run for real against a fake RPC client. Part B is
// structural/source-level, the same comment-stripped-source convention
// election-home-operating-console.consumer.mjs already established (this
// repo has no React-rendering harness — see election-web-surface.
// consumer.mjs's own header), used ONLY where no real execution is
// possible (JSX components, a SQL migration with no live Postgres here).
//
// Run: node test/election-invitation-identity.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { getInvitationPreview } from "../src/domains/election/invitations/read.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"), { css: false });
const raw = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nELECTIONCANON 1.1.1 PHASE A — Invitation-First Experience\n");

// ============================================================
// PART A — getInvitationPreview(): real pass-through behavior
// ============================================================
console.log("A. invitations/read.js — getInvitationPreview()");
{
  const fakeClient = (response) => ({ rpc: () => Promise.resolve(response) });

  const withInviter = await getInvitationPreview({
    client: fakeClient({ data: [{ campaign_id: "c1", campaign_name: "Rock Governor of Lagos Campaign", invited_by_name: "Ada Example", status: "pending" }], error: null }),
    token: "tok1",
  });
  ok("A1. invited_by_name is passed through unmodified when the RPC provides a real name",
     withInviter.invitation.invited_by_name === "Ada Example");
  ok("A2. campaign_name is passed through unmodified — the real canonical identity, not derived here",
     withInviter.invitation.campaign_name === "Rock Governor of Lagos Campaign");

  const noInviterName = await getInvitationPreview({
    client: fakeClient({ data: [{ campaign_id: "c1", campaign_name: "X Campaign", invited_by_name: null, status: "pending" }], error: null }),
    token: "tok2",
  });
  ok("A3. invited_by_name is passed through as null when the inviter set no display name — never substituted with an email or any other value",
     noInviterName.invitation.invited_by_name === null);

  const objectShaped = await getInvitationPreview({
    client: fakeClient({ data: { campaign_id: "c1", campaign_name: "Y Campaign" }, error: null }),
    token: "tok3",
  });
  ok("A4. a non-array (single-object) RPC response still resolves correctly (unchanged pre-existing behavior)",
     objectShaped.invitation.campaign_name === "Y Campaign");

  const rpcError = await getInvitationPreview({ client: fakeClient({ data: null, error: { message: "boom" } }), token: "tok4" });
  ok("A5. an RPC-reported error surfaces as {invitation: null, error} — never thrown",
     rpcError.invitation === null && rpcError.error === "boom");

  const throwing = await getInvitationPreview({ client: { rpc: () => { throw new Error("network down"); } }, token: "tok5" });
  ok("A6. a thrown/rejected client is caught into a safe fallback — a signed-out visitor's first network call never leaves the page hanging",
     throwing.invitation === null && typeof throwing.error === "string");

  // A7: getInvitationPreview()'s OWN function body (not the whole file —
  // listInvitations() legitimately selects invited_email for the
  // authenticated campaign roster, a different security context) never
  // references an email field at all — it has no fallback path to invent
  // or forward one.
  const readSrc = code("../src/domains/election/invitations/read.js");
  const previewFnBody = readSrc.slice(readSrc.indexOf("export async function getInvitationPreview"));
  ok("A7. getInvitationPreview()'s own body never references invited_email/email in any form",
     !/invited_email|\.email\b/i.test(previewFnBody));
}

// ============================================================
// PART B — structural: the 15 approved requirements
// ============================================================
const migration = raw("../supabase/migrations/20260904000000_election_invitation_preview_inviter_context.sql");
const acceptInvite = code("../src/pages/AcceptInvite.jsx");
const access = code("../src/pages/Access.jsx");
const orgSection = code("../src/pages/election/OrganisationSection.jsx");
const forgeIdentity = code("../src/os/ForgeIdentity.jsx");

console.log("\nB1-3. Campaign identity: campaigns.name, never owner email");
{
  ok("1. get_invitation_preview() resolves campaign_name from the real campaigns.name column",
     /select\s+c\.name\s+into\s+v_campaign_name\s+from\s+public\.campaigns\s+c/i.test(migration));
  ok("2. AcceptInvite.jsx renders campaign_name as the dominant <h1> identity",
     /<h1[^>]*>[\s\S]{0,80}\{invitation\.campaign_name\}/.test(acceptInvite));
  ok("3a. v_campaign_name is assigned from exactly one source in the whole migration (campaigns.name) — never a second, email-shaped fallback",
     (migration.match(/into\s+v_campaign_name\b/gi) ?? []).length === 1);
  ok("3b. AcceptInvite.jsx never references an invited_email/email field anywhere near campaign display",
     !/invitation\.invited_email/.test(acceptInvite) && !/invitation\.email/.test(acceptInvite));
}

console.log("\nB4. Inviter identity: real display name, never an email fallback, only when present");
{
  ok("1. get_invitation_preview() adds invited_by_name to its RETURNS TABLE",
     /returns table[\s\S]{0,400}invited_by_name text/i.test(migration));
  ok("2. invited_by_name is resolved ONLY from profiles.display_name, never coalesced with an email column",
     /select\s+nullif\(btrim\(p\.display_name\),\s*''\)\s+into\s+v_inviter_name/i.test(migration) &&
     !/v_inviter_name[\s\S]{0,80}email/i.test(migration));
  ok("3. AcceptInvite.jsx renders 'Invited by' only when invitation.invited_by_name is truthy (conditional, not unconditional)",
     /\{invitation\.invited_by_name\s*&&/.test(acceptInvite));
}

console.log("\nB5-6. Responsibility and geography are rendered");
{
  ok("1. AcceptInvite.jsx labels and renders the responsibility",
     /Your responsibility/.test(acceptInvite) && /\{roleLabel\}/.test(acceptInvite));
  ok("2. AcceptInvite.jsx labels and renders the area/geography",
     /Your area/.test(acceptInvite) && /invitation\.geography_name/.test(acceptInvite));
  ok("3. Access.jsx's invitation-context panel also shows responsibility",
     /Responsibility/.test(access) && /invitationRoleLabel/.test(access));
  ok("4. Access.jsx's invitation-context panel also shows area/geography when known",
     /invitationPreview\.geography_name/.test(access));
}

console.log("\nB7. Invitation context survives /invite -> /access");
{
  ok("1. Access.jsx reads the SAME sessionStorage key AcceptInvite.jsx writes",
     /sessionStorage\.getItem\(["']electioncanon_pending_invite_token["']\)/.test(access) &&
     /sessionStorage\.setItem\(["']electioncanon_pending_invite_token["']/.test(acceptInvite));
  ok("2. Access.jsx never clears that key — Election.jsx remains the sole owner of consuming/clearing it after auth",
     !/sessionStorage\.removeItem\(["']electioncanon_pending_invite_token["']\)/.test(access));
  ok("3. Access.jsx fetches the SAME getInvitationPreview() AcceptInvite.jsx uses — no second preview computation",
     /getInvitationPreview\(/.test(access));
}

console.log("\nB8. Confirmation state contains campaign identity");
{
  ok("1. the confirmation-email screen references the campaign name when a pending invitation exists",
     /invitationPreview\?\.campaign_name/.test(access) && /continue joining/i.test(access));
  ok("2. the confirmation screen is never shown unconditionally — gated on register()'s own needsEmailConfirmation signal",
     /res\.needsEmailConfirmation/.test(access));
  ok("3. needsEmailConfirmation is derived from signUp()'s real returned session, never hardcoded",
     /needsEmailConfirmation:\s*!e\s*&&\s*!data\?\.session/.test(forgeIdentity));
}

console.log("\nB9. Full invited email is never exposed pre-auth");
{
  ok("1. get_invitation_preview()'s RETURNS TABLE never includes invited_email",
     !/returns table[\s\S]{0,500}invited_email/i.test(migration));
  ok("2. get_invitation_preview()'s final SELECT list never includes v_inv.invited_email",
     !/return query select[\s\S]{0,400}invited_email/i.test(migration));
  ok("3. AcceptInvite.jsx never renders any invited_email value",
     !/invitation\.invited_email/.test(acceptInvite));
  ok("4. Access.jsx's confirmation screen only ever displays the visitor's own typed email through maskEmail(), never the raw value as bare visible JSX text (a `${confirmedEmail}` inside the mailto: href is a URL, not rendered page text, and is intentionally excluded from this check)",
     /\{maskEmail\(confirmedEmail\)\}/.test(access) && !/(?<!\$)\{confirmedEmail\}/.test(access));
}

console.log("\nB10-14. Existing invitation security machinery is untouched");
{
  ok("10. the new migration re-establishes the exact same grant shape (revoke public, grant authenticated + anon)",
     /revoke all on function public\.get_invitation_preview\(text\) from public/.test(migration) &&
     /grant execute on function public\.get_invitation_preview\(text\) to authenticated/.test(migration) &&
     /grant execute on function public\.get_invitation_preview\(text\) to anon/.test(migration));
  ok("11-13. the new migration file never defines/replaces accept_campaign_invitation — expiry/wrong-email/one-time-use logic lives there, untouched",
     !/create (or replace )?function public\.accept_campaign_invitation/i.test(migration));
  ok("14a. the new migration file never defines/replaces create_campaign_invitation — invitation authorization is untouched",
     !/create (or replace )?function public\.create_campaign_invitation/i.test(migration));
  ok("14b. the new migration file never defines/replaces revoke_campaign_invitation",
     !/create (or replace )?function public\.revoke_campaign_invitation/i.test(migration));
  ok("14c. the new migration file touches exactly one function (get_invitation_preview) — grepped occurrence count of 'create or replace function' is 1",
     (migration.match(/create or replace function/gi) ?? []).length === 1);
  ok("14d. no RLS policy statement appears in the new migration — this is a function-output change, never a table access-control change",
     !/create policy|alter table[\s\S]{0,40}row level security/i.test(migration));
}

console.log("\nB15. InviteWizard review step: fixed mislabel");
{
  ok("1. the review step now labels the constituency value 'Constituency:', not 'Campaign:'",
     /Constituency:\s*<strong>\{tree\?\.constituency\?\.name/.test(orgSection));
  ok("2. the old, incorrect 'Campaign:' label immediately before this exact value is gone",
     !/Campaign:\s*<strong>\{tree\?\.constituency\?\.name/.test(orgSection));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
