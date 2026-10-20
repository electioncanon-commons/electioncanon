// ============================================================
// OUTREACH ACTIVATION — SEPARATION TESTS
//
// Proves, at the source level, three boundaries the outreach brief
// requires and that are otherwise only true "by not having written the
// code wrong yet":
//   1. outreach_* shares no table/function with the public /launch
//      funnel (launch_subscribers, launch_analytics_events) -- and the
//      public funnel's own unsubscribe/confirm path is untouched.
//   2. outreach_* carries no tenant/campaign scope and never touches
//      election Canon tables (election_events, campaigns).
//   3. the outreach domain layer stays DOM-free/Supabase-free, matching
//      every other domain module in this repo.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const OUTREACH_DOMAIN_FILES = [
  "src/domains/outreach/model.js", "src/domains/outreach/followup.js", "src/domains/outreach/assets.js",
  "src/domains/outreach/import.js", "src/domains/outreach/learning.js", "src/domains/outreach/write.js",
  "src/domains/outreach/reconcile.js", "src/domains/outreach/historicalImport.js", "src/domains/outreach/messageActivity.js",
  "src/domains/outreach/composer.js",
];
const OUTREACH_BACKEND_FILES = [
  "supabase/functions/outreach-admin/contract.mjs", "supabase/functions/outreach-admin/index.ts",
  "supabase/functions/outreach-gmail/contract.mjs", "supabase/functions/outreach-gmail/index.ts",
];
const LAUNCH_DOMAIN_FILES = ["src/domains/launch/write.js", "src/domains/launch/attribution.js"];
const LAUNCH_BACKEND_FILES = fs.readdirSync(path.join(root, "supabase/functions"))
  .filter((d) => d.startsWith("launch-"))
  .flatMap((d) => ["index.ts", "contract.mjs"].map((f) => `supabase/functions/${d}/${f}`))
  .filter((p) => fs.existsSync(path.join(root, p)));

// SQL uses "--" line comments, which stripComments() does not know about -- strip them separately.
function stripSqlComments(sql) {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

const outreachMigration = stripSqlComments(readSrc("supabase/migrations/20261008000000_election_outreach_activation.sql"));
const messageActivityMigration = stripSqlComments(readSrc("supabase/migrations/20261014000000_election_outreach_message_activity.sql"));

console.log("\nOUTREACH ACTIVATION — launch/outreach/election separation\n");

console.log("A — outreach code never references the public launch funnel's tables/functions");
{
  const banned = /launch_subscribers|launch_analytics_events|launch_subscribe_attempts|LAUNCH_ADMIN_SECRET/;
  for (const rel of [...OUTREACH_DOMAIN_FILES, ...OUTREACH_BACKEND_FILES]) {
    const code = stripComments(readSrc(rel));
    ok(`1. ${rel} does not reference the launch funnel's tables/secret`, !banned.test(code));
  }
}

console.log("\nB — the public launch funnel never references outreach's tables/function/secret");
{
  const banned = /outreach_contacts|outreach_status_changes|outreach_followups|OUTREACH_ADMIN_SECRET|outreach-admin/;
  for (const rel of [...LAUNCH_DOMAIN_FILES, ...LAUNCH_BACKEND_FILES]) {
    const code = stripComments(readSrc(rel));
    ok(`1. ${rel} does not reference outreach_* tables/secret`, !banned.test(code));
  }
}

console.log("\nC — unsubscribe preservation: the existing launch-unsubscribe path is untouched by this feature");
{
  const unsubscribeIndex = stripComments(readSrc("supabase/functions/launch-unsubscribe/index.ts"));
  ok("1. launch-unsubscribe/index.ts still calls unsubscribe_launch_subscription", /unsubscribe_launch_subscription/.test(unsubscribeIndex));
  ok("2. launch-unsubscribe/index.ts has no outreach reference at all", !/outreach/i.test(unsubscribeIndex));
}

console.log("\nD — outreach_contacts/outreach_followups carry no tenant/campaign/election-Canon scope");
{
  ok("1. the outreach migration never references election_events", !/election_events/.test(outreachMigration));
  ok("2. the outreach migration never references a campaigns table or campaign_id column", !/\bcampaign_id\b|references public\.campaigns/.test(outreachMigration));
  ok("3. the outreach migration never references geography_wards or any tenant table", !/geography_wards|tenant_id/.test(outreachMigration));
  ok("4. outreach_contacts has its own 'campaign' TEXT field (the outreach wave name) -- distinct from a tenant-scoped campaign_id foreign key",
     /campaign\s+text\s+check/.test(outreachMigration));
}

console.log("\nE — outreach domain layer is DOM-free, Supabase-free, React-free (same discipline as src/domains/election/)");
{
  for (const rel of OUTREACH_DOMAIN_FILES.filter((f) => f !== "src/domains/outreach/write.js")) {
    const code = stripComments(readSrc(rel));
    ok(`1. ${rel} has no React import, no document/window, no Supabase import`,
       !/from ["']react["']/.test(code) && !/\bdocument\.|\bwindow\./.test(code) && !/supabase/i.test(code));
  }
}

console.log("\nF — RLS posture: outreach tables enable RLS with zero client policies (admin-secret gated only)");
{
  ok("1. all three outreach tables enable row level security", (outreachMigration.match(/enable row level security/g) || []).length === 3);
  ok("2. no 'create policy' statement exists anywhere in this migration", !/create policy/i.test(outreachMigration));
  ok("3. all three message-activity-migration tables (events, send claims, Gmail connection) enable RLS with zero client policies (same posture)",
     (messageActivityMigration.match(/enable row level security/g) || []).length === 3 && !/create policy/i.test(messageActivityMigration));
  ok("4. the message-activity migration never references election_events/campaigns/geography_wards either",
     !/election_events|references public\.campaigns|geography_wards/.test(messageActivityMigration));
  ok("5. outreach_gmail_connection's refresh token column is never selected by name anywhere in the admin Edge Function (never returned in any response)",
     !/refresh_token_encrypted/.test(stripComments(readSrc("supabase/functions/outreach-admin/index.ts"))));
  ok("6. Phase 11B's diagnostic view (outreach_send_claim_inconsistencies) is never granted to anon or authenticated -- owner-queried only, same posture as launch_analytics_daily",
     !/grant\s+(select|all)\s+on\s+(public\.)?outreach_send_claim_inconsistencies\s+to\s+(anon|authenticated)/i.test(messageActivityMigration));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
