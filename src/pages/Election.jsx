// ============================================================
// FORGE ELECTION — WEB SURFACE  (Alpha 1.0)
//
// ELECTION FORGE IS A SINGULAR PRODUCT. A person using this page should
// never need to know Business Forge, Manufacturing Forge, or "Forge
// Platform" exist — App.jsx suppresses the shared kernel chrome
// (InstRail/OSRail/RoomLocator/footer) on every `/election*` path for
// exactly this reason; this file supplies its own header and section nav
// in their place.
//
// THE VALIDATED CANON PATH IS UNCHANGED. `readElectionCanon`,
// `activateElection`, `prepareElectionWrite`, `approveElectionWrite` are
// called exactly as before — this file does not touch electionWebAdapter.js's
// existing exports, electionContext.js, electionScope.js,
// electionBootstrap.js, any migration, or any pre-existing Election
// domain/events/projections file's existing behavior.
//
// ALPHA 1.0 restructures the product shell around that unchanged Canon:
// shared atoms (Label/Panel/StatusChip/WriteActionPanel/ForgeHeader/...)
// moved to ./election/shared.jsx so the new Mobilize/Chat/Campaign
// Studio/Election Day/Intelligence sections can reuse them; those five
// sections plus Home (replacing the old Dashboard) live in ./election/ as
// their own files. Mobilization and Election Day read/write through NEW
// event types folded by the SAME projectElection() (see
// src/domains/election/events.js's own header for why no migration was
// needed for them); Chat and Campaign Studio read/write through two new,
// RLS-protected tables (see the Alpha 1.0 migration).
//
// CANON HONESTY, PRESERVED EXACTLY. UNKNOWN/INCOMPLETE/AT_RISK/COMPLETE —
// deriveReadiness()'s own four words — are still rendered as exactly those
// four words, never translated into a percentage or a colour-only signal.
// ============================================================

import { useState, useCallback, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase, isConfigured } from "../lib/supabase.js";
import { useIdentity } from "../os/ForgeIdentity.jsx";
import { FORGE_CLIPS } from "../os/geometry.js";
import { normalizeUrl } from "../lib/urlNormalize.js";
import {
  readElectionCanon, activateElection, prepareElectionWrite, approveElectionWrite, WRITE_CHANNEL,
} from "../os/electionWebAdapter.js";
import { ACTIVATION, ACTOR_KIND } from "../os/electionContext.js";
import { ELECTION_SCOPE } from "../os/electionScope.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../domains/election/studio/readiness.js";
import { listOffices, getConstituencyTerritory } from "../domains/election/geography/read.js";
import {
  ForgeHeader, WriteActionPanel, Label, Panel, ClaimRow, GapRow, NotStartedRow,
  friendlyError, UI, DISPLAY, BLACK, IVORY, TEAL, AMBER, PINK, MUTED, BORDER, inputStyle,
  CAPABILITIES_AVAILABLE_NOW, CAPABILITIES_COMING_NEXT, parseCampaignTitle,
} from "./election/shared.jsx";
import HomeSection from "./election/HomeSection.jsx";
import TerritorySection from "./election/TerritorySection.jsx";
import OrganisationSection from "./election/OrganisationSection.jsx";
import MobilizeSection from "./election/MobilizeSection.jsx";
import ChatSection from "./election/ChatSection.jsx";
import CampaignStudioSection from "./election/CampaignStudioSection.jsx";
import ElectionDaySection from "./election/ElectionDaySection.jsx";
import IntelligenceSection from "./election/IntelligenceSection.jsx";

/** Only these four words, ever, for a REAL Canon claim — the exact vocabulary deriveReadiness() uses. */
const STATUS_COLOR = Object.freeze({
  [STATUS.COMPLETE]: TEAL, [STATUS.INCOMPLETE]: MUTED, [STATUS.AT_RISK]: PINK, [STATUS.UNKNOWN]: AMBER,
});

// ============================================================
// WELCOME / ONBOARDING — the front door. A welcome screen that states
// plainly what ElectionCanon does today, then a setup step that leads
// straight into the SAME, unchanged activateElection() call the rest of
// this file already uses — no new backend path, no manufactured record.
//
// ACTOR-KIND CHOICE IS REAL, NOT INVENTED. Only the two actor kinds with a
// real, live readiness engine (candidate_campaign, observer_organisation —
// see electionContext.js's own `deriveFor` routing) are offered.
//
// ELECTION TYPE IS NOT A CANON FACT. `campaigns` has no election-type
// column — the selection here is folded into the free-text workspace name
// the existing `campaigns.name` field already safely holds.
const ACTOR_CHOICES = Object.freeze([
  { kind: ACTOR_KIND.CANDIDATE_CAMPAIGN, label: "Candidate / Candidate Campaign",
    note: "Track your own registration, ward coverage and campaign preparation." },
  { kind: ACTOR_KIND.OBSERVER_ORGANISATION, label: "Observer / Monitoring Organisation",
    note: "Track observer deployment and coverage across your assignment area." },
]);

const ELECTION_TYPES = Object.freeze([
  "Presidential", "Senatorial", "House of Representatives", "Governorship", "State House of Assembly",
]);

// PRE-LAUNCH UX CLEANUP PASS (P2-5) — the primary "what do I do now"
// answer on a first-time user's very first screen, ahead of the full
// capability list. Mirrors the real product journey (Territory ->
// Organisation -> Responsibility -> Readiness -> Coordination) already
// live-verified end to end.
const WHAT_YOU_DO_NOW = Object.freeze([
  "Set up your campaign.",
  "Map your territory.",
  "Build your organisation.",
  "Assign responsibility.",
  "Track readiness.",
  "Coordinate.",
]);


function ChoiceButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", fontFamily: UI,
        padding: "12px 14px", marginBottom: 8, cursor: "pointer",
        background: active ? "rgba(10,180,160,0.12)" : BLACK,
        border: `1px solid ${active ? TEAL : BORDER}`, color: IVORY, clipPath: FORGE_CLIPS.buttonSm }}>
      {children}
    </button>
  );
}

function WelcomeOnboarding({ onActivate, busy, error }) {
  const [step, setStep] = useState("welcome"); // "welcome" | "setup"
  const [actorKind, setActorKind] = useState(ACTOR_KIND.CANDIDATE_CAMPAIGN);
  const [electionType, setElectionType] = useState(null);
  const [name, setName] = useState("");

  const submit = () => {
    const clean = name.trim();
    if (!clean) return;
    const finalName = electionType ? `[${electionType}] ${clean}` : clean;
    onActivate(finalName, actorKind);
  };

  if (step === "welcome") {
    return (
      <div style={{ maxWidth: 720 }}>
        <Label>Welcome</Label>
        <Panel accent={AMBER}>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(24px,3.4vw,34px)",
            letterSpacing: "-0.03em", lineHeight: 1.15, margin: "0 0 14px", color: IVORY }}>
            ElectionCanon
          </h1>
          <p style={{ fontFamily: UI, fontSize: 13.5, color: MUTED, lineHeight: 1.7, marginBottom: 22 }}>
            ElectionCanon is an operating system for preparing, coordinating and safeguarding
            democratic elections. Here's what you'll do:
          </p>
          <ol style={{ margin: "0 0 26px", padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            {WHAT_YOU_DO_NOW.map((step, i) => (
              <li key={step} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 14, color: TEAL, width: 20, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ fontFamily: UI, fontSize: 13.5, color: IVORY }}>{step}</span>
              </li>
            ))}
          </ol>
          <button onClick={() => setStep("setup")}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: "0.12em",
              textTransform: "uppercase", padding: "13px 24px", border: "none",
              background: AMBER, color: BLACK, cursor: "pointer", clipPath: FORGE_CLIPS.button }}>
            Get Started →
          </button>

          {/* PRE-LAUNCH UX CLEANUP PASS (P2-5) — the full capability list
              moved below the primary CTA, out of the critical path a
              first-time user has to scroll past before they can start.
              Still reads from the SAME single source of truth
              (shared.jsx's CAPABILITIES_AVAILABLE_NOW/COMING_NEXT) — no
              duplicated list, nothing deleted, just de-prioritised. */}
          <details style={{ marginTop: 28 }}>
            <summary style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
              textTransform: "uppercase", color: MUTED, cursor: "pointer" }}>
              What's already built, and what's next
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 14, marginTop: 16 }}>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: TEAL, marginBottom: 8 }}>Available now</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
                  {CAPABILITIES_AVAILABLE_NOW.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
              <div>
                <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: AMBER, marginBottom: 8 }}>Coming next</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.9 }}>
                  {CAPABILITIES_COMING_NEXT.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            </div>
          </details>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Label>Set up your election workspace</Label>
      <Panel accent={AMBER}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>What are you preparing for?</div>
        {ACTOR_CHOICES.map((c) => (
          <ChoiceButton key={c.kind} active={actorKind === c.kind} onClick={() => setActorKind(c.kind)}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{c.label}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{c.note}</div>
          </ChoiceButton>
        ))}

        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase", color: TEAL, margin: "18px 0 10px" }}>
          What election are you preparing for? <span style={{ color: MUTED, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          {ELECTION_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setElectionType(electionType === t ? null : t)}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, padding: "8px 14px", cursor: "pointer",
                background: electionType === t ? "rgba(10,180,160,0.12)" : BLACK,
                border: `1px solid ${electionType === t ? TEAL : BORDER}`, color: IVORY,
                clipPath: FORGE_CLIPS.buttonSm }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 18, lineHeight: 1.5 }}>
          ElectionCanon does not yet track election level as its own Canon fact — this becomes part
          of your workspace name below, which the Canon does record.
        </div>

        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.14em",
          textTransform: "uppercase", color: TEAL, marginBottom: 10 }}>Workspace name</div>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ada for LG Chair, Ward 7" aria-label="Workspace name"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: UI, fontSize: 13,
            padding: "11px 13px", background: BLACK, color: IVORY,
            border: `1px solid ${BORDER}`, outline: "none", marginBottom: 16 }} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={submit} disabled={busy || !name.trim()}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em",
              textTransform: "uppercase", padding: "13px 22px", border: "none",
              background: busy || !name.trim() ? BORDER : AMBER, color: busy || !name.trim() ? MUTED : BLACK,
              cursor: busy || !name.trim() ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
            {busy ? "Creating…" : "Create My Election Workspace →"}
          </button>
          <button onClick={() => setStep("welcome")} disabled={busy}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em",
              textTransform: "uppercase", padding: "13px 18px", cursor: busy ? "not-allowed" : "pointer",
              background: "transparent", color: MUTED, border: `1px solid ${BORDER}`, clipPath: FORGE_CLIPS.button }}>
            ← Back
          </button>
        </div>
        {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 14 }}>{friendlyError(error)}</div>}
      </Panel>
    </div>
  );
}

const SCOPE_MESSAGE = Object.freeze({
  [ELECTION_SCOPE.NONE]: null, // handled by WelcomeOnboarding instead
  [ELECTION_SCOPE.AMBIGUOUS]: "You belong to more than one campaign — this screen does not yet let you choose which.",
  [ELECTION_SCOPE.REFUSED]: "That campaign is not accessible to this account.",
  [ELECTION_SCOPE.READ_FAILED]: "Campaign membership could not be read right now.",
});

/** A real, computed count — not a formal Canon readiness claim (no
 *  COMPLETE/INCOMPLETE status), but not fabricated either: exactly the
 *  same folded view Mobilize/Election Day themselves render. Used for the
 *  Alpha 1.1 readiness areas that now have real cross-section data
 *  (Mobilization, Wards, Polling Units, Agents, Communications, Evidence)
 *  but no `deriveReadiness()` dimension of their own yet. */
function CountRow({ label, note }) {
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, color: IVORY, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 2 }}>{note}</div>
    </div>
  );
}

/** Readiness — the same claims/gaps the Canon actually computes, organised
 *  into the 10 practical election areas Alpha 1.1 asks for. A claim area
 *  renders ClaimRow (a real Canon dimension), a data area renders CountRow
 *  (real cross-section data, no formal claim yet), and a genuinely empty
 *  area renders NotStartedRow — never a fabricated claim or score. */
// FIRST-USER COMPLETION PASS (item 1) — a real, structured entry point for
// candidate registration, routed through the EXISTING, unchanged
// matchCandidateRegister()/proposeElectionWrite()/executeElectionWrite()
// pipeline (studio/write.js) — no new Canon model, no new event type. That
// pipeline only ever accepted one free-text command ("Register <name> as
// candidate for <office> in <constituency>, <party>."), typeable only via
// WriteActionPanel, which is mounted on Intelligence — not Readiness, where
// Home's "Continue Preparation" actually sends the user. This panel asks
// for exactly the two pieces of information the domain model doesn't
// already have (name, party) — office and constituency are read from the
// campaign's own already-set Territory, never re-asked — then constructs
// the identical command string internally and calls the SAME
// prepareElectionWrite/approveElectionWrite the free-text panel always
// used. A real Canon event is what gets recorded; nothing here fabricates
// completion.
function CandidateRegistrationPanel({ ctx, campaignId, refresh }) {
  const territory = ctx.view?.territory ?? null;
  const [officeName, setOfficeName] = useState(null);
  const [constituencyName, setConstituencyName] = useState(null);
  const [loadingTerritory, setLoadingTerritory] = useState(true);
  const [name, setName] = useState("");
  const [party, setParty] = useState("");
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!territory) { setLoadingTerritory(false); return undefined; }
    (async () => {
      const [{ data: offices }, { data: tree }] = await Promise.all([
        listOffices({ client: supabase }),
        territory.constituency ? getConstituencyTerritory({ client: supabase, constituencyId: territory.constituency }) : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setOfficeName(offices?.find((o) => o.id === territory.office)?.name ?? territory.office ?? null);
      setConstituencyName(tree?.constituency?.name ?? null);
      setLoadingTerritory(false);
    })();
    return () => { cancelled = true; };
  }, [territory?.office, territory?.constituency]); // eslint-disable-line

  if (!territory) {
    return (
      <Panel accent={PINK}>
        <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.6 }}>
          Set your Territory (election, office, and constituency) before registering a candidate —
          ElectionCanon needs to know where this candidate is standing.
        </div>
      </Panel>
    );
  }
  if (loadingTerritory) {
    return <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Resolving territory…</div></Panel>;
  }

  const doPrepare = async () => {
    const cleanName = name.trim(), cleanParty = party.trim();
    if (!cleanName || !cleanParty) { setError("Candidate name and party are both required."); return; }
    const message = `Register ${cleanName} as candidate for ${officeName} in ${constituencyName}, ${cleanParty}.`;
    setBusy(true); setError(null);
    const result = await prepareElectionWrite({ client: supabase, requestedCampaign: campaignId, message });
    setBusy(false);
    if (result.status !== "PREPARED") {
      setError(result.reason ?? `could not prepare candidate registration: ${result.status}`);
      return;
    }
    setPrepared({ draft: result.draft, confirmationId: crypto.randomUUID() });
  };

  const doApprove = async () => {
    if (!prepared) return;
    setBusy(true); setError(null);
    const result = await approveElectionWrite({
      client: supabase, requestedCampaign: campaignId,
      draft: prepared.draft.draft, confirmationId: prepared.confirmationId,
    });
    setBusy(false);
    if (!result.success) { setError(result.error ?? "could not record candidate registration"); return; }
    setPrepared(null); setName(""); setParty("");
    await refresh();
  };

  return (
    <Panel accent={AMBER}>
      <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: AMBER, marginBottom: 10 }}>Complete candidate registration</div>
      <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
        Office: <span style={{ color: IVORY }}>{officeName ?? "—"}</span><br />
        Constituency: <span style={{ color: IVORY }}>{constituencyName ?? "—"}</span>
        <div style={{ marginTop: 4 }}>Already set on Territory — not asked again here.</div>
      </div>
      {!prepared ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate's full name"
            aria-label="Candidate name" style={{ ...inputStyle, marginBottom: 9 }} />
          <input value={party} onChange={(e) => setParty(e.target.value)} placeholder="Party"
            aria-label="Party" style={{ ...inputStyle, marginBottom: 9 }} />
          <button onClick={doPrepare} disabled={busy || !name.trim() || !party.trim()}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
              textTransform: "uppercase", padding: "11px 18px", border: "none",
              background: busy || !name.trim() || !party.trim() ? BORDER : AMBER, color: BLACK,
              cursor: busy || !name.trim() || !party.trim() ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
            {busy ? "Preparing…" : "Prepare"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
            textTransform: "uppercase", color: TEAL, marginBottom: 6 }}>Review</div>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, marginBottom: 6 }}>{prepared.draft.summary}</div>
          <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginBottom: 14 }}>{prepared.draft.notice}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={doApprove} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", border: "none",
                background: busy ? BORDER : AMBER, color: BLACK,
                cursor: busy ? "not-allowed" : "pointer", clipPath: FORGE_CLIPS.button }}>
              {busy ? "Recording…" : "Approve"}
            </button>
            <button onClick={() => setPrepared(null)} disabled={busy}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", padding: "11px 18px", cursor: "pointer",
                background: "transparent", color: MUTED, border: `1px solid ${BORDER}`,
                clipPath: FORGE_CLIPS.button }}>Cancel</button>
          </div>
        </>
      )}
      {error && <div style={{ fontFamily: UI, fontSize: 12.5, color: PINK, marginTop: 12 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

function ReadinessSection({ ctx, campaignId, refresh }) {
  const byDim = Object.fromEntries(ctx.readiness.claims.map((c) => [c.dimension, c]));
  const view = ctx.view ?? {};
  const people = Object.values(view.people ?? {});
  const wards = Object.values(view.wards ?? {});
  const pollingUnits = Object.values(view.pollingUnits ?? {});
  const agents = Object.values(view.agents ?? {});
  const incidents = Object.values(view.incidents ?? {});
  const results = Object.values(view.results ?? {});

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Readiness claims (CANON)</Label>
        <Panel>
          {ctx.readiness.claims.map((c, i) => <ClaimRow key={i} claim={c} statusColor={STATUS_COLOR} />)}
        </Panel>
      </div>

      <div>
        <Label>Known ward coverage</Label>
        <Panel accent={AMBER}>
          {ctx.readiness.knownWardCoverage ? (
            <>
              <div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
                {ctx.readiness.knownWardCoverage.knownWards} known ·{" "}
                {ctx.readiness.knownWardCoverage.assignedWards} assigned ·{" "}
                {ctx.readiness.knownWardCoverage.healthyWards} healthy ·{" "}
                {ctx.readiness.knownWardCoverage.atRiskWards} at-risk ·{" "}
                {ctx.readiness.knownWardCoverage.unreportedWards} unreported
              </div>
              <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
                {ctx.readiness.knownWardCoverage.note}
              </div>
            </>
          ) : (
            <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>
              No ward coverage computed for this actor kind yet.
            </div>
          )}
        </Panel>
      </div>

      {ctx.readiness.gaps.length > 0 && (
        <div>
          <Label>Gaps (CANON-derived)</Label>
          <Panel accent={PINK}>
            {ctx.readiness.gaps.map((g, i) => <GapRow key={i} gap={g} />)}
          </Panel>
        </div>
      )}

      <div style={{ gridColumn: "1 / -1", marginTop: 6 }}>
        <Label>Readiness by area — the same Canon claims and folded data above, organised for campaign preparation</Label>
      </div>

      <div style={{ gridColumn: byDim.CANDIDATE_REGISTERED && byDim.CANDIDATE_REGISTERED.status !== STATUS.COMPLETE && ctx.actorKind === ACTOR_KIND.CANDIDATE_CAMPAIGN ? "1 / -1" : "auto" }}>
        <Label>1 · Candidate</Label>
        <Panel>
          {byDim.CANDIDATE_REGISTERED
            ? <ClaimRow claim={byDim.CANDIDATE_REGISTERED} statusColor={STATUS_COLOR} />
            : <NotStartedRow label="CANDIDATE_REGISTERED" note="No candidate registration recorded for this actor kind." />}
        </Panel>
        {byDim.CANDIDATE_REGISTERED && byDim.CANDIDATE_REGISTERED.status !== STATUS.COMPLETE
          && ctx.actorKind === ACTOR_KIND.CANDIDATE_CAMPAIGN && (
          <div style={{ marginTop: 12 }}>
            <CandidateRegistrationPanel ctx={ctx} campaignId={campaignId} refresh={refresh} />
          </div>
        )}
      </div>

      <div>
        <Label>2 · Legal / documentation</Label>
        <Panel>
          <NotStartedRow label="REQUIRED_DOCUMENTS" note="Not yet tracked by ElectionCanon." />
        </Panel>
      </div>

      <div>
        <Label>3 · Organisation</Label>
        <Panel>
          {byDim.OBSERVER_ASSIGNMENT
            ? <ClaimRow claim={byDim.OBSERVER_ASSIGNMENT} statusColor={STATUS_COLOR} />
            : <NotStartedRow label="AGENTS / OBSERVERS" note="Not yet tracked for this actor kind." />}
          <CountRow label="PEOPLE" note={people.length ? `${people.length} person${people.length === 1 ? "" : "s"} in the roster.` : "No people added yet — see Mobilize."} />
        </Panel>
      </div>

      <div>
        <Label>4 · Wards</Label>
        <Panel>
          {byDim.WARD_ASSIGNMENT
            ? <ClaimRow claim={byDim.WARD_ASSIGNMENT} statusColor={STATUS_COLOR} />
            : <NotStartedRow label="WARD_ASSIGNMENT" note="No ward assignment recorded yet." />}
          {byDim.WARD_STATUS_HEALTH
            ? <ClaimRow claim={byDim.WARD_STATUS_HEALTH} statusColor={STATUS_COLOR} />
            : <NotStartedRow label="WARD_STATUS_HEALTH" note="No ward status reported yet." />}
          <CountRow label="WARD_COVERAGE" note={wards.length ? `${wards.length} ward${wards.length === 1 ? "" : "s"} known · ${wards.filter((w) => w.organisation).length} with a coordinator.` : "No wards recorded yet."} />
        </Panel>
      </div>

      <div>
        <Label>5 · Polling units</Label>
        <Panel>
          <CountRow label="POLLING_UNITS" note={pollingUnits.length ? `${pollingUnits.length} polling unit${pollingUnits.length === 1 ? "" : "s"} configured. See Election Day.` : "Not yet tracked by ElectionCanon — see Election Day."} />
        </Panel>
      </div>

      <div>
        <Label>6 · Agents</Label>
        <Panel>
          <CountRow label="AGENT_DEPLOYMENT" note={agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"} assigned across polling units.` : "Not yet tracked by ElectionCanon — see Election Day."} />
        </Panel>
      </div>

      <div>
        <Label>7 · Mobilization</Label>
        <Panel>
          <CountRow label="ASSIGNMENTS_AND_TASKS" note={`${Object.keys(view.assignments ?? {}).length} assignment(s) · ${Object.keys(view.tasks ?? {}).length} task(s) recorded. See Mobilize.`} />
        </Panel>
      </div>

      <div>
        <Label>8 · Communications</Label>
        <Panel>
          <NotStartedRow label="COORDINATION_CHANNELS" note="Room/message counts are shown live on Home and in Chat — not yet a formal Canon readiness dimension." />
        </Panel>
      </div>

      <div>
        <Label>9 · Election day</Label>
        <Panel>
          <NotStartedRow label="ESCALATION_CONTACTS" note="Not yet tracked by ElectionCanon." />
          <CountRow label="RESULT_CAPTURE" note={results.length ? `${results.length} simulated result(s) captured. See Election Day.` : "No results captured yet."} />
        </Panel>
      </div>

      <div>
        <Label>10 · Evidence / incident preparedness</Label>
        <Panel>
          <NotStartedRow label="CAMPAIGN_DOCUMENTS" note="Not yet tracked by ElectionCanon." />
          <CountRow label="INCIDENT_LOG" note={incidents.length ? `${incidents.length} incident(s) logged, ${incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "CLOSED").length} unresolved.` : "No incidents logged yet — see Election Day."} />
        </Panel>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <WriteActionPanel campaignId={campaignId} refresh={refresh} />
      </div>
    </div>
  );
}

function SettingsSection({ ctx, workspaceName }) {
  return (
    <Panel>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 2 }}>
        Workspace name: <span style={{ color: TEAL }}>{workspaceName ?? "—"}</span><br />
        Campaign ID: <span style={{ color: TEAL }}>{ctx?.scope?.campaignId ?? "—"}</span><br />
        Actor kind: <span style={{ color: TEAL }}>{ctx?.actorKind ?? "unknown"}</span><br />
        Membership role: <span style={{ color: TEAL }}>{ctx?.scope?.role ?? "—"}</span>
      </div>
    </Panel>
  );
}

/** Per-section browser tab title — see the title-management effect below. */
const TITLE_BY_SECTION = Object.freeze({
  home: "Home", readiness: "Readiness", mobilize: "Mobilization", chat: "Chat",
  studio: "Campaign Studio", "election-day": "Election Day", intelligence: "Intelligence", settings: "Settings",
});

export default function Election() {
  const nav = useNavigate();
  const { configured, loading: identityLoading, session, signOut } = useIdentity();

  const [ctx, setCtx] = useState(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateError, setActivateError] = useState(null);
  const [section, setSection] = useState("home");
  // ELECTIONCANON 1.1 HOME OPERATING CONSOLE — the only deep-link mechanism
  // this app has, since section-switching is local state, not a route (see
  // this file's own header). Home's "Invite Responsible Person" action
  // calls goToSection("organisation", {level, geographyRef, role}); nothing
  // else ever sets a second argument, so `inviteHint` stays null for every
  // ordinary tab switch. OrganisationSection consumes and clears it once
  // its InviteWizard mounts pre-filled, so returning to Organisation later
  // (via the tab bar, not another Home action) starts blank as normal.
  const [inviteHint, setInviteHint] = useState(null);
  const goToSection = useCallback((id, hint = null) => {
    setSection(id);
    setInviteHint(hint);
  }, []);
  const [workspaceName, setWorkspaceName] = useState(null);
  // PRE-LAUNCH UX CLEANUP PASS (P3) — the election type embedded in
  // campaigns.name's "[ElectionType] " prefix (see parseCampaignTitle()'s
  // own header in shared.jsx), split out once here so every existing
  // consumer of `workspaceName` (ForgeHeader, Settings, Campaign Studio)
  // keeps receiving a clean campaign name with zero changes on their side.
  const [workspaceElectionType, setWorkspaceElectionType] = useState(null);

  useEffect(() => { normalizeUrl(); }, []);

  // BROWSER TITLE — scoped to this page only. index.html's own <title> is
  // already "ElectionCanon — Election Operations Platform" in this
  // standalone repository, so this override is mostly redundant here (it
  // mattered more in the source monorepo, where this same page shared an
  // <title> with an unrelated manufacturing product). Left in place
  // unchanged — restoring the previous title on unmount is still correct
  // behavior for a page that can be mounted/unmounted within a client-side
  // route tree, and removing it isn't required by the extraction.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `ElectionCanon — ${TITLE_BY_SECTION[section] ?? "Election Operating System"}`;
    return () => { document.title = previousTitle; };
  }, [section]);

  // THE ONE READ PATH. Every render of Canon/readiness on this page comes
  // from calling this function again — never from mutating `ctx` in place.
  const refresh = useCallback(async () => {
    if (!session?.user) return;
    setCtxLoading(true);
    const result = await readElectionCanon({ client: supabase });
    setCtx(result);
    // The campaign's own workspace name (`campaigns.name`, what the user
    // actually typed at setup). A SECOND, additive read — never a second
    // scope decision — of a column the SAME "campaigns read own
    // membership" RLS policy already exposes to any active member.
    if (result?.scope?.campaignId) {
      const { data } = await supabase.from("campaigns").select("name")
        .eq("id", result.scope.campaignId).maybeSingle();
      const { name, electionType } = parseCampaignTitle(data?.name ?? null);
      setWorkspaceName(data?.name ? name : null);
      setWorkspaceElectionType(electionType);
    } else {
      setWorkspaceName(null);
      setWorkspaceElectionType(null);
    }
    setCtxLoading(false);
  }, [session?.user]);

  useEffect(() => { refresh(); }, [refresh]);

  // If this session arrived here after signing in FROM an invite-accept
  // page (see AcceptInvite.jsx's goToAuth()), send them straight back to
  // finish accepting rather than stranding them on a generic dashboard.
  useEffect(() => {
    if (!session?.user) return;
    let pendingToken = null;
    try {
      pendingToken = sessionStorage.getItem("electioncanon_pending_invite_token");
      // Cleared HERE, not only on successful acceptance — a user who
      // abandons the invite (backs out of AcceptInvite.jsx without
      // accepting) must not be trapped in a redirect loop back to it on
      // every future visit to /election. One redirect attempt is enough;
      // if they still want to accept, the link works again on its own.
      if (pendingToken) sessionStorage.removeItem("electioncanon_pending_invite_token");
    } catch { /* best effort */ }
    if (pendingToken) nav(`/invite/${pendingToken}`, { replace: true });
  }, [session?.user, nav]);

  // FIRST-LOGIN WELCOME — a one-time banner after accepting an invitation
  // (AcceptInvite.jsx navigates here with ?welcome=1), never a new DB flag.
  const [showWelcome, setShowWelcome] = useState(() => new URLSearchParams(window.location.search).get("welcome") === "1");

  const doActivate = useCallback(async (name, actorKind) => {
    setActivateBusy(true); setActivateError(null);
    const result = await activateElection({ client: supabase, name, actorKind });
    setActivateBusy(false);
    if (result.outcome !== ACTIVATION.CREATED && result.outcome !== ACTIVATION.ALREADY_MEMBER) {
      setActivateError(result.error ?? `could not activate: ${result.outcome}`);
      return;
    }
    await refresh();
  }, [refresh]);

  const shell = (inner) => (
    <div className="forge-brand" style={{ background: BLACK, color: IVORY, minHeight: "100vh",
      padding: "clamp(28px,5vw,60px)", fontFamily: UI }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{inner}</div>
    </div>
  );

  if (!configured) {
    return shell(
      <>
        <ForgeHeader section={section} onSection={setSection} />
        <Panel accent={PINK}>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 28, letterSpacing: "-0.03em", margin: "0 0 10px" }}>
            ElectionCanon unavailable
          </h1>
          <p style={{ color: "rgba(245,241,233,.75)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            This deployment has no database credentials, so there is no Election Canon to show.
          </p>
        </Panel>
      </>
    );
  }

  if (identityLoading) return shell(<div style={{ color: MUTED, fontSize: 13 }}>Resolving identity…</div>);

  if (!session) {
    // PUBLIC INTRODUCTION PASS 1 — the unauthenticated pitch now lives at
    // the dedicated public landing page (src/pages/Landing.jsx), reached
    // directly at "/" with no identity-resolution delay. This is a single
    // source of truth for the pitch, not a second copy drifting apart from
    // it inside the authenticated app shell.
    return <Navigate to="/" replace />;
  }

  if (ctxLoading && !ctx) return shell(<div style={{ color: MUTED, fontSize: 13 }}>Loading Election Canon…</div>);

  const scopeOutcome = ctx?.scope?.outcome ?? null;
  const isFirstRun = scopeOutcome === ELECTION_SCOPE.NONE;
  const campaignId = ctx?.scope?.campaignId ?? null;
  const userId = session?.user?.id ?? null;

  return shell(
    <>
      <ForgeHeader section={section} onSection={goToSection} campaignName={workspaceName}
        onSignOut={signOut ? () => signOut() : null} showNav={!isFirstRun} />

      {isFirstRun && (
        <WelcomeOnboarding onActivate={doActivate} busy={activateBusy} error={activateError} />
      )}

      {scopeOutcome && SCOPE_MESSAGE[scopeOutcome] && (
        <Panel accent={PINK}><div style={{ fontFamily: UI, fontSize: 13, color: IVORY }}>
          {SCOPE_MESSAGE[scopeOutcome]}
        </div></Panel>
      )}

      {scopeOutcome === ELECTION_SCOPE.SCOPED && ctx.readiness && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button onClick={refresh} disabled={ctxLoading} style={{ fontFamily: UI, fontWeight: 700,
              fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", padding: "9px 16px",
              cursor: ctxLoading ? "not-allowed" : "pointer", background: "transparent", color: MUTED,
              border: `1px solid ${BORDER}`, clipPath: FORGE_CLIPS.button }}>
              {ctxLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {showWelcome && (
            <Panel accent={TEAL} style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL, marginBottom: 8 }}>
                Welcome to ElectionCanon
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 20, color: IVORY, marginBottom: 6 }}>
                You have joined {workspaceName || "this campaign"}
              </div>
              <div style={{ fontFamily: UI, fontSize: 13, color: MUTED, marginBottom: 14 }}>
                Head to Territory or Organisation to see your role and responsibility.
              </div>
              <button onClick={() => { setShowWelcome(false); nav("/election", { replace: true }); }}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "11px 18px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>
                Go to My Campaign →
              </button>
            </Panel>
          )}
          {section === "home" && <HomeSection ctx={ctx} onSection={goToSection} campaignId={campaignId} refresh={refresh} workspaceName={workspaceName} electionType={workspaceElectionType} />}
          {section === "territory" && <TerritorySection ctx={ctx} campaignId={campaignId} refresh={refresh} onSection={goToSection} />}
          {section === "organisation" && <OrganisationSection ctx={ctx} campaignId={campaignId} refresh={refresh} inviteHint={inviteHint} onInviteHintConsumed={() => setInviteHint(null)} />}
          {section === "readiness" && <ReadinessSection ctx={ctx} campaignId={campaignId} refresh={refresh} />}
          {section === "mobilize" && <MobilizeSection ctx={ctx} campaignId={campaignId} refresh={refresh} />}
          {section === "chat" && <ChatSection campaignId={campaignId} userId={userId} />}
          {section === "studio" && <CampaignStudioSection campaignId={campaignId} userId={userId} workspaceName={workspaceName} />}
          {section === "election-day" && <ElectionDaySection ctx={ctx} campaignId={campaignId} userId={userId} refresh={refresh} />}
          {section === "intelligence" && <IntelligenceSection ctx={ctx} campaignId={campaignId} refresh={refresh} />}
          {section === "settings" && <SettingsSection ctx={ctx} workspaceName={workspaceName} />}
        </>
      )}
    </>
  );
}
