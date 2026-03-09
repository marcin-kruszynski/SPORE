# Worktree and Workspace Isolation for SPORE

## Purpose

This document summarizes the current state of workspace isolation in SPORE, compares relevant reference systems, and proposes a concrete worktree model for future code-oriented self-build and multi-agent execution.

Status note:
- the first implementation slice now exists through `packages/workspace-manager/`,
- durable `workspace_allocations` are persisted for mutating self-work,
- proposal artifacts and work-item runs can now link to a provisioned git worktree,
- runtime launch can now switch `cwd` into a provisioned workspace for controlled mutating self-work,
- an initial execution-step workspace path now exists through `runtimePolicy.workspace`.

It answers four questions:

1. Do we already have real worktree creation in SPORE?
2. If not, what isolation do we have today?
3. How do Gas Town, Overstory, and the Agentic Engineering Book frame the problem?
4. What worktree model should SPORE adopt next?

## Executive Summary

SPORE now implements a **first slice** of `git worktree` provisioning for mutating self-work.

What exists today is:
- durable workflow execution state,
- rooted execution trees and branch metadata,
- session isolation through tmux-backed runtime sessions,
- self-work guardrails through `safeMode`, `mutationScope`, policy packs, proposal artifacts, and validation bundles.

That is useful, but it is not filesystem isolation.

Today, SPORE has:
- logical execution isolation,
- runtime/session isolation,
- governance isolation,
- mutation intent metadata.

It still does **not** yet have:
- broad policy-driven execution-step worktrees across the whole workflow engine,
- execution-family integration branches,
- persistent per-agent worktree pools,
- retention automation for old workspaces and artifact bundles,
- a dedicated proof for real PI-backed mutating sessions under proposal-producing self-work.

For real code-writing swarm behavior, SPORE should move to a **canonical-root + per-mutating-run worktree** model.

The recommended default is:
- no worktree for read-only or coordination-only roles,
- one worktree per mutating work-item run or mutating execution,
- optional execution-family integration branch, but **not** one shared worktree for the whole family,
- persistent agent-specific worktrees only later, once SPORE has durable worker identity and reuse semantics.

## Current SPORE State

## What exists now

Relevant current capabilities already in the repo:

- self-build goal planning and materialization into work items and work-item groups,
- dependency-aware work-item groups,
- durable work-item runs,
- proposal artifacts for code-oriented self-work,
- validation bundles linking scenario and regression runs,
- `safeMode` enforcement plus `mutationScope` metadata,
- policy packs such as `self-build-safe` and `self-build-proposals`,
- execution trees, branching, wave-based execution, and family governance,
- tmux-backed runtime sessions with gateway-based live inspection and control.

Representative files:
- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/execution/workflow-execution.js`
- `packages/session-manager/src/store/session-store.js`
- `services/orchestrator/server.js`
- `services/session-gateway/server.js`
- `config/projects/spore.yaml`
- `config/policy-packs/self-build-safe.yaml`
- `config/policy-packs/self-build-proposals.yaml`

## What does not exist yet

There is now an implemented worktree manager and a first workspace allocator slice in the current SPORE codebase.

Implemented now:
- `packages/workspace-manager/`
- `git worktree add`
- `git worktree remove`
- durable `workspace_allocations`
- orchestrator read surfaces for workspaces linked to mutating work-item runs
- orchestrator execution-level workspace reads through `GET /executions/:id/workspaces`
- workspace allocation tables for worktree paths or branches
- orchestrator/session launch code that switches cwd into a per-run worktree
- durable `launch-context` artifacts that record the actual runtime launch `cwd`
- cleanup/reconcile logic for orphaned worktrees
- governance-aware cleanup and retention guidance for workspace directories versus proposal artifacts
- builder-to-tester handoff snapshots that provision a dedicated verification workspace from a builder authoring workspace

This means the current self-build loop can reason about scoped mutations, but it cannot yet guarantee physical filesystem isolation between mutating workers.

## Current isolation model in SPORE

SPORE currently uses four softer layers of isolation:

### 1. Session isolation
- live runtime sessions are isolated as tmux-backed processes.
- session state is durable and inspectable.
- this is execution/process isolation, not repo isolation.

### 2. Execution isolation
- executions, child executions, branches, and waves are first-class records.
- this gives workflow lineage and governance control.
- this is coordination isolation, not filesystem isolation.

### 3. Policy isolation
- policy packs control what kinds of work are allowed.
- `safeMode` limits the declared mutation scope.
- this is declared safety policy, not physical write fencing.

### 4. Artifact isolation
- proposal artifacts and validation bundles separate "candidate output" from "approved output".
- this is good governance, but still not isolated editing roots.

## Why this is no longer enough

As long as SPORE mostly orchestrates docs/config/test-safe work, this soft model is acceptable.

Once SPORE starts doing real self-modification of code:
- sibling workers can trample each other's files,
- there is no safe canonical repo root separate from mutable branches,
- proposal artifacts are no longer enough because the underlying workspace is shared,
- failure recovery has no durable workspace lifecycle to reconcile.

That is the boundary where `git worktree` becomes infrastructure, not convenience.

## Reference Comparison

## Gas Town

Primary sources reviewed:
- `references/gastown/README.md`
- `references/gastown/docs/glossary.md`
- `references/gastown/docs/reference.md`
- `references/gastown/SECURITY.md`

## Gas Town model

Gas Town uses a workspace-manager model centered around:
- a town root,
- per-project rigs,
- a canonical clone for the rig,
- worker worktrees for polecats,
- supervisor and merge infrastructure around them.

The essential structure is:
- canonical repo state lives in `mayor/rig/`,
- workers operate in isolated worktrees under `polecats/<name>/`,
- work state persists separately in Beads / Hooks,
- sessions are ephemeral but worker identity is persistent.

Important characteristics:
- **per-agent worktree** for worker agents,
- **persistent identity** for polecats,
- **ephemeral sessions** attached to a persistent workspace identity,
- **refinery merge queue** handles integration,
- **witness/deacon** supervise health and recovery.

Security note explicitly worth copying into SPORE's design thinking:
- workers run in separate tmux sessions but can still share filesystem access if the platform does not enforce stronger boundaries.
- worktree isolation reduces conflicts, but it is not a complete security model by itself.

## Gas Town takeaways for SPORE

Strong ideas to adopt:
- separate canonical project root from mutable worker workspaces,
- keep worker execution state outside pure chat context,
- reconcile long-lived worker identity separately from short-lived sessions,
- treat merge/integration as a dedicated concern.

Ideas to avoid copying too early:
- full daemon hierarchy,
- full rig/town complexity,
- persistent named worker pools before SPORE needs them.

## Overstory

Primary sources reviewed:
- `references/overstory/README.md`
- `references/overstory/agents/lead.md`
- `references/overstory/templates/overlay.md.tmpl`
- `references/overstory/STEELMAN.md`
- `references/overstory/CLAUDE.md`
- `references/overstory/SECURITY.md`

## Overstory model

Overstory is much closer to the problem SPORE is about to face.

Its key model is:
- coordinator stays at project root,
- each spawned worker gets its own git worktree,
- the worker receives an overlay with:
  - branch,
  - worktree path,
  - file scope,
  - explicit instruction not to write to canonical root,
- integration happens later through merge tooling and queue semantics.

This means:
- the model is effectively **per spawned agent**,
- because most agents are task-bound, it is also practically **per task**,
- coordinator and supervisors do **not** get worktrees,
- mutating workers do.

Overstory also highlights the real costs:
- worktree creation has overhead,
- too many parallel worktrees create merge/debugging burden,
- worktrees can become orphaned or corrupted,
- agents can still escape read boundaries unless the platform enforces stronger rules.

## Overstory takeaways for SPORE

Strong ideas to adopt:
- mutating agents write only inside their assigned worktree,
- non-mutating coordination roles stay at canonical root,
- explicit path boundary instructions belong in overlays/runtime context,
- worktree lifecycle needs explicit list/clean/doctor support.

Strong warnings to carry forward:
- do not spawn worktrees for tiny tasks when the overhead dominates,
- worktree isolation does not solve merge or semantic conflict by itself,
- cross-worktree visibility remains a real security and debugging concern.

## Agentic Engineering Book

Primary sources reviewed:
- `references/agentic-engineering-book/chapters/9-practitioner-toolkit/5-multi-agent-workspace-managers.md`
- `references/agentic-engineering-book/chapters/4-context/4-multi-agent-context.md`
- `references/agentic-engineering-book/chapters/6-patterns/1-plan-build-review.md`
- `references/agentic-engineering-book/chapters/6-patterns/3-orchestrator-pattern.md`

## Book recommendations that matter here

The book makes three important distinctions:

### 1. Workspace managers are infrastructure
They are not the coding agent and not the workflow framework.
They exist to provision isolated environments, route work, merge outputs, and supervise health.

This maps directly to SPORE's need for a dedicated workspace/worktree layer instead of hiding worktree logic inside session code or proposal artifact code.

### 2. Context isolation and filesystem isolation are different
Sub-agent context isolation keeps orchestration clean.
Workspace/worktree isolation keeps concurrent writes safe.
SPORE already has the first one in spirit. It does not yet have the second.

### 3. Workspace managers become valuable at higher concurrency
The book explicitly argues that workspace-manager infrastructure is typically justified around roughly `8-10+` concurrently active workers, and often overkill below that.

That does **not** mean SPORE should postpone worktrees indefinitely.
It means SPORE should introduce worktrees where they matter first:
- code-oriented self-work,
- parallel builder-like tasks,
- any run producing proposal artifacts meant for review.

## Direct recommendation implied by the book

For SPORE's near-term stage, the right move is not:
- "persistent worktree per every conceptual role forever"

The right move is:
- "dedicated workspace management for mutating work, introduced incrementally, with orchestration still remaining thin and supervised"

## Answering the Core Design Question

## Do we have worktree creation implemented now?

Yes, partially.

SPORE now has a real worktree provisioning path for mutating self-work and an initial execution-step integration path.

Implemented now:
- canonical repo root versus mutable per-run worktree,
- durable `workspace_allocations`,
- explicit `workspace reconcile` and `workspace cleanup`,
- runtime launch with `cwd` set to the provisioned worktree when a mutating self-work workflow step carries workspace policy,
- workspace metadata in runtime session plans and session live inspection.

Still not complete:
- full workspace-backed execution coverage for all mutating workflow steps,
- aggregate execution-to-workspace read surfaces,
- durable merge/integration discipline on top of workspace-backed proposals,
- reusable worker workspace pools.

## Should the model be per agent, per task, or per lead tree?

### Not per lead tree
A single shared worktree for an entire lead tree is the wrong default.

Why:
- sibling children in the same tree will still conflict on one filesystem,
- proposal artifacts lose their attribution boundary,
- cleanup and recovery become family-level and harder to reason about,
- one bad child can contaminate the entire tree workspace.

Use a lead tree for:
- lineage,
- governance,
- execution family control,
- optional shared integration branch metadata.

Do **not** use it as the default physical workspace boundary.

### Not per agent identity yet
A persistent worktree per named agent is a good model only when SPORE has a mature concept of:
- durable worker identity,
- skill routing based on prior work,
- reuse across many tasks,
- long-lived local state worth preserving.

Gas Town has that.
SPORE does not yet.

If we implement persistent per-agent worktrees too early, we will create:
- hidden state bleed between tasks,
- harder reproducibility,
- more cleanup and reset complexity,
- weaker proposal/review clarity.

### Recommended now: per mutating task/run
The best near-term model for SPORE is:
- **one worktree per mutating work-item run or mutating execution**.

That means:
- read-only roles: no worktree required by default,
- planner/orchestrator/reviewer/scout: canonical root or read-only context path,
- builder-like or code-mutating self-work run: dedicated worktree.

This gives:
- clean attribution,
- proposal artifacts bound to one workspace,
- easy cleanup,
- lower risk of cross-run contamination,
- a natural path to later family integration and merge queues.

## Recommended SPORE Model

## Layer 1: Canonical root
The project root remains the source of truth.

Responsibilities:
- docs,
- planning,
- orchestration state,
- gateway/orchestrator services,
- merge target,
- read-mostly coordination surface.

This root should not be the place where mutating workers write during parallel self-build.

## Layer 2: Worktree per mutating run
Every code-oriented work-item run or mutating execution gets:
- `workspaceId`
- `worktreePath`
- `branchName`
- `baseRef`
- `mode: read-write`
- `ownerType: work-item-run | execution-step`
- `ownerId`
- `projectId`
- `safeMode`
- `mutationScope`
- `status: planned | provisioned | active | settled | cleaned | orphaned`

Recommended path shape:
- `.spore/worktrees/<projectId>/<workspaceId>/`

Recommended branch shape:
- `spore/<projectId>/<ownerType>/<ownerId>`

Example:
- `.spore/worktrees/spore/ws-abc123/`
- branch `spore/spore/work-item-run/wir-abc123`

## Layer 3: Optional family integration branch
Execution families may later share:
- `integrationBranch`
- `familyBaseRef`

This is useful for:
- coordinating multiple child runs,
- batching merge readiness,
- group-level review or validation.

But it should be metadata for coordination, not the only workspace.

Recommended rule:
- one family may share an integration branch target,
- each mutating child still gets its own worktree.

## Layer 4: Persistent worker pools later
Only after SPORE has mature worker identity should it introduce:
- reusable named worker worktrees,
- pooled builders,
- specialization history per worker.

That is a later-scale optimization, not the next implementation step.

## Role-Based Defaults

### No worktree by default
These roles should not require a dedicated worktree initially:
- orchestrator
- goal planner
- scout
- reviewer
- operator dashboard read models
- regression/scenario summary readers

### Worktree required by default
These roles or run kinds should require a worktree:
- code-oriented self-work items,
- workflow runs that mutate repo files,
- builder-like execution steps,
- any run that emits proposal artifacts with file-level changes.

### Conditional worktree
These may need configurable behavior:
- lead
- tester
- docs-maintenance worker

A docs-only change still benefits from a worktree if it is mutating in parallel with other work, but it is lower risk than code mutation.

## Recommended Implementation Contract for SPORE

## New durable model
Add a `workspace allocation` model owned by SPORE itself.

Suggested fields:
- `id`
- `projectId`
- `ownerType`
- `ownerId`
- `executionId`
- `stepId`
- `workItemId`
- `workItemRunId`
- `proposalArtifactId`
- `worktreePath`
- `branchName`
- `baseRef`
- `integrationBranch`
- `mode`
- `safeMode`
- `mutationScope`
- `status`
- `createdAt`
- `updatedAt`
- `cleanedAt`
- `metadata`

## New package boundary
Recommended future package:
- `packages/workspace-manager/`

Responsibilities:
- detect canonical project root,
- provision and destroy git worktrees,
- map workspace allocations to runs/executions,
- expose list/status/cleanup/reconcile APIs,
- generate runtime launch context with explicit worktree path.

Do **not** bury this inside:
- `runtime-pi`,
- `session-manager`,
- `apps/web`,
- or proposal artifact generation.

This is a separate infrastructure boundary.

## New service behavior
### Orchestrator
Before launching a mutating work-item run or mutating execution step:
- allocate workspace,
- create branch/worktree,
- persist workspace record,
- pass `worktreePath` and `branchName` into runtime launch context.

### Runtime
Launchers should:
- use the worktree as cwd,
- expose explicit path boundary instructions to the runtime,
- record worktree metadata in transcript/session artifacts.

### Session gateway
Expose read-only workspace surfaces:
- workspace summary for a session/run,
- path/branch/baseRef status,
- cleanup state,
- diagnostics for orphaned or diverged worktrees.

### Proposal artifacts
Proposal artifacts should later link to:
- `workspaceId`
- `branchName`
- `baseRef`
- `diffSummary`
- optional `patchArtifactPath`

## Phased Rollout Recommendation

## Phase A — Worktree provisioning for code-oriented self-work only
Implement:
- workspace allocation table,
- create/remove/list/reconcile logic,
- orchestrator integration for code-oriented work-item runs,
- proposal artifact linkage to workspace metadata.

Do not yet implement:
- merge queue,
- persistent worker pools,
- family-level integration rebases.

This is the right first slice.

## Phase B — Execution-step worktrees
Extend from work-item runs to workflow execution steps.

This lets SPORE use the same workspace layer for:
- self-build,
- orchestrated builders,
- future branch/rework execution lanes.

## Phase C — Family integration branches
Add:
- execution-family integration branch metadata,
- family-level review/validation against grouped proposals,
- optional rebasing and integration workflows.

## Phase D — Persistent worker identities
Only if SPORE eventually needs higher swarm throughput, add:
- reusable named workers,
- skill routing by worker history,
- worktree reuse across tasks.

That is a scale optimization, not the current correctness requirement.

## Risks and Design Warnings

The references point to real failure modes SPORE should design for now.

### 1. Orphaned worktrees
Need:
- reconcile command,
- doctor checks,
- best-effort rollback on failed spawn.

### 2. Branch divergence and merge bottlenecks
Need:
- proposal-first workflow now,
- merge queue only later,
- explicit limit on concurrent mutating work.

### 3. False sense of security
Worktree isolation reduces collisions.
It does not provide full security isolation.
Agents can still read more than intended unless runtime/tooling boundaries are stronger.

### 4. Hidden state in persistent workspaces
This is why per-agent persistent worktrees should wait.
Near-term SPORE should prefer reproducible per-run workspaces.

### 5. Overhead for trivial tasks
Overstory is right here: worktree creation has real cost.
Small or read-only tasks should not pay it unnecessarily.

## Final Recommendation

The next correct design step for SPORE is:

- implement a dedicated `workspace manager` boundary,
- use `git worktree` for **mutating runs**, not for every role,
- keep coordinator/orchestrator/root roles outside worktrees,
- keep execution family as a governance/lineage concept, not as the physical workspace boundary,
- postpone persistent per-agent worktrees until SPORE has mature durable worker identity.

In one sentence:

**For SPORE now, the right model is canonical root + one worktree per mutating work-item run or execution step, with optional family integration metadata and no shared family worktree.**

## Recommended Next Implementation Steps

1. Add `packages/workspace-manager/` with create/list/remove/reconcile for Git worktrees.
2. Add durable workspace allocation records to the orchestrator store.
3. Require a workspace allocation for proposal-producing work-item runs.
4. Pass `worktreePath` and `branchName` into runtime launch context and proposal artifacts.
5. Add operator reads for workspace status, orphan detection, and cleanup readiness.
6. Only after that, consider family integration branches and later persistent worker pools.
