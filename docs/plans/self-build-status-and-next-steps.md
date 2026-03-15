# Project Work Management Status and Next Steps

## Purpose

This file keeps its historical path for compatibility, but it now describes SPORE's **Project Work Management** system.

Use it to answer three questions quickly:

1. What is already implemented and working?
2. What is still missing before SPORE has a stronger governed work pipeline?
3. What should the next implementation packages be?

"Self-build" now means the special case where SPORE uses this same pipeline to manage work on its own repository.

## Current Baseline

SPORE already has a real supervised project work management foundation.

Implemented today:

- work-item templates,
- goal plans with review, edit history, materialization, and run flows,
- dependency-aware work-item groups with recovery controls,
- proposal artifacts and review packages,
- named validation bundles,
- workspace-backed mutation isolation,
- integration-branch promotion candidates through explicit `coordinator -> integrator` lanes,
- loop control, intake, policy recommendations, overrides, quarantine, and rollback,
- browser, HTTP, TUI, and package-level CLI visibility into project work state,
- PI-powered agent execution as the standard runtime path.

This means SPORE can already manage governed work on SPORE itself and is close to managing governed work on other configured projects with the same machinery.

## What Still Needs Work

The major remaining gaps are not broad foundational runtime rebuilds anymore. They are generalization, quality, safety, and operator-experience gaps.

Approved exception:

- a bounded multi-backend PI runtime adapter migration is allowed under `ADR-0014`, `ADR-0015`, and `ADR-0016` because SPORE now needs a safer runtime boundary around the already-working PI-first slice.

### 1. Pipeline Generalization

Still missing:

- removal of hardcoded default project assumptions such as `"spore"`,
- externalized goal recommendation logic from code into project/template config,
- config-driven safe-mode scope rules,
- config-driven path-to-domain mapping.

See `docs/plans/unification-refactoring-plan.md`.

### 2. Planner And Scheduler Quality

Still missing:

- better prioritization across intake age, repeated blockers, validation debt, and integration health,
- deeper project-aware and template-aware plan generation,
- stronger feedback from learnings into future plan quality.

### 3. Validation And Promotion Discipline

Still missing:

- broader reusable validation bundles,
- stronger proposal rework lineage after failed validation,
- clearer distinction between `approved`, `validated`, and `promotion_ready` in operator views.

### 4. Integration Diagnostics

Still missing:

- stale integration branch detection,
- branch health summaries,
- conflict-pattern history,
- clearer links from branch degradation into intake and recommendation generation.

### 5. Operator Mission Control

Still missing:

- better backlog views for blocked promotions and pending validations,
- tighter review queues for overrides and policy recommendations,
- richer drilldowns from dashboard cards into evidence and recovery actions,
- clearer project-scoped views when SPORE manages more than one project.

### 6. Scenario And Regression Coverage

Still missing:

- more project-work failure-mode scenarios,
- stronger protected-scope and quarantine coverage,
- more regression coverage for autonomous retry, recommendation review, and intake churn,
- at least one strong external-project reference flow in addition to SPORE-on-SPORE.

## Recommended Next Work Packages

### Package 1 - Generalize The Pipeline

Externalize SPORE-specific assumptions into config:

- default project ID,
- goal classification and recommendation logic,
- safe-mode allowed scopes,
- path-to-domain mapping.

### Package 2 - Smarter Prioritization

Improve autonomous and operator-visible prioritization using:

- repeated blocker weight,
- item age,
- validation debt,
- integration health,
- recommendation urgency.

### Package 3 - Stronger Validation And Rework Semantics

Deepen the proposal lifecycle so failed or partial validation feeds explicit repair work instead of only passive status changes.

### Package 4 - Integration Branch Diagnostics

Make integration branches into a visible operational surface rather than a thin promotion landing target.

### Package 5 - Dashboard And TUI Deepening

Make project work triage feel like a real mission-control loop, not a collection of separate screens and routes.

### Package 6 - Regression Expansion

Harden the loop with scenario and regression coverage for protected scopes, retry/rework loops, quarantine/release flows, and recommendation review behavior.

## What A Good Next Milestone Looks Like

The next strong milestone should make one reference project-work flow feel complete:

`goal -> reviewed plan -> materialized group -> workspace-backed run -> proposal -> validation -> promotion candidate`

with:

- clear operator checkpoints,
- clear reasons when work is blocked,
- clear evidence for promotion readiness,
- clear follow-up generation when work fails,
- clear project configuration points so the same flow works beyond the SPORE repo.

## Verification Expectations

For project work management changes, the minimum expected loop is:

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

If PI is unavailable, call that out explicitly and state when stub mode was used.
