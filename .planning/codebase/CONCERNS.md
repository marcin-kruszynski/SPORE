# Codebase Concerns

**Analysis Date:** 2026-03-09

## Tech Debt

**HTTP service layer coupled to CLI subprocesses:**
- Issue: `services/orchestrator/server.js` handles many read and write routes by spawning `node packages/orchestrator/src/cli/spore-orchestrator.js ...` through `runCli()`, so HTTP correctness depends on CLI stdout staying machine-parseable JSON.
- Files: `services/orchestrator/server.js`, `packages/orchestrator/src/cli/spore-orchestrator.js`
- Impact: every request pays process-start overhead, error handling is indirect, and accidental CLI logging can break API responses.
- Fix approach: move route handlers onto library functions from `packages/orchestrator/src/` and keep the CLI as a thin wrapper.

**Large multi-responsibility hotspots:**
- Issue: core behavior is concentrated in very large files: `apps/web/public/app.js` (~6405 lines), `packages/orchestrator/src/execution/workflow-execution.js` (~2852 lines), `packages/orchestrator/src/scenarios/run-history.js` (~2218 lines), `packages/orchestrator/src/store/execution-store.js` (~2159 lines), `services/orchestrator/server.js` (~1181 lines), `packages/orchestrator/src/cli/spore-orchestrator.js` (~1129 lines), and `packages/tui/src/cli/spore-ops.js` (~1065 lines).
- Files: `apps/web/public/app.js`, `packages/orchestrator/src/execution/workflow-execution.js`, `packages/orchestrator/src/scenarios/run-history.js`, `packages/orchestrator/src/store/execution-store.js`, `services/orchestrator/server.js`, `packages/orchestrator/src/cli/spore-orchestrator.js`, `packages/tui/src/cli/spore-ops.js`
- Impact: small changes have wide blast radius, onboarding cost stays high, and branch conflicts are likely in active areas.
- Fix approach: split by feature boundary first (`execution`, `governance`, `history`, `self-build`, `run-center`, `web panels`) before adding more behavior.

**Documentation governance drift:**
- Issue: primary docs disagree on current system state. `docs/architecture/system-overview.md` still says layers 3-5 are only scaffolded, while `docs/operations/BOOTSTRAP_STATUS.md` documents implemented runtime, gateway, orchestrator, web, and TUI surfaces.
- Files: `docs/architecture/system-overview.md`, `docs/operations/BOOTSTRAP_STATUS.md`
- Impact: planning agents can load stale architecture guidance and under- or over-scope changes.
- Fix approach: resync the canonical architecture docs whenever operator/runtime capabilities change.

**ADR/index drift and duplicate numbering:**
- Issue: `docs/decisions/` contains both `docs/decisions/ADR-0001-project-scope.md` and `docs/decisions/ADR-0001-repo-foundation.md`, while `docs/index/docs_manifest.yaml` omits `docs/decisions/ADR-0001-repo-foundation.md` and `docs/decisions/ADR-0003-documentation-governance.md`.
- Files: `docs/decisions/ADR-0001-project-scope.md`, `docs/decisions/ADR-0001-repo-foundation.md`, `docs/decisions/ADR-0003-documentation-governance.md`, `docs/index/DOCS_INDEX.md`, `docs/index/docs_manifest.yaml`, `AGENTS.md`
- Impact: ADR lookup is ambiguous, manifest-driven tooling misses real decisions, and repository rules in `AGENTS.md` are not enforced by the current docs set.
- Fix approach: renumber ADRs uniquely, resync `docs/index/docs_manifest.yaml`, and add a docs validation check for duplicate ADR ids and missing manifest entries.

**Custom YAML subset parser:**
- Issue: `packages/config-schema/src/yaml/parse-yaml.js` implements a hand-rolled parser, and `packages/config-schema/README.md` explicitly states it supports only a pragmatic YAML subset.
- Files: `packages/config-schema/src/yaml/parse-yaml.js`, `packages/config-schema/README.md`
- Impact: valid YAML features can fail unexpectedly as `config/` grows more expressive, creating hard-to-debug config drift between author intent and parsed output.
- Fix approach: replace the parser with a maintained YAML library or formally constrain the allowed subset and test it exhaustively.

## Known Bugs

**Self-build summaries silently truncate data:**
- Symptoms: `getSelfBuildSummary()` only loads the first 100 work items, 50 groups, 100 proposals, and 100 learning records; `listWorkItemGroupsSummary()` and `getWorkItemGroupSummary()` only inspect the first 500 work items; `getRunCenterSummary()` only loads `limit * 2` work items.
- Files: `packages/orchestrator/src/self-build/self-build.js`, `packages/orchestrator/src/scenarios/run-history.js`
- Trigger: larger self-build history, older work items, or groups that exceed the hard-coded caps.
- Workaround: query item-, group-, run-, or proposal-specific endpoints directly instead of relying on aggregate summaries.

**Session control idempotency is best-effort, not race-safe:**
- Symptoms: `handleActionRequest()` checks for an existing idempotency key and then inserts a new request in a separate step, while `packages/session-manager/src/store/session-store.js` creates a non-unique index for `(session_id, action, idempotency_key)`.
- Files: `services/session-gateway/server.js`, `packages/session-manager/src/store/session-store.js`
- Trigger: concurrent retries, duplicate clicks, or overlapping client retries against `/sessions/:id/actions/*`.
- Workaround: serialize client retries; do not rely on server-side idempotency to prevent duplicate side effects under concurrency.

**Canonical architecture overview is stale:**
- Symptoms: `docs/architecture/system-overview.md` says runtime/orchestration, session/observability, and client layers are scaffolded only, but the repository contains active implementations under `packages/runtime-pi/`, `packages/session-manager/`, `packages/orchestrator/`, `services/session-gateway/`, `services/orchestrator/`, `apps/web/`, and `packages/tui/`.
- Files: `docs/architecture/system-overview.md`, `packages/runtime-pi/README.md`, `packages/session-manager/README.md`, `packages/orchestrator/README.md`, `services/session-gateway/README.md`, `services/orchestrator/README.md`, `apps/web/README.md`
- Trigger: architecture review or planning that treats `docs/architecture/system-overview.md` as the only source.
- Workaround: cross-check `docs/operations/BOOTSTRAP_STATUS.md` and package/service READMEs before planning changes.

## Security Considerations

**Unauthenticated mutation surfaces:**
- Risk: no authentication or authorization checks are present on mutating routes such as `POST /executions/*`, `POST /work-items*`, `POST /proposal-artifacts/*`, and `POST /sessions/:id/actions/*`.
- Files: `services/orchestrator/server.js`, `services/session-gateway/server.js`, `apps/web/server.js`
- Current mitigation: all three servers default to `127.0.0.1` (`SPORE_ORCHESTRATOR_HOST`, `SPORE_GATEWAY_HOST`, `SPORE_WEB_HOST`).
- Recommendations: add explicit auth/authz middleware before any non-local deployment and fail closed when the host is widened beyond localhost.

**Raw artifact and transcript exposure over HTTP:**
- Risk: `services/session-gateway/server.js` serves transcript, context, PI event, control, exit, and RPC status artifacts through `/sessions/:id/artifacts/*` and includes them in `/sessions/:id/live` payload assembly.
- Files: `services/session-gateway/server.js`, `apps/web/README.md`
- Current mitigation: artifact names are whitelisted and the gateway binds to localhost by default.
- Recommendations: add endpoint-level auth, redact sensitive artifact classes, and separate operator-readable artifacts from raw runtime traces.

**Integrity checks rely on application code:**
- Risk: `packages/orchestrator/src/store/execution-store.js` and `packages/session-manager/src/store/session-store.js` create related tables without `FOREIGN KEY` constraints, unlike `packages/docs-kb/src/store/sqlite-store.js` which enables `PRAGMA foreign_keys = ON`.
- Files: `packages/orchestrator/src/store/execution-store.js`, `packages/session-manager/src/store/session-store.js`, `packages/docs-kb/src/store/sqlite-store.js`
- Current mitigation: caller code attempts to write related rows consistently.
- Recommendations: add foreign keys where the model is stable, plus integrity checks for orphaned executions, steps, reviews, approvals, runs, and control records.

## Performance Bottlenecks

**Per-request Node process spawning:**
- Problem: `services/orchestrator/server.js` spawns a fresh Node process for many GET and POST routes through `runCli()`.
- Files: `services/orchestrator/server.js`, `packages/orchestrator/src/cli/spore-orchestrator.js`
- Cause: the HTTP layer delegates to CLI commands instead of calling in-process library functions.
- Improvement path: move to direct imports and keep only operator-facing formatting in the CLI layer.

**Full event-log reads on hot session routes:**
- Problem: `readEvents()` reads and parses the entire NDJSON event log into memory, and hot routes such as `/status`, `/events`, `/sessions/:id`, `/sessions/:id/live`, and the SSE initial snapshot call it directly.
- Files: `packages/session-manager/src/events/event-log.js`, `services/session-gateway/server.js`
- Cause: the event store is append-only on disk, but most read paths still rebuild full in-memory arrays.
- Improvement path: add indexed event storage or offset-based reads for all routes, not only streaming follow mode.

**Execution SSE polling rereads full history:**
- Problem: `/stream/executions` polls every second and calls `listExecutionEvents(executionId)`, which returns the entire event history before the server filters new events in memory.
- Files: `services/orchestrator/server.js`, `packages/orchestrator/src/execution/workflow-execution.js`, `packages/orchestrator/src/store/execution-store.js`
- Cause: event polling is implemented as repeated full-history reads rather than incremental cursors.
- Improvement path: add `event_index > ?` queries or durable SSE cursor support in `packages/orchestrator/src/store/execution-store.js`.

**Synchronous SQLite and N+1 summary reads on request paths:**
- Problem: `DatabaseSync` backs both `packages/orchestrator/src/store/execution-store.js` and `packages/session-manager/src/store/session-store.js`, while summary builders repeatedly open databases and nest per-item lookups.
- Files: `packages/orchestrator/src/store/execution-store.js`, `packages/session-manager/src/store/session-store.js`, `packages/orchestrator/src/work-items/work-items.js`, `packages/orchestrator/src/self-build/self-build.js`, `packages/orchestrator/src/scenarios/run-history.js`
- Cause: synchronous DB access blocks the event loop and summary code performs repeated per-item scans such as `listWorkItems(...).map((item) => listWorkItemRuns(...))`.
- Improvement path: batch summary queries, paginate results, and move hot HTTP paths away from synchronous fan-out reads.

## Fragile Areas

**Workflow execution state machine:**
- Files: `packages/orchestrator/src/execution/workflow-execution.js`, `packages/orchestrator/src/lifecycle/execution-lifecycle.js`
- Why fragile: planning, creation, retries, governance, pause/hold/resume, branch spawning, tree actions, escalations, and reconciliation all converge here.
- Safe modification: change one transition family at a time and verify with both `packages/orchestrator/test/*.test.js` and `services/orchestrator/test/*.test.js`.
- Test coverage: partial; policy, lineage, and governance cases exist, but there is no exhaustive transition matrix for all state combinations.

**Single-file web operator console:**
- Files: `apps/web/public/app.js`, `apps/web/public/index.html`, `apps/web/server.js`
- Why fragile: the UI keeps one large global `state`, one large DOM registry, route proxy logic, renderers, event handlers, and polling logic in a single browser script.
- Safe modification: extract feature-local render/data helpers before adding more operator surfaces.
- Test coverage: no `*.test.js` files were detected under `apps/web/`.

**Failure classification and operator recommendations:**
- Files: `packages/orchestrator/src/scenarios/run-history.js`
- Why fragile: failure types are inferred from message substring heuristics (`auth`, `provider`, `api key`, `pi`, `launcher`, `rpc`, `gateway`, `control`, `timeout`, `stuck`, `stall`, `held`).
- Safe modification: emit structured failure codes from lower layers and keep `run-history` as a formatter, not a classifier.
- Test coverage: scenario HTTP and PI tests exercise happy-path summaries, but no dedicated classification matrix was detected.

**Schema and migration handling:**
- Files: `packages/orchestrator/src/store/execution-store.js`, `packages/session-manager/src/store/session-store.js`
- Why fragile: schema evolution uses ad hoc `ALTER TABLE` helpers, many JSON columns, and implicit caller-managed relationships.
- Safe modification: add a versioned migration layer and integrity tests before widening table relationships further.
- Test coverage: store behavior is covered mostly indirectly through higher-level tests.

## Scaling Limits

**Session event storage:**
- Current capacity: one append-only NDJSON log at `SPORE_EVENT_LOG_PATH`, with many read paths rebuilding the full event array from disk.
- Limit: large event volumes increase memory use and route latency for `services/session-gateway/server.js`.
- Scaling path: move hot reads to indexed storage or durable cursors while keeping NDJSON as an export/debug artifact.

**Self-build and run-center aggregates:**
- Current capacity: aggregate views in `packages/orchestrator/src/self-build/self-build.js` and `packages/orchestrator/src/scenarios/run-history.js` cap records at 50-500 rows.
- Limit: operator dashboards become incomplete before the underlying store is actually full.
- Scaling path: add pagination, explicit totals, and “truncated” markers so operator surfaces stay truthful at larger history sizes.

**Group execution throughput:**
- Current capacity: `runWorkItemGroup()` runs items sequentially in one process and handles dependencies in a single pass.
- Limit: large groups block on long items, cannot parallelize safe branches, and remain sensitive to partial failure ordering.
- Scaling path: introduce queue-backed scheduling and dependency-aware group orchestration, matching the follow-up work already called out in `docs/plans/self-build-status-and-next-steps.md`.

## Dependencies at Risk

**Local PI/tmux runtime toolchain:**
- Risk: the real runtime path depends on local `pi` and `tmux`, and real end-to-end tests skip when `SPORE_RUN_PI_E2E` or `SPORE_RUN_PI_CONTROL_E2E` are not enabled or when `pi` is unavailable.
- Files: `docs/runbooks/local-dev.md`, `packages/runtime-pi/test/pi-rpc-smoke.test.js`, `packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.js`, `services/session-gateway/test/real-pi-session-control.e2e.test.js`
- Impact: local and CI validation can appear healthy while the highest-value runtime path remains unverified.
- Migration plan: preserve stub coverage, but add regular real-PI validation and surface degraded-mode status explicitly in operator summaries.

## Missing Critical Features

**Durable queueing, brokered execution, and production event transport:**
- Problem: current docs explicitly state that the final scheduler, durable queueing/broker, and production event transport are not implemented.
- Blocks: reliable long-running orchestration, higher concurrency, and service-grade execution recovery.
- Files: `docs/operations/BOOTSTRAP_STATUS.md`, `docs/index/DOCS_INDEX.md`

**Production-grade operator surfaces and hold governance:**
- Problem: current docs explicitly mark production Web UI, production CLI, and durable hold ownership/timeout/escalation policies as not implemented.
- Blocks: secure multi-operator use, clearer interruption ownership, and predictable recovery workflows.
- Files: `docs/operations/BOOTSTRAP_STATUS.md`, `docs/plans/self-build-status-and-next-steps.md`

## Test Coverage Gaps

**Untested browser operator surface:**
- What's not tested: direct behavior in `apps/web/public/app.js` and `apps/web/server.js`.
- Files: `apps/web/public/app.js`, `apps/web/server.js`
- Risk: UI regressions, proxy regressions, and operator-flow breakage can land without automated detection.
- Priority: High

**Untested config parser edge cases:**
- What's not tested: the custom YAML parser in `packages/config-schema/src/yaml/parse-yaml.js`; no `*.test.js` files were detected under `packages/config-schema/`.
- Files: `packages/config-schema/src/yaml/parse-yaml.js`
- Risk: configuration parsing regressions can break planning/runtime setup before schema validation even runs.
- Priority: High

**Indirectly tested self-build aggregation and classification logic:**
- What's not tested: summary truncation paths, aggregate recommendation logic, and failure-classification branches in `packages/orchestrator/src/self-build/self-build.js` and `packages/orchestrator/src/scenarios/run-history.js`.
- Files: `packages/orchestrator/src/self-build/self-build.js`, `packages/orchestrator/src/scenarios/run-history.js`
- Risk: operator dashboards can under-report problems or present misleading recommendations without failing the existing happy-path suites.
- Priority: Medium

---

*Concerns audit: 2026-03-09*
