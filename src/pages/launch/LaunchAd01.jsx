// ============================================================
// LAUNCH DISTRIBUTION — /launch/ad01  (Alpha 1.7)
//
// ASSET RECONCILIATION (2026-09-22): the prototype phone-mockup
// component (AD01Chaos.jsx, a CSS-animated fake chat UI) has been
// replaced here with the real, final release video
// (public/launch/ad01-final.mp4, byte-identical to the AD01_FINAL.mp4
// provided as the canonical AD01 asset) -- same script, same "CHAOTIC
// ELECTION OPERATIONS? NO MORE." beat, same electioncanon.org end card,
// now professionally shot rather than simulated. AD01Chaos.jsx itself is
// UNTOUCHED and still exists (still used by the unrelated /ad01-preview
// route) -- this file simply no longer renders it.
// ============================================================

import { useNavigate } from "react-router-dom";
import { LaunchSignupForm, LaunchEyebrow, useLaunchTelemetry, useDocumentTitle,
  BLACK, IVORY, TEAL, MUTED, BORDER, UI, DISPLAY } from "./shared.jsx";

export default function LaunchAd01() {
  const navigate = useNavigate();
  const { sessionId, attribution } = useLaunchTelemetry({ sourceCampaign: "ad01", path: "/launch/ad01", isFilm: true });
  useDocumentTitle("AD01 — Too much noise. No more. — ElectionCanon Alpha 1.7");

  return (
    <div style={{ background: BLACK }}>
      <div style={{ display: "flex", justifyContent: "center", padding: "32px 20px 0" }}>
        <video
          src="/launch/ad01-final.mp4"
          autoPlay muted loop={false} playsInline controls
          style={{ width: "100%", maxWidth: 420, aspectRatio: "9 / 16", background: "#000", border: `1px solid ${BORDER}` }}
        >
          Your browser doesn't support video playback. <a href="/launch/ad01-final.mp4" style={{ color: TEAL }}>Download AD01</a> instead.
        </video>
      </div>
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
