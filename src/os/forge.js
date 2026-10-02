// ============================================================
// FORGE OS — CANONICAL DESIGN SYSTEM
//
// Immutable design tokens. This is a SPECIFICATION, not a preference.
// Every room, panel, badge and chart derives from here. Rooms must not
// declare their own colours — six rooms previously each re-declared the
// palette, which is precisely how three competing palettes came to exist
// in one codebase.
//
// If a value is not in this file, it is not a Forge colour.
// ============================================================

export const T = Object.freeze({
  // ---- canonical seven ----
  black:   "#0D0D0F",  // the operating system. Nothing is darker.
  surface: "#111418",  // every card, console and workstation. No other grey.
  border:  "#1C2128",  // thin rules, not visible boxes.
  ivory:   "#F5F1E9",  // primary type. Never pure white.
  teal:    "#0A7F73",  // alive: connected, operational, running, healthy.
  amber:   "#F5A623",  // current state, pending, in review, in progress.
  pink:    "#FF2E63",  // attention. Constraint, safety lock, halt, fault. Rare by design.

  // ---- derived, not new hues ----
  green:    "#1a7a4a",                    // verified / accepted
  grey:     "#8899aa",                    // secondary type
  greyDark: "#3a4a5a",                    // idle, unavailable
  ivory70:  "rgba(245,241,233,0.70)",
  ivory55:  "rgba(245,241,233,0.55)",
  ivory12:  "rgba(245,241,233,0.12)",
});

export const FONT = Object.freeze({
  // Poppins Black carries every heading that represents authority.
  display: "var(--font-display, 'Poppins', system-ui, sans-serif)",
  ui:      "var(--font-ui, 'Poppins', system-ui, sans-serif)",
  mono:    "var(--forge-mono, ui-monospace, monospace)",
});

// Spacing: one scale, so rooms cannot drift apart.
export const S = Object.freeze({ xs:4, sm:8, md:14, lg:20, xl:28, xxl:40 });

// ---- OPERATING PRINCIPLES ----
// Constitutional statements, not taglines. Every room opens with one.
export const PRINCIPLES = Object.freeze({
  "arrival-dock":      "Every workshop strengthens the national manufacturing grid.",
  "engineering-bay":   "Nothing is manufactured against an unapproved specification.",
  "inspection-hangar": "Nothing reaches assembly without verification.",
  "control-room":      "Every manufacturing decision is traceable.",
  "national-grid":     "Every workshop strengthens the national manufacturing grid.",
  "production-line":   "One SME, one component, one owner.",
  "impact-dashboard":  "Every mission produces measurable industrial capacity.",
  "build-board":       "Engineering knowledge shall be documented before production begins.",
  "language-studio":   "Knowledge becomes manufacturing capability.",
  "publishing-studio": "Every document becomes institutional memory.",
  "demo-studio":       "Every manufacturing decision is traceable.",
  // Forge Studio. The principle is the whole safety architecture in one line: the
  // assistant may change the LANGUAGE a fact is spoken in and nothing else.
  "ai-assistant":      "Language is the interface. Forge Canon is the truth.",
});

// ---- SEMANTIC STATE COLOUR ----
// One mapping, so a status never renders differently between two rooms.
// Amber is never an error. Pink is never merely "busy".
export const stateColor = (state) => ({
  // healthy / alive
  running:"#0A7F73", active:"#0A7F73", fabricating:"#0A7F73", coordinating:"#0A7F73",
  available:"#0A7F73", released:"#1a7a4a", verified:"#1a7a4a", passed:"#1a7a4a",
  completed:"#1a7a4a", approved:"#0A7F73", assembly:"#0A7F73", installed:"#1a7a4a",
  // in transition
  review:"#F5A623", pending:"#F5A623", inspection:"#F5A623", verifying:"#F5A623",
  manufacturing:"#F5A623", reserved:"#F5A623", maintenance:"#F5A623", expanding:"#F5A623",
  rework:"#F5A623", procurement:"#F5A623", delivery:"#F5A623",
  engineering:"#F5A623",
  // attention
  fault:"#FF2E63", failed:"#FF2E63", blocked:"#FF2E63", critical:"#FF2E63",
  scrapped:"#FF2E63", deprecated:"#FF2E63", halted:"#FF2E63",
  held:"#FF2E63", abandoned:"#FF2E63",
  // dormant
  idle:"#3a4a5a", offline:"#3a4a5a", standby:"#1C2128", draft:"#8899aa",
  planned:"#8899aa", planning:"#8899aa", unverified:"#8899aa", unknown:"#8899aa",
  // ---- mission lifecycle completion ----
  // All nine mission states now resolve. `production` previously fell through
  // to the dormant default, so the one state the old projection assigned
  // rendered as "unknown" grey in three rooms. Existing tokens only; no hue is
  // introduced and no mission-specific colour system exists.
  //   planning    dormant  — objective being defined      (already present)
  //   engineering amber    — package being authored
  //   procurement amber    — materials being sourced      (already present)
  //   production  teal     — being manufactured, alive
  //   inspection  amber    — under verification           (already present)
  //   delivery    amber    — being delivered              (already present)
  //   closed      green    — complete, matches `completed`
  //   held        pink     — suspended, matches `halted`
  //   abandoned   pink     — terminal negative, matches `scrapped`/`deprecated`
  production:"#0A7F73", closed:"#1a7a4a",
}[String(state || "").toLowerCase()] ?? "#8899aa");

export const severityColor = (s) =>
  ({ critical:T.pink, warning:T.amber, advisory:T.teal }[s] ?? T.grey);
