# ADR-0015: PI SDK Worker Transport Uses Stdio NDJSON First

- Status: Accepted
- Date: 2026-03-14

## Context

The `pi_sdk_worker` backend needs process isolation while still fitting SPORE's inspectable, local-first operator model.

Possible transports include child-process IPC, `worker_threads`, stdio JSON, sockets, or file-backed queues.

SPORE currently values:

- explicit process boundaries,
- durable and inspectable runtime artifacts,
- easy local debugging,
- backend-neutral request/response and event streaming.

## Decision

Use child process stdio with versioned NDJSON envelopes as the first `pi_sdk_worker` transport.

The worker protocol will:

- use request IDs and protocol versioning from the first iteration,
- carry command, response, and event envelopes,
- be validated at both ends,
- be mirrored into a durable protocol artifact for debugging.

## Consequences

- `pi_sdk_worker` keeps process isolation without hiding its control plane.
- The same envelope can later be reused over sockets if SPORE ever needs remote runtime transport.
- `worker_threads` are explicitly not the production candidate because they weaken fault isolation.
