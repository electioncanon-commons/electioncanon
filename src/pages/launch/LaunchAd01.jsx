// ============================================================
// LAUNCH DISTRIBUTION — /launch/ad01  (Alpha 1.7)
//
// AD01Chaos is IMPORTED AND RENDERED ONLY -- never edited. See
// src/pages/AD01Chaos.jsx (the real, live component App.jsx's own
// /ad01-preview route already uses) for the creative itself.
// ============================================================

import { useNavigate } from "react-router-dom";
import AD01Chaos from "../AD01Chaos.jsx";
import { LaunchSignupForm, LaunchEyebrow, useLaunchTelemetry, useDocumentTitle,
  BLACK, IVORY, TEAL, MUTED, BORDER, UI, DISPLAY } from "./shared.jsx";

export default function LaunchAd01() {
  const navigate = useNavigate();
  const { sessionId, attribution } = useLaunchTelemetry({ sourceCampaign: "ad01", path: "/launch/ad01", isFilm: true });
  useDocumentTitle("AD01 — Too much noise. No more. — ElectionCanon Alpha 1.7");

  return (
    <div style={{ background: BLACK }}>
      <AD01Chaos />
      <div style={{ padding: "48px 20px 64px", maxWidth: 640, margin: "0 auto" }}>
        <LaunchEyebrow />
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>
          Part 1 of 3 — The Problem
        </div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,5vw,34px)", color: IVORY, margin: "0 0 14px" }}>
          Coordination by chat is coordination by luck.
        </h1>
        <p style={{ fontFamily: UI, fontSize: 14, color: "rgba(245,241,233,0.7)", lineHeight: 1.6, marginBottom: 28 }}>
          ElectionCanon replaces scattered messages and missed calls with a
          real, accountable operating system. Get the rest of the launch —
          the system behind it, and how to get involved — in your inbox.
        </p>
        <LaunchSignupForm sourceCampaign="ad01" sessionId={sessionId} attribution={attribution} path="/launch/ad01" />
        <div style={{ marginTop: 36, display: "flex", gap: 18, flexWrap: "wrap", borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
          <button onClick={() => navigate("/launch/ad02")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: TEAL, border: "none", cursor: "pointer", padding: 0 }}>
            Next: AD02 — The System →
          </button>
          <button onClick={() => navigate("/launch")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: MUTED, border: "none", cursor: "pointer", padding: 0 }}>
            ← Back to the launch
          </button>
        </div>
      </div>
    </div>
  );
}
