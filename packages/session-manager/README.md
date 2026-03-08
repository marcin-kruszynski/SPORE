# `packages/session-manager`

This package now owns the first executable session metadata layer for SPORE.

## Current Capability

- stores session records in `data/state/spore-sessions.sqlite`
- appends lifecycle events to `data/state/events.ndjson`
- supports `create-from-plan`, `transition`, `show`, `list`, `events`, and `status`
- supports filtered event queries and a live `feed`
- supports `reconcile` sweeps and watch mode to settle detached sessions from exit files

## Run

```bash
node packages/session-manager/src/cli/session-manager.js list
node packages/session-manager/src/cli/session-manager.js status
node packages/session-manager/src/cli/session-manager.js events --session lead-session-002
node packages/session-manager/src/cli/session-manager.js feed --type session.completed --pretty
node packages/session-manager/src/cli/session-manager.js reconcile --pretty
node packages/session-manager/src/cli/session-manager.js reconcile --watch --stop-on-settled --session builder-live-001 --pretty
```
