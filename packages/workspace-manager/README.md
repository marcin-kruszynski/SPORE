# `packages/workspace-manager`

This package owns filesystem workspace isolation for mutating SPORE work.

## Current Scope

- resolve the canonical git root,
- allocate one git worktree per mutating owner,
- name worktree branches consistently,
- inspect worktree cleanliness and registration state,
- remove worktrees safely,
- reconcile workspace records against on-disk git worktrees,
- generate patch artifacts for proposal packages.

## Current Model

The active SPORE model is:

- canonical repository root as the source of truth,
- one worktree per mutating `work-item-run` or mutating execution step,
- no shared family worktree,
- no persistent per-agent worktree pool yet.

Worktree paths default to:

- `.spore/worktrees/<projectId>/<workspaceId>`

Branch names default to:

- `spore/<projectId>/<ownerType>/<ownerId>`

## CLI

```bash
node packages/workspace-manager/src/cli/spore-workspace.js list
node packages/workspace-manager/src/cli/spore-workspace.js create --id ws-001 --project spore --owner-type work-item-run --owner-id work-item-run-001 --scope docs,config
node packages/workspace-manager/src/cli/spore-workspace.js show --path .spore/worktrees/spore/ws-001
node packages/workspace-manager/src/cli/spore-workspace.js reconcile --id ws-001 --path .spore/worktrees/spore/ws-001 --branch spore/spore/work-item-run/work-item-run-001
node packages/workspace-manager/src/cli/spore-workspace.js cleanup --path .spore/worktrees/spore/ws-001 --force
```

## Integration Boundary

- `packages/orchestrator/` persists workspace allocations and links them to work-item runs and proposal artifacts.
- `packages/runtime-pi/` now consumes the provisioned worktree as `cwd` for mutating runtime sessions and records launch-context evidence.
- `services/orchestrator/` exposes read surfaces for operators and web clients.
- canonical builder/tester verification now uses:
  - builder authoring workspaces,
  - git-backed handoff snapshots,
  - separate tester verification workspaces created from the builder snapshot.

This package should stay thin and git-focused. Governance, proposal lifecycle, and workflow state belong elsewhere.
