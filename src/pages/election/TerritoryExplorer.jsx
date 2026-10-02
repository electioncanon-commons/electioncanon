// ============================================================
// ELECTIONCANON — TERRITORY EXPLORER
//
// Constituency -> LGA -> Ward -> Polling Unit drill-down, once a campaign
// has set its territory (TerritorySection.jsx). Reads the real geography_*
// reference tables (geography/read.js's getConstituencyTerritory) and the
// campaign's own `responsibilities`/`people` fold — never a fabricated row.
// Ward/polling-unit levels render an honest "not imported yet" state
// instead of a placeholder, exactly as long as geography_wards/
// geography_polling_units stay empty (see supabase/geography-import/README.md).
// `PercentBar` is a LOCAL equivalent of MobilizeSection.jsx's own
// (unexported) CoverageBar — same visual language, not an import, so this
// file stays additive rather than refactoring that one.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { getConstituencyTerritory, getStateTerritory, listPollingUnitsForWard } from "../../domains/election/geography/read.js";
import { prepareGeographyWrite, approveGeographyWrite, GEOGRAPHY_OPERATION } from "../../os/electionWebAdapter.js";
import { GEOGRAPHY_LEVEL } from "../../domains/election/geography/write.js";
import { deriveTerritoryReadiness } from "../../domains/election/studio/territoryReadiness.js";
import { Label, Panel, StructuredWritePanel, GapRow, UI, IVORY, TEAL, AMBER, PINK, MUTED, BORDER } from "./shared.jsx";
import { ContextualAsk } from "./AskAssistant.jsx";
import { useTranslation } from "./useTranslation.js";

// UX REDESIGN SLICE 5 — real, already-answerable example prompts (see
// IntelligenceSection.jsx's own advertised examples / AskAssistant.jsx).
const PLACES_PROMPTS = Object.freeze(["What is the status of Ward 3?", "Which polling units have no agent?"]);

function PercentBar({ assigned, total, percent, note }) {
  if (percent == null) {
    return <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>{note ?? "not yet established"}</div>;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: BORDER, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, width: `${percent}%`,
          background: percent === 100 ? TEAL : percent === 0 ? PINK : AMBER }} />
      </div>
      <span style={{ fontFamily: UI, fontSize: 10.5, fontWeight: 700, color: MUTED, minWidth: 90, textAlign: "right" }}>
        {assigned}/{total} ({percent}%)
      </span>
    </div>
  );
}

// PRE-LAUNCH UX CLEANUP PASS — this panel assigns responsibility to someone
// ALREADY on the Mobilize roster (a person with no ElectionCanon account of
// their own) — a genuinely different, still-necessary case from
// Organisation's invite flow (which creates a real, logged-in coordinator).
// Both write through the same proposeAssignResponsibility()/Canon event;
// this is one capability with two entry points, not a second model. The
// note below makes that distinction explicit rather than leaving a user to
// guess which path to use.
function AssignPanel({ title, level, geographyRef, roster, geographyTree, campaignId, refresh, accent = TEAL, onSection }) {
  return (
    <div>
      <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        This assigns someone already on your roster, without giving them their own sign-in. To invite
        a coordinator who signs in and manages their own territory,{" "}
        {onSection ? (
          <button type="button" onClick={() => onSection("organisation")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: TEAL, background: "transparent",
              border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
            use Organisation →
          </button>
        ) : "use the Organisation tab."}
      </div>
      <StructuredWritePanel
        title={title} operation={GEOGRAPHY_OPERATION.ASSIGN_RESPONSIBILITY}
        prepareFn={prepareGeographyWrite} approveFn={approveGeographyWrite}
        campaignId={campaignId} refresh={refresh} accent={accent}
        extraArgs={{ roster, geographyTree }}
        fields={[
          { id: "personId", label: "Person", type: "select", options: roster.length
            ? roster.map((p) => ({ value: p.id, label: p.name }))
            : [{ value: "", label: "Add someone under Mobilize first" }] },
          { id: "level", label: "Level", type: "select", options: [{ value: level, label: level.replace(/_/g, " ") }] },
          { id: "geographyRef", label: "Location", type: "select", options: [{ value: geographyRef.value, label: geographyRef.label }] },
        ]}
      />
    </div>
  );
}

export default function TerritoryExplorer({ ctx, campaignId, refresh, territory, offices, states, onSection }) {
  const { t } = useTranslation();
  const office = offices.find((o) => o.id === territory.office) ?? null;
  const state = states.find((s) => s.code === territory.state) ?? null;
  // NATIONAL GEOGRAPHY PASS — a state/national-boundary office (Governor,
  // President) has no constituency at all (proposeSetTerritory() never asks
  // for one — see geography/write.js), so its territory resolves LGAs
  // directly by state via getStateTerritory() instead of refusing outright.
  // Every OTHER declared boundary_level (senatorial_district,
  // federal_constituency, state_constituency) always carries a real
  // territory.constituency, so this is the only other resolvable shape.
  const isStateLevel = office?.boundary_level === "state" || office?.boundary_level === "national";
  const hasResolvableTerritory = Boolean(territory.constituency) || isStateLevel;

  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(hasResolvableTerritory);
  const [expandedLga, setExpandedLga] = useState(null);
  // Ward -> polling units is the LAZY step (see read.js's getConstituencyTerritory
  // header) — a ward's own PUs are fetched only when that ward is expanded,
  // cached here by ward id so re-expanding doesn't re-fetch.
  const [expandedWard, setExpandedWard] = useState(null);
  const [pollingUnitsByWard, setPollingUnitsByWard] = useState({});
  const [pollingUnitsLoading, setPollingUnitsLoading] = useState(null);

  const toggleWard = async (wardId) => {
    if (expandedWard === wardId) { setExpandedWard(null); return; }
    setExpandedWard(wardId);
    if (pollingUnitsByWard[wardId] !== undefined) return;
    setPollingUnitsLoading(wardId);
    const { data } = await listPollingUnitsForWard({ client: supabase, wardId });
    setPollingUnitsByWard((prev) => ({ ...prev, [wardId]: data ?? [] }));
    setPollingUnitsLoading(null);
  };

  useEffect(() => {
    if (!hasResolvableTerritory) { setTree(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = territory.constituency
        ? await getConstituencyTerritory({ client: supabase, constituencyId: territory.constituency })
        : await getStateTerritory({ client: supabase, stateCode: territory.state });
      if (!cancelled) { setTree(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [territory.constituency, territory.state, hasResolvableTerritory]);

  const roster = Object.values(ctx.view?.people ?? {});
  const responsibilities = Object.values(ctx.view?.responsibilities ?? {});
  const personFor = (id) => roster.find((p) => p.id === id)?.name ?? "an unrostered person";
  const responsibilityFor = (level, geographyRef) =>
    responsibilities.find((r) => r.level === level && r.geographyRef === geographyRef) ?? null;

  if (!hasResolvableTerritory) {
    return (
      <div>
        <Label>{office?.name ?? territory.office} · {state?.name ?? territory.state}</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.6 }}>
            ElectionCanon could not resolve a territory to explore for {office?.name ?? "this office"}.
          </div>
        </Panel>
      </div>
    );
  }

  if (loading) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Resolving territory…</div></Panel>;
  }
  if (!tree) {
    return <Panel accent={PINK}><div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
      Could not resolve this territory's geography. Try refreshing.
    </div></Panel>;
  }

  const readiness = deriveTerritoryReadiness({ view: ctx.view, geographyTree: tree });
  const constituencyLead = territory.constituency
    ? responsibilityFor(GEOGRAPHY_LEVEL.CONSTITUENCY, territory.constituency)
    : null;

  return (
    <div>
      <Label>{office?.name ?? territory.office} · {state?.name ?? territory.state}</Label>
      <Panel>
        <div style={{ fontFamily: UI, fontWeight: 800, fontSize: 16, color: IVORY, marginBottom: 4 }}>
          {territory.constituency ? tree.constituency.name : `${state?.name ?? territory.state} (state-wide)`}
        </div>
        <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginBottom: 18 }}>
          {territory.constituency ? (
            <>{territory.election} · {tree.lgas.length} LGA{tree.lgas.length === 1 ? "" : "s"} · Constituency Lead:{" "}
              {constituencyLead ? personFor(constituencyLead.person) : "unassigned"}</>
          ) : (
            <>{territory.election} · {tree.lgas.length} LGA{tree.lgas.length === 1 ? "" : "s"} across {state?.name ?? "this state"} —
              no constituency-level lead for a state-wide office; the campaign owner already leads it.</>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 18 }}>
          <div>
            <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("territory.lgaCoordinatorsHeading")}</div>
            <PercentBar assigned={readiness.lgaCoverage.assigned} total={readiness.lgaCoverage.totalLgas} percent={readiness.lgaCoverage.percent} note={readiness.lgaCoverage.note} />
          </div>
          <div>
            <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("territory.wardCoordinatorsHeading")}</div>
            <PercentBar assigned={readiness.wardCoverage.assigned} total={readiness.wardCoverage.totalWards} percent={readiness.wardCoverage.percent} note={readiness.wardCoverage.note} />
          </div>
          <div>
            <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("electionDay.puAgentsHeading")}</div>
            <PercentBar assigned={readiness.pollingUnitCoverage.assigned} total={readiness.pollingUnitCoverage.totalPollingUnits} percent={readiness.pollingUnitCoverage.percent} note={readiness.pollingUnitCoverage.note} />
          </div>
        </div>
      </Panel>

      <div style={{ marginTop: 14 }}>
        <ContextualAsk triggerLabel="Ask about this coverage" contextLabel="Places"
          suggestedPrompts={PLACES_PROMPTS} view={ctx.view ?? {}} onSection={onSection} />
      </div>

      {territory.constituency && !constituencyLead && (
        <div style={{ marginTop: 18 }}>
          <AssignPanel title={`${t("action.assign")} ${t("role.constituencyLead")}`} level={GEOGRAPHY_LEVEL.CONSTITUENCY}
            geographyRef={{ value: territory.constituency, label: tree.constituency.name }}
            roster={roster} geographyTree={tree} campaignId={campaignId} refresh={refresh} onSection={onSection} />
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Label>{t("territory.lgas")}</Label>
        <Panel>
          {tree.lgas.map((lga) => {
            const resp = responsibilityFor(GEOGRAPHY_LEVEL.LGA, lga.id);
            const expanded = expandedLga === lga.id;
            const wardsForLga = tree.wards.filter((w) => w.lga_id === lga.id);
            return (
              <div key={lga.id} style={{ borderBottom: `1px solid ${BORDER}`, padding: "12px 0" }}>
                {/* UX REDESIGN SLICE 3 (PLACES = COVERAGE) — a real <button>,
                    not a clickable <div>, so expand/collapse (and therefore
                    every row's own next action) is reachable by keyboard,
                    not only by mouse. Same setExpandedLga(...) call, same
                    visual layout — accessibility fix only. */}
                <button type="button" onClick={() => setExpandedLga(expanded ? null : lga.id)}
                  aria-expanded={expanded} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 12, width: "100%", textAlign: "left", background: "none", border: "none", padding: 0,
                    font: "inherit", cursor: "pointer" }}>
                  <div>
                    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 13, color: IVORY }}>{expanded ? "▾" : "▸"} {lga.name}</div>
                    <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                      Coordinator: {resp ? personFor(resp.person) : "unassigned"}
                      {!resp && !expanded && " — tap to assign"}
                    </div>
                  </div>
                  <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: resp ? TEAL : PINK, border: `1px solid ${resp ? TEAL : PINK}`, padding: "3px 8px", flexShrink: 0 }}>
                    {resp ? resp.status : "unassigned"}
                  </span>
                </button>
                {expanded && (
                  <div style={{ marginLeft: 20, marginTop: 10 }}>
                    {!resp && (
                      <div style={{ marginBottom: 14 }}>
                        <AssignPanel title={`Assign ${lga.name} LGA Coordinator`} level={GEOGRAPHY_LEVEL.LGA}
                          geographyRef={{ value: lga.id, label: lga.name }} accent={AMBER}
                          roster={roster} geographyTree={tree} campaignId={campaignId} refresh={refresh} onSection={onSection} />
                      </div>
                    )}
                    {wardsForLga.length === 0 ? (
                      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED }}>
                        Territory data will appear here when the authoritative reference data for {lga.name} is available.
                      </div>
                    ) : (
                      wardsForLga.map((ward) => {
                        const wardExpanded = expandedWard === ward.id;
                        const pusForWard = pollingUnitsByWard[ward.id];
                        return (
                          <div key={ward.id} style={{ marginBottom: 10 }}>
                            <button type="button" onClick={() => toggleWard(ward.id)} aria-expanded={wardExpanded}
                              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                                padding: 0, font: "inherit", fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY, cursor: "pointer" }}>
                              {wardExpanded ? "▾" : "▸"} {ward.name}
                            </button>
                            {wardExpanded && (
                              pollingUnitsLoading === ward.id ? (
                                <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginLeft: 14 }}>Loading polling units…</div>
                              ) : !pusForWard || pusForWard.length === 0 ? (
                                <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginLeft: 14 }}>
                                  No polling units imported yet for this ward.
                                </div>
                              ) : (
                                pusForWard.map((pu) => (
                                  <div key={pu.id} style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginLeft: 14 }}>
                                    {pu.code}{pu.name ? ` — ${pu.name}` : ""}
                                  </div>
                                ))
                              )
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      </div>

      {readiness.gaps.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Label>What isn't covered ({readiness.gaps.length})</Label>
          <Panel accent={PINK}>
            {readiness.gaps.map((g, i) => <GapRow key={i} gap={g} />)}
          </Panel>
        </div>
      )}
    </div>
  );
}
