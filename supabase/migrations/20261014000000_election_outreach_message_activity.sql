-- ============================================================
-- OUTREACH ACTIVATION — MESSAGE ACTIVITY + GMAIL CONNECTION  (Launch
-- Engine closed-loop, Phase 1)
--
-- THE GAP THIS CLOSES. Until now, "SENT" on outreach_contacts/
-- outreach_followups is a single mutable status set by a human
-- attestation -- there is no record of the ACTUAL evidence (a provider
-- message id, a thread id, a timestamp) backing that claim, and no way
-- to represent "a reply arrived" or "a message is merely drafted" as
-- distinct, truthful facts. This migration adds exactly the two
-- additive pieces the closed-loop brief asks for: a message-activity
-- ledger, and a place to hold one Gmail OAuth connection. It changes
-- NOTHING about the existing pipeline/followup status columns or their
-- transition graphs -- those remain the business-outcome source of
-- truth; this is the evidence layer underneath them.
--
-- WHY A SEPARATE TABLE, NOT A NEW COLUMN ON outreach_contacts/
-- outreach_followups. A contact or follow-up can accumulate MULTIPLE
-- message events over its life (prepared, then sent, then a reply,
-- maybe a second follow-up later) -- exactly the append-only shape
-- outreach_status_changes already uses for status transitions, applied
-- here to message-level (not pipeline-level) facts. One mutable column
-- cannot hold more than one fact at a time; this can.
--
-- THE FOUR STATES, REPRESENTED HONESTLY.
--   1. MESSAGE PREPARED  -> a row with activity_state = 'PREPARED'.
--   2. MESSAGE SENT       -> a row with activity_state = 'SENT', always
--      carrying a provider ('GMAIL' or 'MANUAL_ATTESTATION') and,
--      for GMAIL, a provider_message_id -- never fabricated, never
--      inferred from a 2xx response alone without a real id.
--   3. REPLY RECEIVED     -> a row with direction = 'INBOUND' and
--      activity_state = 'SENT' is meaningless for an inbound row -- see
--      the check constraint below, which requires direction='INBOUND'
--      rows to always be activity_state='REPLY_RECEIVED'.
--   4. FOLLOW-UP COMPLETED is NOT a fourth activity_state here -- it
--      remains outreach_followups.state = 'SENT', exactly as before,
--      but a human-reviewable UI should now require a linked OUTBOUND/
--      SENT message_events row (gmail_message_id present, or an
--      explicit MANUAL_ATTESTATION row) to exist before showing a
--      follow-up as actually completed, rather than trusting the bare
--      status column alone. That UI rule lives in the application
--      layer (OutreachControlRoom.jsx) -- this migration only makes the
--      evidence available to query.
--
-- IDEMPOTENCY IS A UNIQUE INDEX, NOT APPLICATION DISCIPLINE ALONE.
-- idempotency_key is UNIQUE -- a retry after a timeout that reconstructs
-- the exact same key (e.g. "gmail:<message_id>", or a caller-supplied
-- confirmation id for a fresh send) can never insert a second row no
-- matter how many times the Edge Function layer is retried. See
-- supabase/functions/outreach-admin/contract.mjs's
-- validateRecordMessageEventRequest() for how that key is built.
--
-- MATCH CONFIDENCE REUSES src/domains/outreach/reconcile.js's EXISTING
-- DISCIPLINE (exact evidence promotes, everything else needs a human) --
-- match_confidence is NEEDS_REVIEW for any inbound row whose thread/
-- message-id evidence was ambiguous; no row is ever silently upgraded.
--
-- SAME ACCESS POSTURE AS EVERY OTHER TABLE IN THIS SUBSYSTEM: RLS
-- enabled, ZERO client policies, every read/write through the
-- outreach-admin Edge Function (OUTREACH_ADMIN_SECRET bearer gate).
-- ============================================================

-- ---------- sector vocabulary extension (additive, no row rewritten) ----------
-- Adds political-office categories the closed-loop brief's Workspace B
-- asks for (governorship, Senate, House of Representatives, State House
-- of Assembly, presidential, and a generic party-secretariat bucket for
-- the office-mediated-only channels already in the 2027 candidate
-- research register). Every existing row's sector value is untouched --
-- this only widens the set of values a NEW row may use.
alter table public.outreach_contacts drop constraint if exists outreach_contacts_sector_check;
alter table public.outreach_contacts add constraint outreach_contacts_sector_check check (sector in (
  'media', 'civic_tech', 'democracy_election_org', 'development_org',
  'open_source_dev', 'institutional_partner', 'other',
  'presidential_campaign', 'governorship_campaign', 'senate_campaign',
  'house_of_reps_campaign', 'state_assembly_campaign', 'party_secretariat'
));

-- ---------- outreach_message_events ----------

create table if not exists public.outreach_message_events (
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references public.outreach_contacts (id) on delete cascade,
  followup_id          uuid references public.outreach_followups (id) on delete cascade,
  direction            text not null check (direction in ('OUTBOUND', 'INBOUND')),
  activity_state       text not null check (activity_state in ('PREPARED', 'SENT', 'REPLY_RECEIVED')),
  provider             text not null check (provider in ('GMAIL', 'BREVO', 'MANUAL_ATTESTATION')),
  provider_message_id  text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  provider_thread_id   text check (provider_thread_id is null or char_length(provider_thread_id) <= 200),
  rfc_message_id       text check (rfc_message_id is null or char_length(rfc_message_id) <= 500),
  in_reply_to          text check (in_reply_to is null or char_length(in_reply_to) <= 500),
  references_header    text check (references_header is null or char_length(references_header) <= 2000),
  sender_identity       text check (sender_identity is null or sender_identity in ('sotinnovate@gmail.com', 'admin@electioncanon.org', 'UNKNOWN')),
  recipient_email      text check (recipient_email is null or char_length(recipient_email) <= 320),
  subject              text check (subject is null or char_length(subject) <= 300),
  occurred_at          timestamptz not null default now(),
  match_confidence     text not null default 'HIGH_CONFIDENCE' check (match_confidence in ('HIGH_CONFIDENCE', 'NEEDS_REVIEW')),
  idempotency_key       text not null check (char_length(idempotency_key) between 1 and 300),
  created_at           timestamptz not null default now(),

  -- An INBOUND row is always the reply-received fact -- there is no such
  -- thing as an inbound "prepared" or an inbound "sent" draft of someone
  -- else's message.
  constraint outreach_message_events_inbound_state check (
    direction <> 'INBOUND' or activity_state = 'REPLY_RECEIVED'
  ),
  -- A real send/receive claim (SENT or REPLY_RECEIVED) from a live
  -- provider must carry at least one piece of real provider evidence --
  -- never a bare claim with nothing behind it. MANUAL_ATTESTATION is the
  -- one deliberate exception (a human-recorded manual send has no
  -- provider id by definition), and PREPARED rows never claim to have
  -- happened at all.
  constraint outreach_message_events_evidence_required check (
    activity_state = 'PREPARED'
    or provider = 'MANUAL_ATTESTATION'
    or provider_message_id is not null
  )
);

create unique index if not exists outreach_message_events_idempotency_idx on public.outreach_message_events (idempotency_key);
create index if not exists outreach_message_events_contact_idx on public.outreach_message_events (contact_id, occurred_at);
create index if not exists outreach_message_events_followup_idx on public.outreach_message_events (followup_id) where followup_id is not null;
create index if not exists outreach_message_events_thread_idx on public.outreach_message_events (provider_thread_id) where provider_thread_id is not null;
create index if not exists outreach_message_events_rfc_idx on public.outreach_message_events (rfc_message_id) where rfc_message_id is not null;

comment on table public.outreach_message_events is
  'Append-only evidence ledger for the four truthful message states (PREPARED/SENT/REPLY_RECEIVED, plus outreach_followups.state=SENT for the fourth). Idempotent via a unique idempotency_key -- a retried send/sync can never double-insert. No client select/insert/update policy exists; every read/write is through the outreach-admin Edge Function.';

alter table public.outreach_message_events enable row level security;
-- No policy of any kind for any client role, deliberately -- see header.

-- ---------- outreach_message_send_claims (Phase 11 audit fix H-1) ----------
--
-- THE RACE THIS CLOSES. outreach_message_events.idempotency_key being
-- UNIQUE stops a duplicate ROW -- it does not stop a duplicate Gmail
-- SEND, because the old send_message code checked for an existing event
-- (SELECT), then separately called Gmail, then inserted the event
-- (INSERT) -- a classic check-then-act race. Two concurrent requests
-- carrying the identical idempotency key could both pass the SELECT
-- before either INSERTed, and both reach Gmail's real send endpoint.
--
-- THE FIX: a SEPARATE, narrow table whose only job is to be the ATOMIC
-- claim. outreach-gmail/index.ts's send_message now does ONE INSERT into
-- this table BEFORE ever calling Gmail. The unique index on
-- idempotency_key makes that insert itself the race-free gate -- exactly
-- one request can ever hold the claim for a given key; every other
-- concurrent or later request with the same key gets a unique-violation
-- and must read the existing claim's status rather than proceeding.
--
-- WHY NOT JUST REUSE outreach_message_events FOR THIS. That table's own
-- outreach_message_events_evidence_required constraint exists precisely
-- to guarantee "a SENT row always carries real provider evidence." A
-- claim, by definition, exists BEFORE that evidence can possibly exist
-- (status='CLAIMED', nothing sent yet). Loosening that constraint to
-- accommodate a claim would weaken the exact guarantee that makes
-- outreach_message_events trustworthy. Keeping claim-lifecycle state in
-- its own table means outreach_message_events' invariant is untouched --
-- a row is inserted there ONLY after a real, evidenced send succeeds.
--
-- THE FOUR CLAIM STATES.
--   CLAIMED  -- a request currently owns this exact send attempt (or
--      died without resolving it -- see "lease expiry" below).
--   SENT     -- resolved: Gmail confirmed the send with a real message
--      id, now mirrored into outreach_message_events.
--   FAILED   -- resolved: Gmail (or a pre-flight check, e.g. an
--      unverified sender identity) gave a DEFINITE negative answer.
--      Nothing was sent. Recorded permanently so the SAME idempotency
--      key is never silently retried -- a genuinely new attempt must use
--      a new confirmationId (and therefore a new key).
--   UNKNOWN  -- NOT resolved: the outcome could not be determined (the
--      network call to Gmail itself failed/timed out, or the Edge
--      Function process was killed outright mid-send -- see below).
--      Never auto-retried under the same key. Requires a human to check
--      the connected mailbox's real Sent folder and call
--      reconcile_send_claim with what they actually found.
--
-- LEASE EXPIRY HANDLES THE CASE A try/catch CANNOT: OUTRIGHT PROCESS
-- DEATH. A try/catch around the Gmail fetch call correctly catches a
-- network error/timeout and marks the claim UNKNOWN. It canNOT run at
-- all if the Edge Function's execution is killed by a platform-level
-- timeout or crash between claiming and resolving -- no code executes,
-- the claim row is simply left at status='CLAIMED' forever. This is why
-- claimed_at exists: when a LATER request hits the same idempotency key
-- and finds a CLAIMED row, index.ts checks its age against a lease
-- window (CLAIM_LEASE_MINUTES, contract.mjs) -- a claim older than the
-- lease is transitioned to UNKNOWN right then (lazy expiry on next
-- contact, no cron needed, same "honestly out of scope for now" posture
-- launch_subscribe_attempts' own header already takes on scheduled
-- cleanup) and the caller is refused with NEEDS_RECONCILIATION rather
-- than being allowed to silently attempt a second real send.
--
-- A FAILED CLAIM CAN NEVER CAUSE A SECOND SEND. Once a key resolves to
-- SENT, FAILED, or UNKNOWN, index.ts never calls Gmail again under that
-- same key -- every one of those three terminal-or-needs-reconciliation
-- states is handled by returning to the caller, never by falling
-- through to the send code path a second time.
create table if not exists public.outreach_message_send_claims (
  id                   uuid primary key default gen_random_uuid(),
  idempotency_key      text not null check (char_length(idempotency_key) between 1 and 300),
  contact_id           uuid not null references public.outreach_contacts (id) on delete cascade,
  followup_id          uuid references public.outreach_followups (id) on delete cascade,
  status               text not null default 'CLAIMED' check (status in ('CLAIMED', 'SENT', 'FAILED', 'UNKNOWN')),
  provider_message_id  text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  provider_thread_id   text check (provider_thread_id is null or char_length(provider_thread_id) <= 200),
  error                text check (error is null or char_length(error) <= 2000),
  claimed_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  updated_at           timestamptz not null default now()
);

create unique index if not exists outreach_message_send_claims_idempotency_idx on public.outreach_message_send_claims (idempotency_key);
create index if not exists outreach_message_send_claims_status_idx on public.outreach_message_send_claims (status, claimed_at);

comment on table public.outreach_message_send_claims is
  'Atomic ownership/lifecycle record for one send_message attempt (Phase 11 audit fix H-1) -- CLAIMED/SENT/FAILED/UNKNOWN. The unique index on idempotency_key, combined with a single INSERT performed BEFORE any Gmail call, is the actual concurrency guard; outreach_message_events is never written to until a claim resolves to SENT with real evidence. No client select/insert/update policy exists; every read/write is through the outreach-gmail Edge Function.';

alter table public.outreach_message_send_claims enable row level security;
-- No policy of any kind for any client role, deliberately -- see header.

-- ---------- outreach_send_claim_inconsistencies (Phase 11B evidence-repair detectability) ----------
-- Owner-queried diagnostic view, same posture as launch_analytics_daily
-- (20260921000000_election_launch_distribution.sql) -- not exposed to any
-- client role, queried via the Supabase SQL editor/dashboard directly.
-- Surfaces exactly the two inconsistency shapes Phase 11B's evidence-first
-- write ordering can leave behind if a write is interrupted between the
-- two independent persistence steps: a claim resolved to SENT with no
-- matching evidence row (repairable via reconcile_send_claim's
-- REPAIR_MISSING_EVIDENCE path, using the claim's own already-recorded
-- provider_message_id -- never by sending anything again), or an evidence
-- row that exists while its claim has not yet caught up to SENT (which
-- classifyExistingClaim's own evidence-aware check already treats as a
-- real, resolved send on every subsequent read -- this view exists so a
-- human can also see it directly, not because the system is broken
-- without it).
create or replace view public.outreach_send_claim_inconsistencies as
select
  c.id as claim_id, c.idempotency_key, c.contact_id, c.followup_id, c.status as claim_status,
  c.provider_message_id as claim_provider_message_id, c.claimed_at, c.resolved_at,
  e.id as event_id, e.provider_message_id as event_provider_message_id
from public.outreach_message_send_claims c
left join public.outreach_message_events e on e.idempotency_key = c.idempotency_key
where
  (c.status = 'SENT' and e.id is null)
  or (e.id is not null and c.status is distinct from 'SENT');

comment on view public.outreach_send_claim_inconsistencies is
  'Phase 11B diagnostic: claim/evidence pairs that have not (yet, or due to an interrupted write) converged. Not exposed to any client role -- query via the Supabase SQL editor/dashboard, the same way launch_analytics_daily already is.';

-- ---------- outreach_gmail_connection ----------
-- At most one row is ever expected to exist (the one authorized mailbox
-- this project sends direct outreach from) -- enforced by convention in
-- the Edge Function layer (always read/upsert the single row), not by a
-- database constraint, since a hard singleton constraint would add
-- complexity this one-admin-surface table doesn't need.

create table if not exists public.outreach_gmail_connection (
  id                     uuid primary key default gen_random_uuid(),
  google_account_email   text not null check (char_length(google_account_email) <= 320),
  send_as_identity       text not null default 'UNKNOWN' check (send_as_identity in ('admin@electioncanon.org', 'sotinnovate@gmail.com', 'UNKNOWN')),
  send_as_verified       boolean not null default false,
  refresh_token_encrypted text,
  scopes                 text[] not null default '{}'::text[],
  history_id             text,
  last_sync_at           timestamptz,
  last_sync_status       text not null default 'NEVER_SYNCED' check (last_sync_status in ('NEVER_SYNCED', 'OK', 'ERROR', 'TOKEN_REVOKED')),
  last_sync_error        text check (last_sync_error is null or char_length(last_sync_error) <= 2000),
  -- CSRF-protection nonce for the OAuth2 authorization-code round trip
  -- (outreach-gmail/index.ts's get_auth_url/oauth_callback actions).
  -- Cleared immediately once a callback consumes it successfully.
  pending_oauth_state           text,
  pending_oauth_state_expires_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.outreach_gmail_connection is
  'Holds the one authorized Gmail OAuth connection for direct-outreach dispatch/reconciliation. refresh_token_encrypted is as sensitive as a service-role key -- never selected into any Edge Function response, ever. send_as_verified must be true before outreach-admin allows a real dispatch through this identity (Phase 4''s explicit requirement). No client select/insert/update policy exists; every read/write is through the outreach-admin Edge Function, and the refresh token column is never returned by any action.';

alter table public.outreach_gmail_connection enable row level security;
-- No policy of any kind -- see header.
