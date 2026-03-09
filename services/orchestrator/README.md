# `services/orchestrator`

This service now exposes the first HTTP entrypoint for workflow planning, durable execution inspection, and governance transitions.

Workflow plan and invoke requests now honor merged domain policy from:

- `config/domains/<id>.yaml`
- the matching `activeDomains[]` project entry
- any referenced `config/policy-packs/*.yaml`

Those policies currently shape default roles, per-role max attempts, reviewer review and approval requirements, session mode, step watchdog defaults, and docs-kb startup retrieval.

Workflow templates may also define `stepSets`, which the service exposes back through plan/invoke payloads as per-launch `wave`, `waveName`, and `workflowPolicy.waveGate` metadata.

## Current Endpoints

- `GET /health`
- `GET /executions`
- `GET /executions/:id`
- `GET /executions/:id/children`
- `GET /executions/:id/tree`
- `GET /coordination-groups`
- `GET /coordination-groups/:id`
- `GET /executions/:id/events`
- `GET /executions/:id/escalations`
- `GET /run-center/summary`
- `GET /self-build/dashboard`
- `GET /self-build/summary`
- `GET /scenarios/:id/trends`
- `GET /scenario-runs/:runId`
- `GET /scenario-runs/:runId/artifacts`
- `GET /regressions/:id/trends`
- `GET /regressions/:id/latest-report`
- `GET /regressions/scheduler/status`
- `GET /regression-runs/:runId`
- `GET /regression-runs/:runId/report`
- `GET /work-item-templates`
- `GET /work-item-templates/:id`
- `GET /goal-plans`
- `POST /goals/plan`
- `GET /goal-plans/:id`
- `POST /goal-plans/:id/materialize`
- `GET /work-item-groups`
- `GET /work-item-groups/:id`
- `POST /work-item-groups/:id/run`
- `GET /work-items`
- `GET /work-items/:id`
- `GET /work-items/:id/runs`
- `GET /work-item-runs/:runId`
- `POST /work-item-runs/:runId/rerun`
- `GET /work-item-runs/:runId/workspace`
- `GET /work-item-runs/:runId/proposal`
- `POST /work-item-runs/:runId/validate`
- `GET /work-item-runs/:runId/doc-suggestions`
- `GET /proposal-artifacts/:id`
- `POST /proposal-artifacts/:id/review`
- `POST /proposal-artifacts/:id/approval`
- `GET /workspaces`
- `GET /workspaces/:id`
- `POST /workspaces/:id/reconcile`
- `POST /workspaces/:id/cleanup`
- `GET /executions/:id/workspaces`
- `GET /stream/executions?execution=:id`
- `POST /projects/plan`
- `POST /projects/invoke`
- `POST /promotions/plan`
- `POST /promotions/invoke`
- `POST /workflows/plan`
- `POST /workflows/invoke`
- `POST /executions/:id/drive`
- `POST /executions/:id/tree/drive`
- `POST /executions/:id/tree/pause`
- `POST /executions/:id/tree/hold`
- `POST /executions/:id/tree/resume`
- `POST /executions/:id/tree/review`
- `POST /executions/:id/tree/approval`
- `POST /coordination-groups/:id/drive`
- `POST /executions/:id/branches`
- `POST /executions/:id/review`
- `POST /executions/:id/approval`
- `POST /executions/:id/pause`
- `POST /executions/:id/hold`
- `POST /executions/:id/resume`
- `POST /executions/:id/escalations/:escalationId/resolve`
- `POST /work-items`
- `POST /work-items/:id/run`

## Run

```bash
npm run orchestrator:start
```

Examples:

```bash
curl -X POST http://127.0.0.1:8789/workflows/plan \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead"],"objective":"Plan check"}'

curl -X POST http://127.0.0.1:8789/workflows/plan \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","maxRoles":4,"objective":"Inspect merged domain policy defaults"}'

curl -X POST http://127.0.0.1:8789/workflows/invoke \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead"],"objective":"Run check","wait":false}'

curl http://127.0.0.1:8789/executions

curl http://127.0.0.1:8789/executions/branch-review-001/children

curl http://127.0.0.1:8789/executions/branch-review-001/tree

curl http://127.0.0.1:8789/coordination-groups

curl http://127.0.0.1:8789/coordination-groups/branch-review-001

curl http://127.0.0.1:8789/executions/branch-approval-001/events

curl http://127.0.0.1:8789/executions/branch-review-001/escalations

curl -N http://127.0.0.1:8789/stream/executions?execution=branch-approval-001

curl http://127.0.0.1:8789/run-center/summary
curl http://127.0.0.1:8789/self-build/dashboard
curl http://127.0.0.1:8789/self-build/summary
curl http://127.0.0.1:8789/work-item-templates
curl http://127.0.0.1:8789/work-item-templates/operator-ui-pass
curl -X POST http://127.0.0.1:8789/goals/plan \
  -H 'content-type: application/json' \
  -d '{"goal":"Stabilize CLI verification and proposal quality","projectId":"spore","mode":"supervised","safeMode":true}'
curl http://127.0.0.1:8789/goal-plans
curl -X POST http://127.0.0.1:8789/goal-plans/<plan-id>/materialize \
  -H 'content-type: application/json' \
  -d '{"by":"operator","source":"curl"}'
curl http://127.0.0.1:8789/work-item-groups
curl -X POST http://127.0.0.1:8789/work-item-groups/<group-id>/run \
  -H 'content-type: application/json' \
  -d '{"stub":true,"wait":true}'

curl http://127.0.0.1:8789/regressions/scheduler/status

curl -X POST http://127.0.0.1:8789/work-items \
  -H 'content-type: application/json' \
  -d '{"title":"CLI verification work item","kind":"scenario","metadata":{"scenarioId":"cli-verification-pass","projectPath":"config/projects/spore.yaml"}}'

curl http://127.0.0.1:8789/work-items

curl http://127.0.0.1:8789/work-items/<id>/runs

curl -X POST http://127.0.0.1:8789/work-items/<id>/run \
  -H 'content-type: application/json' \
  -d '{"stub":true,"wait":true}'

curl -X POST http://127.0.0.1:8789/work-item-runs/<run-id>/rerun \
  -H 'content-type: application/json' \
  -d '{"by":"operator","source":"curl"}'

curl http://127.0.0.1:8789/work-item-runs/<run-id>/workspace

curl http://127.0.0.1:8789/workspaces
curl -X POST http://127.0.0.1:8789/workspaces/<workspace-id>/reconcile
curl -X POST http://127.0.0.1:8789/workspaces/<workspace-id>/cleanup -H 'content-type: application/json' -d '{"force":true}'
curl http://127.0.0.1:8789/executions/<execution-id>/workspaces

curl -X POST http://127.0.0.1:8789/projects/plan \
  -H 'content-type: application/json' \
  -d '{"project":"config/projects/example-project.yaml","domains":["backend","frontend"]}'

curl -X POST http://127.0.0.1:8789/projects/invoke \
  -H 'content-type: application/json' \
  -d '{"project":"config/projects/example-project.yaml","domains":["backend","frontend"],"objective":"Coordinate backend and frontend work for one project.","wait":true,"stub":true,"timeout":25000,"interval":250}'

curl -X POST http://127.0.0.1:8789/executions/<coordinator-root-execution-id>/tree/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve project root family reviews"}'

curl -X POST http://127.0.0.1:8789/executions/<coordinator-root-execution-id>/tree/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve project root family approvals"}'

curl -X POST http://127.0.0.1:8789/promotions/plan \
  -H 'content-type: application/json' \
  -d '{"execution":"<coordinator-root-execution-id>","targetBranch":"main"}'

curl -X POST http://127.0.0.1:8789/promotions/invoke \
  -H 'content-type: application/json' \
  -d '{"execution":"<coordinator-root-execution-id>","targetBranch":"main","wait":true,"stub":true,"timeout":25000,"interval":250}'

curl -X POST http://127.0.0.1:8789/work-item-runs/<run-id>/validate \
  -H 'content-type: application/json' \
  -d '{"stub":true,"source":"curl"}'

curl http://127.0.0.1:8789/work-item-runs/<run-id>/doc-suggestions

curl http://127.0.0.1:8789/work-item-runs/<run-id>/proposal

curl http://127.0.0.1:8789/proposal-artifacts/<proposal-id>

curl -X POST http://127.0.0.1:8789/proposal-artifacts/<proposal-id>/review \
  -H 'content-type: application/json' \
  -d '{"status":"reviewed","by":"operator","comments":"Reviewed in operator loop."}'

curl -X POST http://127.0.0.1:8789/proposal-artifacts/<proposal-id>/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","by":"operator","comments":"Approved for merge."}'

curl -X POST http://127.0.0.1:8789/coordination-groups/branch-review-001/drive \
  -H 'content-type: application/json' \
  -d '{"wait":true,"timeout":180000,"interval":1000}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/tree/drive \
  -H 'content-type: application/json' \
  -d '{"wait":true,"timeout":180000,"interval":1000}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/tree/hold \
  -H 'content-type: application/json' \
  -d '{"reason":"Hold whole family","owner":"operator","guidance":"Resume after review"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/tree/resume \
  -H 'content-type: application/json' \
  -d '{"comments":"Resume whole family"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/tree/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve pending family reviews"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/tree/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve pending family approvals"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/branches \
  -H 'content-type: application/json' \
  -d '{"branches":[{"roles":["builder","tester"]},{"roles":["scout","reviewer"]}]}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Accepted by operator"}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Final approval"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/escalations/<id>/resolve \
  -H 'content-type: application/json' \
  -d '{"resume":true,"comments":"Resume after escalation"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/pause \
  -H 'content-type: application/json' \
  -d '{"reason":"Operator pause"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/hold \
  -H 'content-type: application/json' \
  -d '{"reason":"Waiting for grouped work"}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/resume \
  -H 'content-type: application/json' \
  -d '{"comments":"Resume after operator hold"}'
```

`POST /workflows/plan` returns `invocation.effectivePolicy` plus `invocation.launches[].policy`. `POST /workflows/invoke` returns the same invocation payload alongside execution creation and drive detail, so clients can inspect the exact merged domain policy that was applied.

`POST /projects/plan` and `POST /projects/invoke` are the additive project-root coordination surfaces. They model the explicit `orchestrator -> coordinator -> lead` path without prepending project-scoped roles to existing domain workflow role lists.

`POST /promotions/plan` and `POST /promotions/invoke` are the additive promotion surfaces. They model the explicit `coordinator -> integrator` lane, require durable promotion source artifacts, and default approved results to `promotion_candidate` rather than merge-to-main behavior.

When a workflow uses `stepSets`, the service also returns:

- `launches[].wave`
- `launches[].waveName`
- `launches[].policy.workflowPolicy.waveGate`

`GET /executions/:id/tree` returns the rooted execution family, not just the selected execution. This is the preferred read surface for lineage-aware clients because it makes parent/child ancestry explicit instead of forcing the client to reconstruct hierarchy from flat group payloads.

This remains a bootstrap orchestration surface, not the final durable orchestrator service. The current API already separates:

- execution reads,
- coordination-group reads,
- governance actions,
- workflow-level interruption/recovery actions.

Clients should keep treating lineage and coordination metadata as additive fields while the grouped-execution contract continues to harden.

The service also now carries the first durable `work-item` model for supervised self-work. A work item is a stable operator-managed unit that can launch a named scenario, regression, or workflow path while leaving a durable run trail in orchestrator state.
