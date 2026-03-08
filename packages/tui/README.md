# `packages/tui`

This package now contains a lightweight terminal operator surface for SPORE.

## Current Commands

```bash
node packages/tui/src/cli/spore-ops.js dashboard
node packages/tui/src/cli/spore-ops.js dashboard --watch
node packages/tui/src/cli/spore-ops.js inspect --session lead-session-002
```

It currently provides:

- a dashboard over session state and recent events,
- per-session inspection,
- optional tmux pane capture when a live tmux session exists.
