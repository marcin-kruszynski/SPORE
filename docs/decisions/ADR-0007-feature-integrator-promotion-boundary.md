# ADR-0007: Add a Project-Scoped Integrator Role for Explicit Feature Promotion

- Status: Accepted
- Date: 2026-03-09

## Context

SPORE now has a clearer project-level coordination direction through the proposed `coordinator` role and already supports durable review, approval, escalation, execution lineage, and workspace allocation primitives.

That still leaves one important boundary underspecified:

- reviewed child work is not yet the same thing as safely integrated work,
- proposal approval is not yet the same thing as merge readiness,
- cross-domain feature changes need a single promotion lane that is separate from domain delivery,
- the system needs an explicit place to classify and handle merge blockers, target-branch drift, and integration validation.

If SPORE leaves this boundary implicit, several risks follow:

- `lead` becomes overloaded with cross-domain merge responsibility,
- `coordinator` becomes a mutating merge actor despite being intended as a read-mostly routing layer,
- approval can be misread as permission to land directly on `main`,
- semantic conflicts can be handled in ad hoc ways without durable escalation and recovery paths.

The repository already points toward a promotion boundary through:

- rooted execution families and coordinator-style hierarchy planning,
- proposal artifacts and proposal approval flows,
- dedicated worktree and integration-branch metadata,
- roadmap language around a durable `promotion candidate` state before integration or merge.

## Decision

SPORE should introduce a new project-scoped `integrator` role as the explicit post-review promotion lane for one feature-sized change inside a coordinator-root execution family.

The decision includes these architectural rules:

- `integrator` is a project role, not a domain role.
- `integrator` sits alongside lead child lanes under the project `coordinator`, not inside every domain workflow template.
- Existing domain workflows remain lead-first and keep local review, approval, retry, and rework behavior unchanged.
- Promotion is an explicit planner and invoker path, not an automatic side effect of reviewer approval.
- The integrator may only promote from durable artifacts such as proposal-backed branches, workspace-linked branches, or equivalent mergeable outputs.
- The integrator uses a dedicated integration workspace and optional integration branch metadata; it does not mutate the canonical project root directly.
- The integrator may resolve clearly mechanical conflicts when policy allows it, but semantic or ambiguous conflicts must escalate back to the `coordinator` so the relevant `lead` lanes can repair them.
- The default safe outcome of the first pass is `promotion_candidate`, not automatic merge to `main`.
- Direct merge to the target branch is allowed only when project policy explicitly opts in and required validation and approval conditions are satisfied.

Recommended topology:

```text
orchestrator
  -> coordinator
       -> lead (domain lane A)
       -> lead (domain lane B)
       -> lead (domain lane C)
       -> integrator
```

## Consequences

- SPORE gains a clear boundary between domain delivery and target-branch promotion.
- `lead` remains responsible for domain implementation and rework rather than cross-domain merge arbitration.
- `coordinator` remains responsible for project routing and escalation handling rather than default repository mutation.
- Promotion and merge readiness become inspectable through a dedicated execution lane instead of being inferred from reviewer state.
- The architecture can represent `promotion_candidate`, `merged`, `blocked`, and similar additive promotion states without overloading normal workflow execution states.
- Operator surfaces, self-build flows, and proposal lifecycle logic must distinguish approved work from promoted or merged work.
- Project config and schema must grow project-scoped promotion settings such as `integratorProfile` and `promotionPolicy`.
- Planner and execution logic must add explicit promotion entrypoints and coordinator-targeted escalation rules for integrator blockers.
- Workspace and cleanup logic must preserve integration workspaces while promotion is blocked or awaiting approval.
- Existing domain workflow behavior should remain backward compatible because `integrator` is added as an explicit project-level lane rather than prepended to existing role sequences.

This ADR has since been implemented. `docs/plans/feature-integrator-role-plan.md` remains as historical implementation context, while the current ground truth now lives in `docs/architecture/role-model.md`, `docs/architecture/workflow-model.md`, and the active orchestrator/operator surfaces.
