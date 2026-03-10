# Self-Build Status and Next Steps

## Purpose

This document is the current operator-facing snapshot of where SPORE stands after the executable-foundation phase and what should happen next.

Use it when you need one place that answers all of the following:
- what is already implemented,
- what the next 16 implementation steps are,
- what still blocks SPORE from supervised self-building,
- what requires extra care, verification, or architectural cleanup.

This file is intentionally more tactical than `docs/roadmap/IMPLEMENTATION_ROADMAP.md` and more current-state-oriented than `docs/plans/bootstrap-completion-summary.md`.

## Current Snapshot

SPORE already has a meaningful executable foundation.

### What Exists Now

- documentation-first repository structure with canonical indexes and ADR discipline
- PI-first runtime planning and real `pi-rpc` validation path
- tmux-backed inspectable live sessions
- session manager with lifecycle state, reconciliation, control history, and live inspection
- session gateway with HTTP reads, artifact reads, SSE, and write-side session control
- orchestrator service with durable execution state, workflow history, lineage, tree actions, governance actions, and branch spawning
- scenario and regression catalogs with durable run history, reruns, trends, and reports
- browser operator surface with run-center summaries, execution history, session live inspection, and self-build data in the run center
- CLI/TUI parity for the main operator surfaces
- durable managed `work-items` for supervised self-work
- durable `goal plans`, `work-item groups`, `proposal artifacts`, and `learning records`
- work-item templates and self-build policy packs
- first SPORE project profile for self-work defaults
- first `workspace-manager` slice with durable `workspace_allocations` for mutating self-work

### What Is Newly in Place for Self-Build

- `work-item templates` for repeatable self-work bootstraps
- `goal plans` for rule-based planning from an operator goal
- `work-item groups` for multi-item rollout
- `proposal artifacts` for code-oriented self-work outputs
- `git worktree` provisioning for mutating self-work through `packages/workspace-manager/`
- workspace linkage from work-item runs and proposal artifacts to a concrete worktree path and branch
- `work-item run validation` and `doc suggestions`
- `self-build summary` and `self-build dashboard` as aggregate read surfaces
- `work-item run history` with trend, comparison, and rerun affordances
- durable `attentionSummary`, queue ordering, and planner follow-up items for self-work
- Web run-center visibility into managed work items, work-item runs, proposal artifacts, and workspace health
- TUI parity for `self-build-dashboard`, `work-item-queue`, `workspace-list`, `workspace-show`, and `work-item-run-rerun`

## What This Means Practically

SPORE can now represent and execute supervised self-work in a structured way, and it now has a dedicated self-build dashboard for operator triage instead of relying only on generic run-center views.

The current supervised self-work shape is:

1. an operator defines a goal or creates a work item
2. SPORE can materialize managed work items and groups
3. a work-item run can execute through scenario, regression, or workflow paths
4. mutating code-oriented runs can provision a dedicated git worktree
5. code-oriented runs can produce proposal artifacts
6. validation can be attached to the run
7. documentation suggestions and learning records can be captured
8. the process still stops at explicit governance and operator review points

That is not full autonomy. It is a controlled self-improvement loop with durable traceability.

## TypeScript Adaptation Checkpoint

The final large post-migration TypeScript adaptation batch is complete.

That means:
- orchestrator execution, store, and self-build responsibilities now have explicit module boundaries
- heavy HTTP/TUI suites have stable teardown behavior again
- the repository is no longer blocked on old-code TypeScript cleanup before new feature work

The next implementation work should focus on new SPORE capabilities rather than more migration catch-up.

## Phase 1 Status

Phase 1 from the long-range self-build roadmap is complete.

Delivered in that phase:

- dedicated `GET /self-build/dashboard` aggregate route
- browser self-build dashboard with filters for status, group, template, and domain
- first-class work-item run history with trend and comparison summaries
- durable self-build queue and attention-state model
- TUI parity for dashboard, queue, workspace inspection, and run rerun flows
- deterministic operator alerts and recommendations sourced from persisted state

The next implementation work should therefore move to phase 3 concerns: stronger planning, richer grouped execution, and tighter proposal/validation governance.

## Phase 2 Status

Phase 2 from the long-range self-build roadmap is now complete.

Delivered in that phase:

- durable workspace diagnostics, reconcile, and governance-aware cleanup
- retention guidance for workspace-backed artifacts versus disposable workspace directories
- richer proposal artifacts backed by real workspace diffs, changed-file grouping, and patch previews
- runtime launch with `cwd` set to the provisioned workspace for controlled mutating self-work
- durable runtime launch-context artifact proving actual launch `cwd`
- session live visibility for workspace linkage, runtime `cwd`, and launch-context metadata
- first slice of per-step workspace allocation for mutating workflow execution
- execution-level workspace reads through `GET /executions/:id/workspaces`
- automated tests that prove stub-backed runtime launch writes artifacts from the provisioned workspace context

Remaining gaps now start in phase 3 and beyond:

- planner quality is still deterministic but shallow
- validation bundles are still narrower than they need to be
- proposal governance needs richer review/rework semantics
- dependency-aware self-build execution needs to be generalized beyond the current slice
- there is still no supervised end-to-end self-build loop that an operator can run as one product workflow

## The Next 16 Steps

The next implementation wave should move in this order.

### 1. Generalize Workspace Diagnostics and Reconcile

Extend the first worktree slice into a durable health and recovery surface.

Target outcomes:
- `missing`, `orphaned`, `dirty`, `failed`, `settled`, and `cleaned` workspace diagnostics
- reconcile semantics that compare DB state, `git worktree list`, and filesystem reality
- operator suggestions for cleanup, recovery, or inspection

Why now:
- mutating self-work already provisions worktrees; diagnostics must catch up before volume increases

Status:
- completed for durable diagnostics, live workspace detail, and explicit reconcile commands
- still missing execution-level aggregate workspace views and stronger dashboard surfacing

### 2. Add Workspace Cleanup Policy

Make cleanup policy explicit and governance-aware.

Target outcomes:
- do not remove reviewed or approval-pending worktrees too early
- explicit cleanup commands and retention rules
- auditable cleanup decisions

Why now:
- proposal-backed workspaces are now durable operator artifacts, not disposable temp dirs

Status:
- completed, including retention guidance that distinguishes workspace directories from retained proposal artifacts

### 3. Strengthen Proposal Artifact Semantics

Proposal artifacts need to become a stronger review package for code-oriented self-work.

Target outcomes:
- richer diff summaries
- changed-file grouping by mutation scope
- stronger links to workspace status, tests, and validation evidence

Why now:
- proposals exist, but they are still too thin for sustained self-build review

Status:
- completed for normalized diff summaries, mutation-scope file grouping, patch previews, and richer workspace linkage

### 4. Runtime Launch in Workspace `cwd`

Mutating runs should execute in the provisioned worktree, not only be linked to it logically.

Target outcomes:
- runtime launch with `cwd` set to the worktree
- workspace metadata visible in session artifacts and session live
- integration proof that mutating runtime sessions do not run from the canonical root

Why now:
- without this, filesystem isolation is incomplete

Status:
- completed for workspace-backed self-work launches, durable launch-context artifacts, and integration assertions that capture actual launch `cwd`

### 5. Per-Step Workspace Allocation for General Workflow Execution

Extend workspace allocation beyond self-build work-item runs.

Target outcomes:
- mutating builder-like workflow steps can get their own worktree
- execution-to-workspace linkage is queryable
- reviewer/scout/orchestrator stay read-only by default

Why now:
- self-build should not be the only place that benefits from filesystem isolation

Status:
- completed for the first production-shaped slice: mutating workflow steps can provision or reuse a workspace through `runtimePolicy.workspace`, execution-level workspace reads now exist, and non-mutating roles remain read-only unless explicitly opted in

### 6. Add Work-Item Dependency-Aware Group Execution

Make `work-item groups` respect explicit dependencies instead of treating grouped work as only a flat collection.

Target outcomes:
- `dependsOn[]` support
- blocked downstream items when prerequisites fail or are not complete
- group-level state derived from child item dependency state

Why now:
- self-work will become noisy and unsafe without ordering semantics

### 7. Build a Full Goal -> Plan -> Materialize -> Run -> Validate -> Review Flow

Turn the current separate self-build endpoints into one operator-recognizable lifecycle.

Target outcomes:
- one coherent operator flow
- clear handoff points
- durable linkage between goal plan, group, work-item runs, proposals, and validations

Why now:
- the pieces exist, but the end-to-end path is still spread across separate commands and screens

### 8. Add Proposal-Centric Review Workflows

Treat proposal review as a dedicated workflow stage rather than a thin state transition.

Target outcomes:
- proposal review notes
- proposal rejection reasons
- clear retry/rework semantics after proposal rejection

Why now:
- self-building without a strong review loop becomes indistinguishable from unsafe automation

### 9. Add Validation Bundles for Work-Item Runs

A work-item run should carry a named validation bundle instead of only ad hoc validation attachments.

Target outcomes:
- reusable validation defaults per template and per project
- linked scenario and regression profiles
- durable validation status and evidence

Why now:
- validation exists, but it is still one level too manual for repeatable self-build loops

### 10. Add Safe-Mode Enforcement as a First-Class Runtime Rule

The default early self-build path should remain constrained.

Target outcomes:
- strict enforcement for docs/config/operator-surface-safe work
- explicit mutation scope checks
- no silent drift into runtime-core mutation paths

Why now:
- the repository is close to running self-work regularly; guardrails need to harden before that becomes routine

### 11. Expand the SPORE Project Profile for Self-Work Defaults

Treat SPORE itself as the first serious managed project profile.

Target outcomes:
- project-level defaults for self-work templates
- validation defaults
- governance defaults
- safe-mode defaults

Why now:
- SPORE should become the canonical reference project for its own orchestration model

### 12. Add Work-Item Templates for More Real SPORE Tasks

Broaden the current small template catalog.

Target outcomes:
- docs maintenance templates
- config/schema maintenance templates
- operator surface templates
- runtime validation templates
- review-only templates

Why now:
- a richer template library reduces operator friction and supports future planner quality

### 13. Add Goal-Planning Rules That Use Project and Domain Context Better

The goal planner should become less generic and more project-aware.

Target outcomes:
- stronger mapping from goal language to domains
- better template selection
- better recommended validation and governance level

Why now:
- current planner is intentionally simple; it is good enough for bootstrap, not good enough for broader self-work

### 14. Add Better Learning Record Surfacing

Learning records exist, but they are not yet central to operator decisions.

Target outcomes:
- learning summary cards
- links from failed runs to learning extraction
- policy or documentation follow-up suggestions based on repeated patterns

Why now:
- self-building without durable reflection leaves too much value trapped in logs and run history

### 15. Add Auto-Documentation Suggestion Review Surfaces

Doc suggestions should become a visible review queue, not only attached metadata.

Target outcomes:
- list of suggested README/runbook/ADR/index updates
- reviewable suggestion payloads
- linkage back to the work-item run that generated them

Why now:
- documentation drift will become a real risk as self-work volume grows

### 16. Add Supervised Self-Build Scenarios

Create canonical named scenarios specifically for SPORE working on SPORE.

Target outcomes:
- docs/config-only self-build scenario
- operator-surface self-build scenario
- validation-harness maintenance scenario
- proposal-and-review self-build scenario

Why now:
- named scenarios are the backbone of repeatable validation in the rest of the system and should become the backbone here too


## Broader View: What Still Needs to Be Implemented

The next 16 steps above are the immediate self-build track. The broader missing surface is larger.

### A. Self-Build Product Surface Is Still Incomplete

What is missing:
- first-class queue management and batch execution visibility beyond the new dashboard
- first-class proposal review screens
- first-class doc-suggestion review screens
- first-class learning review screens

Impact:
- backend capabilities are starting to outpace the operator surface

### B. Dependency and Scheduling Semantics Are Still Early

What is missing:
- real dependency-aware work-item group execution
- queue ordering policies
- work-item retry/rework semantics at group level
- integration between self-build work and scheduled regression execution

Impact:
- SPORE can represent self-work, but not yet coordinate larger self-improvement campaigns cleanly

### C. Proposal Governance Needs More Depth

What is missing:
- richer proposal review lifecycle
- proposal rejection handling and rework loop
- stronger linkage between proposal review and validation outcome
- clearer operator contract for when a proposal is considered complete

Impact:
- code-oriented self-work can produce proposals, but the review contract is not mature enough yet to support high-volume self-work

### D. Planner Quality Is Not Yet Strong Enough

What is missing:
- stronger project-aware goal planning
- stronger domain-aware template selection
- better validation bundle recommendations
- better risk/governance estimation for work items

Impact:
- the planner is useful, but still too generic for serious self-directed iteration

### E. Safe Self-Mutation Boundaries Need Ongoing Discipline

What needs attention:
- keep early self-build in docs/config/operator-surface-safe areas
- avoid silent expansion into runtime-core mutation
- make policy-pack enforcement more obvious in UI and reports
- treat proposal-required work as the norm for code-oriented self-work

Impact:
- without discipline here, “self-building” quickly turns into “unsafe mutation with weak review”

### F. Learning and Reflection Are Still Underexposed

What is missing:
- operator-facing learning dashboards
- trend and failure aggregation over self-build artifacts
- policy recommendation loop informed by repeated self-build outcomes
- doc suggestion promotion path

Impact:
- SPORE can record learnings, but does not yet operationalize them well enough

## What Requires Special Attention

### 1. Keep Safe Mode the Default

At this stage, the highest-value self-work is still:
- docs
- config
- validation harness
- operator surfaces
- runbooks
- scenario/regression definitions

That is enough to make SPORE meaningfully improve itself without immediately risking deep runtime corruption.

### 2. Do Not Skip Review Gates for Code-Oriented Work

Proposal artifacts should remain the mandatory review package for code-oriented self-work.

If this boundary weakens, SPORE will lose the main safety property that makes supervised self-building viable.

### 3. Keep Named Validation Flows Central

Self-build should continue to validate itself through named scenarios and regressions.

Do not let validation drift into ad hoc one-off checks when a canonical scenario or regression profile should exist.

### 4. Keep UI Thin Over HTTP Contracts

The browser and TUI should continue consuming explicit orchestrator and gateway routes.

Do not backslide into direct SQLite reads or filesystem scraping from clients.

### 5. Keep Documentation Synchronized With Behavior

The repo is now large enough that undocumented behavior will become a material cost quickly.

Every new self-build loop feature should keep updating:
- `README.md`
- `AGENTS.md`
- `docs/runbooks/local-dev.md`
- architecture docs for operator surfaces and workflow behavior
- docs index and manifest when new canonical docs are added

## What Is Still Missing Before “SPORE Works on SPORE” Feels Real

A credible supervised self-building SPORE still needs all of the following together:

- dependency-aware grouped execution
- stronger proposal review workflows
- reusable validation bundles
- better planner quality
- more visible learning records and doc suggestions
- canonical self-build scenarios
- one coherent operator flow from goal to reviewed outcome

Until those pieces land, SPORE can already do supervised self-work, but it still behaves more like a collection of strong building blocks than a smooth self-improvement product.

## Recommended Immediate Focus

If the next batch should stay tightly focused, implement these four first:

1. workspace diagnostics and reconcile
2. stronger proposal artifact semantics
3. dependency-aware work-item groups
4. execution-level workspace reads and runtime proof

That gives the highest leverage path toward a usable supervised self-build loop.

## Exit Criteria for the Next Major Milestone

The next milestone should be considered reached when all of the following are true:

- an operator can submit a goal for SPORE itself
- SPORE can materialize that goal into grouped dependent work items
- at least one code-oriented self-work item produces a proposal artifact
- the proposal goes through review and approval
- the run has attached validation evidence
- doc suggestions and learning records are produced automatically
- the whole process is visible in the browser without CLI-only recovery
- the process remains safe-mode constrained by default
