# Role Model

## Baseline Roles

### Orchestrator

- receives human direction,
- chooses workflow templates,
- dispatches work to leads,
- synthesizes status across domains.

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

## Dynamic Profile Mapping

Roles are abstract. Runtime behavior is attached via profiles (e.g., `backend-builder`, `docs-scout`, `browser-tester`).
