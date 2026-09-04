// ============================================================
// ELECTIONCANON — ACCESS (sign in / register)
//
// EXTRACTED FROM fatt-app's shared Access.jsx (Alpha 1.7 standalone
// extraction). The original file served BOTH Forge-A-Truck manufacturing
// registration and ElectionCanon registration from one component,
// branched on a `?product=election` query parameter — because it also
// used a single shared Supabase project's `profiles`/`forge_role`
// schema. This is the Election-only path of that file, with the
// manufacturing branch (the twelve-actor-kind picker, the
// "Join the manufacturing network" copy, the discipline/sector field)
// removed entirely rather than carried in as dead code — every field,
// every validation, every submit behavior on the Election path is
// UNCHANGED from the original.
//
// `role: "engineer"` is still sent on every registration. This is not
// an ElectionCanon concept — it satisfies a Postgres `forge_role` enum
// constraint on the shared `profiles` table this identity system was
// built against (see supabase/migrations/20260813000200_identity.sql in
// the source monorepo this was extracted from). ElectionCanon's own
// actor kind (candidate_campaign / observer_organisation) is a
// completely separate choice, made post-auth in the Welcome screen and
// stored on `campaigns.actor_kind`, never on this shared `profiles` row
// — this fixed value is invisible to a registrant and was invisible in
// the original file too.
//
// PRE-LAUNCH UX CLEANUP PASS — the `displayName` field below feeds
// `profiles.display_name` (a PERSON identity field, read back by
// OrganisationSection.jsx's roster to resolve "who is this member" — see
// that file's own header). It was previously labelled "Campaign /
// organisation name", which a first-time user reasonably read as "the
// name of my campaign" — a DIFFERENT thing, asked again moments later in
// the post-auth Welcome screen's "Workspace name" field (which really is
// `campaigns.name`). Relabelled to "Your name" so the two prompts read as
// two different, real questions rather than the same one asked twice.
//
// ELECTIONCANON 1.1.1 PHASE A — INVITATION-AWARE AUTH HANDOFF. This page
// was the actual gap the design audit found: AcceptInvite.jsx already
// showed the real campaign name correctly, then sent a signed-out invitee
// here — a page extracted from an unrelated manufacturing product with
// zero awareness that an invitation exists. This pass makes it READ (never
// write or clear) the same `electioncanon_pending_invite_token`
// sessionStorage key AcceptInvite.jsx already sets, so a compact "You're
// joining {campaign}" panel can stay visible through the whole auth
// handoff. It does NOT touch when that key is written or cleared —
// AcceptInvite.jsx still writes it, Election.jsx still reads-and-clears it
// after auth to redirect back to /invite/:token — this page is a new,
// read-only observer of an existing mechanism, not a new owner of it.
// Uses the SAME getInvitationPreview() AcceptInvite.jsx already calls — no
// second preview computation, no email ever fetched or shown (this page
// only ever displays the email the VISITOR THEMSELVES just typed into the
// form below, masked, on the post-registration confirmation screen — see
// maskEmail() — never the invitation's own invited_email column, which
// this page never reads).
// ============================================================

import { useState, useEffect } from "react";
import { T } from "../os/forge.js";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useIdentity } from "../os/ForgeIdentity.jsx";
import { getInvitationPreview } from "../domains/election/invitations/read.js";
import { FORGE_CLIPS } from "../os/geometry.js";

const ROLE_LABEL = Object.freeze({
  CONSTITUENCY_LEAD: "Constituency Lead", LGA_COORDINATOR: "LGA Coordinator",
  WARD_COORDINATOR: "Ward Coordinator", POLLING_UNIT_AGENT: "Polling-Unit Agent",
});

/** First 2 + last 2 characters of the local part survive; everything else
 *  becomes bullets. Only ever applied to the email the visitor themselves
 *  just typed into this page's own form — never a value read from the
 *  server. A short local part (<=4 chars) keeps only its first character,
 *  so masking never accidentally reveals the whole thing. */
function maskEmail(email) {
  const at = String(email ?? "").indexOf("@");
  if (at <= 0) return email ?? "";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 4) return `${local[0]}${"•".repeat(Math.max(local.length - 1, 1))}${domain}`;
  const head = local.slice(0, 2);
  const tail = local.slice(-2);
  return `${head}${"•".repeat(Math.max(local.length - 4, 3))}${tail}${domain}`;
}

const { black:BLACK, ivory:IVORY, teal:TEAL, amber:AMBER, pink:PINK,
        surface:SURFACE_T, border:BORDER_T, grey:GREY_T } = T;
const SURFACE=SURFACE_T, BORDER=BORDER_T, MUTED=GREY_T;
const UI="var(--forge-brand-font, 'Poppins', system-ui, sans-serif)";
const DISPLAY="var(--forge-display-font, 'Poppins', system-ui, sans-serif)";
const NG_STATES=["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa",
  "Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo",
  "Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara","Outside Nigeria"];

const label = { fontFamily:UI, fontWeight:600, fontSize:10, letterSpacing:"0.18em",
  textTransform:"uppercase", color:TEAL, display:"block", marginBottom:7 };
const field = { width:"100%", background:BLACK, border:`1px solid ${BORDER}`, color:IVORY,
  fontFamily:UI, fontSize:14, padding:"12px 14px", clipPath:FORGE_CLIPS.buttonSm, outline:"none" };

export default function Access() {
  const { configured, register, signIn, session, requestPasswordReset } = useIdentity();
  const navigate = useNavigate();
  const [mode, setMode] = useState("register");
  const [role] = useState("engineer");
  const [form, setForm] = useState({ email:"", password:"", displayName:"", state:"" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  // ELECTIONCANON 1.1.1 PHASE A — set only when register() itself reports
  // no session was created (see ForgeIdentity.jsx's own header on why that
  // is the honest signal, not an assumption). Cleared on any mode switch
  // so a user who navigates away from the confirmation screen (e.g. to
  // sign in directly, having already confirmed elsewhere) sees the normal
  // form again.
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState("");

  // Read-only peek at the SAME sessionStorage key AcceptInvite.jsx writes
  // and Election.jsx reads-and-clears — this page never writes or removes
  // it, so the existing post-auth redirect-back-to-/invite/:token
  // mechanism is completely unaffected by anything below.
  const [pendingToken] = useState(() => {
    try { return sessionStorage.getItem("electioncanon_pending_invite_token"); }
    catch { return null; }
  });
  const [invitationPreview, setInvitationPreview] = useState(null); // null = none or not loaded yet
  useEffect(() => {
    if (!pendingToken) return;
    let cancelled = false;
    (async () => {
      const { invitation } = await getInvitationPreview({ client: supabase, token: pendingToken });
      if (!cancelled) setInvitationPreview(invitation ?? null);
    })();
    return () => { cancelled = true; };
  }, [pendingToken]);
  const invitationRoleLabel = invitationPreview?.intended_responsibility_role
    ? ROLE_LABEL[invitationPreview.intended_responsibility_role] : "Campaign Director";

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const res = mode === "register"
      ? await register({ ...form, role })
      : await signIn({ email: form.email, password: form.password });
    setBusy(false);
    if (res?.error) { setErr(res.error); return; }
    if (mode === "register") {
      if (res.needsEmailConfirmation) {
        // Honest per ForgeIdentity.jsx's own contract: signUp() itself
        // reported no session, i.e. Supabase genuinely requires (and is
        // sending) a confirmation email — never shown as a guess.
        setConfirmedEmail(form.email);
        setConfirmationPending(true);
      } else {
        // signUp() returned an active session immediately — confirmation
        // is not actually pending, so claiming otherwise would be false.
        // Same destination the sign-in path already navigates to; the
        // pending invite token (if any) is picked up there, unchanged.
        navigate("/election");
      }
    } else {
      navigate("/election");
    }
  }

  function backToForm(nextMode) {
    setConfirmationPending(false);
    setMode(nextMode);
    setErr(null); setMsg(null);
  }

  // PRE-LAUNCH UX CLEANUP PASS (P1-4) — self-service password reset, via
  // Supabase Auth's own resetPasswordForEmail(). The same, single message
  // is shown whether or not the address has an account — anything more
  // specific would let this form be used to check which emails are
  // registered, an account-enumeration leak this project does not accept
  // anywhere else (see the invitation flow's own email-match discipline).
  async function submitForgotPassword(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const res = await requestPasswordReset({ email: form.email });
    setBusy(false);
    if (res?.error) { setErr(res.error); return; }
    setMsg("If an ElectionCanon account exists for that email, a password reset link has been sent. Check your inbox.");
  }

  return (
    <div className="forge-brand" style={{ background:BLACK, color:IVORY, minHeight:"100vh",
      padding:"clamp(28px,5vw,64px)", fontFamily:UI }}>
      <div style={{ maxWidth:1080, margin:"0 auto" }}>

        <div style={{ fontFamily:UI, fontWeight:600, fontSize:10, letterSpacing:"0.2em",
          textTransform:"uppercase", color:TEAL, borderLeft:`2px solid ${TEAL}`,
          paddingLeft:12, marginBottom:18 }}>ElectionCanon</div>

        {pendingToken && invitationPreview ? (
          // ELECTIONCANON 1.1.1 PHASE A — invitation-aware heading. This is
          // the actual fix for "does not feel invitation-first": a visitor
          // who just saw the real campaign name on /invite/:token no longer
          // lands on a page that only ever said "Sign in to ElectionCanon."
          // Same data AcceptInvite.jsx already renders, no second read.
          <div style={{ marginBottom:26, maxWidth:640 }}>
            <div style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.18em",
              textTransform:"uppercase", color:PINK, marginBottom:10 }}>You're joining</div>
            <h1 style={{ fontFamily:DISPLAY, fontWeight:900, fontSize:"clamp(26px,5vw,40px)",
              letterSpacing:"-0.02em", lineHeight:1.05, margin:"0 0 16px", overflowWrap:"anywhere" }}>
              {invitationPreview.campaign_name}
            </h1>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"10px 28px" }}>
              <div style={{ fontFamily:UI, fontSize:13, color:"rgba(245,241,233,0.78)" }}>
                <span style={{ color:MUTED, textTransform:"uppercase", fontSize:10.5, letterSpacing:"0.08em" }}>Responsibility </span>
                {invitationRoleLabel}
              </div>
              {invitationPreview.geography_name && (
                <div style={{ fontFamily:UI, fontSize:13, color:"rgba(245,241,233,0.78)" }}>
                  <span style={{ color:MUTED, textTransform:"uppercase", fontSize:10.5, letterSpacing:"0.08em" }}>Area </span>
                  {invitationPreview.geography_name}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <h1 style={{ fontFamily:DISPLAY, fontWeight:900, fontSize:"clamp(30px,4.6vw,50px)",
              letterSpacing:"-0.03em", lineHeight:0.95, margin:"0 0 12px" }}>
              Sign in to <span style={{ color:PINK }}>ElectionCanon</span>.
            </h1>
            <p style={{ color:"rgba(245,241,233,0.70)", fontSize:15, maxWidth:620, lineHeight:1.6, margin:"0 0 12px" }}>
              ElectionCanon coordinates real election-preparation work. Registration establishes
              who is accountable for that work — the capability you declare here is what your
              campaign or organisation will hold you to.
            </p>
            <p style={{ fontFamily:UI, fontWeight:600, fontSize:11, letterSpacing:"0.06em",
              color:MUTED, maxWidth:620, lineHeight:1.6, margin:"0 0 26px" }}>
              Registration is self-declared. Your workspace and readiness data are visible only to
              your own campaign or organisation, never to another tenant.
            </p>
          </>
        )}

        {!configured && (
          <div style={{ clipPath:FORGE_CLIPS.panelBR, background:"rgba(255,46,99,0.08)",
            border:`1px solid ${PINK}`, padding:"14px 16px", marginBottom:24, maxWidth:720 }}>
            <b style={{ color:PINK, fontSize:12, letterSpacing:"0.1em" }}>DATABASE NOT REACHABLE</b>
            <div style={{ color:"rgba(245,241,233,.8)", fontSize:13, marginTop:6, lineHeight:1.55 }}>
              This deployment has no Supabase credentials, so accounts cannot be created here.
              The form is shown so the flow can be reviewed, but it will not submit.
            </div>
          </div>
        )}

        {confirmationPending ? (
          // ELECTIONCANON 1.1.1 PHASE A — dedicated confirmation-email
          // state, replacing the previous one-line inline banner. Shown
          // ONLY when register() itself reported needsEmailConfirmation —
          // never a fabricated claim (see submit()'s own comment). The
          // email shown is confirmedEmail, captured from the form the
          // visitor themselves just filled in — never a server read of
          // anyone's invited_email — and masked on-screen regardless.
          <div style={{ maxWidth:520 }}>
            <div style={{ background:"#111418", border:`1px solid ${BORDER}`, borderTop:`2px solid ${AMBER}`, padding:"26px 24px" }}>
              <div style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.18em",
                textTransform:"uppercase", color:AMBER, marginBottom:14 }}>Check your email</div>
              <div style={{ fontFamily:UI, fontSize:14, color:"rgba(245,241,233,0.82)", lineHeight:1.6, marginBottom:16 }}>
                We've sent a confirmation email to:
              </div>
              <div style={{ fontFamily:UI, fontWeight:700, fontSize:16, color:IVORY, marginBottom:20, overflowWrap:"anywhere" }}>
                {maskEmail(confirmedEmail)}
              </div>
              {invitationPreview?.campaign_name ? (
                <div style={{ fontFamily:UI, fontSize:14, color:"rgba(245,241,233,0.82)", lineHeight:1.6, marginBottom:22 }}>
                  Confirm your email address to continue joining <strong style={{ color:IVORY }}>{invitationPreview.campaign_name}</strong>.
                </div>
              ) : (
                <div style={{ fontFamily:UI, fontSize:14, color:"rgba(245,241,233,0.82)", lineHeight:1.6, marginBottom:22 }}>
                  Confirm your email address, then sign in to continue.
                </div>
              )}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <a href={`mailto:${confirmedEmail}`}
                  style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase",
                    padding:"13px 20px", background:"transparent", color:IVORY, border:`1px solid ${BORDER}`,
                    clipPath:FORGE_CLIPS.button, textDecoration:"none", display:"inline-block" }}>
                  Open your email
                </a>
                <button type="button" onClick={() => backToForm("signin")}
                  style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase",
                    padding:"13px 20px", border:"none", clipPath:FORGE_CLIPS.button,
                    background:AMBER, color:BLACK, cursor:"pointer" }}>
                  I've confirmed my email
                </button>
              </div>
            </div>
          </div>
        ) : (
        <>
        <div style={{ display:"flex", gap:8, marginBottom:26 }}>
          {["register","signin"].map(m => (
            <button key={m} type="button" onClick={() => backToForm(m)}
              style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.14em",
                textTransform:"uppercase", padding:"11px 20px", cursor:"pointer",
                clipPath:FORGE_CLIPS.button, border:"none",
                background: mode===m ? AMBER : "transparent",
                color: mode===m ? BLACK : MUTED,
                boxShadow: mode===m ? "none" : `inset 0 0 0 1px ${BORDER}` }}>
              {m === "register" ? "Register" : "Sign in"}
            </button>
          ))}
        </div>

        {mode === "forgot" ? (
          <div style={{ maxWidth: 420 }}>
            <span style={label}>Reset your password</span>
            <p style={{ fontFamily: UI, fontSize: 13, color: "rgba(245,241,233,0.75)", lineHeight: 1.6, margin: "0 0 18px" }}>
              Enter the email address on your ElectionCanon account. We'll send a secure link to set a new password.
            </p>
            <form onSubmit={submitForgotPassword}>
              <div style={{ display:"grid", gap:14 }}>
                <label>
                  <span style={label}>Email</span>
                  <input style={field} type="email" value={form.email} onChange={set("email")} required />
                </label>
                {err && <div style={{ color:PINK, fontSize:12.5, fontFamily:UI }}>{err}</div>}
                {msg && <div style={{ color:TEAL, fontSize:12.5, fontFamily:UI }}>{msg}</div>}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="submit" disabled={busy || !configured}
                    style={{ fontFamily:UI, fontWeight:700, fontSize:12.5, letterSpacing:"0.12em",
                      textTransform:"uppercase", padding:"14px 26px", border:"none",
                      clipPath:FORGE_CLIPS.button,
                      background: (busy || !configured) ? BORDER : AMBER,
                      color: (busy || !configured) ? MUTED : BLACK,
                      cursor: (busy || !configured) ? "not-allowed" : "pointer" }}>
                    {busy ? "Sending…" : "Send Reset Link →"}
                  </button>
                  <button type="button" onClick={() => { setMode("signin"); setErr(null); setMsg(null); }}
                    style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.12em",
                      textTransform:"uppercase", padding:"14px 18px", cursor:"pointer",
                      background:"transparent", color:MUTED, border:`1px solid ${BORDER}`,
                      clipPath:FORGE_CLIPS.button }}>
                    ← Back to sign in
                  </button>
                </div>
              </div>
            </form>
          </div>
        ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:28 }}>
          {mode === "register" && (
            <div>
              <span style={label}>What you are registering</span>
              <div style={{ clipPath:FORGE_CLIPS.panelBR, background:SURFACE,
                borderTop:`2px solid ${TEAL}`, padding:"14px 16px" }}>
                <div style={{ fontFamily:UI, fontSize:13, color:"rgba(245,241,233,.82)", lineHeight:1.55 }}>
                  A candidate campaign or an observer/monitoring organisation — you choose which,
                  and set up your workspace, on the next screen once you are signed in.
                </div>
              </div>
            </div>
          )}

          <form onSubmit={submit}>
            <span style={label}>{mode !== "register" ? "Sign in" : "Your details"}</span>
            <div style={{ display:"grid", gap:14, maxWidth:420 }}>
              {mode === "register" && (
                <label>
                  <span style={label}>Your name</span>
                  <input style={field} value={form.displayName} onChange={set("displayName")} required />
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
                    Your own name, or however you'd like to be identified. You'll name your campaign
                    or organisation in the next step, after signing in.
                  </div>
                </label>
              )}
              <label>
                <span style={label}>Email</span>
                <input style={field} type="email" value={form.email} onChange={set("email")} required />
              </label>
              <label>
                <span style={label}>Password</span>
                <input style={field} type="password" minLength={8} value={form.password}
                  onChange={set("password")} required />
                {mode === "signin" && (
                  <button type="button" onClick={() => { setMode("forgot"); setErr(null); setMsg(null); }}
                    style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: TEAL, background: "transparent",
                      border: "none", padding: 0, marginTop: 8, cursor: "pointer", textDecoration: "underline" }}>
                    Forgot password?
                  </button>
                )}
              </label>
              {mode === "register" && (
                <label>
                  <span style={label}>State</span>
                  <select style={field} value={form.state} onChange={set("state")} required>
                    <option value="">Select…</option>
                    {NG_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}

              {err && <div style={{ color:PINK, fontSize:12.5, fontFamily:UI }}>{err}</div>}
              {msg && <div style={{ color:TEAL, fontSize:12.5, fontFamily:UI }}>{msg}</div>}

              <button type="submit" disabled={busy || !configured}
                style={{ fontFamily:UI, fontWeight:700, fontSize:12.5, letterSpacing:"0.12em",
                  textTransform:"uppercase", padding:"14px 26px", border:"none",
                  clipPath:FORGE_CLIPS.button,
                  background: (busy || !configured) ? BORDER : AMBER,
                  color: (busy || !configured) ? MUTED : BLACK,
                  cursor: (busy || !configured) ? "not-allowed" : "pointer" }}>
                {busy ? "Working…" : mode === "register" ? "Register →" : "Sign in →"}
              </button>
              {session && (
                <button type="button" onClick={() => navigate("/election")}
                  style={{ fontFamily:UI, fontWeight:700, fontSize:11, letterSpacing:"0.12em",
                    textTransform:"uppercase", padding:"12px 22px", cursor:"pointer",
                    background:"transparent", color:TEAL, border:`1px solid ${TEAL}`,
                    clipPath:FORGE_CLIPS.button }}>
                  Go to ElectionCanon →
                </button>
              )}
            </div>
          </form>
        </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
