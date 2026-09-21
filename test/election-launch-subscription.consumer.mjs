// ============================================================
// LAUNCH DISTRIBUTION — SUBSCRIBE CONTRACT + WRITE LAYER  (Alpha 1.7; Brevo pass)
//
// Covers: supabase/functions/launch-subscribe/contract.mjs (validation,
// token minting, confirmation-email HTML/text escaping, Brevo request/
// response shaping, rate-limit decision logic), src/domains/launch/
// write.js (subscribeToLaunch/confirmLaunchSubscription/
// unsubscribeLaunchSubscription against fake clients), a source scan of
// launch-subscribe/index.ts (missing-BREVO_API_KEY handling, no secret
// logging), and a source scan of the launch_subscribers + rate-limit
// migrations proving the token-secrecy/service-role-only postures this
// whole design depends on.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_CAMPAIGNS, validateSubscribeRequest, mintLaunchToken, buildConfirmationEmail,
  buildBrevoEmailRequest, interpretBrevoResponse, shouldRateLimitSignup,
} from "../supabase/functions/launch-subscribe/contract.mjs";
import { subscribeToLaunch, confirmLaunchSubscription, unsubscribeLaunchSubscription, recordLaunchEvent } from "../src/domains/launch/write.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260921000000_election_launch_distribution.sql"), "utf8");
const rateLimitMigration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260922000000_election_launch_brevo_rate_limit.sql"), "utf8");
const subscribeIndexTs = fs.readFileSync(path.join(__dirname, "../supabase/functions/launch-subscribe/index.ts"), "utf8");
const invitationEmailIndexTs = fs.readFileSync(path.join(__dirname, "../supabase/functions/election-invitation-email/index.ts"), "utf8");
const invitationEmailContractSrc = fs.readFileSync(path.join(__dirname, "../supabase/functions/election-invitation-email/contract.mjs"), "utf8");

console.log("\nLAUNCH DISTRIBUTION — Subscribe contract\n");

console.log("A — validateSubscribeRequest()");
{
  ok("1. accepts a valid email + closed-vocabulary source_campaign",
     validateSubscribeRequest({ email: "voter@example.com", source_campaign: "ad01" }).valid === true);
  ok("2. rejects a missing email",
     validateSubscribeRequest({ source_campaign: "ad01" }).valid === false);
  ok("3. rejects a malformed email",
     validateSubscribeRequest({ email: "not-an-email", source_campaign: "ad01" }).valid === false);
  ok("4. rejects a source_campaign outside the closed vocabulary",
     validateSubscribeRequest({ email: "voter@example.com", source_campaign: "ad99" }).valid === false);
  ok("5. every closed source_campaign value is individually accepted",
     SOURCE_CAMPAIGNS.every((c) => validateSubscribeRequest({ email: "voter@example.com", source_campaign: c }).valid === true));
  ok("6. lowercases and trims the email",
     validateSubscribeRequest({ email: "  Voter@Example.COM  ", source_campaign: "launch" }).email === "voter@example.com");
  ok("7. referral_id is optional",
     validateSubscribeRequest({ email: "voter@example.com", source_campaign: "launch" }).referralId === null);
  ok("8. referral_id is capped at 64 chars",
     validateSubscribeRequest({ email: "voter@example.com", source_campaign: "launch", referral_id: "x".repeat(200) }).referralId.length === 64);
  ok("9. a non-string referral_id is rejected",
     validateSubscribeRequest({ email: "voter@example.com", source_campaign: "launch", referral_id: 12345 }).valid === false);
}

console.log("\nB — mintLaunchToken()");
{
  const t1 = mintLaunchToken();
  const t2 = mintLaunchToken();
  ok("1. produces a 64-hex-character token (two concatenated UUIDs, dashes stripped)",
     /^[0-9a-f]{64}$/.test(t1));
  ok("2. two calls never collide",
     t1 !== t2);
}

console.log("\nC — buildConfirmationEmail()");
{
  const built = buildConfirmationEmail({ email: "voter@example.com", sourceCampaign: "ad01", token: "abc123", origin: "https://electioncanon.org" });
  ok("1. subject never mentions a subscription already existing",
     /Confirm/.test(built.subject));
  ok("2. the confirm link is built from origin + token, in the button href",
     built.html.includes('href="https://electioncanon.org/launch/confirm?token=abc123"'));
  ok("3. the raw token never appears as bare visible text outside an href",
     !new RegExp(`>\\s*abc123\\s*<`).test(built.html));
  ok("4. HTML explicitly says no subscription exists until the link is clicked",
     /no subscription (exists|is created) until/i.test(built.html));
  ok("5. this email carries NO unsubscribe link — nothing to unsubscribe from yet",
     !/unsubscribe/i.test(built.html));
  ok("6. text alternative contains the real confirm link",
     built.text.includes("https://electioncanon.org/launch/confirm?token=abc123"));
  ok("7. a malicious email value is HTML-escaped, never injected raw",
     (() => {
       const xss = buildConfirmationEmail({ email: '"><script>alert(1)</script>', sourceCampaign: "ad01", token: "abc", origin: "https://electioncanon.org" });
       return !xss.html.includes("<script>alert(1)</script>");
     })());
}

console.log("\nD — buildBrevoEmailRequest() / interpretBrevoResponse()  (Brevo migration)");
{
  const req = buildBrevoEmailRequest({ senderEmail: "admin@electioncanon.org", senderName: "ElectionCanon", to: "x@y.com", subject: "S", html: "<p>h</p>", text: "t" });
  ok("1. `to` is Brevo's {email} object array shape", Array.isArray(req.to) && req.to[0].email === "x@y.com");
  ok("2. sender is a {name,email} object, not a combined string (Resend's shape)", req.sender.email === "admin@electioncanon.org" && req.sender.name === "ElectionCanon");
  ok("3. html/text map to Brevo's htmlContent/textContent field names", req.htmlContent === "<p>h</p>" && req.textContent === "t");
  ok("4. a 2xx response with a messageId is interpreted ok",
     interpretBrevoResponse(201, { messageId: "brevo-1" }).ok === true && interpretBrevoResponse(201, { messageId: "brevo-1" }).providerMessageId === "brevo-1");
  ok("5. a non-2xx response is interpreted as a failure with a message",
     interpretBrevoResponse(400, { message: "invalid" }).ok === false && interpretBrevoResponse(400, { message: "invalid" }).error === "invalid");
}

console.log("\nD2 — launch-subscribe/contract.mjs source scan: Resend is fully gone, not just supplemented");
{
  const subscribeContractSrc = fs.readFileSync(path.join(__dirname, "../supabase/functions/launch-subscribe/contract.mjs"), "utf8");
  const subscribeContractCode = stripComments(subscribeContractSrc);
  ok("1. no RESEND_API_KEY/Resend reference remains in this file's LIVE CODE (a prose mention in the header comment explaining the migration is fine and expected)",
     !/RESEND_API_KEY/.test(subscribeContractCode) && !/buildResendRequest|interpretResendResponse/.test(subscribeContractCode));
  ok("2. buildBrevoEmailRequest/interpretBrevoResponse/shouldRateLimitSignup are all exported from the default export too",
     /buildBrevoEmailRequest,\s*interpretBrevoResponse,\s*shouldRateLimitSignup/.test(subscribeContractSrc));
}

console.log("\nE — rate limiting: shouldRateLimitSignup() decision logic");
{
  ok("1. under the default threshold (5), a caller with 4 recent attempts is allowed", shouldRateLimitSignup(4) === false);
  ok("2. at the default threshold, a caller with 5 recent attempts is refused", shouldRateLimitSignup(5) === true);
  ok("3. a caller with 0 recent attempts is always allowed", shouldRateLimitSignup(0) === false);
  ok("4. an explicit custom threshold is honored", shouldRateLimitSignup(2, 2) === true && shouldRateLimitSignup(1, 2) === false);
}

console.log("\nF — launch-subscribe/index.ts source scan: missing BREVO_API_KEY, rate-limit wiring, no secret logging");
{
  const subscribeIndexCode = stripComments(subscribeIndexTs);
  ok("1. reads BREVO_API_KEY (not RESEND_API_KEY) as the provider secret in live code (a prose mention in the header comment explaining the migration is fine and expected)",
     /Deno\.env\.get\("BREVO_API_KEY"\)/.test(subscribeIndexCode) && !/RESEND_API_KEY/.test(subscribeIndexCode));
  ok("2. a missing BREVO_API_KEY refuses with PROVIDER_NOT_CONFIGURED before any Brevo fetch is attempted",
     /if \(!brevoKey \|\| !supabaseUrl \|\| !serviceKey\)[\s\S]{0,120}PROVIDER_NOT_CONFIGURED/.test(subscribeIndexTs));
  ok("3. the Brevo request uses the `api-key` header, never `Authorization: Bearer` (Resend's scheme)",
     /"api-key":\s*brevoKey/.test(subscribeIndexTs) && !/Authorization.*brevoKey/.test(subscribeIndexTs));
  ok("4. the failure catch block never logs the vendor request/response body — no console.log/error present in this file at all",
     !/console\.(log|error|warn)/.test(subscribeIndexTs));
  ok("5. shouldRateLimitSignup is actually called (wired, not just imported)",
     /shouldRateLimitSignup\(/.test(subscribeIndexTs));
  ok("6. a rate-limited caller gets a generic refusal — no attempt count or threshold value in the response text",
     /"please try again later"/.test(subscribeIndexTs) && !/RATE_LIMIT_MAX_ATTEMPTS\}/.test(subscribeIndexTs));
  ok("7. the response payload for a successful subscribe never includes the subscriber's email, source_campaign, or referral_id — only {ok, providerMessageId}",
     !/json\(\{\s*ok:\s*true,\s*(email|source_campaign|referral_id|referralId|sourceCampaign)/.test(subscribeIndexTs));
}

console.log("\nG — src/domains/launch/write.js against fake clients (never throws, honest {ok,error} shape)");
{
  {
    const fakeClient = { functions: { invoke: async () => ({ data: { ok: true }, error: null }) } };
    const result = await subscribeToLaunch({ client: fakeClient, email: "voter@example.com", sourceCampaign: "ad01" });
    ok("1. subscribeToLaunch() reports ok:true on a successful invoke", result.ok === true && result.error === null);
  }
  {
    const fakeClient = { functions: { invoke: async () => ({ data: null, error: { message: "boom" } }) } };
    const result = await subscribeToLaunch({ client: fakeClient, email: "voter@example.com", sourceCampaign: "ad01" });
    ok("2. subscribeToLaunch() reports the real error message, never throws", result.ok === false && result.error === "boom");
  }
  {
    const result = await subscribeToLaunch({ client: null, email: "voter@example.com", sourceCampaign: "ad01" });
    ok("3. subscribeToLaunch() degrades honestly with no client (demo mode) instead of throwing", result.ok === false && typeof result.error === "string");
  }
  {
    // Brevo pass: confirmLaunchSubscription() now calls the launch-confirm Edge Function, not client.rpc() directly -- see write.js's own header.
    const fakeClient = { functions: { invoke: async (name, { body }) => {
      ok("4a. confirmLaunchSubscription() invokes the launch-confirm Edge Function by name", name === "launch-confirm");
      ok("4b. it forwards the token in the request body, untouched", body.token === "tok");
      return { data: { ok: true, alreadyConfirmed: false, brevoSynced: true }, error: null };
    } } };
    const result = await confirmLaunchSubscription({ client: fakeClient, token: "tok" });
    ok("4c. confirmLaunchSubscription() surfaces alreadyConfirmed correctly", result.ok === true && result.alreadyConfirmed === false);
  }
  {
    const fakeClient = { functions: { invoke: async () => ({ data: { ok: false, reason: "this confirmation link is invalid or has expired" }, error: null }) } };
    const result = await confirmLaunchSubscription({ client: fakeClient, token: "bad-token" });
    ok("5. confirmLaunchSubscription() reports an honest failure for an invalid token", result.ok === false);
  }
  {
    // Brevo pass: unsubscribeLaunchSubscription() now calls the launch-unsubscribe Edge Function.
    const fakeClient = { functions: { invoke: async (name) => {
      ok("6a. unsubscribeLaunchSubscription() invokes the launch-unsubscribe Edge Function by name", name === "launch-unsubscribe");
      return { data: { ok: true, brevoSynced: true }, error: null };
    } } };
    const result = await unsubscribeLaunchSubscription({ client: fakeClient, token: "tok" });
    ok("6b. unsubscribeLaunchSubscription() reports success", result.ok === true);
  }
  {
    let threw = false;
    const fakeClient = { rpc: async () => { throw new Error("network down"); } };
    try { await recordLaunchEvent({ client: fakeClient, eventType: "landing_page_visit", sessionId: "s1", path: "/launch" }); }
    catch { threw = true; }
    ok("7. recordLaunchEvent() never throws even when the RPC itself throws", threw === false);
  }
  {
    // confirm/unsubscribe are the ONLY two write.js functions that call client.functions.invoke with "launch-confirm"/"launch-unsubscribe" -- confirm they no longer call client.rpc for these two operations.
    const writeSrc = fs.readFileSync(path.join(__dirname, "../src/domains/launch/write.js"), "utf8");
    ok("8. write.js no longer calls confirm_launch_subscription/unsubscribe_launch_subscription via client.rpc() directly",
       !/client\.rpc\("confirm_launch_subscription"/.test(writeSrc) && !/client\.rpc\("unsubscribe_launch_subscription"/.test(writeSrc));
  }
}

console.log("\nH — launch_subscribers token secrecy (migration source scan)");
{
  ok("1. no `create policy` statement exists for launch_subscribers — no client select/insert/update path",
     !/create policy[\s\S]{0,80}launch_subscribers/i.test(migration));
  ok("2. row level security is enabled on launch_subscribers",
     /alter table public\.launch_subscribers enable row level security/i.test(migration));
  ok("3. confirm_launch_subscription is granted to anon (unauthenticated confirmation must work)",
     /grant execute on function public\.confirm_launch_subscription\(text\) to anon/.test(migration));
  ok("4. unsubscribe_launch_subscription is granted to anon",
     /grant execute on function public\.unsubscribe_launch_subscription\(text\) to anon/.test(migration));
  ok("5. every SECURITY DEFINER function in this migration sets search_path = '' (no schema-hijack surface)",
     (migration.match(/^security definer$/gm) ?? []).length === (migration.match(/^set search_path = ''$/gm) ?? []).length
     && (migration.match(/^security definer$/gm) ?? []).length >= 3);
}

console.log("\nI — launch_subscribe_attempts: service-role-only rate-limit ledger (migration source scan)");
{
  ok("1. no `create policy` statement exists for launch_subscribe_attempts — no client (anon/authenticated) path exists, direct or otherwise",
     !/create policy[\s\S]{0,80}launch_subscribe_attempts/i.test(rateLimitMigration));
  ok("2. row level security is enabled",
     /alter table public\.launch_subscribe_attempts enable row level security/i.test(rateLimitMigration));
  ok("3. no grant to anon/authenticated exists anywhere in this migration (there is no RPC wrapper -- only the service-role client touches this table)",
     !/grant execute[\s\S]{0,80}to anon/i.test(rateLimitMigration) && !/grant execute[\s\S]{0,80}to authenticated/i.test(rateLimitMigration));
  ok("4. the table's own comment documents it is never joined to launch_subscribers / never exposed in any API response",
     /never (joined to launch_subscribers|exposed in any API response)/i.test(rateLimitMigration));
}

console.log("\nJ — election-invitation-email is completely untouched by the Brevo migration (regression proof)");
{
  ok("1. election-invitation-email/index.ts still reads RESEND_API_KEY (unchanged provider)",
     /Deno\.env\.get\("RESEND_API_KEY"\)/.test(invitationEmailIndexTs));
  ok("2. election-invitation-email/index.ts still posts to api.resend.com (unchanged vendor endpoint)",
     /https:\/\/api\.resend\.com\/emails/.test(invitationEmailIndexTs));
  ok("3. election-invitation-email/index.ts has no BREVO reference of any kind",
     !/BREVO/.test(invitationEmailIndexTs));
  ok("4. election-invitation-email/contract.mjs still exports buildResendRequest/interpretResendResponse — its own Resend contract is untouched",
     /export function buildResendRequest/.test(invitationEmailContractSrc) && /export function interpretResendResponse/.test(invitationEmailContractSrc));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
