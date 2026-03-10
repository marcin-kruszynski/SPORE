# Full Self-Build Implementation Plan

## Purpose

This is the active implementation plan for turning SPORE from a supervised self-work platform into a self-building system that can plan, execute, validate, and promote work on SPORE itself.

This plan assumes the current repository baseline:

- durable goal plans, work-item groups, work-items, proposals, workspaces, and validation surfaces already exist
- dependency-aware grouped execution exists in the first usable slice
- coordinator and integrator project roles exist
- proposal review packages and promotion planning/invocation already exist
- self-build dashboard, Web, TUI, CLI, and HTTP surfaces already exist
- workspace-backed mutating runs already exist

This plan does not restart bootstrap work. It extends the existing platform into a production-shaped self-build loop.

## Target Outcome

When this plan is complete, SPORE should be able to:

- accept operator or system-generated goals about SPORE itself
- produce editable goal plans with explicit dependencies and governance
- materialize those plans into managed work-item groups
- execute those groups as dependency-aware batches
- generate durable proposal artifacts and review packages
- enforce named validation bundles before promotion
- promote approved and validated work through coordinator and integrator lanes
- land autonomous results on integration branches under explicit policy
- quarantine, reroute, or repair blocked work instead of silently failing
- continuously improve itself with durable learning, doc suggestion, and validation feedback loops

## Delivery Rules

- Keep coordinator read-mostly by default.
- Keep integrator as the explicit promotion and integration lane.
- Do not treat approval as equivalent to promotion or merge.
- Do not introduce shared family worktrees as the default.
- Do not auto-merge to `main` in this plan. Autonomous landing ends at integration branches unless a later ADR changes that.
- Keep every new autonomous decision durable and inspectable.
- Prefer additive behavior over silently changing old plan/invoke paths.

## Parallel Work Rule

This plan is designed for parallel execution with subagents where write scopes do not overlap.

Recommended parallel tracks:

- Backend self-build planning and lifecycle:
  - `packages/orchestrator/src/self-build/*`
  - `services/orchestrator/server.ts`
- Promotion and execution behavior:
  - `packages/orchestrator/src/execution/*`
  - `packages/orchestrator/src/work-items/*`
- Workspace and runtime evidence:
  - `packages/workspace-manager/*`
  - `packages/runtime-pi/*`
  - `services/session-gateway/*`
- Operator surfaces:
  - `apps/web/src/*`
  - `packages/tui/*`
- Docs and schema sync:
  - `docs/*`
  - `schemas/*`
  - config docs

Do not assign overlapping write ownership to parallel workers in the same sub-slice.

## Current State Summary

### Already Done

- [x] goal plans exist and can be reviewed, materialized, and run
- [x] work-item groups exist and can run in dependency-aware batches
- [x] proposal review package exists
- [x] proposal review, approval, promotion plan, and promotion invoke exist
- [x] coordinator-root and integrator promotion lanes exist
- [x] workspace-backed mutating runs exist
- [x] self-build dashboard exists

### Still Missing

- [x] editable goal-plan recommendations before materialization
- [x] stronger batch recovery controls
- [x] reusable validation bundles as first-class gates
- [x] proposal readiness separated from approval in a stricter way
- [x] autonomous queue runner and autonomous policy enforcement
- [x] integration-branch lifecycle, rollback, and quarantine
- [x] stronger learning and doc-follow-up loops
- [x] protected-tier human override review and release flow
- [x] lifecycle dashboard coverage for blocked promotions, pending validations, active autonomous runs, quarantined work, overrides, and recommendation review queue

## Phase 1 — Editable Planning and Stronger Group Control

### 1. Editable Goal-Plan Review UI
- [x] Add goal-plan edit support before materialization.
- [x] Allow reorder of recommended items.
- [x] Allow dropping recommendations.
- [x] Allow operator rationale to be recorded per edit.
- [x] Keep original planner output immutable and preserve edited output separately.

### 2. Goal-Plan Review and Edit Persistence
- [x] Add durable plan edit history.
- [x] Add `materializationSnapshot` so group creation records exactly which edited plan was materialized.
- [x] Record reviewer identity, rationale, and review timestamp.
- [x] Expose goal-plan history through one read route.
- [x] Show lineage from goal plan to materialized group and child work items.

### 3. Goal Planner v2
- [x] Make planner project-aware by using project config, policy packs, templates, and current self-build state.
- [x] Make planner emit explicit dependencies, risk, governance, validation, and proposal expectations.
- [ ] Make planner distinguish:
  - docs/config tasks
  - operator-surface tasks
  - orchestrator/runtime tasks
  - promotion follow-up tasks
- [x] Add explicit planner blocking when the requested goal exceeds allowed autonomous scope.
- [x] Keep planner deterministic and inspectable.

### 4. Work-Item Templates v2
- [x] Expand template catalog for realistic SPORE maintenance work.
- [x] Add template defaults for:
  - mutation scope
  - proposal required
  - safe-mode eligibility
  - validation bundle
  - autonomous eligibility
  - promotion expectations
- [x] Add templates for:
  - docs maintenance
  - config/schema maintenance
  - scenario/regression maintenance
  - operator surface pass
  - coordinator/integrator surface pass
  - runtime/session pass
  - proposal review pass
  - promotion readiness pass

### 5. Work-Item Group Recovery Controls
- [x] Add explicit recovery actions:
  - unblock
  - reroute
  - retry failed downstream items
  - requeue
  - skip item
- [x] Persist all recovery actions as durable operator history.
- [x] Make blocked reasons and recovery options visible in Web, TUI, and API payloads.
- [x] Ensure downstream retries only target dependency-affected items.
- [x] Allow reroute to create repair work rather than mutating original intent silently.

### 6. Batch Lifecycle State Machine
- [x] Normalize group states:
  - `planned`
  - `ready`
  - `running`
  - `blocked`
  - `waiting_review`
  - `waiting_validation`
  - `waiting_promotion`
  - `promotion_in_progress`
  - `completed`
  - `failed`
  - `quarantined`
- [x] Persist batch history and batch-level operator decisions.
- [x] Add batch-level next-action hints.
- [x] Add batch-level validation and promotion summaries.
- [x] Make group detail the single aggregate source for items, proposals, validations, and dependency graph state.

## Phase 2 — Validation Bundles and Proposal Readiness

### 7. Validation Bundle Catalog
- [x] Add `config/validation-bundles/*.yaml`.
- [x] Define bundle fields for:
  - scenarios
  - regressions
  - required-for-review
  - required-for-promotion
  - skip rules
  - duration budget
  - mutation-scope applicability
  - template applicability
- [x] Add schema validation for bundles.
- [x] Reference bundle defaults from templates and project config.
- [x] Document canonical bundles in runbooks.

### 8. Validation Bundle Execution Surfaces
- [x] Add `validate-bundle` execution for work-item runs.
- [x] Add `validate-bundle` execution for work-item groups.
- [x] Persist execution records, evidence links, and gating outcomes.
- [x] Expose bundle status in proposal review packages.
- [x] Expose validation bundle history in self-build dashboard.

### 9. Proposal Readiness Contract
- [x] Introduce explicit proposal states:
  - `draft`
  - `ready_for_review`
  - `reviewed`
  - `approved`
  - `validation_required`
  - `validation_failed`
  - `promotion_ready`
  - `promotion_blocked`
  - `promotion_candidate`
  - `rework_required`
  - `rejected`
- [x] Ensure approval does not imply promotion readiness.
- [x] Make proposal readiness depend on named validation bundle results where required.
- [x] Preserve durable reasons for blocked readiness.
- [x] Surface readiness and blockers in proposal APIs, Web, TUI, and run-center/self-build dashboard.

### 10. Validation Drift Detection
- [x] Add proposal content fingerprinting.
- [x] Add workspace/diff fingerprinting.
- [x] Add validation fingerprinting.
- [x] If proposal content changes after validation, clear readiness and require revalidation.
- [x] Surface `validationDrift` in proposal and dashboard payloads.

### 11. Proposal Rework Workflow
- [ ] Add explicit rework transition after proposal rejection or validation failure.
- [ ] Route rework back into the appropriate work-item group or create new repair items.
- [ ] Preserve proposal lineage across rework cycles.
- [ ] Add proposal review history, approval history, and rework history to one read model.
- [ ] Expose rework actions through Web, TUI, CLI, and API.

## Phase 3 — Promotion and Integration Branch Discipline

### 12. Promotion Readiness Enforcement
- [x] Require `promotion_ready` before promotion planning.
- [x] Fail early with clear blockers when:
  - validation bundle missing
  - validation failed
  - validation drift present
  - durable source artifact missing
- [x] Keep early blocker routing additive and coordinator-targeted.
- [x] Make readiness evidence visible on both proposal and execution surfaces.
- [x] Keep backward compatibility for manual direct promotion commands by returning explicit blockers rather than silently changing behavior.

### 13. Integrator Promotion Lifecycle v2
- [x] Expand integrator lane metadata with:
  - source count
  - source branches/workspaces
  - validation outcome
  - conflict class
  - target branch
  - integration branch
  - promotion result
- [x] Distinguish:
  - `planned`
  - `blocked`
  - `ready_for_integration`
  - `integration_running`
  - `integration_failed`
  - `promotion_candidate`
  - `merged_to_integration`
  - `held_for_main`
- [x] Persist this on execution payloads and proposal payloads.
- [x] Surface it in Web/TUI lineage and self-build views.
- [x] Keep `promotion_candidate` as the default safe outcome.

### 14. Integration Branch Management
- [x] Add durable integration branch records.
- [x] Track branch owner, family, proposal set, workspace set, and health.
- [x] Add read surfaces for integration branches.
- [ ] Add stale/inconsistent branch diagnostics.
- [x] Link integration branches to promotion history, validation, and rollback/quarantine records.

### 15. Conflict Classification and Escalation
- [ ] Add conflict classes:
  - mechanical
  - semantic
  - ambiguous
- [ ] Allow mechanical resolution only when policy explicitly permits it.
- [ ] Require revalidation after any auto-resolved conflict.
- [ ] Route semantic or ambiguous conflicts to coordinator with durable blocker records.
- [ ] Generate repair work items or repair groups back through lead lanes.

### 16. Rollback and Quarantine
- [x] Add quarantine states for:
  - proposals
  - work-item groups
  - goal plans
  - integration branches
- [x] Persist rollback decisions and rollback reasons.
- [x] Add explicit unblock criteria.
- [x] Expose quarantine and rollback in self-build dashboard.
- [x] Prevent autonomous loop from retrying quarantined work until explicit release.

## Phase 4 — Autonomous Execution Loop

### 17. Autonomous Policy Packs
- [x] Extend project/policy-pack config with autonomous execution policy:
  - allowed mutation scopes
  - allowed templates
  - allowed domains
  - required validations
  - auto-review thresholds
  - auto-promotion thresholds
  - quarantine thresholds
  - rollback thresholds
  - allowed landing policy
- [x] Keep default SPORE target at:
  - auto-execute
  - auto-validate
  - auto-promote to integration branch
  - no direct merge to `main`

### 18. Autonomous Eligibility Evaluation
- [x] Add one deterministic autonomous eligibility evaluator.
- [x] Evaluate eligibility for:
  - goals
  - plans
  - groups
  - proposals
  - promotions
- [x] Persist the decision, evidence, and policy pack used.
- [x] Surface blocked reasons when automation is refused.
- [x] Reuse the same evaluator in planner, dashboard, and loop runner.

### 19. Self-Build Queue Runner
- [x] Add a long-running queue runner for self-build.
- [x] It must:
  - pick next eligible work
  - respect dependencies
  - stop on operator-required blockers
  - avoid duplicate active work
  - allocate workspaces
  - launch runs
  - monitor validation and promotion states
- [x] Add start/stop/status commands and HTTP routes.
- [x] Record every autonomous action durably.
- [x] Make queue runner status visible in self-build dashboard.

### 20. Autonomous Goal Intake
- [x] Introduce durable sources of self-work demand:
  - operator-created goals
  - regression-failure goals
  - doc suggestion goals
  - learning-driven maintenance goals
  - stale workspace cleanup goals
  - stale integration branch goals
- [ ] Add prioritization policy.
- [x] Make autonomous queue intake deterministic.
- [x] Keep operator override paths available.
- [x] Expose intake sources in dashboard and read APIs.

### 21. Auto-Review, Auto-Materialize, Auto-Run
- [x] Allow auto-review and auto-materialization only when policy permits.
- [x] Allow auto-run only when dependencies and governance are satisfied.
- [x] Persist why the system was allowed to progress autonomously.
- [x] Stop at the first forbidden stage rather than silently continuing.
- [ ] Distinguish supervised and autonomous transitions in history payloads.

### 22. Auto-Validation and Auto-Promotion to Integration
- [x] After successful autonomous work and validation, allow promotion planning/invocation automatically when policy permits.
- [x] Keep all autonomous promotion landings scoped to integration branches.
- [x] Require durable promotion evidence before land.
- [x] Route blocked promotions to coordinator and then repair work.
- [x] Keep no silent direct `main` landing in this plan.

## Phase 5 — Whole-Repo Expansion and Safety Tiers

### 23. Whole-Repo Autonomy Rollout Tiers
- [x] Stage repo-wide autonomy through explicit tiers:
  1. docs/config/scenarios/regressions
  2. operator surfaces and read models
  3. proposal/promotion infrastructure
  4. orchestrator read models and non-core services
  5. orchestrator execution internals
  6. runtime/session core
- [x] Each tier needs:
  - validation bundle
  - quarantine threshold
  - rollback rule
  - human-gated override path
- [x] No tier may advance without explicit config change.

### 24. Protected Scope Guardrails
- [x] Add path/domain-based stricter rules for:
  - runtime core
  - session control
  - orchestrator execution core
  - promotion and merge logic
- [x] Enforce stronger review or human approval in protected scopes.
- [x] Surface these guardrails in planner output and proposal detail.
- [x] Fail early when a goal crosses into a disallowed scope for the current autonomous mode.

### 25. Self-Build Scenarios and Regression Profiles
- [x] Add canonical self-build scenarios:
  - goal-plan review flow
  - dependency batch flow
  - proposal review/rework flow
  - validation gating flow
  - promotion-to-integration flow
  - quarantine and recovery flow
  - protected-scope blocked autonomy flow
- [x] Add regression profiles that continuously exercise the self-build loop.
- [x] Reuse them in validation bundles and autonomous eligibility.

## Phase 6 — Learning, Documentation, and Continuous Improvement

### 26. Learning Records v2
- [x] Improve learning records to capture:
  - failure pattern
  - validation lesson
  - review lesson
  - promotion blocker pattern
  - workspace/integration branch lesson
- [x] Link learnings to goals, groups, proposals, validations, and promotions.
- [x] Use repeated learnings to downgrade autonomous eligibility automatically.
- [x] Expose learning trends in self-build dashboard.

### 27. Documentation Suggestion Pipeline v2
- [x] Turn doc suggestions into a first-class queue.
- [ ] Distinguish:
  - README updates
  - runbook updates
  - ADR candidates
  - docs index updates
- [x] Allow accepted doc suggestions to become work items automatically.
- [x] Surface doc suggestion acceptance/dismissal state.
- [x] Link doc suggestions to self-build outcomes.

### 28. Policy Recommendation Loop
- [x] Generate policy-pack suggestions from repeated self-build outcomes.
- [x] Keep suggestions reviewable, not auto-applied at first.
- [x] Surface repeated autonomous blockers as policy tuning candidates.
- [x] Connect policy recommendations to learning records and regression outcomes.
- [x] Add a review queue for policy changes.

### 29. Full Self-Build Lifecycle Dashboard
- [x] Expand `/self-build/dashboard` into the final lifecycle surface:
  - goals awaiting review
  - edited plans awaiting materialization
  - active and blocked groups
  - pending and drifted validations
  - proposals pending review
  - proposals approved but not promotion-ready
  - proposals blocked for promotion
  - active integrator lanes
  - integration branch candidates
  - quarantined work
  - autonomous loop status
  - top blockers and suggested operator actions
- [x] Keep TUI parity for the same lifecycle states.

### 30. Self-Build Milestone Exit Criteria
- [ ] Define one milestone scenario for “SPORE works on SPORE”:
  - takes a real goal
  - plans work
  - edits/reviews plan
  - materializes group
  - runs dependency-aware work
  - generates proposal
  - validates
  - promotes to integration branch
  - records learnings and doc suggestions
  - stops cleanly with audit trail
- [ ] Treat this as the final acceptance scenario for the implementation plan.

## Verification Matrix

For each major slice, run at minimum:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run docs-kb:index
npm run config:validate
npm run test:workspace
npm run test:policy
npm run test:http
npm run test:tui
npm run test:web
```

For slices touching runtime, promotion, or autonomous loop, also run:

```bash
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

Add dedicated tests for:

- goal-plan edit persistence
- materialization from edited plans
- dependency recovery controls
- validation bundle gating
- proposal drift invalidation
- promotion readiness blockers
- integrator promotion to integration branch
- quarantine and rollback
- autonomous eligibility decisions
- autonomous loop stop/start/status

## Recommended Execution Order

Execute in this order:

1. editable planning and review
2. stronger batch control and recovery
3. validation bundle catalog and execution
4. proposal readiness and drift
5. richer proposal and promotion discipline
6. autonomous policy and queue runner
7. integration branch, rollback, and quarantine
8. whole-repo guarded rollout
9. learning, docs suggestions, and policy loop
10. final lifecycle dashboard and milestone scenario

## Final Note

This is the full self-build plan, not a speculative wishlist. It is designed to be implemented incrementally, but the end state is explicit:

- SPORE can work on SPORE,
- autonomously where policy allows,
- safely routed through coordinator and integrator lanes,
- validated before promotion,
- landed to integration branches under durable evidence,
- and stopped by quarantine or governance when safety conditions fail.
