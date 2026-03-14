# ADR-0014: Multi-Backend PI Runtime Adapter Boundary

- Status: Accepted
- Date: 2026-03-14

## Context

`ADR-0002` intentionally chose a PI-first runtime foundation and deferred a broader runtime abstraction layer.

That deferment was correct for bootstrap, but SPORE now has enough real runtime/session/operator surface area that direct coupling to the current PI CLI RPC path creates upgrade risk:

- orchestrator launch logic is too close to launcher details,
- gateway/operator surfaces are too aware of `pi-rpc` artifacts and control assumptions,
- new SDK-backed runtime modes cannot land safely without a stable SPORE-owned boundary,
- observability and recovery guarantees need to be preserved across more than one backend implementation.

This is an approved architecture exception to the current near-term roadmap. It is justified because SPORE already has a real PI-first runtime slice and needs a safer boundary around that slice before more operator/runtime features land.

## Decision

Introduce a SPORE-owned `RuntimeAdapter` boundary for the PI runtime family.

The boundary will:

- keep SPORE core orchestration dependent on stable internal runtime contracts,
- preserve PI as the provider family,
- support multiple PI backend kinds behind that boundary,
- keep runtime-specific concerns below the adapter line,
- preserve inspectability, durable artifacts, steering, and recovery as first-class requirements.

The first backend kinds are:

- `pi_rpc` for the current subprocess RPC path,
- `pi_sdk_embedded` for same-process SDK usage in bounded dev/test scopes,
- `pi_sdk_worker` for SDK usage inside a dedicated worker process with an internal SPORE protocol.

## Consequences

- SPORE remains PI-first, but no longer PI-RPC-only above the adapter boundary.
- Runtime work must preserve generic runtime artifacts and compatibility aliases until operator surfaces migrate.
- `packages/runtime-pi/` remains the PI integration boundary.
- This exception does not authorize a general orchestrator/runtime rewrite.
