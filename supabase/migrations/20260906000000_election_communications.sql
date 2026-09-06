-- ============================================================
-- ELECTIONCANON — GATE A.5.1: COMMUNICATION OBJECT MODEL
--
-- Foundational schema only. No channel_variants, no publications, no
-- schedules, no measurement — those are later A.5.x gates (see the Gate
-- A.5 architecture reconnaissance report). This migration adds exactly
-- five things: communications, communication_assets (a join table to
-- existing campaign_studio_assets), language_variants, reviews, approvals.
--
-- DRAFTING vs GOVERNANCE, mirrored from this project's own documented
-- write discipline (docs/ARCHITECTURE.md: immutable Canon facts vs
-- "operational state that doesn't fit an immutable-log shape" — chat
-- messages, Campaign Studio drafts). communications/language_variants are
-- the SECOND category: mutable, RLS-CRUD, exactly like campaign_studio_
-- assets already is. reviews/approvals are governance records: insert +
-- own-row-update only, no delete, no cross-person edit — the append-only
-- spirit of the first category, without inventing a second event log for
-- what is still fundamentally a small, per-row workflow fact.
--
-- CAMPAIGN ISOLATION, ENFORCED AT THE DATABASE LEVEL, NOT JUST BY RLS.
-- Every child table below carries its OWN campaign_id (the same
-- denormalization campaign_chat_messages already established for exactly
-- this reason) AND a COMPOSITE foreign key of the shape
-- (parent_ref, campaign_id) -> parent(id, campaign_id) — one step
-- STRICTER than campaign_chat_messages' plain independent-FK precedent.
-- This is a deliberate strengthening, not an invented foreign pattern: it
-- makes "a Communication from Campaign A attaches an asset belonging to
-- Campaign B" a database-level impossibility rather than an RLS/
-- application-discipline expectation, because communication_assets is a
-- genuine junction between TWO independently campaign-scoped entities
-- (a communication and a pre-existing studio asset) — the one place in
-- this schema where a cross-tenant mix-up could otherwise slip past RLS
-- (RLS gates who may write a row; it does not, by itself, verify that two
-- foreign ids embedded in that row's own columns agree with each other).
-- campaign_studio_assets gains one new, purely additive unique index
-- (id, campaign_id) to make it a valid composite-FK target; nothing about
-- its existing columns, policies, or behaviour changes.
--
-- DRAFTER =/= REVIEWER / APPROVER, ENFORCED SERVER-SIDE, NOT ONLY IN THE
-- UI. Both the reviews and approvals INSERT policies independently
-- re-read language_variants.created_by (the variant's own author — the
-- precise person native review exists to check, not merely whoever
-- created the parent Communication) and refuse a reviewer/approver whose
-- auth.uid() matches it. This is the SAME "never trust the client, always
-- re-verify server-side" discipline PREPARE/APPROVE already applies to
-- every Canon-fact write in this project — applied here to a workflow
-- fact instead of an event.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. It does not restrict
-- approval to owner/manager (Approval's insert policy only requires
-- active membership + non-self-approval for A.5.1 — see this file's own
-- comment on the approvals policy for exactly what is deferred to A.5.2).
-- It does not model a "who may review which language" roster. It does
-- not touch responsibility_slots, geography, RLS on any EXISTING table
-- beyond the one additive index on campaign_studio_assets, or Mobilize.
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'campaigns') then
    raise exception 'Table public.campaigns does not exist. Apply 20260823000000_campaign_membership.sql first.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'is_active_campaign_member') then
    raise exception 'Function public.is_active_campaign_member does not exist. Apply 20260826000000_fix_campaign_members_rls_recursion.sql first.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'campaign_studio_assets') then
    raise exception 'Table public.campaign_studio_assets does not exist. Apply 20260827000000_election_forge_chat_and_studio.sql first.';
  end if;
end $$;

-- ---------- campaign_studio_assets: one additive index, no other change ----------
-- Required so communication_assets (below) can hold a composite foreign key
-- proving an attached asset's campaign_id genuinely matches the owning
-- Communication's campaign_id. Adds no column, changes no policy, and does
-- not alter a single existing row.
create unique index if not exists campaign_studio_assets_id_campaign_uidx on campaign_studio_assets(id, campaign_id);

-- ---------- communications: the canonical communication work item ----------
-- NOT itself a published social post, NOT a voter audience, NOT a channel
-- publication, NOT an immutable event. It is the campaign's own working
-- record of "we intend to communicate about X" — mutable, like a Campaign
-- Studio draft, for exactly the same reason (see this file's own header).
create table if not exists communications (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  -- Short work-item label, distinct from any one language variant's own
  -- text — mirrors campaign_studio_assets.title.
  title       text not null,
  -- Optional free-text purpose/objective ("why are we sending this") —
  -- read by a human reviewer/approver for context; never machine-parsed.
  brief       text,
  -- Optional canonical authoring-language text. Nullable because a
  -- Communication may be entirely asset-driven (e.g. a poster whose full
  -- text already lives inside its linked campaign_studio_assets.content)
  -- with nothing further to say at the Communication level itself.
  master_text text,
  -- A.5.1 has exactly one reachable status. The CHECK constraint exists
  -- (unlike campaign_studio_assets.status, which has none) precisely so
  -- A.5.2 widening this vocabulary is a one-line ALTER, not a schema
  -- rework — see this file's own header on why review/approval get the
  -- stricter treatment campaign_studio_assets never needed.
  status      text not null default 'draft' check (status = 'draft'),
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The composite-FK target for communication_assets and language_variants.
  unique (id, campaign_id)
);
create index if not exists communications_campaign_idx on communications(campaign_id, updated_at desc);

comment on table communications is
  'Gate A.5.1 — a campaign''s own communication work item (PLAN/CREATE stage). Mutable draft content, not a Canon fact — same write-discipline category as campaign_studio_assets. Never itself a published post, channel publication, or voter audience.';

alter table communications enable row level security;

drop policy if exists "communications read own campaign" on communications;
create policy "communications read own campaign" on communications
  for select using (public.is_active_campaign_member(communications.campaign_id));

drop policy if exists "communications insert own campaign" on communications;
create policy "communications insert own campaign" on communications
  for insert with check (
    created_by = auth.uid() and public.is_active_campaign_member(communications.campaign_id)
  );

-- Mutable in place, like campaign_studio_assets — any active campaign
-- member may edit a draft. No delete policy, matching campaign_studio_
-- assets' own precedent (no deleteAsset() exists there either).
drop policy if exists "communications update own campaign" on communications;
create policy "communications update own campaign" on communications
  for update using (public.is_active_campaign_member(communications.campaign_id))
  with check (public.is_active_campaign_member(communications.campaign_id));

-- ---------- communication_assets: Communication <-> existing Studio asset(s) ----------
-- A proper many-to-many join table, never a comma-separated id list or an
-- opaque JSON array — `position` preserves ordering when more than one
-- asset is attached. References an EXISTING campaign_studio_assets row;
-- never copies or duplicates its content.
create table if not exists communication_assets (
  communication_id uuid not null,
  campaign_id       uuid not null,
  asset_id          uuid not null,
  position          int  not null default 0,
  created_at        timestamptz not null default now(),
  primary key (communication_id, asset_id),
  -- Proves the asset and the Communication share the SAME campaign — the
  -- database-level guarantee this file's header describes. Either FK
  -- failing is the literal, structural prevention of a cross-campaign
  -- attach; no RLS policy has to be relied on alone for this invariant.
  foreign key (communication_id, campaign_id) references communications(id, campaign_id) on delete cascade,
  foreign key (asset_id, campaign_id) references campaign_studio_assets(id, campaign_id) on delete cascade
);
create index if not exists communication_assets_communication_idx on communication_assets(communication_id, position);

comment on table communication_assets is
  'Gate A.5.1 — join table linking a Communication to one or more existing campaign_studio_assets rows. References only; never duplicates asset content. Composite FKs make a cross-campaign attach a database-level impossibility, not an RLS/application-discipline expectation.';

alter table communication_assets enable row level security;

drop policy if exists "communication assets read own campaign" on communication_assets;
create policy "communication assets read own campaign" on communication_assets
  for select using (public.is_active_campaign_member(communication_assets.campaign_id));

drop policy if exists "communication assets insert own campaign" on communication_assets;
create policy "communication assets insert own campaign" on communication_assets
  for insert with check (public.is_active_campaign_member(communication_assets.campaign_id));

-- Detaching an asset (or reordering) is a normal drafting action, unlike
-- reviews/approvals below — matches communications' own update policy.
drop policy if exists "communication assets update own campaign" on communication_assets;
create policy "communication assets update own campaign" on communication_assets
  for update using (public.is_active_campaign_member(communication_assets.campaign_id))
  with check (public.is_active_campaign_member(communication_assets.campaign_id));

drop policy if exists "communication assets delete own campaign" on communication_assets;
create policy "communication assets delete own campaign" on communication_assets
  for delete using (public.is_active_campaign_member(communication_assets.campaign_id));

-- ---------- language_variants: one row per language, per Communication ----------
-- English is a language variant like any other — never a distinct "master
-- language" object. A Communication may start with exactly one variant
-- (any of the six) and is capable of eventually holding all six; nothing
-- here requires all six to exist at once.
create table if not exists language_variants (
  id               uuid primary key default gen_random_uuid(),
  communication_id uuid not null,
  campaign_id      uuid not null,
  language         text not null check (language in ('en', 'yo', 'ha', 'ig', 'pcm', 'urh')),
  -- The actual per-language content. Never claims machine translation —
  -- see write.js's own header: this column holds whatever a human typed
  -- or pasted in, full stop.
  text             text not null default '',
  status           text not null default 'draft' check (status = 'draft'),
  created_by       uuid not null references auth.users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- At most one variant per language per Communication — a re-attempt at
  -- the SAME language edits this row, it does not create a second one.
  unique (communication_id, language),
  -- The composite-FK target for reviews/approvals below.
  unique (id, campaign_id),
  foreign key (communication_id, campaign_id) references communications(id, campaign_id) on delete cascade
);
create index if not exists language_variants_communication_idx on language_variants(communication_id);

comment on table language_variants is
  'Gate A.5.1 — one language''s content for a Communication (en/yo/ha/ig/pcm/urh). Manually authored or pasted from an external translation workflow; this schema never asserts the system itself translated anything. Mutable draft content, same category as communications.';

alter table language_variants enable row level security;

drop policy if exists "language variants read own campaign" on language_variants;
create policy "language variants read own campaign" on language_variants
  for select using (public.is_active_campaign_member(language_variants.campaign_id));

drop policy if exists "language variants insert own campaign" on language_variants;
create policy "language variants insert own campaign" on language_variants
  for insert with check (
    created_by = auth.uid() and public.is_active_campaign_member(language_variants.campaign_id)
  );

drop policy if exists "language variants update own campaign" on language_variants;
create policy "language variants update own campaign" on language_variants
  for update using (public.is_active_campaign_member(language_variants.campaign_id))
  with check (public.is_active_campaign_member(language_variants.campaign_id));

-- ---------- reviews: native-language review, one row per review pass ----------
-- Attaches to a LANGUAGE VARIANT, never to the whole Communication — native
-- review is inherently language-specific (a Yoruba variant is reviewed
-- independently of an English one), and every variant (English included)
-- is reviewable through this SAME mechanism, so no second "communication-
-- level review" path is needed alongside it.
create table if not exists reviews (
  id                 uuid primary key default gen_random_uuid(),
  language_variant_id uuid not null,
  campaign_id        uuid not null,
  reviewer_id        uuid not null references auth.users(id) on delete restrict,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (language_variant_id, campaign_id) references language_variants(id, campaign_id) on delete cascade
);
create index if not exists reviews_variant_idx on reviews(language_variant_id);

comment on table reviews is
  'Gate A.5.1 — a native-language review pass on one language_variant. DRAFTER =/= REVIEWER is enforced by this table''s own INSERT policy (below), independently re-checked server-side against language_variants.created_by, never trusted from the client. Full reviewer-roster/re-review workflow is A.5.2 — this table only proves the object model and the non-self-review invariant.';

alter table reviews enable row level security;

drop policy if exists "reviews read own campaign" on reviews;
create policy "reviews read own campaign" on reviews
  for select using (public.is_active_campaign_member(reviews.campaign_id));

-- THE DRAFTER =/= REVIEWER INVARIANT. reviewer_id must be the caller
-- (never asserted on someone else's behalf), the caller must be an active
-- member of the SAME campaign, and — the actual enforcement — the caller
-- must NOT be the author of the language_variant being reviewed. This
-- subquery is readable by the caller under language_variants' own SELECT
-- policy above (they are already required to be an active member of the
-- same campaign), so no SECURITY DEFINER wrapper is needed here.
drop policy if exists "reviews insert own campaign" on reviews;
create policy "reviews insert own campaign" on reviews
  for insert with check (
    reviewer_id = auth.uid()
    and public.is_active_campaign_member(reviews.campaign_id)
    and auth.uid() <> (select lv.created_by from language_variants lv where lv.id = reviews.language_variant_id)
  );

-- Only the reviewer who owns a row may ever change it (e.g. pending ->
-- approved/rejected, or edit their own notes) — no cross-person edit, no
-- delete. A genuinely NEW review pass is a new row (see table comment),
-- never an edit of a previous reviewer's own record.
drop policy if exists "reviews update own row" on reviews;
create policy "reviews update own row" on reviews
  for update using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

-- ---------- approvals: distinct from review, one row per approval action ----------
-- Same granularity as reviews (per language_variant, for the same reason:
-- Section F of the Gate A.5 architecture report defines approval as
-- per-language). Owner/manager-only restriction is EXPLICITLY DEFERRED to
-- A.5.2 (see this table's own comment) — the one invariant enforced here,
-- structurally, is that a draft author can never approve their own work.
create table if not exists approvals (
  id                 uuid primary key default gen_random_uuid(),
  language_variant_id uuid not null,
  campaign_id        uuid not null,
  approver_id        uuid not null references auth.users(id) on delete restrict,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (language_variant_id, campaign_id) references language_variants(id, campaign_id) on delete cascade
);
create index if not exists approvals_variant_idx on approvals(language_variant_id);

comment on table approvals is
  'Gate A.5.1 — an approval action on one language_variant, distinct from a review. A.5.1 ONLY enforces non-self-approval (any active campaign member otherwise qualifies) — restricting approval authority to owner/manager is EXPLICITLY DEFERRED to A.5.2, which must add that check to this table''s own INSERT policy without any column change.';

alter table approvals enable row level security;

drop policy if exists "approvals read own campaign" on approvals;
create policy "approvals read own campaign" on approvals
  for select using (public.is_active_campaign_member(approvals.campaign_id));

-- NOT YET owner/manager-restricted — see this table's own comment above.
-- The one invariant enforced now: a draft author can never approve their
-- own work, checked the identical way reviews.created_by is checked.
drop policy if exists "approvals insert own campaign" on approvals;
create policy "approvals insert own campaign" on approvals
  for insert with check (
    approver_id = auth.uid()
    and public.is_active_campaign_member(approvals.campaign_id)
    and auth.uid() <> (select lv.created_by from language_variants lv where lv.id = approvals.language_variant_id)
  );

drop policy if exists "approvals update own row" on approvals;
create policy "approvals update own row" on approvals
  for update using (approver_id = auth.uid())
  with check (approver_id = auth.uid());
