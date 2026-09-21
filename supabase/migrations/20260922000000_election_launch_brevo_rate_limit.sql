-- ============================================================
-- LAUNCH DISTRIBUTION — SIGNUP RATE LIMITING  (Alpha 1.7, Brevo pass)
--
-- THE GAP THIS CLOSES. launch-subscribe (supabase/functions/launch-
-- subscribe/) is a fully public, unauthenticated endpoint -- anyone can
-- call it with an arbitrary email. Before this migration nothing
-- prevented a script from hammering it (mail-bombing a victim address
-- with repeated confirmation emails, or brute-forcing signups to probe
-- which addresses already exist despite the generic {ok:true} response
-- -- see that function's own header on why it never distinguishes).
--
-- WHY A TABLE, NOT A THIRD-PARTY RATE LIMITER. This repository has no
-- API gateway in front of Supabase Edge Functions (see App.jsx/
-- vercel.json -- Vercel serves the static SPA only). A small, service-
-- role-only table that launch-subscribe's own Edge Function reads and
-- writes directly is the same "no new architecture" reasoning every
-- other operational-state table in this project already follows.
--
-- WHY NO SECURITY DEFINER FUNCTION, UNLIKE launch_subscribers'/
-- launch_analytics_events' write paths. Those tables are written from
-- multiple contexts (an RPC callable by anon, or a function needing
-- validation logic worth unit-testing). This table has exactly ONE
-- writer -- launch-subscribe/index.ts's own service-role client, which
-- already holds full privilege by construction (see that function's own
-- header on why service role is safe there) -- so a wrapping function
-- would add indirection without adding any actual access control.
--
-- WHY NO CLIENT POLICY AT ALL. Same posture as launch_subscribers: RLS
-- is enabled with zero policies, so only the service role (which
-- bypasses RLS entirely) can ever read or write this table. anon/
-- authenticated have no path to it, direct or otherwise.
--
-- RETENTION. No cron/cleanup job exists yet for old attempt rows --
-- honestly out of scope for this pass (the table is small: one row per
-- signup attempt, and only the trailing-10-minute window is ever
-- queried). A future pass can add a scheduled prune; not fabricated
-- here.
-- ============================================================

create table if not exists public.launch_subscribe_attempts (
  id            bigint generated always as identity primary key,
  ip            text not null check (char_length(ip) <= 64),
  attempted_at  timestamptz not null default now()
);

create index if not exists launch_subscribe_attempts_ip_idx on public.launch_subscribe_attempts (ip, attempted_at);

comment on table public.launch_subscribe_attempts is
  'Rate-limit ledger for the public launch-subscribe Edge Function. Written and read ONLY by that function''s own service-role client -- RLS enabled, zero policies, no client (anon/authenticated) path exists. Not PII: never joined to launch_subscribers, never exposed in any API response.';

alter table public.launch_subscribe_attempts enable row level security;
-- No policy of any kind, deliberately -- see header.
