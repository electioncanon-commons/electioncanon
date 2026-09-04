// ============================================================
// ELECTIONCANON — FIRST-USER COMPLETION PASS  (structural + contract)
//
// Same discipline as election-prelaunch-ux.consumer.mjs and
// election-voice.consumer.mjs: pure contract functions get real
// input/output assertions; everything else is a structural/source-text
// check against comment-stripped code (test/lib/source.mjs), so an
// explanatory comment mentioning old/removed text never counts as
// satisfying or leaking anything.
//
// Run: node test/election-first-user-completion.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { stripComments } from "./lib/source.mjs";
import {
  validateSendRequest, buildInvitationEmail, buildResendRequest, interpretResendResponse,
  formatInvitationArea, parseCampaignTitle as parseCampaignTitleEmail,
} from "../supabase/functions/election-invitation-email/contract.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));
const text = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nELECTIONCANON — First-user completion pass\n");

// ============================================================
console.log("A — INVITATION EMAIL CONTRACT: validateSendRequest");
// ============================================================
{
  ok("A1. a real invitation_id validates", validateSendRequest({ invitation_id: "abc-123" }).valid === true);
  ok("A2. missing invitation_id is rejected", validateSendRequest({}).valid === false);
  ok("A3. an empty string is rejected, not silently accepted", validateSendRequest({ invitation_id: "   " }).valid === false);
  ok("A4. a non-string invitation_id is rejected", validateSendRequest({ invitation_id: 42 }).valid === false);
  ok("A5. null body never throws", validateSendRequest(null).valid === false);
}

// ============================================================
console.log("\nB — INVITATION EMAIL CONTRACT: buildInvitationEmail  (redesigned, human-first)");
// ============================================================
{
  const invitation = {
    invited_name: "Amaka Obi", invited_email: "amaka@example.com", token: "tok123abc",
    intended_responsibility_role: "WARD_COORDINATOR", intended_level: "ward", expires_at: "2026-12-01T00:00:00.000Z",
  };
  const built = buildInvitationEmail({
    invitation, campaignName: "Obi for Ward 4",
    geographyName: "Orile Agege", geographyStateName: "Lagos", geographyLgaName: "Agege", geographyWardName: null,
    invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
  });

  // ---- item 1: subject names inviter + campaign, graceful fallback ----
  ok("B1. subject names both the inviter and the campaign", built.subject === "Chidi Okoro invited you to Obi for Ward 4 on ElectionCanon");
  ok("B1b. an unresolvable inviter still produces an honest, non-broken subject (no undefined/null)",
    (() => {
      const s = buildInvitationEmail({ invitation, campaignName: "Obi for Ward 4", geographyName: "Orile Agege", invitedByName: null, origin: "https://electioncanon.org" }).subject;
      return s === "your campaign team invited you to Obi for Ward 4 on ElectionCanon" && !/undefined|null/i.test(s);
    })());
  ok("B1c. the subject never contains the raw invitation token", !built.subject.includes(invitation.token));

  ok("B2. the link is built from origin + exact token, matching the UI's own /invite/:token fallback link",
    built.html.includes("https://electioncanon.org/invite/tok123abc"));
  ok("B3. the resolved role label is rendered, not the raw enum",
    built.html.includes("Ward Coordinator") && !built.html.includes("WARD_COORDINATOR"));
  ok("B4. the campaign name is rendered",
    built.html.includes("Obi for Ward 4"));

  // ---- items 4-6: geography state context (new migration's output) ----
  const lgaInvite = { ...invitation, intended_responsibility_role: "LGA_COORDINATOR", intended_level: "lga" };
  const lgaEmail = buildInvitationEmail({
    invitation: lgaInvite, campaignName: "Lagos Governor Campaign",
    geographyName: "Agege", geographyStateName: "Lagos", invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
  });
  ok("B5. LGA-level: 'Your area' includes the LGA name AND the state — 'Agege, Lagos State', the exact example from the bug report",
    lgaEmail.html.includes("Agege, Lagos State"));

  const wardEmail = built; // WARD_COORDINATOR fixture above
  ok("B5b. Ward-level: 'Your area' includes the ward, its parent LGA, AND the state — full concise hierarchy",
    wardEmail.html.includes("Orile Agege, Agege, Lagos State"));

  const puInvite = { ...invitation, intended_responsibility_role: "POLLING_UNIT_AGENT", intended_level: "polling_unit" };
  const puEmail = buildInvitationEmail({
    invitation: puInvite, campaignName: "Obi for Ward 4", geographyName: "001",
    geographyStateName: "Lagos", geographyLgaName: "Agege", geographyWardName: "Orile Agege",
    invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
  });
  ok("B5c. Polling-unit-level: 'Your area' includes the PU, its ward, its LGA, AND the state",
    puEmail.html.includes("001, Orile Agege, Agege, Lagos State"));

  ok("B5d. FCT is never rendered as 'Federal Capital Territory State' — the ' State' suffix is a display convention, not applied to every literal name",
    buildInvitationEmail({
      invitation: lgaInvite, campaignName: "X", geographyName: "Abuja Municipal", geographyStateName: "Federal Capital Territory",
      invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
    }).html.includes("Abuja Municipal, Federal Capital Territory")
    && !buildInvitationEmail({
      invitation: lgaInvite, campaignName: "X", geographyName: "Abuja Municipal", geographyStateName: "Federal Capital Territory",
      invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
    }).html.includes("Federal Capital Territory State"));

  ok("B5e. formatInvitationArea never fabricates a state suffix out of nothing — no geographyName at all -> null, no fact block to render",
    formatInvitationArea({ level: null, geographyName: null, geographyStateName: null, geographyLgaName: null, geographyWardName: null }) === null);

  ok("B6. the invited address is named in the trust/expiry line, exactly matching the new spec's required wording ('This invitation is for {email} and expires {date}.')",
    built.html.includes("This invitation is for amaka@example.com and expires"));
  ok("B7. no password appears anywhere in the email",
    !/password/i.test(built.html) && !/password/i.test(built.text));
  ok("B8. a user-typed field (the campaign name, rendered in the headline) is HTML-escaped, not injected raw",
    (() => {
      const xss = buildInvitationEmail({
        invitation, campaignName: '<img src=x onerror=alert(1)>', geographyName: "Orile Agege", origin: "https://electioncanon.org",
      });
      return !xss.html.includes("<img src=x") && xss.html.includes("&lt;img");
    })());
  ok("B9. the email is table-based HTML with only inline style attributes, no external stylesheet/script",
    /<table/i.test(built.html) && !/<script/i.test(built.html) && !/<link\s+rel=["']stylesheet/i.test(built.html)
    && !/googleapis\.com/i.test(built.html));
  ok("B10. a plain-text alternative body is also produced",
    typeof built.text === "string" && built.text.includes("https://electioncanon.org/invite/tok123abc"));
  ok("B11. a Director-level invitation (no responsibility role, no geography) reads as 'Campaign Director', never blank/undefined, with no 'Your area' block",
    (() => {
      const director = buildInvitationEmail({ invitation: { ...invitation, intended_responsibility_role: null, intended_level: null }, campaignName: "X", geographyName: null, invitedByName: "Chidi Okoro", origin: "https://electioncanon.org" });
      return director.html.includes("Campaign Director") && !director.html.includes("Your area");
    })());
  ok("B12. the inviter's real name is stated, so the recipient can see who invited them",
    built.html.includes("Chidi Okoro") && built.text.includes("Chidi Okoro"));
  ok("B13. an unresolvable inviter falls back to an honest generic label, never a blank/undefined string",
    (() => {
      const noInviter = buildInvitationEmail({ invitation, campaignName: "Obi for Ward 4", geographyName: "Orile Agege", invitedByName: null, origin: "https://electioncanon.org" });
      return noInviter.html.includes("your campaign team") && !/undefined|null/i.test(noInviter.html);
    })());

  // ---- redesign requirement: the invitation leads, the quote is secondary ----
  ok("B14. the H1 (the invitation itself) appears BEFORE the Archbishop Benson Idahosa quote, not after — the quote is a small closing motif now, never the opening element",
    built.html.indexOf("invited you to join") < built.html.indexOf("Archbishop Benson Idahosa"));
  ok("B14b. the quote is still present (kept, not deleted) — just repositioned",
    /Archbishop Benson Idahosa/.test(built.html) && /preparing to fail/.test(built.html));
  ok("B15. 'what happens next' explicitly says to sign in OR create an account, matching AcceptInvite.jsx's real two-button choice — never a single vague 'registration' claim",
    /Sign in, or create your ElectionCanon account/.test(built.html));
  ok("B16. the H1 reads as an invitation FROM the inviter, never the account-confirmation email's own heading (no cross-template confusion)",
    /invited you to join/.test(built.html) && !/Confirm your ElectionCanon account/.test(built.html));

  // ---- item 9: the CTA ----
  ok("B_cta1. exactly one primary call-to-action button, labelled 'Accept Invitation'", /Accept Invitation/.test(built.html));
  ok("B_cta2. the 'Accept Invitation' button's own href is the real invite link (not just present somewhere else on the page)",
    /href="https:\/\/electioncanon\.org\/invite\/tok123abc"[^>]*>\s*Accept Invitation\s*<\/a>/.test(built.html));

  // ---- item 10: "what happens next" steps, matching the real AcceptInvite.jsx flow exactly ----
  // (the "N." number and its copy sit in separate <td> cells of the same
  // step row, so the assertion must span tags — [\s\S]{0,80} rather than
  // a same-line-only [^<]* — while still requiring them to be genuinely
  // close together, not just present anywhere in the whole document.)
  ok("B_next1. step 1 — click the button", />1\.<\/td>[\s\S]{0,200}Click Accept Invitation\./.test(built.html));
  ok("B_next2. step 2 — sign in or create an account", />2\.<\/td>[\s\S]{0,200}Sign in, or create your ElectionCanon account\./.test(built.html));
  ok("B_next3. step 3 — review role and area", />3\.<\/td>[\s\S]{0,200}Review your role and area\./.test(built.html));
  ok("B_next4. step 4 — accept and join", />4\.<\/td>[\s\S]{0,200}Accept the invitation and join the campaign\./.test(built.html));
  ok("B_next5. the steps appear in the correct 1-2-3-4 order",
    built.html.indexOf("Click Accept Invitation.") < built.html.indexOf("Sign in, or create your ElectionCanon account.")
    && built.html.indexOf("Sign in, or create your ElectionCanon account.") < built.html.indexOf("Review your role and area.")
    && built.html.indexOf("Review your role and area.") < built.html.indexOf("Accept the invitation and join the campaign."));

  // ---- item 11/12: expiration + unexpected-invitation safety language ----
  ok("B_expiry. the expiration date is present, human-formatted", /expires 1 December 2026/.test(built.html));
  ok("B_expiry_none. an invitation with no expires_at omits the clause instead of rendering a fabricated/blank date",
    !buildInvitationEmail({ invitation: { ...invitation, expires_at: null }, campaignName: "X", geographyName: "Orile Agege", invitedByName: "Chidi Okoro", origin: "https://electioncanon.org" }).html.includes("expires"));
  ok("B_safety. the 'safely ignore' unexpected-invitation language is present",
    /weren't expecting this invitation.*safely ignore/s.test(built.html));

  // ---- item 7/8/PART 3: the raw token must never appear as visible text, only inside href ----
  {
    const htmlWithoutHrefs = built.html.replace(/href="[^"]*"/g, 'href="REDACTED"');
    ok("B_token1. the raw token does NOT appear anywhere in the HTML once every href attribute is redacted — i.e. it exists ONLY inside link targets, never as readable text",
      !htmlWithoutHrefs.includes(invitation.token));
    ok("B_token2. specifically, the old 'Or paste this link into your browser: <url>' visible-URL pattern is gone",
      !/paste this link into your browser/i.test(built.html));
    ok("B_token3. the token IS still present in the HTML overall (i.e. it's really in the hrefs, not removed outright — the link must still work)",
      built.html.includes(invitation.token));
    ok("B_token4. a secondary, clearly-labelled fallback link ('Open invitation') exists for accessibility, with its VISIBLE text never the raw URL",
      /Open invitation/.test(built.html) && !/Open invitation<\/a>\s*:\s*https?:\/\//i.test(built.html));
    ok("B_token5. the primary button's href carries the exact real token", new RegExp(`href="https://electioncanon\\.org/invite/${invitation.token}"`).test(built.html));
  }

  // ---- item 13: existing visual identity retained ----
  ok("B_identity1. the dark background is retained", built.html.includes("#0D0D0F"));
  ok("B_identity2. ivory text colour is retained", built.html.includes("#F5F1E9"));
  ok("B_identity3. teal accent is retained", /#0AB4A0|#0A7F73/.test(built.html));
  ok("B_identity4. amber accent (the CTA) is retained", built.html.includes("#F5A623"));
  ok("B_identity5. pink accent is retained", built.html.includes("#FF2E63"));
  ok("B_identity6. dark/light color-scheme meta tags are retained (dark-mode support)",
    /color-scheme.*dark light/.test(built.html) && /supported-color-schemes.*dark light/.test(built.html));
  ok("B_identity7. still table-based (role=\"presentation\") layout — Outlook-safe structure preserved",
    (built.html.match(/role="presentation"/g) ?? []).length >= 5);

  // ---- item 14: no secret anywhere in the composed email ----
  ok("B_secret. no RESEND_API_KEY / service-role-shaped string appears in the composed email",
    !/RESEND_API_KEY|service_role|SERVICE_ROLE/i.test(built.html) && !/RESEND_API_KEY|service_role|SERVICE_ROLE/i.test(built.text));

  // B17-B21 — campaign-name presentation. campaigns.name is stored as
  // "[ElectionType] Name" (unchanged, no migration); the email must render
  // this exactly the way the app's own display layer does: clean name in
  // the headline, election type shown separately. A live-production bug
  // (raw "[House of Representatives] Journey Test Campaign" in a sent
  // email) is the reason these assertions exist.
  const bracketed = buildInvitationEmail({
    invitation, campaignName: "[House of Representatives] Journey Test Campaign",
    geographyName: "Orile Agege", geographyStateName: "Lagos", geographyLgaName: "Agege",
    invitedByName: "Chidi Okoro", origin: "https://electioncanon.org",
  });
  ok("B17. a bracket-prefixed stored name never leaks into the email verbatim",
    !bracketed.html.includes("[House of Representatives] Journey Test Campaign")
    && !bracketed.text.includes("[House of Representatives] Journey Test Campaign"));
  ok("B18. the headline reads the clean campaign name only",
    bracketed.html.includes("invited you to join Journey Test Campaign"));
  ok("B19. the election/office is shown separately, labelled, not bracket-prefixed",
    /Election: House of Representatives/.test(bracketed.html) && /Election: House of Representatives/.test(bracketed.text));
  ok("B20. a campaign name with no bracket prefix passes through unchanged, with no 'Election:' line fabricated",
    (() => {
      const plain = buildInvitationEmail({ invitation, campaignName: "Journey Test Campaign", geographyName: "Orile Agege", invitedByName: "Chidi Okoro", origin: "https://electioncanon.org" });
      return plain.html.includes("invited you to join Journey Test Campaign") && !/Election:/.test(plain.html);
    })());
  ok("B21. parseCampaignTitle() in the email contract uses the exact same regex as the app's own parser (shared.jsx) — a textual parity guard against future drift",
    (() => {
      const shared = code("../src/pages/election/shared.jsx");
      return shared.includes("/^\\[([^\\]]+)\\]\\s*(.*)$/") && parseCampaignTitleEmail.toString().includes("/^\\[([^\\]]+)\\]\\s*(.*)$/");
    })());
}

// ============================================================
console.log("\nC — INVITATION EMAIL CONTRACT: buildResendRequest / interpretResendResponse");
// ============================================================
{
  const req = buildResendRequest({ from: "ElectionCanon <a@b.com>", to: "x@y.com", subject: "S", html: "<p>h</p>", text: "t" });
  ok("C1. `to` is wrapped as an array (Resend's own expected shape)", Array.isArray(req.to) && req.to[0] === "x@y.com");

  ok("C2. a 2xx response with a real provider id -> ok:true, id captured",
    interpretResendResponse(200, { id: "re_abc123" }).ok === true
    && interpretResendResponse(200, { id: "re_abc123" }).providerMessageId === "re_abc123");
  ok("C3. a 2xx response is STILL only 'accepted for delivery', never claimed as delivered — no separate delivered field is invented",
    !("delivered" in interpretResendResponse(200, { id: "re_abc123" })));
  ok("C4. a 4xx/5xx response -> ok:false with the provider's own message surfaced",
    interpretResendResponse(422, { message: "invalid from address" }).ok === false
    && interpretResendResponse(422, { message: "invalid from address" }).error === "invalid from address");
  ok("C5. a malformed/empty provider response never throws, still returns ok:false",
    interpretResendResponse(500, null).ok === false);
}

// ============================================================
console.log("\nD — NO PROVIDER SECRET REACHES THE BROWSER BUNDLE");
// ============================================================
{
  const clientWrite = code("../src/domains/election/invitations/write.js");
  const orgSection = code("../src/pages/election/OrganisationSection.jsx");
  const indexTs = text("../supabase/functions/election-invitation-email/index.ts");

  ok("D1. the client-side invitation write path never references a Resend key",
    !/RESEND_API_KEY/.test(clientWrite) && !/RESEND/.test(clientWrite));
  ok("D2. OrganisationSection.jsx never references a Resend key or SMTP secret",
    !/RESEND_API_KEY/.test(orgSection) && !/smtp/i.test(orgSection));
  ok("D3. the edge function reads RESEND_API_KEY only from Deno.env, never a hardcoded literal",
    /Deno\.env\.get\("RESEND_API_KEY"\)/.test(indexTs) && !/re_[A-Za-z0-9]{10,}/.test(indexTs));
  ok("D4. the edge function never imports/uses a service-role key — only the caller's forwarded Authorization header",
    !/service_role/i.test(indexTs) && !/SUPABASE_SERVICE_ROLE/.test(indexTs)
    && /Authorization: authHeader/.test(indexTs));
  ok("D5. the edge function never logs the invitation token",
    !/console\.log\([^)]*token/i.test(indexTs));
  ok("D6. the send-from address defaults to the real ElectionCanon domain, overridable via env, never hardcoded to a sandbox/placeholder inbox",
    /RESEND_FROM_EMAIL[\s\S]{0,40}ElectionCanon <no-reply@electioncanon\.org>/.test(indexTs));
  ok("D7. the inviter's identity is resolved from the CALLER's own forwarded session (auth.getUser()), never a lookup by an arbitrary client-supplied id",
    /supabase\.auth\.getUser\(\)/.test(indexTs) && !/\.eq\("id",\s*(?:body|invitation)\./.test(indexTs));
  // ELECTIONCANON 1.1.1 UX REFINEMENT PASS — this used to read a
  // public.profiles row scoped to `.eq("id", caller.id)` (the "own row
  // only" pattern this assertion originally checked for). That table does
  // not exist in the ElectionCanon Supabase project (confirmed by a
  // forensic audit this session — see the corrective invitation-preview
  // migration's own header for the same finding on get_invitation_
  // preview()), so the query always silently failed and inviter identity
  // always fell through to the caller's raw email. The fix is stronger
  // than "scope the query correctly": there is no longer any query at all
  // — supabase.auth.getUser()'s own already-fetched result already carries
  // user_metadata (the same jsonb signUp()'s own options.data populates),
  // so the entire class of risk a table read could pose (cross-user access,
  // RLS misconfiguration, a table that silently doesn't exist) is
  // structurally eliminated rather than merely scoped.
  ok("D8. inviter identity resolution issues NO query at all (no public.profiles read, no risk of a cross-user or table-existence failure) — it reads supabase.auth.getUser()'s own already-fetched user_metadata directly",
    /caller\?\.user_metadata\?\.display_name/.test(indexTs) &&
    !/\.from\(["']profiles["']\)/.test(indexTs) &&
    !/\.eq\("id",\s*caller\.id\)/.test(indexTs));
}

// ============================================================
console.log("\nE — INVITATION STATUS LANGUAGE IS HONEST (item 5)");
// ============================================================
{
  const orgSection = code("../src/pages/election/OrganisationSection.jsx");
  const clientWrite = code("../src/domains/election/invitations/write.js");

  ok("E1. the just-created panel claims only 'Invitation created', never an unconditional 'Invitation sent'",
    /Invitation created/.test(orgSection) && !/>Invitation sent</.test(orgSection));
  ok("E2. a successfully dispatched email is described as 'queued for delivery', not 'delivered'",
    /queued for delivery/.test(orgSection));
  ok("E3. an email failure is shown to the user, distinctly from success, never silently swallowed",
    /could not be sent/.test(orgSection));
  ok("E4. the 'Copy invitation link' fallback exists and actually copies the link (not just displays it)",
    /Copy invitation link/.test(orgSection) && /navigator\.clipboard/.test(orgSection));
  ok("E5. createInvitation() reports emailStatus/emailError separately from the row-creation error",
    /emailStatus/.test(clientWrite) && /emailError/.test(clientWrite));
  ok("E6. a real dispatch failure never rolls back / discards the created invitation row",
    /return \{ invitation: data, emailStatus, emailError, error: null \}/.test(clientWrite));
}

// ============================================================
console.log("\nF — CAMPAIGN ACTION AUTHORIZATION NOTICE (item 2's direct target)");
// ============================================================
{
  const mobilization = code("../src/domains/election/mobilization/write.js");
  const electionDay = code("../src/domains/election/electionDay/write.js");
  const studio = code("../src/domains/election/studio/write.js");
  const geography = code("../src/domains/election/geography/write.js");

  for (const [name, src] of [["mobilization", mobilization], ["electionDay", electionDay], ["studio", studio], ["geography", geography]]) {
    ok(`F. ${name}/write.js's pending-draft notice no longer claims the actor is NOT AUTHORISED before any real check has run`,
      !/NOT AUTHORISED/.test(src));
    ok(`F. ${name}/write.js has no rendered "ForgeOS" user-facing string`,
      !/"[^"]*ForgeOS[^"]*"/.test(src) && !/\`[^\`]*ForgeOS[^\`]*\`/.test(src));
  }
}

// ============================================================
console.log("\nG — CANDIDATE REGISTRATION IS ACTIONABLE, THROUGH THE EXISTING WRITE PIPELINE (item 1)");
// ============================================================
{
  const election = code("../src/pages/Election.jsx");

  ok("G1. a real CandidateRegistrationPanel component exists",
    /function CandidateRegistrationPanel\(/.test(election));
  ok("G2. it is mounted from ReadinessSection when CANDIDATE_REGISTERED is not yet COMPLETE",
    /<CandidateRegistrationPanel ctx=\{ctx\} campaignId=\{campaignId\} refresh=\{refresh\} \/>/.test(election));
  ok("G3. it constructs the SAME command string matchCandidateRegister() already parses — no second write path invented",
    /Register \$\{cleanName\} as candidate for \$\{officeName\} in \$\{constituencyName\}, \$\{cleanParty\}\.`/.test(election));
  ok("G4. it routes through the existing prepareElectionWrite/approveElectionWrite pipeline, never a bespoke insert",
    /prepareElectionWrite\(\{ client: supabase, requestedCampaign: campaignId, message \}\)/.test(election));
  ok("G5. office/constituency are read from the campaign's own already-set territory, never re-asked or fabricated",
    /getConstituencyTerritory|listOffices/.test(election) && /ctx\.view\?\.territory/.test(election));
}

// ============================================================
console.log("\nH — INVITATION EMAIL REDESIGN: GEOGRAPHY-CONTEXT MIGRATION + UNCHANGED AUTHORIZATION");
// ============================================================
{
  const geoMigration = text("../supabase/migrations/20260902000000_election_invitation_geography_state_context.sql");
  const invitationsMigration = text("../supabase/migrations/20260831000000_election_campaign_invitations.sql");

  ok("H1. the new migration only replaces get_invitation_preview() — it creates/alters no table, seeds no row",
    /drop function if exists public\.get_invitation_preview/.test(geoMigration)
    && !/^\s*create table/im.test(geoMigration) && !/^\s*alter table/im.test(geoMigration)
    && !/^\s*insert into/im.test(geoMigration));
  ok("H2. it never touches a geography_* table's own rows — no INSERT/UPDATE/DELETE against any of them anywhere in the file",
    !/(insert into|update|delete from)\s+public\.geography_/i.test(geoMigration));
  ok("H3. geography_name (the leaf name/code) is still resolved from the same source columns as before (gc.name/gl.name/gw.name/gp.code) — AcceptInvite.jsx's existing read is unaffected",
    /select gc\.name, gs\.name/.test(geoMigration) && /select gl\.name, gs\.name/.test(geoMigration)
    && /select gw\.name, gl\.name, gs\.name/.test(geoMigration) && /select gp\.code, gw\.name, gl\.name, gs\.name/.test(geoMigration));
  ok("H4. LGA-level: real join from geography_lgas.state_code to geography_states.code, never a second geography source or a hardcoded value",
    /from public\.geography_lgas gl\s*\n\s*join public\.geography_states gs on gs\.code = gl\.state_code/.test(geoMigration));
  ok("H5. Ward-level: real join chain geography_wards -> geography_lgas -> geography_states",
    /from public\.geography_wards gw\s*\n\s*join public\.geography_lgas gl on gl\.id = gw\.lga_id\s*\n\s*join public\.geography_states gs on gs\.code = gl\.state_code/.test(geoMigration));
  ok("H6. Polling-unit-level: real join chain geography_polling_units -> geography_wards -> geography_lgas -> geography_states",
    /from public\.geography_polling_units gp\s*\n\s*join public\.geography_wards gw on gw\.id = gp\.ward_id\s*\n\s*join public\.geography_lgas gl on gl\.id = gw\.lga_id\s*\n\s*join public\.geography_states gs on gs\.code = gl\.state_code/.test(geoMigration));
  ok("H7. Constituency-level: state context added via the direct geography_constituencies.state_code hop (no LGA/ward hop needed, matches the schema)",
    /from public\.geography_constituencies gc\s*\n\s*join public\.geography_states gs on gs\.code = gc\.state_code/.test(geoMigration));
  ok("H8. no state, LGA, or ward name is ever hardcoded in the migration (e.g. no literal 'Lagos'/'Agege' string anywhere in the function body)",
    !/'Lagos'|'Agege'|'lagos'|'agege'/.test(geoMigration));
  ok("H9. the function stays SECURITY DEFINER with search_path locked down, same discipline as every other privileged function in this migration set",
    /security definer[\s\S]{0,40}set search_path = ''/.test(geoMigration));
  ok("H10. execute grants are re-established for both authenticated and anon (the invite-preview page is public) after the DROP+CREATE",
    /grant execute on function public\.get_invitation_preview\(text\) to authenticated/.test(geoMigration)
    && /grant execute on function public\.get_invitation_preview\(text\) to anon/.test(geoMigration));

  ok("H11. create_campaign_invitation()'s own authorization logic is byte-for-byte unchanged in its original migration — this pass touched no privileged write path",
    /if v_my_role in \('owner', 'manager'\) then\s*\n\s*v_authorised := true;/.test(invitationsMigration)
    && /join public\.geography_wards w on w\.id::text = p_intended_geography_ref/.test(invitationsMigration)
    && /join public\.geography_polling_units pu on pu\.id::text = p_intended_geography_ref/.test(invitationsMigration));
  ok("H12. the new migration file itself never defines/replaces create_campaign_invitation, accept_campaign_invitation, or revoke_campaign_invitation — only get_invitation_preview",
    !/create (or replace )?function public\.(create|accept|revoke)_campaign_invitation/.test(geoMigration));
  ok("H13. no RLS policy statement appears in the new migration — the redesign changes a function's output, never a table's access control",
    !/create policy|alter table.*enable row level security/i.test(geoMigration));

  const indexTs = text("../supabase/functions/election-invitation-email/index.ts");
  ok("H14. index.ts threads the new geography-context fields from the preview RPC into buildInvitationEmail — the email actually gets what the migration now returns",
    /geographyStateName: preview\?\.geography_state_name/.test(indexTs)
    && /geographyLgaName: preview\?\.geography_lga_name/.test(indexTs)
    && /geographyWardName: preview\?\.geography_ward_name/.test(indexTs));
  ok("H15. index.ts still never imports a service-role key or the @supabase/supabase-js service client — only the caller's forwarded Authorization header, unchanged by this pass",
    !/SERVICE_ROLE/i.test(indexTs));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);
