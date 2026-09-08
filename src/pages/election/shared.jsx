// ============================================================
// ELECTION FORGE — SHARED ATOMS  (Alpha 1.0)
//
// Extracted from src/pages/Election.jsx unchanged (same implementation,
// same styling discipline) so the new Alpha section files (Home, Mobilize,
// Chat, Campaign Studio, Election Day, Intelligence) can reuse them instead
// of duplicating markup. Election.jsx itself still imports from here too —
// there is exactly one Panel/Label/StatusChip implementation, not two.
// ============================================================

import { useState, useCallback } from "react";
import { T } from "../../os/forge.js";
import { FORGE_CLIPS } from "../../os/geometry.js";
import { supabase } from "../../lib/supabase.js";
import { prepareElectionWrite, approveElectionWrite } from "../../os/electionWebAdapter.js";
import { CREATIVE_FONT_LOAD_SPECS } from "../../domains/election/design/typography.js";

export const { black: BLACK, ivory: IVORY, teal: TEAL, amber: AMBER, pink: PINK,
  surface: SURFACE, border: BORDER, grey: MUTED } = T;
export const UI = "var(--forge-brand-font, 'Poppins', system-ui, sans-serif)";
export const DISPLAY = "var(--forge-display-font, 'Poppins', system-ui, sans-serif)";

// THE SINGLE SOURCE OF TRUTH for "what's real today" copy — read by the
// authenticated first-run Welcome screen (Election.jsx's WelcomeOnboarding)
// AND the public landing page (Landing.jsx), so the two can never drift
// into contradicting each other. PUBLIC INTRODUCTION PASS 1 — refreshed to
// include electoral geography, campaign organisation/invitations/role
// assignment, and geography-scoped coordination chat, all shipped and
// live-verified in production since this list was last updated.
export const CAPABILITIES_AVAILABLE_NOW = Object.freeze([
  "Election readiness (COMPLETE / INCOMPLETE / AT RISK / UNKNOWN — never a fabricated percentage)",
  "Campaign / workspace setup",
  "Electoral geography — Election, Office, State and Constituency selection, with LGA mapping where authoritative data exists",
  "Campaign organisation — invite an LGA Coordinator, Ward Coordinator or Polling-Unit Agent by email, each landing directly in their own scoped workspace",
  "Geographic responsibility — every coordinator's territory is a real, assigned record, not a claim",
  "Mobilization — people, roles, wards, polling units, assignments, tasks",
  "Coverage by state / LGA / ward, computed from real agent assignments",
  "Coordination chat, including geography-scoped rooms for a coordinator's own LGA/Ward/Polling Unit, plus contextual references to a polling unit, incident, result, or task",
  "Campaign Studio — 21 templates, save/edit, client-side PNG export",
  "Ask ElectionCanon — 15+ operational questions answered from your own campaign's real data",
  "Election-day simulation — polling units, agents, result capture, incident reporting",
  "Result-sheet photo evidence capture (private, tenant-isolated storage)",
  "OCR-assisted result extraction (English, client-side) with mandatory human review",
  "Human confirm / correct / dispute workflow, with the original OCR reading always preserved",
  "Low-bandwidth image compression before upload",
]);
export const CAPABILITIES_COMING_NEXT = Object.freeze([
  "Voice operation (architecture ready; a Google Cloud Speech-to-Text profile is registered but not configured with a live key in any deployment yet)",
  "Multilingual conversational realisation (Hausa/Yoruba/Igbo/Pidgin/Urhobo — detection exists; every language pack is unreviewed and unapproved for production)",
  "Chat-app channel (e.g. WhatsApp) — documented contract, no live transport",
  "Official election-result integration — Election Day remains explicitly simulated data",
  "Ward/polling-unit geography for constituencies beyond the current verified slice",
]);

// PRE-LAUNCH UX CLEANUP PASS (P3) — WelcomeOnboarding's setup step (in
// Election.jsx) stores the election type as a "[ElectionType] " prefix on
// `campaigns.name` itself, since ElectionCanon does not yet track election
// level as its own Canon fact (see that file's own comment). The STORED
// value is unchanged by this fix — no migration, same bytes, same
// semantics — this only splits the two pieces apart again for DISPLAY, so
// "[House of Representatives] Journey Test Campaign" reads as a clean
// campaign name with its election type available separately, not as one
// mechanical bracketed string. A name with no bracket prefix (every
// campaign created before this pass, or one where electionType was left
// blank) returns electionType: null and is returned completely unchanged.
export function parseCampaignTitle(rawName) {
  const text = String(rawName ?? "").trim();
  const match = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!match) return { name: text, electionType: null };
  const [, electionType, rest] = match;
  return { name: rest.trim() || text, electionType: electionType.trim() || null };
}

export const SECTIONS = Object.freeze([
  { id: "home", label: "Home" },
  { id: "territory", label: "Territory" },
  { id: "organisation", label: "Organisation" },
  { id: "readiness", label: "Readiness" },
  { id: "mobilize", label: "Mobilize" },
  { id: "chat", label: "Chat" },
  { id: "studio", label: "Campaign Studio" },
  { id: "election-day", label: "Election Day" },
  { id: "intelligence", label: "Intelligence" },
  { id: "settings", label: "Settings" },
]);

/** Never surface a raw Postgres/PostgREST error to a first-time user. Display
 *  filter only — never swallows an error, never intercepts a human-authored reason. */
export function friendlyError(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "Something went wrong. Please try again.";
  const looksRawDatabaseError =
    /^[0-9A-Z]{5}$/.test(text) || /PGRST\d+/i.test(text) ||
    /violates row-level security|duplicate key value|relation ".*" does not exist|syntax error at or near|column ".*" does not exist/i.test(text);
  return looksRawDatabaseError
    ? "We couldn't complete that just now. Please try again in a moment."
    : text;
}

// GATE A.5.3 — the DOM-triggering half of PNG export (createObjectURL /
// anchor-click / revokeObjectURL). Lives here, at the page layer, rather
// than in domains/election/design/render.js, because src/domains/election/
// is a structurally-enforced DOM-free boundary (see that file's own
// header) — this is the one place in the export pipeline allowed to touch
// `document`/`URL` directly. Shared by both Campaign Studio's own asset
// export (CampaignStudioSection.jsx) and Communications export
// (Communications.jsx) so the sequence is never duplicated.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// GATE A.5.4 — canvas does NOT automatically wait for a web font to
// finish loading; a <canvas> ctx.font request for a face the browser
// hasn't fetched yet silently falls back to a system font for that draw,
// with no error. Poppins IS already loaded site-wide (index.html's Google
// Fonts <link>, forge-brand.css's own @import) as ordinary CSS, but that
// guarantees nothing about canvas readiness at the moment a creative
// render happens to run. This is the smallest reliable fix: explicitly
// request the exact face+weight strings design/typography.js's renderer
// actually uses via the standard FontFaceSet API, and await the browser's
// own readiness signal — no new font-loading library, no polling. Lives
// here (not in domains/election/design/render.js) because `document.fonts`
// is DOM access, and that module is a structurally-enforced DOM-free
// boundary (see render.js's own header). Never throws: a browser with no
// `document.fonts` (or a failed fetch) resolves `false` and the caller
// proceeds anyway — Poppins is a visual polish for creative exports, not
// a hard requirement the export path should ever block on.
let creativeFontsReadyPromise = null;
export function ensureCreativeFontsReady() {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve(false);
  if (!creativeFontsReadyPromise) {
    creativeFontsReadyPromise = Promise.all(CREATIVE_FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec)))
      .then(() => document.fonts.ready)
      .then(() => true)
      .catch(() => false);
  }
  return creativeFontsReadyPromise;
}

export function Label({ children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 10, letterSpacing: "0.2em",
        textTransform: "uppercase", color: TEAL }}>{children}</div>
      <div style={{ width: 40, height: 2, background: PINK, marginTop: 6 }} />
    </div>
  );
}

export function Panel({ children, accent = TEAL, style = {} }) {
  return (
    <div style={{ clipPath: FORGE_CLIPS.panelBR, background: SURFACE,
      borderTop: `2px solid ${accent}`, padding: "20px 22px", ...style }}>{children}</div>
  );
}

const NOT_STARTED = "NOT STARTED";
const NOT_STARTED_COLOR = MUTED;

export function StatusChip({ status, color, statusColor = {} }) {
  const c = color ?? statusColor[status] ?? MUTED;
  return (
    <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
      textTransform: "uppercase", color: c, border: `1px solid ${c}`,
      padding: "4px 9px", clipPath: FORGE_CLIPS.buttonSm }}>{status}</span>
  );
}

export function ClaimRow({ claim, statusColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
      padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, color: IVORY,
          letterSpacing: "0.04em" }}>{claim.dimension}</div>
        <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 2 }}>{claim.value}</div>
      </div>
      <StatusChip status={claim.status} statusColor={statusColor} />
    </div>
  );
}

export function NotStartedRow({ label, note }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
      padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, color: IVORY,
          letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 2 }}>{note}</div>
      </div>
      <StatusChip status={NOT_STARTED} color={NOT_STARTED_COLOR} />
    </div>
  );
}

export function GapRow({ gap }) {
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY }}>{gap.what}</div>
      <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 3 }}>{gap.why_it_matters}</div>
      <div style={{ fontFamily: UI, fontSize: 10.5, color: TEAL, marginTop: 4 }}>
        Next: {gap.action} · owner {gap.owner} · deadline {gap.deadline}
      </div>
    </div>
  );
}

export function DemoTag({ label = "Demonstration data — not official election results" }) {
  return (
    <span style={{ fontFamily: UI, fontWeight: 800, fontSize: 9.5, letterSpacing: "0.14em",
      textTransform: "uppercase", color: BLACK, background: AMBER, padding: "3px 8px",
      clipPath: FORGE_CLIPS.buttonSm }}>{label}</span>
  );
}

export function btnStyle(accent) {
  return { fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em",
    padding: "10px 16px", border: "none", background: accent, color: BLACK,
    cursor: "pointer", clipPath: FORGE_CLIPS.buttonSm };
}
export function linkBtn() {
  return { fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em",
    background: "transparent", border: "none", color: TEAL, cursor: "pointer", padding: 0 };
}
export const inputStyle = { width: "100%", boxSizing: "border-box", fontFamily: UI, fontSize: 13,
  padding: "11px 13px", background: BLACK, color: IVORY, border: `1px solid ${BORDER}`, outline: "none", marginBottom: 9 };

export function ForgeHeader({ section, onSection, campaignName, onSignOut, showNav = true }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.22em",
            textTransform: "uppercase", color: TEAL, borderLeft: `2px solid ${PINK}`,
            paddingLeft: 12, marginBottom: 10 }}>ElectionCanon</div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,38px)",
            letterSpacing: "-0.03em", lineHeight: 1, margin: 0, color: IVORY }}>
            {campaignName || "Prepare. Organize. Coordinate. Observe. Respond."}
          </h1>
        </div>
        {onSignOut && (
          <button onClick={onSignOut} style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5,
            letterSpacing: "0.12em", textTransform: "uppercase", padding: "9px 16px",
            background: "transparent", color: MUTED, border: `1px solid ${BORDER}`,
            cursor: "pointer", clipPath: FORGE_CLIPS.buttonSm }}>Sign out</button>
        )}
      </div>
      {showNav && (
      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${BORDER}`,
        paddingBottom: 2 }}>
        {SECTIONS.map((s) => {
          const active = s.id === section;
          return (
            <button key={s.id} onClick={() => onSection(s.id)}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em",
                padding: "10px 16px", cursor: "pointer", border: "none", borderBottom: `2px solid ${active ? TEAL : "transparent"}`,
                background: "transparent", color: active ? IVORY : MUTED }}>
              {s.label}
            </button>
          );
        })}
      </nav>
      )}
    </div>
  );
}

/** Generic write surface — free text matched against every Election write command
 *  proposeElectionWrite() (studio/write.js) recognises: candidate registration,
 *  ward assignment, ward status reporting, and observer assignment. */
/** GENERIC structured PREPARE/APPROVE form — Alpha 1.0's Mobilization and
 *  Election Day surfaces all use this same shape (see electionWebAdapter.js's
 *  prepareMobilizationWrite/approveMobilizationWrite and
 *  prepareElectionDayWrite/approveElectionDayWrite), just with different
 *  `fields` config and `prepareFn`/`approveFn`. `fields` is an array of
 *  { id, label, type: "text"|"select", options?, placeholder? }. */
// ALPHA 1.2 — `extraArgs` is an optional bag of extra top-level arguments
// forwarded to `prepareFn` alongside `fields` (e.g. `{ roster }` for
// proposeChangeIncidentStatus's escalation-target validation). Every
// existing caller omits it and behaves exactly as before.
export function StructuredWritePanel({ title, operation, fields, prepareFn, approveFn, campaignId, refresh, accent = TEAL, extraArgs = {} }) {
  const initial = Object.fromEntries(fields.map((f) => [f.id, f.type === "select" ? (f.options?.[0]?.value ?? "") : ""]));
  const [values, setValues] = useState(initial);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setField = (id) => (e) => setValues((v) => ({ ...v, [id]: e.target.value }));

  const doPrepare = useCallback(async () => {
    setBusy(true); setError(null);
    const result = await prepareFn({ client: supabase, requestedCampaign: campaignId, operation, fields: values, ...extraArgs });
    setBusy(false);
    if (result.status !== "PREPARED") {
      setError(result.reason ?? `could not prepare: ${result.status}`);
      return;
    }
    setPrepared({ draft: result.draft, confirmationId: crypto.randomUUID() });
  }, [campaignId, operation, values, prepareFn, extraArgs]);

  const doApprove = useCallback(async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveFn({
      client: supabase, requestedCampaign: campaignId, operation,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "approval failed"); return; }
    setPrepared(null); setValues(initial);
    await refresh();
  }, [campaignId, operation, prepared, refresh, approveFn]); // eslint-disable-line

  return (
    <Panel accent={accent}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: accent, marginBottom: 10 }}>{title}</div>
      {!prepared ? (
        <>
          {fields.map((f) => (
            <div key={f.id} style={{ marginBottom: 9 }}>
              {f.type === "select" ? (
                <select value={values[f.id]} onChange={setField(f.id)} aria-label={f.label}
                  style={{ ...inputStyle, marginBottom: 0 }}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input value={values[f.id]} onChange={setField(f.id)} placeholder={f.placeholder ?? f.label}
                  aria-label={f.label} style={{ ...inputStyle, marginBottom: 0 }} />
              )}
            </div>
          ))}
          <button onClick={doPrepare} disabled={busy}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
              textTransform: "uppercase", padding: "11px 18px", border: "none",
              background: busy ? BORDER : accent, color: BLACK,
              cursor: busy ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button, marginTop: 4 }}>
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
                background: busy ? BORDER : accent, color: BLACK,
                cursor: busy ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
              {busy ? "Recording…" : "Approve"}
            </button>
            <button onClick={() => setPrepared(null)} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", cursor: "pointer",
                background: "transparent", color: MUTED, border: `1px solid ${BORDER}`,
                clipPath: FORGE_CLIPS.button }}>Cancel</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

export function WriteActionPanel({ campaignId, refresh }) {
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const doPrepare = useCallback(async () => {
    setBusy(true); setError(null);
    const result = await prepareElectionWrite({ client: supabase, requestedCampaign: campaignId, message });
    setBusy(false);
    if (result.status !== "PREPARED") {
      setError(result.reason ?? `could not prepare: ${result.status}`);
      return;
    }
    setPrepared({ draft: result.draft, confirmationId: crypto.randomUUID() });
  }, [campaignId, message]);

  const doApprove = useCallback(async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveElectionWrite({
      client: supabase, requestedCampaign: campaignId,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "approval failed"); return; }
    setPrepared(null); setMessage("");
    await refresh();
  }, [campaignId, prepared, refresh]);

  return (
    <Panel accent={TEAL}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>Record a campaign action</div>
      {!prepared ? (
        <>
          <input value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder='e.g. "Assign Team 6 to Ward 6" or "Report Ward 6 as on-track"' aria-label="Action"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: UI, fontSize: 13,
              padding: "11px 13px", background: BLACK, color: IVORY,
              border: `1px solid ${BORDER}`, outline: "none", marginBottom: 9 }} />
          <button onClick={doPrepare} disabled={busy || !message.trim()}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
              textTransform: "uppercase", padding: "11px 18px", border: "none",
              background: busy || !message.trim() ? BORDER : TEAL, color: BLACK,
              cursor: busy || !message.trim() ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
            {busy ? "Preparing…" : "Prepare"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
            textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>Proposed action — not yet recorded</div>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, marginBottom: 6 }}>
            {prepared.draft.summary}
          </div>
          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 14 }}>
            {prepared.draft.notice}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={doApprove} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy ? BORDER : TEAL, color: BLACK,
                cursor: busy ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
              {busy ? "Recording…" : "Approve"}
            </button>
            <button onClick={() => setPrepared(null)} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", cursor: "pointer",
                background: "transparent", color: MUTED, border: `1px solid ${BORDER}`,
                clipPath: FORGE_CLIPS.button }}>Cancel</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}
