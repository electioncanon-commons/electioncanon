// ============================================================
// ELECTIONCANON — ACCEPT INVITATION
//
// Public route (/invite/:token) — must render a useful preview even for a
// signed-out visitor, since accepting a new person is the whole point.
// Reads via get_invitation_preview() (SECURITY DEFINER, deliberately never
// exposes the token or email — see the migration's own header). Writes via
// accept_campaign_invitation(), the same privileged path every other
// campaign-membership write in this project already uses.
//
// ELECTIONCANON 1.1.1 PHASE A — CAMPAIGN-FIRST HIERARCHY. The campaign
// name is now the dominant visual identity on this page (design-audit
// finding: campaigns.name was ALWAYS the right field and was ALWAYS wired
// in correctly here — the real gap was the auth handoff losing this
// context, not this page itself; see Access.jsx's own header). Responsibility
// and area are now their own explicitly-labeled sections (previously one
// combined line), and "Invited by" renders only when the inviter's real
// display name exists (get_invitation_preview()'s invited_by_name column,
// now resolved from auth.users.raw_user_meta_data — see that migration's
// own header) — never a raw id, never an email. This page still shows NO
// email of any kind, unauthenticated or otherwise — see the migration's
// own header on why that posture is preserved.
//
// ELECTIONCANON 1.1.1 UX REFINEMENT PASS — campaign_name is now run
// through parseCampaignTitle() (shared.jsx's own existing helper — the
// SAME one HomeSection.jsx already uses for the identical "[ElectionType]
// Name" artifact, and the SAME logic contract.mjs already mirrors for the
// invitation email) before display, so "[Governorship] Rock Governor Lag
// Campaign" reads as "Rock Governor Lag Campaign" with GOVERNORSHIP shown
// as its own small metadata tag — never a second campaign-name parser,
// never a write to campaigns.name itself. Heading scale reduced from
// clamp(24px,6vw,34px) to clamp(22px,4.5vw,32px) — still bold DISPLAY-font
// editorial type, just proportionate to a page that stacks several context
// lines above the fold.
// ============================================================

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useIdentity } from "../os/ForgeIdentity.jsx";
import { getInvitationPreview } from "../domains/election/invitations/read.js";
import { acceptInvitation } from "../domains/election/invitations/write.js";
import { UI, DISPLAY, BLACK, IVORY, TEAL, AMBER, PINK, MUTED, BORDER, parseCampaignTitle } from "./election/shared.jsx";

const ROLE_LABEL = Object.freeze({
  CONSTITUENCY_LEAD: "Constituency Lead", LGA_COORDINATOR: "LGA Coordinator",
  WARD_COORDINATOR: "Ward Coordinator", POLLING_UNIT_AGENT: "Polling-Unit Agent",
});

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { session, loading: identityLoading } = useIdentity();
  const [invitation, setInvitation] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [partialSuccess, setPartialSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { invitation: inv, error: previewError } = await getInvitationPreview({ client: supabase, token });
      if (cancelled) return;
      if (previewError) { setError(previewError); setInvitation(null); return; }
      setInvitation(inv);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const goToAuth = (path) => {
    try { sessionStorage.setItem("electioncanon_pending_invite_token", token); } catch { /* best effort */ }
    navigate(path);
  };

  const accept = async () => {
    setBusy(true); setError(null);
    const displayName = invitation?.invited_name ?? null;
    const { accepted, error: acceptError } = await acceptInvitation({ client: supabase, token, displayName });
    setBusy(false);
    if (!accepted) { setError(acceptError); return; }
    try { sessionStorage.removeItem("electioncanon_pending_invite_token"); } catch { /* best effort */ }
    if (acceptError) {
      // Membership was created (accepted === true) but a later step -- the
      // roster entry or the territory/responsibility assignment -- failed
      // (e.g. someone else already holds that exact geography slot). This
      // is recoverable, never a security concern, and must never be
      // silently swallowed just because the primary membership grant
      // succeeded -- see acceptInvitation()'s own header on this.
      setError(acceptError);
      setPartialSuccess(true);
      return;
    }
    navigate("/election?welcome=1");
  };

  const roleLabel = invitation?.intended_responsibility_role ? ROLE_LABEL[invitation.intended_responsibility_role] : "Campaign Director";
  const { name: campaignName, electionType } = parseCampaignTitle(invitation?.campaign_name);
  const electionMeta = electionType
    ? `${electionType.toUpperCase()}${invitation?.geography_state_name ? ` · ${invitation.geography_state_name.toUpperCase()}` : ""}`
    : null;

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "48px 20px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase",
          color: TEAL, borderLeft: `2px solid ${PINK}`, paddingLeft: 12, marginBottom: 20 }}>ElectionCanon</div>

        {invitation === undefined ? (
          <div style={{ fontFamily: UI, fontSize: 14, color: MUTED }}>Loading invitation…</div>
        ) : invitation === null ? (
          <div style={{ fontFamily: UI, fontSize: 14, color: PINK }}>This invitation link is not valid.</div>
        ) : (
          <div style={{ background: "#111418", border: `1px solid ${BORDER}`, borderTop: `2px solid ${TEAL}`, padding: "clamp(22px,5vw,32px) clamp(18px,5vw,28px)" }}>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: PINK, marginBottom: 10 }}>
              You've been invited
            </div>
            <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(22px,4.5vw,32px)", lineHeight: 1.1, color: IVORY, margin: "0 0 6px", overflowWrap: "anywhere" }}>
              {campaignName}
            </h1>
            {electionMeta && (
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em", color: TEAL, marginBottom: 10 }}>
                {electionMeta}
              </div>
            )}
            <div style={{ fontFamily: UI, fontSize: 14, color: "rgba(245,241,233,0.72)", lineHeight: 1.5, marginBottom: 22 }}>
              has invited you to join its campaign workspace on ElectionCanon.
            </div>

            {invitation.invited_by_name && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: UI, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>Invited by</div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 15, color: IVORY }}>{invitation.invited_by_name}</div>
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 32px", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: UI, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>Your responsibility</div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 16, color: IVORY }}>{roleLabel}</div>
              </div>
              <div>
                <div style={{ fontFamily: UI, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>Your area</div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 16, color: IVORY }}>{invitation.geography_name ?? "Campaign-wide"}</div>
              </div>
            </div>

            {invitation.status !== "pending" ? (
              <div style={{ fontFamily: UI, fontSize: 13, color: AMBER, marginTop: 8 }}>
                This invitation is {invitation.status} and can no longer be accepted.
              </div>
            ) : identityLoading ? (
              <div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Checking your session…</div>
            ) : !session ? (
              <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => goToAuth("/access")}
                  style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                    padding: "13px 20px", border: "none", background: AMBER, color: BLACK, cursor: "pointer" }}>
                  Create ElectionCanon Account
                </button>
                <button onClick={() => goToAuth("/access")}
                  style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                    padding: "13px 20px", background: "transparent", color: IVORY, border: `1px solid ${BORDER}`, cursor: "pointer" }}>
                  Sign In
                </button>
              </div>
            ) : partialSuccess ? (
              <button onClick={() => navigate("/election")}
                style={{ marginTop: 20, fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "14px 24px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>
                Continue to ElectionCanon →
              </button>
            ) : (
              <button onClick={accept} disabled={busy}
                style={{ marginTop: 20, fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "14px 24px", border: "none", background: busy ? BORDER : TEAL, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Accepting…" : "Accept Invitation"}
              </button>
            )}
            {partialSuccess && (
              <div style={{ fontFamily: UI, fontSize: 12.5, color: AMBER, marginTop: 14 }}>
                You have joined the campaign, but your territory assignment could not be completed automatically. Contact your campaign owner to finish it.
              </div>
            )}
            {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 14 }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
