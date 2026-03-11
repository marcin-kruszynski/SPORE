# ADR-0012: Conversation-First Operator Chat Surface

## Status

Accepted

## Context

SPORE already has durable self-build machinery:

- goal plans,
- work-item groups,
- work-item runs,
- proposal artifacts,
- validation bundles,
- promotion lanes,
- quarantine and override controls.

That backend model is strong, but operator contact with the orchestrator is still too manual. Running self-build currently requires too much route-by-route or CLI-by-CLI steering from the operator.

The missing layer is not another hidden automation engine. The missing layer is a simpler operator surface that lets the user say what they want, while the orchestrator owns the step-by-step flow and only stops when a real governance decision is required.

## Decision

SPORE adopts a conversation-first operator surface in Web UI and HTTP, backed by durable orchestrator state.

This surface will:

- let the operator start a mission in natural language,
- let the orchestrator convert that mission into existing self-build artifacts,
- let the orchestrator progress the flow automatically where policy allows,
- surface pending review, approval, and promotion decisions as durable action requests,
- let the operator respond either through chat messages or explicit action controls,
- give the operator one global inbox for pending decisions across active threads,
- support live thread streaming so one selected mission can update in place.

## Architectural Rules

### 1. Chat is a control surface, not the source of truth

Conversation state does not replace:

- goal plans,
- work-item groups,
- work-item runs,
- proposals,
- validation state,
- promotion state.

Those artifacts remain authoritative. Chat threads only coordinate and explain the flow.

### 2. Pending decisions must be durable

Operator-facing review gates are persisted as explicit pending actions, not inferred from transient chat text.

That means SPORE must persist:

- operator threads,
- operator messages,
- operator pending/resolved actions.

### 3. The orchestrator owns flow progression

When a thread is active, the orchestrator may:

- create a goal plan,
- request goal-plan review,
- materialize and run managed work,
- request proposal review,
- request proposal approval,
- run validation automatically when policy permits,
- request promotion decisions.

The operator should not need to manually stitch those steps together.

### 4. Governance remains explicit

Chat must not hide review and promotion boundaries.

When a human decision is required, the orchestrator must surface:

- what is waiting,
- why it is waiting,
- what the next valid choices are,
- which durable artifact the choice applies to.

### 5. The Web UI remains thin over HTTP contracts

The browser client should consume orchestrator chat routes, not local files or direct SQLite access.

## Implementation Shape

### Durable state

Add orchestrator-backed records for:

- `operator_threads`
- `operator_thread_messages`
- `operator_thread_actions`

### HTTP surface

Add orchestrator routes for:

- `GET /operator/threads`
- `POST /operator/threads`
- `GET /operator/threads/:id`
- `POST /operator/threads/:id/messages`
- `GET /operator/actions`
- `POST /operator/actions/:id/resolve`

### Web surface

Add a dedicated `Operator Chat` view in `apps/web/` with:

- thread list,
- conversation timeline,
- pending action cards,
- linked artifact context.

### Interaction model

The operator can:

- start a mission in freeform text,
- ask for status in freeform text,
- edit a pending goal plan in freeform text,
- answer pending gates with natural text such as `approve`, `reject`, `rework`, `quarantine`, `release`, `promote`, or `hold`,
- use explicit action buttons when they prefer structured controls.

The initial implemented edit semantics cover plan-shaping commands such as:

- `keep only docs`
- `drop 2`
- `prioritize operator-ui-pass`

## Reference Influence

`references/pi-mono/packages/web-ui` is useful as a design reference for:

- chat-centric layout,
- responsive sidecar/context panel behavior,
- message timeline plus composer ergonomics.

SPORE does not copy that implementation directly because SPORE Web UI is a plain HTML/TypeScript thin client rather than Lit components.

## Consequences

### Positive

- self-build becomes much easier to operate,
- the operator talks to one surface instead of memorizing many commands,
- governance stays durable and inspectable,
- Web UI becomes a real mission-control surface rather than only a drilldown dashboard.

### Negative

- orchestrator now owns more UX-facing state,
- thread/action synchronization adds another persistence layer,
- conversation routing still needs careful heuristics until richer intent handling is added.

## Non-Goals

- replacing self-build artifacts with chat history,
- letting chat bypass proposal, validation, or promotion contracts,
- auto-merging to `main`,
- making the UI depend on a remote black-box agent session to know system state.
