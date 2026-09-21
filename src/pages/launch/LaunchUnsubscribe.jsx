// ============================================================
// LAUNCH DISTRIBUTION — /launch/unsubscribe  (Alpha 1.7)
//
// Every sequence email's real per-subscriber footer link lands here.
// Same shape as LaunchConfirm.jsx. Idempotent -- visiting twice is a
// safe no-op, never an error.
// ============================================================

import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase, isConfigured } from "../../lib/supabase.js";
import { unsubscribeLaunchSubscription } from "../../domains/launch/write.js";
import { BLACK, IVORY, TEAL, PINK, MUTED, BORDER, UI, DISPLAY, LaunchEyebrow, useDocumentTitle } from "./shared.jsx";

export default function LaunchUnsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [result, setResult] = useState(undefined);
  useDocumentTitle("Unsubscribe — ElectionCanon");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setResult({ ok: false, error: "This unsubscribe link is missing a token." }); return; }
      if (!isConfigured) { setResult({ ok: false, error: "Unsubscribe isn't available in this preview (no Supabase project configured)." }); return; }
      const outcome = await unsubscribeLaunchSubscription({ client: supabase, token });
      if (!cancelled) setResult(outcome);
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "48px 20px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <LaunchEyebrow />
        <div style={{ background: "#111418", border: `1px solid ${BORDER}`, borderTop: `2px solid ${result?.ok ? TEAL : PINK}`, padding: "clamp(22px,5vw,32px)" }}>
          {result === undefined ? (
            <div style={{ fontFamily: UI, fontSize: 14, color: MUTED }}>Unsubscribing…</div>
          ) : result.ok ? (
            <>
              <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(20px,4vw,26px)", color: IVORY, margin: "0 0 10px" }}>
                You're unsubscribed
              </h1>
              <p style={{ fontFamily: UI, fontSize: 14, color: "rgba(245,241,233,0.72)", lineHeight: 1.5 }}>
                You won't receive any further launch emails. If you change your mind, you can sign up again anytime.
              </p>
              <Link to="/launch" style={{ display: "inline-block", marginTop: 18, fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: TEAL, textDecoration: "none" }}>
                ← Back to the launch
              </Link>
            </>
          ) : (
            <>
              <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(20px,4vw,26px)", color: IVORY, margin: "0 0 10px" }}>
                Unsubscribe link not valid
              </h1>
              <p style={{ fontFamily: UI, fontSize: 14, color: PINK }}>{result.error}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
