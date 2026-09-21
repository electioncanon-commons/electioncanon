// ============================================================
// LAUNCH DISTRIBUTION — /launch/ad02  (Alpha 1.7)
//
// NO AD02 CREATIVE ASSET EXISTS IN THIS REPOSITORY. This is an honest
// "coming soon" stop, not a fabricated preview -- see /launch's own
// header and docs/ARCHITECTURE.md for the same discipline. Real content
// here draws from ARCHITECTURE.md's actual "Rooms read, events write"
// description, never an invented claim about a film that doesn't exist.
// ============================================================

import { useNavigate } from "react-router-dom";
import { LaunchSignupForm, ComingSoonCard, LaunchEyebrow, useLaunchTelemetry, useDocumentTitle,
  BLACK, IVORY, TEAL, MUTED, BORDER, UI, DISPLAY } from "./shared.jsx";

export default function LaunchAd02() {
  const navigate = useNavigate();
  const { sessionId, attribution } = useLaunchTelemetry({ sourceCampaign: "ad02", path: "/launch/ad02" });
  useDocumentTitle("AD02 — The System — ElectionCanon Alpha 1.7");

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "48px 20px 64px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <LaunchEyebrow />
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>
          Part 2 of 3 — The System
        </div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,5vw,34px)", color: IVORY, margin: "0 0 14px" }}>
          Rooms read, events write.
        </h1>
        <p style={{ fontFamily: UI, fontSize: 14, color: "rgba(245,241,233,0.7)", lineHeight: 1.6, marginBottom: 22 }}>
          Every action in ElectionCanon publishes an immutable event to a
          shared, tenant-scoped log — nothing is cached client-side, and
          every write that matters goes through an explicit PREPARE, then a
          human APPROVE, then EXECUTE. No silent writes, including from any
          AI-driven action.
        </p>

        <div style={{ marginBottom: 28 }}>
          <ComingSoonCard eyebrow="AD02" title="The System — film in production"
            blurb="Our AD02 film hasn't been made yet. This page will carry it the moment it's ready — the architecture above is real today, and you can read it in full in this project's own docs." />
        </div>

        <LaunchSignupForm sourceCampaign="ad02" sessionId={sessionId} attribution={attribution} path="/launch/ad02" />

        <div style={{ marginTop: 36, display: "flex", gap: 18, flexWrap: "wrap", borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
          <button onClick={() => navigate("/launch/ad03")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: TEAL, border: "none", cursor: "pointer", padding: 0 }}>
            Next: AD03 — Open Invitation →
          </button>
          <button onClick={() => navigate("/launch/ad01")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: MUTED, border: "none", cursor: "pointer", padding: 0 }}>
            ← AD01 — The Problem
          </button>
        </div>
      </div>
    </div>
  );
}
