# ADR-0016: Runtime Artifact Parity Across PI Backends

- Status: Accepted
- Date: 2026-03-14

## Context

SPORE session recovery, gateway inspection, and operator steering already depend on durable runtime artifacts.

If new backends keep more state only in memory, SPORE would regress on:

- inspectability,
- recovery,
- gateway live views,
- post-mortem debugging,
- durable governance evidence.

## Decision

All PI runtime backends must emit a common durable runtime artifact set.

At minimum, each backend must support:

- session plan/context artifacts,
- transcript output,
- control history,
- runtime status,
- runtime events,
- handoff artifact output,
- launch context metadata.

Legacy RPC-specific artifacts remain supported as compatibility artifacts until all readers migrate to the generic runtime artifact model.

## Consequences

- SDK-backed modes cannot bypass artifact writing just because they can access richer in-memory state.
- session-manager and session-gateway can migrate toward backend-agnostic recovery and inspection.
- compatibility shims remain necessary during the migration window.
