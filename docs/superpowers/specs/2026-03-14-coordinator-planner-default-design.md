# Coordinator Planner-First Default Design

## Goal

Make planner-driven decomposition the default project-scoped coordination schema in SPORE, so the coordinator no longer dispatches the same high-level objective directly to multiple domain leads. Instead, the coordinator first delegates planning to a dedicated planner role, receives a durable cross-domain execution plan, and only then dispatches domain-scoped work to leads in dependency-aware order.

## Problem

Coordinator hardening made the project-root family visible and operator-friendly, but the current coordinator flow still has one architectural weakness for multi-domain work:

- the coordinator selects domains,
- immediately spawns one lead lane per selected domain,
- and each lead receives essentially the same project-level objective plus domain context.

That works for simple work, but becomes weak for multi-domain features, brownfield changes, cross-domain contracts, or dependency-heavy tasks. In those cases SPORE needs a durable planning pass before execution fan-out.

## Design Principles

- keep `integrator` as the only promotion owner,
- keep `coordinator` as the family owner and dispatch owner,
- add a separate `planner` role rather than overloading the coordinator,
- use durable execution artifacts instead of transcript inference,
- start with coordinator push-dispatch, not lead pull-queues,
- make this the default for project-root coordination paths.

## Target Topology

```text
operator objective
  -> orchestrator
  -> coordinator root execution
       -> planner lane
       -> lead lane(s)
       -> integrator lane (later, when ready)
```

The planner is not the family owner.

- `orchestrator` selects the project-scoped entrypoint,
- `coordinator` owns the project-root family,
- `planner` produces a durable plan,
- `lead` executes domain-scoped work packages from that plan,
- `integrator` remains outside lead ownership and is invoked only after family readiness.

## Default Workflow Shape

For project-scoped work, the new default should be:

1. start coordinator root,
2. spawn planner lane,
3. wait for a valid `coordination_plan`,
4. coordinator validates and adopts that plan,
5. coordinator dispatches lead work packages according to plan waves and dependencies,
6. leads execute and report progress upward,
7. coordinator replans or re-dispatches if required,
8. when all required work packages settle and governance clears, coordinator becomes `ready_for_integrator`,
9. integrator lane is planned or invoked separately.

This should become the default project-coordination schema, including single-domain project-scoped runs, because consistency is more important than a micro-optimization that skips planning. Future optimization can short-circuit the planner for clearly trivial work, but that is not part of this change.

## New Role: Planner

The planner is a project-scoped, read-mostly role.

Responsibilities:

- inspect project structure, active domains, workflow options, and policy constraints,
- analyze the incoming objective,
- identify which domains are actually impacted,
- define domain-scoped work packages,
- identify dependencies and execution waves,
- identify which work packages can run in parallel,
- identify shared contracts and sequencing constraints,
- recommend lane/workflow types for each work package,
- return a durable `coordination_plan` artifact.

Non-responsibilities:

- does not own execution dispatch,
- does not own merge/promotion,
- does not directly spawn builders/testers,
- does not become the new family owner.

## Durable Planning Artifact

Add a new handoff kind:

- `coordination_plan`

Produced by planner, consumed by coordinator.

Suggested shape:

```ts
interface CoordinationPlanArtifact {
  objective: string;
  coordinationMode: "delivery" | "project-breakdown" | "brownfield-intake";
  assumptions: string[];
  unresolvedQuestions: string[];
  sharedContracts: Array<{
    id: string;
    summary: string;
    ownerDomains: string[];
    requiredBeforeTaskIds: string[];
  }>;
  tasks: Array<{
    id: string;
    title: string;
    summary: string;
    domainId: string;
    recommendedWorkflow: string;
    dependsOn: string[];
    parallelGroup: string | null;
    acceptanceCriteria: string[];
    risks: string[];
  }>;
  waves: Array<{
    id: string;
    taskIds: string[];
  }>;
}
```

This is the execution contract. The coordinator should not infer domain work by reading lead transcripts or trying to reconstruct the plan from downstream artifacts.

## Coordinator-Owned Dispatch Queue

After the planner produces `coordination_plan`, the coordinator should materialize a coordinator-owned dispatch state.

Recommended internal state:

- adopted plan id,
- queue of task ids,
- per-task status (`pending`, `dispatched`, `in_progress`, `blocked`, `completed`, `failed`),
- mapped lead lane per domain,
- dependency satisfaction state,
- last replanning reason if a replan occurred.

Important rule:

- phase 1 uses coordinator push-dispatch,
- leads do not auto-claim from a shared queue yet.

That means the coordinator remains the explicit router of work order and concurrency.

## Lead Contract Under The New Model

Leads should no longer receive only the project-level objective plus domain context.

Instead, each lead receives a domain-scoped dispatch package derived from the adopted plan.

Suggested handoff or runtime payload:

- plan task id,
- domain-scoped task summary,
- accepted dependencies,
- shared contract references,
- execution-wave grouping,
- recommended workflow for that task,
- acceptance criteria,
- explicit upstream blockers if dependencies are not yet ready.

Leads still own local decomposition beneath their domain task. This change narrows the input and clarifies the intent.

## Progress Reporting Upward

The coordinator should receive information during execution, not only at the end.

Current coordinator summary already sees lane state and governance. Under the new schema it should additionally see plan progress.

Recommended additions:

- lead emits a durable `lead_progress` handoff or structured progress update,
- coordinator summary shows per-task dispatch state,
- readiness distinguishes:
  - waiting for planner,
  - waiting for dependencies,
  - waiting for active lead tasks,
  - waiting for review/approval,
  - ready for integrator.

This is still artifact-first and does not require mailbox-style peer messaging.

## Replanning

The model must support replan, because multi-domain work often shifts after discovery.

Recommended mechanism:

- coordinator can request a planner re-run,
- replanning is triggered by explicit reasons such as:
  - hidden dependency discovered,
  - wrong domain assignment,
  - blocked shared contract,
  - domain lead escalation,
- planner returns a new `coordination_plan` version,
- coordinator either adopts it automatically (small delta) or waits for operator review (large delta).

## Workflow Selection And Modes

This schema should become the default for project-root coordination.

Meaning:

- `project-plan`
- `project-invoke`

should route through planner-first coordination by default.

`coordinationMode` still matters, but now it changes planner behavior and dispatch shape more meaningfully:

- `delivery`
  - concrete implementation planning with execution waves
- `project-breakdown`
  - more emphasis on decomposition and task slicing
- `brownfield-intake`
  - stronger emphasis on dependency discovery, contract definition, and unresolved questions before dispatch

So after this change, modes no longer remain mostly labels. They begin to affect planning structure.

## Integrator Placement

Integrator remains directly under the coordinator root, not under any lead.

Why:

- integration is project-level work,
- promotion readiness is a family-level condition,
- merge/promotion must remain outside domain-lead ownership.

The new planner-first schema does not change that.

## Required New Or Updated Surfaces

### Planner / Plan Surfaces

- planner lane execution detail,
- adopted `coordination_plan` in coordinator-family summary,
- per-task dispatch state in family detail,
- replan history.

### Operator Surfaces

Operator Chat and HTTP should show:

- planner status,
- adopted coordination plan summary,
- current wave,
- queued vs active vs blocked tasks,
- domain assignment per task,
- replanning reason when present.

## Files Likely To Change

- `config/profiles/planner.yaml` (new)
- `.pi/prompts/planner.md` (new)
- `config/projects/*.yaml`
- `config/workflows/project-coordination-root.yaml`
- possibly new workflow template for planner pass if needed
- `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- `packages/orchestrator/src/execution/coordination-summary.ts`
- `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- `services/orchestrator/server.ts`
- orchestrator tests for planning, family detail, and operator surfaces

## Success Criteria

- project-root coordination defaults to planner-first flow,
- multi-domain objectives are split into domain-scoped work packages before leads begin,
- leads receive domain-specific tasks rather than the same global objective,
- coordinator owns dispatch order and dependency gating,
- coordinator receives incremental progress during execution,
- integrator remains a separate lane under coordinator,
- planning artifacts and replans are durable and operator-visible.
