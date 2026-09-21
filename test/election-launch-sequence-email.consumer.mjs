// ============================================================
// LAUNCH DISTRIBUTION — SEQUENCE EMAIL CONTRACT + AD02/AD03 HONESTY  (Alpha 1.7; Brevo pass)
//
// Covers: supabase/functions/launch-send-campaign-email/contract.mjs
// (all 3 templates, unsubscribe-link presence, escaping, Brevo request/
// response shaping, the SEQUENCE_CONTENT_READY send guard), a source
// scan of index.ts (LAUNCH_ADMIN_SECRET gating, missing-BREVO_API_KEY
// handling, no secret logging, the content-ready guard runs regardless
// of a valid secret), and a source scan proving neither the AD02 nor
// AD03 email/page ever claims a film exists that hasn't been made yet —
// the exact overclaiming this launch's own design (see contract.mjs's
// header) is built to avoid.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEQUENCE_STEPS, SEQUENCE_CONTENT_READY, validateSendCampaignRequest, buildSequenceEmail,
  buildBrevoEmailRequest, interpretBrevoResponse,
} from "../supabase/functions/launch-send-campaign-email/contract.mjs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const contractSrc = readSrc("supabase/functions/launch-send-campaign-email/contract.mjs");
const indexTs = readSrc("supabase/functions/launch-send-campaign-email/index.ts");
const ad02Page = readSrc("src/pages/launch/LaunchAd02.jsx");
const ad03Page = readSrc("src/pages/launch/LaunchAd03.jsx");

console.log("\nLAUNCH DISTRIBUTION — Sequence email contract\n");

console.log("A — validateSendCampaignRequest()  (AD02/AD03 content-ready guard)");
{
  ok("1. sequence 1 (AD01, real content) is accepted", validateSendCampaignRequest({ sequence: 1 }).valid === true);
  ok("2. sequence 2 (AD02, no content yet) is BLOCKED with CONTENT_NOT_READY, not a generic BAD_REQUEST",
     validateSendCampaignRequest({ sequence: 2 }).valid === false && validateSendCampaignRequest({ sequence: 2 }).code === "CONTENT_NOT_READY");
  ok("3. sequence 3 (AD03, no content yet) is BLOCKED with CONTENT_NOT_READY",
     validateSendCampaignRequest({ sequence: 3 }).valid === false && validateSendCampaignRequest({ sequence: 3 }).code === "CONTENT_NOT_READY");
  ok("4. rejects 0", validateSendCampaignRequest({ sequence: 0 }).valid === false);
  ok("5. rejects 4", validateSendCampaignRequest({ sequence: 4 }).valid === false);
  ok("6. rejects a string '1' (not the number)", validateSendCampaignRequest({ sequence: "1" }).valid === false);
  ok("7. rejects a missing sequence", validateSendCampaignRequest({}).valid === false);
  ok("8. SEQUENCE_CONTENT_READY is the single source of truth: exactly {1:true, 2:false, 3:false}, never inferred elsewhere",
     SEQUENCE_CONTENT_READY[1] === true && SEQUENCE_CONTENT_READY[2] === false && SEQUENCE_CONTENT_READY[3] === false);
}

console.log("\nB — buildSequenceEmail(): all 3 steps");
{
  for (const step of [1, 2, 3]) {
    const built = buildSequenceEmail({ step, token: "tok123", origin: "https://electioncanon.org" });
    ok(`${step}.1 subject is non-empty`, typeof built.subject === "string" && built.subject.length > 0);
    ok(`${step}.2 html contains a real per-subscriber unsubscribe link built from the token`,
       built.html.includes(`https://electioncanon.org/launch/unsubscribe?token=tok123`));
    ok(`${step}.3 text alternative also contains the real unsubscribe link`,
       built.text.includes(`https://electioncanon.org/launch/unsubscribe?token=tok123`));
    ok(`${step}.4 html is well-formed enough to contain a doctype and closing body`,
       built.html.startsWith("<!doctype html>") && built.html.trim().endsWith("</html>"));
  }
}

console.log("\nC — Email 1 (AD01): real, shipped content only");
{
  const e1 = buildSequenceEmail({ step: 1, token: "t", origin: "https://electioncanon.org" });
  ok("1. links to the real, live /launch/ad01 stop", e1.html.includes("https://electioncanon.org/launch/ad01"));
  ok("2. never says AD02 or AD03 are watchable yet", !/watch ad0[23]/i.test(e1.html));
}

console.log("\nD — Email 2 (AD02) and Email 3 (AD03): no film-exists claim");
{
  const e2 = buildSequenceEmail({ step: 2, token: "t", origin: "https://electioncanon.org" });
  const e3 = buildSequenceEmail({ step: 3, token: "t", origin: "https://electioncanon.org" });
  ok("1. Email 2 never says 'watch' — no film to watch yet",
     !/watch/i.test(e2.html) && !/watch/i.test(e2.text));
  ok("2. Email 2 explicitly says the AD02 film is still in production",
     /still in production/i.test(e2.html) && /still in production/i.test(e2.text));
  ok("3. Email 3 never says 'watch' — no film to watch yet",
     !/watch/i.test(e3.html) && !/watch/i.test(e3.text));
  ok("4. Email 3 explicitly says the AD03 film is still in production",
     /still in production/i.test(e3.html) && /still in production/i.test(e3.text));
  ok("5. Email 3's real CTA is the GitHub repository, not a fabricated film link",
     e3.html.includes("https://github.com/electioncanon-commons/electioncanon"));
}

console.log("\nE — buildBrevoEmailRequest() / interpretBrevoResponse()  (Brevo migration)");
{
  const req = buildBrevoEmailRequest({ senderEmail: "admin@electioncanon.org", senderName: "ElectionCanon", to: "b", subject: "s", html: "h", text: "t" });
  ok("1. `to` is Brevo's {email} object array shape", Array.isArray(req.to) && req.to[0].email === "b");
  ok("2. a 2xx messageId response is ok", interpretBrevoResponse(201, { messageId: "brevo-1" }).ok === true);
  ok("3. a non-2xx response fails with a message", interpretBrevoResponse(500, null).ok === false);
  const noResendSrc = stripComments(contractSrc);
  ok("4. no Resend reference remains in this file's live code",
     !/RESEND_API_KEY|buildResendRequest|interpretResendResponse/.test(noResendSrc));
}

console.log("\nF — cross-file honesty: neither the contract nor the AD02/AD03 pages claim a shipped film exists");
{
  ok("1. contract.mjs's own header documents the honesty constraint this suite verifies",
     /HONESTY OVER COMPLETENESS/.test(contractSrc));
  ok("2. LaunchAd02.jsx never claims AD02 is watchable",
     !/watch\s+(the\s+)?ad02/i.test(ad02Page));
  ok("3. LaunchAd02.jsx's own copy says the film is in production, not shipped",
     /in production/i.test(ad02Page));
  ok("4. LaunchAd03.jsx never claims AD03 is watchable",
     !/watch\s+(the\s+)?ad03/i.test(ad03Page));
  ok("5. LaunchAd03.jsx's own copy says the film is in production, not shipped",
     /in production/i.test(ad03Page));
  ok("6. LaunchAd03.jsx never invents a social-media link — outbound tracking is github_click only on this page",
     !/twitter\.com|x\.com\/|linkedin\.com|facebook\.com|instagram\.com/i.test(ad03Page));
}

console.log("\nG — launch-send-campaign-email/index.ts source scan: LAUNCH_ADMIN_SECRET gating, missing BREVO_API_KEY, no secret logging");
{
  const indexCode = stripComments(indexTs);
  ok("1. requires LAUNCH_ADMIN_SECRET as a bearer token BEFORE reading the request body at all — unauthenticated callers never reach validateSendCampaignRequest",
     /const adminSecret = Deno\.env\.get\("LAUNCH_ADMIN_SECRET"\)[\s\S]{0,200}UNAUTHENTICATED[\s\S]{0,400}let body: unknown/.test(indexCode));
  ok("2. the content-ready guard (validateSendCampaignRequest, which blocks sequence 2/3) runs BEFORE BREVO_API_KEY is even read — a valid admin secret alone can never reach a Brevo call for AD02/AD03",
     /validateSendCampaignRequest\(body\)[\s\S]{0,300}Deno\.env\.get\("BREVO_API_KEY"\)/.test(indexCode));
  ok("3. reads BREVO_API_KEY (not RESEND_API_KEY) as the provider secret in live code",
     /Deno\.env\.get\("BREVO_API_KEY"\)/.test(indexCode) && !/RESEND_API_KEY/.test(indexCode));
  ok("4. a missing BREVO_API_KEY refuses with PROVIDER_NOT_CONFIGURED before any subscriber is read",
     /if \(!brevoKey \|\| !supabaseUrl \|\| !serviceKey\)[\s\S]{0,120}PROVIDER_NOT_CONFIGURED[\s\S]{0,600}from\("launch_subscribers"\)/.test(indexCode));
  ok("5. the Brevo request uses the `api-key` header, never `Authorization: Bearer` (Resend's scheme)",
     /"api-key":\s*brevoKey/.test(indexCode) && !/Authorization.*brevoKey/.test(indexCode));
  ok("6. no console.log/error/warn anywhere in this file — a per-recipient send failure is counted, never logged with request/response content",
     !/console\.(log|error|warn)/.test(indexCode));
  ok("7. the final response never lists recipient emails — only aggregate counts {sequence, attempted, sent, failed}",
     /json\(\{\s*ok:\s*true,\s*sequence:\s*validation\.sequence,\s*attempted:[\s\S]{0,60}sent,\s*failed\s*\}\)/.test(indexCode));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
