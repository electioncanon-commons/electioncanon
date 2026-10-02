// ============================================================
// ELECTIONCANON — LANGUAGE SELECTOR  (multilingual Track A, Phase 2)
//
// A native <select>, not a custom dropdown widget — the same accessible-
// by-construction choice this codebase already makes everywhere else a
// picker appears (Territory's Office/State, Mobilize's Role, Election
// Operations' Verification decision). A native control gets keyboard
// navigation, screen-reader labeling, and focus handling for free (Phase
// 12) rather than needing new ARIA plumbing re-implemented here.
//
// HONESTY, NOT JUST A LABEL. Hausa/Igbo render with a visible "Review"
// badge and are never silently indistinguishable from English in this
// control — language.js's own `languageEntry()` is the one place that
// decides AVAILABLE vs REVIEW (computed from the real lexicon-approval
// count), never asserted here.
// ============================================================

import { LANGUAGES, AVAILABILITY } from "./language.js";
import { useLanguageSession } from "./LanguageContext.jsx";
// Tokens read from their OS source directly, not from shared.jsx — shared.jsx
// mounts AppHeader, which mounts this component, so importing shared.jsx
// here would be a circular import.
import { T } from "../../os/forge.js";
import { CLIP_PATHS } from "../../os/geometry.js";

const { black: BLACK, ivory: IVORY, teal: TEAL, amber: AMBER, border: BORDER } = T;
const UI = "var(--font-ui, 'Poppins', system-ui, sans-serif)";

export function LanguageSelector() {
  const { language, setLanguage } = useLanguageSession();
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label htmlFor="electioncanon-language-selector" style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5,
        letterSpacing: "0.18em", textTransform: "uppercase", color: TEAL }}>
        Language
      </label>
      <select
        id="electioncanon-language-selector"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        aria-label="Interaction language"
        // Reflects the on-screen label text in the control's OWN language
        // metadata too — a screen reader landing on this control should
        // not assume it's reading English just because the page default is.
        lang={current.locale}
        style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, padding: "8px 10px",
          background: BLACK, color: IVORY, border: `1px solid ${BORDER}`, outline: "none",
          cursor: "pointer", clipPath: CLIP_PATHS.buttonSm, maxWidth: 180 }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.uiLabel}{l.availability === AVAILABILITY.REVIEW ? " (Review)" : ""}
          </option>
        ))}
      </select>
      {current.availability === AVAILABILITY.REVIEW && (
        <div role="status" style={{ fontFamily: UI, fontSize: 10, color: AMBER, maxWidth: 220, lineHeight: 1.4 }}>
          {current.availabilityNote}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
