# Self-Build Status and Next Steps

## Purpose

This is the tactical status and next-work document for SPORE's self-build slice.

Use it to answer three questions quickly:

1. What is already implemented and working?
2. What is still missing before SPORE has a stronger self-build loop?
3. What should the next implementation packages be?

## Current Baseline

SPORE already has a real supervised self-build foundation.

Implemented today:

- work-item templates,
- goal plans with review, edit history, materialization, and run flows,
- dependency-aware work-item groups with recovery controls,
- proposal artifacts and review packages,
- named validation bundles,
- workspace-backed mutation isolation,
- integration-branch promotion candidates through explicit `coordinator -> integrator` lanes,
- self-build loop control, intake, policy recommendations, overrides, quarantine, and rollback,
- browser, HTTP, TUI, and package-level CLI visibility into self-build state.

This means SPORE can already work on SPORE in controlled, auditable loops.

## What Still Needs Work

The major remaining gaps are not foundational runtime gaps anymore. They are quality, safety, and operator-experience gaps.

### 1. Planner And Scheduler Quality

Still missing:

- better prioritization across intake age, repeated blockers, validation debt, and integration health,
- deeper project-aware and template-aware plan generation,
- stronger feedback from learnings into future plan quality.

### 2. Validation And Promotion Discipline

Still missing:

- broader reusable validation bundles,
- stronger proposal rework lineage after failed validation,
- clearer distinction between `approved`, `validated`, and `promotion_ready` in operator views.

### 3. Integration Diagnostics

Still missing:

- stale integration branch detection,
- branch health summaries,
- conflict-pattern history,
- clearer links from branch degradation into intake and recommendation generation.

### 4. Operator Mission Control

Still missing:

- better backlog views for blocked promotions and pending validations,
- tighter review queues for overrides and policy recommendations,
- richer drilldowns from dashboard cards into evidence and recovery actions.

### 5. Scenario And Regression Coverage

Still missing:

- more self-build-specific failure-mode scenarios,
- stronger protected-scope and quarantine coverage,
- more regression coverage for autonomous retry, recommendation review, and intake churn.

## Recommended Next Work Packages

### Package 1 - Smarter Prioritization

Improve autonomous and operator-visible prioritization using:

- repeated blocker weight,
- item age,
- validation debt,
- integration health,
- recommendation urgency.

### Package 2 - Stronger Validation And Rework Semantics

Deepen the proposal lifecycle so failed or partial validation feeds explicit repair work instead of only passive status changes.

### Package 3 - Integration Branch Diagnostics

Make integration branches into a visible operational surface rather than a thin promotion landing target.

### Package 4 - Dashboard And TUI Deepening

Make self-build triage feel like a real mission-control loop, not a collection of separate screens and routes.

### Package 5 - Self-Build Regression Expansion

Harden the loop with scenario and regression coverage for protected scopes, retry/rework loops, quarantine/release flows, and recommendation review behavior.

## What A Good Next Milestone Looks Like

The next strong milestone should make one reference self-build flow feel complete:

`goal -> reviewed plan -> materialized group -> workspace-backed run -> proposal -> validation -> promotion candidate`

with:

- clear operator checkpoints,
- clear reasons when work is blocked,
- clear evidence for promotion readiness,
- clear follow-up generation when work fails.

## Verification Expectations

For self-build changes, the minimum expected loop is:

```bash
npm run docs-kb:index
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
