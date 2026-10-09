-- ============================================================
-- OUTREACH ACTIVATION — INSTITUTIONAL/MEDIA/ORGANIZATIONAL LETTER
-- TRACKING  (Launch Engine, Outreach Activation 1.0)
--
-- THE GAP THIS CLOSES. ElectionCanon has already sent 50+ institutional,
-- media, civic-tech, development, and open-source outreach letters with
-- no system of record: no way to see who was contacted, who replied, who
-- is due a follow-up, or what was learned. This adds exactly three
-- tables for that -- a mutable contact record, an append-only status
-- history, and a mutable follow-up-draft workflow record.
--
-- NOT THE PUBLIC /launch SYSTEM. launch_subscribers/launch_analytics_
-- events (20260921000000_election_launch_distribution.sql) are an
-- anonymous, consent-based, double-opt-in public signup funnel with no
-- named recipients. outreach_contacts is the opposite shape: a small,
-- named, admin-only list of real organizations and real people
-- ElectionCanon already emailed directly. No foreign key, no shared
-- function, no shared table between the two systems. See
-- src/domains/outreach/model.js's own header for the full reasoning.
--
-- NOT ELECTION CANON DATA. No campaign_id, no tenant scope, no
-- event-sourcing discipline -- this is operational/administrative state
-- a human edits directly, exactly like a Campaign Studio design draft or
-- a launch_subscribers row. The one exception is outreach_status_changes,
-- which IS append-only (like launch_analytics_events) because a status
-- change, once recorded, is a fact about what was known at that moment --
-- but it carries no tenant/campaign scope and is not an election Canon
-- fact either.
--
-- ACCESS CONTROL: SAME SHARED-SECRET PATTERN AS launch-invite-audience/
-- launch-send-campaign-email, NOT A NEW AUTH SYSTEM. This data is
-- real-world PII about real contacted people and organizations -- it
-- must never be reachable by anon/authenticated, and there is no
-- existing "product owner" role (distinct from an election tenant
-- member) anywhere in this project to gate a Supabase Auth policy on.
-- Building one here would be new architecture this single admin
-- surface doesn't justify. Instead: RLS is enabled with ZERO client
-- policies on all three tables below (identical posture to
-- launch_subscribers), and every read/write goes through the
-- outreach-admin Edge Function (supabase/functions/outreach-admin/),
-- gated by an OUTREACH_ADMIN_SECRET bearer token exactly like
-- LAUNCH_ADMIN_SECRET gates the two launch admin functions -- see that
-- function's own header.
--
-- sender_account/source_record_ref (Phase 10) RECORD WHICH REAL MAILBOX A
-- LETTER CAME FROM AND WHERE IT CAN STILL BE FOUND. Added for the manual
-- Launch Engine email recovery (Google Takeout verification was blocked):
-- sender_account is closed to the two real outreach accounts plus the
-- honest 'UNKNOWN' default; source_record_ref is free text (a Gmail
-- message id, permalink, or search description) carried forward only when
-- a human actually supplies one -- never fabricated.
--
-- NO AUTOMATIC SENDING. Nothing in this migration, and nothing in the
-- outreach-admin Edge Function, calls any email provider. sent_at/
-- follow_up.sent_at are set only when a human explicitly records that
-- they personally sent a message -- see outreach_followups' own comment
-- below and src/domains/outreach/followup.js's header.
-- ============================================================

-- ---------- outreach_contacts ----------

create table if not exists public.outreach_contacts (
  id                      uuid primary key default gen_random_uuid(),
  organization            text not null check (char_length(organization) between 1 and 200),
  recipient_name          text check (recipient_name is null or char_length(recipient_name) <= 200),
  recipient_email         text not null check (recipient_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  sector                  text not null check (sector in (
                            'media', 'civic_tech', 'democracy_election_org', 'development_org',
                            'open_source_dev', 'institutional_partner', 'other'
                          )),
  country                 text check (country is null or char_length(country) <= 200),
  campaign                text check (campaign is null or char_length(campaign) <= 200),
  letter_version          text check (letter_version is null or char_length(letter_version) <= 200),
  subject                 text check (subject is null or char_length(subject) <= 200),
  sender_account          text not null default 'UNKNOWN' check (sender_account in ('sotinnovate@gmail.com', 'admin@electioncanon.org', 'UNKNOWN')),
  source_record_ref       text check (source_record_ref is null or char_length(source_record_ref) <= 200),
  sent_at                 timestamptz,
  delivery_status         text not null default 'UNKNOWN' check (delivery_status in ('UNKNOWN', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED')),
  engagement_status       text not null default 'UNKNOWN' check (engagement_status in ('UNKNOWN', 'NONE', 'ACKNOWLEDGED')),
  status                  text not null default 'DRAFT' check (status in (
                            'DRAFT', 'SENT', 'DELIVERED', 'ENGAGED', 'RESPONDED', 'FOLLOW_UP_DUE',
                            'CONVERSATION', 'DEMO', 'EDITORIAL_INTEREST', 'PARTNERSHIP_INTEREST',
                            'CONTRIBUTOR_INTEREST', 'PUBLISHED', 'DECLINED', 'NO_RESPONSE', 'BOUNCED'
                          )),
  response_status         text not null default 'UNKNOWN' check (response_status in ('UNKNOWN', 'NONE', 'RESPONDED', 'DECLINED')),
  response_at             timestamptz,
  follow_up_due_at        timestamptz,
  follow_up_count         integer not null default 0 check (follow_up_count >= 0),
  last_contact_at         timestamptz,
  demo_sent               boolean not null default false,
  github_sent             boolean not null default false,
  evidence_package_sent   boolean not null default false,
  conversation_status     text not null default 'NONE' check (conversation_status in ('NONE', 'REQUESTED', 'SCHEDULED', 'ACTIVE', 'ENDED')),
  next_action             text check (next_action is null or char_length(next_action) <= 4000),
  notes                   text check (notes is null or char_length(notes) <= 4000),
  source_of_truth         text not null check (source_of_truth in ('MANUAL_IMPORT', 'MANUAL_ENTRY', 'INBOUND_REPLY')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists outreach_contacts_email_idx on public.outreach_contacts (lower(recipient_email));
create index if not exists outreach_contacts_status_idx on public.outreach_contacts (status);
create index if not exists outreach_contacts_sector_idx on public.outreach_contacts (sector);
create index if not exists outreach_contacts_follow_up_due_idx on public.outreach_contacts (follow_up_due_at) where follow_up_due_at is not null;

comment on table public.outreach_contacts is
  'One row per real organization/recipient ElectionCanon has contacted for institutional/media/civic-tech/open-source outreach. Mutable administrative record, not a Canon fact, not part of the public launch_subscribers funnel -- see this migration''s own header. No client select/insert/update policy exists; every read/write is through the outreach-admin Edge Function (OUTREACH_ADMIN_SECRET bearer gate).';

alter table public.outreach_contacts enable row level security;
-- No policy of any kind for any client role, deliberately -- see header.

-- ---------- outreach_status_changes ----------
-- Append-only history of outreach_contacts.status changes, mirroring
-- launch_analytics_events' own append-only shape. Written once per
-- transition, alongside (never instead of) the status column update on
-- outreach_contacts itself -- this table is the audit trail, not the
-- live value a reader queries for "what is this contact's status now."

create table if not exists public.outreach_status_changes (
  id            bigint generated always as identity primary key,
  contact_id    uuid not null references public.outreach_contacts (id) on delete cascade,
  from_status   text not null,
  to_status     text not null,
  changed_at    timestamptz not null default now(),
  note          text check (note is null or char_length(note) <= 2000)
);

create index if not exists outreach_status_changes_contact_idx on public.outreach_status_changes (contact_id, changed_at);

comment on table public.outreach_status_changes is
  'Append-only history of outreach_contacts.status transitions -- "preserve a history of status changes" (Phase 3). Written only by the outreach-admin Edge Function alongside the corresponding outreach_contacts update, never edited or deleted after insert.';

alter table public.outreach_status_changes enable row level security;
-- No policy of any kind -- see header.

-- ---------- outreach_followups ----------
-- DRAFT -> REVIEW -> APPROVED -> SENT workflow record (Phase 8). SENT
-- here means a human has attested they personally sent this message --
-- this table has no column and no function anywhere that calls an email
-- provider. See src/domains/outreach/followup.js's own header.

create table if not exists public.outreach_followups (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references public.outreach_contacts (id) on delete cascade,
  asset_code     text not null check (asset_code in (
                   'A_INSTITUTIONAL_FOLLOWUP', 'B_CIVIC_TECH_FOLLOWUP', 'C_MEDIA_FOLLOWUP',
                   'D_OPEN_SOURCE_FOLLOWUP', 'E_ACKNOWLEDGEMENT_FOLLOWUP',
                   'F_DEMO_REQUEST_RESPONSE', 'G_CONVERSATION_REQUEST_RESPONSE'
                 )),
  subject        text not null check (char_length(subject) between 1 and 300),
  body           text not null check (char_length(body) between 1 and 8000),
  state          text not null default 'DRAFT' check (state in ('DRAFT', 'REVIEW', 'APPROVED', 'SENT', 'CANCELLED')),
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  approved_at    timestamptz,
  approved_by    text check (approved_by is null or char_length(approved_by) <= 200),
  sent_at        timestamptz,
  cancelled_at   timestamptz
);

create index if not exists outreach_followups_contact_idx on public.outreach_followups (contact_id, created_at);
create index if not exists outreach_followups_state_idx on public.outreach_followups (state);

comment on table public.outreach_followups is
  'DRAFT -> REVIEW -> APPROVED -> SENT follow-up drafts (Phase 8/9). "SENT" is a human attestation that they personally sent the message through their own mail client -- no automatic sending exists anywhere in this schema or in outreach-admin/index.ts. No client select/insert/update policy exists; every read/write is through the outreach-admin Edge Function.';

alter table public.outreach_followups enable row level security;
-- No policy of any kind -- see header.
