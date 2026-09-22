-- ============================================================
-- ELECTIONCANON — PILOT SAFETY PASS: MEMBERSHIP REVOCATION +
-- ROLE-BASED WRITE AUTHORIZATION  (25-person preparation-phase pilot)
--
-- SCOPE. This migration implements exactly two things, both identified
-- as concrete blockers in the pilot red-team review, and nothing else:
--
-- (A) A real, SECURITY DEFINER campaign-membership revocation path.
--     `campaign_member_status` already declared 'revoked'
--     (20260823000000_campaign_membership.sql) but no function or policy
--     ever transitioned a row to it -- that table has zero client
--     UPDATE/DELETE policy of any kind, by design (see that migration's
--     own header: "the bootstrap path is ensure_campaign_owner() only").
--     This migration does NOT add a client UPDATE/DELETE policy on
--     campaign_members -- revoke_campaign_member() below is the only
--     controlled membership-transition path, exactly as the SECURITY
--     DEFINER bootstrap function already is for creation.
--
-- (B) Wires campaign_member_role into the election_events INSERT policy
--     itself -- not only application code -- so a 'staff' member cannot
--     record a fixed, small set of structural/high-authority event types.
--     src/domains/election/events.js's EVENT_CAPABILITY remains exactly
--     as declared-but-not-wired as it always has been; this migration
--     does not wire that full matrix. It adds one narrow, explicit
--     denylist (STAFF_RESTRICTED_EVENT_TYPES, kept in sync by hand with
--     this file's own array) -- the minimum a small pilot needs, not a
--     general capability system.
--
-- WHY THE DATABASE, NOT ONLY electionWebAdapter.js. The application
-- layer (src/os/electionWebAdapter.js) also gates on role now, at the
-- same PREPARE/APPROVE choke points that already re-check actor_kind --
-- see that file's own diff. But every one of this codebase's four
-- structured write paths (studio/write.js, mobilization/write.js,
-- electionDay/write.js, geography/write.js -- confirmed by inspection,
-- each has exactly one `client.from("election_events").insert(...)` call
-- site) ultimately lands in this ONE table, so a policy change here is
-- the single choke point that covers all four without touching any of
-- them, and is the only thing that also stops a direct PostgREST/SQL
-- write that never goes through electionWebAdapter.js at all -- the
-- application-layer check exists only to fail earlier with a clearer
-- reason; this policy is the actual authority.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH. No change to
-- election_events' SELECT policy, the campaign tenant-primitive table
-- itself, campaign_invitations, mobilization/geography/electionDay/
-- communications/launch tables, or any existing migration file. No
-- marketplace, certification, or SME concept of any kind. `owner` and
-- `manager` write behavior is unchanged -- only `staff` is newly
-- restricted, and only for the six named event types below.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'campaign_members'
  ) then
    raise exception
      'Table public.campaign_members does not exist. Apply 20260823000000_campaign_membership.sql first.';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'election_events'
  ) then
    raise exception
      'Table public.election_events does not exist. Apply 20260823000001_election_events.sql first.';
  end if;
end $$;

-- ---------- (A) MEMBERSHIP REVOCATION ----------

-- Idempotent: safe to re-run this migration against a project that
-- already has these columns (none did before this pass).
alter table public.campaign_members add column if not exists revoked_at timestamptz;
alter table public.campaign_members add column if not exists revoked_by uuid references auth.users(id) on delete set null;

comment on column public.campaign_members.revoked_at is
  'Set only by revoke_campaign_member(). Null for every row that has never been revoked.';
comment on column public.campaign_members.revoked_by is
  'The revoking actor''s auth.uid(), set only by revoke_campaign_member() -- never a client-supplied id.';

create or replace function public.revoke_campaign_member(p_campaign_id uuid, p_target_person uuid)
returns public.campaign_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_role public.campaign_member_role;
  v_target public.campaign_members;
begin
  if v_uid is null then
    raise exception 'revoke_campaign_member requires an authenticated session';
  end if;

  -- SELF-REVOCATION IS REJECTED, checked before any row is even read --
  -- an owner/manager cannot revoke their own standing through this path
  -- (there is deliberately no self-service "leave a campaign" feature
  -- here; that is a different, un-built product decision).
  if p_target_person = v_uid then
    raise exception 'you cannot revoke your own membership';
  end if;

  -- Caller must be an ACTIVE member of this exact campaign to revoke
  -- anyone in it -- re-read fresh, never trusted from a prior call.
  select member_role into v_caller_role from public.campaign_members
  where campaign_id = p_campaign_id and person = v_uid and status = 'active';

  if v_caller_role is null then
    raise exception 'you are not an active member of this campaign';
  end if;

  if v_caller_role = 'staff' then
    raise exception 'staff may not revoke campaign members';
  end if;

  -- LOCK + RE-CHECK THE TARGET ROW TRANSACTIONALLY -- `for update` so a
  -- concurrent revoke of the same target cannot race past this check.
  select * into v_target from public.campaign_members
  where campaign_id = p_campaign_id and person = p_target_person
  for update;

  if not found then
    raise exception 'this person is not a member of this campaign';
  end if;

  -- Owner-tier membership is never revocable through this function,
  -- regardless of caller role -- 'owner may revoke manager or staff'
  -- is the full stated grant; revoking an owner is a different,
  -- deliberately un-built decision (e.g. campaign transfer/deletion).
  if v_target.member_role = 'owner' then
    raise exception 'owner memberships cannot be revoked through this function';
  end if;

  -- 'manager may revoke staff only' -- an owner passed this point
  -- already (any non-owner target is fair game for an owner caller);
  -- a manager caller is additionally restricted to staff targets.
  if v_caller_role = 'manager' and v_target.member_role <> 'staff' then
    raise exception 'managers may only revoke staff members';
  end if;

  -- ALREADY-REVOKED TARGET IS A SAFE, IDEMPOTENT NO-OP -- same
  -- discipline as accept_campaign_invitation()'s own re-accept handling.
  if v_target.status = 'revoked' then
    return v_target;
  end if;

  update public.campaign_members
  set status = 'revoked', revoked_at = now(), revoked_by = v_uid
  where id = v_target.id
  returning * into v_target;

  return v_target;
end;
$$;

comment on function public.revoke_campaign_member(uuid, uuid) is
  'The ONLY controlled campaign_members status-revocation path -- that table grants no client UPDATE/DELETE policy of any kind. owner may revoke manager/staff; manager may revoke staff only; staff may revoke nobody; self-revocation and owner-target revocation are always refused; an already-revoked target is a safe no-op.';

revoke all on function public.revoke_campaign_member(uuid, uuid) from public;
grant execute on function public.revoke_campaign_member(uuid, uuid) to authenticated;

-- ---------- (B) ROLE-BASED WRITE AUTHORIZATION ----------

-- Pure, SECURITY INVOKER (default), reads no table -- just data-shape
-- logic, exactly like electionWebAdapter.js's own actorKindAuthorised().
-- Kept as a named function (not inlined in the policy) for the same
-- reason ARCHITECTURE.md names for is_active_campaign_member(): a
-- helper function a reader/tester can call in isolation, not a second
-- copy of the same logic to keep in sync by eye inside a policy body.
create or replace function public.election_event_writable_by_role(p_role public.campaign_member_role, p_type text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not (
    p_role = 'staff'
    and p_type = any (array[
      'candidate.registered',
      'campaign.ward.assigned',
      'territory.set',
      'responsibility.assigned',
      'responsibility.reassigned',
      'responsibility.status_changed'
    ])
  );
$$;

comment on function public.election_event_writable_by_role(public.campaign_member_role, text) is
  'The pilot-safety denylist, DB-enforced: a staff-tier member may not write these six structural/high-authority event types. owner/manager are unrestricted. Keep this array in sync by hand with STAFF_RESTRICTED_EVENT_TYPES in src/domains/election/events.js -- nothing generates one from the other.';

revoke all on function public.election_event_writable_by_role(public.campaign_member_role, text) from public;
grant execute on function public.election_event_writable_by_role(public.campaign_member_role, text) to authenticated;

-- Re-declares the SAME named policy 20260823000001_election_events.sql
-- created (drop + create, this repo's own established pattern for a
-- later migration adjusting an earlier policy -- see
-- 20260826000000_fix_campaign_members_rls_recursion.sql for precedent).
-- That file itself is NOT edited. Adds exactly one condition
-- (election_event_writable_by_role(...)) to the existing
-- membership-exists check; actor = auth.uid() and the active-membership
-- EXISTS clause are otherwise byte-identical to the original.
drop policy if exists "election events insert own campaign" on election_events;
create policy "election events insert own campaign" on election_events
  for insert with check (
    actor = auth.uid()
    and exists (
      select 1 from campaign_members m
      where m.campaign_id = election_events.campaign_id
        and m.person = auth.uid()
        and m.status = 'active'
        and public.election_event_writable_by_role(m.member_role, election_events.type)
    )
  );
