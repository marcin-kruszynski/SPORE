# AGENTS.md

## Mission

SPORE (Swarm Protocol for Orchestration, Rituals & Execution) is building a modular, profile-driven, documentation-first foundation for future multi-agent orchestration across software projects.

## Scope Boundary

Current phase is bootstrap-plus-executable-foundation. Work includes:
- repository structure,
- architecture and governance documentation,
- configuration skeletons,
- references and research synthesis,
- local-first docs search and indexing,
- session metadata, lifecycle, and operator surfaces,
- PI-first runtime planning and first live session harness,
- shared gateway surfaces for future clients,
- workflow planning and invocation through the first orchestrator-facing slice.

Do not implement production orchestrator runtime, production Web UI, or full execution engine in this phase.

## Primary Sources of Truth

1. `docs/INDEX.md`
2. `docs/index/DOCS_INDEX.md`
3. `docs/index/docs_manifest.yaml`
4. `docs/decisions/`

## Work Rules for Agents

- Update documentation with each material change.
- Add or update ADRs for architecture boundary changes.
- Keep research in `docs/research/` and decisions in `docs/decisions/`.
- Keep profile definitions in `config/profiles/` and `workspace/agent-profiles/`.
- Keep workflow definitions in `config/workflows/` and `workspace/workflow-profiles/`.
- Keep project examples in `config/projects/` and `workspace/projects/`.
- Keep domain execution policy in `config/domains/` and `config/projects/* activeDomains[]`.
- Keep reusable policy presets in `config/policy-packs/`.
- Keep docs indices synchronized when adding/moving docs.
- Prefer updating canonical docs over creating redundant fragments.

## Environment Baseline

Assume the repository is expected to run with:

- `node >= 24`
- `npm`
- `tmux`
- `pi` CLI from `@mariozechner/pi-coding-agent`
- `jq`
- `sqlite3`
- `python3`
- `git`
- `rg`

When environment assumptions change, update:

1. `README.md`
2. `docs/runbooks/local-dev.md`
3. `.pi/SYSTEM.md`
4. this file

Do not leave runtime prerequisites only in chat history.

Useful local overrides for isolated runs and tests:

- `SPORE_PI_BIN`
- `SPORE_ORCHESTRATOR_DB_PATH`
- `SPORE_SESSION_DB_PATH`
- `SPORE_EVENT_LOG_PATH`

## Runtime and Session Rules

- Prefer testing real runtime flows with `pi` when available; use stub mode only as fallback.
- Treat `packages/runtime-pi/` as the authoritative PI integration boundary.
- Prefer `pi-rpc` for real runtime validation; only use `pi-json` or stub mode when isolating launcher behavior.
- Treat `packages/session-manager/` as the authoritative session state and lifecycle boundary.
- Treat `services/session-gateway/` as the shared HTTP surface for clients; do not build new clients against ad hoc file reads when gateway data is sufficient.
- Treat `packages/orchestrator/` and `services/orchestrator/` as the workflow planning and invocation boundary.
- Treat merged domain policy as execution input, not as passive metadata.
- Treat the orchestrator execution store as the source of truth for workflow state; do not infer workflow completion from session files alone.
- Treat `waiting_review` and `waiting_approval` as settled governance states, not as runtime failures.
- Treat workflow events and escalation records as first-class execution artifacts; update the event model docs when execution state transitions change.
- Prefer resolving escalations through orchestrator commands or HTTP APIs; do not mutate escalation rows manually.
- Use tmux-backed sessions for inspectable live runs.
- Reconcile detached sessions through `session-manager reconcile` instead of manual database edits.
- Use gateway artifact and stream endpoints for transcript, PI event, and live follow use cases before adding new ad hoc readers.
- Use `GET /sessions/:id/live` for combined live session inspection before stitching separate `session + events + artifacts` reads in a new client.
- Prefer the explicit orchestrator read surfaces `/executions/:id`, `/executions/:id/events`, and `/executions/:id/escalations` over scraping SQLite directly from UI or automation clients.
- Prefer `/executions/:id/tree` when a client needs lineage or execution-family structure; do not reconstruct hierarchy from flat coordination arrays if the tree route is sufficient.
- Prefer `/executions/:id/history` when a client needs a single ordered payload that combines workflow events, governance records, audit records, wave summaries, and policy diff context.
- Use `spawn-branches` or `POST /executions/:id/branches` for deliberate multi-execution coordination work; do not create child executions by mutating lineage fields directly.
- Use workflow `stepSets` when you need parallel work inside one execution; do not simulate same-wave behavior by creating fake child executions.
- Use `stepSets[].gate` to express wave unlock rules inside one execution:
  - `all`
  - `any`
  - `min_success_count`
- Treat wave topology as workflow-owned. Domain policy and policy packs may shape retry, governance, runtime mode, and retrieval behavior around those waves, but should not silently replace workflow wave definitions.
- When changing retry, timeout, governance, session-mode, or docs retrieval behavior, update both the relevant domain config and the architecture docs that describe policy merging.
- When changing reusable presets, update `config/policy-packs/`, schema validation, and the config/workflow docs together.
- Treat `config/scenarios/` as the execution-facing catalog for named scenario runs.
- Treat `config/regressions/` as the execution-facing catalog for reusable regression profiles.
- Treat `docs/runbooks/scenario-library.md` as human-facing guidance, not the machine source of truth.
- Scenario and regression history are durable operator artifacts; do not reconstruct them from shell output when the orchestrator store already has the run records.
- Treat failure classification as a first-class operator contract. Prefer `failure`, `failureClassification`, `failureReason`, and `suggestedActions` from orchestrator read surfaces over inventing local heuristics in clients.
- Treat managed `work-items` as the durable unit of supervised self-work. Prefer creating or running work through `/work-items*` or the matching orchestrator CLI commands instead of ad hoc shell notes when the task should leave an execution trail.

## Minimum Verification Loop

Before claiming runtime/session work is done, prefer verifying at least:

```bash
npm run docs-kb:index
npm run config:validate
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --session-id smoke-001 --run-id smoke-001
npm run session:status
npm run gateway:start
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer --objective "Lead should produce one sentence; reviewer should return approve, revise, or reject." --wait
npm run test:policy
npm run test:http
npm run test:tui
npm run test:e2e:pi
```

If `pi` is unavailable, say so explicitly and note that runtime validation used the stub launcher.

If `pi` is installed but missing from `PATH` in the current shell, set:

```bash
export SPORE_PI_BIN="${SPORE_PI_BIN:-$(npm prefix -g)/bin/pi}"
```

The real PI smoke suite is opt-in:

```bash
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
```

If the environment does not expose `pi`, this test should skip instead of failing.

For isolated service or test runs, prefer environment-scoped state paths over mutating shared SQLite files:

```bash
export SPORE_ORCHESTRATOR_DB_PATH=/tmp/spore-orchestrator.sqlite
export SPORE_SESSION_DB_PATH=/tmp/spore-sessions.sqlite
export SPORE_EVENT_LOG_PATH=/tmp/spore-events.ndjson
```

Canonical named scenarios live in `docs/runbooks/scenario-library.md` and `config/workflows/*.yaml`. Prefer those named flows over ad hoc objective strings when validating new execution behavior.

## Documentation Classification

- Vision: `docs/vision/`
- Architecture: `docs/architecture/`
- Research notes: `docs/research/`
- Decisions (ADR): `docs/decisions/`
- Specs: `docs/specs/`
- Plans and roadmap: `docs/plans/` and `docs/roadmap/`
- Operations and policies: `docs/runbooks/` and `docs/operations/`

## Reference Repositories

Reference sources are in `references/` and are read-only inspiration:
- `overstory`, `mulch`, `beads`, `gastown`, `pi-mono`, `agentic-engineering-book`
- `pi-agent` is a local alias to `pi-mono`.

Never cargo-cult copy implementations. Extract concepts and adapt to SPORE.

## Incremental Delivery Pattern

1. Clarify target and boundaries.
2. Create/update architecture docs.
3. Create/update config and schemas.
4. Create/update tools and runbooks.
5. Update docs indexes and manifests.

## ADR Workflow

- Use `docs/decisions/adr-template.md`.
- Name ADRs sequentially: `ADR-XXXX-topic.md`.
- Link ADR in `docs/INDEX.md` and `docs/index/docs_manifest.yaml`.

## Docs Search Usage

Use `tools/docsearch/` conventions:
- provider contract: `tools/docsearch/provider-contract.md`
- collections plan: `tools/docsearch/collections-plan.md`
- query recipes: `tools/docsearch/query-recipes.md`

Current CLI contract: `docs-kb index|search|status|rebuild`.

## Operator Surfaces

- `services/session-gateway/` now exposes:
  - status/session/event reads
  - artifact reads
  - `text/event-stream` event feed
  - control actions: `stop`, `mark-complete`, `steer`
- `apps/web/` consumes those APIs and the orchestrator proxy rather than reading local files directly.
- `services/orchestrator/` now exposes workflow `plan` and `invoke` endpoints.
- `services/orchestrator/` also exposes durable execution list/detail, rooted execution tree reads, child execution reads, coordination-group reads, workflow event and escalation reads, execution SSE follow, plus `drive`, `drive-tree`, `pause`, `hold`, `resume`, `review`, `approval`, and branch-spawn endpoints.
- `services/orchestrator/` also exposes tree-level `pause`, `hold`, `resume`, `review`, and `approval` endpoints for execution families.
- `services/orchestrator/` also exposes escalation resolution and resume for operator recovery.
- `services/orchestrator/` also exposes audit and policy-diff reads for durable operator and policy inspection.
- `services/orchestrator/` also exposes durable scenario-run and regression-run reads by run id, rerun endpoints, and trend reads for operator validation loops.
- `services/orchestrator/` also exposes `GET /run-center/summary` as the preferred aggregate operator summary for scenarios, regressions, and recent validation runs.
- `GET /run-center/summary` should be treated as the preferred aggregate route for operator alerts and recommendations across named validation flows.
- Treat additive operator drilldown helpers such as `links.*`, `trendSnapshot`, `latestReports[]`, `recentRuns[]`, and `failureBreakdown` as first-class read-surface fields when they are present; clients should not reconstruct equivalent links heuristically.
- `services/orchestrator/` now also exposes `/work-items`, `/work-items/:id`, `/work-items/:id/run`, and `/work-item-runs/:runId` for supervised self-work tracking.
- `apps/web/` renders grouped execution list/detail, rooted lineage tree, wave progression, coordination metadata, step/session tree, and review/approval history over those APIs.
- `packages/tui/` consumes the same orchestrator HTTP surfaces for execution detail, rooted family summary, audit, policy diff, and run-center views.
- `GET /sessions/:id/live` should be treated as the preferred combined live-session payload because it now includes diagnostics, launcher metadata, control acknowledgements, and suggested recovery actions in addition to events, artifacts, and control history.
- Session suggestion payloads may now include `expectedOutcome`, `httpHint`, `targetType`, `targetId`, and `priority`; clients should preserve these additive fields.
- `GET /sessions/:id/control-history` and `GET /sessions/:id/control-status/:requestId` are the preferred reads for durable control acknowledgement and idempotency inspection; do not reconstruct control state from transcript files when those routes are available.
- `GET /regressions/scheduler/status` is the preferred read-only scheduler status route; do not use scheduler dry-run POST calls as pseudo-status reads when the dedicated route is sufficient.
- UI and automation clients should treat `coordinationGroupId`, `parentExecutionId`, `childExecutionIds`, `branchKey`, `holdReason`, `pausedAt`, `heldAt`, and `resumedAt` as optional additive fields rather than guaranteed schema requirements.
