// ============================================================
// ELECTIONCANON — COMMUNICATIONS  (Gate A.5.1: minimal CRUD/list surface)
//
// Intentionally thin. Proves the Communication/Language Variant/Review/
// Approval object model exists and is reachable from the product — it
// does NOT build the review workspace, scheduling, publishing, or
// analytics (all later A.5.x gates; see the Gate A.5 architecture
// reconnaissance report). Reviews/approvals are DISPLAYED here if they
// already exist; this screen has no button that creates one, on purpose —
// that workflow is A.5.2's to build.
//
// Rendered as an in-page tab inside CampaignStudioSection.jsx, not a new
// top-level navigation item — Campaign Studio remains the creative
// workspace; this is its Communications work-item list, per the approved
// Gate A.5 product boundary (Campaign Studio = creative workspace,
// Communications Engine = governance/workflow layer).
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase.js";
import * as commsApi from "../../domains/election/communications/api.js";
import { Label, Panel, StatusChip, friendlyError, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

const STATUS_COLOR = Object.freeze({ pending: AMBER, approved: TEAL, rejected: PINK });

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

function VariantRow({ variant, reviews, approvals }) {
  const languageLabel = commsApi.COMMUNICATION_LANGUAGES.find((l) => l.code === variant.language)?.label ?? variant.language;
  const latestReview = reviews[0] ?? null;
  const latestApproval = approvals[0] ?? null;
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY }}>{languageLabel}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {latestReview && <StatusChip status={`review: ${latestReview.status}`} color={STATUS_COLOR[latestReview.status]} />}
          {latestApproval && <StatusChip status={`approval: ${latestApproval.status}`} color={STATUS_COLOR[latestApproval.status]} />}
          {!latestReview && !latestApproval && <span style={{ fontFamily: UI, fontSize: 10.5, color: MUTED }}>Not yet reviewed</span>}
        </div>
      </div>
      <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, whiteSpace: "pre-wrap" }}>{variant.text || "(no text yet)"}</div>
    </div>
  );
}

function CommunicationDetail({ communication, studioAssets, onChanged }) {
  const [links, setLinks] = useState([]);
  const [variants, setVariants] = useState([]);
  const [reviewsByVariant, setReviewsByVariant] = useState({});
  const [approvalsByVariant, setApprovalsByVariant] = useState({});
  const [attachAssetId, setAttachAssetId] = useState("");
  const [newLanguage, setNewLanguage] = useState("");
  const [newVariantText, setNewVariantText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [{ links: assetLinks }, { variants: variantList }] = await Promise.all([
      commsApi.listCommunicationAssets({ client: supabase, communicationId: communication.id }),
      commsApi.listLanguageVariants({ client: supabase, communicationId: communication.id }),
    ]);
    setLinks(assetLinks);
    setVariants(variantList);
    const reviewEntries = await Promise.all(variantList.map((v) => commsApi.listReviews({ client: supabase, languageVariantId: v.id })));
    const approvalEntries = await Promise.all(variantList.map((v) => commsApi.listApprovals({ client: supabase, languageVariantId: v.id })));
    setReviewsByVariant(Object.fromEntries(variantList.map((v, i) => [v.id, reviewEntries[i].reviews])));
    setApprovalsByVariant(Object.fromEntries(variantList.map((v, i) => [v.id, approvalEntries[i].approvals])));
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

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 14, color: IVORY, marginBottom: 4 }}>{communication.title}</div>
      {communication.brief && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 10 }}>{communication.brief}</div>}

      <div style={{ marginTop: 14 }}>
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
            <button onClick={onAttach} disabled={busy || !attachAssetId}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "9px 14px", border: "none", background: TEAL, color: BLACK, cursor: "pointer", whiteSpace: "nowrap" }}>
              Attach
            </button>
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
              <VariantRow key={v.id} variant={v} reviews={reviewsByVariant[v.id] ?? []} approvals={approvalsByVariant[v.id] ?? []} />
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
            <button onClick={onAddVariant} disabled={busy || !newLanguage}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "9px 14px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>
              Add variant
            </button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { communications: list, error: listError } = await commsApi.listCommunications({ client: supabase, campaignId });
    if (listError) { setError(listError); return; }
    setCommunications(list);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

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
            <button onClick={onCreate} disabled={busy || !newTitle.trim()}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "11px 16px", border: "none", background: TEAL, color: BLACK, cursor: "pointer", whiteSpace: "nowrap" }}>
              Create
            </button>
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
          <CommunicationDetail communication={selected} studioAssets={studioAssets} onChanged={load} />
        ) : (
          <Panel>
            <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Choose a communication to see its linked assets and language variants.</div>
          </Panel>
        )}
      </div>
    </div>
  );
}
