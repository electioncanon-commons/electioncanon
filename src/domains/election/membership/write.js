// ============================================================
// ELECTIONCANON — CAMPAIGN MEMBERSHIP: REVOCATION  (pilot safety pass)
//
// revokeCampaignMember() is a thin RPC wrapper, same shape as
// invitations/write.js's revokeInvitation() — all authorization logic
// (owner may revoke manager/staff, manager may revoke staff only, staff
// may revoke nobody, self-revocation and owner-target revocation always
// refused, already-revoked target is a safe no-op) lives in
// revoke_campaign_member() itself (supabase/migrations/20260923000000_
// election_membership_revocation_and_write_rbac.sql), not here. This
// file adds no second copy of that decision.
//
// campaign_members has no client UPDATE/DELETE policy of any kind — this
// SECURITY DEFINER RPC is the only controlled membership-transition path
// that exists, matching ensure_campaign_owner()'s own precedent for
// membership creation.
// ============================================================

export async function revokeCampaignMember({ client, campaignId, targetPersonId }) {
  const { data, error } = await client.rpc("revoke_campaign_member", {
    p_campaign_id: campaignId, p_target_person: targetPersonId,
  });
  if (error) return { revoked: false, member: null, error: error.message };
  const member = Array.isArray(data) ? data[0] : data;
  return { revoked: true, member: member ?? null, error: null };
}

export default { revokeCampaignMember };
