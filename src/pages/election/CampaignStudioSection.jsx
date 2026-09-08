// ============================================================
// ELECTION FORGE — CAMPAIGN STUDIO  (Alpha 1.0)
//
// Template gallery -> editor -> save (real, persisted to
// campaign_studio_assets) -> client-side PNG export (canvas, no backend
// export step, no image-generation engine — text/colour only, and this
// screen never claims otherwise). See src/domains/election/design/.
//
// GATE A.5.3 — the actual canvas-drawing logic (previously inline here as
// exportPng()'s body) now lives in design/render.js, shared with the
// Communications export pipeline (see communications/export.js).
//
// GATE A.5.4 — render.js's contract is now {canvas, template, payload}
// (payload = {content, identity}), not the old {textBySlot, identity}.
//
// GATE A.5.4 PHASE 2.1 — this function now routes through design/
// creative.js's buildStudioCreativePayload()/validateCreativePayload(),
// closing the gap Phase 2 deliberately left open. Those functions do NOT
// force the 21 existing templates into the Communications 4-slot
// vocabulary (when/where/ward/callToAction/subject/etc. all keep working
// exactly as before) — instead, EACH TEMPLATE's own `textSlots` is that
// template's closed allowlist. buildStudioCreativePayload() reads
// asset.content.text key-by-key, ONLY for keys the selected template
// itself declares; any other key on that object (brief, created_by,
// reviewer_id, approver_id, status, internal_notes, or anything else a
// human might have typed under an unrelated key) is never read, so it can
// never reach the payload or the renderer, regardless of what the asset's
// own JSON content happens to contain. `asset.content.identity` (which
// historically carried an automatically-populated campaigns.name, the
// exact leak this gate's architecture audit identified) is likewise never
// read — see buildStudioCreativePayload()'s own header.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase.js";
import * as assetsApi from "../../domains/election/design/assets.js";
import { TEMPLATE_LIST, TEMPLATES } from "../../domains/election/design/templates.js";
import { renderTemplateToCanvas, canvasToPngBlob } from "../../domains/election/design/render.js";
import { buildStudioCreativePayload, validateCreativePayload } from "../../domains/election/design/creative.js";
import CommunicationsPanel from "./Communications.jsx";
import { Label, Panel, DemoTag, friendlyError, downloadBlob, ensureCreativeFontsReady, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

// GATE A.5.1 — an in-page tab, NOT a new top-level navigation item (see the
// Gate A.5 architecture report's recommended UI boundary: Campaign Studio
// stays the creative workspace; Communications is its work-item list,
// reachable from here rather than promoted to Election.jsx's own nav until
// real usage justifies it).
const STUDIO_TAB = Object.freeze({ DESIGN: "design", COMMUNICATIONS: "communications" });

function TemplateCard({ template, onSelect }) {
  return (
    <button onClick={() => onSelect(template)}
      style={{ textAlign: "left", fontFamily: UI, padding: "14px 16px", cursor: "pointer",
        background: BLACK, border: `1px solid ${BORDER}`, color: IVORY }}>
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{template.label}</div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>
        {template.dimensions.width}×{template.dimensions.height ?? "auto"}
      </div>
    </button>
  );
}

function AssetRow({ asset, onOpen }) {
  return (
    <button onClick={() => onOpen(asset)}
      style={{ display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", fontFamily: UI,
        padding: "9px 0", background: "transparent", border: "none", borderBottom: `1px solid ${BORDER}`,
        cursor: "pointer", color: IVORY }}>
      <span style={{ fontSize: 12.5 }}>{asset.title}</span>
      <span style={{ fontSize: 10.5, color: MUTED, textTransform: "uppercase" }}>{asset.status}</span>
    </button>
  );
}

/** Renders the asset's current content onto an offscreen canvas and triggers
 *  a PNG download — text/colour only, no image-generation engine.
 *
 *  GATE A.5.4 PHASE 2.1 — builds and validates a payload through the same
 *  closed-shape machinery every other creative render uses (see this
 *  file's own header). `asset.content.identity` (the historical
 *  campaignName leak) is never read — see buildStudioCreativePayload()'s
 *  own header in design/creative.js. */
async function exportPng(asset, template) {
  const { width, height } = template.dimensions;

  const payload = buildStudioCreativePayload({ asset, template, identity: {} });
  const validation = validateCreativePayload({ payload, template });
  if (!validation.valid) return;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height ?? 630;

  await ensureCreativeFontsReady();
  renderTemplateToCanvas({ canvas, template, payload });

  const blob = await canvasToPngBlob(canvas);
  if (!blob) return;
  downloadBlob(blob, `${asset.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
}

function Editor({ asset, onChange, onSave, onExport, busy, error }) {
  const template = TEMPLATES[asset.template_id];
  const setText = (slotId) => (e) => onChange({ ...asset, content: { ...asset.content, text: { ...asset.content.text, [slotId]: e.target.value } } });

  return (
    <Panel accent={AMBER}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY }}>{template.label}</div>
        <DemoTag label="Text/colour only — no AI image generation connected" />
      </div>
      <input value={asset.title} onChange={(e) => onChange({ ...asset, title: e.target.value })}
        placeholder="Asset title" aria-label="Asset title" style={inputStyle} />
      {template.textSlots.map((slot) => (
        <div key={slot.id} style={{ marginBottom: 9 }}>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>{slot.label}</div>
          {slot.maxLength > 300 ? (
            <textarea value={asset.content?.text?.[slot.id] ?? ""} onChange={setText(slot.id)} rows={4}
              maxLength={slot.maxLength} aria-label={slot.label} style={{ ...inputStyle, resize: "vertical" }} />
          ) : (
            <input value={asset.content?.text?.[slot.id] ?? ""} onChange={setText(slot.id)}
              maxLength={slot.maxLength} aria-label={slot.label} style={inputStyle} />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={onSave} disabled={busy}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", border: "none", background: busy ? BORDER : TEAL, color: BLACK,
            cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving…" : "Save draft"}</button>
        <button onClick={onExport}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", background: "transparent", border: `1px solid ${BORDER}`, color: IVORY, cursor: "pointer" }}>
          Export PNG
        </button>
      </div>
      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

export default function CampaignStudioSection({ campaignId, userId, workspaceName }) {
  const [tab, setTab] = useState(STUDIO_TAB.DESIGN);
  const [assets, setAssets] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { assets: list, error: listError } = await assetsApi.listAssets({ client: supabase, campaignId });
    if (listError) { setError(listError); return; }
    setAssets(list);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const onSelectTemplate = async (template) => {
    setBusy(true); setError(null);
    const { asset, error: createError } = await assetsApi.createAsset({
      client: supabase, userId, campaignId, templateId: template.id, title: template.label,
      workspaceIdentity: { campaignName: workspaceName },
    });
    setBusy(false);
    if (createError) { setError(createError); return; }
    setEditing(asset);
    await load();
  };

  const onSave = async () => {
    setBusy(true); setError(null);
    const { asset, error: saveError } = await assetsApi.updateAsset({
      client: supabase, assetId: editing.id, title: editing.title, content: editing.content,
    });
    setBusy(false);
    if (saveError) { setError(saveError); return; }
    setEditing(asset);
    await load();
  };

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
        padding: "9px 16px", border: "none", borderBottom: tab === id ? `2px solid ${TEAL}` : `2px solid ${BORDER}`,
        background: "transparent", color: tab === id ? IVORY : MUTED, cursor: "pointer" }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {tabBtn(STUDIO_TAB.DESIGN, "Design")}
        {tabBtn(STUDIO_TAB.COMMUNICATIONS, "Communications")}
      </div>
      {tab === STUDIO_TAB.COMMUNICATIONS ? (
        <CommunicationsPanel campaignId={campaignId} userId={userId} studioAssets={assets} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
          <div>
            <Label>Templates</Label>
            <Panel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                {TEMPLATE_LIST.map((t) => <TemplateCard key={t.id} template={t} onSelect={onSelectTemplate} />)}
              </div>
            </Panel>
            <div style={{ marginTop: 18 }}>
              <Label>Your assets</Label>
              <Panel>
                {assets.length === 0
                  ? <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No assets yet — choose a template to start one.</div>
                  : assets.map((a) => <AssetRow key={a.id} asset={a} onOpen={setEditing} />)}
              </Panel>
            </div>
          </div>
          <div>
            <Label>Editor</Label>
            {editing ? (
              <Editor asset={editing} onChange={setEditing} onSave={onSave}
                onExport={() => exportPng(editing, TEMPLATES[editing.template_id])} busy={busy} error={error} />
            ) : (
              <Panel>
                <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Choose a template or open a saved asset to start editing.</div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
