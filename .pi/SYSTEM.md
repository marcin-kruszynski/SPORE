# SPORE PI Context

SPORE is a documentation-first bootstrap repository for a future swarm orchestration platform.

## Working Rules

- Read `docs/INDEX.md` before major changes.
- Prefer updating canonical docs over creating duplicate fragments.
- Treat `references/` as study material, not implementation source.
- Keep runtime, orchestration, knowledge, and UI concerns separate.
- Stay PI-first for runtime planning, but avoid speculative multi-runtime abstractions.
- Use the real `pi` runtime when available and authenticated; only fall back to the stub launcher when blocked.
- Treat `services/session-gateway/` as the shared HTTP surface for client work.
- Treat `packages/orchestrator/` and `services/orchestrator/` as the source of truth for workflow execution state, workflow events, escalations, review, and approval.
- Treat merged domain policy from `config/domains/` and `config/projects/* activeDomains[]` as authoritative execution input for retries, watchdog thresholds, reviewer approval requirements, session mode, and startup retrieval.
- Treat `waiting_review` and `waiting_approval` as valid governance checkpoints rather than incomplete failures.
- Treat coordination-group lineage metadata and `paused`/`held` states as first-class execution concerns; clients should consume them through orchestrator APIs rather than deriving them from local files.
- Prefer explicit orchestrator read routes for execution detail, workflow events, and escalations before adding new storage readers.
- Resolve escalations and resume executions through orchestrator APIs or CLI rather than direct store edits.
- Prefer named validation flows from `docs/runbooks/scenario-library.md` when exercising orchestration behavior.
- Treat `config/scenarios/` and `config/regressions/` as the machine-readable source of truth for named scenario and regression runs.
- Prefer `GET /executions/:id/history` when a client or agent needs one combined workflow history payload.
- Prefer `GET /sessions/:id/live` when a client or agent needs one combined live session payload.
- Use `SPORE_ORCHESTRATOR_DB_PATH`, `SPORE_SESSION_DB_PATH`, and `SPORE_EVENT_LOG_PATH` for isolated local test state when needed.

## Important Locations

- Docs hub: `docs/INDEX.md`
- Architecture: `docs/architecture/`
- Decisions: `docs/decisions/`
- Config examples: `config/`
- Workspace composition examples: `workspace/`
- Retrieval planning: `tools/docsearch/` and `packages/docs-kb/`
- Local environment setup: `docs/runbooks/local-dev.md`
- Canonical scenarios: `docs/runbooks/scenario-library.md`
- Scenario catalog: `config/scenarios/`
- Regression catalog: `config/regressions/`
- Runtime integration: `packages/runtime-pi/`
- Session lifecycle: `packages/session-manager/`
- Session gateway: `services/session-gateway/`
- Orchestrator execution: `packages/orchestrator/`
