# Coordinator Hardening Design

## Goal

Make the SPORE `coordinator` role a first-class, operator-visible project execution owner without weakening the existing `integrator` promotion boundary.

## Why This Change

SPORE already models `orchestrator -> coordinator -> lead -> integrator`, but the coordinator is stronger in architecture than in daily operator experience.

Today, coordinator behavior is spread across execution metadata, project-role workflow planning, self-build thread synthesis, and promotion readiness logic. The pieces exist, but operators still infer project-level coordination indirectly from executions, proposals, and thread state instead of reading one explicit coordinator-owned summary.

This design hardens coordinator semantics and makes them visible through durable read models and operator surfaces.

## Non-Goals

- Do not collapse `integrator` into `coordinator`.
- Do not make coordinator the merge or promotion owner.
- Do not replace execution-store truth with transcript parsing or peer-to-peer messaging.
- Do not introduce a large new prompt/profile platform before the coordinator contract is stable.

## Target Role Boundaries

### Orchestrator

- owns portfolio-level control and workflow selection,
- chooses project-root workflows,
- starts coordinator-root families or direct lead-only flows where appropriate,
- does not become the per-project detail lane.

### Coordinator

- owns one project-root execution family,
- owns routing across project lead lanes,
- owns project-level blockers and escalation aggregation,
- owns readiness summary for validation and promotion handoff,
- remains read-mostly by default,
- does not own merge or promotion execution.

### Lead

- owns one domain or workstream lane,
- decomposes local work,
- invokes downstream lanes,
- reports upward through durable handoffs.

### Integrator

- remains the only role that owns integration and promotion execution,
- consumes coordinator-family readiness and promotion sources,
- remains the merge boundary.

## Architecture

### 1. Coordinator Summary As A First-Class Read Model

Add a coordinator-family read model derived from the execution family, escalations, project-role metadata, and durable handoffs.

The model should not be inferred ad hoc in every surface. It should be built once and reused.

Minimum shape:

```ts
type CoordinatorFamilyStatus =
  | "planned"
  | "running"
  | "held"
  | "paused"
  | "waiting_review"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

type CoordinationMode =
  | "delivery"
  | "project-breakdown"
  | "brownfield-intake";

interface CoordinatorSummary {
  rootExecutionId: string;
  familyKey: string | null;
  projectId: string;
  objective: string | null;
  coordinationMode: CoordinationMode;
  status: CoordinatorFamilyStatus;
  readiness: {
    leadLanesSettled: boolean;
    validationReady: boolean;
    promotionReadyForIntegrator: boolean;
    operatorDecisionRequired: boolean;
  };
  leadLanes: Array<{
    executionId: string;
    domainId: string | null;
    role: string;
    status: CoordinatorFamilyStatus;
    blocked: boolean;
    latestTaskBrief: string | null;
    latestVerificationSummary: string | null;
    latestReviewSummary: string | null;
  }>;
  integratorLane: {
    executionId: string;
    status: CoordinatorFamilyStatus;
    promotionStatus: string | null;
  } | null;
  blockers: Array<{
    kind: string;
    severity: string;
    ownerRole: string | null;
    summary: string;
  }>;
  pendingDecisions: Array<{
    kind: string;
    label: string;
    reason: string;
  }>;
  latestRoutingSummary: {
    summary: string | null;
    nextActions: string[];
  } | null;
}
```

This becomes the stable project-root coordination object used by HTTP, Operator Chat, and later WebUI.

Canonical identifier rule:

- `rootExecutionId` is the canonical route identifier for coordinator-family reads.
- `familyKey` is an optional stable grouping key derived from existing lineage, such as `coordinationGroupId`, when available.

### 2. Stronger Coordinator Execution Semantics

Coordinator semantics must become explicit, not implied:

- project-root execution with `projectRole=coordinator` is the family owner,
- child lead executions are the authoritative downstream lanes,
- family-level blockers are aggregated upward at the coordinator root,
- promotion readiness is summarized at the coordinator family level strictly as an `integrator` handoff signal,
- integrator planning reads the family summary instead of reconstructing project state indirectly.

The key shift is that a coordinator family has its own stable readiness and blocker contract.

The coordinator family summary must represent the integrator lane separately from lead lanes.

- `leadLanes[]` are domain/workstream lanes owned by the coordinator.
- `integratorLane` is a distinct project lane that remains outside lead ownership.
- `promotionReadyForIntegrator` means only that the coordinator family is ready for integrator planning or invocation. It is not merge authority, promotion ownership, or final integration state.

### 3. Operator-Facing Coordinator Surfaces

Expose coordinator summary through dedicated read APIs and existing operator surfaces.

Recommended new HTTP routes:

- `GET /coordination-families/:rootExecutionId`
- `GET /coordination-families/:rootExecutionId/lanes`
- `GET /coordination-families/:rootExecutionId/readiness`

Existing execution and operator-thread payloads should also expose a `coordination` section or links to this family summary.

Operator Chat should display:

- project family owner,
- lead lane status,
- current blockers,
- pending operator decisions,
- readiness for validation or promotion.

### 4. Lightweight Coordinator Workflow Modes

Add explicit `coordinationMode` metadata and config support, but keep it small and durable.

Initial modes:

- `delivery`
- `project-breakdown`
- `brownfield-intake`

These should be execution metadata and workflow/config inputs, not freeform prompt strings. They should alter planner behavior, coordinator summary labeling, and operator surfaces.

The first version does not need a full profile framework. It only needs enough structure to let SPORE intentionally start coordinator-root families in different modes.

## Data Flow

```text
operator objective
  -> orchestrator chooses project-root workflow + coordinationMode
  -> coordinator root execution starts
  -> coordinator creates or owns lead child lanes
  -> leads emit task_brief / implementation / verification / review handoffs
  -> coordinator aggregates family summary, blockers, readiness
  -> operator surfaces read coordinator summary directly
  -> integrator planning reads coordinator-family readiness when promotion begins
```

## Integration With Existing SPORE Boundaries

- `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
  - extend project-root metadata with `coordinationMode`
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
  - centralize family-level readiness and blocker aggregation
- `packages/orchestrator/src/execution/execution-metadata.ts`
  - expose coordinator-family metadata as stable read-side helpers
- `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - stop deriving project coordination entirely from proposals and runs alone
- `services/orchestrator/server.ts`
  - add coordinator-family endpoints

## Testing Strategy

### Unit / Integration

- coordinator-family summary builder tests,
- readiness aggregation tests,
- blocker aggregation tests,
- planner tests for `coordinationMode`,
- execution metadata tests for project-root families.

### HTTP

- dedicated tests for new coordination-family routes,
- existing project-role tests extended to assert coordinator summary fields,
- operator-thread tests asserting coordinator links and pending decision summaries.

### Operator / WebUI

- if WebUI is updated in this phase, add tests ensuring coordinator summary renders family state clearly.

## Phased Delivery

### Phase 1: Coordinator Semantics Hardening

- define coordinator-family read model,
- compute blockers/readiness centrally,
- stabilize metadata contract.

### Phase 2: HTTP And Operator Surfaces

- add coordinator-family endpoints,
- link coordinator summaries into execution and operator-thread responses,
- expose family-level pending decision summaries.

### Phase 3: Workflow Modes

- add `coordinationMode` to planning/config,
- support at least `delivery`, `project-breakdown`, and `brownfield-intake`.

### Phase 4: Operator UX Polish

- present coordinator-centric project summaries in operator-facing surfaces,
- reduce operator need to infer state from raw executions/proposals.

## Success Criteria

- coordinator is visible as the project execution owner in HTTP and operator surfaces,
- operator can inspect one coordinator-family summary instead of reconstructing project state manually,
- family blockers and readiness are explicit,
- integrator remains the sole promotion/merge boundary,
- at least one additional coordinator mode beyond default delivery is represented as explicit execution/config metadata.
