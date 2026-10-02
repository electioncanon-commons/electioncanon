// ============================================================
// ELECTIONCANON — MOBILIZE  (Alpha 1.0)
//
// People / Wards / Assignments / Tasks — real, Canon-backed (folded from
// the new mobilization.* event types, see src/domains/election/events.js
// and projections.js). Every write goes through the SAME PREPARE/APPROVE
// gating as every other Election write (electionWebAdapter.js's
// prepareMobilizationWrite/approveMobilizationWrite).
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { prepareMobilizationWrite, approveMobilizationWrite, MOBILIZATION_OPERATION } from "../../os/electionWebAdapter.js";
import { PERSON_ROLE_TYPES, ASSIGNMENT_STATUS, TASK_STATUS } from "../../domains/election/mobilization/write.js";
import { computeMobilizationCoverage } from "../../domains/election/mobilization/coverage.js";
import { resolveEffectiveScope } from "../../domains/election/responsibility.js";
import { Label, Panel, StructuredWritePanel, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER } from "./shared.jsx";
import { ContextualAsk } from "./AskAssistant.jsx";
import { useTranslation } from "./useTranslation.js";

// UX REDESIGN SLICE 5 — Work/mobilisation has no dedicated Ask intent today
// (see AskAssistant.jsx's own audit) — this offers the same general,
// already-answerable prompt every page can honestly offer, never a
// fabricated Work-specific capability.
const WORK_PROMPTS = Object.freeze(["What should we do next?"]);

// UX REDESIGN SLICE 3 (WORK = ACTION) — "Field Roster", not "People": this
// tab is Mobilize's own free-text field roster (ctx.view.people, added via
// ADD_PERSON below) — a genuinely different population from the top-level
// People section's real, sign-in-capable campaign_members roster (see
// PeopleTab's own read and OrganisationSection.jsx's header on why the two
// are deliberately never merged). Tab id is unchanged — only the label.
const TABS = Object.freeze([
  { id: "people", label: "Field Roster" },
  { id: "wards", label: "Wards" },
  { id: "assignments", label: "Assignments" },
  { id: "tasks", label: "Tasks" },
  { id: "coverage", label: "Coverage" },
]);

function SubNav({ tab, setTab }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "8px 14px", cursor: "pointer",
              background: active ? "rgba(10,180,160,0.12)" : "transparent",
              border: `1px solid ${active ? TEAL : BORDER}`, color: active ? IVORY : MUTED }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
      padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>{children}</div>
  );
}
function Empty({ children }) {
  return <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>{children}</div>;
}
function chip(color) {
  return { fontFamily: UI, fontWeight: 700, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase",
    color, border: `1px solid ${color}`, padding: "3px 8px" };
}

// ROLE_SCOPE_03 — a scoped viewer (LGA/Ward/Polling-Unit Coordinator) sees
// only field-roster people whose CURRENT responsibility geography falls
// within their own scope (self + real descendants — see
// getScopeGeographyRefs()'s own header). A person with no responsibility
// assignment yet has no known geography, so only campaign-wide viewers
// (owner/manager/Constituency Lead, or nobody with a scoped responsibility)
// see them — the same "don't guess a scope" discipline every other honest
// gap in this codebase already follows. `scope` is null while still
// resolving (owner/manager's common case never resolves one at all, so
// unscoped-by-default is also the correct loading state).
function scopedPeople(view, scope) {
  const people = Object.values(view?.people ?? {});
  if (!scope || scope.isCampaignWide) return people;
  const responsibilities = Object.values(view?.responsibilities ?? {});
  const geoForPerson = new Map(responsibilities.map((r) => [r.person, r.geographyRef]));
  return people.filter((p) => {
    const geo = geoForPerson.get(p.id);
    return geo && scope.scopeGeographyRefs?.has(geo);
  });
}

function PeopleTab({ ctx, campaignId, refresh, scope }) {
  const { t } = useTranslation();
  const people = scopedPeople(ctx.view, scope);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>{t("mobilize.fieldRoster")}</Label>
        <Panel>
          {people.length === 0
            ? <Empty>{t("mobilize.noPeopleYet")}</Empty>
            : people.map((p) => (
              <Row key={p.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{p.name}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>{p.contact ?? "no contact recorded"}</div>
                </div>
                <span style={chip(TEAL)}>{(p.roleType ?? "").replace(/_/g, " ")}</span>
              </Row>
            ))}
        </Panel>
      </div>
      <div>
        <StructuredWritePanel
          title={t("action.addPerson")} operation={MOBILIZATION_OPERATION.ADD_PERSON}
          prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
          campaignId={campaignId} refresh={refresh}
          fields={[
            { id: "name", label: "Name", placeholder: "e.g. Amaka Obi" },
            { id: "roleType", label: "Role", type: "select", options: PERSON_ROLE_TYPES.map((r) => ({ value: r, label: r.replace(/_/g, " ") })) },
            { id: "contact", label: "Contact (optional)", placeholder: "Phone or email" },
          ]}
        />
      </div>
    </div>
  );
}

function WardsTab({ ctx }) {
  const { t } = useTranslation();
  const wards = Object.values(ctx.view?.wards ?? {});
  const tasks = Object.values(ctx.view?.tasks ?? {});
  const uncovered = wards.filter((w) => !w.organisation);
  const sorted = [...wards].sort((a, b) => (a.organisation ? 1 : 0) - (b.organisation ? 1 : 0));
  return (
    <div>
      {/* ELECTIONCANON 1.1.1 UX REFINEMENT PASS — user-centered copy only;
          the underlying data source (ctx.view.wards, Mobilize's own
          free-text ward log) is unchanged. Deliberately NOT pulled from
          responsibility_slots/coverage.js — that is a different ward
          population Home's Coverage card already covers; merging the two
          here would double-count the same gap under two names. See
          attention.js's own header for why this distinction matters. */}
      <Label>{t("home.yourWards")}</Label>
      {wards.length > 0 && (
        <div style={{ fontFamily: UI, fontSize: 11.5, color: uncovered.length ? PINK : TEAL, marginBottom: 10 }}>
          {uncovered.length === 0 ? "Every known ward has a coordinator or team assigned." : `${uncovered.length} ward${uncovered.length === 1 ? "" : "s"} with no coordinator or team — shown first below.`}
        </div>
      )}
      <Panel>
        {wards.length === 0
          ? <Empty>No ward responsibility assigned yet. Responsibilities will appear here when ElectionCanon assigns them to you.</Empty>
          : sorted.map((w) => {
            const outstanding = tasks.filter((t) => t.ward === w.id && t.status !== TASK_STATUS.COMPLETE).length;
            return (
              <Row key={w.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{w.id}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                    coordinator/team: {w.organisation ?? "unassigned"} · {outstanding} outstanding task{outstanding === 1 ? "" : "s"}
                  </div>
                </div>
                <span style={chip(w.status === "on-track" ? TEAL : AMBER)}>{w.status ?? "no status reported"}</span>
              </Row>
            );
          })}
      </Panel>
    </div>
  );
}

function AssignmentsTab({ ctx, campaignId, refresh }) {
  const { t } = useTranslation();
  const assignments = Object.values(ctx.view?.assignments ?? {});
  const wards = Object.values(ctx.view?.wards ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>{t("mobilize.assignments")}</Label>
        <Panel>
          {assignments.length === 0
            ? <Empty>{t("mobilize.noAssignmentsYet")}</Empty>
            : assignments.map((a) => (
              <Row key={a.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{a.assignee} → {a.ward}</div>
                </div>
                <span style={chip(a.status === ASSIGNMENT_STATUS.COMPLETE ? TEAL : a.status === ASSIGNMENT_STATUS.BLOCKED ? PINK : AMBER)}>{a.status}</span>
              </Row>
            ))}
        </Panel>
        {assignments.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title={t("action.changeAssignmentStatus")} operation={MOBILIZATION_OPERATION.CHANGE_ASSIGNMENT_STATUS}
              prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER}
              fields={[
                { id: "assignmentId", label: "Assignment", type: "select",
                  options: assignments.map((a) => ({ value: a.id, label: `${a.assignee} → ${a.ward}` })) },
                { id: "status", label: "Status", type: "select",
                  options: Object.values(ASSIGNMENT_STATUS).map((s) => ({ value: s, label: s })) },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <StructuredWritePanel
          title={t("action.createAssignment")} operation={MOBILIZATION_OPERATION.CREATE_ASSIGNMENT}
          prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
          campaignId={campaignId} refresh={refresh}
          fields={[
            { id: "ward", label: "Ward", placeholder: wards[0]?.id ? `e.g. ${wards[0].id}` : "e.g. Uvwie Ward 3" },
            { id: "assignee", label: "Person or team", placeholder: "e.g. Election Agent Team" },
          ]}
        />
      </div>
    </div>
  );
}

function TasksTab({ ctx, campaignId, refresh }) {
  const { t } = useTranslation();
  const tasks = Object.values(ctx.view?.tasks ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>{t("mobilize.tasks")}</Label>
        <Panel>
          {tasks.length === 0
            ? <Empty>{t("mobilize.noTasksYet")}</Empty>
            : tasks.map((task) => (
              <Row key={task.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{task.title}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {[task.ward, task.owner, task.priority, task.dueDate].filter(Boolean).join(" · ") || "no detail recorded"}
                  </div>
                </div>
                <span style={chip(task.status === TASK_STATUS.COMPLETE ? TEAL : task.status === TASK_STATUS.BLOCKED ? PINK : AMBER)}>{task.status}</span>
              </Row>
            ))}
        </Panel>
        {tasks.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title={t("action.changeTaskStatus")} operation={MOBILIZATION_OPERATION.CHANGE_TASK_STATUS}
              prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER}
              fields={[
                { id: "taskId", label: "Task", type: "select", options: tasks.map((task) => ({ value: task.id, label: task.title })) },
                { id: "status", label: "Status", type: "select", options: Object.values(TASK_STATUS).map((s) => ({ value: s, label: s })) },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <StructuredWritePanel
          title={t("action.createTask")} operation={MOBILIZATION_OPERATION.CREATE_TASK}
          prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
          campaignId={campaignId} refresh={refresh}
          fields={[
            { id: "title", label: "Title", placeholder: "e.g. Verify polling-unit information" },
            { id: "description", label: "Description (optional)" },
            { id: "owner", label: "Owner (optional)" },
            { id: "ward", label: "Ward (optional)" },
            { id: "priority", label: "Priority", type: "select", options: [{ value: "", label: "Not set" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }] },
            { id: "dueDate", label: "Due date (optional, YYYY-MM-DD)" },
          ]}
        />
      </div>
    </div>
  );
}

// ALPHA 1.3 — geography-level agent coverage (national -> state -> LGA ->
// ward -> polling unit), computed by domains/election/mobilization/
// coverage.js from the SAME pollingUnits/agents fold Election Day already
// reads. A level with zero recorded polling units shows "not surveyed",
// never a fabricated 0% — see coverage.js's own header for why.
function CoverageBar({ counts }) {
  const pct = counts.coveragePercent;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: BORDER, position: "relative" }}>
        {pct != null && <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: pct === 100 ? TEAL : pct === 0 ? PINK : AMBER }} />}
      </div>
      <span style={{ fontFamily: UI, fontSize: 10.5, fontWeight: 700, color: MUTED, minWidth: 108, textAlign: "right" }}>
        {pct == null ? "not surveyed" : `${counts.assignedCount}/${counts.totalPollingUnits} PUs (${pct}%)`}
      </span>
    </div>
  );
}

function CoverageTab({ ctx }) {
  const { t } = useTranslation();
  const coverage = computeMobilizationCoverage(ctx.view ?? {});
  const states = Object.entries(coverage.byState).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div>
      <Label>{t("mobilize.agentCoverage")}</Label>
      <Panel>
        {coverage.national.totalPollingUnits === 0 ? (
          <Empty>No polling units recorded yet — coverage cannot be computed until at least one exists.</Empty>
        ) : (
          <>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: IVORY, marginBottom: 6 }}>{t("territory.national")}</div>
            <CoverageBar counts={coverage.national} />
            <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginTop: 4 }}>
              {coverage.national.onGroundCount} of {coverage.national.totalPollingUnits} polling units report an agent actually on the ground
              (assigned is not the same as present).
            </div>
          </>
        )}
        {states.map(([stateName, state]) => (
          <div key={stateName} style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: IVORY, marginBottom: 6 }}>{stateName}</div>
            <CoverageBar counts={state.counts} />
            {Object.entries(state.byLga).sort((a, b) => a[0].localeCompare(b[0])).map(([lgaName, lga]) => (
              <div key={lgaName} style={{ marginLeft: 16, marginTop: 10 }}>
                <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>{lgaName}</div>
                <CoverageBar counts={lga.counts} />
                {Object.entries(lga.byWard).sort((a, b) => a[0].localeCompare(b[0])).map(([wardName, ward]) => (
                  <div key={wardName} style={{ marginLeft: 16, marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: UI, fontSize: 10, color: MUTED, minWidth: 90 }}>{wardName}</span>
                    <div style={{ flex: 1 }}><CoverageBar counts={ward.counts} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </Panel>
      {coverage.unassignedPollingUnits.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Label>Polling units with no agent assigned ({coverage.unassignedPollingUnits.length})</Label>
          <Panel>
            {coverage.unassignedPollingUnits.map((pu) => (
              <Row key={pu.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{pu.code}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>{pu.ward}, {pu.lga}, {pu.state}</div>
                </div>
                <span style={chip(PINK)}>no agent</span>
              </Row>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}

export default function MobilizeSection({ ctx, campaignId, userId, refresh, onSection }) {
  const [tab, setTab] = useState("people");
  // ROLE_SCOPE_03 — resolved once per mount/campaign/user, same
  // isScopedResponsibility() decision Places/Canon already make (see
  // responsibility.js's own header on resolveEffectiveScope). null while
  // resolving; scopedPeople() above treats null as campaign-wide, which is
  // also the correct owner/manager steady state (they never resolve a
  // scoped responsibility at all).
  const [scope, setScope] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!userId) { setScope(null); return undefined; }
    (async () => {
      const s = await resolveEffectiveScope({ client: supabase, view: ctx.view, campaignId, userId });
      if (!cancelled) setScope(s);
    })();
    return () => { cancelled = true; };
  }, [ctx.view, campaignId, userId]);

  // ROLE_SCOPE_03 — DELIBERATE SCOPE LIMIT, not an oversight. Field Roster
  // (PeopleTab, above) is scoped because each person's current geography is
  // a real, unambiguous geography_* id via their responsibility slot. Wards/
  // Assignments/Tasks below are Mobilize's OWN free-text log (see
  // WardsTab's own header: "the SAME free-text ward log", never
  // geography_wards ids) — there is no reliable id to scope them by without
  // fuzzy-matching free text against real geography, which risks silently
  // hiding or leaking data on a name collision. ROLE_SCOPE_02 never
  // demonstrated a cross-LGA leak through these three tabs (no test data
  // existed there), so they are left campaign-wide here rather than adding
  // unproven, fragile filtering — flag this explicitly if real free-text
  // ward data starts being used in anger.
  return (
    <div>
      {/* UX REDESIGN SLICE 3 (WORK = ACTION) — Mobilisation is presented as
          ONE operational work domain here, not the entire meaning of Work.
          No new backend, no new work type — this is a framing line plus a
          cross-link to Places, which already holds the campaign's official
          geography coverage (a genuinely different fact from the field-roster
          ward log the tabs below read — see WardsTab's own header). */}
      <div style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
        Mobilisation — people, wards, assignments and tasks for get-out-the-vote coordination.
        {onSection && (
          <>
            {" "}For the campaign's official geography coverage, see{" "}
            <button type="button" onClick={() => onSection("territory")}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11.5, color: TEAL, background: "transparent",
                border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
              Places
            </button>.
          </>
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <ContextualAsk triggerLabel="Ask about this work" contextLabel="Work"
          suggestedPrompts={WORK_PROMPTS} view={ctx.view ?? {}} onSection={onSection} />
      </div>
      <SubNav tab={tab} setTab={setTab} />
      {tab === "people" && <PeopleTab ctx={ctx} campaignId={campaignId} refresh={refresh} scope={scope} />}
      {tab === "wards" && <WardsTab ctx={ctx} />}
      {tab === "assignments" && <AssignmentsTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "tasks" && <TasksTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "coverage" && <CoverageTab ctx={ctx} />}
    </div>
  );
}
