-- ============================================================
-- ELECTORAL GEOGRAPHY — RESPONSIBILITY REASSIGNMENT + COVERAGE PROJECTION
--   (ElectionCanon 1.1 Phase 1 — Design Gate 1 / 1A / Final Security Micro-Gate)
--
-- THE GAP THIS CLOSES. responsibility.assigned (20260829000000 geography
-- pass onward) makes a slot's first assignment permanent -- the partial
-- unique index election_events_responsibility_slot_uidx (20260830000000)
-- enforces at most ONE responsibility.assigned row per (campaign_id,
-- level, geographyRef) slot, FOREVER, by that migration's own explicit
-- design. There has never been a way to replace a coordinator who leaves
-- without direct database access. This migration adds that, without
-- weakening the existing guarantee and without rewriting a single
-- existing event.
--
-- WHY A NEW TABLE, NOT A WIDER INDEX. The existing partial unique index
-- cannot express "the LATEST event for this slot is unique" -- only "at
-- most one row, period." Reassignment fundamentally needs at least two
-- rows per slot (the original assignment plus every handoff). Widening
-- the index's WHERE clause to also cover a new responsibility.reassigned
-- type would make the FIRST reassignment itself violate uniqueness
-- against the still-present original event. So: election_events_
-- responsibility_slot_uidx stays EXACTLY as it is (it still correctly
-- guards the first-assignment race), and a new, small, additive
-- projection table -- responsibility_slots -- carries the actual "who
-- currently holds this slot" answer, enforced by its OWN primary key.
-- Every row in it is always re-derivable from election_events; it is a
-- projection, never a second source of truth.
--
-- THE SINGLE WRITE INVARIANT. Every write that creates, changes, or
-- vacates a slot's current holder must, in ONE transaction, both (A)
-- append the immutable event to election_events and (B) upsert
-- responsibility_slots. write_responsibility() below is the ONLY function
-- capable of doing either -- no client inserts a responsibility.assigned/
-- reassigned row directly any more (see this migration's own companion
-- change to src/domains/election/geography/write.js's
-- executeAssignResponsibility(), which now calls this function instead of
-- a raw election_events insert).
--
-- SECURITY ORDERING (approved, non-negotiable). auth -> membership ->
-- authorization (delegation matrix OR invitation-trust) -> geography
-- validation -> idempotency -> compare-and-swap -> atomic write. Checking
-- idempotency BEFORE authorization would let a caller who merely guesses
-- or reuses an event_id learn something about a slot they were never
-- authorised to touch -- see this function's own body for exactly how a
-- foreign event_id is handled (falls through to a genuine Postgres
-- uniqueness collision on the real insert attempt, never a privileged
-- "already recorded" response).
--
-- INVITATION TRUST, NARROWLY SCOPED. p_via_invitation_id lets acceptance
-- skip the delegation-matrix check -- the ACCEPTER never holds authority
-- over their own brand-new slot; the INVITER's authority was already
-- checked once, at create_campaign_invitation() time. This function
-- independently re-verifies the invitation's own campaign/status/
-- accepted_by, DERIVES level/geography_ref/responsibility_role from the
-- invitation row itself (never trusting client-supplied values on this
-- path), and DERIVES newPerson as 'invite:'||campaign||':'||auth.uid() --
-- never p_new_person -- so an invitation can only ever create
-- responsibility for the person who actually authenticated and accepted
-- it, never an arbitrary third party a modified client might name.
--
-- ALSO IN THIS MIGRATION (both necessary, both minimal, additive):
--   * has_responsibility_for() -- CREATE OR REPLACE, now reads
--     responsibility_slots instead of only raw responsibility.assigned
--     events, so a superseded coordinator loses (and a new one gains)
--     geography-scoped chat-join eligibility immediately, not never.
--   * create_campaign_invitation() -- CREATE OR REPLACE, its own
--     staff-delegation checks (does the caller hold the PARENT level's
--     responsibility) gain the SAME responsibility_slots awareness, for
--     the identical reason -- otherwise a Bob who is REASSIGNED into an
--     LGA Coordinator slot could never invite a Ward Coordinator under
--     him, only whoever held that slot via the original raw
--     responsibility.assigned event. Everything else about this function
--     (token/email verification is a SEPARATE function, not touched) is
--     byte-identical to 20260831000000's own version.
--   * accept_campaign_invitation() -- DROP + CREATE (its RETURNS TABLE
--     shape changes, which CREATE OR REPLACE cannot do), adding exactly
--     one column, `id`, so invitations/write.js's acceptance sequence can
--     pass p_via_invitation_id to write_responsibility(). Every check
--     inside it (token/email verification, idempotent re-acceptance,
--     expiry, revocation) is byte-identical to 20260831000000's own
--     version -- this is not a redesign of the acceptance flow.
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'election_events') then
    raise exception 'Table public.election_events does not exist. Apply 20260823001... first.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'is_active_campaign_member') then
    raise exception 'Function public.is_active_campaign_member does not exist. Apply 20260826000000 first.';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'election_events_responsibility_slot_uidx') then
    raise exception 'Index election_events_responsibility_slot_uidx does not exist. Apply 20260830000000 first.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_campaign_invitation') then
    raise exception 'Function public.create_campaign_invitation does not exist. Apply 20260831000000 first.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'geography_wards') then
    raise exception 'Table public.geography_wards does not exist. Apply 20260829000000 first.';
  end if;
end $$;

-- ---------- responsibility_slots: the current-state projection ----------

-- BLOCKER FIX PASS (F1) -- responsibility_id/current_event_id are `text`,
-- NOT `uuid`. The real election_events.event_id column
-- (20260823000001_election_events.sql:53) has ALWAYS been `text`, and this
-- project's own pre-1.1 code has ALWAYS legitimately stored non-UUID
-- confirmation ids for responsibility events -- specifically,
-- invitations/write.js's acceptance sequence has, since it was written,
-- used `invite-resp:<campaignId>:<userId>` as the responsibility write's
-- confirmationId (never a bare UUID). responsibility_id REUSES that same
-- value as the slot's own stable subject identity (see write_responsibility()
-- below), and current_event_id stores the event_id of whichever event most
-- recently produced the current state -- both must therefore tolerate
-- exactly the same value space event_id itself already does. Typing either
-- column `uuid` would make every invitation-driven responsibility write
-- fail outright, and would make the backfill below throw on any existing
-- invitation-created responsibility.assigned row. No value here is ever
-- cast to uuid, anywhere in this migration.
create table if not exists responsibility_slots (
  campaign_id          uuid not null references campaigns(id) on delete cascade,
  level                text not null check (level in ('constituency','lga','ward','polling_unit')),
  geography_ref        text not null,
  responsibility_id    text not null,
  current_person       text,
  responsibility_role  text not null check (responsibility_role in ('CONSTITUENCY_LEAD','LGA_COORDINATOR','WARD_COORDINATOR','POLLING_UNIT_AGENT')),
  current_event_id     text not null,
  updated_at           timestamptz not null default now(),
  primary key (campaign_id, level, geography_ref)
);

comment on table responsibility_slots is
  'Current-state projection of responsibility.assigned/responsibility.reassigned events -- every row is fully re-derivable from election_events, never a second source of truth. No client write policy anywhere -- only write_responsibility() may mutate it. geography_ref is intentionally plain text, not an FK -- it names a constituency, LGA, ward, or polling-unit id depending on `level`, matching every other geography-reference field on election_events'' own jsonb payload (see geography/write.js''s own header on why this project validates geography references at write time rather than via a database FK on a value whose target table varies by row.';

create index if not exists responsibility_slots_campaign_idx on responsibility_slots(campaign_id);

alter table responsibility_slots enable row level security;

drop policy if exists "responsibility slots read own campaign" on responsibility_slots;
create policy "responsibility slots read own campaign" on responsibility_slots
  for select using (public.is_active_campaign_member(responsibility_slots.campaign_id));

-- No insert/update/delete policy for any client role -- deliberately, the
-- SAME precedent campaign_invitations (20260831000000) already
-- established. Only write_responsibility() (SECURITY DEFINER, below) may
-- ever write to this table.

-- ---------- one-time backfill from existing responsibility.assigned events ----------
--
-- Safe and deterministic BECAUSE election_events_responsibility_slot_uidx
-- already guarantees at most ONE responsibility.assigned row per
-- (campaign_id, level, geographyRef) in all existing data -- this is a
-- plain 1:1 copy, never a fold/latest-wins computation. Reads
-- election_events; never writes to it. Idempotent (ON CONFLICT DO
-- NOTHING) so re-running this migration is safe.
-- No ::uuid cast on `responsibility` -- it is copied verbatim as text,
-- exactly as it has always been stored on the event payload itself
-- (jsonb ->> already yields text). A historical responsibility.assigned
-- event created via invitation acceptance (responsibility ==
-- 'invite-resp:<campaign>:<uid>') backfills correctly, same as one
-- created via the manual UI (responsibility == a real crypto.randomUUID()
-- string) -- both are just text to this column now.
insert into responsibility_slots (campaign_id, level, geography_ref, responsibility_id, current_person, responsibility_role, current_event_id, updated_at)
select
  campaign_id,
  payload ->> 'level',
  payload ->> 'geographyRef',
  payload ->> 'responsibility',
  payload ->> 'person',
  payload ->> 'responsibilityRole',
  event_id,
  created_at
from election_events
where type = 'responsibility.assigned'
on conflict (campaign_id, level, geography_ref) do nothing;

-- ---------- write_responsibility(): the ONE responsibility write path ----------
--
-- Returns jsonb (not `responsibility_slots`) so it can carry two extra,
-- non-column facts a caller needs: `alreadyRecorded` (idempotent-replay
-- signal) and `payload` (the just-written event body, null on a replay --
-- mirrors every sibling insertEvent()-based function's own {success,
-- alreadyRecorded, error, event} shape as closely as a table-returning
-- function can).
-- BLOCKER FIX PASS (F1) -- p_event_id is `text`, matching
-- election_events.event_id exactly (never `uuid`). See responsibility_slots'
-- own header comment above for why: this project's real, live invitation-
-- acceptance code path (invitations/write.js) has always used
-- 'invite-resp:<campaignId>:<userId>' as this value, not a bare UUID.
create or replace function public.write_responsibility(
  p_campaign_id uuid,
  p_level text,
  p_geography_ref text,
  p_responsibility_role text,
  p_new_person text,
  p_expected_current_person text,
  p_event_id text,
  p_reason text default null,
  p_via_invitation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_authorised boolean := false;
  v_slot public.responsibility_slots;
  v_existing_event public.election_events;
  v_inv public.campaign_invitations;
  v_responsibility_id text;
  v_event_type text;
  v_payload jsonb;
  v_new_person text;
begin
  -- 1. auth.uid() guard
  if v_uid is null then
    raise exception 'write_responsibility requires an authenticated session';
  end if;

  -- 2. active campaign membership guard
  select member_role into v_role
  from public.campaign_members
  where campaign_id = p_campaign_id and person = v_uid and status = 'active';
  if v_role is null then
    raise exception 'you are not an active member of this campaign';
  end if;

  if p_level not in ('constituency','lga','ward','polling_unit') then
    raise exception 'invalid responsibility level';
  end if;
  if p_responsibility_role not in ('CONSTITUENCY_LEAD','LGA_COORDINATOR','WARD_COORDINATOR','POLLING_UNIT_AGENT') then
    raise exception 'invalid responsibility role';
  end if;

  -- 3. authorization: invitation-trust OR normal delegation matrix.
  -- NEVER derived from p_event_id -- authorization always runs before any
  -- idempotency lookup (step 5), so a caller who merely knows/guesses an
  -- event_id gains nothing: they still need to independently pass real
  -- membership + authorization for the campaign/slot they claim.
  if p_via_invitation_id is not null then
    select * into v_inv from public.campaign_invitations where id = p_via_invitation_id;
    if v_inv is null then
      raise exception 'referenced invitation does not exist';
    end if;
    if v_inv.campaign_id <> p_campaign_id then
      raise exception 'referenced invitation does not belong to this campaign';
    end if;
    if v_inv.status <> 'accepted' then
      raise exception 'referenced invitation has not been accepted';
    end if;
    if v_inv.accepted_by <> v_uid then
      raise exception 'referenced invitation was not accepted by the caller';
    end if;
    -- level/geography/role are DERIVED from the invitation, never trusted
    -- from the client -- a mismatch means the client is trying to use a
    -- valid invitation to write a DIFFERENT slot than it actually grants.
    if v_inv.intended_level is distinct from p_level
       or v_inv.intended_geography_ref is distinct from p_geography_ref
       or v_inv.intended_responsibility_role is distinct from p_responsibility_role then
      raise exception 'referenced invitation does not grant this role/geography';
    end if;
    v_authorised := true;
  else
    if v_role in ('owner', 'manager') then
      v_authorised := true;
    elsif p_responsibility_role = 'WARD_COORDINATOR' and p_level = 'ward' then
      v_authorised := exists (
        select 1 from public.responsibility_slots rs
        join public.geography_wards w on w.id::text = p_geography_ref
        where rs.campaign_id = p_campaign_id and rs.level = 'lga' and rs.geography_ref = w.lga_id::text
          and rs.current_person = 'invite:' || p_campaign_id::text || ':' || v_uid::text
      ) or exists (
        -- pre-backfill / first-ever-write safety net: a legitimate LGA
        -- Coordinator whose OWN slot has not yet gone through
        -- write_responsibility() even once (impossible after this
        -- migration's own backfill runs, but kept for defense in depth --
        -- never trust a single code path alone for an authorization
        -- decision this security-relevant).
        select 1 from public.election_events e
        join public.geography_wards w on w.id::text = p_geography_ref
        where e.campaign_id = p_campaign_id and e.type = 'responsibility.assigned'
          and e.payload ->> 'level' = 'lga' and e.payload ->> 'geographyRef' = w.lga_id::text
          and e.payload ->> 'person' = 'invite:' || p_campaign_id::text || ':' || v_uid::text
      );
    elsif p_responsibility_role = 'POLLING_UNIT_AGENT' and p_level = 'polling_unit' then
      v_authorised := exists (
        select 1 from public.responsibility_slots rs
        join public.geography_polling_units pu on pu.id::text = p_geography_ref
        where rs.campaign_id = p_campaign_id and rs.level = 'ward' and rs.geography_ref = pu.ward_id::text
          and rs.current_person = 'invite:' || p_campaign_id::text || ':' || v_uid::text
      );
    else
      v_authorised := false;
    end if;
  end if;

  if not v_authorised then
    raise exception 'you are not authorised to write this responsibility';
  end if;

  -- 4. target geography validation -- re-derived server-side, never
  -- trusted from the client's own PREPARE-time check.
  if p_level = 'ward' then
    if not exists (select 1 from public.geography_wards where id::text = p_geography_ref) then
      raise exception 'unrecognised ward geography reference';
    end if;
  elsif p_level = 'lga' then
    if not exists (select 1 from public.geography_lgas where id::text = p_geography_ref) then
      raise exception 'unrecognised lga geography reference';
    end if;
  elsif p_level = 'polling_unit' then
    if not exists (select 1 from public.geography_polling_units where id::text = p_geography_ref) then
      raise exception 'unrecognised polling unit geography reference';
    end if;
  elsif p_level = 'constituency' then
    if not exists (select 1 from public.geography_constituencies where id::text = p_geography_ref) then
      raise exception 'unrecognised constituency geography reference';
    end if;
  end if;

  -- 5. idempotency check -- ONLY now, after full authorization, and
  -- cross-validated against the ALREADY-authorised context above. A
  -- foreign/colliding event_id is never treated as a retry -- it falls
  -- through to step 7's real insert attempt, which then hits Postgres'
  -- own election_events_event_id_key uniqueness constraint and fails with
  -- a bare collision error, disclosing nothing about the other event.
  select * into v_existing_event from public.election_events where event_id = p_event_id;
  if found then
    if v_existing_event.campaign_id = p_campaign_id
       and v_existing_event.type in ('responsibility.assigned', 'responsibility.reassigned')
       and v_existing_event.payload ->> 'level' = p_level
       and v_existing_event.payload ->> 'geographyRef' = p_geography_ref
       and v_existing_event.actor = v_uid then
      select * into v_slot from public.responsibility_slots
        where campaign_id = p_campaign_id and level = p_level and geography_ref = p_geography_ref;
      return to_jsonb(v_slot) || jsonb_build_object('alreadyRecorded', true, 'payload', null);
    end if;
    -- foreign event_id: fall through, let the real insert collide below.
  end if;

  -- 6. current responsibility / compare-and-swap
  select * into v_slot from public.responsibility_slots
    where campaign_id = p_campaign_id and level = p_level and geography_ref = p_geography_ref;

  if v_slot.campaign_id is null then
    -- no existing row: this must be a genuine first assignment.
    if p_expected_current_person is not null then
      raise exception 'this slot has already changed since you last viewed it -- refresh';
    end if;
    -- The responsibility's own subject id REUSES p_event_id (never a
    -- freshly minted uuid) -- exactly matching the pre-1.1 behavior
    -- (executeAssignResponsibility used to pass `responsibility:
    -- confirmationId` directly), and simultaneously satisfying
    -- reassignment's own requirement (Design Gate 1A Part 3): this same
    -- id is reused, unchanged, by every LATER responsibility.reassigned
    -- event for this slot (see the `else` branch below), so the slot's
    -- identity persists across its whole lifetime without needing a
    -- second, separate id scheme.
    v_responsibility_id := p_event_id;
    v_event_type := 'responsibility.assigned';
  else
    if v_slot.current_person is distinct from p_expected_current_person then
      raise exception 'this slot has already changed since you last viewed it -- refresh';
    end if;
    v_responsibility_id := v_slot.responsibility_id;
    v_event_type := 'responsibility.reassigned';
  end if;

  -- newPerson: DERIVED server-side on the invitation-trust path (never
  -- p_new_person -- see this migration's own header); trusted from the
  -- caller only on the normal delegation-authorised path, where the
  -- caller IS the authority deciding who the new holder is.
  if p_via_invitation_id is not null then
    v_new_person := 'invite:' || p_campaign_id::text || ':' || v_uid::text;
  else
    v_new_person := p_new_person;
  end if;

  if v_event_type = 'responsibility.reassigned' and v_new_person is not distinct from v_slot.current_person then
    raise exception 'this person already holds this responsibility';
  end if;

  if v_event_type = 'responsibility.assigned' then
    v_payload := jsonb_build_object(
      'type', v_event_type, 'responsibility', v_responsibility_id, 'campaign', p_campaign_id,
      'level', p_level, 'geographyRef', p_geography_ref, 'responsibilityRole', p_responsibility_role,
      'person', v_new_person, 'status', 'ASSIGNED', 'eventId', p_event_id, 'at', now(),
      'summary', p_responsibility_role || ' assigned for ' || p_level || ' ' || p_geography_ref
    );
  else
    v_payload := jsonb_build_object(
      'type', v_event_type, 'responsibility', v_responsibility_id, 'campaign', p_campaign_id,
      'level', p_level, 'geographyRef', p_geography_ref, 'responsibilityRole', p_responsibility_role,
      'previousPerson', v_slot.current_person, 'newPerson', v_new_person, 'reason', p_reason,
      'eventId', p_event_id, 'at', now(),
      'summary', p_level || ' ' || p_geography_ref || case when v_new_person is null then ' vacated' else ' reassigned' end
    );
  end if;

  -- 7. atomic write: event insert + responsibility_slots upsert, ONE
  -- transaction (the function's own implicit transaction boundary). If
  -- either statement below fails, both roll back -- there is no
  -- intermediate state where one succeeded and the other did not.
  insert into public.election_events (event_id, campaign_id, type, actor, schema_version, payload)
  values (p_event_id, p_campaign_id, v_event_type, v_uid, '1', v_payload);

  insert into public.responsibility_slots (campaign_id, level, geography_ref, responsibility_id, current_person, responsibility_role, current_event_id, updated_at)
  values (p_campaign_id, p_level, p_geography_ref, v_responsibility_id, v_new_person, p_responsibility_role, p_event_id, now())
  on conflict (campaign_id, level, geography_ref) do update
    set current_person = excluded.current_person, responsibility_role = excluded.responsibility_role,
        current_event_id = excluded.current_event_id, updated_at = excluded.updated_at
  returning * into v_slot;

  return to_jsonb(v_slot) || jsonb_build_object('alreadyRecorded', false, 'payload', v_payload);
end;
$$;

revoke all on function public.write_responsibility(uuid, text, text, text, text, text, text, text, uuid) from public;
grant execute on function public.write_responsibility(uuid, text, text, text, text, text, text, text, uuid) to authenticated;

-- ---------- has_responsibility_for(): now reassignment-aware (mandatory) ----------
create or replace function public.has_responsibility_for(p_campaign_id uuid, p_level text, p_geography_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.campaign_members m
      where m.campaign_id = p_campaign_id and m.person = auth.uid()
        and m.status = 'active' and m.member_role in ('owner', 'manager')
    )
    or exists (
      select 1 from public.responsibility_slots rs
      where rs.campaign_id = p_campaign_id and rs.level = p_level and rs.geography_ref = p_geography_ref
        and rs.current_person = 'invite:' || p_campaign_id::text || ':' || auth.uid()::text
    );
$$;

revoke all on function public.has_responsibility_for(uuid, text, text) from public;
grant execute on function public.has_responsibility_for(uuid, text, text) to authenticated;

-- ---------- create_campaign_invitation(): same responsibility_slots awareness ----------
-- Byte-identical to 20260831000000's own version except the two
-- staff-delegation EXISTS checks also recognise a responsibility held via
-- responsibility_slots (a reassigned-into slot), not only a raw
-- responsibility.assigned event -- otherwise a coordinator who arrived via
-- reassignment could never delegate invitations the way an
-- originally-assigned coordinator can. Same signature, so CREATE OR
-- REPLACE (no DROP needed).
create or replace function public.create_campaign_invitation(
  p_campaign_id uuid,
  p_invited_name text,
  p_invited_email text,
  p_intended_member_role text,
  p_intended_responsibility_role text default null,
  p_intended_level text default null,
  p_intended_geography_ref text default null,
  p_expires_in_days int default 14
)
returns public.campaign_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role text;
  v_authorised boolean := false;
  v_token text;
  v_row public.campaign_invitations;
begin
  if v_uid is null then
    raise exception 'create_campaign_invitation requires an authenticated session';
  end if;
  if p_invited_name is null or btrim(p_invited_name) = '' then
    raise exception 'an invited name is required';
  end if;
  if p_invited_email is null or btrim(p_invited_email) = '' then
    raise exception 'an invited email is required';
  end if;
  if p_intended_member_role not in ('manager', 'staff') then
    raise exception 'intended_member_role must be manager or staff';
  end if;

  select member_role into v_my_role
  from public.campaign_members
  where campaign_id = p_campaign_id and person = v_uid and status = 'active';

  if v_my_role is null then
    raise exception 'you are not an active member of this campaign';
  end if;

  if v_my_role in ('owner', 'manager') then
    v_authorised := true;
  elsif p_intended_member_role = 'manager' then
    v_authorised := false;
  elsif p_intended_responsibility_role = 'WARD_COORDINATOR' and p_intended_level = 'ward' and p_intended_geography_ref is not null then
    v_authorised := exists (
      select 1 from public.responsibility_slots rs
      join public.geography_wards w on w.id::text = p_intended_geography_ref
      where rs.campaign_id = p_campaign_id and rs.level = 'lga' and rs.geography_ref = w.lga_id::text
        and rs.current_person = 'invite:' || p_campaign_id::text || ':' || v_uid::text
    ) or exists (
      select 1 from public.election_events e
      join public.geography_wards w on w.id::text = p_intended_geography_ref
      where e.campaign_id = p_campaign_id and e.type = 'responsibility.assigned'
        and e.payload ->> 'level' = 'lga' and e.payload ->> 'geographyRef' = w.lga_id::text
        and e.payload ->> 'person' = 'invite:' || p_campaign_id::text || ':' || v_uid::text
    );
  elsif p_intended_responsibility_role = 'POLLING_UNIT_AGENT' and p_intended_level = 'polling_unit' and p_intended_geography_ref is not null then
    v_authorised := exists (
      select 1 from public.responsibility_slots rs
      join public.geography_polling_units pu on pu.id::text = p_intended_geography_ref
      where rs.campaign_id = p_campaign_id and rs.level = 'ward' and rs.geography_ref = pu.ward_id::text
        and rs.current_person = 'invite:' || p_campaign_id::text || ':' || v_uid::text
    );
  else
    v_authorised := false;
  end if;

  if not v_authorised then
    raise exception 'you are not authorised to invite this role/geography combination';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.campaign_invitations (
    campaign_id, token, invited_name, invited_email, intended_member_role,
    intended_responsibility_role, intended_level, intended_geography_ref,
    status, invited_by, expires_at
  ) values (
    p_campaign_id, v_token, btrim(p_invited_name), btrim(p_invited_email), p_intended_member_role,
    p_intended_responsibility_role, p_intended_level, p_intended_geography_ref,
    'pending', v_uid, now() + make_interval(days => p_expires_in_days)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_campaign_invitation(uuid, text, text, text, text, text, text, int) from public;
grant execute on function public.create_campaign_invitation(uuid, text, text, text, text, text, text, int) to authenticated;

-- ---------- accept_campaign_invitation(): DROP + CREATE, adds `id` to the return shape ----------
-- Return TYPE is changing (one new column), which CREATE OR REPLACE
-- cannot do -- the same DROP+CREATE+re-grant pattern
-- 20260902000000_election_invitation_geography_state_context.sql already
-- used for get_invitation_preview(). Every check inside this function
-- (token/email verification, idempotent re-acceptance, expiry, revocation,
-- membership creation) is BYTE-IDENTICAL to 20260831000000's own version
-- -- this is not a redesign of invitation acceptance, token security, or
-- the email-match requirement. The ONLY change: `id` (the invitation
-- row's own id) is now returned, so invitations/write.js's acceptance
-- sequence can pass it to write_responsibility() as p_via_invitation_id.
drop function if exists public.accept_campaign_invitation(text, text);

create function public.accept_campaign_invitation(p_token text, p_display_name text default null)
returns table (
  id uuid, campaign_id uuid, intended_member_role text, intended_responsibility_role text,
  intended_level text, intended_geography_ref text, invited_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.campaign_invitations;
begin
  if v_uid is null then
    raise exception 'accept_campaign_invitation requires an authenticated session';
  end if;

  select * into v_inv from public.campaign_invitations where token = p_token for update;
  if not found then
    raise exception 'this invitation does not exist';
  end if;

  if v_inv.status = 'accepted' then
    if v_inv.accepted_by = v_uid then
      return query select v_inv.id, v_inv.campaign_id, v_inv.intended_member_role, v_inv.intended_responsibility_role,
        v_inv.intended_level, v_inv.intended_geography_ref, v_inv.invited_name;
      return;
    end if;
    raise exception 'this invitation has already been accepted';
  end if;

  if v_inv.status = 'revoked' then
    raise exception 'this invitation has been revoked';
  end if;

  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    update public.campaign_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'this invitation has expired';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) <> lower(v_inv.invited_email) then
    raise exception 'this invitation was sent to a different email address than your signed-in account';
  end if;

  insert into public.campaign_members (campaign_id, person, member_role, status, invited_by)
  values (v_inv.campaign_id, v_uid, v_inv.intended_member_role::public.campaign_member_role, 'active', v_inv.invited_by)
  on conflict (campaign_id, person) do nothing;

  update public.campaign_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  return query select v_inv.id, v_inv.campaign_id, v_inv.intended_member_role, v_inv.intended_responsibility_role,
    v_inv.intended_level, v_inv.intended_geography_ref, v_inv.invited_name;
end;
$$;

revoke all on function public.accept_campaign_invitation(text, text) from public;
grant execute on function public.accept_campaign_invitation(text, text) to authenticated;
