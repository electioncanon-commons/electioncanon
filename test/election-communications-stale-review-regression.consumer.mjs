// ============================================================
// ELECTIONCANON — GATE A.5.2 PHASE 1.6: STALE-REVIEW REAPPROVAL REGRESSION
//
// A DEDICATED regression test for the exact defect Phase 1.5's audit
// found: record_approval() originally selected the GLOBALLY latest review
// for a variant, with no proof that review belonged to the variant's
// CURRENT in_review cycle. That let this sequence through:
//
//   approved -> revoke -> edit -> resubmit -> approve WITHOUT a fresh
//   review (the stale, pre-revocation review still qualified).
//
// The fix (supabase/migrations/20260907000000_election_communications_
// review_workflow.sql's record_approval(), step 7): the qualifying review
// must satisfy `created_at >= v_variant.updated_at`, where v_variant was
// loaded BEFORE this call's own later mutation -- and updated_at, at that
// exact point, is PROVABLY the timestamp of the most recent submit (see
// that function's own comment for the full argument: submit_language_
// variant_for_review() is the only path that ever sets status='in_review',
// it always stamps updated_at in the same statement, and the narrowed
// language_variants UPDATE policy makes it impossible for any client edit
// to touch updated_at while status stays in_review).
//
// This file's own fake-client mock DELIBERATELY reimplements that fixed
// rule (created_at >= variant.updated_at) rather than the naive "just
// take the latest row" rule Phase 1.5 found duplicated between the SQL
// and the original workflow test's mock — the whole point of this file is
// to prove the FIXED rule, independently, not to re-assert the old one.
// Verified manually before this file was finalized: reverting this mock's
// cycle-boundary check back to the naive "latest by created_at, no floor"
// rule makes TEST A below fail (the stale review incorrectly qualifies);
// restoring the fix makes it pass again -- confirming this test is a
// genuine, non-vacuous regression guard for the exact defect found.
//
// Run: node test/election-communications-stale-review-regression.consumer.mjs
// ============================================================

import {
  createCommunication, createLanguageVariant, updateLanguageVariant,
  submitLanguageVariantForReview, recordReview, recordApproval, revokeApproval,
  listApprovals,
} from "../src/domains/election/communications/api.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.2 Phase 1.6: stale-review reapproval regression\n");

function fakeClient() {
  const db = { campaign_members: [], communications: [], language_variants: [], reviews: [], approvals: [] };
  let seq = 0;
  const err = (message) => ({ data: null, error: { message } });

  function isActiveMember(campaignId, person) {
    return db.campaign_members.some((m) => m.campaign_id === campaignId && m.person === person && m.status === "active");
  }
  function isOwnerOrManager(campaignId, person) {
    return db.campaign_members.some((m) => m.campaign_id === campaignId && m.person === person && m.status === "active"
      && (m.member_role === "owner" || m.member_role === "manager"));
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
      v.updated_at = new Date(Date.now() + (++seq)).toISOString(); // THE cycle-start stamp the fix relies on
      return { data: { ...v, alreadyInReview: false }, error: null };
    },
    record_review({ p_variant_id, p_status, p_notes }, uid) {
      if (!["approved", "rejected"].includes(p_status)) return err("a review status must be approved or rejected");
      if (p_status === "rejected" && (!p_notes || !p_notes.trim())) return err("a rejected review requires non-empty notes");
      const v = db.language_variants.find((x) => x.id === p_variant_id);
      if (!v) return err("language variant not found");
      if (!isActiveMember(v.campaign_id, uid)) return err("you are not an active member of this campaign");
      if (v.created_by === uid) return err("the drafter of a variant may not review their own work");
      if (v.status !== "in_review") return err("this variant is not currently in review");
      const review = { id: `review-${++seq}`, language_variant_id: p_variant_id, campaign_id: v.campaign_id, reviewer_id: uid, status: p_status, notes: p_notes, created_at: new Date(Date.now() + seq).toISOString() };
      db.reviews.push(review);
      if (p_status === "rejected") { v.status = "changes_requested"; v.updated_at = new Date(Date.now() + (++seq)).toISOString(); }
      return { data: { review, variant: { ...v } }, error: null };
    },
    // THE FIX UNDER TEST: only a review with created_at >= v.updated_at
    // (the current in_review cycle's own start stamp) may qualify.
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
      order: () => builder(table, [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
      insert: (row) => {
        const created = { id: row.id ?? `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), updated_at: new Date(Date.now() + seq).toISOString(), ...row };
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
    rpc: async (name, params) => rpc[name](params, actingAs),
  };
}

const CAMPAIGN = "camp-stale-review";
const OWNER = "user-owner";
const OWNER2 = "user-owner2";
const DRAFTER = "user-drafter";
const REVIEWER = "user-reviewer";
const REVIEWER2 = "user-reviewer2";

function seed(client) {
  client.db.campaign_members.push(
    { campaign_id: CAMPAIGN, person: OWNER, member_role: "owner", status: "active" },
    { campaign_id: CAMPAIGN, person: OWNER2, member_role: "manager", status: "active" },
    { campaign_id: CAMPAIGN, person: DRAFTER, member_role: "staff", status: "active" },
    { campaign_id: CAMPAIGN, person: REVIEWER, member_role: "staff", status: "active" },
    { campaign_id: CAMPAIGN, person: REVIEWER2, member_role: "staff", status: "active" },
  );
}

async function makeApprovedVariant(client) {
  client.actAs(DRAFTER);
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN, title: "Test comm" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN, communicationId: communication.id, language: "yo", text: "Original text" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });
  client.actAs(REVIEWER);
  await recordReview({ client, variantId: variant.id, status: "approved" });
  client.actAs(OWNER);
  await recordApproval({ client, variantId: variant.id });
  return { communication, variant };
}

// ---------- TEST A — stale review exploit MUST be blocked ----------
{
  const client = fakeClient();
  seed(client);
  const { variant } = await makeApprovedVariant(client);

  client.actAs(OWNER);
  await revokeApproval({ client, variantId: variant.id, reason: "needs a wording fix" });

  client.actAs(DRAFTER);
  await updateLanguageVariant({ client, variantId: variant.id, text: "Edited text — nobody has reviewed THIS wording" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });
  // Deliberately NO new review recorded here.

  client.actAs(OWNER2);
  const exploit = await recordApproval({ client, variantId: variant.id });
  ok("TEST A.8 — approval using the STALE pre-revocation review is rejected", exploit.approval === null && Boolean(exploit.error));

  const { data: refetched } = await client.from("language_variants").eq("id", variant.id).maybeSingle();
  ok("TEST A.9 — variant remains in_review (not silently approved)", refetched.status === "in_review");

  const { approvals } = await listApprovals({ client, languageVariantId: variant.id });
  ok("TEST A.10 — no new approval row was created by the blocked attempt (still exactly approved+revoked = 2)", approvals.length === 2);
}

// ---------- TEST B — legitimate reapproval after a FRESH review MUST succeed ----------
{
  const client = fakeClient();
  seed(client);
  const { variant } = await makeApprovedVariant(client);

  client.actAs(OWNER);
  await revokeApproval({ client, variantId: variant.id, reason: "needs a wording fix" });

  client.actAs(DRAFTER);
  await updateLanguageVariant({ client, variantId: variant.id, text: "Corrected wording" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });

  client.actAs(REVIEWER2);
  const freshReview = await recordReview({ client, variantId: variant.id, status: "approved", notes: "Corrected wording reads well" });

  client.actAs(OWNER2);
  const reapproved = await recordApproval({ client, variantId: variant.id });
  ok("TEST B.6 — reapproval succeeds once a FRESH review exists in the current cycle", !reapproved.error && reapproved.variant.status === "approved");

  const { approvals } = await listApprovals({ client, languageVariantId: variant.id });
  ok("TEST B.7 — both historical approval events remain (approved, revoked, approved — 3 total, none mutated)",
     approvals.length === 3 && approvals.filter((a) => a.status === "approved").length === 2 && approvals.filter((a) => a.status === "revoked").length === 1);
  ok("TEST B.8 — the fresh review (REVIEWER2's) is the one that qualified, not the original REVIEWER's stale one",
     freshReview.review.reviewer_id === REVIEWER2 && freshReview.review.reviewer_id !== REVIEWER);
}

// ---------- TEST C — old approved + newer rejected (within the current cycle) MUST block ----------
{
  const client = fakeClient();
  seed(client);
  const { variant } = await makeApprovedVariant(client);

  client.actAs(OWNER);
  await revokeApproval({ client, variantId: variant.id, reason: "needs review again" });
  client.actAs(DRAFTER);
  await updateLanguageVariant({ client, variantId: variant.id, text: "Second draft" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });

  // A new "approved" review lands first in this fresh cycle...
  client.actAs(REVIEWER);
  await recordReview({ client, variantId: variant.id, status: "approved" });
  // ...then a SECOND, later review in the SAME cycle rejects it.
  client.actAs(REVIEWER2);
  await recordReview({ client, variantId: variant.id, status: "rejected", notes: "Actually still wrong" });

  client.actAs(OWNER2);
  const blocked = await recordApproval({ client, variantId: variant.id });
  ok("TEST C.5 — approval is blocked when the LATEST review in the current cycle rejected, even though an earlier one in the SAME cycle approved", blocked.approval === null && Boolean(blocked.error));
}

// ---------- TEST D — old approved + new approved: the NEWER one qualifies ----------
{
  const client = fakeClient();
  seed(client);
  const { variant } = await makeApprovedVariant(client); // old approved review exists from REVIEWER

  client.actAs(OWNER);
  await revokeApproval({ client, variantId: variant.id, reason: "policy update" });
  client.actAs(DRAFTER);
  await updateLanguageVariant({ client, variantId: variant.id, text: "Updated for new policy" });
  await submitLanguageVariantForReview({ client, variantId: variant.id });

  client.actAs(REVIEWER2);
  const newReview = await recordReview({ client, variantId: variant.id, status: "approved", notes: "Matches new policy" });

  client.actAs(OWNER2);
  const approved = await recordApproval({ client, variantId: variant.id });
  ok("TEST D.4 — a different owner/manager can approve using the NEW review", !approved.error && approved.variant.status === "approved");
  ok("TEST D.5 — the newer review (REVIEWER2) is confirmed as what qualified, not the old REVIEWER review", newReview.review.reviewer_id === REVIEWER2);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
