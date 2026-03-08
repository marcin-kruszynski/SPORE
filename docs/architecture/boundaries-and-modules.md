# Boundaries And Modules

SPORE should maintain explicit seams between knowledge, configuration, execution, client surfaces, and runtime integration.

## Module Boundaries

- `packages/core/`: shared orchestration concepts and contracts.
- `packages/config-schema/`: validation and config-loading boundaries.
- `packages/runtime-pi/`: PI-specific runtime integration.
- `packages/orchestrator/`: future orchestration policy and execution coordination.
- `packages/session-manager/`: future session lifecycle and metadata handling.
- `packages/tui/`: operator-oriented terminal experiences.
- `packages/web-ui/`: future browser-facing operator interface.
- `packages/docs-kb/`: documentation indexing and retrieval.
- `packages/shared/`: utility types, helpers, and shared primitives.

## Boundary Rules

- Knowledge retrieval should not be hidden inside orchestrator logic.
- Session metadata and event contracts should not be UI-specific.
- Client surfaces should not own domain logic.
- Runtime-specific details should not leak into project or workflow configuration without an explicit adapter layer.
