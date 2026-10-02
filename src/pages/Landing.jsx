// ============================================================
// ELECTIONCANON — PUBLIC LANDING PAGE  (Public Introduction Pass 1)
//
// The public introduction to the product, at "/". Renders immediately —
// no identity-resolution check, no auth-gated app shell — because a
// first-time visitor's understanding shouldn't wait on a session lookup.
// Replaces the old unauthenticated block that used to live inside
// Election.jsx (see that file's own header on why it now just redirects
// here); this is the single source of truth for the pitch.
//
// Every claim on this page is either already true in the shipped product
// (verified against CAPABILITIES_AVAILABLE_NOW, the same single source of
// truth the authenticated first-run Welcome screen reads from) or framed
// honestly as not-yet-built (CAPABILITIES_COMING_NEXT). No invented
// customers, campaigns, statistics, or endorsements — none exist yet, and
// this project's own discipline (see index.html's own comment on why no
// logo asset is used) is to never claim what isn't real.
// ============================================================

import { useNavigate } from "react-router-dom";
import {
  BLACK, IVORY, TEAL, PINK, MUTED, BORDER, UI, DISPLAY, Panel,
  CAPABILITIES_AVAILABLE_NOW, CAPABILITIES_COMING_NEXT,
  // AMBER: functional only, never a brand accent on this page — see
  // docs/DESIGN_SYSTEM.md. Used below solely for the "Simulated" tag,
  // the same warning role it plays as DemoTag's background elsewhere.
  AMBER,
} from "./election/shared.jsx";
import { CLIP_PATHS } from "../os/geometry.js";
// VISIBILITY EXPANSION PASS — this page previously had ZERO t() call sites
// (see docs/multilingual/UI-STRING-INVENTORY.md's addendum). Reuses the
// EXISTING language session/selector/dictionary unchanged — App.jsx now
// mounts the same <LanguageProvider> this component already used
// authenticated-side, one level up, around this route only (see App.jsx's
// own comment). No second language system, no new context.
import { useTranslation } from "./election/useTranslation.js";
import { LanguageSelector } from "./election/LanguageSelector.jsx";

// Any AVAILABLE_NOW capability whose own copy says "simulat..." is real and
// shipped, but its DATA is demonstration data, not an official result — flag
// it distinctly rather than let it read identically to a fully-live feature.
const isSimulated = (text) => /simulat/i.test(text);

// VISIBILITY EXPANSION PASS — `label` is now a uiStrings.js KEY, not a
// literal string (reusing territory.office/territory.constituency/
// nav.readiness/nav.chat where an identical translation already exists
// elsewhere, same "reuse the existing registry" discipline as the rest of
// this codebase). `body` stays literal English on purpose — see this
// pass's own scope note at the top of this file: section kickers/headings
// and short labels are translated everywhere, but the longer per-step
// explanatory paragraphs are deliberately left for a future pass rather
// than rushed through five more languages in one go.
const WORKFLOW_STEPS = Object.freeze([
  { label: "landing.step.election", body: "Choose your election — presidential, senatorial, gubernatorial, and more." },
  { label: "territory.office", body: "Choose the office you're contesting or observing." },
  { label: "territory.constituency", body: "Choose your constituency." },
  { label: "landing.step.territory", body: "ElectionCanon maps the territory — states and LGAs, ward by ward where authoritative geography data exists." },
  { label: "landing.step.organisation", body: "Build your campaign organisation — invite the people who will run it, by email." },
  { label: "landing.step.responsibility", body: "Assign responsibility — every coordinator gets a real, recorded territory, not a title." },
  { label: "nav.readiness", body: "Track readiness as COMPLETE, INCOMPLETE, AT RISK, or UNKNOWN — never a fabricated percentage." },
  { label: "nav.chat", body: "Coordinate the work — scoped chat, tasks, and campaign communications." },
  { label: "landing.step.electionDay", body: "Run election day — polling units, agents, results, and incidents, each attributed to who reported it." },
]);

const HIERARCHY = Object.freeze([
  { label: "landing.hierarchy.command", accent: TEAL, body: "The campaign's national coordination room — where the whole organisation stays aligned." },
  { label: "role.lgaCoordinator", accent: PINK, body: "Responsible for one Local Government Area, with a coordination room scoped to exactly that territory." },
  { label: "role.wardCoordinator", accent: TEAL, body: "Responsible for one ward inside their LGA, invited directly by that LGA's own coordinator." },
  { label: "role.puAgent", accent: PINK, body: "Responsible for one polling unit, the front line of election day itself." },
]);

const WORKSPACE_SECTIONS = Object.freeze([
  { label: "Territory", body: "The election, office, and constituency a campaign is organised around, with real geography mapped underneath it." },
  { label: "Organisation", body: "Who's in the campaign, what they're responsible for, and the invitations still pending." },
  { label: "Readiness", body: "What's COMPLETE, what's AT RISK, and what's still UNKNOWN — grounded in the campaign's own recorded history." },
  { label: "Mobilize", body: "People, wards, assignments, and tasks — the campaign's roster and its work." },
  { label: "Chat", body: "Coordination rooms scoped to national, state, LGA, ward, and polling-unit level." },
  { label: "Campaign Studio", body: "The campaign's own communications workspace — templates, drafts, and exports." },
  { label: "Election Day", body: "Polling units, agents, result capture, and incident reporting, all attributed." },
]);

const DIFFERENCE = Object.freeze([
  { label: "People", accent: TEAL, body: "Every coordinator and agent is a real, invited, accountable actor — never an anonymous login." },
  { label: "Territory", accent: PINK, body: "Real electoral geography, not a free-text field someone typed in." },
  { label: "Responsibility", accent: PINK, body: "A recorded assignment tied to a real person and a real place, not a job title." },
  { label: "Readiness", accent: TEAL, body: "Four honest states — COMPLETE, INCOMPLETE, AT RISK, UNKNOWN — never a guess dressed up as a percentage." },
  { label: "Accountability", accent: TEAL, body: "An immutable event log every screen reads from, so nothing is ever out of sync or quietly rewritten." },
]);

const AUDIENCES = Object.freeze([
  "landing.audience.candidate", "landing.audience.directors", "landing.audience.coordinators",
  "landing.audience.volunteers", "landing.audience.observers", "landing.audience.opsTeams",
]);

const PROBLEM_TAGS = Object.freeze([
  "landing.problemTag.whatsapp", "landing.problemTag.calls", "landing.problemTag.spreadsheets",
  "landing.problemTag.volunteers", "landing.problemTag.responsibility", "landing.problemTag.territory",
  "landing.problemTag.mobilisation",
]);

function CtaButton({ children, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: UI, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.12em", textTransform: "uppercase",
      padding: "15px 26px", cursor: "pointer", clipPath: CLIP_PATHS.button,
      border: primary ? "none" : `1px solid ${BORDER}`,
      background: primary ? TEAL : "transparent",
      color: primary ? BLACK : IVORY,
    }}>
      {children}
    </button>
  );
}

function SectionKicker({ children, accent = TEAL }) {
  return (
    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase",
      color: accent, borderLeft: `2px solid ${PINK}`, paddingLeft: 12, marginBottom: 16 }}>
      {children}
    </div>
  );
}

function Section({ id, children, style = {} }) {
  return (
    <section id={id} style={{ padding: "clamp(48px,7vw,88px) clamp(20px,5vw,60px)", ...style }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const startCampaign = () => nav("/access");
  const seeHowItWorks = () => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="ec-brand" style={{ background: BLACK, color: IVORY, fontFamily: UI, minHeight: "100vh" }}>

      {/* ---------- HERO ---------- */}
      <Section style={{ paddingTop: "clamp(64px,11vw,120px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
          <SectionKicker>ElectionCanon</SectionKicker>
          <LanguageSelector />
        </div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(34px,6vw,64px)",
          letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 20px", maxWidth: 900 }}>
          {t("landing.heroHeadline")}
        </h1>
        <p style={{ fontFamily: UI, fontWeight: 700, fontSize: "clamp(15px,2vw,19px)", color: TEAL,
          lineHeight: 1.5, maxWidth: 720, margin: "0 0 20px" }}>
          {t("landing.heroSubheadline")}
        </p>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15.5, maxWidth: 640, lineHeight: 1.7, margin: "0 0 32px" }}>
          {t("landing.heroBody")}
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <CtaButton primary onClick={startCampaign}>{t("landing.ctaStart")}</CtaButton>
          <CtaButton onClick={seeHowItWorks}>{t("landing.ctaHowItWorks")}</CtaButton>
        </div>
      </Section>

      {/* ---------- THE PROBLEM ---------- */}
      <Section>
        <SectionKicker accent={PINK}>{t("landing.problemKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          {t("landing.problemHeading")}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          {PROBLEM_TAGS.map((tagKey) => (
            <div key={tagKey} style={{ fontFamily: UI, fontSize: 13, fontWeight: 700, color: IVORY,
              border: `1px solid ${BORDER}`, padding: "10px 16px" }}>{t(tagKey)}</div>
          ))}
        </div>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 680, lineHeight: 1.7 }}>
          {t("landing.problemBody")}
        </p>
      </Section>

      {/* ---------- THE CANON ---------- */}
      <Section>
        <SectionKicker accent={PINK}>{t("landing.canonKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          {t("landing.canonHeading")}
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 680, lineHeight: 1.7, marginBottom: 28 }}>
          {t("landing.canonBody")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {["landing.chainAction", "landing.chainEvent", "landing.chainRecord", "nav.canon"].map((key, i, arr) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, letterSpacing: "0.08em",
                textTransform: "uppercase", color: IVORY, border: `1px solid ${BORDER}`, padding: "10px 16px" }}>
                {t(key)}
              </div>
              {i < arr.length - 1 && <span style={{ color: MUTED, fontSize: 15 }}>→</span>}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- HOW ELECTIONCANON WORKS ---------- */}
      <Section id="how-it-works">
        <SectionKicker>{t("landing.howItWorksKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          {t("landing.howItWorksHeading")}
        </h2>
        <div style={{ display: "grid", gap: 2 }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.label} style={{ display: "flex", gap: 18, alignItems: "flex-start",
              padding: "16px 0", borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, color: TEAL,
                width: 40, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</div>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 14, color: IVORY, marginBottom: 4 }}>{t(step.label)}</div>
                <div style={{ fontFamily: UI, fontSize: 13.5, color: MUTED, lineHeight: 1.6 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- FROM CAMPAIGN COMMAND TO POLLING UNIT ---------- */}
      <Section>
        <SectionKicker accent={PINK}>{t("landing.hierarchyKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          {t("landing.hierarchyHeading")}
        </h2>
        <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
          {HIERARCHY.map((h, i) => (
            <div key={h.label}>
              <Panel accent={h.accent}>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: h.accent, marginBottom: 8 }}>{t(h.label)}</div>
                <div style={{ fontFamily: UI, fontSize: 13.5, color: "rgba(245,241,233,.82)", lineHeight: 1.6 }}>{h.body}</div>
              </Panel>
              {i < HIERARCHY.length - 1 && (
                <div style={{ textAlign: "center", fontFamily: UI, color: MUTED, fontSize: 18, padding: "6px 0" }}>↓</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- THE CAMPAIGN'S OPERATIONAL WORKSPACE ---------- */}
      <Section>
        <SectionKicker>{t("landing.workspaceKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          {t("landing.workspaceHeading")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          {WORKSPACE_SECTIONS.map((s, i) => (
            <Panel key={s.label} accent={[TEAL, PINK][i % 2]}>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 13, color: IVORY, marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>{s.body}</div>
            </Panel>
          ))}
        </div>
      </Section>

      {/* ---------- THE DIFFERENCE ---------- */}
      <Section>
        <SectionKicker accent={PINK}>The Difference</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          ElectionCanon connects the things that usually stay disconnected.
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 10 }}>
          {DIFFERENCE.map((d, i) => (
            <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 200, flexShrink: 0 }}>
                <Panel accent={d.accent} style={{ height: "100%", boxSizing: "border-box" }}>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: d.accent, marginBottom: 6 }}>{d.label}</div>
                  <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{d.body}</div>
                </Panel>
              </div>
              {i < DIFFERENCE.length - 1 && (
                <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 20, color: MUTED }}>+</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- WHAT EXISTS TODAY ---------- */}
      <Section style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionKicker>{t("landing.existsKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 12px", maxWidth: 760 }}>
          {t("landing.existsHeading")}
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14.5, maxWidth: 680, lineHeight: 1.7, marginBottom: 32 }}>
          This list is the same single source of truth the product's own
          first-run screen reads from. Anything marked <b style={{ color: TEAL }}>simulated</b> is
          real, shipped functionality operating on demonstration data — never an
          official election result.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
              textTransform: "uppercase", color: TEAL, marginBottom: 14 }}>{t("landing.categoryOperational")}</div>
            <div style={{ display: "grid", gap: 2 }}>
              {CAPABILITIES_AVAILABLE_NOW.map((c, i) => (
                <div key={c} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
                  <span style={{ color: TEAL, fontFamily: UI, fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span style={{ fontFamily: UI, fontSize: 12.5, color: "rgba(245,241,233,.85)", lineHeight: 1.6 }}>
                    {c}
                    {isSimulated(c) && (
                      <span style={{ marginLeft: 8, fontFamily: UI, fontWeight: 800, fontSize: 9,
                        letterSpacing: "0.1em", textTransform: "uppercase", color: BLACK, background: AMBER,
                        padding: "2px 6px", whiteSpace: "nowrap" }}>Simulated</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
              textTransform: "uppercase", color: PINK, marginBottom: 14 }}>{t("landing.categoryInDevelopment")}</div>
            <div style={{ display: "grid", gap: 2 }}>
              {CAPABILITIES_COMING_NEXT.map((c, i) => (
                <div key={c} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
                  <span style={{ color: MUTED, fontFamily: UI, fontWeight: 700, flexShrink: 0 }}>○</span>
                  <span style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ---------- ARCHITECTURE ---------- */}
      <Section style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionKicker>{t("landing.architectureKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          {t("landing.architectureHeading")}
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 680, lineHeight: 1.7 }}>
          No screen stores election state on its own. An action — registering
          a candidate, assigning a ward, sending a message — publishes an
          event to an append-only, tenant-scoped log. Every screen is a live
          view over that log, not a cache that can drift out of sync or be
          quietly edited after the fact.
        </p>
      </Section>

      {/* ---------- OPEN SOURCE / COMMUNITY ---------- */}
      <Section>
        <SectionKicker accent={PINK}>{t("landing.openSourceKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          {t("landing.openSourceHeading")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
          <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
            {t("landing.openSourceBody1")}
          </p>
          <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
            {t("landing.openSourceBody2")}
          </p>
        </div>
      </Section>

      {/* ---------- WHO IT IS FOR ---------- */}
      <Section>
        <SectionKicker>{t("landing.whoKicker")}</SectionKicker>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 24 }}>
          {AUDIENCES.map((key, i) => (
            <div key={key} style={{ fontFamily: UI, fontWeight: 700, fontSize: 13.5, color: IVORY,
              borderLeft: `2px solid ${[TEAL, PINK][i % 2]}`, padding: "8px 0 8px 14px" }}>{t(key)}</div>
          ))}
        </div>
        <p style={{ color: "rgba(245,241,233,.65)", fontSize: 13, maxWidth: 680, lineHeight: 1.7 }}>
          {t("landing.nonAffiliation")}
        </p>
      </Section>

      {/* ---------- START ---------- */}
      <Section style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionKicker accent={PINK}>{t("landing.startKicker")}</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(28px,4vw,44px)",
          letterSpacing: "-0.03em", margin: "0 0 16px", maxWidth: 760 }}>
          {t("landing.startHeading")}
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 620, lineHeight: 1.7, marginBottom: 28 }}>
          {t("landing.startBody")}
        </p>
        <CtaButton primary onClick={startCampaign}>{t("landing.ctaStart")}</CtaButton>
      </Section>

      {/* ---------- FOOTER ---------- */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "clamp(28px,5vw,40px) clamp(20px,5vw,60px)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexWrap: "wrap",
          justifyContent: "space-between", gap: 14, fontFamily: UI, fontSize: 12, color: MUTED }}>
          <div>{t("landing.footerCopyright")}</div>
          <a href="https://github.com/electioncanon-commons/electioncanon" target="_blank" rel="noreferrer"
            style={{ color: TEAL, textDecoration: "none", fontWeight: 700 }}>{t("landing.viewSourceCta")}</a>
        </div>
      </footer>
    </div>
  );
}
