# Architecture

**Analysis Date:** 2026-03-09

## Pattern Overview

**Overall:** Config-driven modular monorepo with package-owned domain logic, local durable state, and thin HTTP/browser operator surfaces.

**Key Characteristics:**
- Use `docs/`, `AGENTS.md`, and `docs/decisions/` as the governance layer that defines repository boundaries and runtime rules.
- Keep execution logic in reusable packages such as `packages/orchestrator/`, `packages/runtime-pi/`, and `packages/session-manager/`; keep `services/` and `apps/` thin over those packages.
- Persist durable workflow and session state in local SQLite under `data/state/` and append event streams to NDJSON files such as `data/state/events.ndjson`.
- Materialize runtime artifacts and operator prompts under `tmp/sessions/` and `tmp/orchestrator/` instead of hiding execution state inside process memory.
- Drive startup retrieval through `packages/docs-kb/` and attach the resulting context bundle to each session launch from `packages/runtime-pi/src/context/build-startup-context.js`.

## Layers

**Documentation and Governance Layer:**
- Purpose: Define operating rules, architecture intent, runtime constraints, and canonical navigation.
- Location: `docs/`, `AGENTS.md`, `.pi/SYSTEM.md`
- Contains: Architecture docs, ADRs, runbooks, plans, domain docs, operator rules.
- Depends on: Repository structure and code paths that docs reference.
- Used by: `packages/runtime-pi/src/planner/build-session-plan.js`, `packages/runtime-pi/src/context/build-startup-context.js`, humans operating the repo.

**Configuration and Schema Layer:**
- Purpose: Declare projects, domains, workflows, runtime defaults, scenarios, regressions, and validation contracts.
- Location: `config/`, `schemas/`, `packages/config-schema/`
- Contains: YAML config trees such as `config/projects/spore.yaml`, `config/workflows/backend-service-delivery.yaml`, and JSON schemas under `schemas/*/*.schema.json`.
- Depends on: `packages/config-schema/src/yaml/parse-yaml.js` and `packages/config-schema/src/validate/load-schemas.js` for parsing and schema lookup.
- Used by: `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `packages/runtime-pi/src/planner/build-session-plan.js`, `packages/config-schema/src/cli/validate-config.js`, `packages/orchestrator/src/scenarios/catalog.js`.

**Knowledge Retrieval Layer:**
- Purpose: Index `docs/` and provide startup retrieval context for sessions.
- Location: `packages/docs-kb/`
- Contains: Document scanning in `packages/docs-kb/src/ingestion/scan-documents.js`, chunking in `packages/docs-kb/src/chunking/chunk-document.js`, embeddings in `packages/docs-kb/src/embeddings/`, and SQLite index storage in `packages/docs-kb/src/store/sqlite-store.js`.
- Depends on: `docs/`, `data/docs-index/spore-docs.sqlite`, and the local embedding provider registry in `packages/docs-kb/src/embeddings/provider-registry.js`.
- Used by: `packages/runtime-pi/src/context/build-startup-context.js` and root scripts in `package.json`.

**Runtime Planning and Launch Layer:**
- Purpose: Translate role/profile config into PI-backed session plans and launch tmux-inspectable sessions.
- Location: `packages/runtime-pi/`
- Contains: Session plan generation in `packages/runtime-pi/src/planner/build-session-plan.js`, retrieval bundling in `packages/runtime-pi/src/context/build-startup-context.js`, launcher assets in `packages/runtime-pi/src/launchers/tmux-launcher.js`, RPC control handling in `packages/runtime-pi/src/launchers/pi-rpc-runner.js`, and CLI entrypoints in `packages/runtime-pi/src/cli/`.
- Depends on: `config/system/runtime.yaml`, `config/profiles/*.yaml`, `config/projects/*.yaml`, `packages/session-manager/`, `packages/docs-kb/`, `tmux`, and the `pi` binary when available.
- Used by: `packages/orchestrator/src/execution/workflow-execution.js` and direct root scripts such as `npm run runtime-pi:run`.

**Session State and Control Layer:**
- Purpose: Persist session lifecycle state, capture session events, and expose session inspection/control surfaces.
- Location: `packages/session-manager/`, `services/session-gateway/`
- Contains: SQLite session store in `packages/session-manager/src/store/session-store.js`, event log helpers in `packages/session-manager/src/events/event-log.js`, lifecycle transitions in `packages/session-manager/src/control/session-actions.js`, and HTTP session routes in `services/session-gateway/server.js`.
- Depends on: `data/state/spore-sessions.sqlite`, `data/state/events.ndjson`, and runtime artifacts in `tmp/sessions/`.
- Used by: `packages/runtime-pi/src/cli/run-session-plan.js`, `packages/tui/src/cli/spore-ops.js`, `apps/web/server.js`, and `apps/web/public/app.js` through the gateway.

**Workflow Orchestration Layer:**
- Purpose: Build invocation plans, persist execution graphs, drive workflow steps, apply governance, and track scenarios/regressions/self-build work.
- Location: `packages/orchestrator/`, `services/orchestrator/`
- Contains: Planning in `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, durable execution logic in `packages/orchestrator/src/execution/workflow-execution.js`, lifecycle record builders in `packages/orchestrator/src/lifecycle/execution-lifecycle.js`, SQLite persistence in `packages/orchestrator/src/store/execution-store.js`, scenario/regression flows in `packages/orchestrator/src/scenarios/run-history.js`, and self-build/work-item flows in `packages/orchestrator/src/self-build/self-build.js` and `packages/orchestrator/src/work-items/work-items.js`.
- Depends on: `config/`, `packages/runtime-pi/`, `packages/session-manager/`, `data/state/spore-orchestrator.sqlite`, and `tmp/orchestrator/`.
- Used by: `packages/orchestrator/src/cli/spore-orchestrator.js`, `services/orchestrator/server.js`, `packages/tui/src/cli/spore-ops.js`, and `apps/web/public/app.js` via HTTP.

**Client Surface Layer:**
- Purpose: Let operators inspect and control sessions and workflow executions without reading local state files directly.
- Location: `packages/tui/`, `apps/web/`
- Contains: Terminal operator commands in `packages/tui/src/cli/spore-ops.js`, browser proxy server in `apps/web/server.js`, and a single-file browser client in `apps/web/public/app.js`.
- Depends on: `services/session-gateway/server.js` and `services/orchestrator/server.js`.
- Used by: Human operators.

## Data Flow

**Workflow Plan and Execution Flow:**

1. A caller enters through `packages/orchestrator/src/cli/spore-orchestrator.js` or `services/orchestrator/server.js`, which forwards plan/invoke arguments into `packages/orchestrator/src/invocation/plan-workflow-invocation.js`.
2. `packages/orchestrator/src/invocation/plan-workflow-invocation.js` reads `config/projects/*.yaml`, `config/domains/*.yaml`, `config/policy-packs/*.yaml`, `config/workflows/*.yaml`, and `config/profiles/*.yaml` to build one invocation payload with `effectivePolicy` and per-launch metadata.
3. `packages/orchestrator/src/execution/workflow-execution.js` converts that invocation into durable execution and step rows via `packages/orchestrator/src/lifecycle/execution-lifecycle.js` and `packages/orchestrator/src/store/execution-store.js`.
4. `packages/orchestrator/src/execution/workflow-execution.js` writes a step brief with `packages/orchestrator/src/execution/brief.js` and launches each session through `packages/runtime-pi/src/cli/run-session-plan.js`.
5. `packages/runtime-pi/src/cli/run-session-plan.js` builds a session plan, writes startup context from `packages/runtime-pi/src/context/build-startup-context.js`, registers the session through `packages/session-manager/src/cli/session-manager.js`, and launches the tmux-backed runtime assets in `tmp/sessions/`.
6. `packages/orchestrator/src/execution/workflow-execution.js` reconciles active steps against `packages/session-manager/src/store/session-store.js`, applies review/approval/hold/escalation rules, and settles the execution graph in `data/state/spore-orchestrator.sqlite`.

**Session Inspection and Control Flow:**

1. Session lifecycle writes land in `data/state/spore-sessions.sqlite` through `packages/session-manager/src/store/session-store.js` and session events append to `data/state/events.ndjson` through `packages/session-manager/src/events/event-log.js`.
2. Runtime launchers write artifacts such as `tmp/sessions/<session>.plan.json`, `tmp/sessions/<session>.context.json`, `tmp/sessions/<session>.transcript.md`, `tmp/sessions/<session>.pi-events.jsonl`, and `tmp/sessions/<session>.control.ndjson` from `packages/runtime-pi/src/launchers/tmux-launcher.js` and `packages/runtime-pi/src/control/session-control-queue.js`.
3. `services/session-gateway/server.js` joins session DB rows, event log slices, control-request rows, and `tmp/sessions/` artifacts into routes such as `GET /sessions/:id/live` and `GET /sessions/:id/artifacts/:artifact`.
4. `apps/web/server.js` proxies `/api/*` to `services/session-gateway/server.js`, and `packages/tui/src/cli/spore-ops.js` reads the same session state directly from the package layer.
5. Operator actions such as `stop`, `mark-complete`, and `steer` enter through `services/session-gateway/server.js`, which records durable control requests in `packages/session-manager/src/store/session-store.js` and appends control messages to `tmp/sessions/<session>.control.ndjson` when runtime steering is needed.

**Documentation Retrieval Flow:**

1. `packages/docs-kb/src/cli/docs-kb.js` scans `docs/` and writes a local SQLite index to `data/docs-index/spore-docs.sqlite` through `packages/docs-kb/src/store/sqlite-store.js`.
2. `packages/runtime-pi/src/context/build-startup-context.js` reads that index, searches for domain/workflow/role-specific chunks, and writes the retrieval bundle to `tmp/sessions/<session>.context.json`.
3. `packages/runtime-pi/src/planner/build-session-plan.js` injects `AGENTS.md`, `.pi/SYSTEM.md`, and `docs/INDEX.md` into the runtime context file list so each session starts from canonical repo guidance.

**State Management:**
- Use `data/state/spore-orchestrator.sqlite` as the durable source of truth for workflow executions, steps, governance decisions, escalations, scenarios, regressions, work items, goal plans, groups, and proposal artifacts from `packages/orchestrator/src/store/execution-store.js`.
- Use `data/state/spore-sessions.sqlite` as the durable source of truth for session lifecycle and control request state from `packages/session-manager/src/store/session-store.js`.
- Use `data/state/events.ndjson` as the append-only session event stream from `packages/session-manager/src/events/event-log.js`.
- Use `tmp/sessions/` for per-session artifacts and `tmp/orchestrator/` for execution briefs; these are runtime working files, not canonical state.
- Do not infer workflow completion from session files alone; execution state in `packages/orchestrator/src/store/execution-store.js` is the authoritative workflow boundary.

## Key Abstractions

**Invocation Plan:**
- Purpose: One normalized workflow launch payload that carries selected roles, resolved profiles, execution ids, and merged policy.
- Examples: `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `config/workflows/backend-service-delivery.yaml`, `config/projects/spore.yaml`
- Pattern: Read YAML config, merge policy layers, then emit one JSON-like invocation object with `effectivePolicy` and `launches[]`.

**Execution Graph:**
- Purpose: Durable workflow state independent from live runtime sessions.
- Examples: `packages/orchestrator/src/lifecycle/execution-lifecycle.js`, `packages/orchestrator/src/execution/workflow-execution.js`, `packages/orchestrator/src/store/execution-store.js`
- Pattern: One execution row plus step rows, events, reviews, approvals, audit records, escalations, and optional parent/child lineage.

**Session Plan and Session Record:**
- Purpose: Separate runtime launch input from persistent session tracking.
- Examples: `packages/runtime-pi/src/planner/build-session-plan.js`, `packages/session-manager/src/lifecycle/session-lifecycle.js`, `packages/session-manager/src/store/session-store.js`
- Pattern: Build plan JSON first, then create/update a smaller durable session record keyed by `session.id`.

**Wave-Based Workflow Topology:**
- Purpose: Run parallel roles inside a single execution while enforcing explicit gate rules.
- Examples: `config/workflows/backend-service-delivery.yaml`, `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `packages/orchestrator/src/execution/workflow-execution.js`
- Pattern: Translate workflow `stepSets` into per-step `wave`, `waveName`, and `workflowPolicy.waveGate` metadata; reconcile wave policy before unlocking later steps.

**Scenario, Regression, and Self-Build Records:**
- Purpose: Treat validation and supervised self-work as durable orchestrator artifacts instead of shell-only runs.
- Examples: `packages/orchestrator/src/scenarios/run-history.js`, `packages/orchestrator/src/scenarios/catalog.js`, `packages/orchestrator/src/self-build/self-build.js`, `packages/orchestrator/src/work-items/work-items.js`
- Pattern: Load catalog definitions from `config/scenarios/`, `config/regressions/`, and `config/work-item-templates/`, then persist runs and summaries in the orchestrator store.

## Entry Points

**Root Task Runner:**
- Location: `package.json`
- Triggers: `npm run ...`
- Responsibilities: Route repo-level commands into package CLIs and service servers.

**Workflow CLI:**
- Location: `packages/orchestrator/src/cli/spore-orchestrator.js`
- Triggers: `npm run orchestrator:*`
- Responsibilities: Plan, invoke, drive, inspect, govern, and branch executions; launch scenario, regression, and self-build flows.

**Workflow HTTP Service:**
- Location: `services/orchestrator/server.js`
- Triggers: HTTP requests on `SPORE_ORCHESTRATOR_HOST` / `SPORE_ORCHESTRATOR_PORT`
- Responsibilities: Expose thin HTTP wrappers over orchestrator CLI/package capabilities, including SSE for execution events.

**Runtime CLI:**
- Location: `packages/runtime-pi/src/cli/run-session-plan.js`
- Triggers: `npm run runtime-pi:run` and orchestrator step launch.
- Responsibilities: Build a session plan, write startup context and launch assets, create the session record, launch tmux, and optionally monitor settlement.

**Session CLI:**
- Location: `packages/session-manager/src/cli/session-manager.js`
- Triggers: `npm run session:*` and runtime launcher calls.
- Responsibilities: Create session rows from plans, transition lifecycle state, read status/events, and reconcile detached sessions.

**Session Gateway:**
- Location: `services/session-gateway/server.js`
- Triggers: HTTP requests on `SPORE_GATEWAY_HOST` / `SPORE_GATEWAY_PORT`
- Responsibilities: Serve session status, live session payloads, artifacts, event streaming, and narrow control actions.

**Operator Surfaces:**
- Location: `packages/tui/src/cli/spore-ops.js` and `apps/web/server.js`
- Triggers: `npm run ops:*` and `npm run web:start`
- Responsibilities: Present operator inspection/control surfaces over the same durable session and orchestrator contracts.

## Runtime Boundaries

**PI Runtime Boundary:**
- Authoritative boundary: `packages/runtime-pi/`
- Contract: Translate SPORE profile/project/workflow input into PI launch assets and runtime control hooks.
- Outbound dependencies: `pi` CLI, `tmux`, `tmp/sessions/`, `packages/session-manager/`, `packages/docs-kb/`.
- Inbound callers: `packages/orchestrator/src/execution/workflow-execution.js`, direct `npm run runtime-pi:*` commands.

**Session Boundary:**
- Authoritative boundary: `packages/session-manager/`
- Shared HTTP surface: `services/session-gateway/server.js`
- Contract: Own session lifecycle state, control-request durability, and append-only session events.
- Storage: `data/state/spore-sessions.sqlite`, `data/state/events.ndjson`.

**Workflow Boundary:**
- Authoritative boundary: `packages/orchestrator/`
- Shared HTTP surface: `services/orchestrator/server.js`
- Contract: Own workflow planning, execution reconciliation, governance state, lineage, coordination groups, validation history, and self-build records.
- Storage: `data/state/spore-orchestrator.sqlite`.

**Client Boundary:**
- Browser and terminal clients live in `apps/web/` and `packages/tui/`.
- Rule: Consume `services/session-gateway/server.js` and `services/orchestrator/server.js`; do not read SQLite or `tmp/` files directly from clients.

**Absent Boundaries:**
- A separate event bus is not detected; event transport is local SQLite plus NDJSON plus SSE from `services/orchestrator/server.js` and `services/session-gateway/server.js`.
- A production auth layer is not detected on `services/orchestrator/server.js`, `services/session-gateway/server.js`, or `apps/web/server.js`.

## Error Handling

**Strategy:** Throw plain `Error` objects in package code, return `null` for missing records in selected read helpers, and translate failures at CLI or HTTP entrypoints.

**Patterns:**
- Wrap HTTP request handlers in top-level `try/catch` blocks and emit JSON error payloads from `services/orchestrator/server.js` and `services/session-gateway/server.js`.
- Use resource checks in package reads such as `packages/orchestrator/src/execution/workflow-execution.js` and `packages/session-manager/src/store/session-store.js`, then map missing records to `404` in service code.
- Keep long-running workflow/session recovery durable by writing workflow events, audit rows, escalations, and control requests before or alongside state transitions.
- Use idempotency keys for session control requests in `services/session-gateway/server.js` and `packages/session-manager/src/store/session-store.js`.
- Rely on explicit hold, pause, waiting_review, and waiting_approval states from `packages/orchestrator/src/execution/workflow-execution.js` instead of encoding blocked cases as generic failures.

## Cross-Cutting Concerns

**Logging:** Local durable events and artifacts replace a centralized logger. Use `packages/session-manager/src/events/event-log.js`, `packages/orchestrator/src/store/execution-store.js`, and `tmp/sessions/` / `tmp/orchestrator/` artifacts for observability.

**Validation:** Validate YAML config through `packages/config-schema/src/cli/validate-config.js` and schemas in `schemas/`; HTTP payload validation is manual and route-local in `services/orchestrator/server.js` and `services/session-gateway/server.js`.

**Authentication:** Not detected in `services/orchestrator/server.js`, `services/session-gateway/server.js`, or `apps/web/server.js`.

---

*Architecture analysis: 2026-03-09*
