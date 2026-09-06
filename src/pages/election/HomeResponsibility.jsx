// ============================================================
// ELECTIONCANON 1.1 — HOME OPERATING CONSOLE: RESPONSIBILITY
//
// The Coverage Card, the Coverage Gaps/roster drill-down, and the Change
// Responsibility (reassignment) flow. Every read here is coverage.js
// composed against the campaign's own already-resolved territory (see
// HomeSection.jsx's own fetch of getConstituencyTerritory/getStateTerritory
// + getUncoveredTerritory) — no second coverage calculation. Every write
// goes through the EXISTING geography write path — prepareGeographyWrite/
// approveGeographyWrite -> write_responsibility() — exactly as Organisation
// already uses for territory/first-assignment; this is that same mechanism's
// first real UI caller for REASSIGN_RESPONSIBILITY. No new table, no new
// event type, no second write path.
//
// CONSTITUENCY-LEVEL COVERAGE (Home Operating Console design gate,
// decision 2): the campaign owner is the implicit constituency-level
// responsible party once territory is set — this is a PRESENTATION rule
// for this page only. No responsibility_slots row is created for it, no
// Canon event is fabricated, and no invite action is offered for it — the
// existing InviteWizard role picker is untouched. Operational gaps below
// are therefore LGA/ward only.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { prepareGeographyWrite, approveGeographyWrite, GEOGRAPHY_OPERATION } from "../../os/electionWebAdapter.js";
import { getReassignmentCandidates } from "./OrganisationSection.jsx";
import { Label, Panel, linkBtn, friendlyError, UI, IVORY, MUTED, TEAL, AMBER, PINK, BLACK, BORDER, inputStyle } from "./shared.jsx";

const ROLE_LABEL = Object.freeze({ lga: "LGA Coordinator", ward: "Ward Coordinator", polling_unit: "Polling-Unit Agent" });
const LEVEL_LABEL = Object.freeze({ lga: "LGA", ward: "Ward", polling_unit: "Polling Unit" });

/** Constituency/LGA/ward covered counts — the exact numbers
 *  getUncoveredTerritory() already computed, nothing derived twice. */
export function CoverageCard({ coverage, onOpenGaps }) {
  if (!coverage.established) {
    return (
      <div>
        <Label>Coverage</Label>
        <Panel accent={PINK}>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.6 }}>
            Set your Territory before ElectionCanon can show coverage.
          </div>
        </Panel>
      </div>
    );
  }
  const lgaTotal = coverage.lgas.length;
  const lgaCovered = coverage.lgas.filter((l) => l.covered).length;
  const wardTotal = coverage.totalWards;
  const wardCovered = coverage.coveredWards;
  const anyGap = lgaCovered < lgaTotal || wardCovered < wardTotal;

  return (
    <div>
      <Label>Coverage</Label>
      <Panel accent={anyGap ? AMBER : TEAL}>
        <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 2 }}>
          Constituency: <span style={{ color: TEAL }}>covered by the campaign owner</span><br />
          LGAs: <span style={{ color: lgaCovered === lgaTotal && lgaTotal > 0 ? TEAL : IVORY }}>{lgaCovered} / {lgaTotal} covered</span><br />
          Wards: <span style={{ color: wardCovered === wardTotal && wardTotal > 0 ? TEAL : IVORY }}>{wardCovered} / {wardTotal} covered</span>
        </div>
        {onOpenGaps && <button onClick={onOpenGaps} style={{ ...linkBtn(), marginTop: 12 }}>{anyGap ? "View Gaps" : "View Territory"} →</button>}
      </Panel>
    </div>
  );
}

const rowWrap = { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${BORDER}` };
const smallBtn = (color) => ({ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "8px 14px", border: "none", background: color, color: BLACK, cursor: "pointer", whiteSpace: "nowrap" });

/** Every known LGA and ward — a covered row offers Change Responsibility,
 *  an uncovered row offers Invite. One list, not a separate "gaps" table
 *  and a separate "roster" table, since both answer the same underlying
 *  question ("who is responsible for this territory, if anyone") — see the
 *  Data Architecture Rule this design gate imposed. Flex rows, not a wide
 *  table — mobile-first per the task's own UX rule. */
export function CoverageGapsPanel({ coverage, lgaNameById, parentName, onInvite, onReassign }) {
  const rows = [
    ...coverage.lgas.map((l) => ({ id: l.id, name: l.name, level: "lga", parent: parentName, lgaId: null, covered: l.covered, currentPerson: l.currentPerson })),
    ...coverage.wards.map((w) => ({ id: w.id, name: w.name, level: "ward", parent: lgaNameById.get(w.lgaId) ?? "—", lgaId: w.lgaId ?? null, covered: w.covered, currentPerson: w.currentPerson })),
  ];

  if (rows.length === 0) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No LGAs or wards known for this campaign's territory yet.</div></Panel>;
  }

  return (
    <Panel>
      {rows.map((r) => (
        <div key={`${r.level}-${r.id}`} style={rowWrap}>
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{r.name} <span style={{ color: MUTED, fontWeight: 400 }}>({LEVEL_LABEL[r.level]})</span></div>
            <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>{r.parent}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
              color: r.covered ? TEAL : PINK, border: `1px solid ${r.covered ? TEAL : PINK}`, padding: "3px 8px" }}>
              {r.covered ? "Covered" : "Not covered"}
            </span>
            {r.covered ? (
              <button onClick={() => onReassign({ level: r.level, geographyRef: r.id, geographyName: r.name, currentPersonRef: r.currentPerson })} style={smallBtn(AMBER)}>
                Change Responsibility
              </button>
            ) : (
              <button onClick={() => onInvite({ level: r.level, geographyRef: r.id,
                role: r.level === "lga" ? "LGA_COORDINATOR" : "WARD_COORDINATOR", lgaId: r.lgaId })}
                style={smallBtn(TEAL)}>
                Invite
              </button>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}

/** Current-holder-shown, required-reason, explicit-confirmation reassignment
 *  flow — the ONLY UI path onto write_responsibility()'s REASSIGNED branch.
 *  The candidate pool is active ElectionCanon campaign members
 *  (getReassignmentCandidates(), campaign_members-derived), never Mobilize's
 *  separate field roster — see that function's own header. `expectedCurrentPerson`
 *  is the real compare-and-swap guard the server already enforces; this UI
 *  supplies it, it does not invent a new one. */
export function ReassignResponsibilityPanel({ campaignId, userId, view, level, geographyRef, geographyName, currentPersonRef, geographyTree, refresh, onClose }) {
  const [allMembers, setAllMembers] = useState(null); // null = loading
  const [newPersonId, setNewPersonId] = useState("");
  const [reason, setReason] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetched WITHOUT excludePersonRef so the current holder's own real
      // name is available for "Current: ..." — the currently-assigned
      // person is still excluded from the SELECTABLE list below, per the
      // design gate's "exclude the currently assigned person" rule.
      const { data } = await getReassignmentCandidates({ client: supabase, campaignId, userId, view, excludePersonRef: null });
      if (!cancelled) setAllMembers(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [campaignId, currentPersonRef]); // eslint-disable-line

  const currentPersonName = allMembers?.find((c) => c.id === currentPersonRef)?.name ?? (currentPersonRef ? "Campaign member" : "Vacant");
  const candidates = (allMembers ?? []).filter((c) => c.id !== currentPersonRef);
  const roleLabel = ROLE_LABEL[level];
  const newPersonName = candidates.find((c) => c.id === newPersonId)?.name ?? null;

  const doPrepare = async () => {
    if (!newPersonId || !reason.trim()) { setError("Choose a new responsible person and give a reason."); return; }
    setBusy(true); setError(null);
    const result = await prepareGeographyWrite({
      client: supabase, requestedCampaign: campaignId, operation: GEOGRAPHY_OPERATION.REASSIGN_RESPONSIBILITY,
      fields: { level, geographyRef, newPersonId, expectedCurrentPerson: currentPersonRef, reason: reason.trim() },
      roster: candidates, geographyTree,
    });
    setBusy(false);
    if (result.status !== "PREPARED") { setError(result.reason ?? `could not prepare this change: ${result.status}`); return; }
    setPrepared({ draft: result.draft, confirmationId: crypto.randomUUID() });
  };

  const doApprove = async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveGeographyWrite({
      client: supabase, requestedCampaign: campaignId, operation: GEOGRAPHY_OPERATION.REASSIGN_RESPONSIBILITY,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "could not record this change"); return; }
    setPrepared(null); setNewPersonId(""); setReason("");
    await refresh();
    onClose();
  };

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: AMBER, marginBottom: 10 }}>
        Change Responsibility — {geographyName} ({LEVEL_LABEL[level]})
      </div>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, marginBottom: 16 }}>
        Current {roleLabel}: <span style={{ color: IVORY }}>{allMembers === null ? "Loading…" : currentPersonName}</span>
      </div>

      {!prepared ? (
        <>
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>New responsible person</div>
          <select value={newPersonId} onChange={(e) => setNewPersonId(e.target.value)} aria-label="New responsible person" disabled={allMembers === null} style={inputStyle}>
            <option value="">{allMembers === null ? "Loading…" : "Select a person…"}</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {allMembers !== null && candidates.length === 0 && (
            <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 9 }}>No other active campaign members are available yet — invite someone under Organisation first.</div>
          )}
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, marginTop: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Reason</div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Relocated, stepped back, better fit for this ward"
            aria-label="Reason" style={inputStyle} />
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button onClick={doPrepare} disabled={busy || !newPersonId || !reason.trim()}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy || !newPersonId || !reason.trim() ? BORDER : AMBER, color: BLACK,
                cursor: busy || !newPersonId || !reason.trim() ? "not-allowed" : "pointer" }}>
              {busy ? "Preparing…" : "Prepare"}
            </button>
            <button onClick={onClose} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px",
                cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL, marginBottom: 8 }}>Confirm</div>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.7, marginBottom: 16 }}>
            This will reassign {roleLabel} for <strong>{geographyName}</strong> from <strong>{currentPersonName}</strong> to <strong>{newPersonName}</strong>.
            This will be recorded in the campaign Canon.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={doApprove} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy ? BORDER : AMBER, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
              {busy ? "Recording…" : "Confirm Change"}
            </button>
            <button onClick={() => setPrepared(null)} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px",
                cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Back</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

// ============================================================
// GATE A — SCOPED VIEWS (LGA/Ward Coordinator)
//
// The row/action pattern below deliberately mirrors CoverageGapsPanel's own
// (name, parent, covered/not-covered chip, Invite/Change-Responsibility
// action) — reused visually, not re-imported, because CoverageGapsPanel's
// own rows are always CAMPAIGN-WIDE (every LGA and ward in the territory);
// these two components render a caller-supplied, ALREADY-SCOPED list only
// (an LGA Coordinator's own ~12 wards, or a Ward Coordinator's own PUs) —
// the scoping itself happens in HomeSection.jsx (which LGA/ward ids to ask
// for), never here. No new coverage calculation: both take the exact
// {id, name, covered, currentPerson} shape getWardCoverage()/
// getPollingUnitCoverage() already return.
// ============================================================

/** An LGA Coordinator's own wards — name, coordinator, PU count (from the
 *  caller-supplied count-only pollingUnitCounts map), covered/uncovered,
 *  and the SAME Invite/Change-Responsibility actions CoverageGapsPanel
 *  already offers, wired to the SAME handlers (write-path authorization is
 *  unchanged — write_responsibility() already refuses a ward outside the
 *  caller's own LGA regardless of what this UI shows). */
export function ScopedWardsPanel({ wards, pollingUnitCounts = {}, onInvite, onReassign }) {
  if (wards.length === 0) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No wards recorded yet for this LGA — see supabase/geography-import for import status.</div></Panel>;
  }
  return (
    <Panel>
      {wards.map((w) => (
        <div key={w.id} style={rowWrap}>
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{w.name}</div>
            <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
              {pollingUnitCounts[w.id] ?? 0} polling unit{(pollingUnitCounts[w.id] ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
              color: w.covered ? TEAL : PINK, border: `1px solid ${w.covered ? TEAL : PINK}`, padding: "3px 8px" }}>
              {w.covered ? "Covered" : "Not covered"}
            </span>
            {w.covered ? (
              <button onClick={() => onReassign({ level: "ward", geographyRef: w.id, geographyName: w.name, currentPersonRef: w.currentPerson })} style={smallBtn(AMBER)}>
                Change Responsibility
              </button>
            ) : (
              <button onClick={() => onInvite({ level: "ward", geographyRef: w.id, role: "WARD_COORDINATOR", lgaId: w.lgaId ?? null })} style={smallBtn(TEAL)}>
                Invite
              </button>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}

/** A Ward Coordinator's own polling units — code/name, agent status,
 *  covered/uncovered, same action pattern as ScopedWardsPanel. */
export function ScopedPollingUnitsPanel({ pollingUnits, onInvite, onReassign }) {
  if (pollingUnits.length === 0) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No polling units imported yet for this ward.</div></Panel>;
  }
  return (
    <Panel>
      {pollingUnits.map((p) => (
        <div key={p.id} style={rowWrap}>
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{p.code}{p.name ? ` — ${p.name}` : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
              color: p.covered ? TEAL : PINK, border: `1px solid ${p.covered ? TEAL : PINK}`, padding: "3px 8px" }}>
              {p.covered ? "Agent assigned" : "No agent"}
            </span>
            {p.covered ? (
              <button onClick={() => onReassign({ level: "polling_unit", geographyRef: p.id, geographyName: p.code, currentPersonRef: p.currentPerson })} style={smallBtn(AMBER)}>
                Change Responsibility
              </button>
            ) : (
              <button onClick={() => onInvite({ level: "polling_unit", geographyRef: p.id, role: "POLLING_UNIT_AGENT", lgaId: null })} style={smallBtn(TEAL)}>
                Invite
              </button>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}

export default { CoverageCard, CoverageGapsPanel, ReassignResponsibilityPanel, ScopedWardsPanel, ScopedPollingUnitsPanel };
