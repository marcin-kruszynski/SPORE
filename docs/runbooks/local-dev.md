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
3. Inspect `docs/plans/project-state-and-direction-handoff.md`, `docs/plans/self-build-status-and-next-steps.md`, and `docs/plans/roadmap.md`.
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

6. Follow `docs/plans/roadmap.md` for current direction. Use `docs/roadmap/IMPLEMENTATION_ROADMAP.md` only as historical bootstrap context.
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
npm run typecheck
npm run lint
npm run format:check
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
- `*.handoff.json`
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

curl -X POST http://127.0.0.1:8789/projects/plan \
  -H 'content-type: application/json' \
  -d '{"project":"config/projects/example-project.yaml","domains":["backend","frontend"],"objective":"Coordinate backend and frontend work for one project."}'

curl -X POST http://127.0.0.1:8789/projects/invoke \
  -H 'content-type: application/json' \
  -d '{"project":"config/projects/example-project.yaml","domains":["backend","frontend"],"objective":"Coordinate backend and frontend work for one project.","wait":true,"stub":true,"timeout":25000,"interval":250}'

curl http://127.0.0.1:8789/executions
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
curl http://127.0.0.1:8789/goal-plans/<plan-id>/history
curl -X POST http://127.0.0.1:8789/goal-plans/<plan-id>/edit \
  -H 'content-type: application/json' \
  -d '{"editedRecommendations":[{"title":"Operator-adjusted item","kind":"scenario","priority":1}],"reviewRationale":"Trim lower-value follow-up work before materialization."}'
curl -X POST http://127.0.0.1:8789/goal-plans/<plan-id>/materialize \
  -H 'content-type: application/json' \
  -d '{"by":"operator","source":"runbook"}'
curl http://127.0.0.1:8789/work-item-groups
curl -X POST http://127.0.0.1:8789/work-item-groups/<group-id>/run \
  -H 'content-type: application/json' \
  -d '{"stub":true,"wait":true}'
curl -X POST http://127.0.0.1:8789/work-item-groups/<group-id>/retry-downstream \
  -H 'content-type: application/json' \
  -d '{"by":"operator","reason":"Retry blocked downstream items after an upstream fix."}'
curl -X POST http://127.0.0.1:8789/work-item-groups/<group-id>/validate-bundle \
  -H 'content-type: application/json' \
  -d '{"bundleId":"proposal-ready-fast","stub":true,"source":"runbook"}'
curl http://127.0.0.1:8789/workspaces
curl http://127.0.0.1:8789/work-item-runs/<run-id>/workspace
curl http://127.0.0.1:8789/executions/<execution-id>/workspaces
curl http://127.0.0.1:8789/self-build/learnings
curl http://127.0.0.1:8789/self-build/doc-suggestions
curl http://127.0.0.1:8789/self-build/intake
curl -X POST http://127.0.0.1:8789/self-build/intake/refresh \
  -H 'content-type: application/json' \
  -d '{"includeAccepted":true,"projectId":"spore","by":"operator"}'
curl -X POST http://127.0.0.1:8789/work-item-runs/<run-id>/validate-bundle \
  -H 'content-type: application/json' \
  -d '{"bundleId":"proposal-ready-fast","stub":true,"source":"runbook"}'
curl http://127.0.0.1:8789/doc-suggestions/<suggestion-id>
curl -X POST http://127.0.0.1:8789/doc-suggestions/<suggestion-id>/review \
  -H 'content-type: application/json' \
  -d '{"status":"accepted","by":"operator","comments":"Turn this into managed work."}'
curl -X POST http://127.0.0.1:8789/doc-suggestions/<suggestion-id>/materialize \
  -H 'content-type: application/json' \
  -d '{"safeMode":true,"by":"operator"}'
curl http://127.0.0.1:8789/proposal-artifacts/<proposal-id>/review-package
curl -X POST http://127.0.0.1:8789/proposal-artifacts/<proposal-id>/rework \
  -H 'content-type: application/json' \
  -d '{"rationale":"Route this blocked proposal back into managed self-work.","by":"operator"}'
curl http://127.0.0.1:8789/integration-branches
curl http://127.0.0.1:8789/self-build/decisions
curl http://127.0.0.1:8789/self-build/quarantine
curl http://127.0.0.1:8789/self-build/rollback
curl http://127.0.0.1:8789/self-build/learning-trends
curl http://127.0.0.1:8789/self-build/policy-recommendations
curl http://127.0.0.1:8789/self-build/policy-recommendations/policy-rec:learning-record:example
curl http://127.0.0.1:8789/self-build/overrides/override-123
curl http://127.0.0.1:8789/self-build/loop/status
curl -X POST http://127.0.0.1:8789/self-build/loop/start \
  -H 'content-type: application/json' \
  -d '{"mode":"supervised","by":"operator"}'
curl -X POST http://127.0.0.1:8789/self-build/loop/stop \
  -H 'content-type: application/json' \
  -d '{"by":"operator","reason":"Stop after one controlled iteration."}'
curl -X POST http://127.0.0.1:8789/goal-plans/<plan-id>/quarantine \
  -H 'content-type: application/json' \
  -d '{"by":"operator","reason":"Quarantine one unsafe plan."}'
curl -X POST http://127.0.0.1:8789/integration-branches/<branch-name>/rollback \
  -H 'content-type: application/json' \
  -d '{"by":"operator","reason":"Rollback failed autonomous integration attempt."}'

curl -X POST http://127.0.0.1:8789/workflows/invoke \
  -H 'content-type: application/json' \
  -d '{"domain":"backend","roles":["lead","reviewer"],"objective":"Lead should return one sentence. Reviewer should return approve, revise, or reject in one sentence.","wait":true,"stepSoftTimeout":15000,"stepHardTimeout":45000}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Operator accepted reviewer verdict."}'

curl -X POST http://127.0.0.1:8789/executions/e2e-review-002/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","comments":"Operator approved execution completion."}'

curl -X POST http://127.0.0.1:8789/executions/<coordinator-root-execution-id>/tree/review \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve project lanes for promotion."}'

curl -X POST http://127.0.0.1:8789/executions/<coordinator-root-execution-id>/tree/approval \
  -H 'content-type: application/json' \
  -d '{"status":"approved","scope":"all-pending","comments":"Approve project lanes for promotion."}'

curl -X POST http://127.0.0.1:8789/promotions/plan \
  -H 'content-type: application/json' \
  -d '{"execution":"<coordinator-root-execution-id>","targetBranch":"main"}'

curl -X POST http://127.0.0.1:8789/promotions/invoke \
  -H 'content-type: application/json' \
  -d '{"execution":"<coordinator-root-execution-id>","targetBranch":"main","wait":true,"stub":true,"timeout":25000,"interval":250}'

curl -X POST http://127.0.0.1:8789/executions/branch-review-001/escalations/<id>/resolve \
  -H 'content-type: application/json' \
  -d '{"resume":true,"comments":"Resume after escalation"}'
```

When validating domain policy integration, confirm that:

- omitting `roles` lets the merged domain `workflowPolicy.defaultRoles` choose the launch order,
- step `maxAttempts`, reviewer `reviewRequired` and `approvalRequired`, and per-role `sessionMode` match the merged policy,
- startup context files under `tmp/sessions/*.context.json` use the domain docs-kb query terms and result limit,
- watchdog behavior follows the step soft and hard timeout policy unless the invoke or drive call overrides it,
- `run-center` payloads expose `alerts[]` and `recommendations[]` for the latest failing scenario and regression flows,
- scenario and regression run payloads expose `failure` and `suggestedActions` so operator clients do not need to invent local triage heuristics,
- report, trend, and recent-run payloads may also expose additive `links.*`, `trendSnapshot`, `latestReports[]`, `recentRuns[]`, and `failureBreakdown`; prefer those server-computed drilldown hints over client-side reconstruction.

If execution payloads now include lineage or coordination metadata, inspect them directly from the execution read surfaces rather than by opening SQLite files:

```bash
curl http://127.0.0.1:8789/executions
curl http://127.0.0.1:8789/executions/e2e-review-002
```

## Real PI Self-Build Trace Loop

Use this flow when you need to understand why a live self-build mission picked a proposal, chose a pending action, selected validation bundles, kept or failed a workspace allocation, or blocked promotion.

1. Start the orchestrator with isolated state and a real PI runtime:

```bash
export SPORE_ORCHESTRATOR_DB_PATH=/tmp/spore-real-pi-orchestrator.sqlite
export SPORE_SESSION_DB_PATH=/tmp/spore-real-pi-sessions.sqlite
export SPORE_EVENT_LOG_PATH=/tmp/spore-real-pi-events.ndjson
export SPORE_WORKTREE_ROOT=/tmp/spore-real-pi-worktrees
npm run orchestrator:start
```

2. Create an operator thread for a real mission (`stub:false`):

```bash
curl -sS -X POST http://127.0.0.1:8789/operator/threads \
  -H 'content-type: application/json' \
  -d '{
    "message":"Refresh the self-build local-dev tracing guidance using a real PI-backed mission.",
    "projectId":"spore",
    "safeMode":true,
    "stub":false,
    "wait":false,
    "by":"operator",
    "source":"runbook"
  }' | tee /tmp/spore-thread.json

export THREAD_ID="$(jq -r '.detail.id' /tmp/spore-thread.json)"
```

3. Inspect the thread-level decision traces before approving anything:

```bash
curl -sS "http://127.0.0.1:8789/operator/threads/${THREAD_ID}" | jq '.detail | {
  title,
  status,
  proposalSelection: .trace.proposalSelection,
  pendingAction: .trace.pendingAction,
  pendingActions: [.pendingActions[] | {actionKind, targetId, trace}]
}'
```

4. Approve the goal plan in chat, then re-check the same thread trace as managed work progresses:

```bash
curl -sS -X POST "http://127.0.0.1:8789/operator/threads/${THREAD_ID}/messages" \
  -H 'content-type: application/json' \
  -d '{"message":"approve","by":"operator","source":"runbook"}' | jq '.detail.trace'
```

5. Once a run exists, inspect validation selection and workspace allocation without opening SQLite:

```bash
export RUN_ID="$(curl -sS "http://127.0.0.1:8789/operator/threads/${THREAD_ID}" | jq -r '.detail.context.latestRun.id')"

curl -sS "http://127.0.0.1:8789/work-item-runs/${RUN_ID}" | jq '.detail | {
  run: {id, status},
  validationTrace: .trace.validation,
  suggestedActions
}'

curl -sS "http://127.0.0.1:8789/work-item-runs/${RUN_ID}/workspace" | jq '.detail | {
  workspace: {id, status, worktreePath, branchName},
  allocationTrace: .trace.allocation,
  cleanupPolicy
}'
```

6. When a proposal is present, inspect promotion blockers and validation readiness from the review package:

```bash
export PROPOSAL_ID="$(curl -sS "http://127.0.0.1:8789/operator/threads/${THREAD_ID}" | jq -r '.detail.context.proposal.id')"

curl -sS "http://127.0.0.1:8789/proposal-artifacts/${PROPOSAL_ID}/review-package" | jq '.detail | {
  proposal: {id: .proposal.id, status: .proposal.status},
  promotionTrace: .trace.promotion,
  governance,
  readiness
}'
```

7. If validation needs an explicit bundle, queue it and immediately re-read the run trace to see which bundle family was selected:

```bash
curl -sS -X POST "http://127.0.0.1:8789/work-item-runs/${RUN_ID}/validate-bundle" \
  -H 'content-type: application/json' \
  -d '{
    "bundleIds":["proposal-ready-fast","integration-ready-core"],
    "stub":false,
    "by":"operator",
    "source":"runbook"
  }' | jq '.detail.trace.validation'
```

8. If promotion is still blocked, keep using the read surfaces first:

```bash
curl -sS -X POST "http://127.0.0.1:8789/proposal-artifacts/${PROPOSAL_ID}/promotion-plan" \
  -H 'content-type: application/json' \
  -d '{"targetBranch":"main","by":"operator"}' | jq
```

When the response is `409`, the body still returns the review package detail. Read `.detail.trace.promotion` first; it is the operator-facing blocker summary and should be enough to explain the stop without dropping into SQLite or raw PI transcripts.

## TUI and Family Inspection

Use the terminal surface against the same orchestrator HTTP APIs as the web client:

For TUI subcommands without dedicated root npm aliases, execute the TypeScript CLI directly through `tsx`:

```bash
npx tsx packages/tui/src/cli/spore-ops.ts execution --execution e2e-review-002 --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts family --execution e2e-review-002 --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts audit --execution e2e-review-002 --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts policy-diff --execution e2e-review-002 --api http://127.0.0.1:8789
```

## TUI Self-Build Triage

The TUI provides a dedicated self-build triage view for scanning urgent and follow-up work:

```bash
# Terminal-native triage view (default)
npx tsx packages/tui/src/cli/spore-ops.ts self-build --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build-dashboard --api http://127.0.0.1:8789

# Raw JSON output (use --json flag)
npx tsx packages/tui/src/cli/spore-ops.ts self-build --json --api http://127.0.0.1:8789

# Drilldown into specific records without leaving the TUI
npx tsx packages/tui/src/cli/spore-ops.ts self-build --item <work-item-id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build --proposal <proposal-id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build --group <group-id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build --run <work-item-run-id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build --plan <goal-plan-id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts work-item-queue --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts workspace-list --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts workspace-show --workspace <workspace-id> --api http://127.0.0.1:8789

# Legacy raw JSON command (still supported)
npx tsx packages/tui/src/cli/spore-ops.ts self-build-summary --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build-learning-trends --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build-policy-recommendations --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build-policy-recommendation-show --recommendation <id> --api http://127.0.0.1:8789
npx tsx packages/tui/src/cli/spore-ops.ts self-build-override-show --override <id> --api http://127.0.0.1:8789

`npm run test:http` and `npm run test:tui` should exit cleanly using the shared teardown helpers. If either suite hangs again, treat that as a harness regression rather than expected behavior and fix the teardown path instead of normalizing the hang.
```

The triage view displays:
- Overview counts and status distribution
- Group readiness with ready, blocked, and review-needed breakdowns
- Urgent work queue (blocked items, failed items, proposals awaiting review/approval)
- Follow-up work queue (pending validation, doc suggestions)
- Recent activity timestamp
- Next action hints for operators

To inspect one group in the same dependency language as the web surface:

```bash
# Formatted dependency-aware group detail
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-show --group <group-id> --api http://127.0.0.1:8789

# Raw JSON for scripting or parity checks
npx tsx packages/tui/src/cli/spore-ops.ts work-item-group-show --group <group-id> --json --api http://127.0.0.1:8789
```

Interpret dependency states consistently across web and TUI:
- `blocked` means a hard prerequisite is still pending or running
- `review_needed` means an upstream dependency failed and an operator should retry or resolve the path
- `advisory` means the dependency stays visible as a warning but does not block execution

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
curl http://127.0.0.1:8789/run-center/summary | jq '.detail | {alerts, recommendations}'
npm run orchestrator:self-build-summary
npm run orchestrator:self-build-dashboard
npm run orchestrator:regression-list
npm run orchestrator:regression-show -- --regression local-fast
npm run orchestrator:regression-run -- --regression local-fast --stub
npm run orchestrator:regression-run-show -- --run <run-id>
npm run orchestrator:regression-report -- --run <run-id>
npm run orchestrator:regression-latest-report -- --regression local-fast
npm run orchestrator:regression-rerun -- --run <run-id>
npm run orchestrator:regression-trends -- --regression local-fast
curl http://127.0.0.1:8789/regressions/scheduler/status | jq '.detail.profiles[] | {id, scheduleStatus, latestScheduledRun}'
npm run orchestrator:work-item-template-list
npm run orchestrator:work-item-template-show -- --template operator-ui-pass
npm run orchestrator:workspace-list
npm run orchestrator:workspace-show -- --run <work-item-run-id>
npm run orchestrator:workspace-reconcile -- --workspace <workspace-id>
npm run orchestrator:workspace-cleanup -- --workspace <workspace-id> --force
npm run orchestrator:execution-workspaces -- --execution <execution-id>
npm run orchestrator:work-item-run-rerun -- --run <work-item-run-id>
npm run workspace:list
npm run orchestrator:goal-plan-create -- --goal "Stabilize CLI verification and docs follow-up"
npm run orchestrator:goal-plan-list
npm run orchestrator:goal-plan-show -- --plan <goal-plan-id>
npm run orchestrator:goal-plan-review -- --plan <goal-plan-id> --status reviewed
npm run orchestrator:goal-plan-materialize -- --plan <goal-plan-id>
npm run orchestrator:goal-plan-run -- --plan <goal-plan-id> --stub
npm run orchestrator:work-item-group-list
npm run orchestrator:work-item-group-show -- --group <group-id>
npm run orchestrator:work-item-group-run -- --group <group-id> --stub
npm run orchestrator:work-item-create -- --title "CLI verification work item" --kind scenario --scenario cli-verification-pass
npm run orchestrator:work-item-list
npm run orchestrator:work-item-show -- --item <work-item-id>
npm run orchestrator:work-item-runs -- --item <work-item-id>
npm run orchestrator:work-item-run -- --item <work-item-id> --stub
npm run orchestrator:work-item-run-show -- --run <work-item-run-id>
npm run orchestrator:work-item-validate -- --run <work-item-run-id> --stub
npm run orchestrator:work-item-doc-suggestions -- --run <work-item-run-id>
npm run orchestrator:proposal-show -- --run <work-item-run-id>
npm run orchestrator:proposal-review-package -- --proposal <proposal-id>
npm run orchestrator:proposal-review -- --proposal <proposal-id> --status reviewed
npm run orchestrator:proposal-approve -- --proposal <proposal-id> --status approved
npm run orchestrator:proposal-promotion-plan -- --proposal <proposal-id> --target-branch main
npm run orchestrator:proposal-promotion-invoke -- --proposal <proposal-id> --target-branch main --wait --stub
curl http://127.0.0.1:8789/operator/threads
curl -N http://127.0.0.1:8789/operator/threads/<thread-id>/stream
curl -X POST http://127.0.0.1:8789/operator/threads -H 'content-type: application/json' -d '{"message":"Refresh the self-build onboarding docs in safe mode.","projectId":"spore","safeMode":true,"stub":true}'
curl -X POST http://127.0.0.1:8789/operator/threads/<thread-id>/messages -H 'content-type: application/json' -d '{"message":"keep only docs","by":"operator","source":"curl"}'
curl -X POST http://127.0.0.1:8789/operator/threads/<thread-id>/messages -H 'content-type: application/json' -d '{"message":"approve","by":"operator","source":"curl"}'
curl http://127.0.0.1:8789/operator/actions
curl http://127.0.0.1:8789/operator/actions?threadId=<thread-id>
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

`npm run web:start` first runs `npm run web:build`, which compiles `apps/web/src/*.ts` into `apps/web/public/`.

Treat the emitted `apps/web/public/*.js` files and any `*.tsbuildinfo` files as local build artifacts rather than source-of-truth code.

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

For dependency-aware self-build verification, also confirm that:

- the Self-Build view leads with Group Readiness before the urgent queue,
- opening a group shows the prerequisite picker, current hard/advisory edges, and immediate impact feedback after each dependency change,
- blocked or review-needed rows name the blocker id, strictness, plain-language reason, and likely next step,
- the browser never mutates dependency state locally; all changes flow through `POST /api/orchestrator/work-item-groups/:id/dependencies`.

## Data Paths

- docs index db: `data/docs-index/`
- embeddings: `data/embeddings/`
- cache/state: `data/cache/`, `data/state/`
- runtime artifacts: `tmp/sessions/`
- worktree isolation root: `.spore/worktrees/`

## Operational Notes

- Use tmux-backed sessions for inspectable runs.
- Use `workspace-reconcile` before manual intervention if a worktree looks orphaned, missing, or dirty.
- Use `workspace-cleanup` only after proposal/governance state says the workspace is disposable, or with `--force` when the operator is making an explicit recovery decision.
- Use the runtime `launch-context` artifact or `/sessions/:id/live` `launcherMetadata.cwd` when you need proof that a mutating run launched inside its provisioned workspace rather than the canonical repo root.
- Use `tmp/sessions/<sessionId>.handoff.json` when you need the normalized durable handoff captured from one completed step.
- Use `/executions/:id/handoffs` when you need the execution-wide handoff chain rather than one session artifact.
- Prefer `session-manager reconcile` for detached-session cleanup.
- Prefer `services/session-gateway/` as the shared read API for clients instead of reading local state files directly.
- Prefer orchestrator execution reads and workflow event streams over inferring workflow state from runtime artifacts alone.
- Prefer changing domain defaults in `config/domains/*.yaml` and project-specific policy overlays in `config/projects/*.yaml` `activeDomains[]` rather than hard-coding run behavior elsewhere.
- When testing pause, hold, or recovery behavior, record the observed execution state and event sequence in the relevant architecture or operations docs rather than leaving that knowledge only in shell history.
