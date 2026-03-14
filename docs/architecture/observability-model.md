# Observability Model

SPORE should make active work inspectable before it attempts large-scale autonomy.

## Minimum Observability Goals

- enumerate active sessions,
- inspect per-session status and lineage,
- inspect execution lineage and coordination-group membership without scraping raw storage,
- correlate work by run id and workflow id,
- expose logs, events, and completion signals,
- record health and stall signals,
- distinguish recoverable blocked states such as `paused` and `held` from terminal failure.

## Borrowed Lessons

- Overstory contributes strong feed, trace, and watchdog ideas.
- Gastown contributes durable lifecycle and operator-centric visibility patterns.

## Design Bias

Start with mechanical truth and explicit telemetry. Add intelligent triage only after the event and status model is stable.

For the current orchestrator slice, that means:

- workflow execution detail, event history, and escalation history should remain the primary observability source for grouped work,
- parent/child lineage should be visible independently from runtime-session trees,
- coordination groups should be inspectable as an operator-facing summary rather than reconstructed from timestamps,
- hold and pause transitions should remain explicit in the workflow event history,
- artifact-based session recovery should be visible as first-class telemetry instead of inferred from a later `completed` or `failed` state.

## Artifact Recovery Signals

When a tmux-backed or detached PI session stops updating its session row, SPORE now treats artifact recovery as an explicit observability path instead of a hidden implementation detail.

- Session reconciliation records `signalSource` (`exit-file` or `rpc-status`), the runtime terminal-signal origin when available, and a fallback reason when `rpc-status.json` had to substitute for a missing or invalid exit artifact.
- Orchestrator reconciliation emits `workflow.step.artifact_recovered` before the step's terminal workflow event and carries explicit `artifactRecoveryCount` plus the recovery payload so execution history timelines show exactly when auto-heal happened.
- Execution detail and execution history expose an `artifactRecovery` summary with counts, per-source totals, and the concrete recovery events.
- Self-build operator surfaces that already point at execution state, such as work-item run detail and proposal review packages, preserve the same `artifactRecovery` summary so operators can distinguish clean completion from artifact-assisted recovery.

The runtime adapter migration adds generic runtime observability alongside those legacy PI/RPC signals:

- `runtime-status.json` and `runtime-events.jsonl` as backend-agnostic runtime artifacts,
- backend-aware runtime capability and launch metadata in session rows,
- `/sessions/:id/live` launcher metadata that can describe RPC, embedded SDK, or worker-backed sessions without changing the client contract.
