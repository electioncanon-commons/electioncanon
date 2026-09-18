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
import { FORGE_CLIPS } from "../os/geometry.js";

// Any AVAILABLE_NOW capability whose own copy says "simulat..." is real and
// shipped, but its DATA is demonstration data, not an official result — flag
// it distinctly rather than let it read identically to a fully-live feature.
const isSimulated = (text) => /simulat/i.test(text);

const WORKFLOW_STEPS = Object.freeze([
  { label: "Election", body: "Choose your election — presidential, senatorial, gubernatorial, and more." },
  { label: "Office", body: "Choose the office you're contesting or observing." },
  { label: "Constituency", body: "Choose your constituency." },
  { label: "Territory", body: "ElectionCanon maps the territory — states and LGAs, ward by ward where authoritative geography data exists." },
  { label: "Organisation", body: "Build your campaign organisation — invite the people who will run it, by email." },
  { label: "Responsibility", body: "Assign responsibility — every coordinator gets a real, recorded territory, not a title." },
  { label: "Readiness", body: "Track readiness as COMPLETE, INCOMPLETE, AT RISK, or UNKNOWN — never a fabricated percentage." },
  { label: "Coordination", body: "Coordinate the work — scoped chat, tasks, and campaign communications." },
  { label: "Election Day", body: "Run election day — polling units, agents, results, and incidents, each attributed to who reported it." },
]);

const HIERARCHY = Object.freeze([
  { label: "Campaign Command", accent: TEAL, body: "The campaign's national coordination room — where the whole organisation stays aligned." },
  { label: "LGA Coordinator", accent: PINK, body: "Responsible for one Local Government Area, with a coordination room scoped to exactly that territory." },
  { label: "Ward Coordinator", accent: TEAL, body: "Responsible for one ward inside their LGA, invited directly by that LGA's own coordinator." },
  { label: "Polling Unit Agent", accent: PINK, body: "Responsible for one polling unit, the front line of election day itself." },
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
  "Candidate campaigns", "Campaign directors", "Field coordinators",
  "Volunteers", "Observer / monitoring organisations", "Election operations teams",
]);

function CtaButton({ children, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: UI, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.12em", textTransform: "uppercase",
      padding: "15px 26px", cursor: "pointer", clipPath: FORGE_CLIPS.button,
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
  const startCampaign = () => nav("/access");
  const seeHowItWorks = () => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="forge-brand" style={{ background: BLACK, color: IVORY, fontFamily: UI, minHeight: "100vh" }}>

      {/* ---------- HERO ---------- */}
      <Section style={{ paddingTop: "clamp(64px,11vw,120px)" }}>
        <SectionKicker>ElectionCanon</SectionKicker>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(34px,6vw,64px)",
          letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 20px", maxWidth: 900 }}>
          The operating system for running an election campaign.
        </h1>
        <p style={{ fontFamily: UI, fontWeight: 700, fontSize: "clamp(15px,2vw,19px)", color: TEAL,
          lineHeight: 1.5, maxWidth: 720, margin: "0 0 20px" }}>
          From campaign command to polling unit, everyone knows what they are
          responsible for, where they are responsible, and what still needs
          to be done.
        </p>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15.5, maxWidth: 640, lineHeight: 1.7, margin: "0 0 32px" }}>
          ElectionCanon replaces fragmented campaign coordination — scattered
          chats, calls, and spreadsheets — with one accountable operational
          system: territory, organisation, responsibility, readiness, and
          coordination, all built on a single event-sourced record that
          every screen reads from.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <CtaButton primary onClick={startCampaign}>Start a Campaign →</CtaButton>
          <CtaButton onClick={seeHowItWorks}>See How It Works →</CtaButton>
        </div>
      </Section>

      {/* ---------- THE PROBLEM ---------- */}
      <Section>
        <SectionKicker accent={PINK}>The Problem</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          Campaign coordination is usually scattered across a dozen different places.
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          {["WhatsApp groups", "Phone calls", "Spreadsheets", "Scattered volunteers",
            "Unclear responsibility", "Unknown territory coverage", "Last-minute mobilisation"].map((t) => (
            <div key={t} style={{ fontFamily: UI, fontSize: 13, fontWeight: 700, color: IVORY,
              border: `1px solid ${BORDER}`, padding: "10px 16px" }}>{t}</div>
          ))}
        </div>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 680, lineHeight: 1.7 }}>
          None of this means a campaign isn't working hard — it means the
          work has nowhere shared to live. ElectionCanon is the
          infrastructure that brings it together: one record everyone in
          the campaign can trust, instead of a dozen scattered ones nobody
          fully sees.
        </p>
      </Section>

      {/* ---------- THE CANON ---------- */}
      <Section>
        <SectionKicker accent={PINK}>The Canon</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          Every action leaves a record.
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 680, lineHeight: 1.7, marginBottom: 28 }}>
          ElectionCanon calls this record the Canon — a single, tenant-isolated
          history that every screen reads from and every action writes to.
          Assign a ward. Report readiness. Send a message. Each becomes a
          permanent, attributed fact, not a claim that quietly disappears
          into someone's phone.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {["Action", "Event", "Record", "Canon"].map((step, i, arr) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, letterSpacing: "0.08em",
                textTransform: "uppercase", color: IVORY, border: `1px solid ${BORDER}`, padding: "10px 16px" }}>
                {step}
              </div>
              {i < arr.length - 1 && <span style={{ color: MUTED, fontSize: 15 }}>→</span>}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- HOW ELECTIONCANON WORKS ---------- */}
      <Section id="how-it-works">
        <SectionKicker>How ElectionCanon Works</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          From election to election day, in one continuous system.
        </h2>
        <div style={{ display: "grid", gap: 2 }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.label} style={{ display: "flex", gap: 18, alignItems: "flex-start",
              padding: "16px 0", borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, color: TEAL,
                width: 40, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</div>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 14, color: IVORY, marginBottom: 4 }}>{step.label}</div>
                <div style={{ fontFamily: UI, fontSize: 13.5, color: MUTED, lineHeight: 1.6 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- FROM CAMPAIGN COMMAND TO POLLING UNIT ---------- */}
      <Section>
        <SectionKicker accent={PINK}>From Campaign Command to Polling Unit</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          Every person gets a real operational responsibility — not just another name in a group chat.
        </h2>
        <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
          {HIERARCHY.map((h, i) => (
            <div key={h.label}>
              <Panel accent={h.accent}>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: h.accent, marginBottom: 8 }}>{h.label}</div>
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
        <SectionKicker>Campaign Studio</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 32px", maxWidth: 760 }}>
          Everything the campaign needs, in one operational workspace.
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
        <SectionKicker>What Exists Today</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 12px", maxWidth: 760 }}>
          Operational, simulated, and in development — never blurred together.
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
              textTransform: "uppercase", color: TEAL, marginBottom: 14 }}>Operational</div>
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
              textTransform: "uppercase", color: PINK, marginBottom: 14 }}>In Development</div>
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
        <SectionKicker>Architecture</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          Rooms read. Events write.
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
        <SectionKicker accent={PINK}>Open Source</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
          letterSpacing: "-0.03em", margin: "0 0 22px", maxWidth: 760 }}>
          Inspect the machine.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
          <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
            ElectionCanon is licensed under AGPL-3.0 — read it, run it
            locally, question it, and improve it. Election infrastructure
            should be inspectable by the people who rely on it, not a black
            box.
          </p>
          <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
            <b style={{ color: IVORY }}>Build with us.</b> An independent,
            ElectionCanon-controlled public repository is now live. Read it,
            run it locally, question it, and contribute as the project
            develops.
          </p>
        </div>
      </Section>

      {/* ---------- WHO IT IS FOR ---------- */}
      <Section>
        <SectionKicker>Who It Is For</SectionKicker>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 24 }}>
          {AUDIENCES.map((a, i) => (
            <div key={a} style={{ fontFamily: UI, fontWeight: 700, fontSize: 13.5, color: IVORY,
              borderLeft: `2px solid ${[TEAL, PINK][i % 2]}`, padding: "8px 0 8px 14px" }}>{a}</div>
          ))}
        </div>
        <p style={{ color: "rgba(245,241,233,.65)", fontSize: 13, maxWidth: 680, lineHeight: 1.7 }}>
          ElectionCanon does not run for or against any party or candidate,
          and its use implies no endorsement by, or affiliation with, any
          electoral authority or government body.
        </p>
      </Section>

      {/* ---------- START ---------- */}
      <Section style={{ borderTop: `1px solid ${BORDER}` }}>
        <SectionKicker accent={PINK}>Start</SectionKicker>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(28px,4vw,44px)",
          letterSpacing: "-0.03em", margin: "0 0 16px", maxWidth: 760 }}>
          Create your ElectionCanon campaign.
        </h2>
        <p style={{ color: "rgba(245,241,233,.75)", fontSize: 15, maxWidth: 620, lineHeight: 1.7, marginBottom: 28 }}>
          Create an account, establish your campaign, select your election,
          office, and constituency, and begin building your organisation —
          from campaign command down to the polling unit.
        </p>
        <CtaButton primary onClick={startCampaign}>Start a Campaign →</CtaButton>
      </Section>

      {/* ---------- FOOTER ---------- */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "clamp(28px,5vw,40px) clamp(20px,5vw,60px)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexWrap: "wrap",
          justifyContent: "space-between", gap: 14, fontFamily: UI, fontSize: 12, color: MUTED }}>
          <div>ElectionCanon — open source under AGPL-3.0.</div>
          <a href="https://github.com/electioncanon-commons/electioncanon" target="_blank" rel="noreferrer"
            style={{ color: TEAL, textDecoration: "none", fontWeight: 700 }}>View source on GitHub →</a>
        </div>
      </footer>
    </div>
  );
}
