# Workflow Model

Workflow templates define reusable orchestration patterns.

## Template Requirements

Each workflow includes:
- trigger type,
- applicable project types,
- role sequence,
- optional `stepSets` for wave-based parallel launch inside one execution,
- branching conditions,
- review step,
- retry policy,
- docs update policy,
- completion requirements.

## Seeded Workflows

- feature-delivery
- bugfix
- research-spike
- review-pass
- project-coordination-root
- feature-promotion
- backend-service-delivery
- frontend-ui-pass
- cli-verification-pass
- docs-adr-pass
- documentation-pass (workspace profile)
- environment-bootstrap (workspace profile)

Named validation flows and recommended commands live in `docs/runbooks/scenario-library.md`.
Machine-readable scenario and regression catalogs live in `config/scenarios/` and `config/regressions/`.
Durable operator-facing run records are exposed through scenario-run and regression-run read surfaces, rerun routes, and trend summaries.

## Current Executable Slice

The bootstrap execution path now supports:

- durable workflow execution records in SQLite,
- workflow event emission for execution, step, review, approval, retry, and escalation transitions,
- ordered multi-session step launch,
- wave-based launch of multiple steps inside one execution when a workflow defines `stepSets`,
- wave-gated unlock rules inside one execution (`all`, `any`, `min_success_count`),
- durable workflow handoff records that preserve normalized role outputs between steps,
- sequential builder-to-tester verification handoff for the canonical implementation workflows,
- builder authoring workspaces plus tester verification workspaces created from a builder snapshot rather than a shared mutable worktree,
- parent-child session linking between consecutive steps,
- startup context and invocation briefs that can carry curated inbound handoffs plus the expected outbound handoff contract for the active role,
- domain-aware workflow policy defaults from `config/domains/*.yaml` plus project `activeDomains[]` overrides,
- execution records that can carry lineage metadata such as `parentExecutionId` and `coordinationGroupId`,
- execution records that can carry branch metadata such as `branchKey`,
- coordination-group list and detail views for related executions,
- child-execution reads for lineage-aware operator surfaces,
- rooted execution-tree reads for lineage-aware clients,
- governance stop points at `waiting_review` and `waiting_approval`,
- explicit operator review and approval decisions,
- explicit project-root coordination through `orchestrator -> coordinator -> lead`,
- explicit promotion lanes through `coordinator -> integrator`,
- retry and rework branching when review or approval requests changes,
- escalation records when retry budgets are exhausted,
- operator resolution of open escalations with optional execution resume,
- operator fork, pause, hold, resume, and coordination-group drive controls,
- operator tree-drive, tree-review, tree-approval, and multi-branch spawn controls for execution families,
- paused and held execution states for operator-controlled interruption without treating the execution as failed,
- completion, failure, rejection, and cancellation as execution end states.

## Project-Scoped Coordination And Promotion

SPORE now has two project-scoped workflow entrypoints that sit beside existing domain workflows:

- `project-coordination-root`
- `feature-promotion`

They are explicit planner and invoker paths:

- `project-plan`
- `project-invoke`
- `promotion-plan`
- `promotion-invoke`

Rules:

- `coordinator` is a project-root, read-mostly role and is not prepended to existing domain workflow role lists.
- `integrator` is a project-scoped promotion lane and is not prepended to domain workflow role lists.
- existing lead-first child workflows keep their current semantics.
- proposal approval is not treated as merge completion.
- the default terminal promotion outcome is `promotion_candidate`, not automatic merge to `main`.

Promotion lanes reuse existing execution-family primitives:

- `coordinationGroupId`
- `parentExecutionId`
- `branchKey`

The coordinator root owns the family and domain child lanes. Integrator executions are explicit children under that root and inherit project-level coordination metadata rather than mutating the role lists of domain workflows.

## Domain Policy Integration

Workflow invocation is now domain-policy aware.

The current precedence is:

1. explicit invocation roles,
2. merged domain `workflowPolicy.defaultRoles`,
3. workflow template `roleSequence`.

The merged policy comes from:

- `config/domains/<domain>.yaml` as the base,
- the matching project `activeDomains[]` entry as the overlay.

That policy currently affects:

- default role selection,
- per-role and default `maxAttempts`,
- policy-selected retry target role and downstream reset behavior after rework,
- reviewer-step `reviewRequired` and `approvalRequired` defaults,
- step watchdog `stepSoftTimeoutMs` and `stepHardTimeoutMs`,
- per-role `sessionMode`,
- docs-kb startup retrieval query terms and result limit.

Workflow templates can additionally shape execution topology directly:

- `roleSequence` remains the linear fallback,
- `stepSets` can group selected roles into the same execution wave,
- planner output persists `wave` and `waveName` onto each launch and durable step record.

The orchestrator persists both the execution-level merged policy and the per-step launch policy so later drive, review, approval, and recovery behavior can use the same durable defaults.

That now includes:

- `workflowPolicy.retryTargetRole` so rework can jump back to a domain-chosen step instead of always retrying the last non-review step,
- `workflowPolicy.resetDescendantSteps` so downstream implementation and validation steps can be re-planned when an earlier step is selected for rework.

## Durable Execution Shape

The durable execution model is evolving from a single ordered role list toward a coordination-aware workflow graph.

The stable baseline remains:

- one execution record as the durable unit of workflow state,
- one or more workflow steps inside that execution,
- optional grouped waves of steps inside that execution,
- one or more runtime sessions launched on behalf of those steps,
- durable review, approval, escalation, and event history tied to the execution.
- a combined execution history surface (`/executions/:id/history`) that folds timeline, governance, audit, wave summary, and policy diff into one ordered payload.

The next layer now being encoded into the model is:

- coordination groups that relate multiple sibling or descendant executions,
- explicit parent-child execution lineage,
- branch-aware execution variants created by retry, rework, or operator-directed fork paths,
- non-terminal operator states such as `paused` and `held`.
- additive hold metadata such as owner, guidance, and expiry timestamp.

## Coordination Groups

Coordination groups are the execution-level container for work that no longer fits a single linear role list.

The intended model is:

- one root execution can own a coordination group,
- child or sibling executions can join that group as forked or branched work,
- the group can be inspected as one operator-facing unit without collapsing the underlying execution records,
- parent-child lineage and coordination-group membership remain related but distinct concepts.

That distinction matters operationally:

- lineage explains ancestry,
- coordination explains which executions are currently meant to be managed together,
- branch metadata explains why a sibling or descendant exists.

The current executable foundation already exposes durable metadata for that shape, while still treating some group-level policy as an evolving layer rather than a frozen final contract.

The newest operator-facing read surface is the rooted execution tree. It answers:

- which execution is the family root,
- which descendants belong to the same coordination family,
- what step-state summary each node currently has,
- where the selected execution sits inside that lineage.

Inside one execution, the newest step-level coordination surface is the execution wave:

- all steps in the same wave may launch together,
- later waves unlock according to the prior wave gate:
  - `all`: every step in the prior wave must complete,
  - `any`: one completed step is enough,
  - `min_success_count`: a configured number of completions is enough,
- review or approval gates still stop forward progress before a later wave is launched.

That means one execution can now express both:

- strict parallel stages,
- partial-unlock exploratory stages where one successful lane is enough to move the workflow forward.

## Workflow Handoffs

Workflow steps now have two distinct coordination channels:

- durable execution state such as step status, review state, approval state, and events,
- durable workflow handoff artifacts that preserve what one role wants the next role to consume.

The handoff contract is intentionally narrower than free-form agent messaging:

- each settled step publishes one primary semantic handoff,
- some steps may also publish auxiliary evidence handoffs,
- downstream steps receive curated inbound handoffs through runtime context rather than transcript scraping,
- selection is wave-aware and role-optional, so workflows without `scout` or with partial-unlock exploration still behave deterministically,
- structured handoffs are validated against profile policy before the publication is treated as trustworthy,
- fan-out consumption is tracked per downstream target instead of overloading publication state.

The canonical semantic chain for the current implementation workflows is:

- `lead -> task_brief`
- `scout -> scout_findings`
- `builder -> implementation_summary`
- `builder -> workspace_snapshot` as auxiliary evidence,
- `tester -> verification_summary`
- `reviewer -> review_summary`
- `coordinator -> routing_summary`
- `integrator -> integration_summary`

Rules:

- downstream steps consume only compatible prior-wave handoffs unless a future workflow contract opts into same-wave sharing,
- builder-to-tester snapshot handoff remains the authoritative file-level evidence path,
- proposal artifacts may mirror workflow handoff references, but they do not replace the handoff store,
- clients should inspect workflow handoffs through orchestrator read surfaces rather than inferring them from raw transcripts,
- invalid structured output may still produce a degraded artifact for evidence, but enforcement policy decides whether the step proceeds, waits for review, or is blocked from advancement,
- broadcast handoffs can be consumed by multiple downstream steps in the next compatible wave, with each consumer recorded independently.

## Builder and Tester Verification Workspaces

The current verification contract for the canonical implementation workflows is:

- builder runs in a dedicated authoring workspace,
- builder publishes a git-backed handoff snapshot before verification begins,
- tester receives a separate verification workspace created from that snapshot,
- reviewer consumes proposal and verification evidence rather than a shared mutable checkout.

This means final verification is sequential:

- `lead -> builder -> tester -> reviewer`

The workflow engine now treats builder and tester differently:

- builder is the mutating lane and owns the authoring workspace,
- tester validates a frozen snapshot and should not repair source in place,
- reviewer remains read-only.

That builder snapshot is also modeled as a first-class workflow handoff artifact so the semantic summary and the file-level verification evidence share one durable lineage chain.

Do not model final verification as `builder + tester` in the same wave for the canonical implementation workflows. If the system later needs early parallel testing, add an explicit preflight tester lane instead of reintroducing shared builder/tester mutation timing.

## Execution Lineage

Execution lineage is intended to answer two different questions:

1. Where did this execution come from?
2. What other executions is it coordinated with?

Those concerns should remain separate.

Lineage fields:

- `parentExecutionId`: identifies the immediate ancestor execution when an execution is branched or forked from another execution.
- `childExecutionIds`: identifies known descendants when the execution detail payload includes them.
- `branchKey`: identifies the logical branch name or retry/rework lane when the workflow creates divergent paths.

Coordination fields:

- `coordinationGroupId`: identifies a shared execution group that may contain multiple related executions.

An execution may have:

- no parent and no coordination group,
- a parent but no coordination group,
- a coordination group but no parent,
- both a parent execution and a coordination group.

Clients should treat lineage and coordination metadata as optional and should not assume every execution participates in a group.

## Parent/Child Execution Behavior

Parent and child executions should be understandable without requiring the client to infer workflow semantics from timestamps alone.

The recommended interpretation is:

- the parent execution remains the durable source of the original workflow intent,
- a child execution captures a branch, fork, retry lane, or delegated substream,
- the coordination group provides the operator view over the family of related executions,
- operators should prefer group-aware drive and recovery controls over ad hoc per-session intervention when coordinated work is involved.

That now includes explicit family-building controls:

- `fork` for a single child execution,
- `spawn-branches` for multiple child executions under one parent,
- rooted execution-tree reads so the client can render the family without guessing ancestry from timestamps.

As multi-execution behavior expands, a parent execution may temporarily remain blocked while child executions are still active or unresolved. That blocked condition should be represented as workflow state, not as an implicit guess derived from runtime sessions.

## Governance States

The durable execution state model now distinguishes between:

- active execution states such as `planned`, `running`, or step-specific progress,
- governance stop states such as `waiting_review` and `waiting_approval`,
- operator interruption states such as `paused` and `held`,
- terminal states such as `completed`, `failed`, `rejected`, or `canceled`.

`paused` and `held` are not failures.

The recommended distinction is:

- `paused`: an operator-directed stop that intentionally suspends forward progress until an explicit resume decision,
- `held`: a recoverable blocked state used when execution should remain intact but cannot yet advance, for example while waiting on related executions, external clarification, or an operator checkpoint.

Use them for:

- temporary operator intervention,
- controlled recovery after an escalation,
- waiting on an external dependency,
- coordination barriers where one execution should not advance until related work catches up.

Recommended metadata for those states includes:

- `pausedAt`
- `heldAt`
- `holdReason`
- `heldFromState`
- `resumedAt`

Clients and operators should preserve the distinction between:

- governance stops that require review or approval,
- operator-imposed pauses,
- orchestration or dependency holds,
- true terminal failure.

That prevents grouped workflows from being misread as broken when they are merely waiting on a coordinated branch.

Current watchdog behavior also uses the persisted workflow policy as its default threshold source:

- `stepSoftTimeoutMs` triggers orchestrator steering when no more specific runtime override is supplied,
- `stepHardTimeoutMs` triggers orchestrator abort when no more specific runtime override is supplied.

## Operator Recovery Model

Operator recovery is now a first-class concern of the workflow model.

Recovery actions should be understood as durable workflow operations, not ad hoc database edits. The model should support:

- resolving an escalation,
- resuming an execution after operator intervention,
- pausing or holding an execution without discarding its history,
- reviewing and approving work after a rework loop,
- coordinating related executions through shared group state rather than manual out-of-band tracking.

Family-level governance is now part of that model:

- tree review can approve or reject all pending descendant review gates in one operator action,
- tree approval can approve or reject all pending descendant approval gates in one operator action,
- the rooted execution tree remains the preferred operator surface for family-wide recovery and governance work.

As coordination-group support expands, operators should prefer execution-level and orchestration-level recovery controls over manipulating runtime session artifacts directly.

Near-term follow-on work after the current coordination slice should focus on:

1. stable coordination policies for when grouped executions block, resume, or re-enter governance states,
2. richer group-level history views that explain lineage and branch purpose more clearly,
3. explicit hold reasons, ownership, and timeout/escalation guidance for long-lived blocked work.
