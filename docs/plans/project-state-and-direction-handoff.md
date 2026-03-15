# Project State and Direction Handoff

## Purpose

This document is the canonical handoff for a new agent entering the SPORE repository.

Use it to answer five questions quickly:

1. What stage of implementation is SPORE currently in?
2. What is already working and should be treated as stable enough to build on?
3. What is incomplete, risky, or still transitional?
4. What direction is the project currently taking?
5. What should the next agent work on first without re-discovering the same context?

This document is intentionally broader than `docs/plans/self-build-status-and-next-steps.md` and less prescriptive than `docs/plans/full-self-build-implementation-plan.md`.

- Use `self-build-status-and-next-steps` for the tactical project work management snapshot.
- Use `full-self-build-implementation-plan` for the execution-facing roadmap until a renamed successor exists.
- Use this file as the orientation and decision context layer between those two.

## Executive Summary

SPORE is no longer in bootstrap mode.

It already has:
- a documentation-first architecture foundation,
- a PI-powered runtime boundary (PI is the core agent runtime partner, not an optional dependency),
- durable session, execution, scenario, regression, and project work management state,
- workspace-backed mutation isolation,
- project-scoped `coordinator` and `integrator` lanes,
- a governed work management pipeline (goal → plan → execute → validate → promote) that works on any project,
- promotion to integration branches,
- quarantine, rollback, and protected-scope override surfaces,
- browser, HTTP, package-level CLI, and TUI operator surfaces.

The project is now in a **unification phase**:

The work management pipeline (previously called "self-build") is being formalized as SPORE's standard way of managing work on **any project**, not just SPORE itself. Analysis showed that ~95% of the pipeline code is already generic -- only ~200-300 lines contain SPORE-specific hardcoding that needs to be externalized to configuration.

See `docs/decisions/ADR-0017-unified-project-work-management.md` for the architectural decision and `docs/plans/unification-refactoring-plan.md` for the implementation plan.

The current system is strong enough for governed project work management in controlled, inspectable, policy-gated loops. It is not yet strong enough to claim fully unattended multi-project autopilot.

## Current Maturity Level

### What SPORE Can Do Today

SPORE can already:
- plan work through goal plans and work-item templates,
- review and edit goal plans before materialization,
- materialize plans into dependency-aware work-item groups,
- run grouped work with recovery controls,
- provision dedicated git worktrees for mutating runs,
- generate proposal artifacts and review packages,
- validate proposals through named validation bundles,
- distinguish approval from promotion readiness,
- promote through `coordinator -> integrator` lanes,
- land promotion candidates on integration branches,
- quarantine or roll back blocked or unsafe work,
- track autonomous decisions durably,
- surface learnings, doc suggestions, intake, and policy recommendations,
- expose project work lifecycle state through Web, TUI, CLI, and HTTP.

### What SPORE Cannot Yet Claim

SPORE should **not** currently be described as:
- a fully autonomous whole-repo builder,
- an auto-merge system to `main`,
- a self-healing autopilot with complete rollback intelligence,
- a production-grade, no-human-in-the-loop swarm runtime.

The missing layer is not the basic execution engine anymore. The missing layer is:
- autonomy depth,
- safety policy depth,
- planning quality,
- richer promotion/readiness discipline,
- stronger lifecycle visibility,
- better recovery and prioritization behavior.

## What Is Already Stable Enough To Build On

The following areas should be treated as stable enough to extend rather than redesign.

### Documentation and Governance Baseline

Stable enough:
- canonical docs indexes,
- ADR discipline,
- architecture docs for runtime, workflow, role, config, and clients,
- planning docs for project work management,
- TypeScript-first codebase baseline.

Implication:
- new work should update docs, not invent parallel narratives.

### Runtime and Session Layer

Stable enough:
- `packages/runtime-pi/` as the PI integration boundary,
- `packages/session-manager/` as session state authority,
- `services/session-gateway/` as session/control/live surface,
- tmux-backed inspectable session model,
- real `pi-rpc` validation path.

Implication:
- new clients or automation should build on the gateway/orchestrator surfaces, not local file scraping.

### Orchestrator and Workflow Layer

Stable enough:
- durable execution store,
- workflow waves and gates,
- execution trees and coordination groups,
- review and approval gates,
- project-root `coordinator` flow,
- `integrator` promotion lane,
- policy-aware execution behavior.

Implication:
- new project work flows should compose around these concepts, not bypass them.

### Project Work Management Layer

Stable enough:
- work items,
- work-item groups,
- goal plans,
- work-item templates,
- proposal artifacts,
- validation bundles,
- autonomous decisions,
- quarantine/rollback surfaces,
- policy recommendations,
- doc suggestions,
- intake queue,
- project work dashboard.

Implication:
- next work should make this layer deeper, more general, and more autonomous, not rebuild it from scratch.

## Current Direction Of Development

The project is currently moving in two clear directions:

> **1. Unify the work management pipeline** so it serves any project, not just SPORE itself (see ADR-0017).
> **2. Deepen the pipeline's autonomy, safety, and operator experience** to handle more complex work with less supervision.

In practice that means the center of gravity has moved away from bootstrap and infrastructure setup, and toward:
- pipeline generalization across projects,
- stronger PI-backed execution as the normal operating mode,
- planning quality and autonomous scheduling,
- stronger proposal and validation discipline,
- integration-branch promotion flows,
- richer operator visibility,
- controlled expansion of autonomous scope.

The next meaningful improvements are no longer “make the repo runnable.” They are:
- “make the project work management loop deeper, safer, and more useful.”

## What Is Incomplete Or Underdeveloped

### 1. Full Unattended Whole-Repo Autonomy

This is the biggest missing capability.

What is still missing:
- stronger autonomous scheduler behavior,
- better autonomous prioritization beyond the current queue scoring,
- clearer whole-repo rollout tiers,
- stronger protected-scope rules for high-risk areas,
- richer automatic re-planning after blockers,
- stronger no-human-needed promotion discipline for selected scopes.

Current reality:
- autonomy exists,
- but it is still intentionally constrained and policy-gated.

### 2. Planner Quality

The planner is usable, but not yet as strong as the rest of the system.

Gaps:
- project-aware planning can go deeper,
- domain-specific template selection is still somewhat shallow,
- intake prioritization is still more deterministic than intelligent,
- repeated blockers should influence future planning more strongly than they do now.

Impact:
- SPORE can plan work, but not yet with the level of nuance needed for highly autonomous whole-repo self-improvement.

### 3. Promotion Readiness And Rework Discipline

A major improvement already landed: `approved` is not the same as `promotion_ready`.

What still needs more depth:
- richer proposal rework lineage,
- stronger linkage between failed validation and required repair work,
- clearer promotion backlog views,
- better explanation of why a proposal is still not ready even after approval.

Impact:
- the proposal lifecycle is structurally correct, but still not rich enough to be the final long-term review/promote contract.

### 4. Autonomous Decision Introspection

Durable decisions exist, but the decision story is still thinner than ideal.

What is missing:
- better trend and explanation surfaces for why the autonomous loop did or did not act,
- stronger review queue for policy recommendations,
- better linkage from blocker clusters to future autonomy tuning,
- richer operator understanding of policy matches and rejected actions.

Impact:
- SPORE records decisions, but still explains them less richly than a production-grade autonomy control plane should.

### 5. Integration Branch Diagnostics

Integration branches exist as landing targets and promotion records exist.

Still underdeveloped:
- stale integration branch detection,
- branch health summaries,
- conflict pattern history,
- branch-specific recovery playbooks,
- stronger relationship between integration diagnostics and intake generation.

Impact:
- the landing zone exists, but the branch hygiene and long-lived diagnostics are still relatively thin.

### 6. Project Work Lifecycle Dashboard Depth

The dashboard is now genuinely useful, but it is still not the final operator control plane.

Still missing or underdeveloped:
- deeper lifecycle visualization of autonomous runs over time,
- better promotion backlog views,
- stronger review queue views for recommendation/override items,
- tighter grouping by project scope, protected tier, and rollout tier,
- richer evidence drilldowns directly from lifecycle cards.

Impact:
- the operator can already use the dashboard, but it is not yet the final “mission control” for project work.

### 7. Project Work Scenario and Regression Coverage

Canonical project-work scenarios and regressions now exist, but the matrix still needs growth.

Missing depth:
- more project-work-specific failure mode scenarios,
- more protected-scope and quarantine recovery scenarios,
- stronger autonomous-loop regression scenarios,
- scenarios for long-running intake and recommendation churn.

Impact:
- the validation baseline is good, but not yet complete enough for stronger whole-repo autonomy claims.

## Areas That Need Extra Care

These are the places where a new agent should assume there is elevated architectural risk.

### Protected-Scope Automation

High risk if mishandled.

Rules that should remain intact:
- do not silently bypass protected tiers,
- do not treat human overrides as permanent permission broadening,
- do not weaken review/promotion requirements to make autonomy “feel smoother.”

### Promotion And Merge Semantics

High risk because this is where unsafe automation tends to hide.

Rules that should remain intact:
- approval is not promotion,
- promotion is not merge to `main`,
- integration branches remain the safe default landing target,
- semantic or ambiguous conflicts must not be papered over as mechanical.

### Workspace Discipline

High risk because project work mutates repo state.

Rules that should remain intact:
- no shared family worktree default,
- mutating work should stay in dedicated workspaces,
- cleanup must remain governance-aware,
- root branch mutation should not happen directly from promotion flow.

### Heavy Integration Suites

Operational risk, not conceptual risk.

Current state:
- `test:http` and `test:tui` are stabilized enough to pass cleanly,
- but they remain heavy and deserve continued care.

Rule:
- treat harness reliability as a product concern, not as disposable test plumbing.

## What Is Not Well Covered Yet

If a new agent wants to add value, these areas are under-served right now.

### Autonomous Prioritization Logic

There is now intake, queueing, and policy gating, but prioritization can become much better.

Under-covered aspects:
- repeated blocker weighting,
- integration branch degradation feeding priority,
- aging urgency,
- validation debt accumulation,
- recommendation materialization priority.

### Policy Recommendation Review Loop

Recommendation records exist and review/materialization exist, but this loop is still young.

Under-covered aspects:
- stronger review rationale capture,
- trend-based recommendation grouping,
- operator fatigue reduction,
- bulk decision support,
- recommendation retirement or expiration behavior.

### Autonomy Rollout Strategy

The project needs a stronger story for “how autonomy expands safely over time.”

Under-covered aspects:
- explicit rollout levels by repo scope,
- protected areas with more granular policy classes,
- transition criteria from supervised to more aggressive autonomy,
- measurable signals for safe expansion.

### Learning-To-Planning Feedback

Learnings exist and trends exist.

Under-covered aspects:
- direct use of learning patterns in planner scoring,
- automated planner downgrades after repeated failures,
- recommendation generation that is not just record emission but planning influence.

## Recommended Reading Order For A New Agent

A new agent should read in this order:

1. [docs/INDEX.md](../INDEX.md)
2. [docs/plans/project-state-and-direction-handoff.md](project-state-and-direction-handoff.md)
3. [docs/decisions/ADR-0017-unified-project-work-management.md](../decisions/ADR-0017-unified-project-work-management.md)
4. [docs/plans/self-build-status-and-next-steps.md](self-build-status-and-next-steps.md)
5. [docs/plans/unification-refactoring-plan.md](unification-refactoring-plan.md)
6. [docs/plans/roadmap.md](roadmap.md)
7. [docs/architecture/role-model.md](../architecture/role-model.md)
8. [docs/architecture/workflow-model.md](../architecture/workflow-model.md)
9. [docs/architecture/config-model.md](../architecture/config-model.md)
10. [docs/architecture/clients-and-surfaces.md](../architecture/clients-and-surfaces.md)
11. [docs/specs/worktree-and-workspace-isolation.md](../specs/worktree-and-workspace-isolation.md)
12. [README.md](../../README.md)

If the task touches project-level roles or promotion, then also read:
- [docs/decisions/ADR-0006-project-coordinator-role.md](../decisions/ADR-0006-project-coordinator-role.md)
- [docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md](../decisions/ADR-0007-feature-integrator-promotion-boundary.md)

If the task touches autonomous policy or project work roadmap shape, then also read:
- [docs/plans/long-range-self-build-roadmap.md](long-range-self-build-roadmap.md)

## Recommended Next Work Packages

These are the most valuable next work packages, in order.

### Package 1 — Stronger Autonomous Scheduler

Goal:
- improve how SPORE chooses the next self-work autonomously.

Focus:
- intake prioritization quality,
- blocked-item aging,
- validation debt,
- repeated blocker penalties,
- integration health as a priority signal.

### Package 2 — Integration Branch Diagnostics

Goal:
- make the integration landing zone much more inspectable and operationally meaningful.

Focus:
- stale branch detection,
- branch health summaries,
- conflict history,
- branch recovery recommendations,
- intake generation from branch degradation.

### Package 3 — Richer Lifecycle Dashboard

Goal:
- make the project work dashboard the main operational control plane.

Focus:
- active autonomous run views,
- blocked promotions,
- pending validations,
- quarantined work,
- override and recommendation review queues,
- stronger evidence drilldowns.

### Package 4 — Project Work Scenario Expansion

Goal:
- harden the project work loop with stronger regression coverage.

Focus:
- protected-scope block scenarios,
- quarantine/release flows,
- repeated validation drift,
- branch recovery,
- autonomous retry behavior,
- recommendation review/materialization loops.

### Package 5 — Learning-Driven Planner Upgrades

Goal:
- make the planner measurably better using the data SPORE already collects.

Focus:
- repeated failure patterns,
- recommendation trends,
- validation bottlenecks,
- safer template selection,
- policy-aware planning downgrades.

## Recommended Non-Goals For The Immediate Next Wave

A new agent should avoid these unless there is a very explicit reason:
- rebuilding runtime foundations,
- replacing the project work management model with a new abstraction,
- auto-merging to `main`,
- weakening validation or promotion gates to increase autonomy quickly,
- bypassing orchestrator or gateway surfaces in favor of direct SQLite scraping,
- introducing shared mutable worktree behavior as a shortcut.

Approved exception:
- a bounded multi-backend PI runtime adapter migration is allowed under `ADR-0014`, `ADR-0015`, and `ADR-0016` when the work preserves the existing PI-first runtime slice and improves backend isolation without weakening inspectability or recovery.

## Verification Expectations

For project work management changes, the minimum expected verification loop remains:

```bash
npm run docs-kb:index
npm run config:validate
npm run typecheck
npm run lint
npm run test:http
npm run test:tui
npm run test:web
```

For runtime-sensitive changes, add:

```bash
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

For planner/project-work execution changes, also validate the operator flow you changed using the corresponding HTTP or CLI surface, not just unit tests.

## Bottom-Line Assessment

SPORE is past the stage where the main question is “can it run?”

The main question now is:

> can it safely, visibly, and repeatably improve itself over larger parts of the repository without collapsing operator trust?

Today’s answer is:
- **yes, for supervised project work management and guarded autonomous self-improvement**,
- **not yet for full unattended whole-repo autopilot**.

That is the correct stage to be in.

The next work should deepen autonomy deliberately rather than broadening it recklessly.
