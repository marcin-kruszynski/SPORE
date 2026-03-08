# UI Model

SPORE supports multiple client surfaces over shared contracts.

## CLI/TUI Goals

- project/team/profile management,
- workflow invocation,
- session inspection,
- logs and event feed,
- docs search and docs map navigation,
- orchestrator communication.

## Web UI Goals

- project overview dashboard,
- active sessions list,
- orchestrator conversation panel,
- live session visibility,
- docs exploration and semantic search,
- review and readiness states.

## Constraint

No surface should own business logic; all surfaces consume shared contracts and services.

## Current Executable Slice

The repository now includes a lightweight terminal operator surface in `packages/tui/` with:

- dashboard snapshot and watch mode,
- per-session inspection,
- tmux pane capture when a live tmux session exists.

It also includes:

- an HTTP gateway in `services/session-gateway/` for session/event reads and narrow control actions,
- a minimal browser-based operator console in `apps/web/` that consumes the gateway instead of reading local files directly.
