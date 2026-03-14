# PI Integration Strategy

PI is the initial technical substrate for SPORE runtime work.

## Relevant PI Packages

- `packages/ai` for provider and model abstraction.
- `packages/agent` for stateful agent loops and event streaming.
- `packages/coding-agent` for CLI sessions, context files, skills, extensions, and prompt packages.
- `packages/tui` for operator-oriented terminal UI primitives.
- `packages/web-ui` for browser-facing chat and artifact surfaces.

## SPORE Strategy

- use PI as the first runtime control plane,
- translate SPORE profiles into PI runtime settings,
- support multiple PI backend kinds behind a SPORE-owned runtime adapter contract,
- bridge PI events into SPORE session and observability contracts,
- keep SPORE-specific workflow, domain, and review policy outside of PI internals.

Current backend kinds:

- `pi_rpc`: compatibility and operational fallback,
- `pi_sdk_embedded`: local dev and test mode,
- `pi_sdk_worker`: production candidate with process isolation and SDK-level integration.
