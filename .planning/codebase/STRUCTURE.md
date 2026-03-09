# Codebase Structure

**Analysis Date:** 2026-03-09

## Directory Layout

```text
[project-root]/
|- `apps/`                # Runnable operator-facing applications
|  |- `cli/`              # Placeholder CLI app boundary; `README.md` only
|  `- `web/`              # Thin browser client and local proxy server
|- `packages/`            # Reusable package-owned logic and CLIs
|  |- `config-schema/`    # YAML parsing and schema validation
|  |- `docs-kb/`          # Local docs indexing and search
|  |- `orchestrator/`     # Workflow planning, execution, validation, self-build
|  |- `runtime-pi/`       # PI runtime planning and launchers
|  |- `session-manager/`  # Session lifecycle and event persistence
|  |- `tui/`              # Terminal operator surface
|  |- `core/`             # Placeholder shared core boundary; `README.md` only
|  |- `shared/`           # Placeholder shared helpers boundary; `README.md` only
|  |- `shared-config/`    # Placeholder shared config boundary; `README.md` only
|  |- `shared-types/`     # Placeholder shared types boundary; `README.md` only
|  `- `web-ui/`           # Placeholder shared web UI boundary; `README.md` only
|- `services/`            # HTTP service wrappers over package logic
|  |- `orchestrator/`     # Workflow/orchestrator HTTP API
|  |- `session-gateway/`  # Session HTTP API and control surface
|  `- `indexer/`          # Placeholder indexing service boundary; `README.md` only
|- `config/`              # Declarative YAML runtime, project, domain, and workflow config
|- `schemas/`             # JSON Schema files keyed by config category
|- `docs/`                # Canonical architecture, runbooks, ADRs, plans, indexes
|- `data/`                # Local SQLite stores, docs index, cache, embeddings
|- `tmp/`                 # Ephemeral session and orchestrator working files
|- `artifacts/`           # Retained derived outputs such as regressions and handoffs
|- `workspace/`           # Declarative workspace templates and catalogs
|- `tools/`               # Repo utilities and search/indexing support tools
|- `references/`          # Read-only reference repositories and manifests
|- `.planning/codebase/`  # Generated codebase mapping docs for GSD flows
|- `package.json`         # Root task runner and command map
|- `AGENTS.md`            # Repository operating contract
`- `README.md`            # Top-level project overview
```

## Directory Purposes

**`apps/web/`:**
- Purpose: Browser operator surface that stays thin over backend APIs.
- Contains: `apps/web/server.js`, `apps/web/public/index.html`, `apps/web/public/styles.css`, `apps/web/public/app.js`.
- Key files: `apps/web/server.js`, `apps/web/public/app.js`

**`apps/cli/`:**
- Purpose: Reserved app boundary for a future standalone CLI surface.
- Contains: `apps/cli/README.md` only.
- Key files: `apps/cli/README.md`

**`packages/orchestrator/`:**
- Purpose: Own workflow planning, execution state, governance, lineage, scenarios, regressions, and self-build models.
- Contains: `packages/orchestrator/src/invocation/`, `packages/orchestrator/src/execution/`, `packages/orchestrator/src/store/`, `packages/orchestrator/src/scenarios/`, `packages/orchestrator/src/self-build/`, `packages/orchestrator/src/work-items/`, `packages/orchestrator/src/cli/`.
- Key files: `packages/orchestrator/src/cli/spore-orchestrator.js`, `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `packages/orchestrator/src/execution/workflow-execution.js`, `packages/orchestrator/src/store/execution-store.js`

**`packages/runtime-pi/`:**
- Purpose: Own PI-specific session planning, startup context generation, launch assets, and launcher implementations.
- Contains: `packages/runtime-pi/src/planner/`, `packages/runtime-pi/src/context/`, `packages/runtime-pi/src/launchers/`, `packages/runtime-pi/src/control/`, `packages/runtime-pi/src/cli/`.
- Key files: `packages/runtime-pi/src/cli/run-session-plan.js`, `packages/runtime-pi/src/planner/build-session-plan.js`, `packages/runtime-pi/src/context/build-startup-context.js`, `packages/runtime-pi/src/launchers/tmux-launcher.js`, `packages/runtime-pi/src/launchers/pi-rpc-runner.js`

**`packages/session-manager/`:**
- Purpose: Own durable session rows, control request rows, lifecycle transitions, and event log helpers.
- Contains: `packages/session-manager/src/store/`, `packages/session-manager/src/control/`, `packages/session-manager/src/events/`, `packages/session-manager/src/lifecycle/`, `packages/session-manager/src/cli/`.
- Key files: `packages/session-manager/src/cli/session-manager.js`, `packages/session-manager/src/store/session-store.js`, `packages/session-manager/src/control/session-actions.js`, `packages/session-manager/src/events/event-log.js`

**`packages/docs-kb/`:**
- Purpose: Own local-first docs indexing and search.
- Contains: `packages/docs-kb/src/cli/`, `packages/docs-kb/src/ingestion/`, `packages/docs-kb/src/chunking/`, `packages/docs-kb/src/embeddings/`, `packages/docs-kb/src/store/`, `packages/docs-kb/src/metadata/`.
- Key files: `packages/docs-kb/src/cli/docs-kb.js`, `packages/docs-kb/src/store/sqlite-store.js`, `packages/docs-kb/src/ingestion/scan-documents.js`

**`packages/config-schema/`:**
- Purpose: Own YAML parsing plus lightweight schema validation for `config/`.
- Contains: `packages/config-schema/src/cli/`, `packages/config-schema/src/validate/`, `packages/config-schema/src/yaml/`.
- Key files: `packages/config-schema/src/cli/validate-config.js`, `packages/config-schema/src/validate/load-schemas.js`, `packages/config-schema/src/yaml/parse-yaml.js`

**`packages/tui/`:**
- Purpose: Provide terminal operator commands over session and orchestrator state.
- Contains: `packages/tui/src/cli/`.
- Key files: `packages/tui/src/cli/spore-ops.js`

**`services/orchestrator/`:**
- Purpose: Expose orchestrator package capabilities as a local HTTP API.
- Contains: `services/orchestrator/server.js`, `services/orchestrator/test/`.
- Key files: `services/orchestrator/server.js`, `services/orchestrator/test/http-policy.test.js`, `services/orchestrator/test/http-lineage.test.js`

**`services/session-gateway/`:**
- Purpose: Expose session package state and runtime artifact/control routes as a local HTTP API.
- Contains: `services/session-gateway/server.js`, `services/session-gateway/test/`.
- Key files: `services/session-gateway/server.js`, `services/session-gateway/test/live-route.test.js`

**`services/indexer/`:**
- Purpose: Reserved service boundary for future indexing jobs.
- Contains: `services/indexer/README.md` only.
- Key files: `services/indexer/README.md`

**`config/`:**
- Purpose: Store declarative source-of-truth YAML for runtime behavior and workflow composition.
- Contains: `config/system/`, `config/profiles/`, `config/projects/`, `config/domains/`, `config/workflows/`, `config/scenarios/`, `config/regressions/`, `config/work-item-templates/`, `config/policy-packs/`, `config/teams/`.
- Key files: `config/projects/spore.yaml`, `config/system/runtime.yaml`, `config/workflows/backend-service-delivery.yaml`, `config/domains/backend.yaml`

**`schemas/`:**
- Purpose: Keep JSON Schemas aligned with config categories.
- Contains: Schema directories such as `schemas/workflow/`, `schemas/project/`, `schemas/domain/`, `schemas/scenario/`, `schemas/regression/`.
- Key files: `schemas/workflow/workflow.schema.json`, `schemas/project/project.schema.json`, `schemas/domain/domain.schema.json`

**`docs/`:**
- Purpose: Keep canonical repo guidance, architecture, ADRs, runbooks, and domain docs.
- Contains: `docs/architecture/`, `docs/decisions/`, `docs/index/`, `docs/runbooks/`, `docs/operations/`, `docs/plans/`, `docs/domains/`, `docs/vision/`.
- Key files: `docs/INDEX.md`, `docs/index/DOCS_INDEX.md`, `docs/index/docs_manifest.yaml`, `docs/architecture/runtime-model.md`, `docs/architecture/config-model.md`

**`data/`:**
- Purpose: Hold local stateful stores and indexes used by runtime code.
- Contains: `data/state/`, `data/docs-index/`, `data/cache/`, `data/embeddings/`.
- Key files: `data/state/spore-sessions.sqlite`, `data/state/spore-orchestrator.sqlite`, `data/state/events.ndjson`, `data/docs-index/spore-docs.sqlite`

**`tmp/`:**
- Purpose: Hold ephemeral runtime files and generated launch assets.
- Contains: `tmp/sessions/`, `tmp/orchestrator/`, `tmp/test-runs/`.
- Key files: `tmp/README.md`, runtime-generated files such as `tmp/sessions/<session>.plan.json` and `tmp/orchestrator/<execution>/<session>.brief.md`

**`workspace/`:**
- Purpose: Hold declarative workspace composition artifacts and catalogs outside the active `config/` tree.
- Contains: `workspace/agent-profiles/`, `workspace/workflow-profiles/`, `workspace/projects/`, `workspace/templates/`, `workspace/teams/`.
- Key files: `workspace/README.md`

## Key File Locations

**Entry Points:**
- `package.json`: Root command map for docs, config validation, runtime, session, orchestrator, TUI, web, and services.
- `packages/orchestrator/src/cli/spore-orchestrator.js`: Primary workflow CLI entrypoint.
- `packages/runtime-pi/src/cli/run-session-plan.js`: Primary runtime session launch entrypoint.
- `packages/session-manager/src/cli/session-manager.js`: Primary session CLI entrypoint.
- `packages/docs-kb/src/cli/docs-kb.js`: Primary docs indexing/search CLI entrypoint.
- `packages/config-schema/src/cli/validate-config.js`: Config validation CLI entrypoint.
- `packages/tui/src/cli/spore-ops.js`: Terminal operator entrypoint.
- `services/orchestrator/server.js`: Orchestrator HTTP service entrypoint.
- `services/session-gateway/server.js`: Session gateway HTTP service entrypoint.
- `apps/web/server.js`: Web proxy/static app entrypoint.

**Configuration:**
- `config/projects/spore.yaml`: Main project assembly for this repository.
- `config/system/runtime.yaml`: Runtime adapter and session default config.
- `config/domains/backend.yaml`: Example domain-level workflow/runtime/docs policy.
- `config/workflows/backend-service-delivery.yaml`: Example workflow topology with `stepSets`.
- `config/scenarios/backend-service-delivery.yaml`: Named scenario bound to one workflow.
- `config/regressions/local-fast.yaml`: Regression bundle over multiple scenarios.

**Core Logic:**
- `packages/orchestrator/src/execution/workflow-execution.js`: Execution reconcile/drive engine.
- `packages/orchestrator/src/store/execution-store.js`: Durable workflow, validation, and self-build persistence.
- `packages/runtime-pi/src/planner/build-session-plan.js`: Runtime session plan builder.
- `packages/runtime-pi/src/context/build-startup-context.js`: Startup retrieval bundle builder.
- `packages/session-manager/src/store/session-store.js`: Durable session store.
- `packages/docs-kb/src/store/sqlite-store.js`: Documentation index store.

**Testing:**
- `packages/orchestrator/test/`: Package-level orchestrator tests.
- `packages/runtime-pi/test/`: Runtime integration and policy propagation tests.
- `services/orchestrator/test/`: HTTP orchestration service tests.
- `services/session-gateway/test/`: Session gateway and control tests.
- `packages/tui/test/`: TUI parity tests referenced by `package.json`.

## Naming Conventions

**Files:**
- Runtime code uses lowercase kebab-case `.js` files such as `packages/orchestrator/src/invocation/plan-workflow-invocation.js` and `packages/runtime-pi/src/context/build-startup-context.js`.
- Service entrypoints use `server.js` at the service or app root, such as `services/orchestrator/server.js`, `services/session-gateway/server.js`, and `apps/web/server.js`.
- CLI entrypoints live under `src/cli/` and use imperative names such as `packages/tui/src/cli/spore-ops.js` and `packages/docs-kb/src/cli/docs-kb.js`.
- Config files use lowercase kebab-case YAML names such as `config/workflows/frontend-ui-pass.yaml` and `config/work-item-templates/runtime-validation-pass.yaml`.
- Planning outputs in this directory use uppercase names such as `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/STRUCTURE.md`.

**Directories:**
- Top-level executable domains use plural roots: `apps/`, `packages/`, `services/`, `config/`, `schemas/`, `docs/`.
- Package/service internals use role-based subdirectories such as `src/cli/`, `src/store/`, `src/execution/`, `src/context/`, `src/launchers/`, and `test/helpers/`.
- Config directories mirror schema directories by concern, for example `config/workflows/` <-> `schemas/workflow/` and `config/scenarios/` <-> `schemas/scenario/`.

## Where to Add New Code

**New Workflow or Orchestrator Feature:**
- Primary code: `packages/orchestrator/src/`
- Place planners in `packages/orchestrator/src/invocation/`, execution-state logic in `packages/orchestrator/src/execution/`, durable persistence in `packages/orchestrator/src/store/`, and catalog/run-management code in `packages/orchestrator/src/scenarios/` or `packages/orchestrator/src/self-build/`.
- HTTP exposure: `services/orchestrator/server.js`
- Tests: `packages/orchestrator/test/` for package behavior and `services/orchestrator/test/` for route behavior.

**New Session or Runtime Capability:**
- Runtime launch/planning code: `packages/runtime-pi/src/`
- Session persistence/lifecycle code: `packages/session-manager/src/`
- HTTP access or operator control: `services/session-gateway/server.js`
- Tests: `packages/runtime-pi/test/` and `services/session-gateway/test/`

**New Browser UI Behavior:**
- Proxy or static serving changes: `apps/web/server.js`
- UI state/rendering changes: `apps/web/public/app.js`
- Markup and styling: `apps/web/public/index.html`, `apps/web/public/styles.css`
- Do not add direct SQLite or `tmp/` readers to `apps/web/`; go through `services/session-gateway/server.js` or `services/orchestrator/server.js`.

**New Terminal Operator Command:**
- Implementation: `packages/tui/src/cli/spore-ops.js`
- Backing data: prefer new routes in `services/orchestrator/server.js` or `services/session-gateway/server.js` instead of bypassing package/service boundaries.

**New Config Surface:**
- YAML source: matching folder under `config/`
- Schema: matching folder under `schemas/`
- Validation routing: `packages/config-schema/src/validate/load-schemas.js`
- Consumers: update the relevant loader such as `packages/orchestrator/src/invocation/plan-workflow-invocation.js` or `packages/orchestrator/src/scenarios/catalog.js`.

**New Docs Retrieval Behavior:**
- Index/search internals: `packages/docs-kb/src/`
- Canonical docs content: `docs/`
- Runtime hookup: `packages/runtime-pi/src/context/build-startup-context.js`

**Shared Helpers:**
- Put package-specific helpers inside the owning package first.
- Use `packages/core/`, `packages/shared/`, `packages/shared-config/`, or `packages/shared-types/` only when the helper is truly shared across multiple active boundaries; those directories contain `README.md` only and no active shared implementation is detected.

## Special Directories

**`tmp/`:**
- Purpose: Session plans, prompts, transcripts, control queues, RPC status files, execution briefs, and transient test-run artifacts.
- Generated: Yes
- Committed: Directory scaffold only; runtime files under `tmp/sessions/` and `tmp/orchestrator/` are generated working files.

**`data/`:**
- Purpose: Local durable SQLite/NDJSON state and docs index storage.
- Generated: Yes
- Committed: Directory scaffold is present; live files such as `data/state/spore-sessions.sqlite` and `data/docs-index/spore-docs.sqlite` are generated state.

**`artifacts/`:**
- Purpose: Retained derived outputs such as handoffs and regression artifacts.
- Generated: Yes
- Committed: Yes, as a tracked artifact area defined by `artifacts/README.md`.

**`workspace/`:**
- Purpose: Declarative workspace catalogs and templates outside the active runtime config tree.
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: Generated codebase mapping documents consumed by GSD planning/execution commands.
- Generated: Yes
- Committed: Yes

**Reserved Placeholder Boundaries:**
- Purpose: Hold future module boundaries without active implementation.
- Directories: `apps/cli/`, `packages/core/`, `packages/shared/`, `packages/shared-config/`, `packages/shared-types/`, `packages/web-ui/`, `services/indexer/`
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-09*
