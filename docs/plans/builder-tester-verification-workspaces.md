# Builder and Tester Verification Workspaces

## Status

Proposed implementation plan for the next agent.

## Purpose

Define a safe and reproducible workspace model for builder and tester roles without:

- a shared read-write worktree,
- directory copying,
- persistent worktree-per-agent pools,
- a shared family worktree.

## Recommended Model

Use a `builder authoring workspace -> tester verification workspace` contract.

- The canonical repository root remains the source of truth and read-mostly coordination surface.
- The builder gets a dedicated read-write `authoring workspace`.
- The builder works only inside that workspace.
- The builder publishes a Git-backed handoff snapshot before verification begins.
- The tester gets a separate `verification workspace` created from the builder snapshot.
- The tester validates a frozen snapshot, not the builder's live filesystem.
- The reviewer remains read-only and works from artifacts, evidence, and diffs.

This follows the repo's current direction toward one worktree per mutating run or step rather than one worktree per agent identity or one shared family worktree.

Relevant repo references:

- `packages/workspace-manager/README.md`
- `docs/specs/worktree-and-workspace-isolation.md`
- `config/profiles/builder.yaml`
- `config/profiles/tester.yaml`
- `config/profiles/reviewer.yaml`

## Core Rules

1. Builder and tester do not share the same worktree.
2. The tester does not validate by reading the builder's live mutable directory.
3. The tester verification workspace is created from a Git snapshot reference.
4. Do not copy the builder directory to create the tester workspace.
5. The tester does not fix code in the verification workspace.
6. Failed verification routes back to builder rework or a new builder lane.

## Why This Model

This model gives:

- clear mutation ownership,
- reproducible test evidence tied to a specific snapshot,
- simpler cleanup and recovery,
- cleaner proposal attribution,
- lower risk of builder and tester trampling each other.

It avoids the main drawbacks of a shared worktree:

- non-deterministic test results,
- race conditions,
- unclear authorship,
- harder review and rollback.

## Important Constraint

The tester verification workspace should be created from a Git snapshot, not from uncommitted builder filesystem state.

That means the builder must publish one of:

- `snapshotRef`,
- `snapshotCommit`.

Preferred MVP:

- the builder creates a local handoff commit on its workspace branch,
- the orchestrator records `snapshotRef` and `snapshotCommit`,
- the tester workspace is created from that ref or commit.

Possible later fallback:

- patch artifact generation and application into a verification workspace.

## Role Semantics

### Builder

- Gets a dedicated `authoring workspace`.
- Runs with `cwd` set to that worktree.
- Produces code, docs, config, and proposal artifacts.
- Publishes a handoff snapshot before tester verification.

### Tester

- Default profile remains read-only plus test execution.
- For final verification of builder output, gets a dedicated `verification workspace`.
- Runs with `cwd` set to that verification worktree.
- Validates the builder snapshot and emits verdict plus evidence.
- Does not edit source as part of the verification step.

### Reviewer

- Remains read-only.
- Reviews diffs, proposal artifacts, and tester evidence.
- Does not require a dedicated worktree.

## Workflow Semantics

For MVP, final verification should be sequential, not parallel.

Recommended MVP flow:

- `lead -> builder -> tester -> reviewer`

Frontend variant:

- `lead + scout -> builder -> tester -> reviewer`

Do not treat `builder + tester` in the same wave as the final verification lane for the builder change set.

If parallel value is needed later, split tester behavior into two modes:

- `preflight`: optional read-only baseline or harness work that can run in parallel with builder,
- `verify`: final snapshot-based verification that runs after builder handoff.

## Builder to Tester Handoff Contract

### Builder Step

- The orchestrator allocates an `authoring workspace`.
- Runtime launches the builder with `cwd` set to that worktree.
- The builder mutates files only in that workspace.
- At handoff the builder publishes:
  - `snapshotRef`,
  - `snapshotCommit`,
  - proposal artifact or diff summary,
  - optional patch artifact.

### Tester Step

- The tester step cannot start until the builder handoff snapshot exists.
- The orchestrator allocates a `verification workspace` from `snapshotRef` or `snapshotCommit`.
- Runtime launches the tester with `cwd` set to that worktree.
- The tester executes tests, probes, and validations.
- The tester records evidence and a verdict.
- If verification fails, the tester does not repair code in place.

### Reviewer Step

- The reviewer receives the proposal, diff, and tester evidence.
- The reviewer returns approve, revise, or reject.

## Data Model Changes

Add clear workspace-purpose and source linkage semantics.

MVP can store these in workspace allocation metadata if durable schema changes are not yet ready.

Minimum fields:

- `workspacePurpose: authoring | verification`
- `sourceWorkspaceId`
- `sourceStepId`
- `sourceRef`
- `sourceCommit`
- `verificationForStepId`
- `launchedCwd`
- `handoffStatus`

Primary storage touchpoint:

- `packages/orchestrator/src/store/execution-store.js`

## Workspace Manager Changes

Extend `packages/workspace-manager/` to support:

- creating a workspace from an explicit ref or commit,
- distinguishing `authoring` and `verification` workspaces,
- inspecting and cleaning up both kinds of workspaces,
- maintaining separate builder and tester workspace paths.

MVP is allowed to use an ephemeral verification branch created from `snapshotCommit`.
Detached verification worktrees can be a later optimization.

## Runtime Changes

Runtime must support launching steps in a provided workspace path instead of always using `PROJECT_ROOT`.

Update the runtime launch path so that:

- builder sessions start inside the authoring worktree,
- tester sessions start inside the verification worktree,
- session metadata records the actual `cwd`,
- live inspection surfaces expose workspace linkage.

Expected touchpoints:

- `packages/runtime-pi/src/cli/run-session-plan.js`
- `packages/runtime-pi/src/launchers/tmux-launcher.js`
- `packages/runtime-pi/src/launchers/pi-rpc-runner.js`
- `packages/runtime-pi/src/launchers/pi-json-runner.js`

## Orchestrator Changes

Add orchestration behavior for:

- allocating an authoring workspace for mutating builder steps,
- requiring builder handoff snapshot publication before verification,
- allocating a verification workspace from the builder snapshot,
- linking execution step, session, workspace, and proposal artifact,
- preventing builder and tester from sharing the same default workspace.

Expected touchpoints:

- `packages/orchestrator/src/execution/`
- `packages/orchestrator/src/store/execution-store.js`
- `services/orchestrator/server.js`

## Workflow Template Changes

For MVP, update workflow templates so final verification is sequential.

First candidates:

- `config/workflows/backend-service-delivery.yaml`
- `config/workflows/frontend-ui-pass.yaml`
- `config/workflows/cli-verification-pass.yaml`

If parallel tester value is needed later, add explicit semantics such as:

- `testerMode: preflight | verify`,
- a separate preflight tester step,
- a later snapshot-based verify step.

## Documentation and Decision Updates

Update the canonical docs that describe this contract:

- `docs/specs/worktree-and-workspace-isolation.md`
- `docs/architecture/workflow-model.md`
- `packages/workspace-manager/README.md`

If the implementation changes the durable workflow-workspace contract, add an ADR in `docs/decisions/` and update the docs indexes and manifest.

## Implementation Plan

1. Document the contract in docs and, if needed, an ADR.
2. Extend `workspace-manager` to create workspaces from refs or commits.
3. Add workspace-purpose and source metadata to orchestrator persistence.
4. Update runtime launchers to honor workspace `cwd`.
5. Add builder handoff snapshot creation and metadata recording.
6. Add tester verification workspace provisioning from builder snapshot.
7. Update workflow templates to use sequential final verification.
8. Add test coverage and run smoke validation.

## Acceptance Criteria

- Builder and tester do not use the same worktree.
- The tester verification workspace is created from builder `snapshotRef` or `snapshotCommit`.
- No directory copy is used to create the tester workspace.
- The tester verify step cannot start without a builder handoff snapshot.
- Runtime launches builder and tester in different `cwd` values.
- Session and orchestrator read surfaces show execution-step to workspace to session linkage.
- Workflow templates express builder then tester then reviewer semantics for final verification.
- Reviewer works from evidence and artifacts without a dedicated worktree.
- Cleanup works for both authoring and verification workspaces.
- Docs and indexes are updated.

## Suggested Verification

Run at least:

- unit tests for `packages/workspace-manager/`,
- orchestrator tests for workspace and step linkage,
- runtime tests for `cwd` propagation,
- `npm run config:validate`,
- `npm run docs-kb:index`.

If the end-to-end flow is wired up, also run a smoke test through the orchestrator workflow path.

## Out of Scope for This Phase

- persistent worktree per agent,
- shared family worktree,
- production merge queue,
- full integration branch workflow,
- tester-as-repair lane,
- advanced multi-snapshot rebase flows.
