-- ============================================================
-- ELECTIONCANON 1.1.1 PHASE A — CORRECTIVE MIGRATION
--
-- Supersedes 20260904000000_election_invitation_preview_inviter_context.sql,
-- which was committed (commit f4072a87f334769b787a0c3d594ca1d2a132ac9a) but
-- NEVER APPLIED to production, after a read-only forensic audit found that
-- public.profiles -- the table that migration's invited_by_name lookup
-- depended on -- does not exist anywhere in the ElectionCanon Supabase
-- project (lncwkjlgakonokwboxdp). Confirmed directly: zero rows for
-- information_schema.tables/pg_class matching 'profiles' in any schema of
-- THIS project, and zero rows for pg_proc matching 'ensure_profile'. The
-- table, its provisioning RPC, and its trigger are real -- they exist and
-- are correctly set up in a DIFFERENT, sibling Supabase project ("Forge
-- Platform", riowvixviurhpypyzlvi) that src/pages/Access.jsx's own header
-- already documents as the actual origin of that shared identity schema
-- ("...the shared `profiles` table this identity system was built
-- against (see supabase/migrations/20260813000200_identity.sql in the
-- source monorepo this was extracted from)") -- it was simply never
-- migrated into ElectionCanon's own, separately-created project. That is
-- a project-provisioning gap, not something this migration attempts to
-- close; closing it would mean standing up a whole table+RPC+trigger
-- subsystem, far outside one column's scope.
--
-- THE FIX: invited_by_name now resolves from
-- auth.users.raw_user_meta_data ->> 'display_name' instead. This is not a
-- new pattern for this function family -- accept_campaign_invitation()
-- (live in production since 20260831000000_election_campaign_invitations.
-- sql, unchanged by this migration) already does
-- `select email into v_email from auth.users where id = v_uid;` directly
-- inside a SECURITY DEFINER function with the same `set search_path = ''`
-- discipline this function already uses. Reading one more column off the
-- same already-accessed table, the same way, is consistent with an
-- established, safe, already-shipped pattern, not a new one. Confirmed
-- directly against production auth.users: raw_user_meta_data carries a
-- real, non-empty display_name key for existing users, written by
-- ForgeIdentity.jsx's register() via supabase.auth.signUp()'s own
-- options.data at account creation -- the SAME value the broken profiles
-- path was always meant to read, just correctly sourced this time.
--
-- ONLY raw_user_meta_data ->> 'display_name' is ever read here -- never
-- auth.users.email, never raw_user_meta_data as a whole column. No email
-- fallback exists (unchanged from the original migration's own posture):
-- an inviter with no display_name set resolves to NULL, exactly as
-- before, and callers already render "Invited by" only when the value is
-- present. invited_email and token are still never returned by this
-- function -- unaffected by this change.
--
-- Everything else -- campaign_name resolution, all four geography
-- branches, status/expires_at, the grant shape, and every other function
-- in this project (create/accept/revoke_campaign_invitation) -- is
-- byte-for-byte identical to the original 20260904000000 migration and to
-- what is live in production today. No table changed, no RLS changed, no
-- data modified. get_invitation_preview() remains the only function
-- replaced; invited_by_name remains the only new return field.
-- ============================================================

drop function if exists public.get_invitation_preview(text);

create or replace function public.get_invitation_preview(p_token text)
returns table (
  campaign_id uuid, campaign_name text, invited_name text,
  intended_member_role text, intended_responsibility_role text,
  intended_level text, intended_geography_ref text, geography_name text,
  geography_state_name text, geography_lga_name text, geography_ward_name text,
  status text, expires_at timestamptz, invited_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.campaign_invitations;
  v_campaign_name text;
  v_geo_name text;
  v_state_name text;
  v_lga_name text;
  v_ward_name text;
  v_inviter_name text;
begin
  select * into v_inv from public.campaign_invitations where token = p_token;
  if not found then
    return;
  end if;

  select c.name into v_campaign_name from public.campaigns c where c.id = v_inv.campaign_id;

  -- CORRECTED SOURCE: auth.users.raw_user_meta_data ->> 'display_name',
  -- not public.profiles (which does not exist in this project -- see this
  -- migration's own header). Only that single jsonb key is ever read --
  -- never auth.users.email, never raw_user_meta_data as a whole value.
  -- nullif(btrim(...), '') normalizes both a missing key (->> already
  -- yields sql null) and a blank/whitespace-only value to null, exactly
  -- matching the original migration's own "no display name set -> null,
  -- never an email fallback" behavior.
  if v_inv.invited_by is not null then
    select nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') into v_inviter_name
      from auth.users u where u.id = v_inv.invited_by;
  end if;

  if v_inv.intended_level = 'constituency' then
    select gc.name, gs.name
      into v_geo_name, v_state_name
      from public.geography_constituencies gc
      join public.geography_states gs on gs.code = gc.state_code
      where gc.id::text = v_inv.intended_geography_ref;

  elsif v_inv.intended_level = 'lga' then
    select gl.name, gs.name
      into v_geo_name, v_state_name
      from public.geography_lgas gl
      join public.geography_states gs on gs.code = gl.state_code
      where gl.id::text = v_inv.intended_geography_ref;

  elsif v_inv.intended_level = 'ward' then
    select gw.name, gl.name, gs.name
      into v_geo_name, v_lga_name, v_state_name
      from public.geography_wards gw
      join public.geography_lgas gl on gl.id = gw.lga_id
      join public.geography_states gs on gs.code = gl.state_code
      where gw.id::text = v_inv.intended_geography_ref;

  elsif v_inv.intended_level = 'polling_unit' then
    select gp.code, gw.name, gl.name, gs.name
      into v_geo_name, v_ward_name, v_lga_name, v_state_name
      from public.geography_polling_units gp
      join public.geography_wards gw on gw.id = gp.ward_id
      join public.geography_lgas gl on gl.id = gw.lga_id
      join public.geography_states gs on gs.code = gl.state_code
      where gp.id::text = v_inv.intended_geography_ref;
  end if;

  return query select v_inv.campaign_id, v_campaign_name, v_inv.invited_name, v_inv.intended_member_role,
    v_inv.intended_responsibility_role, v_inv.intended_level, v_inv.intended_geography_ref, v_geo_name,
    v_state_name, v_lga_name, v_ward_name,
    v_inv.status, v_inv.expires_at, v_inviter_name;
end;
$$;

revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to authenticated;
grant execute on function public.get_invitation_preview(text) to anon;

comment on function public.get_invitation_preview(text) is
  'Unauthenticated-safe invitation preview, resolved from the real campaign_invitations row and the real canonical geography tables (never fabricated). geography_name is the leaf name/code; geography_state_name/geography_lga_name/geography_ward_name are ancestor context. invited_by_name (ELECTIONCANON 1.1.1 PHASE A, corrected 20260904010000) is the inviter''s real auth.users.raw_user_meta_data ->> ''display_name'', or null if they never set one -- NEVER falls back to their email. public.profiles does not exist in this project and is never referenced. This function still never returns invited_email or token.';
