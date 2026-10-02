// ============================================================
// ELECTIONCANON — ASK ELECTIONCANON, AS A CONTEXTUAL ASSISTANT
// (UX Redesign Slice 5)
//
// NOT a new AI service, grounding engine, or event reader. This is the
// SAME askForge() pipeline IntelligenceSection.jsx already ran (deterministic
// adapter, planElectionResponse, ELECTION_VOCABULARY) — extracted so it can
// be opened from any page as "ask about what I'm looking at" instead of
// requiring a trip to a separate Intelligence destination.
// IntelligenceSection.jsx now imports AskPanel from here too, so there is
// exactly one Ask implementation, not a fork.
//
// WHAT'S NEW HERE, AND WHY IT'S HONEST:
// - The answer's own `segments` (already computed by planElectionResponse —
//   see respond.js's SEGMENT vocabulary) are rendered as ANSWER vs NEXT
//   ACTION instead of one flattened string. This is real, already-existing
//   structure the previous UI discarded — not a new capability.
// - `sources` (already-computed grounding paths, e.g. "wards.W1.status")
//   are surfaced as "this is grounded in your campaign's own recorded
//   data", with a link to Canon — never a raw path string, never a
//   fabricated event reference.
// - A `session.lastComponent` context hint is accepted, using askForge()'s
//   own already-supported session-continuity parameter (see ask.js's own
//   header) — never a new memory/context system.
// - `log` defaults to []. Election's own deterministicAdapter/
//   planElectionResponse (infer.js/respond.js) never read `log`/`tools` at
//   all today (grounding is 100% `view`-based) — confirmed by inspection —
//   so passing an empty log from a page that has not independently fetched
//   the raw event log (most pages haven't, and this slice does not add a
//   new readElectionLog() call to fetch one) has no effect on answer
//   quality. Canon (EventsSection.jsx) already has a real log fetched for
//   its own list and passes it through here for free.
//
// SCOPE — this component never resolves scope itself; it renders whatever
// `view` its caller passes. ROLE_SCOPE_03 made IntelligenceSection.jsx (the
// "Ask ElectionCanon" page) resolve the caller's effective scope and pass a
// geography-filtered view for a scoped LGA/Ward Coordinator — see that
// file's own scopeElectionDayView()/scopeFeed() calls. Every other
// ContextualAsk mount point (People/Places/Work/Canon/Election Operations)
// still passes its own page's `view` unchanged, campaign-wide or already
// scoped exactly as that page itself is.
// ============================================================

import { useState, useCallback, useEffect, useRef } from "react";
import { useLanguageSession } from "./LanguageContext.jsx";
import { useTranslation } from "./useTranslation.js";
import { askForge, MODE } from "../../os/studio/ask.js";
import { deterministicAdapter } from "../../domains/election/studio/infer.js";
import { planElectionResponse } from "../../domains/election/studio/respond.js";
import { ELECTION_VOCABULARY } from "../../domains/election/studio/vocabulary.js";
import { SEGMENT } from "../../os/studio/respond.js";
import { capabilityFor, VOICE_STATUS } from "../../os/studio/languageCapability.js";
import { Panel, friendlyError, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

const RECOMMENDATION_KINDS = new Set([SEGMENT.RECOMMENDATION]);

/** Groups the answer's own real segments into ANSWER vs NEXT ACTION —
 *  structure planElectionResponse() already computed; nothing derived here
 *  beyond which bucket a segment's existing `kind` belongs in. */
function splitSegments(segments = []) {
  const answer = [];
  const nextActions = [];
  for (const s of segments) (RECOMMENDATION_KINDS.has(s.kind) ? nextActions : answer).push(s);
  return { answer, nextActions };
}

/** The structured ANSWER / EVIDENCE / NEXT ACTION presentation. `result` is
 *  exactly what planElectionResponse() returned — no new fields invented. */
function AnswerView({ result, onSection }) {
  const { t } = useTranslation();
  const { answer: answerSegments, nextActions } = splitSegments(result.segments);
  const grounded = (result.sources?.length ?? 0) > 0;
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: TEAL, marginBottom: 6 }}>
        {t("ask.answerHeading")}
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.6 }}>
        {answerSegments.map((s, i) => <span key={i}>{s.text} </span>)}
      </div>
      {/* Phase 10 — EXPLICIT, not silent. Visually distinct from the answer
          itself (not folded into the muted "grounded in..." footer below)
          so a Hausa/Igbo session can never read this as a Hausa/Igbo
          answer. FIX: askForge()'s actual return field is
          `languageFellBack` (os/studio/ask.js:220), not `fellBack` —
          `result.fellBack` is always undefined, so this banner has never
          fired in production even before this feature. Pre-existing bug,
          corrected here as part of wiring real language selection — the
          underlying computation (planElectionResponse's fellBack) was
          always correct, only this read-site's field name was wrong. */}
      {result.languageFellBack && (
        <div role="status" style={{ fontFamily: UI, fontSize: 11, color: AMBER, marginTop: 10,
          padding: "8px 10px", border: `1px solid ${AMBER}` }}>
          {t("ask.languageFallbackBanner")}
        </div>
      )}

      {nextActions.length > 0 && (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: AMBER, marginTop: 14, marginBottom: 6 }}>
            {t("ask.nextActionHeading")}
          </div>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.6 }}>
            {nextActions.map((s, i) => <div key={i}>{s.text}</div>)}
          </div>
        </>
      )}

      {grounded && (
        <div style={{ marginTop: 14, fontFamily: UI, fontSize: 11, color: MUTED }}>
          {t("ask.groundedInCanon")}
          {onSection && (
            <>
              {" "}
              <button type="button" onClick={() => onSection("canon")}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: TEAL, background: "transparent",
                  border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
                {t("ask.seeCanon")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The Ask panel itself — same engine, same props contract IntelligenceSection.jsx
 *  always used (`view`, `log`), plus purely additive optional props for
 *  contextual callers: `contextHint` (a component id for session continuity,
 *  e.g. a ward id), `onSection` (for the "See Canon" link), and `autoFocus`. */
export function AskPanel({ view, log = [], contextHint = null, onSection, autoFocus = false, initialMessage = "" }) {
  const { language } = useLanguageSession();
  const { t } = useTranslation();
  const [message, setMessage] = useState(initialMessage);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const ask = useCallback(async () => {
    if (!message.trim()) return;
    setBusy(true); setError(null);
    try {
      // `preferredLanguage` is the SAME parameter askForge()/understand.js
      // already define (os/studio/ask.js's own doc comment: "the session
      // preference, used only when detection is genuinely uncertain. Never
      // overrides a confident read.") — this wiring is new; the resolution
      // priority (explicit per-turn request > session preference > detected
      // > English) and the honest fellBack labeling below are both
      // pre-existing and unchanged by this feature.
      const response = await askForge({
        message, view, log, preferredLanguage: language, mode: MODE.ASK,
        adapter: deterministicAdapter, responder: planElectionResponse, vocabulary: ELECTION_VOCABULARY,
        session: contextHint ? { lastComponent: contextHint } : null,
      });
      setResult(response);
    } catch (e) {
      setError(e?.message ?? "could not process that question");
    }
    setBusy(false);
  }, [message, view, log, contextHint, language]);

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        {t("ask.scopedQuestionGuidance")}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input ref={inputRef} value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder={t("ask.inputPlaceholder")} aria-label={t("nav.intelligence")} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
        <button type="button" disabled title={
          capabilityFor("en").voiceStt === VOICE_STATUS.AVAILABLE_PENDING_CONFIG
            ? "Voice input is architected against a real, researched speech provider (Google Cloud Speech-to-Text — see docs/VOICE.md) but no vendor key is configured in this deployment yet."
            : "No voice input provider was found for this language this pass — see docs/VOICE.md."
        } style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 14px", border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "not-allowed" }}>
          {t("voice.comingSoon")}
        </button>
        <button onClick={ask} disabled={busy || !message.trim()}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", border: "none", background: busy || !message.trim() ? BORDER : AMBER, color: BLACK,
            cursor: busy || !message.trim() ? "not-allowed" : "pointer" }}>{busy ? t("ask.asking") : t("ask.askButton")}</button>
      </div>
      {result && <AnswerView result={result} onSection={onSection} />}
      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

/** Accessible slide-in drawer (same pattern as primitives.jsx's PrimaryNav
 *  mobile drawer from Slice 1 — role="dialog", focus-trapped, Escape/backdrop
 *  to close, focus restored to the trigger). One component covers desktop
 *  (a side panel) and mobile (near-full-width) via `width: min(...)`, no
 *  separate mobile-only surface to keep in sync. */
function AskDrawer({ title, onClose, children }) {
  const { t } = useTranslation();
  const panelRef = useRef(null);

  useEffect(() => {
    // Prefer the question input over the close button, which renders first
    // in DOM order — a keyboard/screen-reader user should land on the thing
    // they opened this drawer to do, not on "close".
    const firstField = panelRef.current?.querySelector("input") ?? panelRef.current?.querySelector("button");
    firstField?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll("input,button");
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000 }} onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 92vw)", overflowY: "auto",
          background: BLACK, borderLeft: `1px solid ${BORDER}`, zIndex: 1001, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL }}>
            {title}
          </div>
          <button type="button" onClick={onClose} aria-label={t("a11y.closeAsk")}
            style={{ background: "transparent", border: "none", color: IVORY, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The contextual entry point every page mounts: a small trigger ("Ask
 *  about this roster") that opens the SAME AskPanel in a drawer, optionally
 *  pre-seeded with a few real, already-answerable example prompts and a
 *  session continuity hint. Nothing here is a new capability — it is the
 *  existing Ask engine, reached without leaving the current page. */
export function ContextualAsk({ triggerLabel, contextLabel, suggestedPrompts = [], view, log = [], contextHint = null, onSection }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const [prefill, setPrefill] = useState(null);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen(true)}
        style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "9px 16px", cursor: "pointer", background: "transparent", color: TEAL, border: `1px solid ${TEAL}` }}>
        {triggerLabel}
      </button>
      {open && (
        <AskDrawer title={`Ask ElectionCanon${contextLabel ? ` — ${contextLabel}` : ""}`} onClose={close}>
          {suggestedPrompts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {suggestedPrompts.map((p) => (
                <button key={p} type="button" onClick={() => setPrefill(p)}
                  style={{ fontFamily: UI, fontSize: 10.5, padding: "6px 10px", cursor: "pointer",
                    background: "transparent", border: `1px solid ${BORDER}`, color: MUTED }}>
                  {p}
                </button>
              ))}
            </div>
          )}
          <AskPromptBridge prefill={prefill} view={view} log={log} contextHint={contextHint} onSection={onSection} />
        </AskDrawer>
      )}
    </>
  );
}

/** Remounts AskPanel (via `key`) whenever a suggested prompt is clicked, so
 *  its `initialMessage` seeds a fresh input — AskPanel's own contract
 *  (uncontrolled `message` state) stays identical to what
 *  IntelligenceSection.jsx always used; this only supplies a starting value. */
function AskPromptBridge({ prefill, view, log, contextHint, onSection }) {
  const [seed, setSeed] = useState(0);
  useEffect(() => { if (prefill) setSeed((s) => s + 1); }, [prefill]);
  return <AskPanel key={seed} view={view} log={log} contextHint={contextHint} onSection={onSection}
    initialMessage={prefill ?? ""} autoFocus={seed > 0} />;
}

export default { AskPanel, ContextualAsk };
