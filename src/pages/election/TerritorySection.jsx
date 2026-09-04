// ============================================================
// ELECTION FORGE — TERRITORY  (Electoral Geography)
//
// TERRITORY.SET requires a campaign_id, so — unlike the free-text
// WelcomeOnboarding signup wizard in Election.jsx — this lives in its own
// post-activation tab (see shared.jsx's SECTIONS). Renders TerritoryWizard
// (Election → Office → State → Constituency, cascading, hence bespoke
// rather than StructuredWritePanel — see geography/write.js's own header)
// until a territory is set, then TerritoryExplorer.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase.js";
import { listOffices, listStates, listConstituencies } from "../../domains/election/geography/read.js";
import { prepareGeographyWrite, approveGeographyWrite, GEOGRAPHY_OPERATION } from "../../os/electionWebAdapter.js";
import { Label, Panel, friendlyError, UI, IVORY, TEAL, AMBER, PINK, MUTED, BORDER, BLACK, inputStyle } from "./shared.jsx";
import TerritoryExplorer from "./TerritoryExplorer.jsx";

function TerritoryWizard({ campaignId, refresh, offices, states }) {
  const [election, setElection] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [constituencyId, setConstituencyId] = useState("");
  const [constituencies, setConstituencies] = useState([]);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const office = offices.find((o) => o.id === officeId) ?? null;
  const needsConstituency = Boolean(office) && office.boundary_level !== "national" && office.boundary_level !== "state";

  useEffect(() => {
    let cancelled = false;
    setConstituencyId("");
    if (!officeId || !stateCode || !needsConstituency) { setConstituencies([]); return undefined; }
    (async () => {
      const { data } = await listConstituencies({ client: supabase, officeId, stateCode });
      if (!cancelled) setConstituencies(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [officeId, stateCode, needsConstituency]);

  const canPrepare = election.trim() && officeId && stateCode && (!needsConstituency || constituencyId);

  const doPrepare = useCallback(async () => {
    setBusy(true); setError(null);
    const result = await prepareGeographyWrite({
      client: supabase, requestedCampaign: campaignId, operation: GEOGRAPHY_OPERATION.SET_TERRITORY,
      fields: { election: election.trim(), officeId, stateCode, constituencyId: constituencyId || undefined },
      offices, states, constituencies,
    });
    setBusy(false);
    if (result.status !== "PREPARED") { setError(result.reason ?? `could not prepare: ${result.status}`); return; }
    setPrepared({ draft: result.draft, confirmationId: crypto.randomUUID() });
  }, [campaignId, election, officeId, stateCode, constituencyId, offices, states, constituencies]);

  const doApprove = useCallback(async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveGeographyWrite({
      client: supabase, requestedCampaign: campaignId, operation: GEOGRAPHY_OPERATION.SET_TERRITORY,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "approval failed"); return; }
    await refresh();
  }, [campaignId, prepared, refresh]);

  return (
    <div>
      <Label>Set your electoral territory</Label>
      <Panel>
        {!prepared ? (
          <>
            {/* ELECTIONCANON 1.1.1 UX REFINEMENT PASS — copy only; the
                geography architecture and the conditional constituency
                step below (needsConstituency) are unchanged. */}
            <div style={{ fontFamily: UI, fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.6 }}>
              Tell ElectionCanon where this campaign operates. Once your election, office and
              state are set, ElectionCanon reveals your territory — state, LGA, ward and polling unit.
            </div>
            <input value={election} onChange={(e) => setElection(e.target.value)}
              placeholder="e.g. 2027 General Election" aria-label="Election" style={inputStyle} />
            <select value={officeId} onChange={(e) => { setOfficeId(e.target.value); setStateCode(""); }}
              aria-label="Office" style={inputStyle}>
              <option value="">Select an office…</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}
              aria-label="State" style={inputStyle} disabled={!officeId}>
              <option value="">Select a state…</option>
              {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            {needsConstituency && (
              <select value={constituencyId} onChange={(e) => setConstituencyId(e.target.value)}
                aria-label="Constituency" style={inputStyle} disabled={!stateCode}>
                <option value="">
                  {!stateCode ? "Select a state first…"
                    : constituencies.length ? "Select a constituency…"
                    : "No constituencies imported yet for this office and state"}
                </option>
                {constituencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button onClick={doPrepare} disabled={busy || !canPrepare}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy || !canPrepare ? BORDER : TEAL, color: BLACK,
                cursor: busy || !canPrepare ? "not-allowed" : "pointer", marginTop: 4 }}>
              {busy ? "Preparing…" : "Prepare"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
              textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>Proposed action — not yet recorded</div>
            <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, marginBottom: 6 }}>{prepared.draft.summary}</div>
            <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 14 }}>{prepared.draft.notice}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={doApprove} disabled={busy}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                  textTransform: "uppercase", padding: "11px 18px", border: "none",
                  background: busy ? BORDER : TEAL, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Recording…" : "Approve"}
              </button>
              <button onClick={() => setPrepared(null)} disabled={busy}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                  textTransform: "uppercase", padding: "11px 18px", cursor: "pointer",
                  background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>Cancel</button>
            </div>
          </>
        )}
        {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
      </Panel>
    </div>
  );
}

export default function TerritorySection({ ctx, campaignId, refresh, onSection }) {
  const [offices, setOffices] = useState([]);
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [officesResult, statesResult] = await Promise.all([
        listOffices({ client: supabase }), listStates({ client: supabase }),
      ]);
      if (cancelled) return;
      setOffices(officesResult.data ?? []);
      setStates(statesResult.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const territory = ctx.view?.territory ?? null;

  if (loading) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Loading territory…</div></Panel>;
  }

  return territory
    ? <TerritoryExplorer ctx={ctx} campaignId={campaignId} refresh={refresh} territory={territory} offices={offices} states={states} onSection={onSection} />
    : <TerritoryWizard campaignId={campaignId} refresh={refresh} offices={offices} states={states} />;
}
