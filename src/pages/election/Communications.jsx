// ============================================================
// ELECTIONCANON — COMMUNICATIONS  (Gate A.5.1 object model + Gate A.5.2
// native review / approval workflow)
//
// Gate A.5.2 adds the governed human workflow on top of A.5.1's proven
// object model: submit-for-review, review, approve, revoke, and a
// read-only history ledger. Every action below is a courtesy UI gate
// only — the actual authorization/state rules live server-side in the
// four RPCs this screen calls (see communications/api.js and
// supabase/migrations/20260907000000_election_communications_review_
// workflow.sql). An action button that would fail server-side is simply
// not shown; it is never the only thing standing between a user and an
// action they are not entitled to.
//
// Still rendered as an in-page tab inside CampaignStudioSection.jsx, not
// a new top-level navigation item — unchanged from A.5.1's own boundary.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase.js";
import * as commsApi from "../../domains/election/communications/api.js";
import { EXPORT_FORMAT_LIST, exportApprovedVariant } from "../../domains/election/communications/export.js";
import { Label, Panel, StatusChip, friendlyError, downloadBlob, ensureCreativeFontsReady, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

// User-facing labels for language_variants.status — read directly from
// the column, never inferred from reviews/approvals rows (Gate A.5.2's
// own "state presentation" requirement).
const VARIANT_STATUS_LABEL = Object.freeze({
  draft: "Draft", in_review: "In review", changes_requested: "Changes requested", approved: "Approved",
});
const VARIANT_STATUS_COLOR = Object.freeze({
  draft: MUTED, in_review: AMBER, changes_requested: PINK, approved: TEAL,
});

const smallBtn = (accent) => ({
  fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "7px 12px", border: `1px solid ${accent}`, background: "transparent", color: accent, cursor: "pointer",
});
const solidBtn = (accent) => ({
  fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "9px 14px", border: "none", background: accent, color: BLACK, cursor: "pointer", whiteSpace: "nowrap",
});

function CommunicationRow({ communication, onOpen }) {
  return (
    <button onClick={() => onOpen(communication)}
      style={{ display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", fontFamily: UI,
        padding: "9px 0", background: "transparent", border: "none", borderBottom: `1px solid ${BORDER}`,
        cursor: "pointer", color: IVORY }}>
      <span style={{ fontSize: 12.5 }}>{communication.title}</span>
      <span style={{ fontSize: 10.5, color: MUTED, textTransform: "uppercase" }}>{communication.status}</span>
    </button>
  );
}

/** Read-only ledger — reviews and approvals for one variant, merged and
 *  sorted newest-first. Never synthesizes an event that does not exist;
 *  an empty ledger just renders nothing (the variant's own status chip
 *  already says "Draft" honestly). */
function VariantHistory({ reviews, approvals, namesByPerson }) {
  const events = [
    ...reviews.map((r) => ({ kind: "Review", person: r.reviewer_id, at: r.created_at, verdict: r.status, notes: r.notes })),
    ...approvals.map((a) => ({ kind: a.status === "revoked" ? "Revocation" : "Approval", person: a.approver_id, at: a.created_at, verdict: a.status, notes: a.notes })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  if (events.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {events.map((e, i) => (
        <div key={i} style={{ fontFamily: UI, fontSize: 11, color: MUTED, padding: "4px 0" }}>
          <span style={{ color: IVORY, fontWeight: 700 }}>{e.kind}</span>
          {" — "}{e.verdict}{" · "}{namesByPerson[e.person] ?? "Member"}
          {e.notes && <span style={{ display: "block", marginTop: 2 }}>{e.notes}</span>}
        </div>
      ))}
    </div>
  );
}

function VariantRow({ variant, reviews, approvals, namesByPerson, userId, isOwnerOrManager, myLanguages, onEdited, onAction }) {
  const languageLabel = commsApi.COMMUNICATION_LANGUAGES.find((l) => l.code === variant.language)?.label ?? variant.language;
  const [editText, setEditText] = useState(variant.text);
  const [reviewNotes, setReviewNotes] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [exportFormat, setExportFormat] = useState(EXPORT_FORMAT_LIST[0].id);
  const [busy, setBusy] = useState(false);

  const isDrafter = variant.created_by === userId;
  const editable = variant.status === commsApi.VARIANT_STATUS.DRAFT || variant.status === commsApi.VARIANT_STATUS.CHANGES_REQUESTED;
  const latestReview = reviews[0] ?? null;
  const canReview = variant.status === commsApi.VARIANT_STATUS.IN_REVIEW && !isDrafter
    && (isOwnerOrManager || myLanguages.includes(variant.language));
  const canApprove = variant.status === commsApi.VARIANT_STATUS.IN_REVIEW && isOwnerOrManager && !isDrafter
    && latestReview?.status === "approved" && latestReview?.reviewer_id !== userId;
  const canRevoke = variant.status === commsApi.VARIANT_STATUS.APPROVED && isOwnerOrManager;
  // GATE A.5.3 — a UI courtesy only, exactly like every other action gate
  // on this row: the real check is onAction("export", …) re-reading this
  // variant's CURRENT status immediately before rendering (see
  // CommunicationDetail.onVariantAction below), never this stale prop.
  const canExport = variant.status === commsApi.VARIANT_STATUS.APPROVED;

  const run = async (fn) => { setBusy(true); await fn(); setBusy(false); };

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY }}>{languageLabel}</span>
        <StatusChip status={VARIANT_STATUS_LABEL[variant.status] ?? variant.status} color={VARIANT_STATUS_COLOR[variant.status]} />
      </div>

      {editable ? (
        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
          aria-label={`${languageLabel} text`} style={{ ...inputStyle, resize: "vertical", marginBottom: 6 }} />
      ) : (
        <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, whiteSpace: "pre-wrap", marginBottom: 6 }}>{variant.text || "(no text yet)"}</div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {editable && editText !== variant.text && (
          <button disabled={busy} style={smallBtn(TEAL)}
            onClick={() => run(() => onAction("edit", { text: editText }))}>
            Save edit
          </button>
        )}
        {editable && isDrafter && (
          <button disabled={busy} style={smallBtn(TEAL)}
            onClick={() => run(() => onAction("submit"))}>
            Submit for review
          </button>
        )}
        {canApprove && (
          <button disabled={busy} style={smallBtn(TEAL)}
            onClick={() => run(() => onAction("approve"))}>
            Approve
          </button>
        )}
        {canRevoke && (
          <>
            <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason for revoking…"
              aria-label="Revocation reason" style={{ ...inputStyle, width: 220 }} />
            <button disabled={busy || !revokeReason.trim()} style={smallBtn(PINK)}
              onClick={() => run(async () => { await onAction("revoke", { reason: revokeReason }); setRevokeReason(""); })}>
              Revoke approval
            </button>
          </>
        )}
        {canExport && (
          <>
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}
              aria-label={`${languageLabel} export format`} style={{ ...inputStyle, width: 140 }}>
              {EXPORT_FORMAT_LIST.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button disabled={busy} style={smallBtn(TEAL)}
              onClick={() => run(() => onAction("export", { format: exportFormat }))}>
              Export
            </button>
          </>
        )}
      </div>

      {canReview && (
        <div style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${BORDER}` }}>
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase" }}>Your review</div>
          <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2}
            placeholder="Notes (required if rejecting)" aria-label="Review notes" style={{ ...inputStyle, resize: "vertical", marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={busy} style={smallBtn(TEAL)}
              onClick={() => run(async () => { await onAction("review", { status: "approved", notes: reviewNotes || null }); setReviewNotes(""); })}>
              Approve review
            </button>
            <button disabled={busy || !reviewNotes.trim()} style={smallBtn(PINK)}
              onClick={() => run(async () => { await onAction("review", { status: "rejected", notes: reviewNotes }); setReviewNotes(""); })}>
              Reject
            </button>
          </div>
        </div>
      )}

      <VariantHistory reviews={reviews} approvals={approvals} namesByPerson={namesByPerson} />
    </div>
  );
}

function CommunicationDetail({ communication, studioAssets, userId, isOwnerOrManager, myLanguages, onChanged, onCommunicationUpdated }) {
  const [links, setLinks] = useState([]);
  const [variants, setVariants] = useState([]);
  const [reviewsByVariant, setReviewsByVariant] = useState({});
  const [approvalsByVariant, setApprovalsByVariant] = useState({});
  const [namesByPerson, setNamesByPerson] = useState({});
  const [attachAssetId, setAttachAssetId] = useState("");
  const [newLanguage, setNewLanguage] = useState("");
  const [newVariantText, setNewVariantText] = useState("");
  const [briefDraft, setBriefDraft] = useState(communication.brief ?? "");
  const [masterTextDraft, setMasterTextDraft] = useState(communication.master_text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setBriefDraft(communication.brief ?? ""); setMasterTextDraft(communication.master_text ?? ""); }, [communication.id]);

  const load = useCallback(async () => {
    const [{ links: assetLinks }, { variants: variantList }] = await Promise.all([
      commsApi.listCommunicationAssets({ client: supabase, communicationId: communication.id }),
      commsApi.listLanguageVariants({ client: supabase, communicationId: communication.id }),
    ]);
    setLinks(assetLinks);
    setVariants(variantList);
    const reviewEntries = await Promise.all(variantList.map((v) => commsApi.listReviews({ client: supabase, languageVariantId: v.id })));
    const approvalEntries = await Promise.all(variantList.map((v) => commsApi.listApprovals({ client: supabase, languageVariantId: v.id })));
    const reviewsMap = Object.fromEntries(variantList.map((v, i) => [v.id, reviewEntries[i].reviews]));
    const approvalsMap = Object.fromEntries(variantList.map((v, i) => [v.id, approvalEntries[i].approvals]));
    setReviewsByVariant(reviewsMap);
    setApprovalsByVariant(approvalsMap);

    // One batched name lookup for every person mentioned across every
    // review/approval on this communication — never an N+1, never a
    // second identity source (same `profiles.display_name` convention
    // OrganisationSection.jsx already uses for the signed-in viewer).
    const personIds = new Set();
    Object.values(reviewsMap).flat().forEach((r) => personIds.add(r.reviewer_id));
    Object.values(approvalsMap).flat().forEach((a) => personIds.add(a.approver_id));
    if (personIds.size > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", Array.from(personIds));
      setNamesByPerson(Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name ?? "Member"])));
    } else {
      setNamesByPerson({});
    }
  }, [communication.id]);

  useEffect(() => { load(); }, [load]);

  const attachedAssetIds = new Set(links.map((l) => l.asset_id));
  const attachableAssets = studioAssets.filter((a) => !attachedAssetIds.has(a.id));
  const availableLanguages = commsApi.COMMUNICATION_LANGUAGES.filter((l) => !variants.some((v) => v.language === l.code));

  const onAttach = async () => {
    if (!attachAssetId) return;
    setBusy(true); setError(null);
    const { error: attachError } = await commsApi.attachAsset({
      client: supabase, campaignId: communication.campaign_id, communicationId: communication.id, assetId: attachAssetId,
      position: links.length,
    });
    setBusy(false);
    if (attachError) { setError(attachError); return; }
    setAttachAssetId("");
    await load();
  };

  const onAddVariant = async () => {
    if (!newLanguage) return;
    setBusy(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: variantError } = await commsApi.createLanguageVariant({
      client: supabase, userId: user?.id, campaignId: communication.campaign_id, communicationId: communication.id,
      language: newLanguage, text: newVariantText,
    });
    setBusy(false);
    if (variantError) { setError(variantError); return; }
    setNewLanguage(""); setNewVariantText("");
    await load();
    onChanged?.();
  };

  const onSaveContext = async () => {
    setBusy(true); setError(null);
    const { communication: updated, error: saveError } = await commsApi.updateCommunication({
      client: supabase, communicationId: communication.id, brief: briefDraft, masterText: masterTextDraft,
    });
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    onCommunicationUpdated?.(updated);
  };

  // GATE A.5.3 — export is deliberately NOT one of the RPC-shaped branches
  // below: it never calls a Supabase RPC, never produces a {variant,error}
  // shape, and — the actual governance point — it re-reads this variant's
  // CURRENT status via a fresh listLanguageVariants() call immediately
  // before exportApprovedVariant() runs, rather than trusting whatever
  // `variants` this component already had in state (which could be
  // arbitrarily stale, e.g. if an owner/manager revoked approval from
  // another tab moments earlier). A revoked approval is therefore refused
  // here even if the row on screen still visually says "Approved".
  const onExportVariant = async (variantId, format) => {
    const { variants: freshVariants, error: refreshError } = await commsApi.listLanguageVariants({ client: supabase, communicationId: communication.id });
    if (refreshError) { setError(refreshError); return; }
    const fresh = freshVariants.find((v) => v.id === variantId);
    if (!fresh) { setError("This language variant no longer exists."); return; }
    await ensureCreativeFontsReady();
    const { blob, filename, error: exportError } = await exportApprovedVariant({
      communicationTitle: communication.title,
      variantStatus: fresh.status,
      variantLanguage: fresh.language,
      variantText: fresh.text,
      format,
      createCanvas: () => document.createElement("canvas"),
    });
    if (exportError) { setError(exportError); return; }
    downloadBlob(blob, filename);
    setVariants(freshVariants);
  };

  const onVariantAction = async (variantId, action, payload = {}) => {
    setError(null);
    if (action === "export") { await onExportVariant(variantId, payload.format); return; }
    let result;
    if (action === "edit") result = await commsApi.updateLanguageVariant({ client: supabase, variantId, text: payload.text });
    else if (action === "submit") result = await commsApi.submitLanguageVariantForReview({ client: supabase, variantId });
    else if (action === "review") result = await commsApi.recordReview({ client: supabase, variantId, status: payload.status, notes: payload.notes });
    else if (action === "approve") result = await commsApi.recordApproval({ client: supabase, variantId });
    else if (action === "revoke") result = await commsApi.revokeApproval({ client: supabase, variantId, reason: payload.reason });
    if (result?.error) { setError(result.error); return; }
    await load();
  };

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 14, color: IVORY, marginBottom: 10 }}>{communication.title}</div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 3, textTransform: "uppercase" }}>Brief</div>
        <textarea value={briefDraft} onChange={(e) => setBriefDraft(e.target.value)} rows={2}
          aria-label="Brief" style={{ ...inputStyle, resize: "vertical", marginBottom: 3 }} />
        <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED }}>Internal context for the communication. It is not itself reviewed or approved.</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 3, textTransform: "uppercase" }}>Master text</div>
        <textarea value={masterTextDraft} onChange={(e) => setMasterTextDraft(e.target.value)} rows={3}
          aria-label="Master text" style={{ ...inputStyle, resize: "vertical", marginBottom: 3 }} />
        <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED }}>Working source text. Language variants are independent snapshots and do not change automatically when this text changes.</div>
      </div>

      {(briefDraft !== (communication.brief ?? "") || masterTextDraft !== (communication.master_text ?? "")) && (
        <button onClick={onSaveContext} disabled={busy} style={{ ...solidBtn(TEAL), marginBottom: 14 }}>Save brief / master text</button>
      )}

      <div style={{ marginTop: 4 }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 6 }}>
          Linked Studio assets
        </div>
        {links.length === 0
          ? <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 8 }}>No assets attached yet.</div>
          : links.map((l) => {
              const asset = studioAssets.find((a) => a.id === l.asset_id);
              return <div key={l.asset_id} style={{ fontFamily: UI, fontSize: 12, color: IVORY, marginBottom: 4 }}>{asset?.title ?? l.asset_id}</div>;
            })}
        {attachableAssets.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <select value={attachAssetId} onChange={(e) => setAttachAssetId(e.target.value)} aria-label="Attach a Studio asset" style={inputStyle}>
              <option value="">Attach a Studio asset…</option>
              {attachableAssets.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
            <button onClick={onAttach} disabled={busy || !attachAssetId} style={solidBtn(TEAL)}>Attach</button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 6 }}>
          Language variants
        </div>
        {variants.length === 0
          ? <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 8 }}>No language variants yet — English or any other of the six is a valid first variant.</div>
          : variants.map((v) => (
              <VariantRow key={v.id} variant={v} reviews={reviewsByVariant[v.id] ?? []} approvals={approvalsByVariant[v.id] ?? []}
                namesByPerson={namesByPerson} userId={userId} isOwnerOrManager={isOwnerOrManager} myLanguages={myLanguages}
                onAction={(action, payload) => onVariantAction(v.id, action, payload)} />
            ))}
        {availableLanguages.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <select value={newLanguage} onChange={(e) => setNewLanguage(e.target.value)} aria-label="Add a language variant" style={{ ...inputStyle, marginBottom: 6 }}>
              <option value="">Add a language variant…</option>
              {availableLanguages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <textarea value={newVariantText} onChange={(e) => setNewVariantText(e.target.value)} rows={3}
              placeholder="Manually authored, or pasted from an external translation — never machine-translated by this system"
              aria-label="Variant text" style={{ ...inputStyle, resize: "vertical", marginBottom: 6 }} />
            <button onClick={onAddVariant} disabled={busy || !newLanguage} style={solidBtn(TEAL)}>Add variant</button>
          </div>
        )}
      </div>

      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

export default function CommunicationsPanel({ campaignId, userId, studioAssets }) {
  const [communications, setCommunications] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [isOwnerOrManager, setIsOwnerOrManager] = useState(false);
  const [myLanguages, setMyLanguages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { communications: list, error: listError } = await commsApi.listCommunications({ client: supabase, campaignId });
    if (listError) { setError(listError); return; }
    setCommunications(list);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      const { data: memberRow } = await supabase.from("campaign_members")
        .select("member_role").eq("campaign_id", campaignId).eq("person", userId).eq("status", "active").maybeSingle();
      if (cancelled) return;
      setIsOwnerOrManager(memberRow?.member_role === "owner" || memberRow?.member_role === "manager");
      const { capabilities } = await commsApi.listCampaignMemberLanguages({ client: supabase, campaignId });
      if (cancelled) return;
      setMyLanguages(capabilities.filter((c) => c.person === userId).map((c) => c.language));
    })();
    return () => { cancelled = true; };
  }, [campaignId, userId]);

  const onCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true); setError(null);
    const { communication, error: createError } = await commsApi.createCommunication({ client: supabase, userId, campaignId, title });
    setBusy(false);
    if (createError) { setError(createError); return; }
    setNewTitle("");
    setSelected(communication);
    await load();
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Communications</Label>
        <Panel>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New communication title"
              aria-label="New communication title" style={inputStyle} />
            <button onClick={onCreate} disabled={busy || !newTitle.trim()} style={solidBtn(TEAL)}>Create</button>
          </div>
          {communications.length === 0
            ? <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No communications yet — create one to start planning.</div>
            : communications.map((c) => <CommunicationRow key={c.id} communication={c} onOpen={setSelected} />)}
          {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
        </Panel>
      </div>
      <div>
        <Label>Detail</Label>
        {selected ? (
          <CommunicationDetail communication={selected} studioAssets={studioAssets} userId={userId}
            isOwnerOrManager={isOwnerOrManager} myLanguages={myLanguages}
            onChanged={load} onCommunicationUpdated={(updated) => { setSelected(updated); load(); }} />
        ) : (
          <Panel>
            <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Choose a communication to see its linked assets and language variants.</div>
          </Panel>
        )}
      </div>
    </div>
  );
}
