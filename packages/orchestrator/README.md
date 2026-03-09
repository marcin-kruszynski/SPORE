# `packages/orchestrator`

This package now owns the first workflow-planning and workflow-invocation slice for SPORE.

## Current Capability

- read workflow and project config,
- merge domain defaults from `config/domains/*.yaml` with matching project `activeDomains[]` policy overrides,
- merge reusable presets from `config/policy-packs/*.yaml` into those domain and project policy layers,
- resolve per-role profile config with domain-aware fallback,
- generate invocation plans with stable session ids and run ids,
- translate workflow `stepSets` into durable per-step wave assignments and wave gates,
- create invocation brief files under `tmp/orchestrator/`,
- launch runtime sessions through `packages/runtime-pi/`,
- persist executions, steps, reviews, approvals, workflow events, and escalations in SQLite,
- drive ordered multi-session execution until a governance or terminal state,
- track parent/child execution lineage and coordination-group membership as durable metadata,
- expose execution children and coordination-group summaries for operator consumers,
- expose explicit execution tree payloads rooted at the family ancestor execution,
- stop at `waiting_review` and `waiting_approval`,
- record operator review and approval decisions,
- branch into retry/rework paths when review or approval requests changes,
- fork child executions into a coordination-aware execution family,
- spawn multiple child branches under one execution in a single operator call,
- open escalation records when retry budgets are exhausted,
- allow operators to resolve an escalation and resume an execution without manual database edits,
- allow operators to pause, hold, resume, and drive either a single execution or a coordination group,
- allow operators to pause, hold, resume, drive, review, and approve an entire rooted execution family,
- seed each launch with policy-backed defaults for roles, attempts, reviewer governance, session mode, watchdog thresholds, and docs-kb startup retrieval.

## Domain Policy Inputs

Current orchestrator planning reads two domain policy sources:

- `config/domains/<id>.yaml` for reusable domain defaults,
- the matching `activeDomains[]` entry in the selected project for project-specific overrides.

Supported policy blocks are:

- `workflowPolicy`: `defaultRoles`, `defaultMaxAttempts`, `maxAttemptsByRole`, `stepSoftTimeoutMs`, `stepHardTimeoutMs`, `reviewRequired`, `approvalRequired`
- workflow templates may also declare `stepSets`, which the planner converts into per-step `wave`, `waveName`, and `workflowPolicy.waveGate` metadata for parallel launch inside one execution.
- `runtimePolicy`: `sessionModeByRole`
- `docsKbPolicy`: `resultLimit`, `queryTerms`, optional `queryTemplate`

Reusable policy packs can contribute to those same merged blocks before the raw domain and project overrides are applied.

Current behavior is:

- explicit `--roles` overrides `workflowPolicy.defaultRoles`,
- otherwise `defaultRoles` falls back to the workflow template `roleSequence`,
- `maxAttemptsByRole` overrides `defaultMaxAttempts`, which falls back to the workflow retry policy,
- reviewer steps inherit `reviewRequired` and `approvalRequired` from merged policy,
- `sessionModeByRole` overrides the profile `sessionMode` for that launch,
- `docsKbPolicy` shapes the startup retrieval query and result limit passed to `packages/runtime-pi/`,
- `stepSoftTimeoutMs` and `stepHardTimeoutMs` become the default watchdog thresholds unless a drive or invoke command overrides them.

## Execution State Model

- execution states: `planned`, `running`, `waiting_review`, `waiting_approval`, `paused`, `held`, `completed`, `failed`, `rejected`, `canceled`
- step states: `planned`, `active`, `completed`, `review_pending`, `approval_pending`, `failed`, `stopped`, `rejected`

Recommended interpretation:

- `waiting_review` and `waiting_approval` are governance stop states,
- `paused` is an operator-directed interruption,
- `held` is a recoverable blocked state, often used for coordination or dependency waiting,
- terminal outcomes remain `completed`, `failed`, `rejected`, and `canceled`.

## Read Surfaces

- `show --execution <id>` returns execution detail with steps, sessions, reviews, approvals, events, and escalations.
- `children --execution <id>` returns known child executions for lineage-aware tooling.
- `tree --execution <id>` returns the rooted execution graph for lineage-aware tooling.
- `groups` returns known coordination-group summaries.
- `group --group <id>` returns group detail with grouped executions.
- `events --execution <id>` returns only workflow events for timeline consumers.
- `escalations --execution <id>` returns only escalation records for operator consumers.
- `history --execution <id>` returns one combined execution history payload with timeline, governance, audit, wave summary, and policy diff.
- `run-center` returns one aggregate operator summary for scenario catalog health, regression catalog health, and recent durable runs.
- `run-center` now also carries additive `alerts[]` and `recommendations[]` so thin clients can render operator triage without reconstructing it locally.
- `scenario-list`, `scenario-show`, `scenario-runs`, and `scenario-run` expose the machine-readable scenario catalog and durable scenario runs backed by `config/scenarios/`.
- `scenario-run-show --run <id>` returns one durable scenario run by run id.
- `scenario-run-show --run <id>` includes additive `failure` and `suggestedActions` fields for operator triage.
- `scenario-run-artifacts --run <id>` returns normalized artifact summaries for that scenario run.
- `scenario-rerun --run <id>` creates a new durable scenario run linked back to the original run.
- `scenario-trends --scenario <id>` returns pass-rate, duration, and streak summaries across durable scenario runs.
- `regression-list`, `regression-show`, `regression-runs`, and `regression-run` expose reusable regression profiles and durable run history backed by `config/regressions/`.
- `regression-run-show --run <id>` returns one durable regression run by run id.
- `regression-run-show --run <id>` includes additive `failure` and `suggestedActions` fields for operator triage.
- `regression-report --run <id>` returns report metadata, top failure reasons, and suggested actions for one durable regression run.
- `regression-latest-report --regression <id>` returns the latest durable report pointer together with report/trend drilldown helpers for one regression profile.
- `regression-rerun --run <id>` creates a new durable regression run linked back to the original run.
- `regression-trends --regression <id>` returns pass-rate, duration, and streak summaries across durable regression runs.
- `regression-scheduler-status` returns the read-only scheduler status summary and latest scheduled-run pointers without abusing the scheduler run mutation route as a status check.
- `self-build-summary` returns one top-level summary of goal plans, groups, work items, runs, proposals, and evaluation/doc-suggestion readiness.
- `work-item-template-list` and `work-item-template-show --template <id>` expose reusable work-item creation templates from `config/work-item-templates/`.
- `goal-plan-create`, `goal-plan-list`, `goal-plan-show --plan <id>`, and `goal-plan-materialize --plan <id>` expose durable goal planning and plan-to-group materialization.
- `work-item-group-list`, `work-item-group-show --group <id>`, and `work-item-group-run --group <id>` expose grouped managed-work execution.
- `work-item-list`, `work-item-show`, `work-item-create`, `work-item-run`, and `work-item-run-show` expose the first durable managed self-work surface for SPORE itself.
- `work-item-runs --item <id>` exposes durable run history for one managed work item.
- `workspace-list` and `workspace-show --workspace <id>` (or `--run <work-item-run-id>`) expose durable worktree allocation state for mutating self-work.
- `work-item-validate --run <id>` records durable validation/evaluation artifacts for one managed run.
- `work-item-doc-suggestions --run <id>` returns persisted documentation follow-up suggestions for one managed run.
- `proposal-show --proposal <id>` (or `--run <work-item-run-id>`) exposes durable proposal artifact summary.
- `proposal-review --proposal <id> --status <ready_for_review|reviewed|rejected>` records proposal review state transitions.
- `proposal-approve --proposal <id> --status <approved|rejected>` records proposal approval state transitions.
- `scenario-run-artifacts --run <id>` returns a normalized execution/session artifact summary for one scenario run.
- `drive-group --group <id>` reconciles grouped executions until they settle or reach a governance/blocked stop.
- `drive-tree --execution <id>` resolves the execution root and drives the whole family through its coordination group.
- `spawn-branches --execution <id> --branches-json <json>` creates multiple child branches under one parent execution.
- `resolve-escalation --execution <id> --escalation <id> [--resume]` resolves an open escalation and can requeue the affected step.
- `pause --execution <id>`, `hold --execution <id>`, and `resume --execution <id>` expose durable workflow-level interruption controls.
- `pause-tree --execution <id>`, `hold-tree --execution <id>`, and `resume-tree --execution <id>` apply those controls across the rooted execution family.
- `review-tree --execution <id>` and `approve-tree --execution <id>` apply governance decisions across pending descendants in the rooted execution family.

`plan` and `invoke` also return:

- `invocation.effectivePolicy` for the merged execution-level policy,
- `invocation.launches[].policy` for the per-step launch policy persisted with each step.
- `invocation.launches[].wave` and `waveName` for the step-set-derived execution wave,
- `invocation.launches[].policy.workflowPolicy.waveGate` for the unlock rule attached to that wave.

## Run

```bash
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --max-roles 4
npm run orchestrator:invoke -- --domain backend --roles lead --objective "Validate runtime wiring"
npm run orchestrator:fork -- --execution branch-review-001 --roles lead,reviewer --objective "Run child branch"
npm run orchestrator:tree -- --execution branch-review-001
npm run orchestrator:drive -- --execution e2e-review-001 --wait
npm run orchestrator:drive-group -- --group branch-review-001 --wait
npm run orchestrator:drive-tree -- --execution branch-review-001 --wait
npm run orchestrator:pause -- --execution branch-review-001 --reason "Operator pause"
npm run orchestrator:pause-tree -- --execution branch-review-001 --reason "Pause whole family"
npm run orchestrator:hold -- --execution branch-review-001 --reason "Waiting for grouped work"
npm run orchestrator:hold-tree -- --execution branch-review-001 --reason "Hold whole family"
npm run orchestrator:resume -- --execution branch-review-001 --comments "Resume after coordination barrier"
npm run orchestrator:resume-tree -- --execution branch-review-001 --comments "Resume whole family"
npm run orchestrator:spawn-branches -- --execution branch-review-001 --branches-json '[{"roles":["builder","tester"]},{"roles":["scout","reviewer"]}]'
npm run orchestrator:review -- --execution e2e-review-001 --status approved
npm run orchestrator:approve -- --execution e2e-review-001 --status approved
npm run orchestrator:review-tree -- --execution branch-review-001 --status approved
npm run orchestrator:approve-tree -- --execution branch-review-001 --status approved
npm run orchestrator:resolve-escalation -- --execution branch-review-001 --escalation <id> --resume
npm run orchestrator:history -- --execution branch-review-001
npm run orchestrator:scenario-list
npm run orchestrator:scenario-run -- --scenario cli-verification-pass --stub
npm run orchestrator:scenario-run-show -- --run <run-id>
npm run orchestrator:scenario-run-artifacts -- --run <run-id>
npm run orchestrator:scenario-rerun -- --run <run-id>
npm run orchestrator:scenario-trends -- --scenario backend-service-delivery
npm run orchestrator:run-center
npm run orchestrator:self-build-summary
npm run orchestrator:regression-run -- --regression local-fast --stub
npm run orchestrator:regression-run-show -- --run <run-id>
npm run orchestrator:regression-report -- --run <run-id>
npm run orchestrator:regression-latest-report -- --regression local-fast
npm run orchestrator:regression-rerun -- --run <run-id>
npm run orchestrator:regression-trends -- --regression local-fast
npm run orchestrator:work-item-template-list
npm run orchestrator:work-item-template-show -- --template operator-ui-pass
npm run orchestrator:goal-plan-create -- --goal "Stabilize CLI verification and proposal quality"
npm run orchestrator:goal-plan-list
npm run orchestrator:goal-plan-show -- --plan <goal-plan-id>
npm run orchestrator:goal-plan-materialize -- --plan <goal-plan-id>
npm run orchestrator:work-item-group-list
npm run orchestrator:work-item-group-show -- --group <group-id>
npm run orchestrator:work-item-group-run -- --group <group-id> --stub
npm run orchestrator:work-item-create -- --template operator-ui-pass
npm run orchestrator:work-item-list
npm run orchestrator:work-item-show -- --item <work-item-id>
npm run orchestrator:work-item-runs -- --item <work-item-id>
npm run orchestrator:work-item-run -- --item <work-item-id> --stub
npm run orchestrator:work-item-run-show -- --run <work-item-run-id>
npm run orchestrator:workspace-show -- --run <work-item-run-id>
npm run orchestrator:work-item-validate -- --run <work-item-run-id> --stub
npm run orchestrator:work-item-doc-suggestions -- --run <work-item-run-id>
npm run orchestrator:proposal-show -- --run <work-item-run-id>
npm run orchestrator:proposal-review -- --proposal <proposal-id> --status reviewed
npm run orchestrator:proposal-approve -- --proposal <proposal-id> --status approved
```

Planning without `--roles` is the easiest way to inspect domain-policy defaults in the returned `effectivePolicy` and `launches[]`.

This is still a narrow bootstrap slice, not the final orchestrator policy engine. The current model is intentionally durable-first: group membership, lineage, pause/hold state, and recovery history should live in orchestrator state rather than only in runtime artifacts.
