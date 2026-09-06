// ============================================================
// ELECTION FORGE — ORGANISATION  (Campaign invitations + roster)
//
// Who is in this campaign, what role they hold, what territory they're
// responsible for, and a 4-step flow to invite someone new. Geography
// options come only from the campaign's own already-resolved territory
// (Territory tab) — no re-asking Election/Office/State/Constituency, and
// no geography ever shown that doesn't exist in the real tables (an empty
// ward/PU list renders the same honest "not imported yet" message Territory
// already established, never a placeholder).
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase.js";
import { getConstituencyTerritory, getStateTerritory, listOffices } from "../../domains/election/geography/read.js";
import { listWardsForLga, listPollingUnitsForWard } from "../../domains/election/geography/read.js";
import { createInvitation, revokeInvitation } from "../../domains/election/invitations/write.js";
import { listInvitations } from "../../domains/election/invitations/read.js";
import { resolveMyResponsibility, isScopedResponsibility } from "../../domains/election/responsibility.js";
import { Label, Panel, friendlyError, UI, IVORY, TEAL, AMBER, PINK, MUTED, BORDER, BLACK, inputStyle } from "./shared.jsx";

const RESPONSIBILITY_ROLE_LABEL = Object.freeze({
  CONSTITUENCY_LEAD: "Constituency Lead", LGA_COORDINATOR: "LGA Coordinator",
  WARD_COORDINATOR: "Ward Coordinator", POLLING_UNIT_AGENT: "Polling-Unit Agent",
});

const STATUS_COLOR = Object.freeze({ pending: AMBER, accepted: TEAL, expired: MUTED, revoked: PINK });

// GATE A — the private myOwnResponsibility() this file previously defined
// (byte-identical lookup, minus HomeSection.jsx's own CONSTITUENCY_LEAD
// presentation filter) is now the SHARED resolveMyResponsibility()
// (src/domains/election/responsibility.js) — see that module's own header.
// This file's own use (gating InviteWizard's offerable roles) always
// wanted the RAW resolution, CONSTITUENCY_LEAD included, so no filter is
// applied here — unchanged behavior.

// ELECTIONCANON 1.1 HOME OPERATING CONSOLE — the SAME three-branch identity
// resolution this component's own nameFor() closure always used (invited
// roster name -> the viewer's own profile -> the accepting invitation's own
// name), pulled out to a standalone, no-I/O function so a second caller
// (Home's reassignment picker) resolves a member's display name the exact
// same way rather than re-deriving identity. `members`/`invitations`/
// `myIdentity`/`view` are passed in, never re-fetched here — this function
// does no I/O of its own, matching every other pure resolver in this repo.
export function resolveMemberDisplayName({ uid, campaignId, userId, myIdentity, view, invitations }) {
  const people = Object.values(view?.people ?? {});
  const invited = people.find((p) => p.id === `invite:${campaignId}:${uid}`)?.name;
  if (invited) return invited;
  if (uid === userId && myIdentity) return myIdentity.displayName?.trim() || myIdentity.email || "You";
  const acceptedInvite = invitations.find((i) => i.accepted_by === uid && i.status === "accepted");
  if (acceptedInvite?.invited_name) return acceptedInvite.invited_name;
  return "Campaign member";
}

// ELECTIONCANON 1.1 HOME OPERATING CONSOLE — the identity pool for the
// reassignment picker (Design Gate: "campaign_members -> active campaign
// member -> eligible reassignment candidate", explicitly NOT Mobilize's
// separate field roster). A fresh, standalone read (own membership +
// invitations + own profile query) rather than threading component state
// across pages — mirrors coverage.js's own convention of a read function
// taking what it needs and fetching for itself. Excludes inactive members
// by construction (`status = "active"` in the query) and excludes
// `excludePersonRef` (the slot's current holder) so the picker never offers
// "reassign to the same person" as a choice. Returns real display names,
// never a raw uid — same resolveMemberDisplayName() this file's own roster
// list uses.
export async function getReassignmentCandidates({ client, campaignId, userId, view, excludePersonRef = null }) {
  const [{ data: memberRows, error: memberError }, { data: invitations, error: invitationsError }] = await Promise.all([
    client.from("campaign_members").select("person, member_role, status").eq("campaign_id", campaignId).eq("status", "active"),
    listInvitations({ client, campaignId }),
  ]);
  if (memberError) return { data: null, error: memberError };
  if (invitationsError) return { data: null, error: invitationsError };

  let myIdentity = null;
  const { data: { user } } = await client.auth.getUser();
  if (user) {
    const { data: profileRow } = await client.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    myIdentity = { email: user.email ?? null, displayName: profileRow?.display_name ?? null };
  }

  const candidates = (memberRows ?? [])
    .map((m) => ({ id: `invite:${campaignId}:${m.person}`, uid: m.person,
      name: resolveMemberDisplayName({ uid: m.person, campaignId, userId, myIdentity, view, invitations }) }))
    .filter((c) => c.id !== excludePersonRef);
  return { data: candidates, error: null };
}

function InviteWizard({ campaignId, refresh, territory, offices, myRole, myResponsibility, invitePrefill, onDone }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(invitePrefill?.role ?? null); // 'DIRECTOR' | RESPONSIBILITY_ROLE key
  const [lgaId, setLgaId] = useState(invitePrefill?.lgaId ?? "");
  const [wardId, setWardId] = useState("");
  const [tree, setTree] = useState(null);
  const [wards, setWards] = useState([]);
  // LOOP 4 TASK 2 — a Polling-Unit Agent's own geography must be a REAL
  // geography_polling_units.id, never the ward's own id (the bug this pass
  // fixes — see puId's own use in send() below). `pollingUnits` is fetched
  // exactly like `wards` above: real rows, scoped to one ward, never a
  // second geography source.
  const [puId, setPuId] = useState("");
  const [pollingUnits, setPollingUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentToken, setSentToken] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [copied, setCopied] = useState(false);
  // Consumed once the ward list this prefill's LGA resolves to has actually
  // loaded (see the ward-fetch effect below) — a plain useState target
  // would be wiped by that effect's own unconditional `setWardId("")`.
  // A ref (not state) because setting it must never itself trigger a render.
  const prefillWardRef = useRef(invitePrefill?.level === "ward" ? invitePrefill.geographyRef : null);

  // FIX (production verification pass) — a state-level office (Governor,
  // President) carries a real `territory.state` but NO `territory.
  // constituency` at all (proposeSetTerritory() never asks for one — see
  // geography/write.js's own header), the exact same shape
  // TerritoryExplorer.jsx already resolves via getStateTerritory(). This
  // wizard previously only ever called getConstituencyTerritory() and only
  // when `territory.constituency` was set, so for every state-level
  // campaign (e.g. a Lagos Governor campaign) `tree` stayed null forever
  // and the LGA dropdown rendered with zero real options — never a second
  // geography source, never a hardcoded list, just the same canonical
  // geography_lgas/geography_wards read TerritoryExplorer already uses,
  // reached the same way it reaches it.
  const office = offices?.find((o) => o.id === territory?.office) ?? null;
  const isStateLevel = office?.boundary_level === "state" || office?.boundary_level === "national";
  const hasResolvableTerritory = Boolean(territory?.constituency) || isStateLevel;

  useEffect(() => {
    let cancelled = false;
    if (!hasResolvableTerritory) { setTree(null); return undefined; }
    (async () => {
      const { data } = territory.constituency
        ? await getConstituencyTerritory({ client: supabase, constituencyId: territory.constituency })
        : await getStateTerritory({ client: supabase, stateCode: territory.state });
      if (!cancelled) setTree(data);
    })();
    return () => { cancelled = true; };
  }, [territory?.constituency, territory?.state, hasResolvableTerritory]);

  // The roles a Director/owner may offer are all four; an LGA Coordinator
  // may only offer Ward Coordinator (within their own LGA); a Ward
  // Coordinator may only offer Polling-Unit Agent (within their own ward) —
  // mirrors create_campaign_invitation()'s own authorization exactly, so
  // the UI never offers a choice the database would refuse anyway.
  const canOfferDirector = myRole === "owner" || myRole === "manager";
  const canOfferLga = myRole === "owner" || myRole === "manager";
  const canOfferWard = myRole === "owner" || myRole === "manager" || myResponsibility?.responsibilityRole === "LGA_COORDINATOR";
  const canOfferPu = myRole === "owner" || myRole === "manager" || myResponsibility?.responsibilityRole === "WARD_COORDINATOR";

  // Geography choices are constrained to the inviter's own authority — an
  // LGA Coordinator only ever sees THEIR OWN LGA's wards, never another.
  const availableLgas = (myRole === "owner" || myRole === "manager")
    ? (tree?.lgas ?? [])
    : (tree?.lgas ?? []).filter((l) => l.id === myResponsibility?.geographyRef);

  useEffect(() => {
    let cancelled = false;
    setWardId("");
    setPuId("");
    if (role !== "WARD_COORDINATOR" && role !== "POLLING_UNIT_AGENT") { setWards([]); return undefined; }
    const effectiveLga = (myResponsibility?.responsibilityRole === "LGA_COORDINATOR") ? myResponsibility.geographyRef : lgaId;
    if (!effectiveLga) { setWards([]); return undefined; }
    (async () => {
      const { data } = await listWardsForLga({ client: supabase, lgaId: effectiveLga });
      if (cancelled) return;
      setWards(data ?? []);
      // One-time prefill consumption — see prefillWardRef's own declaration
      // above. Only fires for the FIRST load this ref's target ward
      // actually appears in; a user's own subsequent LGA/role changes never
      // re-trigger it, since the ref is cleared right after.
      if (prefillWardRef.current && (data ?? []).some((w) => w.id === prefillWardRef.current)) {
        setWardId(prefillWardRef.current);
        prefillWardRef.current = null;
      }
    })();
    return () => { cancelled = true; };
  }, [role, lgaId, myResponsibility]);

  // LOOP 4 TASK 2 — a Ward Coordinator inviting a Polling-Unit Agent never
  // re-picks their own ward (mirrors effectiveLga's own pattern one level
  // up: an LGA Coordinator never re-picks their own LGA). An owner/manager
  // still narrows LGA -> ward manually first, exactly as before.
  const effectiveWardForPu = myResponsibility?.responsibilityRole === "WARD_COORDINATOR" ? myResponsibility.geographyRef : wardId;
  const [autoWardName, setAutoWardName] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPuId("");
    if (role !== "POLLING_UNIT_AGENT" || !effectiveWardForPu) { setPollingUnits([]); setAutoWardName(null); return undefined; }
    (async () => {
      // The ward's own name is fetched directly ONLY on the auto-derived
      // path (a Ward Coordinator never went through listWardsForLga(), so
      // `wards` never carries their own ward's name) — a single-row lookup,
      // never a second geography source, same discipline as every other
      // one-row name lookup in this codebase (e.g. HomeSection.jsx's
      // MyScopeCard).
      const [{ data: pus }, wardNameResult] = await Promise.all([
        listPollingUnitsForWard({ client: supabase, wardId: effectiveWardForPu }),
        myResponsibility?.responsibilityRole === "WARD_COORDINATOR"
          ? supabase.from("geography_wards").select("id, name").eq("id", effectiveWardForPu).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setPollingUnits(pus ?? []);
      setAutoWardName(wardNameResult?.data?.name ?? null);
    })();
    return () => { cancelled = true; };
  }, [role, effectiveWardForPu, myResponsibility]);

  const needsLga = role === "LGA_COORDINATOR" || (role === "WARD_COORDINATOR" && myResponsibility?.responsibilityRole !== "LGA_COORDINATOR");
  // A Ward Coordinator inviting a Polling-Unit Agent never sees a ward
  // picker either — effectiveWardForPu already resolved it above.
  const needsWard = role === "WARD_COORDINATOR"
    || (role === "POLLING_UNIT_AGENT" && myResponsibility?.responsibilityRole !== "WARD_COORDINATOR");
  const needsPu = role === "POLLING_UNIT_AGENT";
  const territoryReady = role === "DIRECTOR"
    || (role === "LGA_COORDINATOR" && lgaId)
    || (role === "WARD_COORDINATOR" && wardId)
    || (role === "POLLING_UNIT_AGENT" && puId);

  const roleLabel = role === "DIRECTOR" ? "Campaign Director" : RESPONSIBILITY_ROLE_LABEL[role];
  const lgaName = availableLgas.find((l) => l.id === (lgaId || myResponsibility?.geographyRef))?.name;
  const wardName = wards.find((w) => w.id === wardId)?.name ?? autoWardName;
  const selectedPu = pollingUnits.find((p) => p.id === puId);
  const puLabel = selectedPu ? `${selectedPu.code}${selectedPu.name ? ` — ${selectedPu.name}` : ""}` : null;

  const send = async () => {
    setBusy(true); setError(null);
    // LOOP 4 TASK 2 FIX — a Polling-Unit Agent's geographyRef is now the
    // REAL selected geography_polling_units.id (puId), never the ward's own
    // id. The previous code used wardId for BOTH Ward Coordinator and
    // Polling-Unit Agent, which meant create_campaign_invitation()'s own
    // PU-authorization join (pu.id::text = p_intended_geography_ref) could
    // never match a real row — confirmed live: this made every
    // Polling-Unit Agent invitation attempt fail server-side. No
    // authorization logic changed here; this only supplies the correct id
    // the existing, already-correct SQL join expects.
    const geographyRef = role === "POLLING_UNIT_AGENT" ? puId
      : role === "WARD_COORDINATOR" ? wardId
      : role === "LGA_COORDINATOR" ? lgaId : null;
    const { invitation, emailStatus: status, emailError: sendEmailError, error: sendError } = await createInvitation({
      client: supabase, campaignId, invitedName: name.trim(), invitedEmail: email.trim(),
      intendedMemberRole: role === "DIRECTOR" ? "manager" : "staff",
      intendedResponsibilityRole: role === "DIRECTOR" ? null : role,
      intendedLevel: role === "DIRECTOR" ? null : role === "LGA_COORDINATOR" ? "lga" : role === "WARD_COORDINATOR" ? "ward" : "polling_unit",
      intendedGeographyRef: geographyRef,
    });
    setBusy(false);
    if (sendError) { setError(sendError); return; }
    setSentToken(invitation.token);
    setEmailStatus(status);
    setEmailError(sendEmailError);
    await refresh();
  };

  if (sentToken) {
    const link = `${window.location.origin}/invite/${sentToken}`;
    // Honest status language (First-user completion pass, item 5):
    // "Invitation created" is always true the moment we're here (the row
    // exists). Whether the email was actually accepted for delivery is a
    // SEPARATE fact, reported as its own line -- never folded into a single
    // "Invitation sent" claim that would be false whenever the provider
    // failed or isn't configured.
    const emailLine = emailStatus === "queued"
      ? { color: TEAL, text: `Invitation email queued for delivery to ${email}.` }
      : emailStatus === "not_configured"
        ? { color: AMBER, text: "Email delivery is not configured yet — share the link below directly." }
        : { color: AMBER, text: `The invitation email could not be sent${emailError ? ` (${emailError})` : ""} — share the link below directly.` };
    return (
      <Panel accent={TEAL}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: TEAL, marginBottom: 8 }}>Invitation created</div>
        <div style={{ fontFamily: UI, fontSize: 13, color: emailLine.color, marginBottom: 10 }}>
          {emailLine.text}
        </div>
        <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, marginBottom: 10 }}>
          This link is the only way {name} can accept this invitation — you can also send it yourself via WhatsApp, SMS, or any other channel.
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11.5, color: IVORY, background: BLACK, border: `1px solid ${BORDER}`, padding: "10px 12px", wordBreak: "break-all", marginBottom: 12 }}>
          {link}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); }}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", border: `1px solid ${BORDER}`, background: "transparent", color: IVORY, cursor: "pointer" }}>
            {copied ? "Copied ✓" : "Copy invitation link"}
          </button>
          <button onClick={onDone} style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>Done</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: AMBER, marginBottom: 14 }}>
        Invite person · step {step} of 4
      </div>

      {step === 1 && (
        <>
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe" aria-label="Name" style={inputStyle} />
          <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. john@example.com" type="email" aria-label="Email" style={inputStyle} />
          <button onClick={() => setStep(2)} disabled={!name.trim() || !email.trim()}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
              background: name.trim() && email.trim() ? TEAL : BORDER, color: BLACK, cursor: name.trim() && email.trim() ? "pointer" : "not-allowed" }}>Next →</button>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ fontFamily: UI, fontSize: 13, color: MUTED, marginBottom: 14 }}>What is {name}'s responsibility?</div>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {canOfferDirector && <RoleButton label="Campaign Director" active={role === "DIRECTOR"} onClick={() => setRole("DIRECTOR")} />}
            {canOfferLga && <RoleButton label="LGA Coordinator" active={role === "LGA_COORDINATOR"} onClick={() => setRole("LGA_COORDINATOR")} />}
            {canOfferWard && <RoleButton label="Ward Coordinator" active={role === "WARD_COORDINATOR"} onClick={() => setRole("WARD_COORDINATOR")} />}
            {canOfferPu && <RoleButton label="Polling-Unit Agent" active={role === "POLLING_UNIT_AGENT"} onClick={() => setRole("POLLING_UNIT_AGENT")} />}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <BackButton onClick={() => setStep(1)} />
            <button onClick={() => setStep(role === "DIRECTOR" ? 4 : 3)} disabled={!role}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: role ? TEAL : BORDER, color: BLACK, cursor: role ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div style={{ fontFamily: UI, fontSize: 13, color: MUTED, marginBottom: 14 }}>Where is {name} responsible?</div>
          {needsLga && (
            <>
              <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase" }}>LGA</div>
              <select value={lgaId} onChange={(e) => setLgaId(e.target.value)} aria-label="LGA" style={inputStyle}>
                <option value="">Select an LGA…</option>
                {availableLgas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </>
          )}
          {needsWard && (
            <>
              <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase" }}>Ward</div>
              {(myResponsibility?.responsibilityRole !== "LGA_COORDINATOR" && !lgaId) ? (
                <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 9 }}>Select an LGA first.</div>
              ) : wards.length === 0 ? (
                <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 9 }}>
                  Territory data will appear here when the authoritative reference data for this LGA is available.
                </div>
              ) : (
                <select value={wardId} onChange={(e) => setWardId(e.target.value)} aria-label="Ward" style={inputStyle}>
                  <option value="">Select a ward…</option>
                  {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
            </>
          )}
          {needsPu && (
            <>
              <div style={{ fontFamily: UI, fontSize: 10, color: MUTED, marginBottom: 4, textTransform: "uppercase" }}>
                Polling Unit{autoWardName ? ` — ${autoWardName}` : ""}
              </div>
              {!effectiveWardForPu ? (
                <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 9 }}>Select a ward first.</div>
              ) : pollingUnits.length === 0 ? (
                <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 9 }}>
                  Territory data will appear here when the authoritative reference data for this ward is available.
                </div>
              ) : (
                <select value={puId} onChange={(e) => setPuId(e.target.value)} aria-label="Polling Unit" style={inputStyle}>
                  <option value="">Select a polling unit…</option>
                  {pollingUnits.map((p) => <option key={p.id} value={p.id}>{p.code}{p.name ? ` — ${p.name}` : ""}</option>)}
                </select>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <BackButton onClick={() => setStep(2)} />
            <button onClick={() => setStep(4)} disabled={!territoryReady}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: territoryReady ? TEAL : BORDER, color: BLACK, cursor: territoryReady ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>Review</div>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.9, marginBottom: 16 }}>
            Person: <strong>{name}</strong> ({email})<br />
            Role: <strong>{roleLabel}</strong><br />
            {role !== "DIRECTOR" && <>Territory: <strong>{[lgaName, wardName, puLabel].filter(Boolean).join(" → ")}</strong><br /></>}
            {/* ELECTIONCANON 1.1.1 PHASE A — this was mislabeled "Campaign:"
                while showing tree?.constituency?.name, never campaigns.name;
                a constituency and a campaign are different real facts (see
                electionBootstrap.js's own campaigns.name vs this component's
                own territory-tree resolution) — fixed to the correct label,
                the value itself was always correct. */}
            Constituency: <strong>{tree?.constituency?.name ?? "—"}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <BackButton onClick={() => setStep(role === "DIRECTOR" ? 2 : 3)} />
            <button onClick={send} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy ? BORDER : TEAL, color: BLACK, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Sending…" : "Send Invitation"}</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

function RoleButton({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", fontFamily: UI, fontWeight: 700, fontSize: 13, padding: "12px 14px",
      cursor: "pointer", background: active ? "rgba(10,180,160,0.12)" : BLACK, border: `1px solid ${active ? TEAL : BORDER}`, color: IVORY }}>
      {label}
    </button>
  );
}
function BackButton({ onClick }) {
  return (
    <button onClick={onClick} style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
      padding: "11px 18px", cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>← Back</button>
  );
}

export default function OrganisationSection({ ctx, campaignId, refresh, inviteHint = null, onInviteHintConsumed }) {
  const [inviting, setInviting] = useState(false);
  // ELECTIONCANON 1.1 HOME OPERATING CONSOLE — captured into OWN local
  // state (not read live off the `inviteHint` prop) the moment it arrives,
  // then the parent is told to clear its copy. Election.jsx clears
  // `inviteHint` in the SAME tick that this component starts `inviting`,
  // which would otherwise hand InviteWizard a null `invitePrefill` on the
  // render where it actually mounts — capturing it here avoids that race.
  const [invitePrefill, setInvitePrefill] = useState(null);
  useEffect(() => {
    if (!inviteHint) return;
    setInvitePrefill(inviteHint);
    setInviting(true);
    onInviteHintConsumed?.();
  }, [inviteHint]); // eslint-disable-line
  const [invitations, setInvitations] = useState([]);
  const [userId, setUserId] = useState(null);
  const [members, setMembers] = useState([]);
  // FIX (production verification pass) — fetched once here, the same way
  // TerritorySection.jsx fetches it for TerritoryExplorer, and passed down
  // to InviteWizard so it can tell a state-level office (Governor,
  // President — no constituency) apart from a constituency-bound one. See
  // InviteWizard's own comment on why this was missing.
  const [offices, setOffices] = useState([]);
  const [officesLoaded, setOfficesLoaded] = useState(false);
  // PRE-LAUNCH UX CLEANUP PASS — the signed-in viewer's OWN identity, for
  // nameFor() below. Never a raw id: falls back through profile display
  // name, then the account's own email, matching profileResolver.js's own
  // PROFILE_COLUMNS convention (the same self-profile read every other
  // identity surface in this app already uses).
  const [myIdentity, setMyIdentity] = useState(null);

  const loadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
    if (user) {
      const { data: profileRow } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      setMyIdentity({ email: user.email ?? null, displayName: profileRow?.display_name ?? null });
    } else {
      setMyIdentity(null);
    }
    const { data: invData } = await listInvitations({ client: supabase, campaignId });
    setInvitations(invData ?? []);
    if (!officesLoaded) {
      const { data: officesData } = await listOffices({ client: supabase });
      setOffices(officesData ?? []);
      setOfficesLoaded(true);
    }
    const { data: memberData } = await supabase.from("campaign_members").select("person, member_role, status").eq("campaign_id", campaignId).eq("status", "active");
    setMembers(memberData ?? []);
  };

  useEffect(() => { loadAll(); }, [campaignId]); // eslint-disable-line

  const territory = ctx.view?.territory ?? null;
  const view = ctx.view ?? {};
  const myMemberRow = members.find((m) => m.person === userId);
  const myRole = myMemberRow?.member_role ?? null;
  const myResponsibility = resolveMyResponsibility({ view, campaignId, userId });
  // GATE A — FIX: canInvite previously fired for ANY held responsibility
  // (`myResponsibility != null`), which meant a Polling-Unit Agent — who
  // InviteWizard's own canOfferDirector/Lga/Ward/Pu booleans (below,
  // mirrored here) ALL correctly evaluate false for — still saw the
  // "+ Invite Person" button, then hit step 2 with zero role choices to
  // pick from: a dead end. canInvite now mirrors the SAME real offerable-
  // role check InviteWizard already performs, so the button only ever
  // appears when there is truly something this viewer could offer.
  const canOfferDirector = myRole === "owner" || myRole === "manager";
  const canOfferLga = myRole === "owner" || myRole === "manager";
  const canOfferWard = myRole === "owner" || myRole === "manager" || myResponsibility?.responsibilityRole === "LGA_COORDINATOR";
  const canOfferPu = myRole === "owner" || myRole === "manager" || myResponsibility?.responsibilityRole === "WARD_COORDINATOR";
  const canInvite = canOfferDirector || canOfferLga || canOfferWard || canOfferPu;

  const revoke = async (invitationId) => {
    await revokeInvitation({ client: supabase, invitationId });
    await loadAll();
  };

  // PRE-LAUNCH UX CLEANUP PASS — never a raw uid fragment. See
  // resolveMemberDisplayName()'s own header above for the resolution order.
  const nameFor = (uid) => resolveMemberDisplayName({ uid, campaignId, userId, myIdentity, view, invitations });
  const roleFor = (uid) => {
    const resp = Object.values(view.responsibilities ?? {}).find((r) => r.person === `invite:${campaignId}:${uid}`);
    return resp ? RESPONSIBILITY_ROLE_LABEL[resp.responsibilityRole] : (members.find((m) => m.person === uid)?.member_role === "owner" ? "Campaign Owner" : members.find((m) => m.person === uid)?.member_role === "manager" ? "Campaign Director" : "Team member");
  };
  const territoryFor = (uid) => {
    const resp = Object.values(view.responsibilities ?? {}).find((r) => r.person === `invite:${campaignId}:${uid}`);
    return resp?.geographyRef ?? null;
  };

  return (
    <div>
      <Label>Campaign Organisation</Label>
      <Panel>
        {members.length === 0 ? (
          <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No team members yet.</div>
        ) : members.map((m) => (
          <div key={m.person} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{nameFor(m.person)}</div>
              <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>{roleFor(m.person)}{territoryFor(m.person) ? ` · ${territoryFor(m.person)}` : ""}</div>
            </div>
            <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: TEAL, border: `1px solid ${TEAL}`, padding: "3px 8px" }}>ACTIVE</span>
          </div>
        ))}
      </Panel>

      {invitations.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Label>Invitations</Label>
          <Panel>
            {invitations.map((i) => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{i.invited_name}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {i.intended_responsibility_role ? RESPONSIBILITY_ROLE_LABEL[i.intended_responsibility_role] : "Campaign Director"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: STATUS_COLOR[i.status], border: `1px solid ${STATUS_COLOR[i.status]}`, padding: "3px 8px" }}>{i.status}</span>
                  {i.status === "pending" && (myRole === "owner" || myRole === "manager") && (
                    <button onClick={() => revoke(i.id)} style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, color: PINK, background: "transparent", border: "none", cursor: "pointer" }}>Revoke</button>
                  )}
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {!territory ? (
        <div style={{ marginTop: 18 }}>
          <Panel accent={PINK}><div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>Set your territory in the Territory tab before inviting people.</div></Panel>
        </div>
      ) : !canInvite ? null : !officesLoaded ? (
        <div style={{ marginTop: 18 }}>
          <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Loading territory…</div></Panel>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          {!inviting ? (
            <button onClick={() => setInviting(true)}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 20px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>
              + Invite Person
            </button>
          ) : (
            <InviteWizard campaignId={campaignId} refresh={loadAll} territory={territory} offices={offices} myRole={myRole} myResponsibility={myResponsibility}
              invitePrefill={invitePrefill} onDone={() => { setInviting(false); setInvitePrefill(null); }} />
          )}
        </div>
      )}
    </div>
  );
}
