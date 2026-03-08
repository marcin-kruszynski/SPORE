# Clients And Surfaces

SPORE should support multiple clients over one shared domain model.

## Surfaces

- CLI for direct control and scripting.
- TUI for live operator inspection.
- Web UI for broader visibility and structured management.
- Future automation or API clients for integration.

## Constraint

No client should redefine the meaning of sessions, events, projects, or profiles. Those concepts belong in shared contracts and architecture docs.

## Current Executable Slice

The repository now exposes three concrete surfaces over the shared session model:

- `packages/session-manager/` for terminal lifecycle and event operations,
- `packages/tui/` for operator dashboard and per-session inspection,
- `services/session-gateway/` for HTTP access to status, sessions, events, artifacts, streams, and narrow control actions.

The repository also includes:

- `services/orchestrator/` for workflow planning and invocation entrypoints,
- `apps/web/`, a thin browser client that consumes gateway and orchestrator APIs through local proxies.

The current browser surface now renders:

- durable execution list and execution detail,
- step/session tree view,
- execution lineage hints when payloads include parent/child relationships,
- coordination-group hints when payloads include grouping metadata,
- paused and held execution states as operator states distinct from failure,
- review and approval history,
- workflow event timeline and escalation history,
- review, approval, and drive controls through orchestrator APIs,
- coordination-group list/detail and child-lineage reads when those surfaces are available,
- workflow-level pause, hold, and resume controls through orchestrator APIs,
- escalation resolve and resume controls through orchestrator APIs,
- live execution follow through the orchestrator SSE stream.

That split keeps the state model centralized while allowing future CLI and Web UI work to grow from the same contracts.

## Thin-Client Rule

The browser surface should remain thin over shared APIs.

Clients should:

- consume `services/session-gateway/` and `services/orchestrator/`,
- avoid reading local SQLite or session files directly,
- tolerate partial payloads while backend capabilities are still expanding,
- render optional lineage and coordination metadata when present,
- avoid hard-coding assumptions about a single linear execution path,
- distinguish between runtime-session control and workflow-execution control.

## Optional Payload Fields For Emerging Coordination Views

To support the next operator surfaces without breaking older payloads, clients may optionally consume fields such as:

- `coordinationGroupId`
- `parentExecutionId`
- `childExecutionIds`
- `branchKey`
- `holdReason`
- `pausedAt`
- `heldAt`
- `resumedAt`

These fields should be treated as enhancements, not as mandatory contract requirements for every execution payload.

Current orchestrator read surfaces are expanding toward:

- execution detail,
- execution children,
- coordination-group list/detail,
- execution event history,
- execution escalation history,
- execution and group-level drive actions.

Clients should therefore prefer explicit orchestrator read and control routes over reconstructing groups from raw event streams.

## Operator Recovery Surface Expectations

The current executable foundation already exposes operator recovery concepts through review, approval, escalation resolution, and resume flows.

As the workflow model grows, clients should present those controls in a way that distinguishes:

- governance review actions,
- approval actions,
- runtime session control actions,
- workflow-level interruption or recovery actions such as pause, hold, resume, and coordination-group operations.

That distinction keeps the operator surface understandable as the system moves from a single execution lane toward grouped and lineage-aware execution management.

The recommended operator reading of execution states is:

- `waiting_review` and `waiting_approval` are governance stops,
- `paused` is an intentional operator suspension,
- `held` is a recoverable blocked state, often tied to coordination or dependency waiting,
- `failed`, `rejected`, and `canceled` remain true terminal outcomes.
