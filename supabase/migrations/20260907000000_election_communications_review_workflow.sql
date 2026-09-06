-- ============================================================
-- ELECTIONCANON — GATE A.5.2: NATIVE REVIEW / APPROVAL WORKFLOW
--
-- Extends Gate A.5.1's foundational Communication object model
-- (20260906000000_election_communications.sql) with the governed human
-- workflow: submit-for-review, review, approve, revoke. Additive only —
-- no existing column, table, or policy from A.5.1 is removed; the
-- reviews/approvals INSERT/UPDATE client policies ARE removed (see
-- "ledger integrity" section below), and language_variants' UPDATE policy
-- is narrowed — both changes are the explicit A.5.2 scope, not incidental.
--
-- AUTHORIZATION FOUNDATION. is_campaign_owner_or_manager() is extracted
-- here because the inline `member_role in ('owner','manager')` check this
-- project already uses (create_campaign_invitation(), has_responsibility_
-- for(), write_responsibility() — all in prior migrations) is now needed
-- a THIRD time, by Communications' own approval authority. This is not a
-- new permission system — it is naming a pattern already proven twice,
-- mirroring is_active_campaign_member()'s own extraction precedent
-- exactly (same SECURITY DEFINER / stable / set search_path = '' shape).
--
-- WORKFLOW STATE, ONE OWNER PER FACT. language_variants.status is a
-- current-state PROJECTION (exactly like responsibility_slots' own
-- documented contract: "fully re-derivable, never a second source of
-- truth"), written ONLY by the four RPCs below. reviews/approvals remain
-- the immutable, append-only ledger — a client can create a NEW review or
-- approval row via the RPCs, but can never update or delete an existing
-- one, and can never write language_variants.status directly (enforced by
-- BOTH narrowed RLS and a column-level REVOKE, not by hiding UI buttons
-- alone — see that section's own comment for why one alone is not enough).
--
-- THE DRAFTER =/= REVIEWER =/= APPROVER INVARIANT, COMPLETED. A.5.1 only
-- checked drafter against reviewer, and drafter against approver,
-- INDEPENDENTLY — meaning the SAME non-drafter person could review AND
-- approve the same variant. record_approval() below closes this: it
-- independently re-reads the qualifying review's own reviewer_id and
-- refuses a caller who matches it, in addition to refusing the drafter.
--
-- REVIEW-APPROVED =/= ORGANISATIONALLY APPROVED. An approved review keeps
-- the variant at 'in_review' (see record_review()'s own comment) — the
-- ONLY path to language_variants.status = 'approved' is record_approval(),
-- which is owner/manager-only. This resolves an internal tension in this
-- gate's own drafting instructions (an approved review setting status
-- straight to 'approved' would make record_approval()'s own "must not
-- already be approved" precondition unreachable, and would let a mere
-- capability-holding staff reviewer's approval display as organisationally
-- final before any owner/manager ever acted) — documented explicitly so
-- a future reader never "fixes" this back to the contradictory reading.
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'communications') then
    raise exception 'Table public.communications does not exist. Apply 20260906000000_election_communications.sql first.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'is_active_campaign_member') then
    raise exception 'Function public.is_active_campaign_member does not exist. Apply 20260826000000_fix_campaign_members_rls_recursion.sql first.';
  end if;
end $$;

-- ---------- is_campaign_owner_or_manager(): the extracted, reusable helper ----------
create or replace function public.is_campaign_owner_or_manager(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.person = auth.uid()
      and m.status = 'active'
      and m.member_role in ('owner', 'manager')
  );
$function$;

comment on function public.is_campaign_owner_or_manager(uuid) is
  'Gate A.5.2 — the CALLING user (auth.uid()) is an active owner/manager of the given campaign. Extracted from the identical inline check already duplicated in create_campaign_invitation()/has_responsibility_for()/write_responsibility() — not a new permission system, a name for an existing one. SECURITY DEFINER so it never re-triggers campaign_members'' own RLS.';

revoke all on function public.is_campaign_owner_or_manager(uuid) from public;
grant execute on function public.is_campaign_owner_or_manager(uuid) to authenticated;

-- ---------- campaign_member_languages: campaign-scoped reviewer capability ----------
-- NOT a profile-wide skill (would leak a claim across campaigns this
-- codebase has no concept of outside campaign_members' own scoping) and
-- NOT a generic capability platform — one narrow fact: "this person may
-- review this language, for this campaign." The composite FK below
-- guarantees the grantee is already a real member of the exact same
-- campaign, using campaign_members' own pre-existing unique(campaign_id,
-- person) constraint as its target — the same composite-FK, database-
-- level-impossibility discipline Gate A.5.1 already established for
-- communication_assets.
create table if not exists campaign_member_languages (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  person      uuid not null,
  language    text not null check (language in ('en', 'yo', 'ha', 'ig', 'pcm', 'urh')),
  created_at  timestamptz not null default now(),
  created_by  uuid not null references auth.users(id) on delete restrict,
  unique (campaign_id, person, language),
  foreign key (campaign_id, person) references campaign_members(campaign_id, person) on delete cascade
);
create index if not exists campaign_member_languages_campaign_idx on campaign_member_languages(campaign_id);

comment on table campaign_member_languages is
  'Gate A.5.2 — campaign-scoped declaration that a member may review a given language for THIS campaign. Owner/manager bypass this check entirely (is_campaign_owner_or_manager() is checked first, everywhere this table is consulted) — this table only ever narrows who ELSE, beyond owner/manager, may review which language.';

alter table campaign_member_languages enable row level security;

drop policy if exists "member languages read own campaign" on campaign_member_languages;
create policy "member languages read own campaign" on campaign_member_languages
  for select using (public.is_active_campaign_member(campaign_member_languages.campaign_id));

-- GRANT/REVOKE authority: owner/manager ONLY. A staff member can read the
-- roster (above) but can never self-certify a language — the insert check
-- re-verifies is_campaign_owner_or_manager() server-side, independent of
-- whatever the UI does or does not show.
drop policy if exists "member languages insert owner or manager" on campaign_member_languages;
create policy "member languages insert owner or manager" on campaign_member_languages
  for insert with check (public.is_campaign_owner_or_manager(campaign_member_languages.campaign_id));

drop policy if exists "member languages delete owner or manager" on campaign_member_languages;
create policy "member languages delete owner or manager" on campaign_member_languages
  for delete using (public.is_campaign_owner_or_manager(campaign_member_languages.campaign_id));

-- No update policy — a capability either exists or it does not; changing
-- one is a delete-then-insert (two honest, auditable facts), never an
-- in-place mutation of what was granted.

-- ---------- language_variants: workflow status expansion ----------
alter table language_variants drop constraint if exists language_variants_status_check;
alter table language_variants add constraint language_variants_status_check
  check (status in ('draft', 'in_review', 'changes_requested', 'approved'));

-- CLIENT MUST NOT BE ABLE TO WRITE STATUS, AT ALL, THROUGH ANY PATH — not
-- solved by hiding UI controls. Two independent, standard Postgres
-- mechanisms, deliberately layered:
--   1. Row-level: the UPDATE policy's USING clause only makes a row
--      targetable for update while status is draft/changes_requested —
--      an in_review or approved row cannot be reached by a client UPDATE
--      at all, regardless of what columns it tries to set.
--   2. Column-level: authenticated's blanket UPDATE grant is replaced
--      with a column-restricted one covering ONLY the two columns
--      updateLanguageVariant() actually needs (text, updated_at) — status
--      itself is never in the grantable set, so no client UPDATE
--      statement can include it, even against a draft/changes_requested
--      row, even before RLS is evaluated.
-- The four RPCs below run SECURITY DEFINER as this schema's owning role,
-- which (same as write_responsibility()'s own long-established behavior
-- against responsibility_slots) is exempt from both of these — a table
-- owner is exempt from its own RLS unless FORCE ROW LEVEL SECURITY is set
-- (it is not, here or anywhere else in this schema), and column GRANTs
-- constrain the `authenticated` client role, never the owning role a
-- SECURITY DEFINER function executes as.
drop policy if exists "language variants update own campaign" on language_variants;
create policy "language variants update own campaign" on language_variants
  for update using (
    public.is_active_campaign_member(language_variants.campaign_id)
    and language_variants.status in ('draft', 'changes_requested')
  )
  with check (public.is_active_campaign_member(language_variants.campaign_id));

revoke update on language_variants from authenticated;
grant update (text, updated_at) on language_variants to authenticated;

-- ---------- reviews / approvals: genuinely append-only, RPC-only writes ----------
-- Dropping the client INSERT/UPDATE policies A.5.1 granted — RLS enabled
-- with zero permissive policy for a command denies that command outright
-- for every role without RLS-bypass, the EXACT mechanism responsibility_
-- slots already relies on for "no client insert policy anywhere -- only
-- write_responsibility() may mutate it." A new review/approval row can
-- now only ever be created by record_review()/record_approval()/
-- revoke_approval() below; an existing row can never be updated or
-- deleted by any client, full stop.
drop policy if exists "reviews insert own campaign" on reviews;
drop policy if exists "reviews update own row" on reviews;
drop policy if exists "approvals insert own campaign" on approvals;
drop policy if exists "approvals update own row" on approvals;
-- "reviews read own campaign" / "approvals read own campaign" (SELECT)
-- are untouched — history stays fully readable under campaign isolation.

-- approvals gains 'revoked' (Section J) and a notes column, mirroring
-- reviews.notes exactly — free text, no reason-code taxonomy invented.
alter table approvals drop constraint if exists approvals_status_check;
alter table approvals add constraint approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'revoked'));
alter table approvals add column if not exists notes text;

-- ---------- submit_language_variant_for_review(): drafter-only entry into review ----------
create or replace function public.submit_language_variant_for_review(p_variant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_variant public.language_variants;
begin
  -- 1. auth guard
  if v_uid is null then
    raise exception 'submit_language_variant_for_review requires an authenticated session';
  end if;

  -- 2. load target
  select * into v_variant from public.language_variants where id = p_variant_id;
  if v_variant.id is null then
    raise exception 'language variant not found';
  end if;

  -- 3. active membership guard
  if not exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_variant.campaign_id and m.person = v_uid and m.status = 'active'
  ) then
    raise exception 'you are not an active member of this campaign';
  end if;

  -- 4. authorization: drafter only
  if v_variant.created_by <> v_uid then
    raise exception 'only the drafter who created this variant may submit it for review';
  end if;

  -- 5. idempotent no-op on repeat submission -- never a duplicate
  -- transition, never silently treated as success without saying so.
  if v_variant.status = 'in_review' then
    return to_jsonb(v_variant) || jsonb_build_object('alreadyInReview', true);
  end if;

  -- 6. state validation -- an approved variant must be revoked first
  -- (revoke_approval()), never re-submitted directly.
  if v_variant.status not in ('draft', 'changes_requested') then
    raise exception 'a variant with status "%" cannot be submitted for review directly', v_variant.status;
  end if;

  -- 7. atomic transition
  update public.language_variants
    set status = 'in_review', updated_at = now()
    where id = p_variant_id
    returning * into v_variant;

  return to_jsonb(v_variant) || jsonb_build_object('alreadyInReview', false);
end;
$function$;

revoke all on function public.submit_language_variant_for_review(uuid) from public;
grant execute on function public.submit_language_variant_for_review(uuid) to authenticated;

-- ---------- record_review(): native-language review, one immutable row per pass ----------
create or replace function public.record_review(p_variant_id uuid, p_status text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_variant public.language_variants;
  v_review public.reviews;
  v_has_capability boolean;
begin
  -- 1. auth guard
  if v_uid is null then
    raise exception 'record_review requires an authenticated session';
  end if;

  -- 2. verdict validation
  if p_status not in ('approved', 'rejected') then
    raise exception 'a review status must be approved or rejected';
  end if;
  if p_status = 'rejected' and (p_notes is null or btrim(p_notes) = '') then
    raise exception 'a rejected review requires non-empty notes';
  end if;

  -- 3. load target
  select * into v_variant from public.language_variants where id = p_variant_id;
  if v_variant.id is null then
    raise exception 'language variant not found';
  end if;

  -- 4. active membership guard
  if not exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_variant.campaign_id and m.person = v_uid and m.status = 'active'
  ) then
    raise exception 'you are not an active member of this campaign';
  end if;

  -- 5. drafter exclusion
  if v_variant.created_by = v_uid then
    raise exception 'the drafter of a variant may not review their own work';
  end if;

  -- 6. authority: owner/manager, OR declared capability for this exact
  -- language in this exact campaign. Checked here, server-side,
  -- independent of whatever the UI chose to show.
  v_has_capability := public.is_campaign_owner_or_manager(v_variant.campaign_id)
    or exists (
      select 1 from public.campaign_member_languages cml
      where cml.campaign_id = v_variant.campaign_id and cml.person = v_uid and cml.language = v_variant.language
    );
  if not v_has_capability then
    raise exception 'you are not authorised to review this language for this campaign';
  end if;

  -- 7. state validation
  if v_variant.status <> 'in_review' then
    raise exception 'this variant is not currently in review';
  end if;

  -- 8. append the new, immutable review row -- never an update to a
  -- prior reviewer's own record, even on a genuine re-review pass.
  insert into public.reviews (language_variant_id, campaign_id, reviewer_id, status, notes)
  values (p_variant_id, v_variant.campaign_id, v_uid, p_status, p_notes)
  returning * into v_review;

  -- 9. atomic status projection update. An APPROVED review deliberately
  -- keeps the variant at 'in_review' -- see this file's own header on
  -- why an approved review is not the same fact as an organisational
  -- approval, which only record_approval() (owner/manager-only) may ever
  -- grant. A REJECTED review returns the variant to changes_requested,
  -- editable again by its drafter.
  if p_status = 'rejected' then
    update public.language_variants set status = 'changes_requested', updated_at = now()
      where id = p_variant_id returning * into v_variant;
  end if;

  return jsonb_build_object('review', to_jsonb(v_review), 'variant', to_jsonb(v_variant));
end;
$function$;

revoke all on function public.record_review(uuid, text, text) from public;
grant execute on function public.record_review(uuid, text, text) to authenticated;

-- ---------- record_approval(): owner/manager-only, the ONLY path to 'approved' ----------
create or replace function public.record_approval(p_variant_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_variant public.language_variants;
  v_latest_review public.reviews;
  v_approval public.approvals;
begin
  -- 1. auth guard
  if v_uid is null then
    raise exception 'record_approval requires an authenticated session';
  end if;

  -- 2. load target
  select * into v_variant from public.language_variants where id = p_variant_id;
  if v_variant.id is null then
    raise exception 'language variant not found';
  end if;

  -- 3. active membership guard
  if not exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_variant.campaign_id and m.person = v_uid and m.status = 'active'
  ) then
    raise exception 'you are not an active member of this campaign';
  end if;

  -- 4. authority: owner/manager only. Not merely hidden in the UI.
  if not public.is_campaign_owner_or_manager(v_variant.campaign_id) then
    raise exception 'only the campaign owner or manager may approve a language variant';
  end if;

  -- 5. drafter exclusion
  if v_variant.created_by = v_uid then
    raise exception 'the drafter of a variant may not approve their own work';
  end if;

  -- 6. state validation -- blocks re-approving an already-approved variant
  if v_variant.status <> 'in_review' then
    raise exception 'this variant is not currently awaiting approval';
  end if;

  -- 7. the qualifying review: the MOST RECENT review row BELONGING TO THE
  -- CURRENT in_review CYCLE must be approved. An older approved review
  -- does not count if a newer one (still within this same cycle) rejected
  -- it -- deterministic "latest" by created_at, the same ordering
  -- guarantee every other current-state read in this schema relies on.
  --
  -- "belonging to the current cycle" = created_at >= v_variant.updated_at,
  -- where v_variant was loaded (step 2, above) BEFORE this function's own
  -- later mutation. This is not a guess: submit_language_variant_for_
  -- review() is the ONLY function that ever sets status = 'in_review', and
  -- it unconditionally stamps updated_at = now() in that same statement;
  -- the narrowed language_variants UPDATE policy makes it impossible for
  -- any client edit to touch updated_at while status stays in_review (its
  -- own USING clause requires status in ('draft','changes_requested')).
  -- So v_variant.updated_at, at this exact point, is ALWAYS precisely the
  -- timestamp this in_review cycle began -- closing the gap where a STALE
  -- pre-revocation review (approved(-> revoked -> edited -> resubmitted
  -- WITHOUT a fresh review) could otherwise still satisfy this check and
  -- let newly-edited, never-actually-reviewed content become approved.
  select * into v_latest_review from public.reviews
    where language_variant_id = p_variant_id
      and created_at >= v_variant.updated_at
    order by created_at desc
    limit 1;
  if v_latest_review.id is null or v_latest_review.status <> 'approved' then
    raise exception 'this variant does not have a currently-approved review for its current review cycle';
  end if;

  -- 8. THE INVARIANT A.5.1 DID NOT ENFORCE: approver must differ from the
  -- reviewer whose review is being relied on, not only from the drafter.
  if v_latest_review.reviewer_id = v_uid then
    raise exception 'the approver must be a different person from the reviewer';
  end if;

  -- 9. append the new, immutable approval event
  insert into public.approvals (language_variant_id, campaign_id, approver_id, status, notes)
  values (p_variant_id, v_variant.campaign_id, v_uid, 'approved', p_notes)
  returning * into v_approval;

  -- 10. atomic projection update -- the ONLY statement anywhere that ever
  -- sets language_variants.status = 'approved'.
  update public.language_variants set status = 'approved', updated_at = now()
    where id = p_variant_id returning * into v_variant;

  return jsonb_build_object('approval', to_jsonb(v_approval), 'variant', to_jsonb(v_variant));
end;
$function$;

revoke all on function public.record_approval(uuid, text) from public;
grant execute on function public.record_approval(uuid, text) to authenticated;

-- ---------- revoke_approval(): the ONLY mechanism for changing approved content ----------
create or replace function public.revoke_approval(p_variant_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_variant public.language_variants;
  v_approval public.approvals;
begin
  -- 1. auth guard
  if v_uid is null then
    raise exception 'revoke_approval requires an authenticated session';
  end if;

  -- 2. reason required -- a revocation with no reason is not governance
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'revoking an approval requires a non-empty reason';
  end if;

  -- 3. load target
  select * into v_variant from public.language_variants where id = p_variant_id;
  if v_variant.id is null then
    raise exception 'language variant not found';
  end if;

  -- 4. active membership guard
  if not exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_variant.campaign_id and m.person = v_uid and m.status = 'active'
  ) then
    raise exception 'you are not an active member of this campaign';
  end if;

  -- 5. authority: owner/manager only
  if not public.is_campaign_owner_or_manager(v_variant.campaign_id) then
    raise exception 'only the campaign owner or manager may revoke an approval';
  end if;

  -- 6. state validation
  if v_variant.status <> 'approved' then
    raise exception 'this variant is not currently approved';
  end if;

  -- 7. append a NEW approval event, status='revoked' -- the original
  -- 'approved' row is NEVER updated or deleted; history shows approved,
  -- then revoked, both readable, forever.
  insert into public.approvals (language_variant_id, campaign_id, approver_id, status, notes)
  values (p_variant_id, v_variant.campaign_id, v_uid, 'revoked', p_reason)
  returning * into v_approval;

  -- 8. atomic projection update -- back into the editable/re-reviewable
  -- state; the variant must go through submit -> review -> approval
  -- again in full, no shortcut.
  update public.language_variants set status = 'changes_requested', updated_at = now()
    where id = p_variant_id returning * into v_variant;

  return jsonb_build_object('approval', to_jsonb(v_approval), 'variant', to_jsonb(v_variant));
end;
$function$;

revoke all on function public.revoke_approval(uuid, text) from public;
grant execute on function public.revoke_approval(uuid, text) to authenticated;
