# Lead-Governed Agent Cockpit Design

## Intent

Refine SPORE's delivery workflow and operator UI so that `lead` becomes the internal workflow governor for specialist stages, the operator only makes the final merge decision, every specialist role has a clearer responsibility boundary, and the Agent Cockpit / Agent Detail pages expose the real work being assigned, executed, and returned without blocking on unnecessary heavyweight data.

## Chosen Direction

The chosen direction is `Lead-Governed Specialist Pipeline`.

- `orchestrator` picks the workflow and creates the initial brief.
- `lead` manages internal stage approvals and rework requests, but cannot edit files or write to workspaces.
- `scout` does discovery and implementation planning only.
- `builder` is the only specialist that performs implementation.
- `tester` runs targeted verification against the touched feature surface and may use browser automation for UI changes.
- `reviewer` performs an actual quality/correctness gate.
- `integrator` handles the final promotion branch and merge-readiness path.

## Governance Model

- Internal transitions (`scout -> builder -> tester -> reviewer -> integrator`) are approved by `lead`.
- Invalid specialist handoffs stop the internal chain and trigger rework instead of leaking into proposal review/approval/promotion.
- The operator receives one product-level decision at the end: `Merge`.

## Role Responsibilities

### Orchestrator
- selects workflow
- frames the top-level task
- delegates to `lead`

### Lead
- decomposes work for specialists
- evaluates specialist handoffs
- approves/rejects stage transitions
- requests rework when output is inadequate
- cannot edit files or mutate workspaces

### Scout
- performs read-heavy discovery
- identifies files, risks, dependencies, and implementation approach
- does not implement

### Builder
- performs the actual file/config/doc changes
- reports changed paths and implementation output

### Tester
- runs targeted tests for touched components/files
- may run browser-driven checks for UI work
- reports commands run and evidence, not just opinions

### Reviewer
- checks correctness, quality, architectural fit, and sufficiency of test evidence
- should be more than a formal handoff gate

### Integrator
- validates promotion branch state and integration readiness
- produces final merge-ready outcome for the operator

## Operator UI Direction

### Agent Cockpit
- foreground current mission family
- hide stale history behind an explicit toggle
- show lane state, stage, last activity, and whether the lane is waiting on lead/internal governance

### Agent Detail
Top of page should prioritize:
1. `Input sent to agent`
2. `Latest visible session output`
3. `Returned output`

Artifacts, linkage, and lower-level metadata remain available, but secondary.

### Tool Calls And Reasoning
- show transcript/tool-call output if emitted by runtime
- show structured handoff payloads and validation status
- do not promise hidden model reasoning that the runtime does not emit

## Performance Direction

`Loading active lanes...` must represent only the current mission family, not the entire historical graph.

The cockpit should:
- render from a lightweight current-family summary path first
- lazily hydrate history
- lazily hydrate full session live state when the lane is opened
- avoid eagerly pulling giant promotion execution payloads before the operator asks for them

## Definition Of Success

This succeeds when:
- `lead` governs internal stage transitions without workspace write access
- `builder` is clearly accountable for implementation work
- `tester` provides targeted evidence for touched feature surfaces
- `reviewer` behaves like a real quality gate
- invalid specialist handoffs stop the chain internally
- the operator sees a clean current mission family in cockpit
- Agent Detail makes `input -> live output -> returned output` obvious
- the operator only needs to make the final merge decision
