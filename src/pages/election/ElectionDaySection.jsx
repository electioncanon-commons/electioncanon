// ============================================================
// ELECTIONCANON — ELECTION DAY  (Alpha 1.1 — SIMULATION)
//
// Real, Canon-backed (folded from electionday.* event types). Alpha 1.1
// adds REAL result-sheet photo upload (private Supabase Storage, see
// src/domains/election/electionDay/evidence.js and the migration that
// created the bucket) and structured, human-entered extracted fields — the
// MECHANICS are now real. The CONTENT is still explicitly Alpha
// test/demonstration data (`simulated: true` on every event, never
// overridable from this UI), and a verified result is labelled
// "ElectionCanon Verified Evidence" — never "Official Result" — because no
// OCR runs and this is not an INEC/IReV integration. See
// docs/ARCHITECTURE.md's evidence-architecture section.
// ============================================================

import { useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { prepareElectionDayWrite, approveElectionDayWrite, ELECTION_DAY_OPERATION } from "../../os/electionWebAdapter.js";
import {
  AGENT_STATUS, VERIFICATION_STATUS, INCIDENT_CATEGORIES, INCIDENT_STATUS, INCIDENT_SEVERITY,
  OCR_STATUS, OCR_CONFIDENCE, resultLifecycleStage,
} from "../../domains/election/electionDay/write.js";
import { uploadResultEvidence, getResultEvidenceUrl, hashResultEvidence, compressResultEvidence } from "../../domains/election/electionDay/evidence.js";
import { runOcrExtraction } from "../../domains/election/electionDay/ocr.js";
import { Label, Panel, DemoTag, StructuredWritePanel, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

const TABS = Object.freeze([
  { id: "coverage", label: "Coverage" },
  { id: "agents", label: "Agents" },
  { id: "results", label: "Results" },
  { id: "incidents", label: "Incidents" },
]);

function SubNav({ tab, setTab }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "8px 14px", cursor: "pointer",
              background: active ? "rgba(10,180,160,0.12)" : "transparent",
              border: `1px solid ${active ? TEAL : BORDER}`, color: active ? IVORY : MUTED }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
      padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>{children}</div>
  );
}
function Empty({ children }) { return <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>{children}</div>; }
function chip(color) {
  return { fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
    color, border: `1px solid ${color}`, padding: "3px 8px" };
}

function CoverageTab({ ctx, campaignId, refresh }) {
  const pollingUnits = Object.values(ctx.view?.pollingUnits ?? {});
  const agents = Object.values(ctx.view?.agents ?? {});
  const byState = {};
  for (const pu of pollingUnits) {
    byState[pu.state] ??= {};
    byState[pu.state][pu.lga] ??= {};
    byState[pu.state][pu.lga][pu.ward] ??= [];
    byState[pu.state][pu.lga][pu.ward].push(pu);
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Label>Coverage — state / LGA / ward / polling unit</Label>
        </div>
        <Panel>
          <DemoTag label="Simulation / demonstration data — not official election results" />
          <div style={{ marginTop: 12 }}>
            {pollingUnits.length === 0 ? <Empty>No polling units added yet.</Empty> : Object.entries(byState).map(([state, lgas]) => (
              <div key={state} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: UI, fontWeight: 800, fontSize: 12, color: IVORY }}>{state} State</div>
                {Object.entries(lgas).map(([lga, wards]) => (
                  <div key={lga} style={{ marginLeft: 14, marginTop: 6 }}>
                    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, color: TEAL }}>{lga} LGA</div>
                    {Object.entries(wards).map(([ward, units]) => {
                      const assignedCount = units.filter((u) => agents.some((a) => a.pollingUnit === u.id)).length;
                      const geo = units.find((u) => u.senatorialDistrict || u.federalConstituency || u.stateConstituency);
                      return (
                        <div key={ward} style={{ marginLeft: 14, marginTop: 4, fontFamily: UI, fontSize: 11.5, color: MUTED }}>
                          {ward} — {units.length} polling unit{units.length === 1 ? "" : "s"} known · {assignedCount} with an agent assigned
                          {geo && (
                            <span style={{ color: "rgba(245,241,233,.5)" }}>
                              {" "}({[geo.senatorialDistrict, geo.federalConstituency, geo.stateConstituency].filter(Boolean).join(" · ")})
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div>
        <StructuredWritePanel
          title="Add polling unit" operation={ELECTION_DAY_OPERATION.ADD_POLLING_UNIT}
          prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
          campaignId={campaignId} refresh={refresh}
          fields={[
            { id: "state", label: "State", placeholder: "e.g. Delta" },
            { id: "lga", label: "LGA", placeholder: "e.g. Uvwie" },
            { id: "ward", label: "Ward", placeholder: "e.g. Ward 3" },
            { id: "code", label: "Polling unit identifier", placeholder: "e.g. PU-001" },
            { id: "name", label: "Name (optional)" },
            { id: "senatorialDistrict", label: "Senatorial district (optional)" },
            { id: "federalConstituency", label: "Federal constituency (optional)" },
            { id: "stateConstituency", label: "State constituency (optional)" },
          ]}
        />
      </div>
    </div>
  );
}

function AgentsTab({ ctx, campaignId, refresh }) {
  const agents = Object.values(ctx.view?.agents ?? {});
  const pollingUnits = Object.values(ctx.view?.pollingUnits ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Polling-unit agents</Label>
        <Panel>
          {agents.length === 0 ? <Empty>No agents assigned yet.</Empty> : agents.map((a) => (
            <Row key={a.id}>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{a.person}</div>
                <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                  polling unit: {pollingUnits.find((p) => p.id === a.pollingUnit)?.code ?? a.pollingUnit}
                </div>
              </div>
              <span style={chip(a.status === AGENT_STATUS.SUBMITTED ? TEAL : AMBER)}>{a.status?.replace(/_/g, " ")}</span>
            </Row>
          ))}
        </Panel>
        {agents.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title="Change agent status" operation={ELECTION_DAY_OPERATION.CHANGE_AGENT_STATUS}
              prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER}
              fields={[
                { id: "agentId", label: "Agent", type: "select", options: agents.map((a) => ({ value: a.id, label: `${a.person} @ ${pollingUnits.find((p) => p.id === a.pollingUnit)?.code ?? a.pollingUnit}` })) },
                { id: "status", label: "Status", type: "select", options: Object.values(AGENT_STATUS).map((s) => ({ value: s, label: s.replace(/_/g, " ") })) },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <StructuredWritePanel
          title="Assign agent" operation={ELECTION_DAY_OPERATION.ASSIGN_AGENT}
          prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
          campaignId={campaignId} refresh={refresh}
          fields={[
            { id: "pollingUnitId", label: "Polling unit", type: "select",
              options: pollingUnits.length ? pollingUnits.map((p) => ({ value: p.id, label: `${p.code} (${p.ward})` })) : [{ value: "", label: "No polling units yet — add one first" }] },
            { id: "person", label: "Agent name", placeholder: "e.g. Chinedu Eze" },
          ]}
        />
      </div>
    </div>
  );
}

function EvidenceThumbnail({ path }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    const { url: signed, error: err } = await getResultEvidenceUrl({ client: supabase, path });
    if (err) { setError(err); return; }
    setUrl(signed);
  };
  if (!path) return null;
  return url ? (
    <img src={url} alt="Result-sheet evidence photo" style={{ maxWidth: 160, border: `1px solid ${BORDER}`, display: "block", marginTop: 6 }} />
  ) : (
    <button onClick={load} style={{ ...linkBtnStyle(), fontSize: 10.5, marginTop: 4 }}>
      {error ? `could not load photo (${error})` : "View evidence photo →"}
    </button>
  );
}
function linkBtnStyle() {
  return { fontFamily: UI, fontWeight: 700, letterSpacing: "0.06em", background: "transparent", border: "none", color: TEAL, cursor: "pointer", padding: 0 };
}

// ALPHA 1.1 — explicit upload-state machine (directive §"low-bandwidth
// upload states"): QUEUED/UPLOADING/UPLOADED/FAILED, never collapsed into a
// generic busy flag, so a slow/failed upload on poor connectivity is never
// silently reported as complete. RETRY re-attempts the SAME evidenceImagePath
// slot (same confirmationId), it does not fabricate a new one.
const UPLOAD_STATE = Object.freeze({
  IDLE: "IDLE", QUEUED: "QUEUED", UPLOADING: "UPLOADING", UPLOADED: "UPLOADED", FAILED: "FAILED",
});

function CaptureResultPanel({ campaignId, userId, pollingUnits, results, refresh }) {
  const [pollingUnitId, setPollingUnitId] = useState(pollingUnits[0]?.id ?? "");
  const [file, setFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [fieldRows, setFieldRows] = useState([{ field: "", value: "" }]);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [uploadState, setUploadState] = useState(UPLOAD_STATE.IDLE);
  const [evidenceImagePath, setEvidenceImagePath] = useState(null);
  const [evidenceHash, setEvidenceHash] = useState(null);
  const [confirmationId, setConfirmationId] = useState(null);
  const [compressionNote, setCompressionNote] = useState(null);

  const onPhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f); setPhotoPreview(URL.createObjectURL(f));
      setUploadState(UPLOAD_STATE.QUEUED); setEvidenceImagePath(null); setEvidenceHash(null);
      setConfirmationId(null); setCompressionNote(null); setError(null);
    }
  };
  const updateRow = (i, key, val) => setFieldRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () => setFieldRows((rows) => [...rows, { field: "", value: "" }]);
  const removeRow = (i) => setFieldRows((rows) => rows.filter((_, idx) => idx !== i));

  const reset = () => {
    setFile(null); setPhotoPreview(null); setFieldRows([{ field: "", value: "" }]); setPrepared(null);
    setUploadState(UPLOAD_STATE.IDLE); setEvidenceImagePath(null); setEvidenceHash(null);
    setConfirmationId(null); setCompressionNote(null);
  };

  // ALPHA 1.3 — compress BEFORE hashing/uploading: low-bandwidth field
  // conditions are the reason this exists, so the bytes that actually
  // travel over the network are the same bytes hashed and stored. Never
  // blocks the upload — compressResultEvidence() always returns a usable
  // file, original or compressed, and never throws.
  const runUpload = async () => {
    setUploadState(UPLOAD_STATE.UPLOADING); setError(null);
    const id = confirmationId ?? crypto.randomUUID();
    setConfirmationId(id);
    const { file: uploadFile, compressed, reason } = await compressResultEvidence({ file });
    setCompressionNote(compressed ? `compressed ${(file.size / 1024).toFixed(0)}KB → ${(uploadFile.size / 1024).toFixed(0)}KB` : reason);
    const [{ path, error: uploadError }, hash] = await Promise.all([
      uploadResultEvidence({ client: supabase, campaignId, resultId: id, file: uploadFile }),
      hashResultEvidence(uploadFile),
    ]);
    if (uploadError) { setUploadState(UPLOAD_STATE.FAILED); setError(uploadError); return null; }
    setUploadState(UPLOAD_STATE.UPLOADED); setEvidenceImagePath(path); setEvidenceHash(hash);
    return path;
  };

  const doPrepare = async () => {
    setBusy(true); setError(null);
    let path = evidenceImagePath;
    let id = confirmationId;
    if (file && uploadState !== UPLOAD_STATE.UPLOADED) {
      path = await runUpload();
      id = confirmationId ?? id;
      if (path === null) { setBusy(false); return; }
    }
    if (!id) id = crypto.randomUUID();
    const knownEvidenceHashes = (results ?? [])
      .filter((r) => r.evidenceHash)
      .map((r) => ({ hash: r.evidenceHash, pollingUnit: pollingUnits.find((p) => p.id === r.pollingUnit)?.code ?? r.pollingUnit }));
    const result = await prepareElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.CAPTURE_RESULT,
      fields: { pollingUnitId, evidenceImagePath: path, evidenceHash, extractedFields: fieldRows },
      knownEvidenceHashes,
    });
    setBusy(false);
    if (result.status !== "PREPARED") { setError(result.reason ?? `could not prepare: ${result.status}`); return; }
    setPrepared({ draft: result.draft, confirmationId: id });
  };

  const doApprove = async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.CAPTURE_RESULT,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "approval failed"); return; }
    reset();
    await refresh();
  };

  return (
    <Panel accent={AMBER}>
      <DemoTag label="Simulation content — real photo upload, not an official result" />
      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, margin: "12px 0", lineHeight: 1.6 }}>
        The photo below is genuinely uploaded and preserved as evidence (private, tenant-isolated
        storage). Fields entered here are manual; once captured, you can run real OCR extraction
        from the photo below and review its reading before it counts as verified. Every event this
        records stays marked as Alpha simulation data, never an official election result.
      </div>
      {!prepared ? (
        <>
          <select value={pollingUnitId} onChange={(e) => setPollingUnitId(e.target.value)} aria-label="Polling unit" style={{ ...inputStyle }}>
            {pollingUnits.length === 0
              ? <option value="">No polling units yet — add one first</option>
              : pollingUnits.map((p) => <option key={p.id} value={p.id}>{p.code} ({p.ward})</option>)}
          </select>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={onPhoto}
            aria-label="Result sheet photo" style={{ fontFamily: UI, fontSize: 11.5, color: IVORY, marginBottom: 10, display: "block" }} />
          {photoPreview && <img src={photoPreview} alt="Selected result-sheet photo" style={{ maxWidth: "100%", border: `1px solid ${BORDER}`, marginBottom: 8 }} />}
          {file && (
            <div style={{ fontFamily: UI, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12,
              color: uploadState === UPLOAD_STATE.FAILED ? PINK : uploadState === UPLOAD_STATE.UPLOADED ? TEAL : MUTED }}>
              {uploadState === UPLOAD_STATE.QUEUED && "Photo queued — will upload when you prepare"}
              {uploadState === UPLOAD_STATE.UPLOADING && "Uploading photo…"}
              {uploadState === UPLOAD_STATE.UPLOADED && "Photo uploaded and preserved"}
              {uploadState === UPLOAD_STATE.FAILED && "Upload failed — not saved"}
              {uploadState === UPLOAD_STATE.FAILED && (
                <button type="button" onClick={runUpload} style={{ ...linkBtnStyle(), marginLeft: 10, textTransform: "none", fontWeight: 700, color: PINK }}>
                  Retry upload
                </button>
              )}
              {uploadState === UPLOAD_STATE.UPLOADED && compressionNote && (
                <div style={{ fontWeight: 400, textTransform: "none", color: MUTED, marginTop: 3 }}>{compressionNote}</div>
              )}
            </div>
          )}
          <div style={{ fontFamily: UI, fontSize: 10.5, color: TEAL, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Extracted fields (manual entry)</div>
          {fieldRows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={row.field} onChange={(e) => updateRow(i, "field", e.target.value)} placeholder="e.g. Candidate A"
                aria-label={`Field name ${i + 1}`} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              <input value={row.value} onChange={(e) => updateRow(i, "value", e.target.value)} placeholder="e.g. 124"
                aria-label={`Field value ${i + 1}`} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              {fieldRows.length > 1 && <button type="button" onClick={() => removeRow(i)} style={{ ...linkBtnStyle(), color: PINK }}>remove</button>}
            </div>
          ))}
          <button type="button" onClick={addRow} style={{ ...linkBtnStyle(), marginBottom: 14 }}>+ add another field</button>
          <div>
            <button onClick={doPrepare} disabled={busy || !pollingUnitId || uploadState === UPLOAD_STATE.UPLOADING}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                padding: "11px 18px", border: "none", background: busy || !pollingUnitId ? BORDER : AMBER, color: BLACK,
                cursor: busy || !pollingUnitId ? "not-allowed" : "pointer" }}>
              {uploadState === UPLOAD_STATE.UPLOADING ? "Uploading…" : busy ? "Preparing…" : "Prepare"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>
            Proposed action — not yet recorded
          </div>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, marginBottom: 6 }}>{prepared.draft.summary}</div>
          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 14 }}>{prepared.draft.notice}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={doApprove} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
                padding: "11px 18px", border: "none", background: busy ? BORDER : AMBER, color: BLACK,
                cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Recording…" : "Approve"}</button>
            <button onClick={reset} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
                padding: "11px 18px", cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Cancel</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{error}</div>}
    </Panel>
  );
}

const OCR_STATUS_LABEL = Object.freeze({
  [OCR_STATUS.NOT_RUN]: "not yet run", [OCR_STATUS.PROCESSING]: "extracting…",
  [OCR_STATUS.COMPLETE]: "complete", [OCR_STATUS.FAILED]: "failed", [OCR_STATUS.UNAVAILABLE]: "unavailable",
});

// ALPHA 1.3 — a field named like a count (votes, turnout, accreditation,
// invalid ballots, a running total) that OCR or a human somehow entered as
// non-numeric is worth a second look; kept narrow on purpose so an
// ordinary label like "Presiding officer" is never mistaken for one.
const COUNT_FIELD_PATTERN = /vote|turnout|accredit|invalid|regist|total|count|reject/i;

/** Best-effort, flag-only checks — NEVER auto-correct a value, only ever
 *  render a note for a human to weigh against the photo. Three independent
 *  checks, each silent unless it actually finds something to flag:
 *  (1) a "total"-labelled row vs. the sum of other numeric rows (Alpha 1.2);
 *  (2) any row reading a negative number — no election tally field is ever
 *  negative; (3) a count-shaped field name (see COUNT_FIELD_PATTERN) whose
 *  value isn't numeric at all. */
function ConsistencyNote({ rows }) {
  const notes = [];

  const totalRow = rows.find((r) => /total/i.test(r.field));
  if (totalRow) {
    const totalVal = Number(String(totalRow.value).trim());
    if (Number.isFinite(totalVal)) {
      const others = rows.filter((r) => r !== totalRow && /^-?\d+(\.\d+)?$/.test(String(r.value).trim()));
      if (others.length >= 2) {
        const sum = others.reduce((acc, r) => acc + Number(r.value), 0);
        notes.push({
          ok: sum === totalVal,
          text: `${others.length} other numeric field${others.length === 1 ? "" : "s"} sum to ${sum}; "${totalRow.field}" reads ${totalVal}.` +
            (sum === totalVal ? " These match." : " These do not match."),
        });
      }
    }
  }

  const negatives = rows.filter((r) => /^-\d+(\.\d+)?$/.test(String(r.value).trim()));
  if (negatives.length) {
    notes.push({
      ok: false,
      text: `${negatives.length} field${negatives.length === 1 ? "" : "s"} read a negative value ` +
        `(${negatives.map((r) => `"${r.field}": ${r.value}`).join(", ")}) — a tally is never negative.`,
    });
  }

  const nonNumericCounts = rows.filter((r) =>
    COUNT_FIELD_PATTERN.test(r.field) && r !== totalRow && !negatives.includes(r) &&
    String(r.value).trim() && !/^\d+(\.\d+)?$/.test(String(r.value).trim()));
  if (nonNumericCounts.length) {
    notes.push({
      ok: false,
      text: `${nonNumericCounts.length} field${nonNumericCounts.length === 1 ? "" : "s"} named like a count ` +
        `(${nonNumericCounts.map((r) => `"${r.field}"`).join(", ")}) read a non-numeric value.`,
    });
  }

  if (!notes.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {notes.map((note, i) => (
        <div key={i} style={{ fontFamily: UI, fontSize: 10.5, marginTop: i === 0 ? 0 : 6, padding: "8px 10px",
          border: `1px solid ${note.ok ? TEAL : PINK}`, color: note.ok ? TEAL : PINK, lineHeight: 1.5 }}>
          Best-effort consistency check (a flag, not a correction — review the photo yourself): {note.text}
        </div>
      ))}
    </div>
  );
}

/** ALPHA 1.2 — the human-review workflow: PHOTO -> EVIDENCE (Alpha 1.1) ->
 *  OCR -> EXTRACTED VALUES -> HUMAN REVIEW -> VERIFIED VALUES. "Extract
 *  from image" runs OCR entirely client-side (electionDay/ocr.js), then
 *  still goes through the SAME PREPARE -> APPROVE discipline as every
 *  other Canon write — running OCR is a client-side computation, but
 *  RECORDING that it ran is a write like any other, never auto-executed.
 *  Once OCR is COMPLETE, the review rows below are editable — confirming
 *  or correcting a value is itself a second PREPARE -> APPROVE
 *  (VERIFY_RESULT with reviewedFields), preserving `ocrValue` untouched. */
function OcrReviewPanel({ result, campaignId, refresh }) {
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const [ocrDraft, setOcrDraft] = useState(null);

  const startExtraction = async () => {
    setBusy(true); setError(null);
    const { url, error: urlError } = await getResultEvidenceUrl({ client: supabase, path: result.evidenceImagePath });
    if (urlError) { setBusy(false); setError(`could not load the evidence photo (${urlError})`); return; }
    setExtracting(true);
    const extraction = await runOcrExtraction({ imageUrl: url });
    setExtracting(false);
    const id = crypto.randomUUID();
    const prep = await prepareElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
      fields: { resultId: result.id, ocrProvider: extraction.provider, ocrStatus: extraction.status, ocrExtractedFields: extraction.extractedFields },
    });
    setBusy(false);
    if (prep.status !== "PREPARED") { setError(prep.reason ?? `could not prepare: ${prep.status}`); return; }
    setOcrDraft({ draft: prep.draft, confirmationId: id, reason: extraction.reason });
  };

  const approveExtraction = async () => {
    if (!ocrDraft) return;
    setBusy(true); setError(null);
    const res = await approveElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.RECORD_OCR_EXTRACTION,
      draft: ocrDraft.draft.draft, confirmationId: ocrDraft.confirmationId,
    });
    setBusy(false);
    if (!res.success) { setError(res.error ?? "approval failed"); return; }
    setOcrDraft(null);
    await refresh();
  };

  // ---------- Human review (only once OCR has COMPLETEd) ----------
  const existingByField = Object.fromEntries((result.extractedFields ?? []).map((f) => [f.field, f]));
  const [reviewRows, setReviewRows] = useState(() => (result.ocr.extractedFields ?? []).map((f) => {
    const existing = existingByField[f.field];
    return { field: f.field, ocrValue: f.value, value: existing?.value ?? f.value, confidence: f.confidence, source: existing?.source ?? "ocr_confirmed" };
  }));
  const [reviewStatus, setReviewStatus] = useState(result.verificationStatus === VERIFICATION_STATUS.PENDING ? VERIFICATION_STATUS.VERIFIED : result.verificationStatus);
  const [reviewDraft, setReviewDraft] = useState(null);

  const updateRowValue = (i, val) => setReviewRows((rows) => rows.map((r, idx) => idx === i
    ? { ...r, value: val, source: r.ocrValue == null ? "manual" : val === r.ocrValue ? "ocr_confirmed" : "ocr_corrected" } : r));
  const updateRowField = (i, val) => setReviewRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, field: val } : r)));
  const addManualRow = () => setReviewRows((rows) => [...rows, { field: "", ocrValue: null, value: "", confidence: null, source: "manual" }]);
  const removeRow = (i) => setReviewRows((rows) => rows.filter((_, idx) => idx !== i));

  const prepareReview = async () => {
    setBusy(true); setError(null);
    const id = crypto.randomUUID();
    const prep = await prepareElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.VERIFY_RESULT,
      fields: { resultId: result.id, verificationStatus: reviewStatus, reviewedFields: reviewRows.filter((r) => r.field && r.value) },
    });
    setBusy(false);
    if (prep.status !== "PREPARED") { setError(prep.reason ?? `could not prepare: ${prep.status}`); return; }
    setReviewDraft({ draft: prep.draft, confirmationId: id });
  };

  const approveReview = async () => {
    if (!reviewDraft) return;
    setBusy(true); setError(null);
    const res = await approveElectionDayWrite({
      client: supabase, requestedCampaign: campaignId, operation: ELECTION_DAY_OPERATION.VERIFY_RESULT,
      draft: reviewDraft.draft.draft, confirmationId: reviewDraft.confirmationId,
    });
    setBusy(false);
    if (!res.success) { setError(res.error ?? "approval failed"); return; }
    setReviewDraft(null);
    await refresh();
  };

  if (!result.evidenceImagePath) return null;

  if (result.ocr.status !== OCR_STATUS.COMPLETE) {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>
          OCR: {OCR_STATUS_LABEL[result.ocr.status] ?? result.ocr.status}
        </div>
        {!ocrDraft ? (
          <button onClick={startExtraction} disabled={busy} style={{ ...linkBtnStyle(), fontSize: 10.5 }}>
            {extracting ? "Extracting from image…" : busy ? "Preparing…" : "Extract from image →"}
          </button>
        ) : (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontFamily: UI, fontSize: 11.5, color: IVORY }}>{ocrDraft.draft.summary}</div>
            {ocrDraft.reason && <div style={{ fontFamily: UI, fontSize: 10.5, color: PINK, marginTop: 2 }}>{ocrDraft.reason}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={approveExtraction} disabled={busy}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                  padding: "8px 14px", border: "none", background: busy ? BORDER : AMBER, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Recording…" : "Approve"}
              </button>
              <button onClick={() => setOcrDraft(null)} disabled={busy}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                  padding: "8px 14px", cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Cancel</button>
            </div>
          </div>
        )}
        {error && <div style={{ fontFamily: UI, fontSize: 11, color: PINK, marginTop: 6 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, padding: 10, border: `1px solid ${BORDER}` }}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: TEAL, marginBottom: 8 }}>
        Human review — extracted from image
      </div>
      {reviewRows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
          {row.source === "manual" ? (
            <input value={row.field} onChange={(e) => updateRowField(i, e.target.value)} placeholder="field OCR missed"
              aria-label={`Field name ${i + 1}`} style={{ ...inputStyle, marginBottom: 0, width: 140 }} />
          ) : (
            <div style={{ width: 140, fontFamily: UI, fontSize: 11, color: IVORY }}>{row.field}</div>
          )}
          {row.ocrValue != null && (
            <div style={{ fontFamily: UI, fontSize: 10, color: MUTED }}>OCR read "{row.ocrValue}" ({row.confidence ?? OCR_CONFIDENCE.UNKNOWN})</div>
          )}
          <input value={row.value} onChange={(e) => updateRowValue(i, e.target.value)} placeholder="value"
            aria-label={`Field value ${i + 1}`} style={{ ...inputStyle, marginBottom: 0, width: 100 }} />
          <span style={chip(row.source === "ocr_corrected" ? AMBER : row.source === "manual" ? MUTED : TEAL)}>{row.source}</span>
          <button type="button" onClick={() => removeRow(i)} style={{ ...linkBtnStyle(), color: PINK, fontSize: 10.5 }}>remove</button>
        </div>
      ))}
      <button type="button" onClick={addManualRow} style={{ ...linkBtnStyle(), fontSize: 10.5, marginBottom: 8 }}>+ add a field OCR missed</button>
      <ConsistencyNote rows={reviewRows} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} aria-label="Verification decision" style={{ ...inputStyle, marginBottom: 0, width: 160 }}>
          {Object.values(VERIFICATION_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {!reviewDraft ? (
          <button onClick={prepareReview} disabled={busy}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "8px 14px", border: "none", background: busy ? BORDER : TEAL, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
            {busy ? "Preparing…" : "Prepare review"}
          </button>
        ) : null}
      </div>
      {reviewDraft && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: UI, fontSize: 11.5, color: IVORY }}>{reviewDraft.draft.summary}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={approveReview} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "8px 14px", border: "none", background: busy ? BORDER : TEAL, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
              {busy ? "Recording…" : "Approve"}
            </button>
            <button onClick={() => setReviewDraft(null)} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "8px 14px", cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 11, color: PINK, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function ResultsTab({ ctx, campaignId, userId, refresh }) {
  const results = Object.values(ctx.view?.results ?? {});
  const pollingUnits = Object.values(ctx.view?.pollingUnits ?? {});
  const verifiedResults = results.filter((r) => r.verificationStatus === VERIFICATION_STATUS.VERIFIED);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Results (simulation)</Label>
        <Panel>
          <DemoTag label="Simulated election data — not official results" />
          <div style={{ marginTop: 12 }}>
            {results.length === 0 ? <Empty>No results captured yet.</Empty> : results.map((r) => (
              <div key={r.id} style={{ padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>
                      {pollingUnits.find((p) => p.id === r.pollingUnit)?.code ?? r.pollingUnit}
                    </div>
                    <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>submitted by {r.submittedBy?.slice(0, 8)}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <span style={chip(r.verificationStatus === VERIFICATION_STATUS.VERIFIED ? TEAL
                      : (r.verificationStatus === VERIFICATION_STATUS.REJECTED || r.verificationStatus === VERIFICATION_STATUS.DISPUTED) ? PINK : AMBER)}>
                      {r.verificationStatus === VERIFICATION_STATUS.VERIFIED ? "ELECTIONCANON VERIFIED EVIDENCE" : r.verificationStatus}
                    </span>
                    <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED }}>
                      stage: {resultLifecycleStage(r)}
                    </span>
                  </div>
                </div>
                {r.extractedFields?.length > 0 && (
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 6 }}>
                    {r.extractedFields.map((f) => `${f.field}: ${f.value}` +
                      (f.source === "manual" || !f.source ? " (confidence: not available — manual entry)"
                        : f.source === "ocr_corrected" ? ` (OCR read "${f.ocrValue}", corrected by a human)`
                        : ` (confirmed as read — OCR confidence: ${f.confidence ?? "UNKNOWN"})`)).join(" · ")}
                  </div>
                )}
                <EvidenceThumbnail path={r.evidenceImagePath} />
                <OcrReviewPanel result={r} campaignId={campaignId} refresh={refresh} />
              </div>
            ))}
          </div>
          <div style={{ fontFamily: UI, fontSize: 11.5, color: TEAL, marginTop: 12 }}>
            {verifiedResults.length} verified · {results.length - verifiedResults.length} pending review
          </div>
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            "ElectionCanon Verified Evidence" means a human on this workspace confirmed the entered
            figures against the attached photo — it is never an official INEC or IReV result.
          </div>
        </Panel>
        {results.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title="Verify result" operation={ELECTION_DAY_OPERATION.VERIFY_RESULT}
              prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER}
              fields={[
                { id: "resultId", label: "Result", type: "select", options: results.map((r) => ({ value: r.id, label: pollingUnits.find((p) => p.id === r.pollingUnit)?.code ?? r.pollingUnit })) },
                { id: "verificationStatus", label: "Verification", type: "select", options: Object.values(VERIFICATION_STATUS).map((s) => ({ value: s, label: s })) },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <Label>Capture result</Label>
        <CaptureResultPanel campaignId={campaignId} userId={userId} pollingUnits={pollingUnits} results={results} refresh={refresh} />
      </div>
    </div>
  );
}

const SEVERITY_COLOR = Object.freeze({
  [INCIDENT_SEVERITY.LOW]: MUTED, [INCIDENT_SEVERITY.MEDIUM]: AMBER, [INCIDENT_SEVERITY.HIGH]: PINK, [INCIDENT_SEVERITY.CRITICAL]: PINK,
});

function IncidentsTab({ ctx, campaignId, refresh }) {
  const incidents = Object.values(ctx.view?.incidents ?? {});
  const pollingUnits = Object.values(ctx.view?.pollingUnits ?? {});
  const results = Object.values(ctx.view?.results ?? {});
  // Escalation targets are the campaign's OWN recorded people — never an
  // invented org chart. This is the SAME `roster` shape
  // proposeChangeIncidentStatus validates against, so a target this
  // dropdown offers is guaranteed to pass that check.
  const roster = Object.values(ctx.view?.people ?? {}).map((p) => ({ id: p.id, name: p.name, roleType: p.roleType }));
  // Same discipline for a linked result — the dropdown only offers real,
  // already-captured results, matching proposeReportIncident's own
  // knownResultIds validation exactly.
  const knownResultIds = results.map((r) => r.id);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Incident log</Label>
        <Panel accent={PINK}>
          {incidents.length === 0 ? <Empty>No incidents reported.</Empty> : incidents.map((i) => (
            <Row key={i.id}>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{i.category?.replace(/_/g, " ")}</div>
                <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>{i.description}</div>
                {i.escalatedTo && (
                  <div style={{ fontFamily: UI, fontSize: 10.5, color: AMBER, marginTop: 2 }}>
                    escalated to {roster.find((p) => p.id === i.escalatedTo)?.name ?? i.escalatedTo}
                  </div>
                )}
                {i.linkedResult && (
                  <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                    linked to result at {pollingUnits.find((p) => p.id === results.find((r) => r.id === i.linkedResult)?.pollingUnit)?.code ?? i.linkedResult}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {i.severity && <span style={chip(SEVERITY_COLOR[i.severity] ?? MUTED)}>{i.severity}</span>}
                <span style={chip((i.status === INCIDENT_STATUS.RESOLVED || i.status === INCIDENT_STATUS.CLOSED) ? TEAL
                  : (i.status === INCIDENT_STATUS.REPORTED || i.status === INCIDENT_STATUS.ESCALATED) ? PINK : AMBER)}>{i.status}</span>
              </div>
            </Row>
          ))}
        </Panel>
        {incidents.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title="Update incident status" operation={ELECTION_DAY_OPERATION.CHANGE_INCIDENT_STATUS}
              prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER} extraArgs={{ roster }}
              fields={[
                { id: "incidentId", label: "Incident", type: "select", options: incidents.map((i) => ({ value: i.id, label: i.category?.replace(/_/g, " ") })) },
                { id: "status", label: "Status", type: "select", options: Object.values(INCIDENT_STATUS).map((s) => ({ value: s, label: s })) },
                { id: "escalatedTo", label: "Escalate to (only used when status is ESCALATED)", type: "select",
                  options: roster.length
                    ? [{ value: "", label: "Not specified" }, ...roster.map((p) => ({ value: p.id, label: `${p.name} (${p.roleType?.replace(/_/g, " ")})` }))]
                    : [{ value: "", label: "No people recorded yet — see Mobilize" }] },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <StructuredWritePanel
          title="Report incident" operation={ELECTION_DAY_OPERATION.REPORT_INCIDENT}
          prepareFn={prepareElectionDayWrite} approveFn={approveElectionDayWrite}
          campaignId={campaignId} refresh={refresh} accent={PINK} extraArgs={{ knownResultIds }}
          fields={[
            { id: "category", label: "Category", type: "select", options: INCIDENT_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, " ") })) },
            { id: "description", label: "Description", placeholder: "What happened?" },
            { id: "severity", label: "Severity (optional — an honest judgment call, not computed)", type: "select",
              options: [{ value: "", label: "Not graded" }, ...Object.values(INCIDENT_SEVERITY).map((s) => ({ value: s, label: s }))] },
            { id: "location", label: "Location (optional)" },
            { id: "pollingUnitId", label: "Polling unit (optional)", type: "select",
              options: [{ value: "", label: "Not specified" }, ...pollingUnits.map((p) => ({ value: p.id, label: p.code }))] },
            { id: "linkedResult", label: "Linked result (optional — e.g. for a result-sheet dispute)", type: "select",
              options: results.length
                ? [{ value: "", label: "Not specified" }, ...results.map((r) => ({ value: r.id, label: pollingUnits.find((p) => p.id === r.pollingUnit)?.code ?? r.id }))]
                : [{ value: "", label: "No results captured yet" }] },
          ]}
        />
      </div>
    </div>
  );
}

export default function ElectionDaySection({ ctx, campaignId, userId, refresh }) {
  const [tab, setTab] = useState("coverage");
  return (
    <div>
      <SubNav tab={tab} setTab={setTab} />
      {tab === "coverage" && <CoverageTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "agents" && <AgentsTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "results" && <ResultsTab ctx={ctx} campaignId={campaignId} userId={userId} refresh={refresh} />}
      {tab === "incidents" && <IncidentsTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
    </div>
  );
}
