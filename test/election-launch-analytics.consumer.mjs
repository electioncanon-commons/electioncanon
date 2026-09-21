// ============================================================
// LAUNCH DISTRIBUTION — ANALYTICS  (Alpha 1.7)
//
// record_launch_analytics_event()'s validation logic lives entirely in
// SQL (no separate contract.mjs — see the migration's own header on why
// launch_analytics_events is insert-only through this one function).
// This suite source-scans that migration for the closed event_type
// vocabulary and the "no self-serve dashboard" posture (launch_
// analytics_daily is never granted to anon/authenticated), plus
// exercises src/domains/launch/write.js's recordLaunchEvent() against a
// fake client to prove the seven analytics categories the launch brief
// asks for are exactly the ones this schema supports — no more, no less.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordLaunchEvent } from "../src/domains/launch/write.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260921000000_election_launch_distribution.sql"), "utf8");

const REQUIRED_EVENT_TYPES = [
  "landing_page_visit", "film_view", "email_signup", "email_confirmed",
  "referral_visit", "github_click", "social_click",
];

console.log("\nLAUNCH DISTRIBUTION — Analytics\n");

console.log("A — closed event_type vocabulary matches exactly the 7 launch-brief categories");
{
  const checkMatch = migration.match(/event_type\s+text not null check \(event_type in \(([\s\S]*?)\)\)/);
  ok("1. the check constraint exists", !!checkMatch);
  const listed = (checkMatch?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
  ok("2. every launch-brief analytics category is present", REQUIRED_EVENT_TYPES.every((t) => listed.includes(t)));
  ok("3. no extra, undocumented event types exist beyond the 7", listed.length === REQUIRED_EVENT_TYPES.length);
}

console.log("\nB — launch_analytics_events: insert-only, no client policy");
{
  ok("1. no `create policy` statement exists for launch_analytics_events",
     !/create policy[\s\S]{0,80}launch_analytics_events/i.test(migration));
  ok("2. row level security is enabled",
     /alter table public\.launch_analytics_events enable row level security/i.test(migration));
  ok("3. record_launch_analytics_event is granted to both anon and authenticated (the public site has no login gate)",
     /grant execute on function public\.record_launch_analytics_event\([^)]*\) to anon/.test(migration)
     && /grant execute on function public\.record_launch_analytics_event\([^)]*\) to authenticated/.test(migration));
  ok("4. session_id has no email/PII shape requirement in its column comment — documented as anonymous",
     /session_id is a random per-browser-session id, never an email or user id/i.test(migration));
}

console.log("\nC — launch_analytics_daily: owner-only, never exposed to a public role");
{
  ok("1. the view exists", /create or replace view public\.launch_analytics_daily/i.test(migration));
  ok("2. it is never granted to anon", !/grant[\s\S]{0,60}launch_analytics_daily[\s\S]{0,20}to anon/i.test(migration));
  ok("3. it is never granted to authenticated", !/grant[\s\S]{0,60}launch_analytics_daily[\s\S]{0,20}to authenticated/i.test(migration));
}

console.log("\nD — recordLaunchEvent() against a fake client");
{
  for (const eventType of REQUIRED_EVENT_TYPES) {
    let calledWith = null;
    const fakeClient = { rpc: async (name, args) => { calledWith = { name, args }; return { data: null, error: null }; } };
    await recordLaunchEvent({ client: fakeClient, eventType, sessionId: "s1", path: "/launch" });
    ok(`1.${eventType} is forwarded verbatim as p_event_type`,
       calledWith?.name === "record_launch_analytics_event" && calledWith?.args?.p_event_type === eventType);
  }
  {
    let called = false;
    const fakeClient = { rpc: async () => { called = true; return { data: null, error: null }; } };
    await recordLaunchEvent({ client: fakeClient, eventType: "landing_page_visit", sessionId: null, path: "/launch" });
    ok("2. a missing sessionId short-circuits before calling the RPC at all", called === false);
  }
  {
    const fakeClient = { rpc: async (name, args) => ({ data: null, error: null, __args: args }) };
    let seen = null;
    const wrapped = { rpc: async (name, args) => { seen = args; return fakeClient.rpc(name, args); } };
    await recordLaunchEvent({
      client: wrapped, eventType: "referral_visit", sourceCampaign: "ad01", referralId: "ref-1",
      utmSource: "twitter", utmMedium: "social", utmCampaign: "launch", sessionId: "s1", path: "/launch/ad01",
    });
    ok("3. UTM/referral/source fields are all threaded through to the RPC call",
       seen?.p_source_campaign === "ad01" && seen?.p_referral_id === "ref-1"
       && seen?.p_utm_source === "twitter" && seen?.p_utm_medium === "social" && seen?.p_utm_campaign === "launch");
  }
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
