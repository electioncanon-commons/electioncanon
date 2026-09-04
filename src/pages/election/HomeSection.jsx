// ============================================================
// ELECTION FORGE — HOME  (Alpha 1.0 command centre)
//
// Replaces the old DashboardSection. Every metric below is either read
// straight off the Canon (readiness, mobilization, election day — all
// folded from real events) or explicitly reads "No data yet" — never a
// fabricated number. Communications/Campaign Studio summaries make one
// additional lightweight read each (chat unread counts, studio asset
// counts) since those live outside the event-sourced Canon (see
// chat/api.js and design/assets.js's own headers for why).
//
// ELECTIONCANON 1.1 HOME OPERATING CONSOLE — this file gained a Coverage
// Card, a Coverage Gaps/roster drill-down, a Change Responsibility flow,
// and a "What Changed" panel. Every one of them is a COMPOSITION over
// existing reads (coverage.js, geography/read.js, invitations/read.js,
// view.feed/view.responsibilities already in `ctx`) and the existing
// write path (prepareGeographyWrite/approveGeographyWrite ->
// write_responsibility()) — see HomeResponsibility.jsx's own header. Home
// remains a read/operational composition layer: it introduces no new fact,
// only new views onto facts recorded elsewhere.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import * as chatApi from "../../domains/election/chat/api.js";
import * as assetsApi from "../../domains/election/design/assets.js";
import { ACTOR_KIND } from "../../os/electionContext.js";
import { READINESS_DIMENSION_STATUS as STATUS } from "../../domains/election/studio/readiness.js";
import { TASK_STATUS, ASSIGNMENT_STATUS } from "../../domains/election/mobilization/write.js";
import { VERIFICATION_STATUS, INCIDENT_STATUS } from "../../domains/election/electionDay/write.js";
import { ELECTION_EVENT_TYPES } from "../../domains/election/events.js";
import { getConstituencyTerritory, getStateTerritory, listOffices } from "../../domains/election/geography/read.js";
import { getUncoveredTerritory } from "../../domains/election/geography/coverage.js";
import { listInvitations } from "../../domains/election/invitations/read.js";
import { resolveMemberDisplayName } from "./OrganisationSection.jsx";
import { CoverageCard, CoverageGapsPanel, ReassignResponsibilityPanel } from "./HomeResponsibility.jsx";
import { FORGE_CLIPS } from "../../os/geometry.js";
import { computeAttention } from "./attention.js";
import { Label, Panel, linkBtn, UI, DISPLAY, IVORY, MUTED, TEAL, AMBER, PINK, BLACK } from "./shared.jsx";

const EMPTY_COVERAGE = Object.freeze({ established: false, constituencyId: null, constituencyCovered: false, lgas: [], wards: [], totalWards: 0, coveredWards: 0 });

const TONE_COLOR = { danger: PINK, warning: AMBER };

const NEXT_ACTION_BY_DIMENSION = Object.freeze({
  CANDIDATE_REGISTERED: "Complete candidate registration.",
  WARD_ASSIGNMENT: "Prepare your first ward.",
  WARD_STATUS_HEALTH: "Report a ward's current status.",
  OBSERVER_ASSIGNMENT: "Assign your first observer.",
});

function SummaryCard({ label, accent, children, onOpen, openLabel }) {
  return (
    <div>
      <Label>{label}</Label>
      <Panel accent={accent}>
        {children}
        {onOpen && <button onClick={onOpen} style={{ ...linkBtn(), marginTop: 12 }}>{openLabel} →</button>}
      </Panel>
    </div>
  );
}

// CAMPAIGN ONBOARDING PASS — geography name lookups for MyScopeCard. One
// targeted single-row query per level (mirrors acceptInvitation()'s own
// lazy, single-row polling-unit lookup) — never an eager constituency-wide
// fetch just to show one coordinator their own territory's name.
const GEOGRAPHY_LOOKUP = Object.freeze({
  lga: { table: "geography_lgas", select: "id, name" },
  ward: { table: "geography_wards", select: "id, name" },
  polling_unit: { table: "geography_polling_units", select: "id, name, code" },
});

const RESPONSIBILITY_ROLE_LABEL = Object.freeze({
  CONSTITUENCY_LEAD: "Constituency Lead", LGA_COORDINATOR: "LGA Coordinator",
  WARD_COORDINATOR: "Ward Coordinator", POLLING_UNIT_AGENT: "Polling Unit Agent",
});

function MyScopeCard({ campaignId, userId, responsibility, onOpenChat }) {
  const [geographyName, setGeographyName] = useState(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const lookup = GEOGRAPHY_LOOKUP[responsibility.level];
    if (!lookup || !responsibility.geographyRef) { setGeographyName(null); return; }
    (async () => {
      const { data } = await supabase.from(lookup.table).select(lookup.select).eq("id", responsibility.geographyRef).maybeSingle();
      if (!cancelled) setGeographyName(data?.name ?? data?.code ?? null);
    })();
    return () => { cancelled = true; };
  }, [responsibility.level, responsibility.geographyRef]);

  const roleLabel = RESPONSIBILITY_ROLE_LABEL[responsibility.responsibilityRole] ?? "Coordinator";
  const levelLabel = { lga: "LGA", ward: "Ward", polling_unit: "Polling Unit" }[responsibility.level] ?? responsibility.level;

  const openChat = async () => {
    setOpening(true);
    await chatApi.ensureGeographyRoom({
      client: supabase, userId, campaignId, level: responsibility.level, geographyRef: responsibility.geographyRef,
      name: `${geographyName ?? levelLabel} Coordination`,
    });
    setOpening(false);
    onOpenChat();
  };

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <Label>Your scope</Label>
      <Panel accent={TEAL}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(18px,2.4vw,24px)", color: IVORY, marginBottom: 6 }}>
          {roleLabel}{geographyName ? ` — ${geographyName}` : ""}
        </div>
        <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: 14 }}>
          {levelLabel} · status: {responsibility.status ?? "ASSIGNED"} · training: {responsibility.trainingStatus ?? "NOT_STARTED"}
        </div>
        <button onClick={openChat} disabled={opening}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em",
            textTransform: "uppercase", padding: "12px 20px", border: "none", background: TEAL,
            color: BLACK, cursor: opening ? "default" : "pointer", clipPath: FORGE_CLIPS.button, opacity: opening ? 0.6 : 1 }}>
          {opening ? "Opening…" : `Open ${levelLabel} Coordination Chat →`}
        </button>
      </Panel>
    </div>
  );
}

export default function HomeSection({ ctx, onSection, campaignId: campaignIdProp, refresh, workspaceName, electionType }) {
  const [commsSummary, setCommsSummary] = useState(null);
  const [studioSummary, setStudioSummary] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [myIdentity, setMyIdentity] = useState(null);

  // `campaignIdProp` (Election.jsx now passes it directly) and the
  // pre-existing `ctx.scope.campaignId` derivation always agree — kept as a
  // fallback only so this component still works if ever rendered without
  // the prop (e.g. an isolated test).
  const campaignId = campaignIdProp ?? ctx?.scope?.campaignId;

  useEffect(() => {
    let cancelled = false;
    if (!campaignId) return;
    (async () => {
      const { rooms } = await chatApi.listRooms({ client: supabase, campaignId });
      if (cancelled) return;
      if (!rooms.length) { setCommsSummary({ unread: 0, rooms: 0 }); return; }
      const authUser = (await supabase.auth.getUser()).data?.user?.id;
      const { counts } = await chatApi.getUnreadCounts({ client: supabase, userId: authUser, rooms });
      if (cancelled) return;
      setCommsSummary({ unread: Object.values(counts).reduce((a, b) => a + b, 0), rooms: rooms.length });
    })();
    (async () => {
      const { assets } = await assetsApi.listAssets({ client: supabase, campaignId });
      if (cancelled) return;
      setStudioSummary({
        drafts: assets.filter((a) => a.status === "draft").length,
        published: assets.filter((a) => a.status === "published").length,
        scheduled: assets.filter((a) => a.status === "scheduled").length,
      });
    })();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setMyUserId(user?.id ?? null);
      if (!user) { setMyIdentity(null); return; }
      const { data: profileRow } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      if (!cancelled) setMyIdentity({ email: user.email ?? null, displayName: profileRow?.display_name ?? null });
    })();
    return () => { cancelled = true; };
  }, [campaignId]); // eslint-disable-line

  // ELECTIONCANON 1.1 HOME OPERATING CONSOLE — territory tree (the SAME
  // getConstituencyTerritory()/getStateTerritory() resolution
  // OrganisationSection.jsx already performs, mirrored here rather than
  // lifted to a shared cache — Design Gate 1 Part 2's own reasoning: a
  // plain indexed read at single-campaign scale needs no materialization),
  // real LGA/ward coverage (coverage.js, unchanged), and pending
  // invitations (invitations/read.js, unchanged). `reloadTick` lets a
  // reassignment/invite bump this WITHOUT re-deriving anything — it just
  // re-runs the same real reads.
  const [territoryTree, setTerritoryTree] = useState(null);
  const [coverage, setCoverage] = useState(EMPTY_COVERAGE);
  // ALL invitations, not just pending ones — resolveMemberDisplayName()'s
  // own accepted-invitation fallback branch needs accepted rows too, to
  // name a member who has no roster entry of their own (see that
  // function's header in OrganisationSection.jsx). `pendingInvites` below
  // is a derived view of this for the attention/gaps use case specifically.
  const [allInvitations, setAllInvitations] = useState([]);
  const pendingInvites = allInvitations.filter((i) => i.status === "pending");
  const [reloadTick, setReloadTick] = useState(0);
  const territory = ctx.view?.territory ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!campaignId || !territory) { setTerritoryTree(null); setCoverage(EMPTY_COVERAGE); return undefined; }
    (async () => {
      const { data: offices } = await listOffices({ client: supabase });
      if (cancelled) return;
      const office = offices?.find((o) => o.id === territory.office) ?? null;
      const isStateLevel = office?.boundary_level === "state" || office?.boundary_level === "national";
      const hasResolvableTerritory = Boolean(territory.constituency) || isStateLevel;
      if (!hasResolvableTerritory) { setTerritoryTree(null); setCoverage(EMPTY_COVERAGE); return; }
      const { data: tree } = territory.constituency
        ? await getConstituencyTerritory({ client: supabase, constituencyId: territory.constituency })
        : await getStateTerritory({ client: supabase, stateCode: territory.state });
      if (cancelled) return;
      setTerritoryTree(tree);
      const { data: cov } = await getUncoveredTerritory({ client: supabase, campaignId, territory: tree });
      if (!cancelled) setCoverage(cov ?? EMPTY_COVERAGE);
    })();
    (async () => {
      const { data } = await listInvitations({ client: supabase, campaignId });
      if (!cancelled) setAllInvitations(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [campaignId, territory?.office, territory?.constituency, territory?.state, reloadTick]); // eslint-disable-line

  // A reassignment/new invitation changes both the folded Canon (ctx —
  // Election.jsx's refresh()) and this component's own local coverage/
  // invitation reads, which refresh() alone does not re-trigger.
  const refreshAll = async () => { await refresh?.(); setReloadTick((t) => t + 1); };

  const [gapsOpen, setGapsOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState(null);

  const lgaNameById = new Map((territoryTree?.lgas ?? []).map((l) => [l.id, l.name]));
  const constituencyOrStateName = territoryTree?.constituency?.name ?? null;

  // Priority order per the Home Operating Console spec: uncovered LGA/ward
  // responsibility, then pending invitations, then everything computeAttention()
  // already tracked. readiness.gaps is deliberately NOT threaded through
  // here — see attention.js's own header on why that would double-count the
  // same "ward has no one responsible" fact under a second ward population.
  const coverageGapsForAttention = [
    ...coverage.lgas.filter((l) => !l.covered).map((l) => ({ level: "lga", name: l.name, id: l.id })),
    ...coverage.wards.filter((w) => !w.covered).map((w) => ({ level: "ward", name: w.name, id: w.id })),
  ];
  const pendingInvitationsForAttention = pendingInvites.map((i) => ({
    name: i.invited_name,
    roleLabel: i.intended_responsibility_role ? RESPONSIBILITY_ROLE_LABEL[i.intended_responsibility_role] ?? i.intended_responsibility_role : "Campaign Director",
  }));

  const view = ctx.view ?? {};
  const attention = computeAttention(view, [], coverageGapsForAttention, pendingInvitationsForAttention);
  const claims = ctx?.readiness?.claims ?? [];
  const complete = claims.filter((c) => c.status === STATUS.COMPLETE).length;
  const nextClaim = claims.find((c) => c.status !== STATUS.COMPLETE);
  const nextAction = nextClaim ? (NEXT_ACTION_BY_DIMENSION[nextClaim.dimension] ?? "Review your readiness gaps.") : null;

  // CAMPAIGN ONBOARDING PASS — "My Scope" is shown only to an LGA/Ward/PU
  // Coordinator (someone who accepted a geography-scoped invitation).
  // Owner/manager and a Constituency Lead keep today's full-campaign Home
  // unchanged: a Constituency Lead's own scope already IS the whole
  // campaign's territory under the current single-constituency model, so a
  // separate scoped view would just duplicate this same page.
  const myPersonRef = campaignId && myUserId ? `invite:${campaignId}:${myUserId}` : null;
  const myResponsibility = myPersonRef
    ? Object.values(view.responsibilities ?? {}).find((r) => r.person === myPersonRef
        && r.responsibilityRole && r.responsibilityRole !== "CONSTITUENCY_LEAD")
    : null;

  // ELECTIONCANON 1.1 HOME OPERATING CONSOLE — "What Changed", sourced ONLY
  // from view.feed (the already-computed, real Canon event feed —
  // projections.js's own `feed` array) and view.responsibilities' own
  // history[] (real handoff records, not a second log). Never the raw
  // `summary` text a REASSIGNED event carries — that string embeds raw
  // geography/person refs, not names — this resolves each one through the
  // SAME name/geography lookups the rest of this app already uses.
  const nameForPersonRef = (ref) => {
    if (!ref) return "Vacant";
    const uid = ref.startsWith(`invite:${campaignId}:`) ? ref.slice(`invite:${campaignId}:`.length) : null;
    if (!uid) return "Campaign member";
    return resolveMemberDisplayName({ uid, campaignId, userId: myUserId, myIdentity, view, invitations: allInvitations });
  };
  const nameForGeography = (ref) => lgaNameById.get(ref) ?? territoryTree?.wards?.find((w) => w.id === ref)?.name ?? "this territory";

  const responsibilityChanges = [];
  for (const item of view.feed ?? []) {
    if (item.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED) {
      const slot = view.responsibilities?.[item.subject];
      if (!slot) continue;
      responsibilityChanges.push({ at: item.at,
        text: `${RESPONSIBILITY_ROLE_LABEL[slot.responsibilityRole] ?? slot.responsibilityRole} assigned for ${nameForGeography(slot.geographyRef)}: ${nameForPersonRef(slot.person)}.` });
    }
    if (item.type === ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED) {
      const slot = view.responsibilities?.[item.subject];
      if (!slot) continue;
      const hist = (slot.history ?? []).find((h) => h.event === "reassigned" && h.at === item.at);
      const roleLabel = RESPONSIBILITY_ROLE_LABEL[slot.responsibilityRole] ?? slot.responsibilityRole;
      const geoName = nameForGeography(slot.geographyRef);
      responsibilityChanges.push({ at: item.at, text: hist?.newPerson
        ? `${roleLabel} for ${geoName} reassigned: ${nameForPersonRef(hist?.previousPerson)} → ${nameForPersonRef(hist?.newPerson)}.`
        : `${roleLabel} for ${geoName} was vacated (previously ${nameForPersonRef(hist?.previousPerson)}).` });
    }
    if (item.type === ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED) {
      const candidate = view.candidates?.[item.subject];
      responsibilityChanges.push({ at: item.at, text: `Candidate registered: ${candidate?.name ?? "candidate"}.` });
    }
  }
  for (const inv of pendingInvites) {
    // Only ever "created" here — pendingInvites is already filtered to
    // status === "pending"; an accepted invitation stops appearing in that
    // list, and its acceptance is what PRODUCES the RESPONSIBILITY.ASSIGNED
    // feed item above, so it is not double-reported here.
    if (inv.created_at) responsibilityChanges.push({ at: inv.created_at, text: `Invitation sent to ${inv.invited_name}.` });
  }
  responsibilityChanges.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const recentChanges = responsibilityChanges.slice(0, 6);

  const handleInvite = (hint) => onSection("organisation", hint);
  const handleReassign = (target) => setReassignTarget(target);

  // ELECTIONCANON 1.1.1 UX REFINEMENT PASS — per-alert action buttons.
  // computeAttention() pushes coverage-gap alerts first, then pending-
  // invitation alerts, then everything else (see that file's own "Priority
  // order" comment, already proven by test) — so attention.alerts[i] for
  // i < coverageGapsForAttention.length is GUARANTEED to be the i-th
  // uncovered LGA/ward, in the SAME lgas-then-wards order coverageGaps
  // ForAttention itself was built in. uncoveredForActions mirrors that
  // exact order/filter so it can be zipped by index — no new computation,
  // no second coverage read, just the real {level, geographyRef, role,
  // lgaId} shape CoverageGapsPanel's own onInvite already expects. This
  // is deliberately NOT a change to attention.js itself (shared with
  // IntelligenceSection.jsx) — only how Home renders the same real alerts.
  const uncoveredForActions = [
    ...coverage.lgas.filter((l) => !l.covered).map((l) => ({ level: "lga", geographyRef: l.id, geographyName: l.name, role: "LGA_COORDINATOR", lgaId: null })),
    ...coverage.wards.filter((w) => !w.covered).map((w) => ({ level: "ward", geographyRef: w.id, geographyName: w.name, role: "WARD_COORDINATOR", lgaId: w.lgaId ?? null })),
  ];
  const pendingInviteAlertStart = uncoveredForActions.length;
  const pendingInviteAlertEnd = pendingInviteAlertStart + pendingInvitationsForAttention.length;
  const attentionAction = (index) => {
    if (index < uncoveredForActions.length) {
      const gap = uncoveredForActions[index];
      return { label: "Invite someone", onClick: () => handleInvite({ level: gap.level, geographyRef: gap.geographyRef, role: gap.role, lgaId: gap.lgaId }) };
    }
    if (index < pendingInviteAlertEnd) {
      return { label: "Review", onClick: () => onSection("organisation") };
    }
    return null;
  };

  const people = Object.values(view.people ?? {});
  const wards = Object.values(view.wards ?? {});
  const assignments = Object.values(view.assignments ?? {});
  const outstandingAssignments = assignments.filter((a) => a.status !== ASSIGNMENT_STATUS.COMPLETE).length;
  const tasks = Object.values(view.tasks ?? {});
  const openTasks = tasks.filter((t) => t.status !== TASK_STATUS.COMPLETE).length;

  const pollingUnits = Object.values(view.pollingUnits ?? {});
  const agents = Object.values(view.agents ?? {});
  const results = Object.values(view.results ?? {});
  const verifiedResults = results.filter((r) => r.verificationStatus === VERIFICATION_STATUS.VERIFIED).length;
  const incidents = Object.values(view.incidents ?? {});
  const openIncidents = incidents.filter((i) => i.status !== INCIDENT_STATUS.RESOLVED && i.status !== INCIDENT_STATUS.CLOSED).length;
  const simulationStatus = pollingUnits.length === 0 ? "Not started" : agents.length === 0 ? "Polling units configured" : "Agents assigned";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <Label>Your election</Label>
        <Panel accent={TEAL}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(20px,2.6vw,28px)", color: IVORY, marginBottom: 6 }}>
            {workspaceName || "Your election workspace"}
          </div>
          <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: electionType ? 4 : 16 }}>
            {ctx?.actorKind === ACTOR_KIND.OBSERVER_ORGANISATION ? "Observer / monitoring organisation" : "Candidate campaign"} · operating status: active
          </div>
          {electionType && (
            <div style={{ fontFamily: UI, fontSize: 12, color: TEAL, marginBottom: 16 }}>
              Election: {electionType}
            </div>
          )}
          {nextAction ? (
            <>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
                textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>What to do next</div>
              <div style={{ fontFamily: UI, fontSize: 14, color: IVORY, marginBottom: 14 }}>{nextAction}</div>
              <button onClick={() => onSection("readiness")}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em",
                  textTransform: "uppercase", padding: "12px 20px", border: "none", background: TEAL,
                  color: BLACK, cursor: "pointer", clipPath: FORGE_CLIPS.button }}>
                Continue Preparation →
              </button>
            </>
          ) : claims.length > 0 ? (
            <div style={{ fontFamily: UI, fontSize: 13, color: TEAL }}>
              Every tracked readiness dimension is COMPLETE. Check Election Day for the next step.
            </div>
          ) : null}
        </Panel>
      </div>

      {/* ELECTIONCANON 1.1.1 UX REFINEMENT PASS — moved above MyScopeCard/
          CoverageCard/gaps: "what needs my attention right now" is the
          first question Home should answer, ahead of secondary campaign
          summary content. Same real attention.alerts this file always
          computed — only the position and per-item action changed. */}
      <div style={{ gridColumn: "1 / -1" }}>
        <Label>What needs attention today</Label>
        <Panel accent={attention.alerts.length ? PINK : TEAL}>
          {attention.alerts.length === 0 ? (
            <div style={{ fontFamily: UI, fontSize: 13, color: TEAL }}>
              ALL CLEAR — nothing needs attention right now.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {attention.alerts.slice(0, 6).map((a, i) => {
                const action = attentionAction(i);
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: TONE_COLOR[a.tone] ?? AMBER, flexShrink: 0 }} />
                    <span style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, flex: "1 1 auto" }}>{a.text}</span>
                    {action && (
                      <button onClick={action.onClick}
                        style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                          padding: "6px 12px", border: `1px solid ${TEAL}`, background: "transparent", color: TEAL, cursor: "pointer", flexShrink: 0 }}>
                        {action.label}
                      </button>
                    )}
                  </div>
                );
              })}
              {attention.alerts.length > 6 && (
                <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>+{attention.alerts.length - 6} more — see Intelligence for the full list.</div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {myResponsibility && (
        <MyScopeCard campaignId={campaignId} userId={myUserId} responsibility={myResponsibility} onOpenChat={() => onSection("chat")} />
      )}

      <CoverageCard coverage={coverage} onOpenGaps={() => { setGapsOpen((o) => !o); setReassignTarget(null); }} />

      {reassignTarget ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <ReassignResponsibilityPanel
            campaignId={campaignId} userId={myUserId} view={view}
            level={reassignTarget.level} geographyRef={reassignTarget.geographyRef} geographyName={reassignTarget.geographyName}
            currentPersonRef={reassignTarget.currentPersonRef} geographyTree={territoryTree}
            refresh={refreshAll} onClose={() => setReassignTarget(null)}
          />
        </div>
      ) : gapsOpen && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>Coverage — LGAs and wards</Label>
          <CoverageGapsPanel coverage={coverage} lgaNameById={lgaNameById} parentName={constituencyOrStateName ?? "—"}
            onInvite={handleInvite} onReassign={handleReassign} />
        </div>
      )}

      <div style={{ gridColumn: "1 / -1" }}>
        <Label>What changed</Label>
        <Panel>
          {recentChanges.length === 0 ? (
            <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No organisational activity recorded yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {recentChanges.map((c, i) => (
                <div key={i} style={{ fontFamily: UI, fontSize: 12.5, color: IVORY }}>{c.text}</div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <SummaryCard label="Readiness" accent={TEAL} onOpen={() => onSection("readiness")} openLabel="Open Readiness">
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 30, color: IVORY }}>
          {claims.length ? `${complete} / ${claims.length}` : "No data yet"}
        </div>
        <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginTop: 6 }}>tracked dimensions complete</div>
      </SummaryCard>

      <SummaryCard label="Mobilization" accent={PINK} onOpen={() => onSection("mobilize")} openLabel="Open Mobilize">
        <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
          {people.length} people · {wards.length} ward{wards.length === 1 ? "" : "s"}<br />
          {outstandingAssignments} outstanding assignment{outstandingAssignments === 1 ? "" : "s"} · {openTasks} open task{openTasks === 1 ? "" : "s"}
        </div>
      </SummaryCard>

      <SummaryCard label="Communications" accent={AMBER} onOpen={() => onSection("chat")} openLabel="Open Chat">
        {commsSummary === null ? (
          <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No data yet</div>
        ) : (
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
            {commsSummary.unread} unread message{commsSummary.unread === 1 ? "" : "s"}<br />
            {commsSummary.rooms} active coordination room{commsSummary.rooms === 1 ? "" : "s"}
          </div>
        )}
      </SummaryCard>

      <SummaryCard label="Campaign Studio" accent={PINK} onOpen={() => onSection("studio")} openLabel="Open Studio">
        {studioSummary === null ? (
          <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>No data yet</div>
        ) : (
          <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
            {studioSummary.drafts} draft{studioSummary.drafts === 1 ? "" : "s"} · {studioSummary.published} published · {studioSummary.scheduled} scheduled
          </div>
        )}
      </SummaryCard>

      <SummaryCard label="Election Day" accent={AMBER} onOpen={() => onSection("election-day")} openLabel="Open Election Day">
        <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.9 }}>
          Simulation status: {simulationStatus}<br />
          {pollingUnits.length} polling unit{pollingUnits.length === 1 ? "" : "s"} · {agents.length} agent{agents.length === 1 ? "" : "s"}<br />
          {verifiedResults} / {results.length} results verified · {openIncidents} open incident{openIncidents === 1 ? "" : "s"}
        </div>
      </SummaryCard>
    </div>
  );
}
