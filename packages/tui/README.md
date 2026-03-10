# `packages/tui`

This package contains a lightweight terminal operator surface for SPORE.

## Current Commands

```bash
npx tsx packages/tui/src/cli/spore-ops.ts dashboard
npx tsx packages/tui/src/cli/spore-ops.ts dashboard --watch
npx tsx packages/tui/src/cli/spore-ops.ts inspect --session lead-session-002
npx tsx packages/tui/src/cli/spore-ops.ts execution --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts tree --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts family --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts audit --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts policy-diff --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts history --execution e2e-review-001
npx tsx packages/tui/src/cli/spore-ops.ts run-center
npx tsx packages/tui/src/cli/spore-ops.ts self-build-summary
npx tsx packages/tui/src/cli/spore-ops.ts self-build-dashboard
npx tsx packages/tui/src/cli/spore-ops.ts self-build-loop-status
npx tsx packages/tui/src/cli/spore-ops.ts work-item-queue
npx tsx packages/tui/src/cli/spore-ops.ts scenario-list
npx tsx packages/tui/src/cli/spore-ops.ts scenario-run --scenario cli-verification-pass
npx tsx packages/tui/src/cli/spore-ops.ts scenario-run-show --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts scenario-run-artifacts --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts scenario-rerun --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts scenario-trends --scenario backend-service-delivery
npx tsx packages/tui/src/cli/spore-ops.ts regression-list
npx tsx packages/tui/src/cli/spore-ops.ts regression-run --regression local-fast
npx tsx packages/tui/src/cli/spore-ops.ts regression-run-show --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts regression-report --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts regression-rerun --run <run-id>
npx tsx packages/tui/src/cli/spore-ops.ts regression-trends --regression local-fast
npx tsx packages/tui/src/cli/spore-ops.ts regression-scheduler-status
npx tsx packages/tui/src/cli/spore-ops.ts work-item-template-list
npx tsx packages/tui/src/cli/spore-ops.ts work-item-template-show --template operator-ui-pass
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-create --goal "Stabilize CLI verification and proposal quality"
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-list
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-show --plan <goal-plan-id>
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-history --plan <goal-plan-id>
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-edit --plan <goal-plan-id> --file <edited-plan.json>
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-review --plan <goal-plan-id> --status reviewed
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-materialize --plan <goal-plan-id>
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-run --plan <goal-plan-id> --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-list
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-show --group <group-id>
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-run --group <group-id> --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-retry-downstream --group <group-id> --reason "Retry blocked downstream items"
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-validate-bundle --group <group-id> --bundle proposal-ready-fast --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-create --title "CLI verification work item" --kind scenario --scenario cli-verification-pass
npx tsx packages/tui/src/cli/spore-ops.ts work-item-list
npx tsx packages/tui/src/cli/spore-ops.ts work-item-show --item <work-item-id>
npx tsx packages/tui/src/cli/spore-ops.ts work-item-runs --item <work-item-id>
npx tsx packages/tui/src/cli/spore-ops.ts work-item-run --item <work-item-id> --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-run-show --run <work-item-run-id>
npx tsx packages/tui/src/cli/spore-ops.ts work-item-run-rerun --run <work-item-run-id>
npx tsx packages/tui/src/cli/spore-ops.ts workspace-list
npx tsx packages/tui/src/cli/spore-ops.ts workspace-show --workspace <workspace-id>
npx tsx packages/tui/src/cli/spore-ops.ts work-item-validate --run <work-item-run-id> --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-validate-bundle --run <work-item-run-id> --bundle proposal-ready-fast --stub
npx tsx packages/tui/src/cli/spore-ops.ts work-item-doc-suggestions --run <work-item-run-id>
npx tsx packages/tui/src/cli/spore-ops.ts self-build-learnings
npx tsx packages/tui/src/cli/spore-ops.ts self-build-doc-suggestions --run <work-item-run-id>
npx tsx packages/tui/src/cli/spore-ops.ts self-build-intake --project spore
npx tsx packages/tui/src/cli/spore-ops.ts self-build-intake-refresh --include-accepted --project spore
npx tsx packages/tui/src/cli/spore-ops.ts doc-suggestion-show --suggestion <suggestion-id>
npx tsx packages/tui/src/cli/spore-ops.ts doc-suggestion-review --suggestion <suggestion-id> --status accepted
npx tsx packages/tui/src/cli/spore-ops.ts doc-suggestion-materialize --suggestion <suggestion-id> --safe-mode
npx tsx packages/tui/src/cli/spore-ops.ts proposal-show --run <work-item-run-id>
npx tsx packages/tui/src/cli/spore-ops.ts proposal-review-package --proposal <proposal-id>
npx tsx packages/tui/src/cli/spore-ops.ts proposal-review --proposal <proposal-id> --status reviewed
npx tsx packages/tui/src/cli/spore-ops.ts proposal-approve --proposal <proposal-id> --status approved
npx tsx packages/tui/src/cli/spore-ops.ts proposal-rework --proposal <proposal-id> --rationale "Need explicit rework"
npx tsx packages/tui/src/cli/spore-ops.ts proposal-promotion-plan --proposal <proposal-id> --target-branch main
npx tsx packages/tui/src/cli/spore-ops.ts proposal-promotion-invoke --proposal <proposal-id> --target-branch main --wait --stub
npx tsx packages/tui/src/cli/spore-ops.ts integration-branch-list
npx tsx packages/tui/src/cli/spore-ops.ts integration-branch-show --branch <branch-name>
npx tsx packages/tui/src/cli/spore-ops.ts integration-branch-quarantine --name <branch-name> --reason "Freeze unsafe candidate"
npx tsx packages/tui/src/cli/spore-ops.ts integration-branch-rollback --name <branch-name> --reason "Rollback bad integration candidate"
npx tsx packages/tui/src/cli/spore-ops.ts self-build-decisions
npx tsx packages/tui/src/cli/spore-ops.ts self-build-quarantine --status active
npx tsx packages/tui/src/cli/spore-ops.ts self-build-rollback
npx tsx packages/tui/src/cli/spore-ops.ts goal-plan-quarantine --plan <goal-plan-id> --reason "Unsafe autonomous plan"
npx tsx packages/tui/src/cli/spore-ops.ts self-build-quarantine-release --quarantine <quarantine-id> --reason "Operator release"
npx tsx packages/tui/src/cli/spore-ops.ts self-build-loop-start --mode supervised
npx tsx packages/tui/src/cli/spore-ops.ts self-build-loop-stop --reason "Stop after one iteration"
npx tsx packages/tui/src/cli/spore-ops.ts project-plan --project config/projects/example-project.yaml --domains backend,frontend
npx tsx packages/tui/src/cli/spore-ops.ts project-invoke --project config/projects/example-project.yaml --domains backend,frontend --objective "Coordinate backend and frontend work for one project." --wait --stub
npx tsx packages/tui/src/cli/spore-ops.ts promotion-plan --execution <coordinator-root-execution-id> --target-branch main
npx tsx packages/tui/src/cli/spore-ops.ts promotion-invoke --execution <coordinator-root-execution-id> --target-branch main --wait --stub
npx tsx packages/tui/src/cli/spore-ops.ts hold --execution e2e-review-001 --reason "Operator hold"
npx tsx packages/tui/src/cli/spore-ops.ts review --execution e2e-review-001 --status approved --comments "Ready"
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
- self-build summary inspection for plan/group/work-item/proposal progress snapshots,
- dedicated self-build dashboard inspection with queue and workspace visibility,
- explicit self-build loop inspection and control,
- autonomous decision, quarantine, and rollback inspection plus release controls,
- work-item template and goal-plan management from the same orchestrator API contract,
- editable goal-plan review before materialization,
- grouped managed-work inspection and grouped run execution controls,
- grouped recovery controls and named validation-bundle execution for managed work,
- work-item rerun and workspace inspection parity over orchestrator HTTP surfaces,
- work-item run validation and documentation-suggestion drilldowns,
- durable learning, doc-suggestion, and autonomous-intake queue inspection,
- doc-suggestion review/materialization and proposal rework controls,
- proposal artifact inspection plus review/approval transitions,
- explicit project coordination planning and invocation over the coordinator-root path,
- explicit feature promotion planning and invocation over the integrator lane,
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
- `project-*` and `promotion-*` commands expose the coordinator-root and integrator-specific planner/invoker paths without changing the semantics of existing lead-first domain workflows.
