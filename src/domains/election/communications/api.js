// ============================================================
// FORGE ELECTION — COMMUNICATIONS  (Gate A.5.1 object model + Gate A.5.2
// native review / approval workflow)
//
// Direct RLS-protected CRUD for the mutable-drafting half of this table
// set (communications, communication_assets, language_variants) — the
// SAME category campaign_studio_assets/chat already occupy: drafting a
// communication is not a Canon fact requiring PREPARE/APPROVE, it is
// ordinary operational state.
//
// GATE A.5.2 — reviews/approvals are no longer direct client inserts.
// supabase/migrations/20260907000000_election_communications_review_
// workflow.sql drops their client INSERT/UPDATE policies entirely — the
// ONLY way a new review/approval row (or a language_variant workflow-
// status transition) can be created is through the four SECURITY DEFINER
// RPCs this file wraps below (submit_language_variant_for_review,
// record_review, record_approval, revoke_approval). This file never
// re-derives or duplicates the authorization those RPCs already enforce
// server-side (drafter exclusion, reviewer capability, owner/manager-only
// approval, reviewer =/= approver) — it only forwards the call and
// reports whatever the database decides, exactly like every other write
// in this codebase treats server-side authorization as authoritative over
// whatever the client believes.
//
// language_variants.status is a current-state PROJECTION, mirroring
// responsibility_slots' own documented contract — this file's own
// updateLanguageVariant() can still edit `text` (RLS/column-grants permit
// this only while status is draft/changes_requested), but it can NEVER
// change `status` itself; that column is not even in the client's UPDATE
// grant (see the migration's own header for exactly why one gate alone —
// UI, RLS, or a GRANT — is never treated as sufficient on its own here).
// ============================================================

import { SUPPORTED_LANGUAGES } from "../../../os/i18n.js";

export const COMMUNICATION_STATUS = Object.freeze({ DRAFT: "draft" });
export const VARIANT_STATUS = Object.freeze({
  DRAFT: "draft", IN_REVIEW: "in_review", CHANGES_REQUESTED: "changes_requested", APPROVED: "approved",
});
export const REVIEW_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" });
export const APPROVAL_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", REVOKED: "revoked" });

// ElectionCanon's six target languages (docs/electioncanon's brief) are a
// SUBSET of i18n.js's own SUPPORTED_LANGUAGES (which also carries French
// for the wider ForgeOS platform) — filtered here rather than re-typed, so
// a label never drifts out of sync with the one place labels are already
// declared.
const COMMUNICATION_LANGUAGE_CODES = Object.freeze(["en", "yo", "ha", "ig", "pcm", "urh"]);
export const COMMUNICATION_LANGUAGES = Object.freeze(
  SUPPORTED_LANGUAGES.filter((l) => COMMUNICATION_LANGUAGE_CODES.includes(l.code)),
);

const COMMUNICATION_COLUMNS = "id, campaign_id, title, brief, master_text, status, created_by, created_at, updated_at";
const VARIANT_COLUMNS = "id, communication_id, campaign_id, language, text, status, created_by, created_at, updated_at";
const REVIEW_COLUMNS = "id, language_variant_id, campaign_id, reviewer_id, status, notes, created_at, updated_at";
const APPROVAL_COLUMNS = "id, language_variant_id, campaign_id, approver_id, status, notes, created_at, updated_at";
const MEMBER_LANGUAGE_COLUMNS = "id, campaign_id, person, language, created_at, created_by";

// ---------- Communication ----------

export async function createCommunication({ client, userId, campaignId, title, brief = null, masterText = null }) {
  const clean = String(title ?? "").trim();
  if (!clean) return { communication: null, error: "A communication needs a title" };
  const { data, error } = await client
    .from("communications")
    .insert({ campaign_id: campaignId, title: clean, brief, master_text: masterText, status: COMMUNICATION_STATUS.DRAFT, created_by: userId })
    .select(COMMUNICATION_COLUMNS)
    .maybeSingle();
  if (error) return { communication: null, error: error.message };
  return { communication: data, error: null };
}

export async function listCommunications({ client, campaignId }) {
  const { data, error } = await client
    .from("communications")
    .select(COMMUNICATION_COLUMNS)
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false });
  if (error) return { communications: [], error: error.message };
  return { communications: data ?? [], error: null };
}

export async function getCommunication({ client, communicationId }) {
  const { data, error } = await client
    .from("communications")
    .select(COMMUNICATION_COLUMNS)
    .eq("id", communicationId)
    .maybeSingle();
  if (error) return { communication: null, error: error.message };
  return { communication: data, error: null };
}

export async function updateCommunication({ client, communicationId, title, brief, masterText }) {
  const patch = { updated_at: new Date().toISOString() };
  if (title != null) patch.title = String(title).trim();
  if (brief !== undefined) patch.brief = brief;
  if (masterText !== undefined) patch.master_text = masterText;
  const { data, error } = await client
    .from("communications")
    .update(patch)
    .eq("id", communicationId)
    .select(COMMUNICATION_COLUMNS)
    .maybeSingle();
  if (error) return { communication: null, error: error.message };
  return { communication: data, error: null };
}

// ---------- Communication <-> existing Studio asset(s) ----------
// References only, by id — never copies campaign_studio_assets.content
// into this table. The migration's own composite foreign keys are the
// real guarantee against a cross-campaign attach; this function attempts
// the write and reports whatever the database decides, exactly like every
// other write in this codebase treats a constraint violation as the
// authoritative answer rather than pre-guessing it client-side.
export async function attachAsset({ client, campaignId, communicationId, assetId, position = 0 }) {
  const { data, error } = await client
    .from("communication_assets")
    .insert({ communication_id: communicationId, campaign_id: campaignId, asset_id: assetId, position })
    .select("communication_id, campaign_id, asset_id, position, created_at")
    .maybeSingle();
  if (error) return { link: null, error: error.message };
  return { link: data, error: null };
}

export async function listCommunicationAssets({ client, communicationId }) {
  const { data, error } = await client
    .from("communication_assets")
    .select("communication_id, campaign_id, asset_id, position, created_at")
    .eq("communication_id", communicationId)
    .order("position", { ascending: true });
  if (error) return { links: [], error: error.message };
  return { links: data ?? [], error: null };
}

export async function detachAsset({ client, communicationId, assetId }) {
  const { error } = await client
    .from("communication_assets")
    .delete()
    .eq("communication_id", communicationId)
    .eq("asset_id", assetId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

// ---------- Language Variant ----------

export async function createLanguageVariant({ client, userId, campaignId, communicationId, language, text = "" }) {
  if (!COMMUNICATION_LANGUAGE_CODES.includes(language)) {
    return { variant: null, error: `"${language}" is not one of ElectionCanon's six supported languages` };
  }
  const { data, error } = await client
    .from("language_variants")
    .insert({ communication_id: communicationId, campaign_id: campaignId, language, text, status: VARIANT_STATUS.DRAFT, created_by: userId })
    .select(VARIANT_COLUMNS)
    .maybeSingle();
  if (error) return { variant: null, error: error.message };
  return { variant: data, error: null };
}

export async function listLanguageVariants({ client, communicationId }) {
  const { data, error } = await client
    .from("language_variants")
    .select(VARIANT_COLUMNS)
    .eq("communication_id", communicationId)
    .order("created_at", { ascending: true });
  if (error) return { variants: [], error: error.message };
  return { variants: data ?? [], error: null };
}

// GATE A.5.2 — text is editable only while draft/changes_requested. This
// function does not itself re-check that: the column-grant + RLS the
// migration adds are the actual enforcement (a client attempt to update
// an in_review/approved row's text, or to sneak `status` into the SET
// list at all, is rejected by Postgres before this call could ever
// succeed) — the UI-level status check is a courtesy, not the gate.
export async function updateLanguageVariant({ client, variantId, text }) {
  const { data, error } = await client
    .from("language_variants")
    .update({ text, updated_at: new Date().toISOString() })
    .eq("id", variantId)
    .select(VARIANT_COLUMNS)
    .maybeSingle();
  if (error) return { variant: null, error: error.message };
  return { variant: data, error: null };
}

// ---------- Gate A.5.2 workflow RPCs ----------
// Each forwards to its SECURITY DEFINER function and unwraps the jsonb
// result. Every authorization/state rule lives in the RPC itself (see the
// migration's own header) — these wrappers add no logic of their own.

export async function submitLanguageVariantForReview({ client, variantId }) {
  const { data, error } = await client.rpc("submit_language_variant_for_review", { p_variant_id: variantId });
  if (error) return { variant: null, alreadyInReview: false, error: error.message };
  const { alreadyInReview, ...variant } = data ?? {};
  return { variant, alreadyInReview: Boolean(alreadyInReview), error: null };
}

export async function recordReview({ client, variantId, status, notes = null }) {
  const { data, error } = await client.rpc("record_review", { p_variant_id: variantId, p_status: status, p_notes: notes });
  if (error) return { review: null, variant: null, error: error.message };
  return { review: data?.review ?? null, variant: data?.variant ?? null, error: null };
}

export async function recordApproval({ client, variantId, notes = null }) {
  const { data, error } = await client.rpc("record_approval", { p_variant_id: variantId, p_notes: notes });
  if (error) return { approval: null, variant: null, error: error.message };
  return { approval: data?.approval ?? null, variant: data?.variant ?? null, error: null };
}

export async function revokeApproval({ client, variantId, reason }) {
  const { data, error } = await client.rpc("revoke_approval", { p_variant_id: variantId, p_reason: reason });
  if (error) return { approval: null, variant: null, error: error.message };
  return { approval: data?.approval ?? null, variant: data?.variant ?? null, error: null };
}

// ---------- Review / Approval history (read-only ledger) ----------

export async function listReviews({ client, languageVariantId }) {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("language_variant_id", languageVariantId)
    .order("created_at", { ascending: false });
  if (error) return { reviews: [], error: error.message };
  return { reviews: data ?? [], error: null };
}

export async function listApprovals({ client, languageVariantId }) {
  const { data, error } = await client
    .from("approvals")
    .select(APPROVAL_COLUMNS)
    .eq("language_variant_id", languageVariantId)
    .order("created_at", { ascending: false });
  if (error) return { approvals: [], error: error.message };
  return { approvals: data ?? [], error: null };
}

// ---------- Campaign member language capability (Gate A.5.2) ----------
// Campaign-scoped only — never a profile-wide skill. Grant/revoke are
// owner/manager-authorized server-side (the migration's own RLS); these
// functions do not re-derive that, they only forward the write.

export async function listCampaignMemberLanguages({ client, campaignId }) {
  const { data, error } = await client
    .from("campaign_member_languages")
    .select(MEMBER_LANGUAGE_COLUMNS)
    .eq("campaign_id", campaignId);
  if (error) return { capabilities: [], error: error.message };
  return { capabilities: data ?? [], error: null };
}

export async function grantMemberLanguage({ client, campaignId, person, language, grantedBy }) {
  const { data, error } = await client
    .from("campaign_member_languages")
    .insert({ campaign_id: campaignId, person, language, created_by: grantedBy })
    .select(MEMBER_LANGUAGE_COLUMNS)
    .maybeSingle();
  if (error) return { capability: null, error: error.message };
  return { capability: data, error: null };
}

export async function revokeMemberLanguage({ client, campaignId, person, language }) {
  const { error } = await client
    .from("campaign_member_languages")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("person", person)
    .eq("language", language);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export default {
  COMMUNICATION_STATUS, VARIANT_STATUS, REVIEW_STATUS, APPROVAL_STATUS, COMMUNICATION_LANGUAGES,
  createCommunication, listCommunications, getCommunication, updateCommunication,
  attachAsset, listCommunicationAssets, detachAsset,
  createLanguageVariant, listLanguageVariants, updateLanguageVariant,
  submitLanguageVariantForReview, recordReview, recordApproval, revokeApproval,
  listReviews, listApprovals,
  listCampaignMemberLanguages, grantMemberLanguage, revokeMemberLanguage,
};
