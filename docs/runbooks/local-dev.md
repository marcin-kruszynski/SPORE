# Local Development Runbook

## Environment Baseline

Required tools:

- `node >= 24`
- `npm`
- `tmux`
- `pi` from `@mariozechner/pi-coding-agent`
- `jq`
- `sqlite3`
- `python3`
- `git`
- `rg`

## First-Time Setup

1. Clone repository.
2. Review `README.md`, `AGENTS.md`, and `docs/INDEX.md`.
3. Inspect `docs/plans/bootstrap-completion-summary.md`.
4. Install `pi` if needed:

```bash
npm install -g @mariozechner/pi-coding-agent
```

5. Authenticate `pi`:

```bash
pi
```

Then use `/login`, or export provider API keys before runtime testing.

If `pi` is installed under `nvm` but not visible in the current shell `PATH`, set:

```bash
export SPORE_PI_BIN="${SPORE_PI_BIN:-$(npm prefix -g)/bin/pi}"
```

For isolated runs, you can also redirect durable state:

```bash
export SPORE_ORCHESTRATOR_DB_PATH=/tmp/spore-orchestrator.sqlite
export SPORE_SESSION_DB_PATH=/tmp/spore-sessions.sqlite
export SPORE_EVENT_LOG_PATH=/tmp/spore-events.ndjson
```

6. Follow roadmap in `docs/roadmap/IMPLEMENTATION_ROADMAP.md`.
7. Prefer named flows from `docs/runbooks/scenario-library.md` for local validation.

## Environment Verification

Run:

```bash
node --version
npm --version
tmux -V
pi --version
jq --version
sqlite3 --version
python3 --version
rg --version
```

## Repository Verification

Run:

```bash
npm run docs-kb:index
npm run config:validate
npm run docs-kb -- search "session model"
npm run test:all-local
```

To inspect domain-policy defaults before a run, plan a workflow without explicit roles and inspect the merged policy:

```bash
npm run orchestrator:plan -- --project config/projects/example-project.yaml --domain backend --max-roles 4 \
  | jq '.invocation | {effectivePolicy, launches: [.launches[] | {role, sessionMode, maxAttempts, reviewRequired, approvalRequired, docsKbQuery: .policy.docsKbPolicy.query, docsKbLimit: .policy.docsKbPolicy.resultLimit}]}'
```

The plan should reflect `config/domains/backend.yaml` plus any matching `activeDomains[]` overrides from the project file.

## Runtime Smoke Test

Use a real PI-backed run when `pi` is configured:

```bash
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --session-id smoke-001 --run-id smoke-001
npm run session:status
npm run session:events -- --session smoke-001
npm run ops:inspect -- --session smoke-001
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

If PI is not configured yet, say so explicitly and use the stub launcher only as a temporary fallback.

Runtime artifacts from a real PI-backed run should appear under `tmp/sessions/`, including:

- `*.pi-events.jsonl`
- `*.pi-session.jsonl`
- `*.stderr.log`
- `*.transcript.md`
- `*.rpc-status.json`
- `*.control.ndjson`

## Gateway Smoke Test

Start the shared read surface:

```bash
npm run gateway:start
```

Then query:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/status
curl http://127.0.0.1:8787/sessions
curl http://127.0.0.1:8787/sessions/smoke-001/artifacts
curl http://127.0.0.1:8787/sessions/smoke-001/live
curl -N http://127.0.0.1:8787/stream/events?session=smoke-001
```

## Orchestrator Smoke Test

Start the orchestrator service:

```bash
npm run orchestrator:start
```

Plan and invoke a workflow:

```bash
curl -X POST http://127.0.0.1:8789/workflows/plan \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead"],"objective":"Plan check"}'

curl -X POST http://127.0.0.1:8789/workflows/invoke \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead"],"objective":"Run check","wait":false}'

curl http://127.0.0.1:8789/executions
curl http://127.0.0.1:8789/executions/branch-approval-001/events
curl http://127.0.0.1:8789/executions/branch-review-001/escalations
curl -N http://127.0.0.1:8789/stream/executions?execution=branch-approval-001

curl -X POST http://127.0.0.1:8789/workflows/invoke \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead","reviewer"],"objective":"Lead should return one sentence. Reviewer should return approve, revise, or reject in one sentence.","wait":true,"stepSoftTimeout":15000,"stepHardTimeout":45000}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Operator accepted reviewer verdict."}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Operator approved execution completion."}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/escalations/<id>/resolve \
  -H 'content-type: application/json' \
  -d '{"resume":true,"comments":"Resume after escalation"}'
```

When validating domain policy integration, confirm that:

- omitting `roles` lets the merged domain `workflowPolicy.defaultRoles` choose the launch order,
- step `maxAttempts`, reviewer `reviewRequired` and `approvalRequired`, and per-role `sessionMode` match the merged policy,
- startup context files under `tmp/sessions/*.context.json` use the domain docs-kb query terms and result limit,
- watchdog behavior follows the step soft and hard timeout policy unless the invoke or drive call overrides it.

If execution payloads now include lineage or coordination metadata, inspect them directly from the execution read surfaces rather than by opening SQLite files:

```bash
curl http://127.0.0.1:8789/executions
curl http://127.0.0.1:8789/executions/e2e-review-002
```

## TUI and Family Inspection

Use the terminal surface against the same orchestrator HTTP APIs as the web client:

```bash
node packages/tui/src/cli/spore-ops.js execution --execution e2e-review-002 --api http://127.0.0.1:8789
node packages/tui/src/cli/spore-ops.js family --execution e2e-review-002 --api http://127.0.0.1:8789
node packages/tui/src/cli/spore-ops.js audit --execution e2e-review-002 --api http://127.0.0.1:8789
node packages/tui/src/cli/spore-ops.js policy-diff --execution e2e-review-002 --api http://127.0.0.1:8789
```

## Canonical Scenario Runs

Use `docs/runbooks/scenario-library.md` for the stable scenario list and preferred commands. The four canonical flows are:

- backend service delivery
- frontend UI pass
- CLI verification pass
- docs ADR pass

Executable scenario and regression catalogs live in:

- `config/scenarios/*.yaml`
- `config/regressions/*.yaml`

Typical commands:

```bash
npm run orchestrator:scenario-list
npm run orchestrator:scenario-show -- --scenario backend-service-delivery
npm run orchestrator:scenario-run -- --scenario cli-verification-pass --stub
npm run orchestrator:scenario-run-show -- --run <run-id>
npm run orchestrator:scenario-run-artifacts -- --run <run-id>
npm run orchestrator:scenario-rerun -- --run <run-id>
npm run orchestrator:scenario-trends -- --scenario backend-service-delivery
npm run orchestrator:run-center
npm run orchestrator:regression-list
npm run orchestrator:regression-show -- --regression local-fast
npm run orchestrator:regression-run -- --regression local-fast --stub
npm run orchestrator:regression-run-show -- --run <run-id>
npm run orchestrator:regression-report -- --run <run-id>
npm run orchestrator:regression-rerun -- --run <run-id>
npm run orchestrator:regression-trends -- --regression local-fast
```

Live control inspection:

```bash
curl http://127.0.0.1:8787/sessions/<id>/live
curl http://127.0.0.1:8787/sessions/<id>/control-history
curl http://127.0.0.1:8787/sessions/<id>/control-status/<request-id>
```

Look for optional fields such as:

- `coordinationGroupId`
- `parentExecutionId`
- `childExecutionIds`
- `branchKey`
- `holdReason`
- `pausedAt`
- `heldAt`
- `resumedAt`

Those fields may appear incrementally as the durable execution model grows.

## Web Smoke Test

Start the browser app after gateway and orchestrator:

```bash
npm run web:start
```

Then verify the thin proxy surfaces:

```bash
curl http://127.0.0.1:8788/api/status
curl http://127.0.0.1:8788/api/orchestrator/executions
curl http://127.0.0.1:8788/api/orchestrator/executions/e2e-review-002
curl http://127.0.0.1:8788/api/orchestrator/executions/branch-approval-001/events
curl http://127.0.0.1:8788/api/orchestrator/executions/branch-review-001/escalations
curl -N http://127.0.0.1:8788/api/orchestrator/stream/executions?execution=branch-approval-001
```

When validating the browser surface for upcoming coordination-group work, confirm that:

- executions with `waiting_review` or `waiting_approval` still render as governance states,
- `paused` and `held` render as recoverable operator states rather than failures,
- lineage and coordination fields, when present, do not break list or detail rendering,
- the browser continues to rely only on `/api/*` proxy surfaces.

## Data Paths

- docs index db: `data/docs-index/`
- embeddings: `data/embeddings/`
- cache/state: `data/cache/`, `data/state/`
- runtime artifacts: `tmp/sessions/`

## Operational Notes

- Use tmux-backed sessions for inspectable runs.
- Prefer `session-manager reconcile` for detached-session cleanup.
- Prefer `services/session-gateway/` as the shared read API for clients instead of reading local state files directly.
- Prefer orchestrator execution reads and workflow event streams over inferring workflow state from runtime artifacts alone.
- Prefer changing domain defaults in `config/domains/*.yaml` and project-specific policy overlays in `config/projects/*.yaml` `activeDomains[]` rather than hard-coding run behavior elsewhere.
- When testing pause, hold, or recovery behavior, record the observed execution state and event sequence in the relevant architecture or operations docs rather than leaving that knowledge only in shell history.
