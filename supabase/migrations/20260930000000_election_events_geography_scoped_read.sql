-- ============================================================
-- ELECTIONCANON — ROLE_SCOPE_03: GEOGRAPHY-SCOPED READ AUTHORIZATION
-- on election_events  (consolidated, corrected revision)
--
-- STATUS: PROPOSED, NOT YET APPLIED. This session has no credential
-- capable of applying DDL to the live database (no service-role key, no
-- linked Supabase CLI). DO NOT run `npx supabase db push` or apply this
-- to the live database without explicit authorization.
--
-- REVISION NOTE. This file supersedes two earlier drafts
-- (20260930000000_election_events_geography_scoped_read.sql's own first
-- version, and a separate 20260930000001_fix_election_events_person_
-- added_scope.sql). Neither had ever been applied anywhere, committed,
-- or pushed — both self-declared "PROPOSED, NOT YET APPLIED/DEPLOYED" and
-- neither was ever part of the public repository. Consolidating them into
-- one correct migration is therefore an honest simplification, not a
-- rewrite of deployment history: there is no history yet. The original
-- draft's own person.added bug (see "BUG FOUND AND FIXED" below) is fixed
-- directly here rather than via a separate DROP+CREATE corrective file,
-- since that two-step dance only made sense under the (here, false)
-- premise that the first version was already live.
--
-- PROBLEM. election_events' existing SELECT policy ("election events read
-- own campaign", 20260823000001_election_events.sql / corrected for
-- recursion in 20260826000000) grants ANY active campaign_members row
-- full read access to every event in that campaign, with no geography
-- dimension at all. The application's own client-side scoping (Mobilize/
-- Ask/Election Operations — see MobilizeSection.jsx, IntelligenceSection.
-- jsx, ElectionDaySection.jsx) sits ON TOP of that unrestricted read: a
-- direct PostgREST call carrying a scoped user's own JWT still returns
-- unrelated-geography events. This migration closes that gap for every
-- event type where an AUTHORITATIVE geography can actually be resolved —
-- see the taxonomy below for what that excludes, and why.
--
-- ==========================================================
-- COMPLETE EVENT TAXONOMY (all 20 types in ELECTION_EVENT_TYPES,
-- src/domains/election/events.js) AND WHY EACH IS HANDLED THE WAY IT IS.
-- ==========================================================
--
-- CAMPAIGN-WIDE BY DESIGN (no geography dimension in the product model
-- itself — these are correctly campaign-wide, not an oversight):
--   candidate.registered, document.published, territory.set,
--   observer.assignment.recorded (preparedness/readiness data, not live
--   operational data — classified campaign-wide in the original draft and
--   preserved here unchanged).
--
-- SCOPED VIA AUTHORITATIVE GEOGRAPHY (fixed by this migration):
--   responsibility.assigned / responsibility.reassigned — carry a real
--     geography_wards/geography_lgas/geography_polling_units `geographyRef`
--     UUID directly (confirmed against REQUIRED_FIELDS_BY_TYPE).
--   responsibility.status_changed — carries no geography of its own
--     (confirmed: REQUIRED_FIELDS_BY_TYPE lists only
--     ["responsibility","campaign","summary"]; projections.js's own fold
--     comment: "STATUS_CHANGED only ever touches status/trainingStatus...
--     never touching person/level/geographyRef/responsibilityRole"), but
--     its `responsibility` field is the SAME slot id assigned/reassigned
--     use, so the slot's current geography is resolved from those events.
--   mobilization.person.added — carries no geography of its own either
--     (REQUIRED_FIELDS_BY_TYPE: ["person","campaign","name","roleType",
--     "summary"]), but its `person` field can be resolved to that person's
--     CURRENT responsibility geography, if they hold a scoped one.
--
-- CLASSIFICATION: CAMPAIGN_WIDE_PENDING_AUTHORITATIVE_GEOGRAPHY — EXPLICITLY,
-- DELIBERATELY LEFT CAMPAIGN-WIDE IN THIS PASS (a real, named, tracked
-- authorization gap — NOT intentional geography-scoped authorization, NOT
-- a silent omission, and NOT solved with a fragile text comparison). This
-- label is deliberately NOT "CAMPAIGN_WIDE" (the label used above for
-- candidate/document/territory/observer, which genuinely have no geography
-- dimension in the product model) — these ten types DO have an intended
-- geography dimension; the schema just cannot currently prove it:
--   mobilization.assignment.created
--   mobilization.assignment.status_changed
--   mobilization.task.created
--   mobilization.task.status_changed
--   electionday.pollingunit.added
--   electionday.agent.assigned
--   electionday.agent.status_changed
--   electionday.result.captured
--   electionday.result.ocr_processed
--   electionday.result.verified
--   electionday.incident.reported
--   electionday.incident.status_changed
--
--   WHY THESE CANNOT BE SAFELY SCOPED TODAY. Traced directly against
--   src/domains/election/electionDay/write.js and mobilization/write.js:
--   `electionday.pollingunit.added` assigns `pollingUnit: confirmationId`
--   (an EVENT-LOCAL id, never a geography_polling_units.id) and takes
--   `state`/`lga`/`ward` as raw operator-typed free text (`draft.state`
--   etc.), never validated against geography_states/geography_lgas/
--   geography_wards. Every later electionday.* event (agent/result/
--   incident) references that same event-local pollingUnit id, not a real
--   geography row. `mobilization.assignment.created`'s `ward` field is
--   identically free text (`requireText(fields.ward, ...)`, no FK).
--   There is NO relational path from any of these ten event types to the
--   real geography_* reference tables responsibility.assigned/reassigned
--   use. src/pages/election/ElectionDaySection.jsx's own code comment
--   already admits the UI's client-side filter for this data works by
--   "matching a scoped coordinator's real LGA/ward NAME against that free
--   text, case/whitespace-insensitively" — a reasonable UI convenience,
--   but not something this migration will promote to a database-level
--   security boundary (a text match is spoofable/collidable and this
--   project's own discipline is to never manufacture a security guarantee
--   from one).
--
--   THE REAL FIX — adding an authoritative geography_polling_units
--   reference to Election Day's own polling-unit record (and to
--   mobilization assignments/tasks) — is a genuine schema/product change,
--   not an RLS patch, and is explicitly out of this migration's scope.
--   Until that exists, closing this specific sub-gap via RLS would mean
--   denying scoped coordinators ALL database-level read access to
--   Election Day data (including their own, since there is no safe way
--   for SQL to know which subset is theirs) — a product-breaking
--   regression this pass was explicitly directed NOT to make unilaterally.
--   The decision to leave this ten-type family campaign-wide, as a named
--   and tracked gap pending that schema work, was made explicitly by the product owner, not assumed by this migration.
--
-- WHO IS RESTRICTED. Only a caller who currently holds an ACTIVE, SCOPED
-- responsibility — LGA_COORDINATOR / WARD_COORDINATOR / POLLING_UNIT_AGENT,
-- exactly src/domains/election/responsibility.js's
-- SCOPED_RESPONSIBILITY_ROLES (confirmed verbatim) — AND is not an
-- owner/manager (see the precedence fix immediately below).
-- CONSTITUENCY_LEAD and "no responsibility at all" remain campaign-wide,
-- matching responsibility.js's own comment (a Constituency Lead's scope
-- already IS the whole campaign under the current single-constituency
-- model).
--
-- OWNER/MANAGER PRECEDENCE FIX (final pre-commit security review finding,
-- fixed in this revision). The previous revision determined "unrestricted"
-- purely from "does this person hold NO scoped responsibility slot" —
-- true for owner/manager in the common case (they typically don't also
-- hold one), but not GUARANTEED by anything: nothing in geography/write.js
-- prevents a person who is also the owner/manager from independently being
-- assigned a scoped responsibility slot too. src/pages/election/
-- HomeSection.jsx's own real authorization logic resolves
-- `isOwnerOrManager` from `campaign_members.member_role` FIRST,
-- independently of and before any responsibility-slot check
-- (`hasNoActiveResponsibility = roleResolved && !isOwnerOrManager && ...`)
-- — so the application's own model already treats owner/manager as
-- unconditionally unrestricted, never narrowed by a responsibility slot
-- they might also hold. The previous revision's RLS did not match that:
-- it would have incorrectly narrowed such an owner/manager to their
-- slot's geography. Fixed by adding
-- `public.is_campaign_owner_or_manager()` — reusing the EXACT same
-- `campaign_members`/`member_role` source and the EXACT same
-- `is_active_campaign_member()` shape already established in
-- 20260826000000_fix_campaign_members_rls_recursion.sql (SECURITY
-- DEFINER/stable/search_path=''/schema-qualified/explicit GRANT/REVOKE),
-- querying the real `public.campaign_member_role` enum
-- (20260823000000_campaign_membership.sql: `owner`, `manager`, `staff` —
-- confirmed, no fourth value) — and checking it FIRST, before the
-- responsibility-slot check, so an owner/manager is unrestricted
-- regardless of what responsibility slot they may or may not also hold.
-- No new authorization model invented: this is the same table, same
-- column, same enum, same function shape this project already uses for
-- exactly this kind of check (compare `election_event_writable_by_role()`
-- in 20260923000000, which also reads `member_role` for an authorization
-- decision). Constituency Lead and no-responsibility members are
-- UNCHANGED by this fix — they still reach "unrestricted" via the
-- pre-existing `not exists(...)` branch, not via this new one.
--
-- BUG FOUND AND FIXED (both from the superseded drafts, both re-verified
-- here against the real code before being merged in). The naive policy
-- shape "geographyRef is null => campaign-wide" is evaluated as a single
-- OR-branch — since mobilization.person.added and responsibility.
-- status_changed both genuinely have no geographyRef field, they both
-- satisfied that blanket allowance BEFORE their own dedicated,
-- more-restrictive branches were ever reached, making those branches
-- unreachable dead code. Fixed by explicitly excluding both types from the
-- blanket null-geographyRef allowance, so they fall through to their own
-- dedicated resolution branches instead.
--
-- RLS RECURSION / SECURITY DEFINER SAFETY. All four functions below are
-- `language sql`, `stable`, `security definer`, `set search_path = ''`
-- (the empty string — stricter than merely pinning to `public`: nothing
-- resolves via search_path at all, so every single reference must be, and
-- is, schema-qualified explicitly). No dynamic SQL, no writes, no elevated
-- operation beyond reading election_events/geography_wards/geography_polling_units.
-- election_events never has FORCE ROW LEVEL SECURITY set (confirmed by
-- repo-wide search) — RLS is bypassed for the table owner for a SECURITY
-- DEFINER function's own internal reads, so these helpers see the full
-- event log internally to compute the fold, and only the OUTER policy
-- (evaluated once per row for the actual client-facing SELECT) applies the
-- resulting restriction. No recursive self-gating — the same pattern
-- already proven in 20260826000000_fix_campaign_members_rls_recursion.sql.
--
-- FUNCTION PRIVILEGES (gap found and fixed in this revision). The
-- superseded drafts defined all new SECURITY DEFINER functions with no
-- explicit GRANT/REVOKE, leaving them executable by PUBLIC by default —
-- inconsistent with this project's own established convention
-- (is_active_campaign_member(), 20260826000000's own GRANT/REVOKE block).
-- Fixed here: every function below is REVOKEd from public/anon and
-- GRANTed to authenticated only.
--
-- SECOND, MORE SERIOUS PRIVILEGE FINDING (found and fixed in this
-- revision). granting EXECUTE to `authenticated` is not optional — the
-- RLS policy's own USING clause is evaluated as the querying session's
-- role, so authenticated callers must be able to invoke these functions
-- for the policy itself to work. But that ALSO means
-- current_responsibility_geography() and current_responsibility_slot_
-- geography() are directly callable by ANY authenticated user via
-- PostgREST's own RPC exposure (`/rest/v1/rpc/<function_name>`) — NOT
-- only from within the policy. Neither function originally verified that
-- the CALLING user actually belongs to the `p_campaign_id` they pass in;
-- an authenticated member of campaign A could have called either function
-- directly with campaign B's id and an arbitrary/guessed person-ref or
-- slot-id, learning campaign B's responsibility assignments without ever
-- going through election_events' own RLS at all. Fixed by adding an
-- explicit `public.is_active_campaign_member(p_campaign_id)` guard (the
-- SAME helper 20260826000000 already established for exactly this "is
-- the calling user genuinely in this campaign" check) inside both
-- functions, returning zero rows for a non-member caller regardless of
-- what person-ref/slot-id they supply. caller_scoped_responsibility()
-- needs no separate guard — it only ever resolves the CALLING user's own
-- ref, and inherits the fix by calling the now-guarded function.
-- scope_geography_refs() needs no guard either: geography_wards/
-- geography_polling_units are already `using (true)` public-read to any
-- authenticated user (20260829000000_election_geography.sql), so resolving
-- descendants of an arbitrary real geography id via RPC discloses nothing
-- a direct table read wouldn't already.
--
-- PERFORMANCE. Every subquery is an indexed-column lookup
-- (election_events.campaign_id/type, geography_wards.lga_id,
-- geography_polling_units.ward_id — all indexed by prior migrations)
-- already narrowed to a single campaign_id by the outer permissive policy.
--
-- VERIFICATION BEFORE APPLYING (do these against a copy/staging first, not
-- directly against the shared production database):
--   1. As the existing QA owner: full campaign event list unchanged.
--   2. As a QA LGA Coordinator: election_events select returns only
--      geography-less campaign-wide events plus their own LGA's
--      responsibility/person-added/status-changed events — not another
--      LGA's.
--   3. Reassignment case: reassign a responsibility to a different LGA,
--      confirm the coordinator immediately loses access to the old LGA's
--      events and gains the new LGA's, without touching the original
--      responsibility.assigned event.
--   4. Confirm electionday.*/mobilization.assignment.*/.task.* events
--      remain visible campaign-wide to every active member, as explicitly
--      intended by this revision (not a regression — a documented,
--      deferred gap).
--   5. Owner/manager precedence: assign the QA owner/manager a scoped
--      responsibility slot (e.g. LGA Coordinator for an LGA they do not
--      normally see) and confirm their election_events read is STILL the
--      full, unrestricted campaign list — not narrowed to that slot's
--      geography.
-- ============================================================

-- Is the CALLING user (auth.uid(), never a caller-supplied id — same
-- discipline as is_active_campaign_member()) currently an active
-- owner/manager of this campaign? Reuses the SAME campaign_members table,
-- member_role column, and public.campaign_member_role enum
-- (20260823000000_campaign_membership.sql) every other membership check
-- in this project already reads — no new authorization source.
create or replace function public.is_campaign_owner_or_manager(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.person = auth.uid()
      and m.status = 'active'
      and m.member_role in ('owner', 'manager')
  );
$$;

revoke all on function public.is_campaign_owner_or_manager(uuid) from public, anon;
grant execute on function public.is_campaign_owner_or_manager(uuid) to authenticated;

-- The CURRENT holder and geography of every responsibility slot a given
-- person ref (an `invite:<campaignId>:<uid>` ref, or a raw Mobilize
-- field-roster id — this function is ref-format-agnostic, same as the
-- client's own fold) currently holds, folding responsibility.assigned and
-- responsibility.reassigned per slot, latest event wins. Mirrors
-- src/domains/election/projections.js's own projectElection() fold
-- exactly (verified field-by-field against that fold before being written).
create or replace function public.current_responsibility_geography(p_campaign_id uuid, p_person_ref text)
returns table(level text, geography_ref uuid, responsibility_role text)
language sql
stable
security definer
set search_path = ''
as $$
  with responsibility_events as (
    select
      e.payload->>'responsibility' as slot,
      e.created_at,
      coalesce(e.payload->>'newPerson', e.payload->>'person') as current_person,
      e.payload->>'level' as level,
      nullif(e.payload->>'geographyRef', '')::uuid as geography_ref,
      e.payload->>'responsibilityRole' as responsibility_role
    from public.election_events e
    where e.campaign_id = p_campaign_id
      -- CROSS-TENANT RPC GUARD: the calling user must genuinely be a
      -- member of p_campaign_id, checked independently of how this
      -- function was reached (policy or a direct RPC call) — see the
      -- "SECOND, MORE SERIOUS PRIVILEGE FINDING" note above.
      and public.is_active_campaign_member(p_campaign_id)
      and e.payload->>'type' in ('responsibility.assigned', 'responsibility.reassigned')
      and e.payload->>'responsibility' is not null
  ),
  current_slots as (
    select distinct on (slot) slot, current_person, level, geography_ref, responsibility_role
    from responsibility_events
    order by slot, created_at desc
  )
  select level, geography_ref, responsibility_role
  from current_slots
  where current_person = p_person_ref
$$;

revoke all on function public.current_responsibility_geography(uuid, text) from public, anon;
grant execute on function public.current_responsibility_geography(uuid, text) to authenticated;

-- The CURRENT geography of a given responsibility SLOT (not a person) —
-- the exact same fold as current_responsibility_geography() above, queried
-- by the slot's own id instead of by current holder. Used only for
-- responsibility.status_changed events, which carry no geography of their
-- own (see taxonomy above).
create or replace function public.current_responsibility_slot_geography(p_campaign_id uuid, p_responsibility_id text)
returns table(level text, geography_ref uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.payload->>'level', nullif(e.payload->>'geographyRef', '')::uuid
  from public.election_events e
  where e.campaign_id = p_campaign_id
    -- CROSS-TENANT RPC GUARD: same reasoning as
    -- current_responsibility_geography() above.
    and public.is_active_campaign_member(p_campaign_id)
    and e.payload->>'type' in ('responsibility.assigned', 'responsibility.reassigned')
    and e.payload->>'responsibility' = p_responsibility_id
  order by e.created_at desc
  limit 1
$$;

revoke all on function public.current_responsibility_slot_geography(uuid, text) from public, anon;
grant execute on function public.current_responsibility_slot_geography(uuid, text) to authenticated;

-- The caller's own current scoped responsibility for a campaign, or no
-- rows if they hold none (owner/manager/no responsibility/Constituency
-- Lead all resolve zero rows here, by design — see header). Always
-- resolves auth.uid() itself, never a caller-supplied id.
create or replace function public.caller_scoped_responsibility(p_campaign_id uuid)
returns table(level text, geography_ref uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.level, c.geography_ref
  from public.current_responsibility_geography(p_campaign_id, 'invite:' || p_campaign_id::text || ':' || auth.uid()::text) c
  where c.responsibility_role in ('LGA_COORDINATOR', 'WARD_COORDINATOR', 'POLLING_UNIT_AGENT')
  limit 1
$$;

revoke all on function public.caller_scoped_responsibility(uuid) from public, anon;
grant execute on function public.caller_scoped_responsibility(uuid) to authenticated;

-- self + real geography descendants (LGA -> its wards -> their polling
-- units; ward -> its polling units; polling unit -> itself). Mirrors
-- geography/read.js's getScopeGeographyRefs() exactly (verified branch by
-- branch before being written).
create or replace function public.scope_geography_refs(p_level text, p_geography_ref uuid)
returns table(geography_ref uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p_geography_ref
  where p_geography_ref is not null
  union
  select w.id from public.geography_wards w where p_level = 'lga' and w.lga_id = p_geography_ref
  union
  select pu.id from public.geography_polling_units pu
    join public.geography_wards w on w.id = pu.ward_id
    where p_level = 'lga' and w.lga_id = p_geography_ref
  union
  select pu.id from public.geography_polling_units pu where p_level = 'ward' and pu.ward_id = p_geography_ref
$$;

revoke all on function public.scope_geography_refs(text, uuid) from public, anon;
grant execute on function public.scope_geography_refs(text, uuid) to authenticated;

drop policy if exists "election events geography scope for scoped responsibility" on election_events;

create policy "election events geography scope for scoped responsibility" on election_events
  as restrictive
  for select using (
    -- OWNER/MANAGER PRECEDENCE: checked FIRST, unconditionally — an
    -- owner/manager is unrestricted even if they also independently hold
    -- a scoped responsibility slot (see "OWNER/MANAGER PRECEDENCE FIX"
    -- above). Short-circuits before the responsibility-slot check below
    -- is ever evaluated for them.
    public.is_campaign_owner_or_manager(election_events.campaign_id)
    -- Constituency Lead/no-responsibility: unrestricted (unchanged).
    or not exists (select 1 from public.caller_scoped_responsibility(election_events.campaign_id))
    -- Geography-less events stay campaign-wide for a scoped caller too —
    -- EXCEPT the two types whose geography is resolvable via a dedicated
    -- branch below (fixes the dead-code bug described above). Every
    -- electionday.*/mobilization.assignment.*/.task.* type intentionally
    -- falls through this branch too — see the taxonomy above for why that
    -- is a deliberate, documented, deferred decision, not an oversight.
    or (
      (election_events.payload->>'geographyRef') is null
      and (election_events.payload->>'type') not in ('mobilization.person.added', 'responsibility.status_changed')
    )
    -- responsibility.assigned / responsibility.reassigned: direct
    -- authoritative geographyRef, checked against the caller's own scope
    -- and its real descendants.
    or (election_events.payload->>'geographyRef')::uuid in (
      select geography_ref from public.scope_geography_refs(
        (select level from public.caller_scoped_responsibility(election_events.campaign_id)),
        (select geography_ref from public.caller_scoped_responsibility(election_events.campaign_id))
      )
    )
    -- mobilization.person.added: resolved via the referenced person's
    -- CURRENT responsibility geography.
    or (
      election_events.payload->>'type' = 'mobilization.person.added'
      and exists (
        select 1
        from public.current_responsibility_geography(election_events.campaign_id, election_events.payload->>'person') crg
        where crg.geography_ref in (
          select geography_ref from public.scope_geography_refs(
            (select level from public.caller_scoped_responsibility(election_events.campaign_id)),
            (select geography_ref from public.caller_scoped_responsibility(election_events.campaign_id))
          )
        )
      )
    )
    -- responsibility.status_changed: resolved via its own slot's CURRENT
    -- geography (the slot's most recent assigned/reassigned event).
    or (
      election_events.payload->>'type' = 'responsibility.status_changed'
      and exists (
        select 1
        from public.current_responsibility_slot_geography(election_events.campaign_id, election_events.payload->>'responsibility') crsg
        where crsg.geography_ref in (
          select geography_ref from public.scope_geography_refs(
            (select level from public.caller_scoped_responsibility(election_events.campaign_id)),
            (select geography_ref from public.caller_scoped_responsibility(election_events.campaign_id))
          )
        )
      )
    )
  );
