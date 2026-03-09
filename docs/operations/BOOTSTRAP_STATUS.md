# Bootstrap Status

## Current State

Bootstrap foundation is complete enough to support the next implementation phase.

## Completed Areas

- repository structure and git initialization
- local reference mirror setup and manifesting
- documentation operating system with index and machine-readable manifest
- architecture, governance, and roadmap documents
- configuration and workspace composition seeds
- schema placeholders for session and event contracts
- PI-specific local context scaffolding
- SQLite-backed docs-kb indexing and retrieval
- config validation CLI for `config/`
- runtime-pi session planning CLI
- session metadata store and lifecycle event log
- runtime harness that creates session plans, startup context, and lifecycle transitions
- tmux-backed launcher path with PI-or-stub runtime selection
- PI JSON event capture and session artifact generation
- PI RPC launcher path with control-queue-driven steering and abort handling
- lightweight terminal operator dashboard and session inspection commands
- reconcile sweep and watch loop for detached sessions
- HTTP session gateway for status, session, event, artifact, stream, and control queries
- minimal browser-based operator console over the gateway and orchestrator proxy
- durable orchestrator execution store with step/review/approval state
- domain-specific workflow, runtime, and docs-kb policy integration through `config/domains/*.yaml` and project `activeDomains[]`
- browser execution tree, event timeline, and governance controls over orchestrator APIs
- workflow event store and escalation records for durable execution history
- retry and rework branching inside a single workflow execution
- live workflow event follow through orchestrator SSE
- operator resolution and resume for escalated executions
- coordination-group reads and parent/child execution lineage in durable orchestrator state
- workflow-level pause, hold, resume, fork, and group-drive controls
- operator-facing state model that distinguishes recoverable interruption states such as `paused` and `held`
- policy-driven defaults for role selection, retry attempts, watchdog thresholds, reviewer governance, per-role session mode, and docs-kb startup retrieval
- isolated local state overrides through `SPORE_ORCHESTRATOR_DB_PATH`, `SPORE_SESSION_DB_PATH`, and `SPORE_EVENT_LOG_PATH`
- canonical scenario library for backend, frontend, CLI, and docs validation flows
- machine-readable scenario and regression catalogs under `config/scenarios/` and `config/regressions/`
- durable scenario-run and regression-run history in orchestrator SQLite
- combined execution history surface and scenario-run artifact summaries
- durable scenario-run and regression-run reads by run id, rerun routes, and trend summaries
- regression report artifacts under `artifacts/regressions/`
- session-gateway combined live inspection with derived diagnostics and suggested recovery actions
- local regression suites split into `test:policy`, `test:http`, `test:web-proxy`, `test:tui`, `test:all-local`, and opt-in `test:e2e:pi`

## Ready Areas

- documentation-first project work
- architecture refinement through ADRs and research notes
- config schema enforcement
- docs retrieval during implementation work
- PI runtime integration planning with executable session plans
- terminal-first session inspection through session-manager commands
- session/event access and control hooks for a future Web UI or automation client
- durable workflow history as the source of truth for operator recovery
- forward-compatible browser and API contracts for lineage-aware and coordination-aware execution views
- durable grouped-work inspection without scraping runtime artifacts directly
- project-specific domain tuning without forking workflow templates
- isolated test and demo runs without contaminating shared SQLite state

## Skeleton-Only Areas

- `packages/runtime-pi/`
- `packages/orchestrator/`
- `packages/session-manager/`
- `packages/docs-kb/`
- `apps/web/`
- `apps/cli/`
- `services/session-gateway/`

## Explicitly Not Implemented Yet

- final orchestration scheduler
- durable queueing or broker
- production event transport
- production Web UI
- production CLI
- live session streaming bridge
- full review automation engine
- production-grade web client architecture
- fully policy-driven coordination-group scheduling
- final execution-graph visualization across grouped workflows
- durable hold ownership, timeout, and escalation policies

## Next Steps

1. Build operator-facing run-center views over durable scenario runs, regression runs, and report artifacts.
2. Add rerun workflows, retention policies, and scheduling for reusable regression profiles.
3. Extend trend analysis, failure classification, and recovery guidance over durable run history.
4. Continue broadening real PI coverage from canonical scenario runs into grouped regression profiles.

## Architectural Risks

- contract drift between docs and future code if validation does not arrive early,
- knowledge sprawl if index maintenance is not automated,
- premature runtime work before event and session contracts stabilize,
- client assumptions that treat optional coordination metadata as universally available,
- state-model drift if `paused`, `held`, governance stops, and terminal failures are not kept distinct,
- accidental coupling between execution-group behavior and session-level lifecycle assumptions.

## Largest Unknowns

- local embedding backend choice,
- minimal event transport for first live inspection loop,
- final coordination policy for when parent executions auto-hold, auto-resume, or require operator confirmation,
- the long-term operator contract for group-level recovery and unblock actions.
