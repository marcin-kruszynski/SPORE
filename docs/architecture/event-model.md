# Event Model

SPORE should be event-first for observability and coordination.

## Event Categories

- session lifecycle events,
- agent message events,
- tool execution events,
- workflow state events,
- review decision events,
- operator steering events,
- knowledge update events.

## Shared Metadata

- event id
- event type
- timestamp
- run id
- session id
- project id
- domain id
- workflow id
- agent identity id

## Design Principle

The event stream should support both human inspection and machine consumption without requiring a UI-specific format.

## Current Executable Slice

The repository now emits lifecycle events to `data/state/events.ndjson` through `packages/session-manager/`. The initial lifecycle sequence currently covers:

- `session.planned`
- `session.starting`
- `session.active`
- `session.completed`
- `session.failed`
- `session.stopped`

The current control sequence also covers:

- `session.stop_requested`
- `session.complete_requested`
- `session.steer`

The current workflow execution slice now emits workflow-level events in the orchestrator store, including:

- `workflow.execution.created`
- `workflow.execution.child_planned`
- `workflow.execution.branched`
- `workflow.execution.completed`
- `workflow.execution.escalated`
- `workflow.execution.paused`
- `workflow.execution.held`
- `workflow.execution.resumed`
- `workflow.step.planned`
- `workflow.step.started`
- `workflow.step.completed`
- `workflow.step.review_pending`
- `workflow.step.retry_scheduled`
- `workflow.step.failed`
- `workflow.review.recorded`
- `workflow.review.approved`
- `workflow.review.changes_requested`
- `workflow.review.rejected`
- `workflow.approval.recorded`
- `workflow.approval.approved`
- `workflow.approval.rework_requested`
- `workflow.approval.rejected`
- `workflow.escalation.resolved`

Review, approval, and escalation records remain persisted alongside those events for durable governance history.

Operator-facing filtering, artifact access, live follow, and control actions are now available through `session-manager` and `services/session-gateway/`.

`services/orchestrator/` now also exposes an SSE follow surface for workflow events:

- `GET /stream/executions?execution=<id>`

For `pi-rpc` runtime sessions, steering is now delivered through PI RPC rather than tmux text injection, while the event contract remains stable at the SPORE layer.

## Durable Workflow Event Guidance

Workflow events should be rich enough to reconstruct execution history without scraping runtime artifacts or making UI-specific assumptions.

Execution-level events should be able to carry optional lineage and coordination metadata such as:

- `executionId`
- `coordinationGroupId`
- `parentExecutionId`
- `branchKey`
- `state`
- `previousState`
- `holdReason`
- `pausedAt`
- `heldAt`
- `resumedAt`

Not every event needs every field. The durable rule is:

- use the smallest metadata set that explains the transition,
- keep identifiers stable across clients,
- prefer explicit workflow events over inference from session logs.

## Coordination And Recovery Events

As the durable execution model expands, workflow events should cover three related areas:

1. Coordination group activity
2. Execution lineage changes
3. Operator recovery controls

Expected event families include:

- coordination-group membership changes,
- execution branch or fork creation,
- pause and hold transitions,
- escalation resolution and resume,
- operator-directed recovery actions,
- eventual group-level drive or unblock actions.

The current executable subset already covers branch creation, pause/hold/resume, and escalation recovery, while broader coordination-group events may still arrive under a smaller initial contract. Clients should therefore treat newer coordination and recovery fields as optional.

Recommended interpretation guidance:

- `workflow.execution.child_planned` and `workflow.execution.branched` explain lineage changes,
- `workflow.execution.held` explains recoverable blocked work, not failure,
- `workflow.execution.paused` explains operator suspension,
- `workflow.execution.resumed` explains a return to the prior workflow lane after a recoverable interruption,
- future coordination-group events should add clarity, not redefine the meaning of existing execution events.

## Client Consumption Rules

Clients that render workflow history should:

- prefer persisted workflow events over polling derived state where possible,
- tolerate unknown event types,
- tolerate missing optional coordination metadata,
- avoid assuming that a parent execution always has loaded child details in the same payload,
- avoid treating `paused` or `held` as hard failures,
- avoid assuming that a coordination group always emits a separate group-level event for every execution-level change.

The workflow event stream is intended to support both current operator surfaces and future richer coordination views without requiring a separate browser-specific contract.
