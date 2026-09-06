// ============================================================
// FORGE ELECTION — COMMUNICATIONS  (Gate A.5.1: Communication Object Model)
//
// Direct RLS-protected CRUD for the mutable-drafting half of this table
// set (communications, communication_assets, language_variants) — the
// SAME category campaign_studio_assets/chat already occupy, and for the
// same reason (see supabase/migrations/20260906000000_election_
// communications.sql's own header): drafting a communication is not a
// Canon fact requiring PREPARE/APPROVE, it is ordinary operational state.
//
// reviews/approvals are still plain inserts/updates from here too — this
// file does not reimplement PREPARE/APPROVE for them — but the migration's
// own RLS is what actually enforces the one invariant that matters this
// gate: a reviewer/approver can never be the language_variant's own
// author. This file never re-derives or bypasses that check; it only
// forwards `reviewerId`/`approverId` through to a write RLS will accept or
// reject on its own terms, exactly like every other write in this
// codebase treats server-side authorization as authoritative over
// whatever the client believes.
//
// GATE A.5.1 SCOPE, DELIBERATELY NARROW. No channel variants, no
// scheduling, no publication, no measurement, no machine translation — a
// language_variant's `text` is always exactly what a human typed or
// pasted here, never a claim this module produced it. Full review/
// approval workflow (assignment, re-review, rejection returning a variant
// to draft) is A.5.2 — this file proves the object model and the
// non-self-review/approval invariant, nothing more.
// ============================================================

import { SUPPORTED_LANGUAGES } from "../../../os/i18n.js";

export const COMMUNICATION_STATUS = Object.freeze({ DRAFT: "draft" });
export const VARIANT_STATUS = Object.freeze({ DRAFT: "draft" });
export const REVIEW_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" });
export const APPROVAL_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" });

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
const APPROVAL_COLUMNS = "id, language_variant_id, campaign_id, approver_id, status, created_at, updated_at";

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

// ---------- Review (native-language review, per language_variant) ----------
// DRAFTER =/= REVIEWER is NOT re-checked here — it is enforced by the
// migration's own INSERT policy on `reviews`, which independently reads
// language_variants.created_by server-side. This function forwards the
// caller's own auth identity as reviewerId; it never asserts a review on
// someone else's behalf, and never second-guesses what RLS decides.
export async function createReview({ client, campaignId, languageVariantId, reviewerId, status = REVIEW_STATUS.PENDING, notes = null }) {
  const { data, error } = await client
    .from("reviews")
    .insert({ language_variant_id: languageVariantId, campaign_id: campaignId, reviewer_id: reviewerId, status, notes })
    .select(REVIEW_COLUMNS)
    .maybeSingle();
  if (error) return { review: null, error: error.message };
  return { review: data, error: null };
}

export async function listReviews({ client, languageVariantId }) {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("language_variant_id", languageVariantId)
    .order("created_at", { ascending: false });
  if (error) return { reviews: [], error: error.message };
  return { reviews: data ?? [], error: null };
}

// ---------- Approval (distinct from review, per language_variant) ----------
// GATE A.5.1 — NOT owner/manager-restricted yet (see the migration's own
// comment on the approvals table). Any active campaign member who is not
// the variant's own author may record one; A.5.2 must add the owner/
// manager check to the migration's INSERT policy, not here — this
// function's job is only ever to forward a write and report what RLS
// decided, never to duplicate authorization logic client-side.
export async function createApproval({ client, campaignId, languageVariantId, approverId, status = APPROVAL_STATUS.PENDING }) {
  const { data, error } = await client
    .from("approvals")
    .insert({ language_variant_id: languageVariantId, campaign_id: campaignId, approver_id: approverId, status })
    .select(APPROVAL_COLUMNS)
    .maybeSingle();
  if (error) return { approval: null, error: error.message };
  return { approval: data, error: null };
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

export default {
  COMMUNICATION_STATUS, VARIANT_STATUS, REVIEW_STATUS, APPROVAL_STATUS, COMMUNICATION_LANGUAGES,
  createCommunication, listCommunications, getCommunication, updateCommunication,
  attachAsset, listCommunicationAssets, detachAsset,
  createLanguageVariant, listLanguageVariants, updateLanguageVariant,
  createReview, listReviews, createApproval, listApprovals,
};
