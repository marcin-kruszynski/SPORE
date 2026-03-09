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
- `self-build summary` as an aggregate read surface
- Web run-center visibility into managed work items, work-item runs, and proposal artifacts

## What This Means Practically

SPORE can now represent and execute supervised self-work in a structured way.

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

## The Next 16 Steps

The next implementation wave should move in this order.

### 1. Build a Dedicated Self-Build Dashboard

Move self-build visibility from being only one section inside `Run Center` to a dedicated dashboard.

Target outcomes:
- active work-item groups
- blocked work items
- proposal artifacts waiting review
- validation waiting execution
- latest learning records and doc suggestions

Why now:
- the data model exists already
- the operator surface is the current bottleneck

### 2. Add Work-Item Dependency-Aware Group Execution

Make `work-item groups` respect explicit dependencies instead of treating grouped work as only a flat collection.

Target outcomes:
- `dependsOn[]` support
- blocked downstream items when prerequisites fail or are not complete
- group-level state derived from child item dependency state

Why now:
- self-work will become noisy and unsafe without ordering semantics

### 3. Build a Full Goal -> Plan -> Materialize -> Run -> Validate -> Review Flow

Turn the current separate self-build endpoints into one operator-recognizable lifecycle.

Target outcomes:
- one coherent operator flow
- clear handoff points
- durable linkage between goal plan, group, work-item runs, proposals, and validations

Why now:
- the pieces exist, but the end-to-end path is still spread across separate commands and screens

### 4. Strengthen Proposal Artifact Semantics

Proposal artifacts need to become the standard review package for code-oriented self-work.

Target outcomes:
- consistent artifact schema
- stronger links to affected files, tests, validations, and doc impact
- clearer proposal summary for reviewers

Why now:
- proposals exist, but the contract is still early and should be normalized before heavier self-work

### 5. Add Proposal-Centric Review Workflows

Treat proposal review as a dedicated workflow stage rather than a thin state transition.

Target outcomes:
- proposal review notes
- proposal rejection reasons
- clear retry/rework semantics after proposal rejection

Why now:
- self-building without a strong review loop becomes indistinguishable from unsafe automation

### 6. Add Validation Bundles for Work-Item Runs

A work-item run should carry a named validation bundle instead of only ad hoc validation attachments.

Target outcomes:
- reusable validation defaults per template and per project
- linked scenario and regression profiles
- durable validation status and evidence

Why now:
- validation exists, but it is still one level too manual for repeatable self-build loops

### 7. Add Safe-Mode Enforcement as a First-Class Runtime Rule

The default early self-build path should remain constrained.

Target outcomes:
- strict enforcement for docs/config/operator-surface-safe work
- explicit mutation scope checks
- no silent drift into runtime-core mutation paths

Why now:
- the repository is close to running self-work regularly; guardrails need to harden before that becomes routine

### 8. Expand the SPORE Project Profile for Self-Work Defaults

Treat SPORE itself as the first serious managed project profile.

Target outcomes:
- project-level defaults for self-work templates
- validation defaults
- governance defaults
- safe-mode defaults

Why now:
- SPORE should become the canonical reference project for its own orchestration model

### 9. Add Work-Item Templates for More Real SPORE Tasks

Broaden the current small template catalog.

Target outcomes:
- docs maintenance templates
- config/schema maintenance templates
- operator surface templates
- runtime validation templates
- review-only templates

Why now:
- a richer template library reduces operator friction and supports future planner quality

### 10. Add Goal-Planning Rules That Use Project and Domain Context Better

The goal planner should become less generic and more project-aware.

Target outcomes:
- stronger mapping from goal language to domains
- better template selection
- better recommended validation and governance level

Why now:
- current planner is intentionally simple; it is good enough for bootstrap, not good enough for broader self-work

### 11. Add Self-Build Queue Management

Introduce a durable queue view for pending, blocked, running, and review-pending self-work.

Target outcomes:
- queue ordering
- queue filters
- queue grouping by goal plan or work-item group
- operator summary of stuck items

Why now:
- once there are more than a few work items, the current surfaces will stop scaling operationally

### 12. Add Better Learning Record Surfacing

Learning records exist, but they are not yet central to operator decisions.

Target outcomes:
- learning summary cards
- links from failed runs to learning extraction
- policy or documentation follow-up suggestions based on repeated patterns

Why now:
- self-building without durable reflection leaves too much value trapped in logs and run history

### 13. Add Auto-Documentation Suggestion Review Surfaces

Doc suggestions should become a visible review queue, not only attached metadata.

Target outcomes:
- list of suggested README/runbook/ADR/index updates
- reviewable suggestion payloads
- linkage back to the work-item run that generated them

Why now:
- documentation drift will become a real risk as self-work volume grows

### 14. Add Failure Pattern Aggregation for Self-Work

Use work-item and proposal outcomes to surface repeated failure modes.

Target outcomes:
- repeated governance stalls
- repeated validation failures
- repeated proposal rejections
- repeated runtime/operator issues affecting self-build

Why now:
- this becomes the basis for better planning, better policy packs, and lower operator toil

### 15. Add Supervised Self-Build Scenarios

Create canonical named scenarios specifically for SPORE working on SPORE.

Target outcomes:
- docs/config-only self-build scenario
- operator-surface self-build scenario
- validation-harness maintenance scenario
- proposal-and-review self-build scenario

Why now:
- named scenarios are the backbone of repeatable validation in the rest of the system and should become the backbone here too

### 16. Build Supervised Self-Build Loop v1

Only after the previous steps land should SPORE expose a real supervised self-building loop.

Target outcomes:
- operator provides goal
- goal becomes plan and work-item group
- managed execution respects dependencies and policy packs
- proposal artifacts are produced and validated
- documentation suggestions and learning records are generated
- process stops at explicit review and approval gates

Why now:
- this is the first version that can reasonably be called “SPORE working on SPORE” without dropping safety and traceability

## Broader View: What Still Needs to Be Implemented

The next 16 steps above are the immediate self-build track. The broader missing surface is larger.

### A. Self-Build Product Surface Is Still Incomplete

What is missing:
- dedicated self-build dashboard
- queue management and batch execution visibility
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

- a dedicated self-build dashboard
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

1. dedicated self-build dashboard
2. dependency-aware work-item groups
3. validation bundles for work-item runs
4. proposal review workflow depth

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
