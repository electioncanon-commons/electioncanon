// ============================================================
// LAUNCH DISTRIBUTION — /launch HUB  (Alpha 1.7)
//
// Sequential narrative: AD01 (real, live, /launch/ad01) -> AD02 (no
// creative asset yet, honest "coming soon", /launch/ad02) -> AD03 (same,
// /launch/ad03). This hub links to each stop rather than inlining the
// full AD01Chaos animation -- the full film lives at /launch/ad01 itself
// (see that file), imported unedited from src/pages/AD01Chaos.jsx.
// ============================================================

import { useNavigate } from "react-router-dom";
import { LaunchSignupForm, LaunchEyebrow, useLaunchTelemetry, useDocumentTitle,
  BLACK, IVORY, TEAL, PINK, MUTED, BORDER, UI, DISPLAY } from "./shared.jsx";

const STOPS = [
  { path: "/launch/ad01", eyebrow: "Part 1", title: "AD01 — The Problem", blurb: "Coordination by chat is coordination by luck. Watch the real film.", live: true, accent: TEAL },
  { path: "/launch/ad02", eyebrow: "Part 2", title: "AD02 — The System", blurb: "Rooms read, events write. The architecture behind ElectionCanon.", live: false, accent: PINK },
  { path: "/launch/ad03", eyebrow: "Part 3", title: "AD03 — Open Invitation", blurb: "Alpha 1.7 is open source. Read the code, or join it.", live: false, accent: TEAL },
];

function StopCard({ stop }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(stop.path)}
      style={{ textAlign: "left", cursor: "pointer", width: "100%", background: "#111418",
        border: `1px solid ${BORDER}`, borderTop: `2px solid ${stop.accent}`, padding: "clamp(20px,4vw,26px)" }}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: MUTED, marginBottom: 8 }}>
        {stop.eyebrow} {!stop.live && "· Coming soon"}
      </div>
      <h3 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(18px,3.5vw,22px)", color: IVORY, margin: "0 0 8px" }}>{stop.title}</h3>
      <p style={{ fontFamily: UI, fontSize: 13, color: "rgba(245,241,233,0.65)", lineHeight: 1.5, margin: 0 }}>{stop.blurb}</p>
    </button>
  );
}

export default function Launch() {
  const { sessionId, attribution } = useLaunchTelemetry({ sourceCampaign: "launch", path: "/launch" });
  useDocumentTitle("ElectionCanon Alpha 1.7 — The Launch");

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "48px 20px 64px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <LaunchEyebrow />
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(26px,6vw,42px)", color: IVORY, margin: "0 0 14px", lineHeight: 1.05 }}>
          The problem. The system. The invitation.
        </h1>
        <p style={{ fontFamily: UI, fontSize: 14.5, color: "rgba(245,241,233,0.7)", lineHeight: 1.6, marginBottom: 32, maxWidth: 560 }}>
          Three stops make up the ElectionCanon Alpha 1.7 launch. AD01 is
          live today; AD02 and AD03 are in production and will land in
          these same slots. Sign up once to get all three in your inbox as
          they're ready.
        </p>

        <div style={{ display: "grid", gap: 16, marginBottom: 36 }}>
          {STOPS.map((stop) => <StopCard key={stop.path} stop={stop} />)}
        </div>

        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 28 }}>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 12 }}>
            Get all three
          </div>
          <LaunchSignupForm sourceCampaign="launch" sessionId={sessionId} attribution={attribution} path="/launch" />
        </div>
      </div>
    </div>
  );
}
