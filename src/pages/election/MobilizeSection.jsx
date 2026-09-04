// ============================================================
// ELECTION FORGE — MOBILIZE  (Alpha 1.0)
//
// People / Wards / Assignments / Tasks — real, Canon-backed (folded from
// the new mobilization.* event types, see src/domains/election/events.js
// and projections.js). Every write goes through the SAME PREPARE/APPROVE
// gating as every other Election write (electionWebAdapter.js's
// prepareMobilizationWrite/approveMobilizationWrite).
// ============================================================

import { useState } from "react";
import { prepareMobilizationWrite, approveMobilizationWrite, MOBILIZATION_OPERATION } from "../../os/electionWebAdapter.js";
import { PERSON_ROLE_TYPES, ASSIGNMENT_STATUS, TASK_STATUS } from "../../domains/election/mobilization/write.js";
import { computeMobilizationCoverage } from "../../domains/election/mobilization/coverage.js";
import { Label, Panel, StructuredWritePanel, UI, IVORY, MUTED, TEAL, AMBER, PINK, BORDER } from "./shared.jsx";

const TABS = Object.freeze([
  { id: "people", label: "People" },
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

function PeopleTab({ ctx, campaignId, refresh }) {
  const people = Object.values(ctx.view?.people ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Roster</Label>
        <Panel>
          {people.length === 0
            ? <Empty>No people added yet.</Empty>
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
          title="Add person" operation={MOBILIZATION_OPERATION.ADD_PERSON}
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
      <Label>Your wards</Label>
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
  const assignments = Object.values(ctx.view?.assignments ?? {});
  const wards = Object.values(ctx.view?.wards ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Assignments</Label>
        <Panel>
          {assignments.length === 0
            ? <Empty>No assignments recorded yet.</Empty>
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
              title="Change assignment status" operation={MOBILIZATION_OPERATION.CHANGE_ASSIGNMENT_STATUS}
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
          title="Create assignment" operation={MOBILIZATION_OPERATION.CREATE_ASSIGNMENT}
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
  const tasks = Object.values(ctx.view?.tasks ?? {});
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 18 }}>
      <div>
        <Label>Tasks</Label>
        <Panel>
          {tasks.length === 0
            ? <Empty>No tasks created yet.</Empty>
            : tasks.map((t) => (
              <Row key={t.id}>
                <div>
                  <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12.5, color: IVORY }}>{t.title}</div>
                  <div style={{ fontFamily: UI, fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {[t.ward, t.owner, t.priority, t.dueDate].filter(Boolean).join(" · ") || "no detail recorded"}
                  </div>
                </div>
                <span style={chip(t.status === TASK_STATUS.COMPLETE ? TEAL : t.status === TASK_STATUS.BLOCKED ? PINK : AMBER)}>{t.status}</span>
              </Row>
            ))}
        </Panel>
        {tasks.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <StructuredWritePanel
              title="Change task status" operation={MOBILIZATION_OPERATION.CHANGE_TASK_STATUS}
              prepareFn={prepareMobilizationWrite} approveFn={approveMobilizationWrite}
              campaignId={campaignId} refresh={refresh} accent={AMBER}
              fields={[
                { id: "taskId", label: "Task", type: "select", options: tasks.map((t) => ({ value: t.id, label: t.title })) },
                { id: "status", label: "Status", type: "select", options: Object.values(TASK_STATUS).map((s) => ({ value: s, label: s })) },
              ]}
            />
          </div>
        )}
      </div>
      <div>
        <StructuredWritePanel
          title="Create task" operation={MOBILIZATION_OPERATION.CREATE_TASK}
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
  const coverage = computeMobilizationCoverage(ctx.view ?? {});
  const states = Object.entries(coverage.byState).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div>
      <Label>Agent coverage by geography</Label>
      <Panel>
        {coverage.national.totalPollingUnits === 0 ? (
          <Empty>No polling units recorded yet — coverage cannot be computed until at least one exists.</Empty>
        ) : (
          <>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, color: IVORY, marginBottom: 6 }}>National</div>
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

export default function MobilizeSection({ ctx, campaignId, refresh }) {
  const [tab, setTab] = useState("people");
  return (
    <div>
      <SubNav tab={tab} setTab={setTab} />
      {tab === "people" && <PeopleTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "wards" && <WardsTab ctx={ctx} />}
      {tab === "assignments" && <AssignmentsTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "tasks" && <TasksTab ctx={ctx} campaignId={campaignId} refresh={refresh} />}
      {tab === "coverage" && <CoverageTab ctx={ctx} />}
    </div>
  );
}
