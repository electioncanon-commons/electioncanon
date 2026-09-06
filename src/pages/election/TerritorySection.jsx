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
import { listOffices, listStates, listConstituencies, listWardsForLga, listPollingUnitsForWard, getPollingUnitCountsByWard } from "../../domains/election/geography/read.js";
import { getWardCoverage, getPollingUnitCoverage } from "../../domains/election/geography/coverage.js";
import { prepareGeographyWrite, approveGeographyWrite, GEOGRAPHY_OPERATION } from "../../os/electionWebAdapter.js";
import { resolveMyResponsibility, isScopedResponsibility } from "../../domains/election/responsibility.js";
import { Label, Panel, friendlyError, UI, IVORY, TEAL, AMBER, PINK, MUTED, BORDER, BLACK, inputStyle } from "./shared.jsx";
import TerritoryExplorer from "./TerritoryExplorer.jsx";

const GEOGRAPHY_LOOKUP = Object.freeze({
  lga: { table: "geography_lgas", select: "id, name" },
  ward: { table: "geography_wards", select: "id, name" },
  polling_unit: { table: "geography_polling_units", select: "id, name, code" },
});

/** GATE A — an LGA Coordinator's/Ward Coordinator's/Polling-Unit Agent's
 *  OWN, READ-ONLY territory — never the owner-style TerritoryWizard/
 *  TerritoryExplorer (which stay completely untouched below, unreachable
 *  from this branch). Every read here is one of the SAME bounded,
 *  already-existing geography/coverage functions Home's scoped panels and
 *  Organisation's InviteWizard already use — no new geography source, no
 *  national/constituency-wide fetch. "My Scope" is passed in already
 *  resolved (from the canonical Canon, never a URL/query param) — this
 *  component only decides HOW to fetch and render it. */
function ScopedTerritory({ responsibility, campaignId }) {
  const { responsibilityRole, geographyRef } = responsibility;
  const [geographyName, setGeographyName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wards, setWards] = useState([]);
  const [wardPuCounts, setWardPuCounts] = useState({});
  const [pollingUnits, setPollingUnits] = useState([]);
  const [expandedWard, setExpandedWard] = useState(null);
  const [pollingUnitsByWard, setPollingUnitsByWard] = useState({});
  const [pollingUnitsLoading, setPollingUnitsLoading] = useState(null);
  const [selfPollingUnit, setSelfPollingUnit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const lookup = GEOGRAPHY_LOOKUP[responsibilityRole === "LGA_COORDINATOR" ? "lga" : responsibilityRole === "WARD_COORDINATOR" ? "ward" : "polling_unit"];
      const { data: nameRow } = await supabase.from(lookup.table).select(lookup.select).eq("id", geographyRef).maybeSingle();
      if (cancelled) return;
      setGeographyName(nameRow?.name ?? nameRow?.code ?? null);

      if (responsibilityRole === "LGA_COORDINATOR") {
        const { data: wardRows } = await listWardsForLga({ client: supabase, lgaId: geographyRef });
        if (cancelled) return;
        const wardList = wardRows ?? [];
        const [{ data: covered }, { data: puCounts }] = await Promise.all([
          getWardCoverage({ client: supabase, campaignId, wards: wardList }),
          getPollingUnitCountsByWard({ client: supabase, wardIds: wardList.map((w) => w.id) }),
        ]);
        if (cancelled) return;
        setWards(covered ?? []);
        setWardPuCounts(puCounts ?? {});
      } else if (responsibilityRole === "WARD_COORDINATOR") {
        const { data: puRows } = await listPollingUnitsForWard({ client: supabase, wardId: geographyRef });
        if (cancelled) return;
        const { data: covered } = await getPollingUnitCoverage({ client: supabase, campaignId, pollingUnits: puRows ?? [] });
        if (!cancelled) setPollingUnits(covered ?? []);
      } else if (responsibilityRole === "POLLING_UNIT_AGENT") {
        if (!cancelled) setSelfPollingUnit(nameRow ?? null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [responsibilityRole, geographyRef, campaignId]);

  const toggleWard = async (wardId) => {
    if (expandedWard === wardId) { setExpandedWard(null); return; }
    setExpandedWard(wardId);
    if (pollingUnitsByWard[wardId] !== undefined) return;
    setPollingUnitsLoading(wardId);
    const { data } = await listPollingUnitsForWard({ client: supabase, wardId });
    setPollingUnitsByWard((prev) => ({ ...prev, [wardId]: data ?? [] }));
    setPollingUnitsLoading(null);
  };

  const levelLabel = { LGA_COORDINATOR: "LGA", WARD_COORDINATOR: "Ward", POLLING_UNIT_AGENT: "Polling Unit" }[responsibilityRole];

  if (loading) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Resolving your territory…</div></Panel>;
  }

  // PART 8 — HARDENING: a geography reference that no longer resolves (the
  // LGA/ward/PU row itself was removed or never existed) is an honest
  // empty state, never a crash and never a silently fabricated name.
  if (!geographyName && responsibilityRole !== "POLLING_UNIT_AGENT") {
    return (
      <Panel accent={PINK}>
        <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.6 }}>
          Your assigned {levelLabel.toLowerCase()} could not be found in ElectionCanon's geography data.
          Contact your campaign owner.
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <Label>Your assigned territory</Label>
      <Panel accent={TEAL}>
        <div style={{ fontFamily: UI, fontWeight: 800, fontSize: 16, color: IVORY, marginBottom: 4 }}>
          {geographyName ?? "Your polling unit"}
        </div>
        <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED }}>
          {levelLabel} · read-only — your campaign owner configures election, office, state and constituency
        </div>
      </Panel>

      {responsibilityRole === "LGA_COORDINATOR" && (
        <div style={{ marginTop: 18 }}>
          <Label>Wards ({wards.length})</Label>
          {wards.length === 0 ? (
            <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No wards imported yet for this LGA.</div></Panel>
          ) : (
            <Panel>
              {wards.map((w) => {
                const expanded = expandedWard === w.id;
                const pus = pollingUnitsByWard[w.id];
                return (
                  <div key={w.id} style={{ borderBottom: `1px solid ${BORDER}`, padding: "12px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }}
                      onClick={() => toggleWard(w.id)}>
                      <div>
                        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 13, color: IVORY }}>{expanded ? "▾" : "▸"} {w.name}</div>
                        <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                          {wardPuCounts[w.id] ?? 0} polling unit{(wardPuCounts[w.id] ?? 0) === 1 ? "" : "s"}
                        </div>
                      </div>
                      <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
                        color: w.covered ? TEAL : PINK, border: `1px solid ${w.covered ? TEAL : PINK}`, padding: "3px 8px" }}>
                        {w.covered ? "Covered" : "Not covered"}
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ marginLeft: 20, marginTop: 10 }}>
                        {pollingUnitsLoading === w.id ? (
                          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>Loading polling units…</div>
                        ) : !pus || pus.length === 0 ? (
                          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>No polling units imported yet for this ward.</div>
                        ) : (
                          pus.map((pu) => (
                            <div key={pu.id} style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 4 }}>
                              {pu.code}{pu.name ? ` — ${pu.name}` : ""}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Panel>
          )}
        </div>
      )}

      {responsibilityRole === "WARD_COORDINATOR" && (
        <div style={{ marginTop: 18 }}>
          <Label>Polling units ({pollingUnits.length})</Label>
          {pollingUnits.length === 0 ? (
            <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No polling units imported yet for this ward.</div></Panel>
          ) : (
            <Panel>
              {pollingUnits.map((pu) => (
                <div key={pu.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{pu.code}{pu.name ? ` — ${pu.name}` : ""}</div>
                  <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: pu.covered ? TEAL : PINK, border: `1px solid ${pu.covered ? TEAL : PINK}`, padding: "3px 8px" }}>
                    {pu.covered ? "Agent assigned" : "No agent"}
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

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
  // GATE A — self-fetched, matching HomeSection.jsx's/OrganisationSection
  // .jsx's own identical pattern, rather than threading a new prop through
  // Election.jsx.
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!cancelled) setUserId(user?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  const view = ctx.view ?? {};
  const myResponsibility = resolveMyResponsibility({ view, campaignId, userId });
  const isScoped = isScopedResponsibility(myResponsibility);

  useEffect(() => {
    let cancelled = false;
    // GATE A — a scoped coordinator's view (ScopedTerritory, below) needs
    // neither the office nor the state reference list at all — skip this
    // fetch for them entirely rather than making them wait on a read they
    // will never use.
    if (isScoped) { setLoading(false); return undefined; }
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
  }, [isScoped]);

  const territory = ctx.view?.territory ?? null;

  // GATE A — an LGA/Ward/Polling-Unit Coordinator NEVER reaches
  // TerritoryWizard or TerritoryExplorer below, regardless of whether the
  // campaign's own territory is set — they get their own, read-only,
  // already-scoped view instead. Owner/Manager/Constituency Lead (isScoped
  // === false) fall through to the EXISTING, byte-unchanged behavior.
  if (isScoped) {
    return <ScopedTerritory responsibility={myResponsibility} campaignId={campaignId} />;
  }

  if (loading) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Loading territory…</div></Panel>;
  }

  return territory
    ? <TerritoryExplorer ctx={ctx} campaignId={campaignId} refresh={refresh} territory={territory} offices={offices} states={states} onSection={onSection} />
    : <TerritoryWizard campaignId={campaignId} refresh={refresh} offices={offices} states={states} />;
}
