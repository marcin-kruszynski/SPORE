# Runtime Model

## PI-First Strategy

SPORE standardizes on PI ecosystem as the initial runtime foundation.

### Why PI First

- mature package ecosystem across AI, agent runtime, coding workflows, and UI,
- extensibility surfaces for tools, prompts, and provider configuration,
- practical integration path for future Web UI and session controls.

### Planned Ownership: `packages/runtime-pi/`

- profile-to-PI runtime translation,
- runtime wrapper and startup orchestration,
- extension and tool registration bridge,
- session startup hooks,
- steering and telemetry bridge,
- future web session bridge adapter.

### Current Executable Slice

`packages/runtime-pi/` now includes:

- SPORE profile and project to PI session plan translation,
- policy-aware startup context generation from `docs-kb`,
- tmux-backed live session launch,
- a real `pi --mode rpc` launcher path when the `pi` CLI is installed,
- RPC-driven operator steering and abort handling through a session control queue,
- `pi --mode json` retained as a secondary debug launcher path,
- raw PI event capture and PI session file persistence in `tmp/sessions/`,
- stub fallback when `pi` is unavailable,
- detached session monitoring via `session-manager reconcile --watch`,
- deterministic RPC runner shutdown after `agent_end` plus idle grace,
- orchestrator step watchdog steering and abort control for long-running steps,
- per-role `sessionMode` overrides passed from merged domain runtime policy,
- docs-kb retrieval query and result limit passed from merged domain docs-kb policy.

When a workflow is launched through the orchestrator, runtime defaults now come from merged domain policy:

- `runtimePolicy.sessionModeByRole` overrides the profile session mode for that launch,
- `docsKbPolicy.queryTerms`, `queryTemplate`, and `resultLimit` shape startup retrieval,
- `workflowPolicy.stepSoftTimeoutMs` and `stepHardTimeoutMs` become the default watchdog thresholds for the step unless the operator supplies explicit drive-time overrides.

### Future Abstraction

A runtime abstraction layer can be introduced later, but bootstrap and first implementation waves remain PI-centered.
