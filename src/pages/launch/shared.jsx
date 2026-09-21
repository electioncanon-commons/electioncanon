// ============================================================
// LAUNCH DISTRIBUTION — SHARED UI  (Alpha 1.7)
//
// Reuses the existing design tokens from src/pages/election/shared.jsx
// (BLACK/IVORY/TEAL/PINK/AMBER/UI/DISPLAY) rather than inventing a second
// visual identity for the public launch surfaces -- same discipline
// AcceptInvite.jsx already follows outside the authenticated app shell.
//
// isConfigured (src/lib/supabase.js) gates every write here honestly:
// in demo mode (no Supabase env configured) the signup form says so
// plainly instead of pretending to submit -- same contract every other
// data-writing surface in this codebase already follows.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { supabase, isConfigured } from "../../lib/supabase.js";
import { subscribeToLaunch, recordLaunchEvent } from "../../domains/launch/write.js";
import { getOrCreateSessionId, captureAttributionFromSearch } from "../../domains/launch/attribution.js";
import { BLACK, IVORY, TEAL, PINK, AMBER, MUTED, BORDER, UI, DISPLAY } from "../election/shared.jsx";

export { BLACK, IVORY, TEAL, PINK, AMBER, MUTED, BORDER, UI, DISPLAY };

export const SOURCE_CAMPAIGNS = Object.freeze(["ad01", "ad02", "ad03", "launch"]);

/**
 * Captures session id + referral/UTM attribution on mount, and records
 * `landing_page_visit` (or `referral_visit` when a `ref` param brought
 * the visitor here) once per mount -- plus `film_view` only when
 * `isFilm` is true, since AD01 is the only stop with a real film today.
 * Never throws: a failed analytics write must never block the page it
 * describes (see domains/launch/write.js's own header).
 */
export function useLaunchTelemetry({ sourceCampaign, path, isFilm = false }) {
  const [sessionId] = useState(() => getOrCreateSessionId());
  const [attribution, setAttribution] = useState(() => ({ referralId: null, utmSource: null, utmMedium: null, utmCampaign: null }));
  const fired = useRef(false);

  useEffect(() => {
    const attr = captureAttributionFromSearch(typeof window !== "undefined" ? window.location.search : "");
    setAttribution(attr);
    if (fired.current) return;
    fired.current = true;
    const client = isConfigured ? supabase : null;
    recordLaunchEvent({
      client, eventType: attr.referralId ? "referral_visit" : "landing_page_visit",
      sourceCampaign, referralId: attr.referralId, utmSource: attr.utmSource, utmMedium: attr.utmMedium, utmCampaign: attr.utmCampaign,
      sessionId, path,
    });
    if (isFilm) {
      recordLaunchEvent({
        client, eventType: "film_view", sourceCampaign, referralId: attr.referralId,
        utmSource: attr.utmSource, utmMedium: attr.utmMedium, utmCampaign: attr.utmCampaign, sessionId, path,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { sessionId, attribution };
}

/** Fire-and-forget click tracker for outbound links (GitHub, social) -- never blocks navigation. */
export function trackOutboundClick({ eventType, sourceCampaign, sessionId, attribution, path }) {
  const client = isConfigured ? supabase : null;
  recordLaunchEvent({
    client, eventType, sourceCampaign, referralId: attribution?.referralId ?? null,
    utmSource: attribution?.utmSource ?? null, utmMedium: attribution?.utmMedium ?? null, utmCampaign: attribution?.utmCampaign ?? null,
    sessionId, path,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LaunchSignupForm({ sourceCampaign, sessionId, attribution, path }) {
  const [email, setEmail] = useState("");
  const [consented, setConsented] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (!consented) { setError("Please check the box to consent to receiving launch updates."); return; }
    if (!isConfigured) { setStatus("demo"); return; }

    setStatus("submitting");
    const { ok, error: subError } = await subscribeToLaunch({
      client: supabase, email: email.trim(), sourceCampaign, referralId: attribution?.referralId ?? null,
    });
    if (!ok) { setStatus("error"); setError(subError || "Something went wrong. Please try again."); return; }

    recordLaunchEvent({
      client: supabase, eventType: "email_signup", sourceCampaign, referralId: attribution?.referralId ?? null,
      utmSource: attribution?.utmSource ?? null, utmMedium: attribution?.utmMedium ?? null, utmCampaign: attribution?.utmCampaign ?? null,
      sessionId, path,
    });
    setStatus("success");
  };

  if (status === "success") {
    return (
      <div style={{ fontFamily: UI, fontSize: 14, color: TEAL, fontWeight: 700 }}>
        Check your inbox to confirm your subscription — nothing is sent until you do.
      </div>
    );
  }
  if (status === "demo") {
    return (
      <div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>
        Signups aren't live in this preview (no Supabase project configured).
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" required
        style={{ fontFamily: UI, fontSize: 14, padding: "12px 14px", background: "#111418",
          border: `1px solid ${BORDER}`, color: IVORY, outline: "none" }}
      />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)}
          style={{ marginTop: 2 }} />
        <span>I consent to ElectionCanon storing my email to send Alpha 1.7 launch updates. Unsubscribe anytime.</span>
      </label>
      <button type="submit" disabled={status === "submitting"}
        style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "13px 20px", border: "none", background: status === "submitting" ? BORDER : AMBER,
          color: BLACK, cursor: status === "submitting" ? "not-allowed" : "pointer" }}>
        {status === "submitting" ? "Submitting…" : "Get Launch Updates"}
      </button>
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK }}>{error}</div>}
    </form>
  );
}

export function ComingSoonCard({ eyebrow, title, blurb }) {
  return (
    <div style={{ background: "#111418", border: `1px solid ${BORDER}`, borderTop: `2px solid ${MUTED}`, padding: "clamp(20px,4vw,28px)" }}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: MUTED, marginBottom: 8 }}>
        {eyebrow} · Coming soon
      </div>
      <h3 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(18px,3.5vw,24px)", color: IVORY, margin: "0 0 8px" }}>{title}</h3>
      <p style={{ fontFamily: UI, fontSize: 13.5, color: "rgba(245,241,233,0.65)", lineHeight: 1.5, margin: 0 }}>{blurb}</p>
    </div>
  );
}

export function LaunchEyebrow() {
  return (
    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase",
      color: TEAL, borderLeft: `2px solid ${PINK}`, paddingLeft: 12, marginBottom: 20 }}>
      ElectionCanon — Alpha 1.7 Launch
    </div>
  );
}

/** Sets document.title for the life of the mounted route -- SPA-level only, no server-rendered OG tags exist for these routes. */
export function useDocumentTitle(title) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}
