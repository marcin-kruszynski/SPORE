# Runtime PI Source

This source tree now contains the PI-specific runtime implementation behind the generic runtime adapter boundary.

It includes:

- session-plan generation from SPORE config,
- startup-context generation,
- `pi_rpc`, `pi_sdk_embedded`, and `pi_sdk_worker` adapter implementations,
- worker protocol types and worker runtime entrypoint,
- event normalization helpers,
- runtime CLI entrypoints for planning, running, and diagnostics.
