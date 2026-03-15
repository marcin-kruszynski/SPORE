# Workflow Handoffs Phase 2 Design

## Goal

Harden SPORE's durable workflow handoff system so structured outputs are validated and governed, fan-out consumption is tracked correctly, coordinator and integrator participate in the same contract, and operator surfaces expose enough detail to inspect failures and evidence without reading raw transcripts.

## Recommended Approach

Use a layered extension of the existing `workflow_handoffs` model rather than introducing a second artifact channel.

1. Validate handoff payloads at settle time using profile-driven policy.
2. Add explicit per-target consumption tracking for fan-out and broadcast handoffs.
3. Extend the normalized handoff contract to `coordinator` and `integrator`.
4. Deepen orchestrator, web, and TUI handoff inspection surfaces.

This preserves the current architecture while closing the largest semantic and operator gaps from Phase 1.

## Architecture

### 1. Handoff Enforcement

The current handoff pipeline allows fallback summaries when a role omits or malforms its structured block. Phase 2 keeps fallback artifacts for observability, but stops treating them as silently acceptable in all workflows.

Each profile's `handoffPolicy` becomes executable policy:

- `marker` remains the extraction boundary.
- `requiredSections` become mandatory for validation.
- a new enforcement mode determines what happens on invalid handoff output.

At step settle time the orchestrator computes a `handoffValidation` result containing:

- `valid: boolean`
- `mode: accept | review_pending | blocked`
- `issues: HandoffValidationIssue[]`
- `degraded: boolean`

Fallback summary handoffs remain possible only as explicit degraded outputs. They are durable evidence, not proof of contract compliance.

### 2. Fan-Out Consumption Semantics

Publication and consumption are separate concepts and should remain separate in storage.

- `workflow_handoffs` continues to store one published handoff record.
- a new `workflow_handoff_consumers` table tracks which downstream step consumed which handoff and when.

This allows one published handoff to be consumed by:

- one targeted step,
- many broadcast targets in the next compatible wave,
- optional future role groups without losing idempotency.

The canonical publication statuses remain attached to the handoff record. Consumption completion becomes derived from the consumer table rather than overloaded onto the publication row.

### 3. Full Role Chain Contract

`coordinator` and `integrator` join the same normalized model used by `lead`, `scout`, `builder`, `tester`, and `reviewer`.

Planned kinds:

- `coordinator -> routing_summary`
- `integrator -> integration_summary`

Both roles receive:

- profile-level `handoffPolicy`
- overlay prompts with the structured marker block requirement
- expected outbound contract in brief/runtime context
- inbound handoff selection like the other roles

This keeps planning, execution, promotion, and final landing evidence in one shared vocabulary.

### 4. Operator Surfaces

Operator-facing read models should expose more than summary cards.

Target surface behavior:

- execution list/detail returns handoff validation status and consumer counts,
- session live route shows handoff artifact descriptors plus validation metadata,
- web execution detail supports list + detail drilldown,
- TUI gets a dedicated handoff detail view instead of raw passthrough JSON.

Clients remain read-only over this data; validation and governance logic stay inside orchestrator read models.

## Data Flow

### Publish Path

1. Role session settles.
2. Orchestrator extracts the agent-output segment.
3. Orchestrator parses the structured handoff block.
4. Validation runs against the profile policy.
5. Orchestrator writes:
   - normalized `workflow_handoffs` publication row,
   - `tmp/sessions/<session>.handoff.json`,
   - validation metadata,
   - optional degraded summary if structured output is invalid.
6. Step outcome is adjusted if enforcement requires `review_pending` or `blocked`.

### Consume Path

1. Next step launch selects prior-wave compatible handoffs.
2. Orchestrator includes the selected handoffs in the brief and runtime context.
3. On successful downstream launch, per-target consumer rows are written.
4. Read models compute consumer coverage and unresolved handoff state from publication + consumer rows.

## Error Handling

### Invalid Handoff Output

Policy-driven outcomes:

- `accept`: publish degraded handoff, allow flow to continue.
- `review_pending`: publish degraded handoff, hold step for operator/reviewer attention.
- `blocked`: publish degraded handoff, block downstream progression.

### Missing Required Sections

Handled as validation issues, not parse crashes. The orchestrator should surface exact missing sections in read models and operator surfaces.

### Duplicate Reconciliation

Repeated reconcile must:

- upsert the same publication row,
- update the same sidecar artifact path,
- avoid duplicate consumer rows through unique `(handoff_id, consumer_step_id)` constraints.

## Testing Strategy

### Unit / Targeted

- structured-block validation
- degraded fallback behavior
- consumer bookkeeping
- role-to-kind mapping

### Execution Integration

- prior-wave selection
- multi-target broadcast consumption
- invalid handoff enforcement modes
- idempotent reconcile on repeated reads

### Role-Chain Coverage

- coordinator handoff publication/consumption
- integrator handoff publication/consumption

### Operator Surface Coverage

- execution handoff detail route
- session live handoff metadata
- web handoff drilldown rendering
- TUI handoff detail command

## Non-Goals

- arbitrary peer-to-peer agent messaging
- replacing proposal artifacts as the governance layer
- making UI clients own validation rules

## Rollout Plan

1. Enforce and validate current handoff chain.
2. Add fan-out consumer tracking.
3. Extend coordinator and integrator contracts.
4. Upgrade operator surfaces and tests.

This order minimizes risk: correctness first, then coverage, then UX depth.
