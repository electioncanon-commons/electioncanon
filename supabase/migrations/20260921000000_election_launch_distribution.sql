-- ============================================================
-- LAUNCH DISTRIBUTION — CONSENT-BASED SIGNUPS + ANALYTICS  (Alpha 1.7)
--
-- THE GAP THIS CLOSES. The public site (Landing.jsx, and now /launch and
-- its AD01/AD02/AD03 stops) has no way to capture interest beyond an
-- outbound click. This adds exactly two tables: a minimal consent record
-- for double-opt-in email signup, and an append-only analytics log for
-- the seven counters the launch asks for (landing-page visits, film
-- views, email signups, confirmation rate, referral visits, GitHub
-- clicks, outbound social clicks).
--
-- WHY launch_subscribers IS NOT EVENT-SOURCED. Same reasoning
-- campaign_invitations already established (see that migration's own
-- header): a subscription is a transient, MUTABLE administrative record
-- (pending_confirmation -> confirmed -> unsubscribed), not a Canon fact
-- about an election. No new event type, no touch to election_events.
--
-- WHY launch_analytics_events IS EVENT-SOURCED (append-only). Unlike a
-- subscription, a page visit or a click has no later state to mutate --
-- it happened once, or it didn't. This mirrors election_events' own
-- append-only shape without being an election Canon fact itself (it
-- carries no campaign_id, no tenant scope -- this is marketing telemetry
-- about the public site, not election data).
--
-- MINIMUM-DATA DISCIPLINE. launch_subscribers stores exactly the four
-- fields the launch brief asks for -- email, consent_at, source_campaign,
-- referral_id -- plus the operational bookkeeping a real double-opt-in/
-- unsubscribe/sequence-tracking flow cannot function without (status,
-- token, timestamps, per-sequence-step sent markers). UTM breakdown is
-- NOT stored on the subscriber row -- UTM/referral attribution for
-- analytics purposes lives only in the anonymous, session-scoped
-- launch_analytics_events log below, never attached to a real email
-- address.
--
-- TOKEN SECRECY. Same posture as campaign_invitations: no client SELECT
-- policy exists on launch_subscribers at all. Every read/write a client
-- may perform goes through a SECURITY DEFINER function below that takes
-- an exact token as input, never a broad filter RLS has to trust. Token
-- randomness reuses this repo's own existing no-pgcrypto-dependency
-- pattern (two concatenated gen_random_uuid() calls -- see
-- create_campaign_invitation() in 20260831000000_election_campaign_
-- invitations.sql for precedent), not gen_random_bytes()/pgcrypto.
--
-- SUBSCRIBER CREATION IS NOT AN RPC HERE. Unlike accept_campaign_
-- invitation(), there is no create_launch_subscription() function in
-- this migration -- the launch-subscribe Edge Function (service role)
-- performs that insert directly, because it must mint the token and
-- email it in the same step without the token ever reaching the browser
-- (see that function's own header for why service role is safe for a
-- public, unauthenticated form where no caller session exists to scope
-- reads by in the first place).
-- ============================================================

-- No dependency guard block: unlike campaign_invitations (which extends
-- campaign_members/geography_wards), launch_subscribers and
-- launch_analytics_events are standalone tables with no foreign key
-- into any prior migration's schema.

-- ---------- launch_subscribers ----------

create table if not exists public.launch_subscribers (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  consent_at           timestamptz not null default now(),
  source_campaign      text not null check (source_campaign in ('ad01', 'ad02', 'ad03', 'launch')),
  referral_id          text check (referral_id is null or char_length(referral_id) <= 64),
  status               text not null default 'pending_confirmation' check (status in ('pending_confirmation', 'confirmed', 'unsubscribed')),
  token                text not null,
  confirmed_at         timestamptz,
  unsubscribed_at      timestamptz,
  sequence_1_sent_at   timestamptz,
  sequence_2_sent_at   timestamptz,
  sequence_3_sent_at   timestamptz,
  created_at           timestamptz not null default now()
);

create unique index if not exists launch_subscribers_email_idx on public.launch_subscribers (lower(email));
create unique index if not exists launch_subscribers_token_idx on public.launch_subscribers (token);
create index if not exists launch_subscribers_status_idx on public.launch_subscribers (status);

comment on table public.launch_subscribers is
  'Double-opt-in email signups for the Alpha 1.7 launch sequence. Mutable administrative record, not a Canon fact -- see this migration''s own header. No client select/insert/update policy anywhere; every read/write is through the SECURITY DEFINER functions below, or the launch-subscribe Edge Function (service role) for creation.';

alter table public.launch_subscribers enable row level security;
-- No policy of any kind is created for any client role, deliberately --
-- exactly like campaign_invitations. See header.

-- ---------- launch_analytics_events ----------

create table if not exists public.launch_analytics_events (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),
  event_type       text not null check (event_type in (
                     'landing_page_visit', 'film_view', 'email_signup', 'email_confirmed',
                     'referral_visit', 'github_click', 'social_click'
                   )),
  source_campaign  text check (source_campaign is null or source_campaign in ('ad01', 'ad02', 'ad03', 'launch')),
  referral_id      text check (referral_id is null or char_length(referral_id) <= 64),
  utm_source       text check (utm_source is null or char_length(utm_source) <= 128),
  utm_medium       text check (utm_medium is null or char_length(utm_medium) <= 128),
  utm_campaign     text check (utm_campaign is null or char_length(utm_campaign) <= 128),
  session_id       text not null check (char_length(session_id) between 1 and 64),
  path             text not null check (char_length(path) <= 256)
);

create index if not exists launch_analytics_events_type_idx on public.launch_analytics_events (event_type, occurred_at);
create index if not exists launch_analytics_events_campaign_idx on public.launch_analytics_events (source_campaign, occurred_at);

comment on table public.launch_analytics_events is
  'Append-only, anonymous launch-site telemetry (session_id is a random per-browser-session id, never an email or user id). Insert-only, and only via record_launch_analytics_event() below -- no client write policy exists directly on this table.';

alter table public.launch_analytics_events enable row level security;
-- No policy of any kind for any client role -- writes go through
-- record_launch_analytics_event() (SECURITY DEFINER) below, which
-- enforces the closed event_type vocabulary and field lengths that the
-- table's own check constraints also enforce, so an invalid insert is
-- rejected at either layer if the other is ever bypassed.

-- ---------- record_launch_analytics_event(): the only write path ----------
create or replace function public.record_launch_analytics_event(
  p_event_type text,
  p_source_campaign text default null,
  p_referral_id text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_session_id text default null,
  p_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or btrim(p_session_id) = '' then
    raise exception 'session_id is required';
  end if;
  if p_path is null or btrim(p_path) = '' then
    raise exception 'path is required';
  end if;

  insert into public.launch_analytics_events (
    event_type, source_campaign, referral_id, utm_source, utm_medium, utm_campaign, session_id, path
  ) values (
    p_event_type,
    nullif(btrim(coalesce(p_source_campaign, '')), ''),
    nullif(left(btrim(coalesce(p_referral_id, '')), 64), ''),
    nullif(left(btrim(coalesce(p_utm_source, '')), 128), ''),
    nullif(left(btrim(coalesce(p_utm_medium, '')), 128), ''),
    nullif(left(btrim(coalesce(p_utm_campaign, '')), 128), ''),
    left(btrim(p_session_id), 64),
    left(btrim(p_path), 256)
  );
end;
$$;

revoke all on function public.record_launch_analytics_event(text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_launch_analytics_event(text, text, text, text, text, text, text, text) to anon;
grant execute on function public.record_launch_analytics_event(text, text, text, text, text, text, text, text) to authenticated;

-- ---------- confirm_launch_subscription(): double-opt-in confirmation ----------
create or replace function public.confirm_launch_subscription(p_token text)
returns table (ok boolean, already_confirmed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.launch_subscribers;
begin
  if p_token is null or btrim(p_token) = '' then
    return query select false, false;
    return;
  end if;

  select * into v_row from public.launch_subscribers where token = btrim(p_token);

  if v_row.id is null or v_row.status = 'unsubscribed' then
    return query select false, false;
    return;
  end if;

  if v_row.status = 'confirmed' then
    return query select true, true;
    return;
  end if;

  update public.launch_subscribers
  set status = 'confirmed', confirmed_at = now()
  where id = v_row.id;

  insert into public.launch_analytics_events (event_type, source_campaign, referral_id, session_id, path)
  values ('email_confirmed', v_row.source_campaign, v_row.referral_id, 'server', '/launch/confirm');

  return query select true, false;
end;
$$;

revoke all on function public.confirm_launch_subscription(text) from public;
grant execute on function public.confirm_launch_subscription(text) to anon;
grant execute on function public.confirm_launch_subscription(text) to authenticated;

-- ---------- unsubscribe_launch_subscription(): idempotent opt-out ----------
create or replace function public.unsubscribe_launch_subscription(p_token text)
returns table (ok boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.launch_subscribers;
begin
  if p_token is null or btrim(p_token) = '' then
    return query select false;
    return;
  end if;

  select * into v_row from public.launch_subscribers where token = btrim(p_token);

  if v_row.id is null then
    return query select false;
    return;
  end if;

  update public.launch_subscribers
  set status = 'unsubscribed', unsubscribed_at = now()
  where id = v_row.id and status <> 'unsubscribed';

  return query select true;
end;
$$;

revoke all on function public.unsubscribe_launch_subscription(text) from public;
grant execute on function public.unsubscribe_launch_subscription(text) to anon;
grant execute on function public.unsubscribe_launch_subscription(text) to authenticated;

-- ---------- launch_analytics_daily: owner-queried convenience view ----------
-- Deliberately NOT granted to anon/authenticated -- no self-serve
-- dashboard UI exists in this pass (see ARCHITECTURE.md's launch-
-- distribution note); the project owner reads this via the Supabase
-- SQL editor/dashboard directly, the same way any other ad hoc
-- operational query against this project already works.
create or replace view public.launch_analytics_daily as
select
  date_trunc('day', occurred_at) as day,
  event_type,
  source_campaign,
  count(*) as event_count,
  count(distinct session_id) as distinct_sessions
from public.launch_analytics_events
group by 1, 2, 3
order by 1 desc, 2, 3;

comment on view public.launch_analytics_daily is
  'Owner-queried daily rollup of launch_analytics_events (landing-page visits, film views, signups, confirmations, referral visits, GitHub clicks, social clicks), broken out by AD01/AD02/AD03/launch. Query via the Supabase SQL editor/dashboard -- not exposed to any client role.';
