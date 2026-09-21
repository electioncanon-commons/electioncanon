// ============================================================
// LAUNCH DISTRIBUTION — /launch/ad03  (Alpha 1.7)
//
// NO AD03 CREATIVE ASSET EXISTS IN THIS REPOSITORY -- same "coming
// soon" discipline as /launch/ad02. Content here draws from README.md's
// real AGPL-3.0/open-source positioning and the real, live GitHub URL
// (the same one Landing.jsx's own footer already links to), never an
// invented claim.
//
// GITHUB_CLICK IS THE ONLY OUTBOUND-CLICK TRACKING WIRED HERE. No real
// social media account for ElectionCanon exists anywhere in this
// codebase -- inventing one to demo "social_click" tracking would be
// exactly the kind of fabricated claim this project's own discipline
// (Landing.jsx's header) forbids. social_click is a supported event
// type in the schema and ready to fire the moment a real social link
// exists; see this project's docs/WHATSAPP.md for the same
// "documented, not implemented" posture applied to another channel.
// ============================================================

import { useNavigate } from "react-router-dom";
import { LaunchSignupForm, ComingSoonCard, LaunchEyebrow, useLaunchTelemetry, useDocumentTitle, trackOutboundClick,
  BLACK, IVORY, TEAL, PINK, MUTED, BORDER, UI, DISPLAY } from "./shared.jsx";

const GITHUB_URL = "https://github.com/electioncanon-commons/electioncanon";

export default function LaunchAd03() {
  const navigate = useNavigate();
  const { sessionId, attribution } = useLaunchTelemetry({ sourceCampaign: "ad03", path: "/launch/ad03" });
  useDocumentTitle("AD03 — Open Source. Open Invitation. — ElectionCanon Alpha 1.7");

  const onGithubClick = () => trackOutboundClick({ eventType: "github_click", sourceCampaign: "ad03", sessionId, attribution, path: "/launch/ad03" });

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "48px 20px 64px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <LaunchEyebrow />
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>
          Part 3 of 3 — Alpha 1.7 / Open Source
        </div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,5vw,34px)", color: IVORY, margin: "0 0 14px" }}>
          Open source. Open invitation.
        </h1>
        <p style={{ fontFamily: UI, fontSize: 14, color: "rgba(245,241,233,0.7)", lineHeight: 1.6, marginBottom: 22 }}>
          ElectionCanon Alpha 1.7 is licensed AGPL-3.0 and published in the
          open — the source, the migrations, and the RLS policies are all
          public. If you build, audit, or run civic-tech software, read the
          code, file an issue, or run it yourself.
        </p>

        <a href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={onGithubClick}
          style={{ display: "inline-block", marginBottom: 28, fontFamily: UI, fontWeight: 700, fontSize: 12,
            letterSpacing: "0.08em", textTransform: "uppercase", padding: "13px 22px", border: `1px solid ${TEAL}`,
            color: TEAL, textDecoration: "none" }}>
          View source on GitHub →
        </a>

        <div style={{ marginBottom: 28 }}>
          <ComingSoonCard eyebrow="AD03" title="The invitation — film in production"
            blurb="Our AD03 film hasn't been made yet. This page will carry it the moment it's ready — the open-source invitation above is real today." />
        </div>

        <LaunchSignupForm sourceCampaign="ad03" sessionId={sessionId} attribution={attribution} path="/launch/ad03" />

        <div style={{ marginTop: 36, display: "flex", gap: 18, flexWrap: "wrap", borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
          <button onClick={() => navigate("/launch/ad02")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: MUTED, border: "none", cursor: "pointer", padding: 0 }}>
            ← AD02 — The System
          </button>
          <button onClick={() => navigate("/launch")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "transparent", color: PINK, border: "none", cursor: "pointer", padding: 0 }}>
            ← Back to the launch
          </button>
        </div>
      </div>
    </div>
  );
}
