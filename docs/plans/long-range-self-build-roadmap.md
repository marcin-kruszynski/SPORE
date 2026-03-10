# Long-Range Self-Build Roadmap

## Purpose

This document is the current long-range implementation roadmap for turning SPORE from an executable orchestration foundation into a supervised self-building agent swarm.

It has two jobs:

1. summarize what the existing `docs/plans/` artifacts already cover and what they no longer cover well,
2. define one durable, trackable backlog of the next major implementation steps.

Use this file as the main planning surface for ongoing implementation work after the bootstrap phase.

## How to Use This Roadmap

- Treat this file as the active long-range plan.
- Use `docs/plans/full-self-build-implementation-plan.md` as the execution-facing implementation sequence for the next self-build buildout.
- Mark completed items by changing `[ ]` to `[x]`.
- Do not silently remove scope; if a step becomes obsolete, mark it as `[x]` with a short note or replace it with a better-scoped successor.
- When a step lands, update both this roadmap and the relevant architecture/runbook docs in the same implementation wave.
- Keep `docs/plans/self-build-status-and-next-steps.md` as the current-state snapshot and use this document as the deeper execution roadmap.

## Audit of Existing `docs/plans/`

### `docs/plans/backlog.md`

Status: largely outdated.

What is done:
- docs-kb minimal index and search CLI
- first stable session and event schemas
- config loader/validator from `config/` and `schemas/`

What is still partially relevant:
- docs index consistency checking remains worth hardening further
- quality scorecards for workflow health still matter, but the right place is now the operator dashboard and regression reporting layer

Conclusion:
- keep as historical bootstrap backlog only
- do not use it as the primary future roadmap

### `docs/plans/bootstrap-completion-summary.md`

Status: completed and still useful as a milestone record.

What is done:
- repository scaffold
- docs/config/package/tooling foundation
- scenario/regression foundation
- session/orchestrator/gateway foundation
- initial browser/TUI/operator surfaces

What is not meant to do anymore:
- guide current implementation sequencing

Conclusion:
- keep as historical completion record
- do not use as an active backlog

### `docs/plans/environment-phases.md`

Status: completed at the bootstrap-foundation level.

What is done:
- repository skeleton
- architecture and research baseline
- configuration foundation
- knowledge/document search foundation
- runtime/session/client planning
- readiness and handoff baseline

What remains:
- the document is too coarse for the current stage

Conclusion:
- still valid historically
- superseded by self-build-specific execution planning

### `docs/plans/implementation-waves.md`

Status: still conceptually valid but too abstract.

What is done:
- wave-based delivery style has been used successfully

What is missing:
- concrete long-range sequencing for self-build, workspace isolation, proposal governance, validation bundles, and self-improvement loops

Conclusion:
- keep as a delivery pattern note
- not sufficient as the main roadmap

### `docs/plans/roadmap.md`

Status: partially outdated.

What is done:
- bootstrap-first phases are complete enough to move beyond planning-only language
- durable orchestrator, session, gateway, run-center, and self-build primitives already exist

What is still useful:
- reminder that SPORE should continue evolving incrementally and not jump to an unsafe full-autonomy model

Conclusion:
- still directionally useful
- no longer specific enough for current implementation work

### `docs/plans/self-build-status-and-next-steps.md`

Status: current and still useful.

What it does well:
- summarizes current capabilities
- explains what supervised self-work means today
- captures the immediate next wave

What it does not do yet:
- provide a deep, long-range, 30-step roadmap with explicit sequencing to reach a meaningful self-building milestone

Conclusion:
- keep as the tactical status snapshot
- pair it with this document for long-range execution planning

## Current Delivery Baseline

The following are already implemented enough to count as foundation, not future scope:

- docs-first repository operating model
- docs index and docs-kb indexing/search
- configuration validation and policy packs
- PI-first runtime planning plus real `pi-rpc` validation path
- tmux-backed live sessions with session manager and session gateway
- durable execution store with waves, branches, trees, review, approval, hold, pause, and escalation states
- scenario and regression catalogs with durable run history, trends, reruns, and reports
- browser Run Center and session/execution operator surfaces
- TUI/CLI parity for major operator flows
- managed self-work via work items, goal plans, work-item groups, proposal artifacts, validation, learning records, and doc suggestions
- first worktree/workspace isolation slice for mutating self-work runs

## Gaps That Still Matter Most

The biggest remaining gaps before SPORE can safely and usefully work on itself are:

- validation is still too manual at the work-item level
- goal planning is rule-based but still shallow and not project-aware enough
- dependency-aware execution exists in one line of work and must be generalized carefully
- learning extraction is present but not yet central to operator decisions
- no durable merge/integration discipline exists for worktree-backed self-work
- no supervised end-to-end self-build loop exists that the operator can run repeatedly as a first-class product workflow

## Long-Range Roadmap

## Phase 1 — Productize Self-Build Operator Surfaces

### 1. Dedicated Self-Build Dashboard
- [x] Build a dedicated browser surface for self-build instead of relying on `Run Center` as the only home.
- [x] Show active groups, blocked items, pending reviews, pending approvals, pending validations, recent learnings, and recent doc suggestions.
- [x] Add one aggregate read route such as `GET /self-build/dashboard` so the client does not reconstruct the entire surface from many separate requests.
- [x] Add operator filters by status, group, template, and domain.
- [x] Add direct links from dashboard cards to work-item runs, proposals, validations, and workspaces.

### 2. Work Item Run History as a First-Class UX Surface
- [x] Add a browser view for one work item and all its runs, not only the latest run.
- [x] Add run-to-run comparison helpers for status, proposal linkage, validation linkage, and doc suggestions.
- [x] Add status trend summaries per work item.
- [x] Add retry/rerun affordances from the work-item history view.
- [x] Add direct links from work-item history into scenario runs, regression runs, and execution history.

### 3. Self-Build Queue Model
- [x] Introduce a durable queue/read model for pending, running, blocked, review-pending, and validation-pending self-work.
- [x] Add queue ordering and queue grouping by work-item group and goal plan.
- [x] Add queue filters for safe mode, mutation scope, and proposal-required work.
- [x] Add queue-level operator summary cards for items that need intervention now.
- [x] Expose queue metrics in the self-build dashboard and TUI.

### 4. TUI Self-Build Console
- [x] Expand the TUI so terminal operators can inspect the self-build queue, current work-item groups, and proposal backlog.
- [x] Add `self-build dashboard`, `work-item queue`, and `workspace` views to TUI parity.
- [x] Keep TUI read-first and backed only by HTTP surfaces.
- [x] Add JSON output for all new TUI self-build commands.
- [x] Ensure one terminal-only operator loop is possible without opening the browser.

### 5. Operator Notifications and Attention States
- [x] Introduce clearer attention states such as `needs-review`, `needs-approval`, `needs-validation`, `workspace-problem`, `planner-follow-up`.
- [x] Make those states visible in dashboard, TUI, and API payloads.
- [x] Add priority ordering for operator attention.
- [x] Add machine-readable `attentionSummary` blocks to self-build aggregate routes.
- [x] Make alert generation deterministic and tied to persisted state, not client heuristics.

## Phase 2 — Generalize Workspace Isolation and Mutation Discipline

### 6. Workspace Diagnostics and Reconcile
- [x] Build durable diagnostics for `workspace_allocations` such as `missing`, `orphaned`, `dirty`, `clean`, `failed`, `settled`, and `cleaned`.
- [x] Add `workspace reconcile` semantics that compare DB state with `git worktree list` and on-disk reality.
- [x] Expose diagnostics in `GET /workspaces/:id` and a future aggregate `workspace health` view.
- [x] Add operator suggestions for cleanup, recovery, or inspection.
- [x] Add automated tests for orphan detection and stale workspace detection.

### 7. Workspace Cleanup Policy
- [x] Define cleanup policy by proposal state and governance state.
- [x] Do not remove a worktree automatically while proposal review or approval is still pending.
- [x] Add explicit cleanup commands for reviewed, rejected, and settled workspaces.
- [x] Add retention rules for workspace-backed artifacts versus workspace directories themselves.
- [x] Make cleanup decisions auditable in the proposal or workspace record.

### 8. Proposal Artifacts Backed by Real Workspace Diffs
- [x] Enrich proposal artifacts with a normalized diff summary.
- [x] Add changed-file summaries grouped by mutation scope.
- [x] Add optional patch artifact previews and file-level summaries.
- [x] Link proposal artifacts to concrete workspace status and branch metadata.
- [x] Add proposal rendering that stays review-friendly even when a workspace includes many changed files.

### 9. Runtime Launch in Workspace `cwd` for Mutating Workflow Steps
- [x] Propagate workspace metadata from mutating self-work runs into runtime launch context.
- [x] Add `cwd` support to the runtime launch path so mutating sessions start inside the provisioned worktree.
- [x] Limit this first to controlled self-work paths before rolling it into all workflow execution.
- [x] Record runtime `cwd` and workspace linkage in session artifacts and session live inspection.
- [x] Add one integration test proving that a mutating runtime session actually runs in the worktree, not the canonical root.

### 10. Per-Step Workspace Allocation for General Workflow Execution
- [x] Extend worktree allocation beyond self-build work-item runs into mutating workflow steps.
- [x] Keep the default rule strict: not every step gets a worktree; only mutating builder-like steps do.
- [x] Persist linkage between execution step, session, workspace, and proposal where relevant.
- [x] Expose execution-to-workspace reads such as `GET /executions/:id/workspaces`.
- [x] Keep reviewer/scout/orchestrator roles read-only by default unless policy explicitly says otherwise.

## Phase 3 — Improve Planning From Goals to Structured Work

### 11. Goal Planner v2
- [ ] Make goal planning more project-aware and domain-aware.
- [ ] Use project defaults, policy packs, and template catalog data when generating recommendations.
- [ ] Improve mapping from user goal language to domain, work kind, and validation bundle.
- [ ] Make planner output more explicit about risk, governance level, and expected validation.
- [ ] Keep the planner deterministic and inspectable before introducing any model-assisted variant.

### 12. Goal Plan Review and Materialization Flow
- [x] Add a stronger review stage for goal plans before materialization.
- [x] Allow operators to edit, reorder, or drop recommended work items before materializing them.
- [x] Persist plan edits and rationale.
- [x] Record who approved plan materialization.
- [x] Ensure goal plan lineage into work-item groups remains durable and queryable.

### 13. Work Item Templates v2
- [ ] Expand the template catalog with realistic SPORE-specific work items.
- [ ] Add templates for docs maintenance, config/schema hardening, operator UI passes, runtime validation, workspace cleanup, and proposal review passes.
- [ ] Add template-level validation defaults and proposal expectations.
- [ ] Add template-level safe-mode eligibility and mutation scope defaults.
- [ ] Add template-level owner guidance in docs and API payloads.

### 14. Work Item Groups as Real Execution Batches
- [x] Generalize grouped work into a true batch execution concept, not just a loose container.
- [x] Add batch-level summary, batch state transitions, and batch-level validation outcomes.
- [x] Track partial success, blocked progress, and terminal failure cleanly.
- [x] Persist batch execution history and operator decisions.
- [x] Expose one route for complete group detail with items, dependencies, runs, proposals, and validations.

### 15. Dependency-Aware Self-Work Execution
- [x] Integrate dependency-aware group execution deeply into self-build rather than leaving it as a side slice.
- [x] Support hard and advisory dependencies consistently in self-build queues and dashboards.
- [x] Show blocked reasons clearly and persist recovery actions.
- [x] Add explicit operator recovery controls for blocked groups and blocked downstream work.
- [ ] Add operator controls for unblocking or rerouting downstream items after failures.
- [x] Ensure validation and proposal generation respect dependency state.

## Phase 4 — Strengthen Proposal, Review, and Validation Semantics

### 16. Proposal Review Workflow v2
- [x] Turn proposal review into a richer workflow with explicit reviewer notes and rejection reasons.
- [x] Record proposal review outcomes as durable structured records, not only status flips.
- [ ] Add clear rework states after proposal rejection.
- [x] Link proposal review outcomes back to the originating work item and validation outcomes.
- [x] Add browser/TUI views for proposal review history.

### 17. Validation Bundles for Work Items
- [ ] Introduce named validation bundles that a work-item template or project can attach by default.
- [ ] Let one work-item run execute a reusable validation recipe instead of hand-selecting scenarios or regressions.
- [ ] Persist validation bundle definition and execution result together.
- [ ] Add bundle-level pass/fail summaries and linked evidence.
- [ ] Add bundle reuse across multiple templates and projects.

### 18. Safer Proposal-to-Validation Linkage
- [ ] Ensure every proposal knows which validations were recommended, triggered, passed, failed, or skipped.
- [ ] Make proposal readiness depend on explicit validation policy when required.
- [ ] Add validation drift warnings when proposal metadata and validation outcomes no longer match.
- [x] Expose proposal + validation lineage in one response.
- [ ] Add tests for proposal validation gating semantics.

### 19. Review/Approval Guardrails for Self-Mutation
- [ ] Make self-work proposal governance stricter for runtime-core, orchestrator-core, and session-control areas.
- [ ] Add path-based or domain-based escalation rules for high-risk changes.
- [ ] Add mandatory human approval for certain mutation scopes.
- [ ] Surface those rules in planner output, template metadata, and proposal detail.
- [ ] Verify that safe mode prevents silent overreach into protected areas.

### 20. Validation Before Promotion
- [x] Add a durable `promotion candidate` state after proposal approval but before any integration or merge action.
- [ ] Require approved proposals to pass named validations before they can be considered ready for integration.
- [x] Record promotion blockers explicitly.
- [ ] Add one read model for “approved but not promotion-ready” work.
- [x] Keep this stage supervised; no automatic integration yet.

## Phase 5 — Add Reflection, Learning, and Knowledge Maintenance

### 21. Learning Records v2
- [ ] Improve learning record extraction with stronger structure.
- [ ] Distinguish between failure patterns, validation lessons, review lessons, and process lessons.
- [ ] Add links from learning records to work items, proposals, validations, and workspaces.
- [ ] Add operator filters for repeated learning patterns.
- [ ] Make learnings visible from both run history and self-build dashboard.

### 22. Documentation Suggestion Pipeline v2
- [ ] Turn doc suggestions into a first-class review queue.
- [ ] Distinguish README changes, runbook updates, ADR candidates, and docs index updates.
- [ ] Add acceptance and dismissal states for doc suggestions.
- [ ] Track which doc suggestions were accepted, applied, or ignored.
- [ ] Add one operator view that collects doc suggestions across work-item runs.

### 23. Knowledge Update Workflows
- [ ] Create named workflows for turning learnings and doc suggestions into managed work.
- [ ] Support “docs-only follow-up” and “policy-pack follow-up” as explicit work-item templates.
- [ ] Connect the output of failed or successful runs to those workflows automatically as suggestions.
- [ ] Prevent knowledge drift by surfacing stale docs after major behavior changes.
- [ ] Keep architecture docs and runbooks aligned with landed features.

### 24. Better Failure Classification and Repeated-Pattern Analysis
- [ ] Expand failure classification beyond the current operator triage layer.
- [ ] Classify failures by planner, workspace, runtime, governance, validation, artifact, or operator factors.
- [ ] Detect repeated patterns across multiple work-item runs and regression runs.
- [ ] Link repeated patterns to learning records and recovery suggestions.
- [ ] Make those patterns visible in the operator dashboard and run center.

### 25. Recovery Suggestions v2
- [ ] Turn recovery suggestions into richer, more contextual operator guidance.
- [ ] Include preconditions, likely consequences, and linked commands/routes for each recommendation.
- [ ] Add recovery suggestions for workspace failures, proposal governance deadlocks, validation drift, and blocked dependency groups.
- [ ] Keep suggestions deterministic and state-derived.
- [ ] Add tests proving that suggestions are stable for known failure classes.

## Phase 6 — Reach a Reusable Supervised Self-Build Loop

### 26. Self-Build Dashboard as the Main Operator Surface
- [ ] Promote the dedicated self-build dashboard to the main operator surface for SPORE working on SPORE.
- [ ] Add a full operator lifecycle view: goal plans, groups, queued items, active runs, proposals, validations, docs suggestions, learnings, and workspace health.
- [ ] Add drilldowns into the exact route or artifact that backs each panel.
- [ ] Keep the dashboard thin over backend aggregate routes.
- [ ] Make sure one operator can run the whole supervised loop from that screen.

### 27. Supervised Self-Build Flow v1
- [ ] Implement one explicit supervised loop: `goal -> plan -> materialize -> execute -> propose -> validate -> review -> stop`.
- [ ] Make the state transitions durable and queryable at every stage.
- [ ] Add one “run the loop” operator entrypoint that still stops at governance gates.
- [ ] Require safe mode by default for the first production-shaped loop.
- [ ] Ensure the loop can be repeated with durable history and reruns.

### 28. Safe-Mode Self-Improvement Milestone
- [ ] Reach a milestone where SPORE can repeatedly improve docs, configs, runbooks, scenario definitions, and selected operator surfaces in safe mode.
- [ ] Prove that the loop leaves durable proposals, validations, and learnings.
- [ ] Add one milestone report in docs when this state is reached.
- [ ] Keep runtime-core mutation out of default self-build scope at this stage.
- [ ] Use this milestone as the gateway before deeper self-mutation ambitions.

### 29. Integration Discipline for Approved Changes
- [ ] Design the next boundary after proposal approval: integration branch, promotion workflow, or human-applied patch flow.
- [ ] Keep this explicit and supervised.
- [ ] Do not jump straight to auto-merge.
- [ ] Define which changes can be promoted from safe mode and under what validations.
- [ ] Add architecture documentation before implementing promotion behavior.

### 30. Self-Build Readiness Review
- [ ] Add a durable readiness checklist for “SPORE can work on SPORE safely”.
- [ ] Cover workspace isolation, proposal quality, validation discipline, recovery handling, doc maintenance, and operator control.
- [ ] Make the checklist machine-readable where practical.
- [ ] Revisit unresolved architectural risks before expanding autonomy.
- [ ] Use this review as the gate before any attempt at broader autonomous behavior.

## Cross-Cutting Risks That Need Ongoing Attention

- workspace isolation without strong cleanup discipline will create operator debt quickly
- proposal artifacts are only useful if they stay normalized and review-friendly
- goal planning must remain inspectable; opaque planner behavior will destroy operator trust
- validation must stay durable and linked to proposals, not scattered in shell history
- self-build must remain supervised by default until promotion and mutation boundaries are much stronger
- docs and architecture notes must continue to track real behavior, not aspirational design only

## Recommended Working Rule

For the next wave of implementation, prioritize in this order:

1. dedicated self-build dashboard
2. workspace diagnostics and cleanup semantics
3. richer proposal artifacts and proposal review workflow
4. validation bundles
5. planner and grouped dependency-aware self-work
6. end-to-end supervised self-build flow

That order gives the highest chance of reaching a useful, safe self-build loop without losing operator clarity.
