-- ============================================================
-- ELECTIONCANON 1.1.1 PHASE A — INVITATION-FIRST EXPERIENCE
--
-- Extends public.get_invitation_preview(text) (originally
-- 20260831000000_election_campaign_invitations.sql, most recently
-- redefined by 20260902000000_election_invitation_geography_state_
-- context.sql) with exactly ONE additive column: invited_by_name — the
-- inviter's real profiles.display_name, resolved server-side from the
-- invitation's own campaign_invitations.invited_by (uuid references
-- auth.users(id)) the same way every other "who is this person" read in
-- this project already resolves identity (see OrganisationSection.jsx's
-- resolveMemberDisplayName() and the election-invitation-email edge
-- function's own callerProfile lookup).
--
-- WHY THIS COLUMN AND NOT invited_email: this function is
-- UNAUTHENTICATED-SAFE (granted to anon) — the design-audit approval for
-- this pass explicitly preserves the existing posture that it "never
-- exposes the token or email" (see the 20260902 migration's own comment
-- on function, carried into this one unchanged). Adding invited_by_name
-- does not touch that posture: a display name a campaign owner already
-- chose to show teammates is not equivalent to exposing the INVITED
-- person's own private email address to anyone who has the link.
--
-- NO EMAIL FALLBACK. Unlike the invitation-email edge function's own
-- inviter-name resolution (which may fall back to the inviter's raw
-- email because that path only ever sends TO a private inbox, never
-- renders to an open web page), invited_by_name here falls back to NULL
-- when the inviter has no display_name set. Falling back to their email
-- on a page reachable by anyone holding the token would be a NEW leak
-- this migration must not introduce. Callers render "Invited by" only
-- when the value is present, never a raw address.
--
-- No table changed, no RLS changed, no grant surface changed beyond the
-- required re-grant this function's own signature always needs after a
-- DROP+CREATE (Postgres requires dropping first when a function's RETURNS
-- TABLE shape changes, not just its body — same requirement the 20260902
-- migration already worked around the same way).
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

  if v_inv.invited_by is not null then
    select nullif(btrim(p.display_name), '') into v_inviter_name
      from public.profiles p where p.id = v_inv.invited_by;
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
  'Unauthenticated-safe invitation preview, resolved from the real campaign_invitations row and the real canonical geography tables (never fabricated). geography_name is the leaf name/code; geography_state_name/geography_lga_name/geography_ward_name are ancestor context. invited_by_name (ELECTIONCANON 1.1.1 PHASE A) is the inviter''s real profiles.display_name, or null if they never set one -- NEVER falls back to their email, since unlike the invitation-email path this function is reachable by anyone holding the token. This function still never returns invited_email or token.';
