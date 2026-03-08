# `services/orchestrator`

This service now exposes the first HTTP entrypoint for workflow planning, durable execution inspection, and governance transitions.

Workflow plan and invoke requests now honor merged domain policy from:

- `config/domains/<id>.yaml`
- the matching `activeDomains[]` project entry

Those policies currently shape default roles, per-role max attempts, reviewer review and approval requirements, session mode, step watchdog defaults, and docs-kb startup retrieval.

## Current Endpoints

- `GET /health`
- `GET /executions`
- `GET /executions/:id`
- `GET /executions/:id/children`
- `GET /coordination-groups`
- `GET /coordination-groups/:id`
- `GET /executions/:id/events`
- `GET /executions/:id/escalations`
- `GET /stream/executions?execution=:id`
- `POST /workflows/plan`
- `POST /workflows/invoke`
- `POST /executions/:id/drive`
- `POST /coordination-groups/:id/drive`
- `POST /executions/:id/review`
- `POST /executions/:id/approval`
- `POST /executions/:id/pause`
- `POST /executions/:id/hold`
- `POST /executions/:id/resume`
- `POST /executions/:id/escalations/:escalationId/resolve`

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

curl http://127.0.0.1:8789/coordination-groups

curl http://127.0.0.1:8789/coordination-groups/branch-review-001

curl http://127.0.0.1:8789/executions/branch-approval-001/events

curl http://127.0.0.1:8789/executions/branch-review-001/escalations

curl -N http://127.0.0.1:8789/stream/executions?execution=branch-approval-001

curl -X POST http://127.0.0.1:8789/coordination-groups/branch-review-001/drive \
  -H 'content-type: application/json' \
  -d '{"wait":true,"timeout":180000,"interval":1000}'

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

This remains a bootstrap orchestration surface, not the final durable orchestrator service. The current API already separates:

- execution reads,
- coordination-group reads,
- governance actions,
- workflow-level interruption/recovery actions.

Clients should keep treating lineage and coordination metadata as additive fields while the grouped-execution contract continues to harden.
