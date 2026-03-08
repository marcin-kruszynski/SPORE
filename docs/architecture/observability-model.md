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
- hold and pause transitions should remain explicit in the workflow event history.
