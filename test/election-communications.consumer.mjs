// ============================================================
// ELECTIONCANON — GATE A.5.1: COMMUNICATION OBJECT MODEL
//
// A fake Supabase query-builder client exercising
// src/domains/election/communications/api.js directly — no live database,
// same convention as election-campaign-studio.consumer.mjs. The fake
// client's insert() simulates exactly two real Postgres constraints this
// gate's migration adds (supabase/migrations/20260906000000_election_
// communications.sql), so this file can prove the JS layer honestly
// surfaces a database rejection rather than swallowing or bypassing one:
//
//   1. communication_assets' composite FKs (asset campaign_id must equal
//      the communication's own campaign_id) — the cross-campaign-attach
//      impossibility.
//   2. reviews/approvals' INSERT policy (reviewer/approver_id must differ
//      from the language_variant's own created_by) — the DRAFTER =/=
//      REVIEWER/APPROVER invariant.
//
// What is deliberately NOT tested here, because it does not exist yet:
// owner/manager-restricted approval (A.5.2), reviewer-roster assignment
// (A.5.2), re-review after rejection (A.5.2), any channel/schedule/
// publication/measurement concept (later A.5.x gates).
// ============================================================

import {
  createCommunication, listCommunications, getCommunication, updateCommunication,
  attachAsset, listCommunicationAssets, detachAsset,
  createLanguageVariant, listLanguageVariants, updateLanguageVariant,
  createReview, listReviews, createApproval, listApprovals,
  COMMUNICATION_LANGUAGES,
} from "../src/domains/election/communications/api.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.1: Communication object model\n");

// ---------- fake client: enough real-Postgres behaviour to prove the invariants ----------

function fakeClient() {
  const db = { communications: [], communication_assets: [], language_variants: [], campaign_studio_assets: [], reviews: [], approvals: [] };
  let seq = 0;

  function builder(table, rows) {
    const api = {
      select: () => api,
      eq: (col, val) => builder(table, rows.filter((r) => r[col] === val)),
      order: () => builder(table, [...rows].sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0))),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
      insert: (row) => {
        // ---- simulate the composite FK on communication_assets ----
        if (table === "communication_assets") {
          const asset = db.campaign_studio_assets.find((a) => a.id === row.asset_id);
          const comm = db.communications.find((c) => c.id === row.communication_id);
          if (!asset || asset.campaign_id !== row.campaign_id || !comm || comm.campaign_id !== row.campaign_id) {
            return errorBuilder("insert or update on table \"communication_assets\" violates foreign key constraint — asset/communication campaign_id mismatch");
          }
        }
        // ---- simulate the reviews/approvals INSERT policy (DRAFTER =/= REVIEWER/APPROVER) ----
        if (table === "reviews" || table === "approvals") {
          const variant = db.language_variants.find((v) => v.id === row.language_variant_id);
          const actorId = table === "reviews" ? row.reviewer_id : row.approver_id;
          if (!variant || actorId === variant.created_by) {
            return errorBuilder(`new row violates row-level security policy for table "${table}"`);
          }
        }
        const created = { id: row.id ?? `${table}-${++seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
        db[table].push(created);
        return builder(table, [created]);
      },
      update: (patch) => ({
        eq: (col, val) => {
          const row = rows.find((r) => r[col] === val);
          if (row) Object.assign(row, patch);
          return builder(table, row ? [row] : []);
        },
      }),
      delete: () => ({
        eq: (col, val) => ({
          eq: (col2, val2) => {
            const idx = db[table].findIndex((r) => r[col] === val && r[col2] === val2);
            if (idx >= 0) db[table].splice(idx, 1);
            return { then: (resolve) => resolve({ error: null }) };
          },
        }),
      }),
    };
    return api;
  }

  function errorBuilder(message) {
    const rejected = { select: () => rejected, eq: () => rejected, maybeSingle: async () => ({ data: null, error: { message } }) };
    return rejected;
  }

  return { db, from: (table) => builder(table, db[table]) };
}

const CAMPAIGN_A = "camp-a";
const CAMPAIGN_B = "camp-b";
const DRAFTER = "user-drafter";
const REVIEWER = "user-reviewer";

// ---------- 1/2/3 — Communication: create, belongs to a campaign, cannot cross boundaries ----------
{
  const client = fakeClient();
  const { communication, error } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Ward meeting announcement" });
  ok("1. Communication can be created", !error && Boolean(communication?.id));
  ok("2. Communication belongs to the campaign it was created for", communication.campaign_id === CAMPAIGN_A && communication.created_by === DRAFTER);
  ok("2b. Communication starts as draft, with no title silently defaulted or fabricated", communication.status === "draft" && communication.title === "Ward meeting announcement");

  await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_B, title: "A different campaign's item" });
  const { communications: onlyA } = await listCommunications({ client, campaignId: CAMPAIGN_A });
  ok("3. Communication cannot cross campaign boundaries — listing campaign A never returns campaign B's row", onlyA.length === 1 && onlyA[0].campaign_id === CAMPAIGN_A);

  const empty = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "   " });
  ok("2c. An empty/whitespace-only title is refused, not silently accepted", empty.communication === null && Boolean(empty.error));

  const { communication: reread } = await getCommunication({ client, communicationId: communication.id });
  ok("2d. getCommunication retrieves the same row by id", reread?.id === communication.id);

  const { communication: updated } = await updateCommunication({ client, communicationId: communication.id, brief: "Rally the ward before Saturday" });
  ok("2e. updateCommunication persists an edited brief (mutable drafting, not an immutable event)", updated.brief === "Rally the ward before Saturday");
}

// ---------- 4/5 — Studio asset reference, and cross-campaign attach refused ----------
{
  const client = fakeClient();
  client.db.campaign_studio_assets.push({ id: "asset-a1", campaign_id: CAMPAIGN_A, title: "Rally poster" });
  client.db.campaign_studio_assets.push({ id: "asset-b1", campaign_id: CAMPAIGN_B, title: "Someone else's poster" });
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Rally push" });

  const { link, error: attachError } = await attachAsset({ client, campaignId: CAMPAIGN_A, communicationId: communication.id, assetId: "asset-a1" });
  ok("4. Communication can reference an existing Studio asset", !attachError && link?.asset_id === "asset-a1");
  const { links } = await listCommunicationAssets({ client, communicationId: communication.id });
  ok("4b. The reference is a real join row, not a copy of the asset's own content", links.length === 1 && links[0].communication_id === communication.id);

  const cross = await attachAsset({ client, campaignId: CAMPAIGN_A, communicationId: communication.id, assetId: "asset-b1" });
  ok("5. Asset references cannot cross campaign boundaries — attaching campaign B's asset under campaign A is refused", cross.link === null && Boolean(cross.error));

  const { ok: detached } = await detachAsset({ client, communicationId: communication.id, assetId: "asset-a1" });
  const { links: afterDetach } = await listCommunicationAssets({ client, communicationId: communication.id });
  ok("4c. detachAsset removes the join row without touching the underlying Studio asset", detached && afterDetach.length === 0 && client.db.campaign_studio_assets.some((a) => a.id === "asset-a1"));
}

// ---------- 6/7/8 — Language variants ----------
{
  const client = fakeClient();
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Turnout reminder" });
  const { communication: other } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Unrelated item" });

  const { variant: en, error: enError } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "en", text: "Vote on Saturday." });
  ok("6. Language variant belongs to its Communication", !enError && en.communication_id === communication.id);

  const bad = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "fr", text: "Votez samedi." });
  ok("7. Language must be one of the six supported languages — French (a real ForgeOS-wide language, but not one of ElectionCanon's six) is refused", bad.variant === null && Boolean(bad.error));
  ok("7b. COMMUNICATION_LANGUAGES exposes exactly the six target languages, no more", COMMUNICATION_LANGUAGES.length === 6
     && ["en", "yo", "ha", "ig", "pcm", "urh"].every((code) => COMMUNICATION_LANGUAGES.some((l) => l.code === code)));

  const { variant: yo } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "yo", text: "Dibo ni ọjọ Satide." });
  const { variants } = await listLanguageVariants({ client, communicationId: communication.id });
  ok("8. Multiple language variants can exist for one Communication", variants.length === 2 && variants.some((v) => v.language === "en") && variants.some((v) => v.language === "yo"));

  await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: other.id, language: "en", text: "A different item's English text." });
  const { variants: onlyMine } = await listLanguageVariants({ client, communicationId: communication.id });
  ok("6b. Listing one Communication's variants never leaks another Communication's variant", onlyMine.length === 2 && onlyMine.every((v) => v.communication_id === communication.id));

  const { variant: updatedEn } = await updateLanguageVariant({ client, variantId: en.id, text: "Vote this Saturday — polls open 8am." });
  ok("6c. updateLanguageVariant edits the variant's own text in place", updatedEn.text === "Vote this Saturday — polls open 8am.");
}

// ---------- 9/10/11/12 — Review and Approval reference the right variant, store real identity ----------
{
  const client = fakeClient();
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Candidate intro" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "en", text: "Meet our candidate." });

  const { review, error: reviewError } = await createReview({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, reviewerId: REVIEWER, status: "approved", notes: "Reads naturally." });
  ok("9. Review references the correct language variant", !reviewError && review.language_variant_id === variant.id);
  ok("10. Review stores the real reviewer identity, not the drafter's", review.reviewer_id === REVIEWER);
  const { reviews } = await listReviews({ client, languageVariantId: variant.id });
  ok("9b. listReviews returns it, scoped to that variant", reviews.length === 1 && reviews[0].id === review.id);

  const { approval, error: approvalError } = await createApproval({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, approverId: REVIEWER, status: "approved" });
  ok("11. Approval references the correct language variant", !approvalError && approval.language_variant_id === variant.id);
  ok("12. Approval stores the real approver identity, not the drafter's", approval.approver_id === REVIEWER);
  const { approvals } = await listApprovals({ client, languageVariantId: variant.id });
  ok("11b. listApprovals returns it, scoped to that variant", approvals.length === 1 && approvals[0].id === approval.id);
}

// ---------- 13 — No automatic approval ----------
{
  const client = fakeClient();
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Policy message" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "en", text: "Our plan for this ward." });
  const { approvals } = await listApprovals({ client, languageVariantId: variant.id });
  ok("13. No automatic approval occurs — creating a communication and a variant records zero approvals", approvals.length === 0);

  await createReview({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, reviewerId: REVIEWER, status: "approved" });
  const { approvals: afterReview } = await listApprovals({ client, languageVariantId: variant.id });
  ok("13b. A review being recorded — even an 'approved' one — never itself creates an approval row (Review and Approval are genuinely distinct)", afterReview.length === 0);
}

// ---------- 14 — No automatic translation ----------
{
  const client = fakeClient();
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Volunteer recruitment" });
  await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "en", text: "Join us this weekend." });
  const { variants } = await listLanguageVariants({ client, communicationId: communication.id });
  ok("14. No automatic translation occurs — creating one language's variant never fabricates the other five", variants.length === 1 && variants[0].language === "en");

  const { variant: pastedYo } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "yo", text: "Darapọ mọ wa ni ipari ose yii." });
  ok("14b. A variant's text is stored EXACTLY as supplied — never silently machine-translated or rewritten by this layer", pastedYo.text === "Darapọ mọ wa ni ipari ose yii.");
}

// ---------- DRAFTER =/= REVIEWER / APPROVER ----------
{
  const client = fakeClient();
  const { communication } = await createCommunication({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, title: "Incident communication" });
  const { variant } = await createLanguageVariant({ client, userId: DRAFTER, campaignId: CAMPAIGN_A, communicationId: communication.id, language: "en", text: "An update on today's incident." });

  const selfReview = await createReview({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, reviewerId: DRAFTER, status: "approved" });
  ok("DRAFTER =/= REVIEWER — the variant's own author cannot review their own variant (enforced here by the migration's own RLS INSERT policy, simulated by this test's fake client)",
     selfReview.review === null && Boolean(selfReview.error));

  const selfApproval = await createApproval({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, approverId: DRAFTER, status: "approved" });
  ok("DRAFTER =/= APPROVER — the variant's own author cannot approve their own work (same enforcement mechanism as review)",
     selfApproval.approval === null && Boolean(selfApproval.error));

  const otherReview = await createReview({ client, campaignId: CAMPAIGN_A, languageVariantId: variant.id, reviewerId: REVIEWER, status: "approved" });
  ok("A genuinely different reviewer is NOT blocked by the same check", !otherReview.error && otherReview.review !== null);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
