# Role Model

## Baseline Roles

### Orchestrator

- receives human direction,
- chooses workflow templates,
- dispatches project-root work to coordinators or direct domain work to leads,
- synthesizes status across domains.

### Coordinator

- owns one project-root execution family,
- routes one project objective across multiple domain lead lanes,
- remains read-mostly by default,
- receives project-level escalations and promotion blockers,
- does not receive a mutating workspace unless policy explicitly opts in.

### Lead

- owns a domain stream,
- decomposes local tasks,
- invokes scout/builder/tester lanes,
- requests reviewer gate when ready.

### Scout

- research-first exploration,
- source/docs analysis,
- architecture and dependency mapping,
- findings packaged for builders and leads.

### Builder

- implementation-focused execution,
- produces scoped code and artifacts,
- updates docs and config alongside changes.

### Tester

- validates correctness and behavior,
- runs tests/probes/checklists,
- reports defects and confidence bounds.

### Reviewer

- independent quality gate,
- inspects artifacts and policy compliance,
- returns approve/revise/reject outcome.

### Integrator

- owns explicit post-review promotion work for one coordinator-root family,
- consumes durable promotion sources such as proposal artifacts, workspace-linked branches, or snapshot-backed workspaces,
- uses a dedicated integration workspace and integration branch metadata,
- may resolve clearly mechanical conflicts when policy allows it,
- escalates semantic or ambiguous blockers back to the coordinator.

## Dynamic Profile Mapping

Roles are abstract. Runtime behavior is attached via profiles (e.g., `backend-builder`, `docs-scout`, `browser-tester`).

Project-scoped roles are configured through project config rather than domain config:

- `coordinatorProfile`
- `integratorProfile`

The intended topology is now:

```text
orchestrator
  -> coordinator
       -> lead (backend)
       -> lead (frontend)
       -> lead (docs)
       -> integrator
```

Backward compatibility rule:

- existing domain workflows remain lead-first,
- `coordinator` and `integrator` are explicit planner/invoker paths,
- they are not silently prepended to domain `roleSequence` lists.
