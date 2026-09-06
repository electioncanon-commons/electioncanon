// ============================================================
// ELECTIONCANON — GATE A.5.2: NATIVE REVIEW / APPROVAL WORKFLOW
//
// A fake Supabase client exercising src/domains/election/communications/
// api.js's Gate A.5.2 additions directly — no live database, same
// convention as election-communications.consumer.mjs. The fake client's
// `.rpc()` handler REIMPLEMENTS the exact authorization/state rules the
// real SECURITY DEFINER functions enforce (supabase/migrations/
// 20260907000000_election_communications_review_workflow.sql), so this
// file proves the JS layer forwards calls faithfully and surfaces
// rejections honestly, not that Postgres itself behaves correctly (this
// repository has no live-DB test harness anywhere — see every other
// consumer test's own header).
//
// Run: node test/election-communications-review-workflow.consumer.mjs
// ============================================================

import {
  createCommunication, createLanguageVariant, listLanguageVariants, updateLanguageVariant,
  submitLanguageVariantForReview, recordReview, recordApproval, revokeApproval,
  listReviews, listApprovals, listCampaignMemberLanguages, grantMemberLanguage, revokeMemberLanguage,
  VARIANT_STATUS,
} from "../src/domains/election/communications/api.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.2: native review / approval workflow\n");

// ---------- fake client: reimplements the RPCs' own rules ----------

function fakeClient() {
  const db = {
    campaigns: [], campaign_members: [], communications: [], language_variants: [],
    reviews: [], approvals: [], campaign_member_languages: [],
  };
  let seq = 0;
  const err = (message) => ({ data: null, error: { message } });

  function isActiveMember(campaignId, person) {
    return db.campaign_members.some((m) => m.campaign_id === campaignId && m.person === person && m.status === "active");
  }
  function isOwnerOrManager(campaignId, person) {
    return db.campaign_members.some((m) => m.campaign_id === campaignId && m.person === person && m.status === "active"
      && (m.member_role === "owner" || m.member_role === "manager"));
  }
  function hasCapability(campaignId, person, language) {
    return isOwnerOrManager(campaignId, person)
      || db.campaign_member_languages.some((c) => c.campaign_id === campaignId && c.person === person && c.language === language);
  }

  const rpc = {
    submit_language_variant_for_review({ p_variant_id }, uid) {
      const v = db.language_variants.find((x) => x.id === p_variant_id);
      if (!v) return err("language variant not found");
      if (!isActiveMember(v.campaign_id, uid)) return err("you are not an active member of this campaign");
      if (v.created_by !== uid) return err("only the drafter who created this variant may submit it for review");
      if (v.status === "in_review") return { data: { ...v, alreadyInReview: true }, error: null };
      if (!["draft", "changes_requested"].includes(v.status)) return err(`a variant with status "${v.status}" cannot be submitted for review directly`);
      v.status = "in_review";
      v.updated_at = new Date(Date.now() + (++seq)).toISOString(); // the current cycle's own start stamp
      return { data: { ...v, alreadyInReview: false }, error: null };
    },
    record_review({ p_variant_id, p_status, p_notes }, uid) {
      if (!["approved", "rejected"].includes(p_status)) return err("a review status must be approved or rejected");
      if (p_status === "rejected" && (!p_notes || !p_notes.trim())) return err("a rejected review requires non-empty notes");
      const v = db.language_variants.find((x) => x.id === p_variant_id);
      if (!v) return err("language variant not found");
      if (!isActiveMember(v.campaign_id, uid)) return err("you are not an active member of this campaign");
      if (v.created_by === uid) return err("the drafter of a variant may not review their own work");
      if (!hasCapability(v.campaign_id, uid, v.language)) return err("you are not authorised to review this language for this campaign");
      if (v.status !== "in_review") return err("this variant is not currently in review");
      const review = { id: `review-${++seq}`, language_variant_id: p_variant_id, campaign_id: v.campaign_id, reviewer_id: uid, status: p_status, notes: p_notes, created_at: new Date(Date.now() + seq).toISOString() };
      db.reviews.push(review);
      if (p_status === "rejected") { v.status = "changes_requested"; v.updated_at = new Date(Date.now() + (++seq)).toISOString(); }
      return { data: { review, variant: { ...v } }, error: null };
    },
    // GATE A.5.2 PHASE 1.6 FIX — the qualifying review must belong to the
    // CURRENT in_review cycle (created_at >= v.updated_at), not merely be
    // the globally latest row. See election-communications-stale-review-
    // regression.consumer.mjs for the dedicated regression coverage of
    // exactly this rule.
    record_approval({ p_variant_id, p_notes }, uid) {
      const v = db.language_variants.find((x) => x.id === p_variant_id);
      if (!v) return err("language variant not found");
      if (!isActiveMember(v.campaign_id, uid)) return err("you are not an active member of this campaign");
      if (!isOwnerOrManager(v.campaign_id, uid)) return err("only the campaign owner or manager may approve a language variant");
      if (v.created_by === uid) return err("the drafter of a variant may not approve their own work");
      if (v.status !== "in_review") return err("this variant is not currently awaiting approval");
      const qualifying = db.reviews
        .filter((r) => r.language_variant_id === p_variant_id && r.created_at >= v.updated_at)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
      if (!qualifying || qualifying.status !== "approved") return err("this variant does not have a currently-approved review for its current review cycle");
      if (qualifying.reviewer_id === uid) return err("the approver must be a different person from the reviewer");
      const approval = { id: `approval-${++seq}`, language_variant_id: p_variant_id, campaign_id: v.campaign_id, approver_id: uid, status: "approved", notes: p_notes ?? null, created_at: new Date(Date.now() + seq).toISOString() };
      db.approvals.push(approval);
      v.status = "approved";
      v.updated_at = new Date(Date.now() + (++seq)).toISOString();
      return { data: { approval, variant: { ...v } }, error: null };
    },
    revoke_approval({ p_variant_id, p_reason }, uid) {
      if (!p_reason || !p_reason.trim()) return err("revoking an approval requires a non-empty reason");
      const v = db.language_variants.find((x) => x.id === p_variant_id);
      if (!v) return err("language variant not found");
      if (!isActiveMember(v.campaign_id, uid)) return err("you are not an active member of this campaign");
      if (!isOwnerOrManager(v.campaign_id, uid)) return err("only the campaign owner or manager may revoke an approval");
      if (v.status !== "approved") return err("this variant is not currently approved");
      const approval = { id: `approval-${++seq}`, language_variant_id: p_variant_id, campaign_id: v.campaign_id, approver_id: uid, status: "revoked", notes: p_reason, created_at: new Date(Date.now() + seq).toISOString() };
      db.approvals.push(approval);
      v.status = "changes_requested";
      v.updated_at = new Date(Date.now() + (++seq)).toISOString();
      return { data: { approval, variant: { ...v } }, error: null };
    },
  };

  function builder(table, rows) {
    const api = {
      select: () => api,
      eq: (col, val) => builder(table, rows.filter((r) => r[col] === val)),
      in: (col, vals) => builder(table, rows.filter((r) => vals.includes(r[col]))),
      order: () => builder(table, [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
      insert: (row) => {
        if (table === "language_variants" && !["en", "yo", "ha", "ig", "pcm", "urh"].includes(row.language)) {
          return errorBuilder(`language must be one of the six supported codes`);
        }
        const created = { id: row.id ?? `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), updated_at: new Date().toISOString(), ...row };
        db[table].push(created);
        return builder(table, [created]);
      },
      update: (patch) => ({
        eq: (col, val) => {
          const row = rows.find((r) => r[col] === val);
          if (row) {
            if (table === "language_variants" && !["draft", "changes_requested"].includes(row.status)) {
              return errorBuilder("new row violates row-level security policy");
            }
            Object.assign(row, patch);
          }
          return builder(table, row ? [row] : []);
        },
      }),
      delete: () => ({
        eq: (col, val) => ({
          eq: (col2, val2) => ({
            eq: (col3, val3) => {
              const idx = db[table].findIndex((r) => r[col] === val && r[col2] === val2 && r[col3] === val3);
              if (idx >= 0) db[table].splice(idx, 1);
              return { then: (resolve) => resolve({ error: null }) };
            },
          }),
        }),
      }),
    };
    return api;
  }
  function errorBuilder(message) {
    const rejected = { select: () => rejected, eq: () => rejected, maybeSingle: async () => ({ data: null, error: { message } }) };
    return rejected;
  }

  let actingAs = null;
  return {
    db,
    actAs(uid) { actingAs = uid; },
    from: (table) => builder(table, db[table]),
    rpc: async (name, params) => {
      const fn = rpc[name];
      if (!fn) return err(`unknown rpc ${name}`);
      return fn(params, actingAs);
    },
  };
}

const CAMPAIGN_A = "camp-a";
const CAMPAIGN_B = "camp-b";
const OWNER = "user-owner";
const DRAFTER = "user-drafter";
const REVIEWER = "user-reviewer";
const REVIEWER2 = "user-reviewer2";
const STAFF_NO_CAP = "user-staff-no-cap";
const STAFF_WRONG_LANG = "user-staff-wrong-lang";
const MANAGER = "user-manager";

function seedCampaign(client, campaignId) {
  client.db.campaign_members.push(
    { campaign_id: campaignId, person: OWNER, member_role: "owner", status: "active" },
    { campaign_id: campaignId, person: MANAGER, member_role: "manager", status: "active" },
    { campaign_id: campaignId, person: DRAFTER, member_role: "staff", status: "active" },
    { campaign_id: campaignId, person: REVIEWER, member_role: "staff", status: "active" },
    { campaign_id: campaignId, person: REVIEWER2, member_role: "staff", status: "active" },
    { campaign_id: campaignId, person: STAFF_NO_CAP, member_role: "staff", status: "active" },
    { campaign_id: campaignId, person: STAFF_WRONG_LANG, member_role: "staff", status: "active" },
  );
}

async function makeInReviewVariant(client, campaignId, language = "yo") {
  client.actAs(DRAFTER);
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId, title: "Test comm" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId, communicationId: communication.id, language, text: "Original text" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });
  return { communication, variant };
}

// ---------- Language capabilities: grant/revoke/isolation ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  client.actAs(OWNER);
  const { capability, error: grantError } = await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "yo", grantedBy: OWNER });
  ok("Language capability: owner can grant", !grantError && capability.language === "yo");
  const { capabilities } = await listCampaignMemberLanguages({ client, campaignId: CAMPAIGN_A });
  ok("Language capability: appears in listing", capabilities.some((c) => c.person === REVIEWER && c.language === "yo"));
  const { ok: revoked } = await revokeMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "yo" });
  const { capabilities: afterRevoke } = await listCampaignMemberLanguages({ client, campaignId: CAMPAIGN_A });
  ok("Language capability: revoke removes it", revoked && !afterRevoke.some((c) => c.person === REVIEWER && c.language === "yo"));

  seedCampaign(client, CAMPAIGN_B);
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "ha", grantedBy: OWNER });
  const { capabilities: campB } = await listCampaignMemberLanguages({ client, campaignId: CAMPAIGN_B });
  ok("Language capability: campaign-isolated — a grant in campaign A never appears in campaign B's listing", campB.length === 0);
}

// ---------- Edge case 1/2: drafter reviews/approves own variant -> blocked ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A);
  client.actAs(DRAFTER);
  const selfReview = await recordReview({ client, variantId: variant.id, status: "approved" });
  ok("1. Drafter reviewing own variant is blocked", selfReview.review === null && Boolean(selfReview.error));
  const selfApproval = await recordApproval({ client, variantId: variant.id });
  ok("2. Drafter approving own variant is blocked", selfApproval.approval === null && Boolean(selfApproval.error));
}

// ---------- Edge case 3/4/5: capability gating ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "yo", grantedBy: OWNER });
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: STAFF_WRONG_LANG, language: "ha", grantedBy: OWNER });
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A, "yo");

  client.actAs(STAFF_NO_CAP);
  const noCap = await recordReview({ client, variantId: variant.id, status: "approved" });
  ok("3. Staff with no declared language capability cannot review", noCap.review === null && Boolean(noCap.error));

  client.actAs(STAFF_WRONG_LANG);
  const wrongLang = await recordReview({ client, variantId: variant.id, status: "approved" });
  ok("4. Staff with capability for a DIFFERENT language cannot review this one", wrongLang.review === null && Boolean(wrongLang.error));

  client.actAs(OWNER);
  const ownerReview = await recordReview({ client, variantId: variant.id, status: "approved" });
  ok("5. Owner/manager can review WITHOUT any declared language capability", !ownerReview.error && ownerReview.review !== null);
}

// ---------- Full happy path: submit -> review (approved) -> approve, reviewer != approver, drafter excluded throughout ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "yo", grantedBy: OWNER });
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER2, language: "yo", grantedBy: OWNER });

  client.actAs(DRAFTER);
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Rally message" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "yo", text: "Ka a pade ni Ojobo" });
  ok("Draft -> a fresh variant starts in draft", variant.status === VARIANT_STATUS.DRAFT);

  const submitted = await submitLanguageVariantForReview({ client, variantId: variant.id });
  ok("Draft -> in_review via submit", !submitted.error && submitted.variant.status === "in_review");

  const noOp = await submitLanguageVariantForReview({ client, variantId: variant.id });
  ok("15. Repeated submit while already in_review is an explicit no-op, never a duplicate transition", !noOp.error && noOp.alreadyInReview === true && noOp.variant.status === "in_review");

  client.actAs(REVIEWER);
  const reviewResult = await recordReview({ client, variantId: variant.id, status: "approved", notes: "Reads naturally" });
  ok("An approved review keeps the variant at in_review (organisational approval is a SEPARATE, owner/manager-only fact)", !reviewResult.error && reviewResult.variant.status === "in_review");

  client.actAs(REVIEWER);
  const selfApprove = await recordApproval({ client, variantId: variant.id });
  ok("6. The SAME person who reviewed cannot also approve", selfApprove.approval === null && Boolean(selfApprove.error));

  client.actAs(OWNER);
  const approved = await recordApproval({ client, variantId: variant.id, notes: "Looks good" });
  ok("A genuinely different owner/manager CAN approve after a qualifying review", !approved.error && approved.variant.status === "approved");

  const repeatApproval = await recordApproval({ client, variantId: variant.id });
  ok("16. Repeated approval against an already-approved variant is blocked", repeatApproval.approval === null && Boolean(repeatApproval.error));

  const { reviews } = await listReviews({ client, languageVariantId: variant.id });
  const { approvals } = await listApprovals({ client, languageVariantId: variant.id });
  ok("History: exactly one review and one approval recorded, both immutable facts", reviews.length === 1 && approvals.length === 1 && approvals[0].status === "approved");

  // ---- 9/10: editing blocked while in_review / approved ----
  client.actAs(DRAFTER);
  const editApproved = await updateLanguageVariant({ client, variantId: variant.id, text: "Trying to sneak an edit in" });
  ok("10. Editing an APPROVED variant is blocked", editApproved.variant === null && Boolean(editApproved.error));

  // ---- 11/12: revoke -> changes_requested -> full re-cycle ----
  client.actAs(REVIEWER);
  const nonOwnerRevoke = await revokeApproval({ client, variantId: variant.id, reason: "trying without authority" });
  ok("Revoke is owner/manager-only", nonOwnerRevoke.approval === null && Boolean(nonOwnerRevoke.error));

  client.actAs(OWNER);
  const emptyReason = await revokeApproval({ client, variantId: variant.id, reason: "  " });
  ok("14. Revoking without a non-empty reason is refused", emptyReason.approval === null && Boolean(emptyReason.error));

  const revoked = await revokeApproval({ client, variantId: variant.id, reason: "Needs a factual correction" });
  ok("11. Approval revoked -> variant becomes changes_requested", !revoked.error && revoked.variant.status === "changes_requested");

  const { approvals: afterRevoke } = await listApprovals({ client, languageVariantId: variant.id });
  ok("Revocation is a NEW approval event ('revoked') — the original 'approved' row is never mutated or deleted",
     afterRevoke.length === 2 && afterRevoke.some((a) => a.status === "approved") && afterRevoke.some((a) => a.status === "revoked"));

  // now editable again, and must re-enter the FULL workflow
  client.actAs(DRAFTER);
  const editAfterRevoke = await updateLanguageVariant({ client, variantId: variant.id, text: "Corrected text after revocation" });
  ok("Editable again after revocation (changes_requested)", !editAfterRevoke.error && editAfterRevoke.variant.text === "Corrected text after revocation");

  const reapproveWithoutReview = await recordApproval({ client, variantId: variant.id });
  ok("12. Approved variant must re-enter full workflow — cannot approve again without a fresh in_review + approved review", reapproveWithoutReview.approval === null);

  await submitLanguageVariantForReview({ client, variantId: variant.id });
  client.actAs(REVIEWER2);
  await recordReview({ client, variantId: variant.id, status: "approved" });
  client.actAs(OWNER);
  const reapproved = await recordApproval({ client, variantId: variant.id });
  ok("12b. After a full new submit -> review -> approve cycle, the variant reaches approved again", !reapproved.error && reapproved.variant.status === "approved");
}

// ---------- Edge case 7/8: approval blocked without a qualifying review / after rejection ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "ha", grantedBy: OWNER });
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER2, language: "ha", grantedBy: OWNER });
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A, "ha");

  client.actAs(OWNER);
  const beforeReview = await recordApproval({ client, variantId: variant.id });
  ok("7. Approval before any review exists is blocked", beforeReview.approval === null && Boolean(beforeReview.error));

  client.actAs(REVIEWER);
  const rejection = await recordReview({ client, variantId: variant.id, status: "rejected", notes: "Grammar is wrong" });
  ok("13. A rejected review requires non-empty notes, and succeeds when provided", !rejection.error && rejection.variant.status === "changes_requested");

  const missingNotes = await recordReview({ client, variantId: variant.id, status: "rejected", notes: "" });
  // variant is now changes_requested, not in_review, so this should fail on state OR notes -- either is an honest refusal
  ok("Rejecting without notes is refused (also correctly blocked by state once already changes_requested)", missingNotes.review === null && Boolean(missingNotes.error));

  // Re-submit, get an OLDER approved review, then a NEWER rejection -- approval must use the LATEST, not the old approved one.
  client.actAs(DRAFTER);
  await updateLanguageVariant({ client, variantId: variant.id, text: "Revised text" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });
  client.actAs(REVIEWER);
  await recordReview({ client, variantId: variant.id, status: "approved" });
  client.actAs(REVIEWER2);
  await recordReview({ client, variantId: variant.id, status: "rejected", notes: "Actually still wrong" });
  client.actAs(OWNER);
  const blockedByNewerRejection = await recordApproval({ client, variantId: variant.id });
  ok("8. Approval is blocked when the LATEST review rejected, even though an OLDER review had approved", blockedByNewerRejection.approval === null && Boolean(blockedByNewerRejection.error));
}

// ---------- Edge case 9: editing blocked while in_review ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A);
  client.actAs(DRAFTER);
  const editWhileInReview = await updateLanguageVariant({ client, variantId: variant.id, text: "Trying to edit mid-review" });
  ok("9. Editing a variant while in_review is blocked", editWhileInReview.variant === null && Boolean(editWhileInReview.error));
}

// ---------- Edge case 20: cross-campaign actions blocked ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  client.db.campaign_members.push({ campaign_id: CAMPAIGN_B, person: "outsider", member_role: "owner", status: "active" });
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A, "ig");

  client.actAs("outsider");
  const crossCampaignReview = await recordReview({ client, variantId: variant.id, status: "approved" });
  ok("20a. A member of a DIFFERENT campaign cannot review this variant", crossCampaignReview.review === null && Boolean(crossCampaignReview.error));
  const crossCampaignApproval = await recordApproval({ client, variantId: variant.id });
  ok("20b. A member of a DIFFERENT campaign cannot approve this variant", crossCampaignApproval.approval === null && Boolean(crossCampaignApproval.error));
  const crossCampaignSubmit = await submitLanguageVariantForReview({ client, variantId: variant.id });
  ok("20c. A member of a DIFFERENT campaign cannot submit this variant (also fails the drafter check)", Boolean(crossCampaignSubmit.error));
}

// ---------- Edge case 17/18/19: capability removal and membership loss preserve history ----------
{
  const client = fakeClient();
  seedCampaign(client, CAMPAIGN_A);
  await grantMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "pcm", grantedBy: OWNER });
  const { variant } = await makeInReviewVariant(client, CAMPAIGN_A, "pcm");
  client.actAs(REVIEWER);
  await recordReview({ client, variantId: variant.id, status: "approved" });

  // 17. capability removed -> future review blocked
  await revokeMemberLanguage({ client, campaignId: CAMPAIGN_A, person: REVIEWER, language: "pcm" });
  const { variant: variant2 } = await makeInReviewVariant(client, CAMPAIGN_A, "pcm");
  client.actAs(REVIEWER);
  const afterRevocation = await recordReview({ client, variantId: variant2.id, status: "approved" });
  ok("17. Removing a reviewer's language capability blocks their FUTURE reviews", afterRevocation.review === null && Boolean(afterRevocation.error));

  // 18/19. historical review remains after "membership removal" (simulated by flipping status to revoked)
  const member = client.db.campaign_members.find((m) => m.campaign_id === CAMPAIGN_A && m.person === REVIEWER);
  member.status = "revoked";
  const { reviews } = await listReviews({ client, languageVariantId: variant.id });
  ok("18. Historical reviews remain readable after the reviewer's membership is removed", reviews.length === 1 && reviews[0].reviewer_id === REVIEWER);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
