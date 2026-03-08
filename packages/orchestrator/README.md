# `packages/orchestrator`

This package now owns the first workflow-planning and workflow-invocation slice for SPORE.

## Current Capability

- read workflow and project config,
- merge domain defaults from `config/domains/*.yaml` with matching project `activeDomains[]` policy overrides,
- resolve per-role profile config with domain-aware fallback,
- generate invocation plans with stable session ids and run ids,
- create invocation brief files under `tmp/orchestrator/`,
- launch runtime sessions through `packages/runtime-pi/`,
- persist executions, steps, reviews, approvals, workflow events, and escalations in SQLite,
- drive ordered multi-session execution until a governance or terminal state,
- track parent/child execution lineage and coordination-group membership as durable metadata,
- expose execution children and coordination-group summaries for operator consumers,
- stop at `waiting_review` and `waiting_approval`,
- record operator review and approval decisions,
- branch into retry/rework paths when review or approval requests changes,
- fork child executions into a coordination-aware execution family,
- open escalation records when retry budgets are exhausted,
- allow operators to resolve an escalation and resume an execution without manual database edits,
- allow operators to pause, hold, resume, and drive either a single execution or a coordination group,
- seed each launch with policy-backed defaults for roles, attempts, reviewer governance, session mode, watchdog thresholds, and docs-kb startup retrieval.

## Domain Policy Inputs

Current orchestrator planning reads two domain policy sources:

- `config/domains/<id>.yaml` for reusable domain defaults,
- the matching `activeDomains[]` entry in the selected project for project-specific overrides.

Supported policy blocks are:

- `workflowPolicy`: `defaultRoles`, `defaultMaxAttempts`, `maxAttemptsByRole`, `stepSoftTimeoutMs`, `stepHardTimeoutMs`, `reviewRequired`, `approvalRequired`
- `runtimePolicy`: `sessionModeByRole`
- `docsKbPolicy`: `resultLimit`, `queryTerms`, optional `queryTemplate`

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
- `groups` returns known coordination-group summaries.
- `group --group <id>` returns group detail with grouped executions.
- `events --execution <id>` returns only workflow events for timeline consumers.
- `escalations --execution <id>` returns only escalation records for operator consumers.
- `drive-group --group <id>` reconciles grouped executions until they settle or reach a governance/blocked stop.
- `resolve-escalation --execution <id> --escalation <id> [--resume]` resolves an open escalation and can requeue the affected step.
- `pause --execution <id>`, `hold --execution <id>`, and `resume --execution <id>` expose durable workflow-level interruption controls.

`plan` and `invoke` also return:

- `invocation.effectivePolicy` for the merged execution-level policy,
- `invocation.launches[].policy` for the per-step launch policy persisted with each step.

## Run

```bash
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --max-roles 4
npm run orchestrator:invoke -- --domain backend --roles lead --objective "Validate runtime wiring"
npm run orchestrator:fork -- --execution branch-review-001 --roles lead,reviewer --objective "Run child branch"
npm run orchestrator:drive -- --execution e2e-review-001 --wait
npm run orchestrator:drive-group -- --group branch-review-001 --wait
npm run orchestrator:pause -- --execution branch-review-001 --reason "Operator pause"
npm run orchestrator:hold -- --execution branch-review-001 --reason "Waiting for grouped work"
npm run orchestrator:resume -- --execution branch-review-001 --comments "Resume after coordination barrier"
npm run orchestrator:review -- --execution e2e-review-001 --status approved
npm run orchestrator:approve -- --execution e2e-review-001 --status approved
npm run orchestrator:resolve-escalation -- --execution branch-review-001 --escalation <id> --resume
```

Planning without `--roles` is the easiest way to inspect domain-policy defaults in the returned `effectivePolicy` and `launches[]`.

This is still a narrow bootstrap slice, not the final orchestrator policy engine. The current model is intentionally durable-first: group membership, lineage, pause/hold state, and recovery history should live in orchestrator state rather than only in runtime artifacts.
