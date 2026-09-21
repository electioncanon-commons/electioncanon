// ============================================================
// LAUNCH DISTRIBUTION — CONFIRM/UNSUBSCRIBE + BREVO CONTACT SYNC  (Alpha 1.7, Brevo pass)
//
// Covers: supabase/functions/launch-confirm/contract.mjs and
// supabase/functions/launch-unsubscribe/contract.mjs (validation, Brevo
// contact upsert/unsubscribe payload shaping, response interpretation),
// and source scans of both index.ts files proving: a Brevo failure never
// blocks/undoes the underlying RPC's write, no subscriber PII (email,
// source_campaign, referral_id) ever appears in an API response, and
// already-confirmed replays never re-sync to Brevo.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfirmRequest, buildBrevoContactUpsert, interpretBrevoContactResponse as interpretConfirmContactResponse } from "../supabase/functions/launch-confirm/contract.mjs";
import { validateUnsubscribeRequest, buildBrevoContactUnsubscribe, interpretBrevoContactResponse as interpretUnsubContactResponse } from "../supabase/functions/launch-unsubscribe/contract.mjs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const confirmIndexTs = readSrc("supabase/functions/launch-confirm/index.ts");
const unsubIndexTs = readSrc("supabase/functions/launch-unsubscribe/index.ts");
const confirmCode = stripComments(confirmIndexTs);
const unsubCode = stripComments(unsubIndexTs);

console.log("\nLAUNCH DISTRIBUTION — Confirm/Unsubscribe + Brevo contact sync\n");

console.log("A — validateConfirmRequest() / validateUnsubscribeRequest()");
{
  ok("1. validateConfirmRequest accepts a non-empty token", validateConfirmRequest({ token: "abc" }).valid === true);
  ok("2. validateConfirmRequest rejects a missing token", validateConfirmRequest({}).valid === false);
  ok("3. validateConfirmRequest rejects an empty-string token", validateConfirmRequest({ token: "  " }).valid === false);
  ok("4. validateUnsubscribeRequest accepts a non-empty token", validateUnsubscribeRequest({ token: "abc" }).valid === true);
  ok("5. validateUnsubscribeRequest rejects a missing token", validateUnsubscribeRequest({}).valid === false);
}

console.log("\nB — buildBrevoContactUpsert() (launch-confirm)");
{
  const withList = buildBrevoContactUpsert({ email: "voter@example.com", sourceCampaign: "ad01", referralId: "ref-1", listId: 42 });
  ok("1. includes the email verbatim", withList.email === "voter@example.com");
  ok("2. source_campaign/referral_id are carried as Brevo attributes, not top-level PII fields",
     withList.attributes.SOURCE_CAMPAIGN === "ad01" && withList.attributes.REFERRAL_ID === "ref-1");
  ok("3. updateEnabled is always true — a re-confirm must never fail with 'contact already exists'",
     withList.updateEnabled === true);
  ok("4. listIds is set when a listId is provided", Array.isArray(withList.listIds) && withList.listIds[0] === 42);

  const noList = buildBrevoContactUpsert({ email: "voter@example.com", sourceCampaign: "ad01", referralId: null, listId: null });
  ok("5. listIds is OMITTED (not null/empty-array) when no listId is configured — contact creation never blocks on a list that doesn't exist yet",
     !("listIds" in noList));
  ok("6. a null referralId is carried through as null, never coerced to a string 'null'",
     noList.attributes.REFERRAL_ID === null);
}

console.log("\nC — buildBrevoContactUnsubscribe() (launch-unsubscribe)");
{
  ok("1. blacklists the contact", buildBrevoContactUnsubscribe().emailBlacklisted === true);
}

console.log("\nD — interpretBrevoContactResponse() (both functions)");
{
  ok("1. launch-confirm: 201 (created) is ok", interpretConfirmContactResponse(201, null).ok === true);
  ok("2. launch-confirm: 204 (updated, no body) is ok", interpretConfirmContactResponse(204, null).ok === true);
  ok("3. launch-confirm: a 4xx is a failure with a message", interpretConfirmContactResponse(400, { message: "bad" }).ok === false && interpretConfirmContactResponse(400, { message: "bad" }).error === "bad");
  ok("4. launch-unsubscribe: 204 is ok", interpretUnsubContactResponse(204, null).ok === true);
  ok("5. launch-unsubscribe: 404 (contact never existed in Brevo) is treated as ok — nothing to blacklist is not a failure",
     interpretUnsubContactResponse(404, null).ok === true);
}

console.log("\nE — launch-confirm/index.ts source scan: RPC unchanged, Brevo failure never blocks, no PII in response, no replay re-sync");
{
  ok("1. forwards to the SAME confirm_launch_subscription RPC, unchanged name/args",
     /supabase\.rpc\("confirm_launch_subscription",\s*\{\s*p_token:\s*validation\.token\s*\}\)/.test(confirmCode));
  ok("2. an invalid/expired token is refused generically (NOT_FOUND), never distinguishing why",
     /!rpcError && rpcError \|\| !row\?\.ok|rpcError \|\| !row\?\.ok/.test(confirmCode) && /NOT_FOUND/.test(confirmCode));
  ok("3. already_confirmed short-circuits BEFORE any Brevo contact read/fetch — no re-sync on replay",
     /row\.already_confirmed[\s\S]{0,200}return json\(\{\s*ok:\s*true,\s*alreadyConfirmed:\s*true,\s*brevoSynced:\s*false\s*\}\)/.test(confirmCode));
  ok("4. a Brevo fetch failure is caught and turns into brevoSynced:false, never an error response — the confirmation itself already succeeded",
     /catch \{\s*brevoSynced = false;\s*\}/.test(confirmCode));
  ok("5. the final response never includes email/source_campaign/referral_id — only {ok, alreadyConfirmed, brevoSynced}",
     /return json\(\{\s*ok:\s*true,\s*alreadyConfirmed:\s*false,\s*brevoSynced\s*\}\)/.test(confirmCode)
     && !/json\(\{[^}]*email[^}]*\}\)/.test(confirmCode));
  ok("6. no console.log/error/warn anywhere in this file",
     !/console\.(log|error|warn)/.test(confirmCode));
  ok("7. uses the Brevo `api-key` header, not Authorization: Bearer",
     /"api-key":\s*brevoKey/.test(confirmCode));
}

console.log("\nF — launch-unsubscribe/index.ts source scan: RPC unchanged, Brevo failure never blocks, no PII in response");
{
  ok("1. forwards to the SAME unsubscribe_launch_subscription RPC, unchanged name/args",
     /supabase\.rpc\("unsubscribe_launch_subscription",\s*\{\s*p_token:\s*validation\.token\s*\}\)/.test(unsubCode));
  ok("2. an invalid token is refused generically (NOT_FOUND)",
     /NOT_FOUND/.test(unsubCode));
  ok("3. a Brevo fetch failure is caught and turns into brevoSynced:false, never blocking the unsubscribe response",
     /catch \{\s*brevoSynced = false;\s*\}/.test(unsubCode));
  ok("4. the final response never includes the subscriber's email — only {ok, brevoSynced}",
     /return json\(\{\s*ok:\s*true,\s*brevoSynced\s*\}\)/.test(unsubCode) && !/json\(\{[^}]*email[^}]*\}\)/.test(unsubCode));
  ok("5. no console.log/error/warn anywhere in this file",
     !/console\.(log|error|warn)/.test(unsubCode));
  ok("6. PUTs to the contact's own email-scoped Brevo endpoint (not a bulk/list-wide call)",
     /https:\/\/api\.brevo\.com\/v3\/contacts\/\$\{encodeURIComponent\(subscriberBefore\.email\)\}/.test(unsubCode));
}

console.log("\nG — unsubscribed users never receive future launch emails (cross-function proof)");
{
  const sendIndexTs = readSrc("supabase/functions/launch-send-campaign-email/index.ts");
  const sendCode = stripComments(sendIndexTs);
  ok("1. launch-send-campaign-email only ever selects status === 'confirmed' recipients — 'unsubscribed' is a distinct, excluded status value in the same closed enum",
     /\.eq\("status",\s*"confirmed"\)/.test(sendCode));
  ok("2. launch-unsubscribe's own RPC sets status to 'unsubscribed', removing the row from that exact query going forward",
     /status = 'unsubscribed'/.test(fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260921000000_election_launch_distribution.sql"), "utf8")));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
