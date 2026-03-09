# Roadmap: SPORE Self-Build Milestone

## Overview

This roadmap turns SPORE's existing self-build primitives into a supervised product loop by first establishing shared self-build visibility over orchestrator-owned read models, then layering dependency-aware execution, guided goal-to-run flow, proposal review, scenario-backed validation, safe-mode enforcement, and operational follow-up. Every phase extends the current orchestrator, session, web, and TUI boundaries instead of creating parallel systems, and keeps review gates plus shared HTTP surfaces central.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Self-Build Visibility** - Establish a dedicated dashboard and linked self-build read models over existing orchestrator surfaces. ✅ 2026-03-09
- [ ] **Phase 2: Dependency-Aware Work Graphs** - Make grouped self-build execution respect prerequisites and expose blocked readiness clearly.
- [ ] **Phase 3: Guided Goal-to-Run Flow** - Let operators plan, materialize, template, and launch self-build work from one conservative flow.
- [ ] **Phase 4: Proposal Review Hub** - Turn proposal artifacts into the durable governance package for code-oriented self-build work.
- [ ] **Phase 5: Validation Evidence Bundles** - Attach named scenario-backed validation and require evidence before proposal completion.
- [ ] **Phase 6: Safe-Mode Defaults** - Enforce mutation scope and project-level governance defaults across plan, run, and review.
- [ ] **Phase 7: Queue Operations And Follow-Up** - Scale supervised self-build with queue controls, doc review, learning capture, and failure signals.

## Phase Details

### Phase 1: Self-Build Visibility
**Goal**: Operators can inspect the self-build program from one dedicated surface with durable lineage across the supervised loop.
**Depends on**: Nothing (first phase)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, FLOW-03
**Success Criteria** (what must be TRUE):
  1. Operator can open a dedicated self-build dashboard that is distinct from the general run-center views.
  2. Operator can see active work-item groups, blocked work items, pending proposals, pending validation, and recent follow-up signals from one self-build summary surface.
  3. Operator can drill from self-build summary cards into linked goal plans, work-item groups, work items, work-item runs, proposal artifacts, validation evidence, doc suggestions, and learning records.
  4. Web and TUI self-build views show the same lifecycle state from shared orchestrator-composed read models rather than direct SQLite or filesystem reads.
**Plans**: 3 plans

Plans:
- [x] `01-01-PLAN.md` - Establish the shared self-build read-model contract, lineage wiring, and validation scaffolding. ✅ 2026-03-09 (17 min, 3 tasks, 3 commits)
- [x] `01-02-PLAN.md` - Build the dedicated web self-build dashboard and hub-and-drilldown flow. ✅ 2026-03-09 (9 min, 3 tasks, 3 commits)
- [x] `01-03-PLAN.md` - Add terminal self-build triage and parity coverage over the shared read model. ✅ 2026-03-09 (4 min, 2 tasks, 2 commits)

### Phase 2: Dependency-Aware Work Graphs
**Goal**: Operators can run grouped self-build work safely because prerequisites and blocked downstream work are explicit.
**Depends on**: Phase 1
**Requirements**: GRP-01, GRP-02, GRP-03
**Success Criteria** (what must be TRUE):
  1. Operator can define explicit dependencies between work items inside a work-item group.
  2. Downstream work items stay blocked with visible dependency reasons until required predecessor work completes successfully.
  3. Work-item groups report readiness, blocked, running, failed, and completed state from child dependency state instead of manual status setting.
**Plans**: 2 plans

Plans:
- [x] `02-01-PLAN.md` - Establish the dependency graph contract, authoring routes, and dependency-aware group execution semantics. ✅ 2026-03-09 (2h 21m, 3 tasks, 5 commits)
- [ ] `02-02-PLAN.md` - Expose dependency setup and readiness-first visibility across the web and TUI self-build surfaces.

### Phase 3: Guided Goal-to-Run Flow
**Goal**: Operators can move from intent to started self-build work through one conservative, linked workflow.
**Depends on**: Phase 1 and Phase 2
**Requirements**: FLOW-01, FLOW-02, FLOW-04, TEMP-01, PLAN-01
**Success Criteria** (what must be TRUE):
  1. Operator can materialize a goal plan into linked work-item groups and work items with durable lineage.
  2. Operator can bootstrap common SPORE self-build tasks from reusable templates, and the planner recommends templates, validation bundles, and governance level using project and domain context conservatively.
  3. Operator can start managed self-build work from the guided self-build flow without stitching together separate commands or screens manually.
  4. Operator can follow one end-to-end supervised self-build path from goal creation through reviewed outcome.
**Plans**: 3 plans

### Phase 4: Proposal Review Hub
**Goal**: Code-oriented self-build work stops at a durable proposal review boundary with explicit decisions and rework linkage.
**Depends on**: Phase 3
**Requirements**: PROP-01, PROP-02, PROP-03, PROP-04
**Success Criteria** (what must be TRUE):
  1. Code-oriented work-item runs produce normalized proposal artifacts with summary, affected scope, linked files or docs, and validation status.
  2. Reviewer can record proposal review notes and append-only decision history directly on the proposal artifact.
  3. Rejected proposals create explicit rework or retry linkage back to the originating work item and run.
  4. Proposal review and approval states remain visible as distinct governance states rather than collapsing into generic blocked or failed execution states.
**Plans**: 2 plans

### Phase 5: Validation Evidence Bundles
**Goal**: Proposal approval is backed by named, reusable validation bundles and visible evidence gaps.
**Depends on**: Phase 4
**Requirements**: VALD-01, VALD-02, VALD-03, VALD-04, SCEN-01
**Success Criteria** (what must be TRUE):
  1. Operator can attach named validation bundles to self-build work from templates and project defaults before execution starts.
  2. Validation bundles resolve to existing scenario and regression definitions instead of relying on ad hoc commands alone.
  3. Proposal review surfaces show required validation evidence, completed validation evidence, and remaining validation gaps.
  4. Proposal completion or approval stays blocked when required validation evidence is missing or incomplete.
  5. Named supervised self-build scenarios exist for docs or config-only work, operator-surface work, validation-harness maintenance, and proposal-review flow validation.
**Plans**: 3 plans

### Phase 6: Safe-Mode Defaults
**Goal**: Self-build stays safely constrained by default because scope rules and governance defaults are enforced before approval.
**Depends on**: Phase 3, Phase 4, and Phase 5
**Requirements**: SAFE-01, SAFE-02, SAFE-03
**Success Criteria** (what must be TRUE):
  1. Safe mode enforces allowed mutation scope server-side during planning, execution, and review.
  2. Operator can see whether self-build work is in allowed, restricted, or forbidden scope before approval.
  3. The SPORE project profile defines default governance, validation, and safe-mode behavior for self-build work.
**Plans**: 2 plans

### Phase 7: Queue Operations And Follow-Up
**Goal**: Operators can supervise self-build at scale through durable queues, follow-up review surfaces, and failure signals.
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, and Phase 6
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, DOCS-01, LEARN-01, FAIL-01
**Success Criteria** (what must be TRUE):
  1. Operator can work from self-build queues for pending, blocked, running, waiting review, waiting approval, and failed work.
  2. Queue entries expose next action, blocked reason, and linked lineage context, and queue views can be filtered or grouped by goal plan, work-item group, or status.
  3. Operator can review documentation suggestions and learning records linked to self-build outcomes from visible queue or drilldown surfaces.
  4. Operator can see repeated failure patterns across blocked work, validation failures, proposal rejections, and governance stalls.
**Plans**: 3 plans

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Self-Build Visibility | 3/3 | Complete   | 2026-03-09 |
| 2. Dependency-Aware Work Graphs | 1/2 | In Progress | - |
| 3. Guided Goal-to-Run Flow | 0/3 | Not started | - |
| 4. Proposal Review Hub | 0/2 | Not started | - |
| 5. Validation Evidence Bundles | 0/3 | Not started | - |
| 6. Safe-Mode Defaults | 0/2 | Not started | - |
| 7. Queue Operations And Follow-Up | 0/3 | Not started | - |
