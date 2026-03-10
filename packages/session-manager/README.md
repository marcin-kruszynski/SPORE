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
npm run session:list
npm run session:status
npm run session:events -- --session lead-session-002
npm run session:feed -- --type session.completed
npm run session:reconcile
npm run session:reconcile:watch

# Full CLI surface when you need flags not covered by the root aliases
npx tsx packages/session-manager/src/cli/session-manager.ts reconcile --watch --stop-on-settled --session builder-live-001 --pretty
```
