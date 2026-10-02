// ============================================================
// ELECTIONCANON — EVENTS / CANON  (UX Redesign Slice 4)
//
// The first dedicated, human-readable view of ElectionCanon's own recorded
// operational history. NOT a new event system, NOT a new table, NOT a
// second feed — this reads the SAME tenant-scoped event log every other
// Canon-backed screen already folds, through the SAME existing adapter
// function (readElectionLog(), os/electionWebAdapter.js) that Intelligence's
// Ask panel already uses for grounding. There is exactly one event log;
// this is a second, more legible WINDOW onto it, not a second copy of it.
//
// EVENTS vs CANON — one read surface, not two data layers. This repo's
// event log and its "durable operational record" are the same underlying
// fact: every event, once recorded, IS the Canon. This view therefore does
// not invent a separate "Canon" table or a separate "Events" feed — it
// presents the one real log chronologically (event history) while calling
// it what it durably is (the Canon) in its own framing copy, per this
// slice's own Step 2/4 instruction: make that terminology distinction
// explicit rather than fabricating a second data layer to justify it.
//
// WHY SOME DESCRIPTIONS ARE REBUILT, NOT TAKEN FROM e.summary VERBATIM.
// Every event carries a real, write-time human-authored `summary` (see
// events.js's own factories) — trusted as-is for most types. Two type
// families' own DEFAULT summary embeds a raw geography id or responsibility
// slot id (RESPONSIBILITY.*, TERRITORY.SET — see those factories' own
// `summary ?? ...` lines), the exact same honesty gap HomeSection.jsx's own
// "What changed" panel already fixed for RESPONSIBILITY.ASSIGNED/REASSIGNED
// by resolving names instead of printing raw refs. This file reuses that
// same resolution approach (resolveMemberDisplayName, the same
// getConstituencyTerritory/getStateTerritory tree already fetched
// independently by Home/Organisation/Territory) rather than inventing a
// second name-resolution scheme.
//
// SCOPE — mirrors HomeSection.jsx's own !isScoped gate on "What changed"
// exactly, for the exact same reason stated there: the event log is
// campaign-wide, and no per-event geography-scoped read exists for an
// LGA/Ward/Polling-Unit coordinator to see only their own slice of it.
// Rather than leak the full campaign history to a scoped viewer just
// because this is a new page, a scoped viewer sees an honest explanation
// instead — the identical authorization posture as Home, not a new one.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { readElectionLog } from "../../os/electionWebAdapter.js";
import { ELECTION_EVENT_TYPES } from "../../domains/election/events.js";
import { resolveMyResponsibility, isScopedResponsibility } from "../../domains/election/responsibility.js";
import { getConstituencyTerritory, getStateTerritory, listOffices, listStates } from "../../domains/election/geography/read.js";
import { listInvitations } from "../../domains/election/invitations/read.js";
import { resolveMemberDisplayName } from "./OrganisationSection.jsx";
import { Label, Panel, UI, DISPLAY, IVORY, MUTED, TEAL, AMBER, PINK, BORDER } from "./shared.jsx";
import { ContextualAsk } from "./AskAssistant.jsx";
import { useTranslation } from "./useTranslation.js";

// UX REDESIGN SLICE 5 — real, already-answerable example prompts (see
// IntelligenceSection.jsx's own advertised examples / AskAssistant.jsx).
const CANON_PROMPTS = Object.freeze(["Show unresolved incidents", "What evidence is waiting for verification?"]);

// Same four labels this codebase deliberately keeps as small, independent
// copies in HomeSection.jsx/OrganisationSection.jsx/Election.jsx rather than
// centralising further — see Election.jsx's own comment on why this is a
// label duplicate, not the responsibility LOOKUP duplication Gate A unified.
const RESPONSIBILITY_ROLE_LABEL = Object.freeze({
  CONSTITUENCY_LEAD: "Constituency Lead", LGA_COORDINATOR: "LGA Coordinator",
  WARD_COORDINATOR: "Ward Coordinator", POLLING_UNIT_AGENT: "Polling-Unit Agent",
});

const SECTION_LABEL = Object.freeze({
  readiness: "Readiness", mobilize: "Work", "election-day": "Election Operations", territory: "Places",
});

// Closed vocabulary derived FROM the canonical ELECTION_EVENT_TYPES registry
// (events.js) — a label + filter category + cross-link destination per real
// type, never a second type registry. `sectionId` is set ONLY where a real,
// existing destination section can show this fact — no invented routes.
const EVENT_TYPE_META = Object.freeze({
  [ELECTION_EVENT_TYPES.CANDIDATE.REGISTERED]: { label: "Candidate registered", category: "readiness", sectionId: "readiness" },
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_ASSIGNED]: { label: "Ward assigned", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.CAMPAIGN.WARD_STATUS_REPORTED]: { label: "Ward status reported", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.DOCUMENT.PUBLISHED]: { label: "Document published", category: "other", sectionId: null },
  [ELECTION_EVENT_TYPES.OBSERVER.ASSIGNED]: { label: "Observer assigned", category: "other", sectionId: null },
  [ELECTION_EVENT_TYPES.MOBILIZATION.PERSON_ADDED]: { label: "Person added to field roster", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_CREATED]: { label: "Assignment created", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.MOBILIZATION.ASSIGNMENT_STATUS_CHANGED]: { label: "Assignment status changed", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_CREATED]: { label: "Task created", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.MOBILIZATION.TASK_STATUS_CHANGED]: { label: "Task status changed", category: "mobilize", sectionId: "mobilize" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.POLLING_UNIT_ADDED]: { label: "Polling unit added", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_ASSIGNED]: { label: "Agent assigned", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.AGENT_STATUS_CHANGED]: { label: "Agent status changed", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_CAPTURED]: { label: "Result captured (simulation)", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_OCR_PROCESSED]: { label: "Result OCR processed", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.RESULT_VERIFIED]: { label: "Result verified", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_REPORTED]: { label: "Incident reported", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.ELECTION_DAY.INCIDENT_STATUS_CHANGED]: { label: "Incident status changed", category: "election-day", sectionId: "election-day" },
  [ELECTION_EVENT_TYPES.TERRITORY.SET]: { label: "Territory set", category: "territory", sectionId: "territory" },
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED]: { label: "Responsibility assigned", category: "territory", sectionId: "territory" },
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED]: { label: "Responsibility status changed", category: "territory", sectionId: "territory" },
  [ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED]: { label: "Responsibility reassigned", category: "territory", sectionId: "territory" },
});

const CATEGORY_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "territory", label: "Places & responsibility" },
  { id: "mobilize", label: "Work" },
  { id: "election-day", label: "Events" },
  { id: "readiness", label: "Readiness" },
  { id: "other", label: "Other" },
]);

const STATUS_TONE = Object.freeze({ danger: PINK, warning: AMBER, neutral: TEAL });

/** Never a raw JSON payload — a short, labeled reference to the immutable
 *  Canon record this row IS, matching the honesty-first "record, not proof
 *  of nothing" convention used everywhere else PREPARE/APPROVE drafts name
 *  a real eventId. */
function canonReference(eventId) {
  return eventId ? `Canon reference ${String(eventId).slice(0, 10)}…` : "Canon reference unavailable";
}

function typeLabel(type) {
  return EVENT_TYPE_META[type]?.label ?? String(type ?? "").replace(/[._]/g, " ");
}

function formatWhen(at) {
  if (!at) return "—";
  try {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(at);
  }
}

export default function EventsSection({ ctx, campaignId, onSection }) {
  const { t } = useTranslation();
  const [log, setLog] = useState([]);
  const [logLoading, setLogLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [myIdentity, setMyIdentity] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [members, setMembers] = useState([]);
  const [territoryTree, setTerritoryTree] = useState(null);
  const [offices, setOffices] = useState([]);
  const [states, setStates] = useState([]);
  const [category, setCategory] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const view = ctx.view ?? {};
  const territory = view.territory ?? null;
  const myResponsibility = resolveMyResponsibility({ view, campaignId, userId });
  const isScoped = isScopedResponsibility(myResponsibility);

  useEffect(() => {
    let cancelled = false;
    setLogLoading(true);
    (async () => {
      // Same adapter function Intelligence's Ask panel already calls for
      // this exact log — one source of truth, no second read path.
      // readElectionLog() now returns { log, error } on every path.
      const r = await readElectionLog({ client: supabase, requestedCampaign: campaignId });
      if (!cancelled) { setLog(r.log ?? []); setLogLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setUserId(user?.id ?? null);
      if (user) {
        const { data: profileRow } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
        if (!cancelled) setMyIdentity({ email: user.email ?? null, displayName: profileRow?.display_name ?? null });
      }
      const { data: invData } = await listInvitations({ client: supabase, campaignId });
      if (!cancelled) setInvitations(invData ?? []);
      // ROLE_SCOPE_03 — needed only so nameForPerson()'s shared
      // resolveMemberDisplayName() call can resolve an owner/manager's real
      // role when no other identity path matches (see that function's own
      // header) — same read OrganisationSection.jsx's roster already does.
      const { data: memberRows } = await supabase.from("campaign_members").select("person, member_role").eq("campaign_id", campaignId);
      if (!cancelled) setMembers(memberRows ?? []);
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Same territory-tree resolution HomeSection.jsx/OrganisationSection.jsx
  // already independently fetch (getConstituencyTerritory/getStateTerritory)
  // — no new geography source, just this screen's own copy of the same read.
  useEffect(() => {
    let cancelled = false;
    if (!territory) { setTerritoryTree(null); return undefined; }
    (async () => {
      const [{ data: officesData }, { data: statesData }] = await Promise.all([
        listOffices({ client: supabase }), listStates({ client: supabase }),
      ]);
      if (cancelled) return;
      setOffices(officesData ?? []);
      setStates(statesData ?? []);
      const { data: tree } = territory.constituency
        ? await getConstituencyTerritory({ client: supabase, constituencyId: territory.constituency })
        : await getStateTerritory({ client: supabase, stateCode: territory.state });
      if (!cancelled) setTerritoryTree(tree);
    })();
    return () => { cancelled = true; };
  }, [territory?.office, territory?.constituency, territory?.state]);

  if (isScoped) {
    const roleLabel = RESPONSIBILITY_ROLE_LABEL[myResponsibility.responsibilityRole] ?? "Coordinator";
    return (
      <div>
        <Label>{t("nav.canon")}</Label>
        <Panel accent={AMBER}>
          <div style={{ fontFamily: UI, fontSize: 13, color: IVORY, lineHeight: 1.6 }}>
            The Canon is a campaign-wide record. As {roleLabel}, this page does not yet have a
            scoped view of it — your own recorded activity is visible on Overview and in Places.
          </div>
        </Panel>
      </div>
    );
  }

  const lgaNameById = new Map((territoryTree?.lgas ?? []).map((l) => [l.id, l.name]));
  const wardNameById = new Map((territoryTree?.wards ?? []).map((w) => [w.id, w.name]));
  const officeNameById = new Map(offices.map((o) => [o.id, o.name]));
  const stateNameByCode = new Map(states.map((s) => [s.code, s.name]));

  // ROLE_SCOPE_03 — was: any non-invite-prefixed ref (a Mobilize field-
  // roster person's raw id, or the campaign owner's own raw id) short-
  // circuited to a flat "Campaign member" BEFORE ever reaching the shared
  // resolver below, even though resolveMemberDisplayName() can resolve both
  // via view.people/members. Now strips the invite: prefix only when
  // present and always defers to the one canonical resolver — see that
  // function's own header (OrganisationSection.jsx) for the full order.
  const nameForPerson = (ref) => {
    if (!ref) return "Vacant";
    const prefix = `invite:${campaignId}:`;
    const uid = ref.startsWith?.(prefix) ? ref.slice(prefix.length) : ref;
    return resolveMemberDisplayName({ uid, campaignId, userId, myIdentity, view, invitations, members });
  };
  const nameForGeography = (ref) => (ref ? (lgaNameById.get(ref) ?? wardNameById.get(ref) ?? ref) : "—");

  function describeEvent(e) {
    switch (e.type) {
      case ELECTION_EVENT_TYPES.RESPONSIBILITY.ASSIGNED:
        return `${RESPONSIBILITY_ROLE_LABEL[e.responsibilityRole] ?? e.responsibilityRole} assigned for ${nameForGeography(e.geographyRef)}: ${nameForPerson(e.person)}.`;
      case ELECTION_EVENT_TYPES.RESPONSIBILITY.REASSIGNED:
        return e.newPerson
          ? `${RESPONSIBILITY_ROLE_LABEL[e.responsibilityRole] ?? e.responsibilityRole} for ${nameForGeography(e.geographyRef)} reassigned: ${nameForPerson(e.previousPerson)} → ${nameForPerson(e.newPerson)}.`
          : `${RESPONSIBILITY_ROLE_LABEL[e.responsibilityRole] ?? e.responsibilityRole} for ${nameForGeography(e.geographyRef)} was vacated (previously ${nameForPerson(e.previousPerson)}).`;
      case ELECTION_EVENT_TYPES.RESPONSIBILITY.STATUS_CHANGED: {
        const slot = view.responsibilities?.[e.responsibility];
        return slot
          ? `${RESPONSIBILITY_ROLE_LABEL[slot.responsibilityRole] ?? slot.responsibilityRole} for ${nameForGeography(slot.geographyRef)} — status: ${e.status ?? "updated"}.`
          : (e.summary ?? "Responsibility status updated.");
      }
      case ELECTION_EVENT_TYPES.TERRITORY.SET:
        return `Territory set: ${officeNameById.get(e.office) ?? e.office} / ${stateNameByCode.get(e.state) ?? e.state}${e.constituency ? ` (constituency ${e.constituency})` : ""}.`;
      default:
        return e.summary ?? typeLabel(e.type);
    }
  }

  function placeFor(e) {
    if (e.geographyRef) return nameForGeography(e.geographyRef);
    if (e.ward) return e.ward;
    if (e.state) return stateNameByCode.get(e.state) ?? e.state;
    if (e.location) return e.location;
    return null;
  }

  const filtered = category === "all" ? log : log.filter((e) => (EVENT_TYPE_META[e.type]?.category ?? "other") === category);

  return (
    <div>
      <Label>{t("nav.canon")}</Label>
      <Panel accent={TEAL} style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: "clamp(18px,2.2vw,22px)", color: IVORY, marginBottom: 8 }}>
          The recorded operational history of this election
        </div>
        <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
          Every entry below is a permanent record ElectionCanon has already made — not a live
          activity feed, and not an official election result. This is the same record every other
          screen in ElectionCanon reads from; nothing here is computed separately.
        </div>
      </Panel>

      <div style={{ marginBottom: 16 }}>
        <ContextualAsk triggerLabel="Ask about these events" contextLabel="Canon"
          suggestedPrompts={CANON_PROMPTS} view={view} log={log} onSection={onSection} />
      </div>

      <div role="group" aria-label={t("canon.filterByCategory")} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {CATEGORY_FILTERS.map((c) => {
          const active = c.id === category;
          return (
            <button key={c.id} type="button" onClick={() => setCategory(c.id)} aria-pressed={active}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "8px 14px", cursor: "pointer", background: active ? "rgba(10,127,115,0.12)" : "transparent",
                border: `1px solid ${active ? TEAL : BORDER}`, color: active ? IVORY : MUTED }}>
              {c.label}
            </button>
          );
        })}
      </div>

      {logLoading ? (
        <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>Resolving the Canon…</div></Panel>
      ) : filtered.length === 0 ? (
        <Panel><div style={{ fontFamily: UI, fontSize: 13, color: MUTED }}>
          {log.length === 0 ? "No events recorded yet." : "No events recorded yet in this category."}
        </div></Panel>
      ) : (
        <Panel>
          {filtered.map((e) => {
            const meta = EVENT_TYPE_META[e.type] ?? { label: typeLabel(e.type), sectionId: null };
            const expanded = expandedId === e.eventId;
            const place = placeFor(e);
            const status = e.status ?? e.verificationStatus ?? null;
            return (
              <div key={e.eventId ?? `${e.type}-${e.at}`} style={{ borderBottom: `1px solid ${BORDER}`, padding: "12px 0" }}>
                <button type="button" onClick={() => setExpandedId(expanded ? null : e.eventId)} aria-expanded={expanded}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14,
                    width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: TEAL, marginBottom: 4 }}>
                      {expanded ? "▾" : "▸"} {meta.label}{place ? ` · ${place}` : ""}
                    </div>
                    <div style={{ fontFamily: UI, fontSize: 12.5, color: IVORY, lineHeight: 1.5 }}>{describeEvent(e)}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, whiteSpace: "nowrap" }}>{formatWhen(e.at)}</div>
                    {status && (
                      <span style={{ display: "inline-block", marginTop: 6, fontFamily: UI, fontWeight: 700, fontSize: 9, letterSpacing: "0.08em",
                        textTransform: "uppercase", color: STATUS_TONE.neutral, border: `1px solid ${STATUS_TONE.neutral}`, padding: "2px 7px" }}>
                        {status}
                      </span>
                    )}
                  </div>
                </button>
                {expanded && (
                  <div style={{ marginTop: 12, paddingLeft: 4, display: "grid", gap: 6 }}>
                    <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>
                      <strong style={{ color: IVORY }}>{t("canon.whenLabel")}</strong> {formatWhen(e.at)}
                    </div>
                    {place && (
                      <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>
                        <strong style={{ color: IVORY }}>{t("canon.whereLabel")}</strong> {place}
                      </div>
                    )}
                    {status && (
                      <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>
                        <strong style={{ color: IVORY }}>{t("canon.statusLabel")}</strong> {status}
                      </div>
                    )}
                    <div style={{ fontFamily: UI, fontSize: 11, color: MUTED }}>
                      <strong style={{ color: IVORY }}>{t("canon.recordLabel")}</strong> {canonReference(e.eventId)}
                    </div>
                    {meta.sectionId && onSection && (
                      <button type="button" onClick={() => onSection(meta.sectionId)}
                        style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
                          color: TEAL, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", marginTop: 4 }}>
                        Open in {SECTION_LABEL[meta.sectionId] ?? meta.sectionId} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
