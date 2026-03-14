# `packages/runtime-core`

This package owns the backend-agnostic runtime boundary for SPORE.

## Current Capability

- defines the `RuntimeAdapter` contract,
- defines generic runtime capabilities, snapshots, control acknowledgments, and artifact manifests,
- provides a `RuntimeRegistry` for backend lookup,
- provides a `RuntimeSupervisor` seam so orchestrator/session code depends on SPORE-owned runtime contracts instead of PI launcher details.

## Scope

`packages/runtime-core/` is intentionally generic.

It does not implement provider-specific behavior itself. PI-specific backends continue to live in `packages/runtime-pi/`.
