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

import { useState, useCallback, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { readElectionLog } from "../../os/electionWebAdapter.js";
import { askForge, MODE } from "../../os/studio/ask.js";
import { deterministicAdapter } from "../../domains/election/studio/infer.js";
import { planElectionResponse } from "../../domains/election/studio/respond.js";
import { ELECTION_VOCABULARY } from "../../domains/election/studio/vocabulary.js";
import { TASK_STATUS } from "../../domains/election/mobilization/write.js";
import { INCIDENT_STATUS, VERIFICATION_STATUS } from "../../domains/election/electionDay/write.js";
import { computeAttention } from "./attention.js";
import { capabilityFor, VOICE_STATUS } from "../../os/studio/languageCapability.js";
import { Label, Panel, WriteActionPanel, friendlyError, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

function AlertRow({ text, tone = AMBER }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone, marginTop: 6, flexShrink: 0 }} />
      <span style={{ fontFamily: UI, fontSize: 12.5, color: IVORY }}>{text}</span>
    </div>
  );
}

const TONE_COLOR = { danger: PINK, warning: AMBER };

function AskPanel({ view, log }) {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = useCallback(async () => {
    if (!message.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await askForge({
        message, view, log, preferredLanguage: "en", mode: MODE.ASK,
        adapter: deterministicAdapter, responder: planElectionResponse, vocabulary: ELECTION_VOCABULARY,
      });
      setAnswer(result);
    } catch (e) {
      setError(e?.message ?? "could not process that question");
    }
    setBusy(false);
  }, [message, view, log]);

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        Ask a question scoped ONLY to this campaign own Election Canon data — never another Forge
        product. English only this Alpha; other languages are recognised and answered in English
        with that noted, never a fabricated translation.
      </div>
      <div style={{ fontFamily: UI, fontSize: 11, color: TEAL, marginBottom: 10 }}>
        Try: "What office am I contesting?" · "What is the status of Ward 3?" · "Who is responsible for Ward 3?" ·
        "What should we do next?" · "Which polling units have no agent?" · "Show unresolved incidents" ·
        "What evidence is waiting for verification?" · "Which result sheets have low OCR confidence?"
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="Ask ElectionCanon…" aria-label="Ask ElectionCanon" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
        <button type="button" disabled title={
          capabilityFor("en").voiceStt === VOICE_STATUS.AVAILABLE_PENDING_CONFIG
            ? "Voice input is architected against a real, researched speech provider (Google Cloud Speech-to-Text — see docs/VOICE.md) but no vendor key is configured in this deployment yet."
            : "No voice input provider was found for this language this pass — see docs/VOICE.md."
        } style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 14px", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "not-allowed" }}>
          Voice · soon
        </button>
        <button onClick={ask} disabled={busy || !message.trim()}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", border: "none", background: busy || !message.trim() ? BORDER : AMBER, color: BLACK,
            cursor: busy || !message.trim() ? "not-allowed" : "pointer" }}>{busy ? "Asking…" : "Ask"}</button>
      </div>
      {answer && (
        <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, padding: "10px 0", borderTop: `1px solid ${BORDER}` }}>
          {answer.answer}
          {answer.fellBack && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>(answered in English — the requested language is not yet supported)</div>}
        </div>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

export default function IntelligenceSection({ ctx, campaignId, refresh }) {
  const [log, setLog] = useState([]);

  useEffect(() => {
    let cancelled = false;
    readElectionLog({ client: supabase, requestedCampaign: campaignId }).then((r) => {
      if (!cancelled) setLog(r.log ?? []);
    });
    return () => { cancelled = true; };
  }, [campaignId]);

  const view = ctx.view ?? {};
  const attention = computeAttention(view, ctx.readiness?.gaps);
  const { alerts, counts } = attention;
  const tasks = Object.values(view.tasks ?? {});
  const wards = Object.values(view.wards ?? {});
  const results = Object.values(view.results ?? {});
  const pollingUnits = Object.values(view.pollingUnits ?? {});
  const agents = Object.values(view.agents ?? {});
  const incidents = Object.values(view.incidents ?? {});
  const feed = view.feed ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Ask ElectionCanon</Label>
        <AskPanel view={view} log={log} />
      </div>

      <div>
        <Label>Alerts</Label>
        <Panel>
          {alerts.length === 0
            ? <div style={{ fontFamily: UI, fontSize: 12.5, color: TEAL }}>No open alerts.</div>
            : alerts.slice(0, 12).map((a, i) => <AlertRow key={i} text={a.text} tone={TONE_COLOR[a.tone] ?? AMBER} />)}
        </Panel>
      </div>

      <div>
        <Label>Coverage gaps</Label>
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
        <Label>Ward coverage</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
            {wards.length} ward{wards.length === 1 ? "" : "s"} known · {wards.filter((w) => w.organisation).length} with a coordinator/team
          </div>
        </Panel>
      </div>

      <div>
        <Label>Task bottlenecks</Label>
        <Panel>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
            {tasks.filter((t) => t.status === TASK_STATUS.BLOCKED).length} blocked ·{" "}
            {tasks.filter((t) => t.status !== TASK_STATUS.COMPLETE).length} open of {tasks.length} total
          </div>
        </Panel>
      </div>

      <div>
        <Label>Election-day simulation statistics</Label>
        <Panel accent={AMBER}>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
            {pollingUnits.length} polling unit{pollingUnits.length === 1 ? "" : "s"} · {agents.length} agent{agents.length === 1 ? "" : "s"} assigned<br />
            {results.filter((r) => r.verificationStatus === VERIFICATION_STATUS.VERIFIED).length} results verified of {results.length} captured<br />
            {incidents.filter((i) => i.status !== INCIDENT_STATUS.RESOLVED && i.status !== INCIDENT_STATUS.CLOSED).length} open incident{incidents.length === 1 ? "" : "s"}
          </div>
        </Panel>
      </div>

      <div>
        <Label>Activity trend</Label>
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
