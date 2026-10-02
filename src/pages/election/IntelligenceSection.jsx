// ============================================================
// ELECTIONCANON — INTELLIGENCE  (Alpha 1.0)
//
// Real operational intelligence, computed from the SAME folded Canon view
// every other section reads — no new tables, no fabricated charts. "Ask
// ElectionCanon" now runs the real, previously-unwired conversational
// engine (src/domains/election/studio/{intent,vocabulary,respond,infer}.js)
// through the SAME shared askForge() pipeline manufacturing/Business use —
// see test/election.consumer.mjs's own "domain plurality" proof. English
// only, honestly: any other requested language falls back to English and
// says so (planElectionResponse's own `fellBack` flag), never a fabricated
// translation.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { readElectionLog } from "../../os/electionWebAdapter.js";
import { TASK_STATUS } from "../../domains/election/mobilization/write.js";
import { INCIDENT_STATUS, VERIFICATION_STATUS } from "../../domains/election/electionDay/write.js";
import { ELECTION_EVENT_TYPES } from "../../domains/election/events.js";
import { resolveEffectiveScope } from "../../domains/election/responsibility.js";
import { getScopeGeographyName } from "../../domains/election/geography/read.js";
import { computeAttention } from "./attention.js";
import { Label, Panel, WriteActionPanel, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER } from "./shared.jsx";
import { scopeElectionDayView } from "./ElectionDaySection.jsx";
// UX REDESIGN SLICE 5 — AskPanel moved to AskAssistant.jsx so contextual
// entry points on other pages can reuse the SAME implementation. This file
// imports it back rather than keeping a second copy — one Ask engine, one
// UI for it, two mount points (this tab, and every ContextualAsk trigger).
import { AskPanel } from "./AskAssistant.jsx";
import { useTranslation } from "./useTranslation.js";

function AlertRow({ text, tone = AMBER }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone, marginTop: 6, flexShrink: 0 }} />
      <span style={{ fontFamily: UI, fontSize: 12.5, color: IVORY }}>{text}</span>
    </div>
  );
}

const TONE_COLOR = { danger: PINK, warning: AMBER };

// ROLE_SCOPE_03 — the two feed-entry types ROLE_SCOPE_02 actually
// demonstrated leaking to a scoped LGA Coordinator via this page's Activity
// Trend: a RESPONSIBILITY.* event naming a geography outside their scope,
// and a MOBILIZATION.PERSON_ADDED event for a field-roster person whose
// current responsibility geography is outside their scope. Every other
// feed entry type (territory set, election-day, free-text ward/task
// activity, etc.) is left visible here — same "only scope what was
// actually shown to leak, don't guess the rest" boundary applied to Work's
// Wards/Assignments/Tasks tabs (see MobilizeSection.jsx's own comment).
function scopeFeed(feed, log, view, scope) {
  if (!scope || scope.isCampaignWide) return feed;
  const byEventId = new Map((log ?? []).map((e) => [e.eventId, e]));
  const geoForPerson = new Map(Object.values(view?.responsibilities ?? {}).map((r) => [r.person, r.geographyRef]));
  const RESP = ELECTION_EVENT_TYPES.RESPONSIBILITY;
  return feed.filter((entry) => {
    const raw = byEventId.get(entry.eventId);
    if (!raw) return true; // no raw event to check against — never hide on a lookup miss
    if (entry.type === RESP.ASSIGNED || entry.type === RESP.STATUS_CHANGED || entry.type === RESP.REASSIGNED) {
      const geo = raw.geographyRef;
      return geo ? scope.scopeGeographyRefs?.has(geo) : true;
    }
    if (entry.type === ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED) {
      const geo = geoForPerson.get(raw.person);
      return geo ? scope.scopeGeographyRefs?.has(geo) : false; // unassigned roster person: same as Work's PeopleTab
    }
    return true;
  });
}

export default function IntelligenceSection({ ctx, campaignId, userId, refresh, onSection }) {
  const { t } = useTranslation();
  const [log, setLog] = useState([]);
  const [scope, setScope] = useState(null);
  const [scopeName, setScopeName] = useState(null);
  const [scopeLevel, setScopeLevel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    readElectionLog({ client: supabase, requestedCampaign: campaignId }).then((r) => {
      if (!cancelled) setLog(r.log ?? []);
    });
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) { setScope(null); setScopeName(null); setScopeLevel(null); return undefined; }
    (async () => {
      const s = await resolveEffectiveScope({ client: supabase, view: ctx.view, campaignId, userId });
      if (cancelled) return;
      setScope(s);
      if (s.isCampaignWide || (s.scopeLevel !== "lga" && s.scopeLevel !== "ward")) { setScopeName(null); setScopeLevel(null); return; }
      const { data: name } = await getScopeGeographyName({ client: supabase, level: s.scopeLevel, geographyRef: s.scopeGeographyRef });
      if (!cancelled) { setScopeName(name); setScopeLevel(s.scopeLevel); }
    })();
    return () => { cancelled = true; };
  }, [ctx.view, campaignId, userId]);

  const baseView = ctx.view ?? {};
  const view = scopeElectionDayView(baseView, scopeName, scopeLevel);
  const attention = computeAttention(view, ctx.readiness?.gaps);
  const { alerts, counts } = attention;
  const tasks = Object.values(view.tasks ?? {});
  const wards = Object.values(view.wards ?? {});
  const results = Object.values(view.results ?? {});
  const pollingUnits = Object.values(view.pollingUnits ?? {});
  const agents = Object.values(view.agents ?? {});
  const incidents = Object.values(view.incidents ?? {});
  const feed = scopeFeed(baseView.feed ?? [], log, baseView, scope);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>{t("nav.intelligence")}</Label>
        <AskPanel view={view} log={log} onSection={onSection} />
      </div>

      <div>
        <Label>{t("ask.alerts")}</Label>
        <Panel>
          {alerts.length === 0
            ? <div style={{ fontFamily: UI, fontSize: 12.5, color: TEAL }}>{t("ask.noOpenAlerts")}</div>
            : alerts.slice(0, 12).map((a, i) => <AlertRow key={i} text={a.text} tone={TONE_COLOR[a.tone] ?? AMBER} />)}
        </Panel>
      </div>

      <div>
        <Label>{t("ask.coverageGaps")}</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.9 }}>
            {counts.wardsWithoutCoordinator} ward{counts.wardsWithoutCoordinator === 1 ? "" : "s"} with no coordinator<br />
            {counts.pollingUnitsWithoutAgent} polling unit{counts.pollingUnitsWithoutAgent === 1 ? "" : "s"} with no agent<br />
            {counts.tasksOverdue} task{counts.tasksOverdue === 1 ? "" : "s"} overdue<br />
            {counts.evidenceAwaitingReview} evidence photo{counts.evidenceAwaitingReview === 1 ? "" : "s"} awaiting human review<br />
            {counts.lowConfidenceOcr} result{counts.lowConfidenceOcr === 1 ? "" : "s"} with low-confidence OCR fields<br />
            {counts.unresolvedHighSeverityIncidents} unresolved high/critical incident{counts.unresolvedHighSeverityIncidents === 1 ? "" : "s"}
          </div>
        </Panel>
      </div>

      <div>
        <Label>{t("ask.wardCoverage")}</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
            {wards.length} ward{wards.length === 1 ? "" : "s"} known · {wards.filter((w) => w.organisation).length} with a coordinator/team
          </div>
        </Panel>
      </div>

      <div>
        <Label>{t("ask.taskBottlenecks")}</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
            {tasks.filter((t) => t.status === TASK_STATUS.BLOCKED).length} blocked ·{" "}
            {tasks.filter((t) => t.status !== TASK_STATUS.COMPLETE).length} open of {tasks.length} total
          </div>
        </Panel>
      </div>

      <div>
        <Label>{t("ask.electionDaySimStats")}</Label>
        <Panel accent={AMBER}>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
            {pollingUnits.length} polling unit{pollingUnits.length === 1 ? "" : "s"} · {agents.length} agent{agents.length === 1 ? "" : "s"} assigned<br />
            {results.filter((r) => r.verificationStatus === VERIFICATION_STATUS.VERIFIED).length} results verified of {results.length} captured<br />
            {incidents.filter((i) => i.status !== INCIDENT_STATUS.RESOLVED && i.status !== INCIDENT_STATUS.CLOSED).length} open incident{incidents.length === 1 ? "" : "s"}
          </div>
        </Panel>
      </div>

      <div>
        <Label>{t("ask.activityTrend")}</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>{feed.length} recorded event{feed.length === 1 ? "" : "s"} in this workspace</div>
          <div style={{ marginTop: 8 }}>
            {feed.slice(0, 5).map((e, i) => (
              <div key={i} style={{ fontFamily: UI, fontSize: 11, color: MUTED, padding: "4px 0" }}>{e.detail ?? e.type}</div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <WriteActionPanel campaignId={campaignId} refresh={refresh} />
      </div>
    </div>
  );
}
