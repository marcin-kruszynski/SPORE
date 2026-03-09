# `packages/tui`

This package contains a lightweight terminal operator surface for SPORE.

## Current Commands

```bash
node packages/tui/src/cli/spore-ops.js dashboard
node packages/tui/src/cli/spore-ops.js dashboard --watch
node packages/tui/src/cli/spore-ops.js inspect --session lead-session-002
node packages/tui/src/cli/spore-ops.js execution --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js tree --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js family --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js audit --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js policy-diff --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js history --execution e2e-review-001
node packages/tui/src/cli/spore-ops.js run-center
node packages/tui/src/cli/spore-ops.js scenario-list
node packages/tui/src/cli/spore-ops.js scenario-run --scenario cli-verification-pass
node packages/tui/src/cli/spore-ops.js scenario-run-show --run <run-id>
node packages/tui/src/cli/spore-ops.js scenario-run-artifacts --run <run-id>
node packages/tui/src/cli/spore-ops.js scenario-rerun --run <run-id>
node packages/tui/src/cli/spore-ops.js scenario-trends --scenario backend-service-delivery
node packages/tui/src/cli/spore-ops.js regression-list
node packages/tui/src/cli/spore-ops.js regression-run --regression local-fast
node packages/tui/src/cli/spore-ops.js regression-run-show --run <run-id>
node packages/tui/src/cli/spore-ops.js regression-report --run <run-id>
node packages/tui/src/cli/spore-ops.js regression-rerun --run <run-id>
node packages/tui/src/cli/spore-ops.js regression-trends --regression local-fast
node packages/tui/src/cli/spore-ops.js regression-scheduler-status
node packages/tui/src/cli/spore-ops.js work-item-create --title "CLI verification work item" --kind scenario --scenario cli-verification-pass
node packages/tui/src/cli/spore-ops.js work-item-list
node packages/tui/src/cli/spore-ops.js work-item-run --item <work-item-id> --stub
node packages/tui/src/cli/spore-ops.js work-item-run-show --run <work-item-run-id>
node packages/tui/src/cli/spore-ops.js hold --execution e2e-review-001 --reason "Operator hold"
node packages/tui/src/cli/spore-ops.js review --execution e2e-review-001 --status approved --comments "Ready"
```

## Coverage

The TUI/CLI operator surface now provides:

- a dashboard over session state and recent events,
- per-session inspection with tmux pane capture when available,
- rooted execution tree inspection over orchestrator HTTP read surfaces,
- rooted family inspection and family governance actions,
- audit log inspection over `/executions/:id/audit`,
- policy diff inspection over `/executions/:id/policy-diff`,
- combined execution history inspection over `/executions/:id/history`,
- aggregate run-center inspection over `/run-center/summary`,
- scenario and regression catalog inspection over orchestrator HTTP surfaces,
- scenario and regression run inspection by durable run id,
- scenario and regression rerun and trend inspection over orchestrator HTTP surfaces,
- scenario and regression launch actions over orchestrator HTTP surfaces,
- family-level actions over `/executions/:id/tree/*` for:
  - `drive`
  - `pause`
  - `hold`
  - `resume`
  - `review`
  - `approval`

## Runtime Contract

Set `SPORE_ORCHESTRATOR_ORIGIN` when the orchestrator service is not running on `http://127.0.0.1:8789`, or pass `--api http://127.0.0.1:8789`.

The terminal operator surface intentionally consumes orchestrator HTTP surfaces instead of reading workflow SQLite files directly. That keeps CLI/TUI behavior aligned with the web client and future automation clients.

Recent operator commands also expose richer validation surfaces:

- `run-center` now includes aggregate alerts, recommendations, latest reports, and trend/failure drilldown helpers when the backend provides them.
- `regression-latest-report --regression <id>` returns the latest durable report pointer for one regression profile.
- `regression-scheduler-status` returns the read-only scheduler status summary and latest scheduled-run pointers for all regression profiles.
- `work-item-*` commands expose the same managed self-work model as the orchestrator HTTP surface, so terminal operators can create, inspect, and run durable work items without bypassing orchestration state.
