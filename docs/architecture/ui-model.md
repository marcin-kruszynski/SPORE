# UI Model

SPORE supports multiple client surfaces over shared contracts.

## CLI/TUI Goals

- project/team/profile management,
- workflow invocation,
- session inspection,
- logs and event feed,
- docs search and docs map navigation,
- orchestrator communication,
- self-build and proposal governance,
- scenario/regression execution and drilldown.

## Web UI Goals

- agent cockpit mission control,
- mission map and execution topology,
- operator chat and inbox-driven governance,
- self-build dashboard and evidence drilldowns,
- live session visibility,
- project/workflow/evidence navigation.

## Constraint

No surface should own business logic; all surfaces consume shared contracts and services.

## Current Executable Slice

The repository now includes a real terminal operator surface in `packages/tui/` with:

- dashboard snapshot and watch mode,
- per-session inspection,
- family/execution audit and history reads,
- self-build, scenario, regression, and proposal operations,
- tmux pane capture when a live tmux session exists.

It also includes:

- an HTTP gateway in `services/session-gateway/` for session/event reads and narrow control actions,
- a browser-based operator console in `apps/web/` with Agent Cockpit, Mission Map, Operator Chat, Self-Build, and lane-detail routes that consume the gateway/orchestrator instead of reading local files directly.
