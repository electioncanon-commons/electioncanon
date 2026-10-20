// ============================================================
// OUTREACH ACTIVATION — LAUNCH CONTROL ROOM  (Phase 4)
//
// Admin-only. Mounted at /launch/outreach (see App.jsx), but NOT part of
// the public launch funnel in src/pages/launch/ -- it shares none of
// that funnel's components, state, or data. See
// src/domains/outreach/model.js's own header for the full separation
// reasoning.
//
// ACCESS CONTROL. There is no Supabase Auth "product owner" role
// anywhere in this project (election tenant roles are a different
// concept entirely) -- this page gates itself the same way
// launch-invite-audience/launch-send-campaign-email already gate their
// own owner-only actions: a shared secret (OUTREACH_ADMIN_SECRET),
// entered here and held ONLY in this component's React state for the
// life of the tab. It is never written to localStorage/sessionStorage,
// never logged, and is cleared on refresh -- re-entering it each session
// is the deliberate cost of not inventing a second auth system for one
// admin surface. If this tool graduates to daily use, a real
// Supabase-Auth-backed admin role would be the next step -- not done here.
//
// ACTIONABLE QUEUES, NOT DECORATIVE METRIC CARDS (Phase 4's own
// instruction). Every section below is a real, filtered list of actual
// contact rows -- never a static-looking count with nothing behind it.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "../../lib/supabase.js";
import { BLACK, IVORY, TEAL, PINK, AMBER, MUTED, BORDER, UI, DISPLAY } from "../election/shared.jsx";
import {
  SECTOR, SECTOR_LABEL, PIPELINE_STATUS_LABEL, STATUS_TRANSITIONS,
  computeFollowUpEligibility, validateContact, defaultContactFor,
} from "../../domains/outreach/model.js";
import { ASSET_CODE, ASSET_LABEL, defaultAssetCodeForContact, renderAsset } from "../../domains/outreach/assets.js";
import { FOLLOWUP_TRANSITIONS } from "../../domains/outreach/followup.js";
import { parseImportRows } from "../../domains/outreach/import.js";
import { planHistoricalReconciliation } from "../../domains/outreach/historicalImport.js";
import {
  summarizeBySector, summarizeByLetterVersion, summarizeByAsset,
  listByEngagementFlag, listByConversationInterest, channelCoverageNote,
} from "../../domains/outreach/learning.js";
import {
  listOutreachContacts, listOutreachFollowUps, createOutreachContact, reconcileHistoricalImport,
  updateOutreachContactStatus, createOutreachFollowUp, transitionOutreachFollowUp,
  listOutreachMessageEvents, recordOutreachMessageEvent,
  getGmailConnectionStatus, getGmailAuthUrl, verifyGmailSendAs, sendOutreachGmailMessage,
} from "../../domains/outreach/write.js";
import { getLaunchSummary } from "../../domains/launch/write.js";
import { computeActivitySummary, buildManualAttestationIdempotencyKey } from "../../domains/outreach/messageActivity.js";
import { buildBrandedEmail } from "../../domains/outreach/composer.js";

const panelStyle = { background: "#111418", border: `1px solid ${BORDER}`, padding: 20, marginBottom: 20 };
const headingStyle = { fontFamily: DISPLAY, fontWeight: 900, fontSize: 16, color: IVORY, margin: "0 0 12px" };
const labelStyle = { fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED };
const inputStyle = { fontFamily: UI, fontSize: 13, padding: "9px 11px", background: "#0A0C0F", border: `1px solid ${BORDER}`, color: IVORY, outline: "none" };
const buttonStyle = (active = true) => ({
  fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "9px 14px", border: "none", background: active ? AMBER : BORDER, color: BLACK,
  cursor: active ? "pointer" : "not-allowed",
});

// The eight actionable queues Phase 4 asks for, each a filter over real contacts.
const QUEUES = [
  { key: "followUpNow", label: "Follow-up now", filter: (c, now) => computeFollowUpEligibility(c, now).eligible },
  { key: "acknowledgedWaiting", label: "Acknowledged — waiting", filter: (c) => c.engagementStatus === "ACKNOWLEDGED" && !["RESPONDED", "CONVERSATION", "DEMO", "PUBLISHED", "DECLINED"].includes(c.status) },
  { key: "responded", label: "Responded", filter: (c) => c.status === "RESPONDED" },
  { key: "demoRequested", label: "Demo requested", filter: (c) => c.status === "DEMO" },
  { key: "conversation", label: "Conversation", filter: (c) => c.status === "CONVERSATION" },
  { key: "noResponse", label: "No response", filter: (c) => c.status === "NO_RESPONSE" },
  { key: "bounced", label: "Bounced", filter: (c) => c.status === "BOUNCED" },
  { key: "declined", label: "Declined", filter: (c) => c.status === "DECLINED" },
];

export default function OutreachControlRoom() {
  const [secretInput, setSecretInput] = useState("");
  const [secret, setSecret] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("board"); // board | contacts | import | learning | activity
  const [selectedId, setSelectedId] = useState(null);
  const [importBanner, setImportBanner] = useState(null); // {ok, message} -- survives switching tabs, unlike ImportView's own local state
  // WORKSPACE A/B (Launch Engine closed-loop). Two separate secrets, two
  // separate record systems -- launchSecret unlocks ONLY the read-only
  // public-funnel summary (launch-send-campaign-email's get_summary
  // action, gated by LAUNCH_ADMIN_SECRET); it is never merged with
  // `secret` (OUTREACH_ADMIN_SECRET) and never persisted, same discipline
  // as the outreach secret above.
  const [workspace, setWorkspace] = useState("outreach"); // "launch" | "outreach"
  const [launchSecretInput, setLaunchSecretInput] = useState("");
  const [launchSecret, setLaunchSecret] = useState(null);
  const [launchSummary, setLaunchSummary] = useState(null);
  const [launchError, setLaunchError] = useState(null);

  const client = isConfigured ? supabase : null;

  async function refresh(activeSecret) {
    setLoading(true);
    setError(null);
    const [contactsResult, followUpsResult] = await Promise.all([
      listOutreachContacts({ client, adminSecret: activeSecret }),
      listOutreachFollowUps({ client, adminSecret: activeSecret }),
    ]);
    if (!contactsResult.ok) setError(contactsResult.error);
    setContacts(contactsResult.contacts || []);
    setFollowUps(followUpsResult.followUps || []);
    setLoading(false);
  }

  useEffect(() => {
    if (secret) refresh(secret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret]);

  async function refreshLaunchSummary(activeLaunchSecret) {
    setLaunchError(null);
    const r = await getLaunchSummary({ client, adminSecret: activeLaunchSecret });
    if (!r.ok) { setLaunchError(r.error); setLaunchSummary(null); return; }
    setLaunchSummary(r.summary);
  }

  useEffect(() => {
    if (launchSecret) refreshLaunchSummary(launchSecret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSecret]);

  if (workspace === "launch") {
    return (
      <div style={{ minHeight: "100vh", background: BLACK, padding: "28px clamp(16px,4vw,40px)", fontFamily: UI }}>
        <WorkspaceSwitcher workspace={workspace} setWorkspace={setWorkspace} />
        {!launchSecret ? (
          <div style={{ ...panelStyle, maxWidth: 420 }}>
            <div style={headingStyle}>Public launch distribution</div>
            <p style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>
              A separate secret from the outreach admin secret -- this one only unlocks a READ-ONLY summary of the
              public /launch funnel (confirmed/pending/unsubscribed counts, sequence-sent counts). It is held in
              this tab only and never stored.
            </p>
            <input
              type="password" value={launchSecretInput} onChange={(e) => setLaunchSecretInput(e.target.value)}
              placeholder="Launch admin secret" style={{ ...inputStyle, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
            />
            <button style={buttonStyle(!!launchSecretInput)} disabled={!launchSecretInput} onClick={() => setLaunchSecret(launchSecretInput)}>
              Unlock
            </button>
          </div>
        ) : (
          <LaunchWorkspaceView summary={launchSummary} error={launchError} onRefresh={() => refreshLaunchSummary(launchSecret)} />
        )}
      </div>
    );
  }

  if (!secret) {
    return (
      <div style={{ minHeight: "100vh", background: BLACK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ marginBottom: 16 }}><WorkspaceSwitcher workspace={workspace} setWorkspace={setWorkspace} /></div>
        <div style={{ ...panelStyle, maxWidth: 420, width: "100%" }}>
          <div style={headingStyle}>Outreach control room</div>
          <p style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>
            Admin-only. Enter the outreach admin secret to continue — it is held in this tab only and never stored.
          </p>
          <input
            type="password" value={secretInput} onChange={(e) => setSecretInput(e.target.value)}
            placeholder="Outreach admin secret" style={{ ...inputStyle, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
          />
          <button style={buttonStyle(!!secretInput)} disabled={!secretInput} onClick={() => setSecret(secretInput)}>
            Unlock
          </button>
          {!isConfigured && (
            <p style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 12 }}>
              No Supabase project is configured in this preview — data will not load.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BLACK, padding: "28px clamp(16px,4vw,40px)", fontFamily: UI }}>
      <div style={{ marginBottom: 16 }}><WorkspaceSwitcher workspace={workspace} setWorkspace={setWorkspace} /></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, color: IVORY }}>Direct outreach control room</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["board", "contacts", "import", "activity", "learning"].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ ...buttonStyle(true), background: tab === t ? TEAL : BORDER, color: tab === t ? BLACK : IVORY }}>
              {t}
            </button>
          ))}
          <button style={buttonStyle(true)} onClick={() => refresh(secret)}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...panelStyle, borderColor: PINK, color: PINK, fontSize: 12.5 }}>{error}</div>}
      {importBanner && (
        <div style={{ ...panelStyle, borderColor: importBanner.ok ? TEAL : PINK, color: importBanner.ok ? TEAL : PINK, fontSize: 12.5 }}>
          {importBanner.message}
        </div>
      )}
      {loading && <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Loading…</div>}

      {tab === "board" && <BoardView contacts={contacts} followUps={followUps} selectedId={selectedId} setSelectedId={setSelectedId}
        onTransition={async (contactId, toStatus) => { await updateOutreachContactStatus({ client, adminSecret: secret, contactId, toStatus }); refresh(secret); }}
      />}
      {tab === "contacts" && <ContactsView contacts={contacts} followUps={followUps}
        onCreate={async (contact) => { const r = await createOutreachContact({ client, adminSecret: secret, contact }); if (!r.ok) setError(r.error); refresh(secret); }}
        onTransition={async (contactId, toStatus) => { const r = await updateOutreachContactStatus({ client, adminSecret: secret, contactId, toStatus }); if (!r.ok) setError(r.error); refresh(secret); }}
        onCreateFollowUp={async (args) => { const r = await createOutreachFollowUp({ client, adminSecret: secret, ...args }); if (!r.ok) setError(r.error); refresh(secret); }}
        onTransitionFollowUp={async (followUpId, toState) => { const r = await transitionOutreachFollowUp({ client, adminSecret: secret, followUpId, toState }); if (!r.ok) setError(r.error); refresh(secret); }}
      />}
      {tab === "import" && <ImportView contacts={contacts}
        onReconcile={async (plan) => {
          try {
            const r = await reconcileHistoricalImport({ client, adminSecret: secret, ...plan });
            if (r.ok) {
              setError(null);
              setImportBanner({ ok: true, message: `Reconciled: ${r.created} new contact(s) · ${r.linkedExisting + r.linkedNewBatch} historical message(s) linked to existing contacts · ${r.alreadyRecorded} already recorded · ${r.failed} failed. Re-running the same reconciliation is safe -- each historical message is identified by its own source reference and is never recorded twice.` });
            } else {
              setError(r.error);
              setImportBanner({ ok: false, message: `Reconciliation failed: ${r.error}. No contacts or historical events were written for this request.` });
            }
            refresh(secret);
            return r;
          } catch (err) {
            const message = `The reconciliation request did not finish cleanly (${err?.message || "connection interrupted"}). It may have partially or fully completed on the server -- check the Contacts tab before deciding what to do. Re-running the same reconciliation is safe either way: each historical message is identified by its own source reference and is never recorded twice.`;
            setImportBanner({ ok: false, message });
            refresh(secret);
            return { ok: false, error: message };
          }
        }}
      />}
      {tab === "activity" && <ActivityView contacts={contacts} client={client} secret={secret} setError={setError} />}
      {tab === "learning" && <LearningView contacts={contacts} followUps={followUps} />}
    </div>
  );
}

function WorkspaceSwitcher({ workspace, setWorkspace }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {[["launch", "A — Public launch distribution"], ["outreach", "B — Direct outreach"]].map(([key, label]) => (
        <button key={key} onClick={() => setWorkspace(key)}
          style={{ ...buttonStyle(true), background: workspace === key ? PINK : BORDER, color: workspace === key ? BLACK : IVORY }}>
          {label}
        </button>
      ))}
    </div>
  );
}

const statCardStyle = { ...panelStyle, flex: "1 1 160px", minWidth: 160 };

/** Workspace A -- read-only public /launch funnel summary. Never reads/writes a single subscriber row by name; counts only. */
function LaunchWorkspaceView({ summary, error, onRefresh }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, color: IVORY }}>Public launch distribution</div>
        <button style={buttonStyle(true)} onClick={onRefresh}>Refresh</button>
      </div>
      {error && <div style={{ ...panelStyle, borderColor: PINK, color: PINK, fontSize: 12.5 }}>{error}</div>}
      {!summary && !error && <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Loading…</div>}
      {summary && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={statCardStyle}><div style={labelStyle}>Confirmed (consented)</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: TEAL }}>{summary.confirmed}</div></div>
            <div style={statCardStyle}><div style={labelStyle}>Pending confirmation</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: AMBER }}>{summary.pendingConfirmation}</div></div>
            <div style={statCardStyle}><div style={labelStyle}>Unsubscribed</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: PINK }}>{summary.unsubscribed}</div></div>
          </div>
          <div style={panelStyle}>
            <div style={headingStyle}>Sequence readiness and actual sends</div>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: n < 3 ? `1px solid ${BORDER}` : "none" }}>
                <span style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
                  Sequence {n}
                  {!summary.sequenceContentReady[n] && <span style={{ color: PINK, marginLeft: 8, fontSize: 11 }}>— content not ready, send blocked server-side</span>}
                </span>
                <span style={{ fontFamily: UI, fontSize: 13, color: TEAL }}>{summary[`sequence${n}Sent`]} sent</span>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 14, lineHeight: 1.5 }}>
            This is the ONLY place this control room reads public-funnel data, and it is read-only, aggregate counts
            only -- no subscriber email, token, or individual row is ever shown here. Consent/unsubscribe handling
            itself is unchanged -- see /launch/confirm and /launch/unsubscribe.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Workspace B's evidence-layer tab -- the four truthful message states
 * for whichever contact is selected (same selection state the board/
 * contacts tabs already use), a Gmail connection status panel, and a
 * minimal compose-preview-approve-send flow built on composer.js +
 * outreach-gmail. SENDING FROM HERE requires Gmail OAuth to actually be
 * connected (see docs/OUTREACH-GMAIL-SETUP.md) -- until then, "Record a
 * manual send" remains fully functional and is the honest, always-
 * available path.
 */
function ActivityView({ contacts, client, secret, setError }) {
  const [selectedContactId, setSelectedContactId] = useState(contacts[0]?.id || "");
  const [events, setEvents] = useState([]);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);

  useEffect(() => {
    if (selectedContactId) listOutreachMessageEvents({ client, adminSecret: secret, contactId: selectedContactId }).then((r) => setEvents(r.ok ? r.events : []));
  }, [selectedContactId, client, secret]);

  useEffect(() => {
    getGmailConnectionStatus({ client, adminSecret: secret }).then((r) => setGmailStatus(r.ok ? r.status : null));
  }, [client, secret]);

  const selectedContact = contacts.find((c) => c.id === selectedContactId) || null;
  const summary = computeActivitySummary(events);

  function buildPreview() {
    const built = buildBrandedEmail({
      subject: draftSubject, bodyText: draftBody,
      recipientName: selectedContact?.recipientName, organization: selectedContact?.organization,
    });
    setPreview(built);
  }

  async function recordManualSend() {
    if (!selectedContact) return;
    setBusy(true);
    const occurredAt = new Date().toISOString();
    const r = await recordOutreachMessageEvent({
      client, adminSecret: secret, contactId: selectedContact.id, direction: "OUTBOUND", activityState: "SENT",
      provider: "MANUAL_ATTESTATION", occurredAt, recipientEmail: selectedContact.recipientEmail, subject: draftSubject || preview?.subject,
      idempotencyKey: buildManualAttestationIdempotencyKey({ contactId: selectedContact.id, occurredAt }),
    });
    setResult(r);
    if (!r.ok) setError(r.error);
    if (r.ok) listOutreachMessageEvents({ client, adminSecret: secret, contactId: selectedContact.id }).then((r2) => setEvents(r2.ok ? r2.events : []));
    setBusy(false);
  }

  async function sendViaGmail() {
    if (!selectedContact || !preview?.valid) return;
    setBusy(true);
    const confirmationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r = await sendOutreachGmailMessage({
      client, adminSecret: secret, contactId: selectedContact.id, to: selectedContact.recipientEmail,
      subject: preview.subject, html: preview.html, text: preview.text, confirmationId, approved: true,
    });
    setResult(r);
    if (!r.ok) setError(r.error);
    if (r.ok) listOutreachMessageEvents({ client, adminSecret: secret, contactId: selectedContact.id }).then((r2) => setEvents(r2.ok ? r2.events : []));
    setBusy(false);
  }

  return (
    <div>
      <div style={panelStyle}>
        <div style={headingStyle}>Gmail connection</div>
        {!gmailStatus && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>Loading…</div>}
        {gmailStatus && !gmailStatus.configured && (
          <p style={{ fontFamily: UI, fontSize: 12.5, color: AMBER, lineHeight: 1.5 }}>
            Not configured -- missing: {gmailStatus.missingConfig.join(", ")}. See docs/OUTREACH-GMAIL-SETUP.md for the exact setup steps.
            "Record a manual send" below remains fully available regardless.
          </p>
        )}
        {gmailStatus && gmailStatus.configured && (
          <>
            <p style={{ fontFamily: UI, fontSize: 12.5, color: gmailStatus.connected ? TEAL : AMBER, lineHeight: 1.5 }}>
              {gmailStatus.connected
                ? `Connected as ${gmailStatus.googleAccountEmail}. Send-as ${gmailStatus.sendAsIdentity}: ${gmailStatus.sendAsVerified ? "verified" : "NOT verified."}`
                : "Configured but not yet connected."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {!gmailStatus.connected && (
                <button style={buttonStyle(true)} onClick={async () => { const r = await getGmailAuthUrl({ client, adminSecret: secret }); if (r.ok) setAuthUrl(r.authUrl); else setError(r.error); }}>
                  Get connect link
                </button>
              )}
              {gmailStatus.connected && !gmailStatus.sendAsVerified && (
                <button style={buttonStyle(true)} onClick={async () => {
                  const r = await verifyGmailSendAs({ client, adminSecret: secret });
                  if (!r.ok) setError(r.error);
                  getGmailConnectionStatus({ client, adminSecret: secret }).then((r2) => setGmailStatus(r2.ok ? r2.status : null));
                }}>
                  Verify send-as identity
                </button>
              )}
            </div>
            {authUrl && (
              <p style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>
                Open in a browser signed into the authorized Gmail account: <a href={authUrl} target="_blank" rel="noreferrer" style={{ color: TEAL }}>{authUrl}</a>
              </p>
            )}
          </>
        )}
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>Select a contact</div>
        <select style={{ ...inputStyle, width: "100%" }} value={selectedContactId} onChange={(e) => setSelectedContactId(e.target.value)}>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.organization} — {c.recipientEmail}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={statCardStyle}><div style={labelStyle}>Prepared</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: IVORY }}>{summary.preparedCount}</div></div>
        <div style={statCardStyle}><div style={labelStyle}>Sent (verified)</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: TEAL }}>{summary.sentCount}</div></div>
        <div style={statCardStyle}><div style={labelStyle}>Replies received</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: AMBER }}>{summary.replyReceivedCount}</div></div>
        <div style={statCardStyle}><div style={labelStyle}>Needs review</div><div style={{ fontSize: 28, fontFamily: DISPLAY, color: PINK }}>{summary.needsReviewCount}</div></div>
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>Message history (this contact)</div>
        {events.length === 0 && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>No recorded message activity yet.</div>}
        {events.map((e) => (
          <div key={e.id} style={{ fontSize: 12, fontFamily: UI, color: IVORY, padding: "6px 0", borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ color: e.direction === "INBOUND" ? AMBER : TEAL }}>{e.direction}</span> · {e.activity_state} · {e.provider}
            {e.provider_message_id ? ` · ${e.provider_message_id}` : ""} · {e.occurred_at}
          </div>
        ))}
      </div>

      <div style={panelStyle}>
        <div style={headingStyle}>Compose (branded HTML preview)</div>
        <input style={{ ...inputStyle, width: "100%", marginBottom: 8, boxSizing: "border-box" }} placeholder="Subject" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} />
        <textarea style={{ ...inputStyle, width: "100%", minHeight: 120, marginBottom: 8, boxSizing: "border-box" }} placeholder="Body (plain text -- blank lines separate paragraphs)" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button style={buttonStyle(!!(draftSubject && draftBody))} disabled={!draftSubject || !draftBody} onClick={buildPreview}>Build preview</button>
        </div>
        {preview && !preview.valid && <div style={{ color: PINK, fontSize: 12 }}>{preview.error}</div>}
        {preview?.valid && (
          <>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>Exact HTML that would be sent (this is the final-approval preview -- it matches the outgoing message exactly):</div>
            <iframe title="email preview" srcDoc={preview.html} style={{ width: "100%", height: 320, border: `1px solid ${BORDER}`, background: "#fff", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={buttonStyle(!busy)} disabled={busy} onClick={recordManualSend}>Record a manual send (always available)</button>
              <button style={buttonStyle(!busy && gmailStatus?.sendAsVerified)} disabled={busy || !gmailStatus?.sendAsVerified} onClick={sendViaGmail}>
                Send via Gmail {gmailStatus?.sendAsVerified ? "" : "(requires a verified send-as identity)"}
              </button>
            </div>
          </>
        )}
        {result && <div style={{ marginTop: 10, fontSize: 12, color: result.ok ? TEAL : PINK }}>{result.ok ? "Recorded." : result.error}</div>}
      </div>
    </div>
  );
}

function QueueList({ title, items, onClick }) {
  return (
    <div style={panelStyle}>
      <div style={{ ...headingStyle, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span><span style={{ color: TEAL }}>{items.length}</span>
      </div>
      {items.length === 0 && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>Nothing here.</div>}
      {items.map((c) => (
        <div key={c.id} onClick={() => onClick?.(c.id)}
          style={{ padding: "8px 0", borderBottom: `1px solid ${BORDER}`, cursor: onClick ? "pointer" : "default" }}>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{c.organization}</div>
          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>{c.recipient_email} · {PIPELINE_STATUS_LABEL[c.status] || c.status}</div>
        </div>
      ))}
    </div>
  );
}

function BoardView({ contacts, selectedId, setSelectedId }) {
  const now = new Date();
  const normalized = contacts.map(toCamelContact);
  // Answers the ten control-room questions (Phase 4) as real counts, not decoration.
  const totals = {
    contacted: normalized.filter((c) => c.status !== "DRAFT").length,
    responded: normalized.filter((c) => c.responseStatus === "RESPONDED").length,
    followUpDue: normalized.filter((c) => computeFollowUpEligibility(c, now).eligible).length,
    acknowledged: normalized.filter((c) => c.engagementStatus === "ACKNOWLEDGED").length,
    demoRequested: normalized.filter((c) => c.status === "DEMO").length,
    demoSent: normalized.filter((c) => c.demoSent).length,
    conversation: normalized.filter((c) => c.status === "CONVERSATION").length,
    declined: normalized.filter((c) => c.status === "DECLINED").length,
    bounced: normalized.filter((c) => c.status === "BOUNCED").length,
  };
  return (
    <div>
      <div style={{ ...panelStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        {Object.entries({
          "Contacted": totals.contacted, "Responded": totals.responded, "Follow-up due": totals.followUpDue,
          "Acknowledged": totals.acknowledged, "Demo requested": totals.demoRequested, "Demo sent": totals.demoSent,
          "Conversation": totals.conversation, "Declined": totals.declined, "Bounced": totals.bounced,
        }).map(([k, v]) => (
          <div key={k}>
            <div style={labelStyle}>{k}</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 24, color: IVORY }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
        {QUEUES.map((q) => (
          <QueueList key={q.key} title={q.label.toUpperCase()}
            items={normalized.filter((c) => q.filter(c, now))}
            onClick={setSelectedId}
          />
        ))}
      </div>
      {selectedId && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>Selected contact id: {selectedId} — open the Contacts tab to act on it.</div>}
    </div>
  );
}

function toCamelContact(row) {
  return {
    id: row.id,
    organization: row.organization,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    sector: row.sector,
    country: row.country,
    campaign: row.campaign,
    letterVersion: row.letter_version,
    subject: row.subject,
    senderAccount: row.sender_account,
    sourceRecordRef: row.source_record_ref,
    sentAt: row.sent_at,
    deliveryStatus: row.delivery_status,
    engagementStatus: row.engagement_status,
    status: row.status,
    responseStatus: row.response_status,
    responseAt: row.response_at,
    followUpDueAt: row.follow_up_due_at,
    followUpCount: row.follow_up_count,
    lastContactAt: row.last_contact_at,
    demoSent: row.demo_sent,
    githubSent: row.github_sent,
    evidencePackageSent: row.evidence_package_sent,
    conversationStatus: row.conversation_status,
    nextAction: row.next_action,
    notes: row.notes,
    sourceOfTruth: row.source_of_truth,
  };
}

function NewContactForm({ onCreate }) {
  const [form, setForm] = useState({ organization: "", recipientEmail: "", recipientName: "", sector: SECTOR[0], country: "", subject: "" });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    const contact = defaultContactFor({
      organization: form.organization.trim(), recipientEmail: form.recipientEmail.trim(), sector: form.sector,
      sourceOfTruth: "MANUAL_ENTRY", recipientName: form.recipientName.trim() || null, country: form.country.trim() || null,
      subject: form.subject.trim() || null,
    });
    const validation = validateContact(contact);
    if (!validation.valid) { setErr(validation.error); return; }
    setErr(null);
    onCreate(contact);
    setForm({ organization: "", recipientEmail: "", recipientName: "", sector: SECTOR[0], country: "", subject: "" });
  };

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>Add a contact (manual entry)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 10 }}>
        <input style={inputStyle} placeholder="Organization" value={form.organization} onChange={set("organization")} />
        <input style={inputStyle} placeholder="Recipient email" value={form.recipientEmail} onChange={set("recipientEmail")} />
        <input style={inputStyle} placeholder="Recipient name (optional)" value={form.recipientName} onChange={set("recipientName")} />
        <select style={inputStyle} value={form.sector} onChange={set("sector")}>
          {SECTOR.map((s) => <option key={s} value={s}>{SECTOR_LABEL[s]}</option>)}
        </select>
        <input style={inputStyle} placeholder="Country (optional)" value={form.country} onChange={set("country")} />
        <input style={inputStyle} placeholder="Subject (optional)" value={form.subject} onChange={set("subject")} />
      </div>
      {err && <div style={{ color: PINK, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <button style={buttonStyle(true)} onClick={submit}>Add as draft</button>
    </div>
  );
}

function ContactDetail({ contact, followUps, onTransition, onCreateFollowUp, onTransitionFollowUp }) {
  const allowed = STATUS_TRANSITIONS[contact.status] || [];
  const [assetCode, setAssetCode] = useState(defaultAssetCodeForContact(contact));
  const rendered = renderAsset(assetCode, contact);
  const [subject, setSubject] = useState(rendered.subject || "");
  const [body, setBody] = useState(rendered.body || "");
  const contactFollowUps = followUps.filter((f) => f.contact_id === contact.id);

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>{contact.organization}</div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
        {contact.recipient_email} · {SECTOR_LABEL[contact.sector]} · status: <b style={{ color: TEAL }}>{PIPELINE_STATUS_LABEL[contact.status]}</b>
      </div>
      {(contact.sender_account && contact.sender_account !== "UNKNOWN") || contact.source_record_ref ? (
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
          {contact.sender_account && contact.sender_account !== "UNKNOWN" && <span>sent from {contact.sender_account}</span>}
          {contact.sender_account && contact.sender_account !== "UNKNOWN" && contact.source_record_ref && <span> · </span>}
          {contact.source_record_ref && <span>source: {contact.source_record_ref}</span>}
        </div>
      ) : null}

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Move status</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {allowed.length === 0 && <span style={{ color: MUTED, fontSize: 12 }}>Terminal — no further transition.</span>}
          {allowed.map((s) => (
            <button key={s} style={buttonStyle(true)} onClick={() => onTransition(contact.id, s)}>{PIPELINE_STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Draft a follow-up</div>
        <select style={{ ...inputStyle, marginTop: 6, marginBottom: 6, width: "100%" }} value={assetCode}
          onChange={(e) => { setAssetCode(e.target.value); const r = renderAsset(e.target.value, contact); setSubject(r.subject); setBody(r.body); }}>
          {ASSET_CODE.map((code) => <option key={code} value={code}>{ASSET_LABEL[code]}</option>)}
        </select>
        <input style={{ ...inputStyle, width: "100%", marginBottom: 6, boxSizing: "border-box" }} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea style={{ ...inputStyle, width: "100%", minHeight: 140, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12 }}
          value={body} onChange={(e) => setBody(e.target.value)} />
        <button style={{ ...buttonStyle(true), marginTop: 8 }}
          onClick={() => onCreateFollowUp({ contactId: contact.id, assetCode, subject, body })}>
          Save as draft
        </button>
      </div>

      <div>
        <div style={labelStyle}>Follow-up drafts</div>
        {contactFollowUps.length === 0 && <div style={{ color: MUTED, fontSize: 12 }}>None yet.</div>}
        {contactFollowUps.map((f) => (
          <div key={f.id} style={{ padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 12, color: IVORY }}>{f.subject} — <b style={{ color: AMBER }}>{f.state}</b></div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {(FOLLOWUP_TRANSITIONS[f.state] || []).map((s) => (
                <button key={s} style={buttonStyle(true)} onClick={() => onTransitionFollowUp(f.id, s)}>{s}</button>
              ))}
            </div>
            {f.state === "APPROVED" && (
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                Send this yourself through your own mail client, then mark it SENT — nothing here sends email automatically.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactsView({ contacts, followUps, onCreate, onTransition, onCreateFollowUp, onTransitionFollowUp }) {
  const [selected, setSelected] = useState(null);
  const selectedContact = contacts.find((c) => c.id === selected);
  return (
    <div>
      <NewContactForm onCreate={onCreate} />
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        <div style={panelStyle}>
          <div style={headingStyle}>All contacts ({contacts.length})</div>
          {contacts.map((c) => (
            <div key={c.id} onClick={() => setSelected(c.id)}
              style={{ padding: "8px 0", borderBottom: `1px solid ${BORDER}`, cursor: "pointer", background: selected === c.id ? "#1C2128" : "transparent" }}>
              <div style={{ fontSize: 12.5, color: IVORY, fontWeight: 700 }}>{c.organization}</div>
              <div style={{ fontSize: 11, color: MUTED }}>{PIPELINE_STATUS_LABEL[c.status]}</div>
            </div>
          ))}
        </div>
        {selectedContact
          ? <ContactDetail contact={selectedContact} followUps={followUps}
              onTransition={onTransition} onCreateFollowUp={onCreateFollowUp} onTransitionFollowUp={onTransitionFollowUp} />
          : <div style={panelStyle}><span style={{ color: MUTED, fontSize: 12.5 }}>Select a contact.</span></div>}
      </div>
    </div>
  );
}

function ImportView({ contacts, onReconcile }) {
  const [format, setFormat] = useState("csv");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const runPreview = () => {
    let parsed;
    try {
      parsed = parseImportRows(format === "json" ? JSON.parse(text) : text, format);
    } catch (e) {
      setPreview({ valid: false, error: `could not parse: ${e.message}` });
      return;
    }
    if (!parsed.valid) { setPreview(parsed); return; }
    const plan = planHistoricalReconciliation(parsed.rows, contacts.map(toCamelContact), {});
    setPreview({ valid: true, plan });
  };

  const runReconcile = async () => {
    if (submitting) return; // already in flight -- never fire a second request on a second click
    setSubmitting(true);
    try {
      const { toCreate, toAttachExisting, toAttachNewBatch } = preview.plan;
      const r = await onReconcile({ toCreate, toAttachExisting, toAttachNewBatch });
      setResult(r);
    } finally {
      setSubmitting(false);
    }
  };

  const actionableCount = preview?.valid
    ? preview.plan.summary.newContacts + preview.plan.summary.linkedToExisting + preview.plan.summary.linkedToNewBatch
    : 0;

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>Import historical letters (Phase 7)</div>
      <p style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
        CSV columns: organization, recipient, email, sector, country, campaign, subject, letter_version, date_sent, known_status, known_response, sender_account, source_record_ref, notes.
        JSON: an array of objects with the same field names. Unknown values are left UNKNOWN — nothing is invented.
        A row whose email already matches an existing contact is never turned into a second contact -- it is reconciled as a
        historical message against that same contact (see historicalImport.js). A row with more than one address in its
        email field is never auto-assigned -- it is always flagged for review.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select style={inputStyle} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <button style={buttonStyle(true)} onClick={runPreview}>Preview</button>
      </div>
      <textarea style={{ ...inputStyle, width: "100%", minHeight: 160, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12 }}
        value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste CSV or JSON here" />

      {preview && !preview.valid && <div style={{ color: PINK, fontSize: 12, marginTop: 10 }}>{preview.error}</div>}
      {preview?.valid && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: IVORY }}>
            {preview.plan.summary.newContacts} new contact(s) ·{" "}
            {preview.plan.summary.linkedToExisting} linked to existing contacts ·{" "}
            {preview.plan.summary.linkedToNewBatch} additional message(s) to a contact created in this same batch ·{" "}
            {preview.plan.summary.alreadyRecorded} already recorded (safe to re-import) ·{" "}
            {preview.plan.summary.needsReview} need review ·{" "}
            {preview.plan.summary.invalid} invalid
          </div>
          {preview.plan.needsReview.map((r, i) => (
            <div key={`review-${i}`} style={{ fontSize: 11, color: AMBER }}>Row {r.rowIndex + 1}: {r.reason}</div>
          ))}
          {preview.plan.invalid.map((r, i) => (
            <div key={`invalid-${i}`} style={{ fontSize: 11, color: PINK }}>Row {r.rowIndex + 1}: {r.reason}</div>
          ))}
          <button style={{ ...buttonStyle(!submitting && actionableCount > 0), marginTop: 10 }} disabled={submitting || actionableCount === 0} onClick={runReconcile}>
            {submitting ? "Reconciling…" : `Reconcile ${actionableCount} historical message(s)`}
          </button>
        </div>
      )}
      {result && (
        <div style={{ marginTop: 10, fontSize: 12, color: TEAL }}>
          Created {result.created} · linked to existing {result.linkedExisting + result.linkedNewBatch} · already recorded {result.alreadyRecorded} · failed {result.failed}
        </div>
      )}
    </div>
  );
}

function LearningView({ contacts, followUps }) {
  const camel = useMemo(() => contacts.map(toCamelContact), [contacts]);
  const followUpsCamel = useMemo(() => followUps.map((f) => ({
    id: f.id, contactId: f.contact_id, assetCode: f.asset_code, state: f.state,
  })), [followUps]);
  const contactsById = useMemo(() => new Map(camel.map((c) => [c.id, c])), [camel]);

  const bySector = summarizeBySector(camel);
  const byLetter = summarizeByLetterVersion(camel);
  const byAsset = summarizeByAsset(followUpsCamel, contactsById);
  const demoSent = listByEngagementFlag(camel, "demoSent");
  const githubSent = listByEngagementFlag(camel, "githubSent");
  const wantConversation = listByConversationInterest(camel);

  return (
    <div>
      <div style={panelStyle}>
        <div style={headingStyle}>Which sectors respond?</div>
        {bySector.map((s) => (
          <div key={s.sector} style={{ fontSize: 12.5, color: IVORY, padding: "4px 0" }}>
            {SECTOR_LABEL[s.sector]}: {s.responded}/{s.sent} {s.respondedRate != null ? `(${Math.round(s.respondedRate * 100)}%)` : "(no data yet)"}
          </div>
        ))}
      </div>
      <div style={panelStyle}>
        <div style={headingStyle}>Which message angle (letter version) performs best?</div>
        {byLetter.length === 0 && <div style={{ color: MUTED, fontSize: 12 }}>No sent letters yet.</div>}
        {byLetter.map((l) => (
          <div key={l.letterVersion} style={{ fontSize: 12.5, color: IVORY, padding: "4px 0" }}>
            {l.letterVersion}: {l.responded}/{l.sent} {l.respondedRate != null ? `(${Math.round(l.respondedRate * 100)}%)` : "(no data yet)"}
          </div>
        ))}
      </div>
      <div style={panelStyle}>
        <div style={headingStyle}>Which CTA (follow-up asset) performs best?</div>
        {byAsset.length === 0 && <div style={{ color: MUTED, fontSize: 12 }}>No sent follow-ups yet.</div>}
        {byAsset.map((a) => (
          <div key={a.assetCode} style={{ fontSize: 12.5, color: IVORY, padding: "4px 0" }}>
            {ASSET_LABEL[a.assetCode]}: {a.advanced}/{a.sent} advanced {a.advancedRate != null ? `(${Math.round(a.advancedRate * 100)}%)` : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
        <QueueListPlain title="Demo sent to" items={demoSent.organizations} />
        <QueueListPlain title="Source/GitHub sent to" items={githubSent.organizations} />
        <QueueListPlain title="Want a conversation" items={wantConversation} />
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10 }}>{channelCoverageNote()}</div>
    </div>
  );
}

function QueueListPlain({ title, items }) {
  return (
    <div style={panelStyle}>
      <div style={{ ...headingStyle, fontSize: 13 }}>{title} ({items.length})</div>
      {items.length === 0 && <div style={{ fontSize: 12, color: MUTED }}>None yet.</div>}
      {items.map((o, i) => <div key={i} style={{ fontSize: 12.5, color: IVORY, padding: "3px 0" }}>{o}</div>)}
    </div>
  );
}
