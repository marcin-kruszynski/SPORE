# Runtime Model

## PI-First Strategy

SPORE standardizes on PI ecosystem as the initial runtime foundation.

### Why PI First

- mature package ecosystem across AI, agent runtime, coding workflows, and UI,
- extensibility surfaces for tools, prompts, and provider configuration,
- practical integration path for future Web UI and session controls.

### Current Ownership

- `packages/runtime-core/` owns the backend-agnostic runtime contract, registry, supervisor seam, snapshots, and artifact manifest types.
- `packages/runtime-pi/` owns PI-specific runtime translation, adapters, worker protocol, and backend implementations.

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
- artifact-based auto-heal that terminalizes stale sessions from `.exit.json` first and final `rpc-status.json` second,
- deterministic RPC runner shutdown after `agent_end` plus idle grace,
- orchestrator step watchdog steering and abort control for long-running steps,
- per-role `sessionMode` overrides passed from merged domain runtime policy,
- docs-kb retrieval query and result limit passed from merged domain docs-kb policy.

Artifact-driven session recovery now follows an explicit signal chain:

- `packages/runtime-pi/` writes terminal artifacts (`*.exit.json` and final `*.rpc-status.json`) with reusable terminal signal fields,
- `packages/session-manager` treats those artifacts as the shared auto-heal boundary and records `signalSource`, terminal-signal origin, and fallback reason when it reconciles a stale session,
- `packages/orchestrator` emits `workflow.step.artifact_recovered` before the usual step terminal event so execution detail and history preserve when an operator-visible recovery happened,
- self-build read models reuse that execution summary so work-item runs and proposal review packages surface artifact recovery counts without forcing operators to inspect raw session files.

When a workflow is launched through the orchestrator, runtime defaults now come from merged domain policy:

- `runtimePolicy.sessionModeByRole` overrides the profile session mode for that launch,
- `docsKbPolicy.queryTerms`, `queryTemplate`, and `resultLimit` shape startup retrieval,
- `workflowPolicy.stepSoftTimeoutMs` and `stepHardTimeoutMs` become the default watchdog thresholds for the step unless the operator supplies explicit drive-time overrides.

The runtime layer also receives the execution's `domainId` and `workflowId` directly in the session plan so startup retrieval, observability, and later policy-aware runtime hooks do not have to reconstruct that context from filenames alone.

### Future Abstraction

Bootstrap and first implementation waves remain PI-centered, but the runtime boundary is now explicitly multi-backend within the PI family.

### Multi-Backend PI Runtime Adapter

`ADR-0014`, `ADR-0015`, and `ADR-0016` introduce a SPORE-owned `RuntimeAdapter` boundary with three PI backend kinds:

- `pi_rpc` for the existing CLI RPC subprocess path,
- `pi_sdk_embedded` for same-process SDK integration in bounded dev/test flows,
- `pi_sdk_worker` for SDK integration behind a worker-process protocol.

The generic runtime artifact contract now centers on:

- `*.runtime-status.json`,
- `*.runtime-events.jsonl`,
- `*.control.ndjson`,
- compatibility artifacts such as `*.rpc-status.json` and `*.pi-events.jsonl` while readers migrate.
