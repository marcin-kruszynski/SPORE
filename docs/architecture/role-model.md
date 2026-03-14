# Role Model

## Baseline Roles

### Orchestrator

- receives human direction,
- chooses workflow templates,
- dispatches project-root work to coordinators or direct domain work to leads,
- synthesizes status across domains,
- emits a durable orchestration handoff when the active profile requires one.

### Coordinator

- owns one project-root execution family,
- uses `rootExecutionId` as the canonical family identifier, with optional `familyKey` metadata for grouping surfaces,
- routes one project objective across multiple domain lead lanes,
- carries explicit `coordinationMode` metadata such as `delivery`, `project-breakdown`, or `brownfield-intake`,
- remains read-mostly by default,
- receives project-level escalations and promotion blockers,
- does not receive a mutating workspace unless policy explicitly opts in,
- emits a durable `routing_summary` handoff for downstream project lanes and operator inspection,
- is exposed to operators through execution detail `coordination` links, coordinator-family read routes, and operator-thread coordination context.

### Lead

- owns a domain stream,
- decomposes local tasks,
- invokes scout/builder/tester lanes,
- requests reviewer gate when ready,
- emits a durable `task_brief` handoff that scopes downstream work.

### Scout

- research-first exploration,
- source/docs analysis,
- architecture and dependency mapping,
- findings packaged for builders and leads,
- emits a durable `scout_findings` handoff with recommendations, risks, and evidence links.

### Builder

- implementation-focused execution,
- produces scoped code and artifacts,
- updates docs and config alongside changes,
- consumes upstream task and research handoffs when they exist,
- emits a durable `implementation_summary` handoff and, when applicable, a `workspace_snapshot` evidence handoff.

### Tester

- validates correctness and behavior,
- runs tests/probes/checklists,
- reports defects and confidence bounds,
- consumes builder implementation and snapshot handoffs,
- emits a durable `verification_summary` handoff.

### Reviewer

- independent quality gate,
- inspects artifacts and policy compliance,
- returns approve/revise/reject outcome,
- emits a durable `review_summary` handoff alongside governance decisions.

### Integrator

- owns explicit post-review promotion work for one coordinator-root family,
- consumes durable promotion sources such as proposal artifacts, workspace-linked branches, or snapshot-backed workspaces,
- uses a dedicated integration workspace and integration branch metadata,
- may resolve clearly mechanical conflicts when policy allows it,
- escalates semantic or ambiguous blockers back to the coordinator,
- remains the promotion owner even when the coordinator family is operator-visible,
- emits a durable `integration_summary` handoff for promotion state and integration evidence.

## Runtime Input And Output Contract

Profiles remain the source of runtime behavior, but each role now has an explicit handoff contract:

- a role consumes curated inbound handoffs from prior compatible steps,
- a role receives the expected outbound handoff kind and required sections in the invocation brief,
- the runtime turn remains bounded, but the final output must leave behind a normalized durable handoff artifact for later steps and operator inspection,
- profile policy can require review or block advancement when the structured handoff is missing or malformed.

This keeps role responsibilities explicit without introducing unrestricted peer-to-peer messaging.

## Dynamic Profile Mapping

Roles are abstract. Runtime behavior is attached via profiles (e.g., `backend-builder`, `docs-scout`, `browser-tester`).

Project-scoped roles are configured through project config rather than domain config:

- `coordinatorProfile`
- `integratorProfile`
- `projectCoordinationPolicy.coordinationMode`

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
- they are not silently prepended to domain `roleSequence` lists,
- operator-visible family summaries describe coordinator-owned lead and integrator lanes without changing the lead-local or integrator-local execution contracts.
