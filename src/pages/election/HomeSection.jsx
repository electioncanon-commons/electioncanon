// ============================================================
// ELECTIONCANON — HOME  (Alpha 1.0 command centre)
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
import { getConstituencyTerritory, getStateTerritory, listOffices, listWardsForLga, listPollingUnitsForWard, getPollingUnitCountsByWard } from "../../domains/election/geography/read.js";
import { getUncoveredTerritory, getWardCoverage, getPollingUnitCoverage } from "../../domains/election/geography/coverage.js";
import { listInvitations } from "../../domains/election/invitations/read.js";
import { resolveMemberDisplayName } from "./OrganisationSection.jsx";
import { CoverageCard, CoverageGapsPanel, ReassignResponsibilityPanel, ScopedWardsPanel, ScopedPollingUnitsPanel } from "./HomeResponsibility.jsx";
import { resolveMyResponsibility, isScopedResponsibility } from "../../domains/election/responsibility.js";
import { CLIP_PATHS } from "../../os/geometry.js";
import { computeAttention } from "./attention.js";
import { Label, Panel, linkBtn, UI, DISPLAY, IVORY, MUTED, TEAL, AMBER, PINK, BLACK, BORDER } from "./shared.jsx";
import { ContextualAsk } from "./AskAssistant.jsx";
import { useTranslation } from "./useTranslation.js";

// UX REDESIGN SLICE 5 — real, already-answerable example prompts only (the
// same ones IntelligenceSection.jsx's own Ask panel has always advertised),
// never a fabricated capability. See AskAssistant.jsx's own header.
const OVERVIEW_PROMPTS = Object.freeze(["What should we do next?", "What office am I contesting?"]);

const EMPTY_COVERAGE = Object.freeze({ established: false, constituencyId: null, constituencyCovered: false, lgas: [], wards: [], totalWards: 0, coveredWards: 0 });

const TONE_COLOR = { danger: PINK, warning: AMBER };

const NEXT_ACTION_KEY_BY_DIMENSION = Object.freeze({
  CANDIDATE_REGISTERED: "home.nextActionCandidateRegistered",
  WARD_ASSIGNMENT: "home.nextActionWardAssignment",
  WARD_STATUS_HEALTH: "home.nextActionWardStatusHealth",
  OBSERVER_ASSIGNMENT: "home.nextActionObserverAssignment",
});

// UX REDESIGN SLICE 2 — operational status as compact rows, not five
// separate decorative cards. Same underlying data as before (readiness
// claims, mobilization counts, comms/studio summaries, election-day
// counts) — only the presentation changed, from a card grid to a single
// list a user can scan without visually separated boxes competing for
// attention with the Attention panel above it.
function StatusRow({ label, accent, detail, onOpen, openLabel }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14,
      flexWrap: "wrap", padding: "13px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 170 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, background: accent, flexShrink: 0 }} />
        <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em",
          textTransform: "uppercase", color: IVORY }}>{label}</span>
      </div>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, flex: "1 1 260px", lineHeight: 1.6 }}>{detail}</div>
      {onOpen && (
        <button onClick={onOpen} aria-label={`${openLabel} — ${label}`} style={{ ...linkBtn(), flexShrink: 0 }}>
          {openLabel} →
        </button>
      )}
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
  const { t } = useTranslation();
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
      <Label>{t("home.yourScope")}</Label>
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
            color: BLACK, cursor: opening ? "default" : "pointer", clipPath: CLIP_PATHS.button, opacity: opening ? 0.6 : 1 }}>
          {opening ? "Opening…" : `Open ${levelLabel} Coordination Chat →`}
        </button>
      </Panel>
    </div>
  );
}

export default function HomeSection({ ctx, onSection, campaignId: campaignIdProp, refresh, workspaceName, electionType }) {
  const { t } = useTranslation();
  const [commsSummary, setCommsSummary] = useState(null);
  const [studioSummary, setStudioSummary] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [myIdentity, setMyIdentity] = useState(null);
  // LOOP 3 HARDENING — the ONE piece of canonical membership data Home was
  // previously missing: campaign_members.member_role, the SAME column
  // OrganisationSection.jsx already reads for its own myRole. Without this,
  // Home could not tell an owner/manager apart from a plain staff member
  // with no responsibility_slots row, nor from a coordinator whose
  // responsibility was just revoked — all three landed on the identical
  // campaign-wide view. `undefined` = not yet fetched (distinct from `null`
  // = fetched, no active row found), so the role-ambiguity branch below
  // never fires during the brief loading window.
  const [myMemberRole, setMyMemberRole] = useState(undefined);

  // `campaignIdProp` (Election.jsx now passes it directly) and the
  // pre-existing `ctx.scope.campaignId` derivation always agree — kept as a
  // fallback only so this component still works if ever rendered without
  // the prop (e.g. an isolated test).
  const campaignId = campaignIdProp ?? ctx?.scope?.campaignId;

  // GATE A — computed early (right after campaignId) so the scoped-geography
  // fetch effect below can depend on it. `myResponsibility` excludes
  // CONSTITUENCY_LEAD as a Home-specific PRESENTATION choice — a
  // Constituency Lead's own scope already IS the whole campaign's territory
  // under the current single-constituency model, so a separate scoped view
  // would just duplicate this same page (unchanged reasoning from before
  // this pass). `isScoped` is the ONE flag every scoped-render decision
  // below is keyed on.
  const view = ctx.view ?? {};
  const resolvedResponsibility = resolveMyResponsibility({ view, campaignId, userId: myUserId });
  const myResponsibility = resolvedResponsibility?.responsibilityRole !== "CONSTITUENCY_LEAD" ? resolvedResponsibility : null;
  const isScoped = isScopedResponsibility(myResponsibility);

  // LOOP 3 HARDENING — resolves the THREE-WAY ambiguity the previous pass
  // left open: owner/manager, plain staff with no responsibility, and a
  // revoked coordinator all used to fall through to the identical
  // campaign-wide render, because `isScoped` alone can only say "this is
  // not a scoped coordinator" — it cannot say WHY. `myMemberRole` (fetched
  // above, canonical campaign_members data, not a new role system) breaks
  // the tie. `roleResolved` gates the whole decision on BOTH reads having
  // actually completed, so this branch never fires against a still-loading
  // `undefined` (which would otherwise flash "no active responsibility" at
  // a real owner during the brief window before myMemberRole resolves).
  const isOwnerOrManager = myMemberRole === "owner" || myMemberRole === "manager";
  const isConstituencyLead = resolvedResponsibility?.responsibilityRole === "CONSTITUENCY_LEAD";
  const roleResolved = myMemberRole !== undefined;
  // True for EXACTLY the two states Part 1 names: ordinary staff who never
  // held a responsibility, and a coordinator whose responsibility was
  // reassigned/vacated out from under them. Never true for owner/manager
  // (checked first) or Constituency Lead (checked first) — those keep the
  // existing campaign-wide experience unchanged, and never true for an
  // active LGA/Ward/PU Coordinator (isScoped already covers them).
  const hasNoActiveResponsibility = roleResolved && !isOwnerOrManager && !isConstituencyLead && !isScoped;

  // GATE A — an LGA Coordinator's own wards (+ PU counts, count-only per
  // ward, no N+1 — see getPollingUnitCountsByWard()'s own header) or a Ward
  // Coordinator's own polling units, fetched via the SAME bounded,
  // already-existing reads Territory/Organisation use elsewhere
  // (listWardsForLga/listPollingUnitsForWard/getWardCoverage/
  // getPollingUnitCoverage) — never a national or constituency-wide fetch.
  // A Polling-Unit Agent needs no further fetch: their own responsibility
  // record (myResponsibility itself) already names their PU.
  const [myWards, setMyWards] = useState([]);
  const [myWardPuCounts, setMyWardPuCounts] = useState({});
  const [myPollingUnits, setMyPollingUnits] = useState([]);
  const [myScopedLoading, setMyScopedLoading] = useState(false);
  // Declared here (moved up from its original position further down this
  // file) so both this scoped-geography effect and the existing
  // campaign-wide territory/coverage effect below can share the SAME
  // reload counter — a reassignment/invite made from EITHER the scoped or
  // the campaign-wide panel bumps this once, via the SAME refreshAll().
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!isScoped || !campaignId || !myResponsibility) {
      setMyWards([]); setMyWardPuCounts({}); setMyPollingUnits([]);
      return undefined;
    }
    setMyScopedLoading(true);
    (async () => {
      if (myResponsibility.responsibilityRole === "LGA_COORDINATOR") {
        const { data: wards } = await listWardsForLga({ client: supabase, lgaId: myResponsibility.geographyRef });
        if (cancelled) return;
        const wardList = wards ?? [];
        const [{ data: covered }, { data: puCounts }] = await Promise.all([
          getWardCoverage({ client: supabase, campaignId, wards: wardList }),
          getPollingUnitCountsByWard({ client: supabase, wardIds: wardList.map((w) => w.id) }),
        ]);
        if (cancelled) return;
        setMyWards(covered ?? []);
        setMyWardPuCounts(puCounts ?? {});
      } else if (myResponsibility.responsibilityRole === "WARD_COORDINATOR") {
        const { data: pus } = await listPollingUnitsForWard({ client: supabase, wardId: myResponsibility.geographyRef });
        if (cancelled) return;
        const { data: covered } = await getPollingUnitCoverage({ client: supabase, campaignId, pollingUnits: pus ?? [] });
        if (!cancelled) setMyPollingUnits(covered ?? []);
      }
      if (!cancelled) setMyScopedLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isScoped, campaignId, myResponsibility?.responsibilityRole, myResponsibility?.geographyRef, reloadTick]); // eslint-disable-line

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
      if (!user) { setMyIdentity(null); setMyMemberRole(null); return; }
      const { data: profileRow } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      if (!cancelled) setMyIdentity({ email: user.email ?? null, displayName: profileRow?.display_name ?? null });
      // LOOP 3 HARDENING — the SAME campaign_members read
      // OrganisationSection.jsx already performs for its own myRole, not a
      // second membership model. RLS already permits a member reading
      // their own row (it permits reading the whole roster, in fact — see
      // this codebase's known, unchanged pre-existing read-scope note).
      const { data: memberRow } = await supabase.from("campaign_members")
        .select("member_role").eq("campaign_id", campaignId).eq("person", user.id).eq("status", "active").maybeSingle();
      if (!cancelled) setMyMemberRole(memberRow?.member_role ?? null);
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

  // LOOP 3 HARDENING — placed AFTER every hook this component declares
  // (React's own rule: an early return must never skip a hook that a LATER
  // render would otherwise call) and BEFORE any further derivation the
  // campaign-wide render below needs. Ordinary staff with no
  // responsibility_slots row, and a coordinator whose responsibility was
  // just reassigned/vacated, both land here — NEVER silently promoted into
  // the campaign-wide view below just because `isScoped` alone couldn't
  // tell them apart from an owner/manager. Not shown until roleResolved
  // (myMemberRole actually fetched) — see that flag's own comment above.
  if (roleResolved && hasNoActiveResponsibility) {
    return (
      <div role="region" aria-label="Election overview" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.yourElection")}</Label>
          <Panel accent={TEAL}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(20px,2.6vw,28px)", color: IVORY }}>
              {workspaceName || "Your election workspace"}
            </div>
          </Panel>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.noActiveResponsibility")}</Label>
          <Panel accent={AMBER}>
            <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.6, marginBottom: 8 }}>
              {t("home.noActiveResponsibilityBody1")}
            </div>
            <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
              {t("home.noActiveResponsibilityBody2")}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

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

  const attention = computeAttention(view, [], coverageGapsForAttention, pendingInvitationsForAttention);
  const claims = ctx?.readiness?.claims ?? [];
  const complete = claims.filter((c) => c.status === STATUS.COMPLETE).length;
  const nextClaim = claims.find((c) => c.status !== STATUS.COMPLETE);
  const nextAction = nextClaim ? t(NEXT_ACTION_KEY_BY_DIMENSION[nextClaim.dimension] ?? "home.nextActionReviewGaps") : null;

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
      return { label: t("action.inviteSomeone"), onClick: () => handleInvite({ level: gap.level, geographyRef: gap.geographyRef, role: gap.role, lgaId: gap.lgaId }) };
    }
    if (index < pendingInviteAlertEnd) {
      return { label: t("action.reviewHeading"), onClick: () => onSection("organisation") };
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
    <div role="region" aria-label="Election overview" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <Label>{t("home.yourElection")}</Label>
        <Panel accent={TEAL}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(20px,2.6vw,28px)", color: IVORY, marginBottom: 6 }}>
            {workspaceName || "Your election workspace"}
          </div>
          <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginBottom: electionType ? 4 : 16 }}>
            {ctx?.actorKind === ACTOR_KIND.OBSERVER_ORGANISATION ? t("home.observerOrgLabel") : t("home.candidateCampaignLabel")} · operating status: active
          </div>
          {electionType && (
            <div style={{ fontFamily: UI, fontSize: 12, color: TEAL, marginBottom: 16 }}>
              Election: {electionType}
            </div>
          )}
          {nextAction ? (
            <>
              <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.14em",
                textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>{t("home.whatToDoNext")}</div>
              <div style={{ fontFamily: UI, fontSize: 14, color: IVORY, marginBottom: 14 }}>{nextAction}</div>
              <button onClick={() => onSection("readiness")}
                style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em",
                  textTransform: "uppercase", padding: "12px 20px", border: "none", background: TEAL,
                  color: BLACK, cursor: "pointer", clipPath: CLIP_PATHS.button }}>
                {t("home.continuePreparation")}
              </button>
            </>
          ) : claims.length > 0 ? (
            <div style={{ fontFamily: UI, fontSize: 13, color: TEAL }}>
              {t("home.readinessAllComplete")}
            </div>
          ) : null}
        </Panel>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <ContextualAsk triggerLabel="Ask about this picture" contextLabel="Overview"
          suggestedPrompts={OVERVIEW_PROMPTS} view={view} onSection={onSection} />
      </div>

      {/* ELECTIONCANON 1.1.1 UX REFINEMENT PASS — moved above MyScopeCard/
          CoverageCard/gaps: "what needs my attention right now" is the
          first question Home should answer, ahead of secondary campaign
          summary content. Same real attention.alerts this file always
          computed — only the position and per-item action changed.

          LOOP 3 HARDENING (live browser acceptance finding) — this panel's
          own computeAttention() call is fed campaign-wide
          coverageGapsForAttention (every LGA/ward, not just the caller's
          own) — correct for owner/manager/Constituency Lead, but a real,
          confirmed leak for a scoped coordinator: an LGA Coordinator saw
          "AGEGE has no LGA Coordinator assigned" (a DIFFERENT LGA, +258
          more) with a live "Invite Someone" button, none of which they
          have authority over (write_responsibility() would correctly
          refuse it, but the button should never have been offered). Gated
          behind !isScoped — a scoped coordinator's own equivalent
          attention (their own uncovered wards) is already surfaced by the
          "Your wards"/"Your polling units" panel below, with actions that
          ARE within their real authority. */}
      {!isScoped && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.whatNeedsAttention")}</Label>
          <Panel accent={attention.alerts.length ? PINK : TEAL}>
            {attention.alerts.length === 0 ? (
              <div style={{ fontFamily: UI, fontSize: 13, color: TEAL }}>
                {t("home.allClear")}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 2 }}>
                {attention.alerts.slice(0, 6).map((a, i) => {
                  const action = attentionAction(i);
                  // STEP 9 ACCESSIBILITY — tone is a TEXT label (Urgent/Watch),
                  // never color alone, even though the left border still
                  // carries the same tone color for a sighted at-a-glance scan.
                  const toneLabel = a.tone === "danger" ? t("home.toneUrgent") : t("home.toneWatch");
                  return (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
                      padding: "9px 0 9px 10px", borderLeft: `3px solid ${TONE_COLOR[a.tone] ?? AMBER}`,
                      borderBottom: `1px solid ${BORDER}` }}>
                      <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em",
                        textTransform: "uppercase", color: TONE_COLOR[a.tone] ?? AMBER, flexShrink: 0, minWidth: 44 }}>
                        {toneLabel}
                      </span>
                      <span style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, flex: "1 1 auto" }}>{a.text}</span>
                      {action && (
                        <button onClick={action.onClick} aria-label={`${action.label} — ${a.text}`}
                          style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                            padding: "6px 12px", border: `1px solid ${TEAL}`, background: "transparent", color: TEAL, cursor: "pointer", flexShrink: 0 }}>
                          {action.label}
                        </button>
                      )}
                    </div>
                  );
                })}
                {attention.alerts.length > 6 && (
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, paddingTop: 8 }}>+{attention.alerts.length - 6} more — see Intelligence for the full list.</div>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* UX REDESIGN SLICE 2 — "What changed" moved up to sit directly after
          Attention (was previously below Coverage/gaps) so the Overview
          answers WHERE AM I / WHAT NEEDS ATTENTION / WHAT CHANGED before a
          user scrolls into coverage/status detail. Content and the exact
          !isScoped gate are UNCHANGED — see this file's own header comment
          on why a scoped coordinator has no authorized equivalent of this
          campaign-wide feed to see. */}
      {!isScoped && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.whatChanged")}</Label>
          <Panel>
            {recentChanges.length === 0 ? (
              <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>{t("home.noActivityYet")}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {recentChanges.map((c, i) => (
                  <div key={i} style={{ fontFamily: UI, fontSize: 12.5, color: IVORY }}>{c.text}</div>
                ))}
              </div>
            )}
            {/* UX REDESIGN SLICE 4 — the concise summary above and the full
                Canon (EventsSection.jsx) read the SAME underlying event log;
                this is a link to a more complete window onto it, not a
                second computation. */}
            {onSection && (
              <button type="button" onClick={() => onSection("canon")}
                style={{ ...linkBtn(), marginTop: 12 }}>
                {t("home.viewAllEventsCanon")}
              </button>
            )}
          </Panel>
        </div>
      )}

      {myResponsibility && (
        <MyScopeCard campaignId={campaignId} userId={myUserId} responsibility={myResponsibility} onOpenChat={() => onSection("chat")} />
      )}

      {/* GATE A — an LGA/Ward Coordinator sees ONLY their own subtree here,
          never the campaign-wide CoverageCard/CoverageGapsPanel below (which
          renders unchanged for owner/manager/Constituency Lead — see
          `!isScoped` on that line). A Polling-Unit Agent has nothing
          further to drill into: MyScopeCard above already IS their whole
          scope, so no additional panel renders for that role here. */}
      {isScoped && myResponsibility.responsibilityRole === "LGA_COORDINATOR" && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.yourWards")}</Label>
          {myScopedLoading && myWards.length === 0 ? (
            <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Loading your wards…</div></Panel>
          ) : (
            <>
              {myWards.length > 0 && (
                <div style={{ fontFamily: UI, fontSize: 11.5, color: myWards.some((w) => !w.covered) ? PINK : TEAL, marginBottom: 10 }}>
                  {myWards.every((w) => w.covered) ? "Every ward in your LGA has a coordinator."
                    : `${myWards.filter((w) => !w.covered).length} of ${myWards.length} ward${myWards.length === 1 ? "" : "s"} in your LGA still need${myWards.length === 1 ? "s" : ""} a coordinator.`}
                </div>
              )}
              <ScopedWardsPanel wards={myWards} pollingUnitCounts={myWardPuCounts} onInvite={handleInvite} onReassign={handleReassign} />
            </>
          )}
        </div>
      )}
      {isScoped && myResponsibility.responsibilityRole === "WARD_COORDINATOR" && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.yourPollingUnits")}</Label>
          {myScopedLoading && myPollingUnits.length === 0 ? (
            <Panel><div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>Loading your polling units…</div></Panel>
          ) : (
            <>
              {myPollingUnits.length > 0 && (
                <div style={{ fontFamily: UI, fontSize: 11.5, color: myPollingUnits.some((p) => !p.covered) ? PINK : TEAL, marginBottom: 10 }}>
                  {myPollingUnits.every((p) => p.covered) ? "Every polling unit in your ward has an agent."
                    : `${myPollingUnits.filter((p) => !p.covered).length} of ${myPollingUnits.length} polling unit${myPollingUnits.length === 1 ? "" : "s"} in your ward still need${myPollingUnits.length === 1 ? "s" : ""} an agent.`}
                </div>
              )}
              <ScopedPollingUnitsPanel pollingUnits={myPollingUnits} onInvite={handleInvite} onReassign={handleReassign} />
            </>
          )}
        </div>
      )}

      {!isScoped && <CoverageCard coverage={coverage} onOpenGaps={() => { setGapsOpen((o) => !o); setReassignTarget(null); }} />}

      {reassignTarget ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <ReassignResponsibilityPanel
            campaignId={campaignId} userId={myUserId} view={view}
            level={reassignTarget.level} geographyRef={reassignTarget.geographyRef} geographyName={reassignTarget.geographyName}
            currentPersonRef={reassignTarget.currentPersonRef}
            geographyTree={isScoped
              ? (reassignTarget.level === "ward" ? { wards: myWards }
                : reassignTarget.level === "polling_unit" ? { pollingUnits: myPollingUnits }
                : territoryTree)
              : territoryTree}
            refresh={refreshAll} onClose={() => setReassignTarget(null)}
          />
        </div>
      ) : gapsOpen && !isScoped && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>{t("home.coverageLgasWards")}</Label>
          <CoverageGapsPanel coverage={coverage} lgaNameById={lgaNameById} parentName={constituencyOrStateName ?? "—"}
            onInvite={handleInvite} onReassign={handleReassign} />
        </div>
      )}

      {/* UX REDESIGN SLICE 2 — the five previous SummaryCard boxes
          (Readiness/Mobilization/Communications/Studio/Election Day)
          recomposed into one operational-status list. Every value below is
          the exact same read/derivation this file already had — only the
          presentation changed from five bordered cards to compact rows. */}
      <div style={{ gridColumn: "1 / -1" }} role="region" aria-label="Operational status">
        <Label>{t("home.operationalStatus")}</Label>
        <Panel>
          <StatusRow label={t("nav.readiness")} accent={TEAL} onOpen={() => onSection("readiness")} openLabel={t("action.openReadiness")}
            detail={claims.length ? `${complete} / ${claims.length} tracked dimensions complete` : "No data yet"} />
          <StatusRow label={t("home.mobilizationLabel")} accent={PINK} onOpen={() => onSection("mobilize")} openLabel={t("action.openMobilize")}
            detail={`${people.length} people · ${wards.length} ward${wards.length === 1 ? "" : "s"} · ${outstandingAssignments} outstanding assignment${outstandingAssignments === 1 ? "" : "s"} · ${openTasks} open task${openTasks === 1 ? "" : "s"}`} />
          <StatusRow label={t("chat.communications")} accent={AMBER} onOpen={() => onSection("chat")} openLabel={t("action.openChat")}
            detail={commsSummary === null ? "No data yet" : `${commsSummary.unread} unread message${commsSummary.unread === 1 ? "" : "s"} · ${commsSummary.rooms} active coordination room${commsSummary.rooms === 1 ? "" : "s"}`} />
          <StatusRow label={t("home.studioLabel")} accent={PINK} onOpen={() => onSection("studio")} openLabel={t("action.openStudio")}
            detail={studioSummary === null ? "No data yet" : `${studioSummary.drafts} draft${studioSummary.drafts === 1 ? "" : "s"} · ${studioSummary.published} published · ${studioSummary.scheduled} scheduled`} />
          <StatusRow label={t("home.electionDayLabel")} accent={AMBER} onOpen={() => onSection("election-day")} openLabel={t("action.openElectionDay")}
            detail={`Simulation status: ${simulationStatus} · ${pollingUnits.length} polling unit${pollingUnits.length === 1 ? "" : "s"} · ${agents.length} agent${agents.length === 1 ? "" : "s"} · ${verifiedResults} / ${results.length} results verified · ${openIncidents} open incident${openIncidents === 1 ? "" : "s"}`} />
        </Panel>
      </div>
    </div>
  );
}
