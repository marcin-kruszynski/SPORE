# ADR-0006: Add a Project-Scoped Coordinator Role Between Orchestrator and Leads

- Status: Accepted
- Date: 2026-03-09

## Context

SPORE's current executable workflow model is still largely lead-first at the domain level, while the higher-level documentation has historically described a simpler `orchestrator -> lead -> workers` shape.

That model is workable for one project invocation at a time, but it does not provide a clear project-scoped coordination layer that can:

- own one project's active objective,
- supervise multiple domain lead lanes inside the same project,
- isolate one project's execution family from another,
- route project-level escalations without collapsing them into lead-local recovery,
- present project-level health to operators without flattening everything into direct lead work.

The repository already has strong primitives that point toward a better fit:

- rooted execution trees,
- `coordinationGroupId` and `parentExecutionId`,
- family-level hold, resume, review, approval, and escalation controls,
- project configs with `activeDomains[]`,
- workspace guidance that already keeps top-level coordination roles outside mutating worktrees by default.

Without an explicit project role, several risks remain:

- the top-level orchestrator stays overloaded with project-by-project routing detail,
- leads become the de facto project coordinators for concerns that are bigger than one domain,
- multi-project operation becomes harder to represent cleanly in lineage, status, and operator surfaces,
- any future project-wide escalation or promotion path has no natural project-owned parent lane.

## Decision

SPORE should introduce a new project-scoped `coordinator` role between the top-level `orchestrator` and domain `lead` executions.

The decision includes these architectural rules:

- `coordinator` is a project role, not a domain role.
- The coordinator sits above lead-owned domain workflows as a project-root execution, rather than being prepended to every existing workflow role sequence.
- Existing lead-first child workflows remain structurally unchanged inside their own executions.
- Project-root coordination is an explicit planner and invoker path; existing workflow `plan` and `invoke` behavior must not be silently repurposed.
- One coordinator root execution owns one project execution family for one active project run.
- `rootExecutionId` is the canonical family identifier; `familyKey` is optional grouping metadata only.
- Coordinator-root planning carries explicit `coordinationMode` metadata.
- A dedicated `planner` child lane sits under the coordinator root and runs before lead dispatch by default.
- The planner emits a durable `coordination_plan` artifact that the coordinator adopts before dispatching lead work.
- Lead child executions sit under that coordinator root using the existing lineage and coordination primitives, but now receive domain-scoped task packages derived from the adopted plan rather than the same raw project objective.
- The coordinator remains read-mostly by default and does not receive a mutating workspace unless a future policy explicitly allows it.
- Domain review, approval, retry, and rework loops remain lead-owned by default.
- Project-wide blockers, cross-domain conflicts, and exhausted lead-level recovery may escalate to the coordinator.
- The integrator remains the explicit promotion owner for the coordinator family.
- Operator surfaces should expose a reusable coordinator-family summary rather than reconstructing project state from transcripts or proposal records.
- The coordinator owns the durable dispatch queue, current wave, and replan history for that family.

Recommended topology:

```text
orchestrator
  -> coordinator
       -> planner
       -> lead (backend task package)
       -> lead (frontend task package)
       -> lead (docs task package)
       -> integrator
```

## Consequences

- SPORE gains an explicit project-owned execution root that can supervise multiple lead lanes cleanly.
- The top-level orchestrator can remain the portfolio control plane rather than the project-detail lane.
- Leads remain domain-scoped coordinators instead of absorbing project-wide routing responsibilities.
- Multi-domain objectives are decomposed before execution fan-out, reducing duplicated interpretation across lead lanes.
- Multi-project execution becomes easier to model using one coordinator-root family per project.
- Project-level escalations gain a natural target role without globally changing lead-local recovery defaults.
- Project config and schema must grow project-scoped coordinator settings such as `coordinatorProfile` and a project coordination policy block.
- Project config and workflow config now carry an explicit `coordinationMode` default and supported mode set.
- Planner and invocation logic must add explicit project-root entrypoints instead of mutating old direct workflow behavior.
- Web, TUI, CLI, and HTTP surfaces must learn to recognize coordinator-root families while preserving backward compatibility for older trees.
- Operator-facing coordination surfaces should use family detail, lane, and readiness reads keyed by `rootExecutionId`.
- Operator-facing coordination surfaces should also expose planner state, adopted plan version, dispatch queue status, and replan history.
- Workspace rules stay stricter because the coordinator remains outside normal mutation worktrees.
- Future project-scoped roles such as an `integrator` promotion lane have a natural parent boundary under the coordinator.
- The integrator boundary remains preserved: coordinator visibility and blocker aggregation do not collapse promotion work back into the coordinator lane.

This ADR has since been implemented. `docs/plans/project-coordinator-role-plan.md` remains as historical implementation context, while the current ground truth now lives in `docs/architecture/role-model.md`, `docs/architecture/workflow-model.md`, and the active orchestrator/operator surfaces.
