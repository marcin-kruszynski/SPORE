# `apps/web`

This app now provides the first minimal browser-based operator surface for SPORE.

## Current Capability

- fetches status, session lists, session detail, and events through `services/session-gateway/`
- preserves existing session operator controls:
  - stop
  - mark-complete
  - steer
- exposes transcript, PI event, and artifact inspection for each session
- proxies workflow planning and invocation to `services/orchestrator/`
- adds durable execution visibility and governance controls over orchestrator APIs:
  - execution list (`GET /executions`)
  - execution detail (`GET /executions/:id`)
  - execution event stream (`GET /stream/executions?execution=:id`)
  - drive (`POST /executions/:id/drive`)
  - pause (`POST /executions/:id/pause`)
  - hold (`POST /executions/:id/hold`)
  - resume (`POST /executions/:id/resume`)
  - review (`POST /executions/:id/review`)
  - approval (`POST /executions/:id/approval`)
- adds coordination-group visibility and controls over orchestrator APIs:
  - coordination group detail (`GET /coordination-groups/:id`)
  - child execution reads (`GET /executions/:id/children`)
  - coordination-group drive (`POST /coordination-groups/:id/drive`)
- renders grouped execution cards that distinguish:
  - standalone executions
  - root executions inside a coordination group
  - child/branch executions with `parentExecutionId` and `branchKey`
- surfaces operator interruption state cleanly for upcoming execution controls:
  - `paused`
  - `held`
  - `holdReason`
  - `pausedAt`
  - `heldAt`
  - `resumedAt`
- renders execution step/session tree with clearer lineage cues from orchestrator detail payloads
- renders a coordination and lineage board for parent/child execution context when optional payload fields are present
- renders execution timeline/history from workflow events where available
- follows execution activity through the orchestrator SSE stream in addition to the session SSE stream
- exposes escalation resolution controls, including resume of the affected execution path
- keeps existing session/operator tabs and controls unchanged

## Run

Start the gateway first:

```bash
npm run gateway:start
```

Start the orchestrator service:

```bash
npm run orchestrator:start
```

Then start the web app:

```bash
npm run web:start
```

Open `http://127.0.0.1:8788`.

Environment variables:

- `SPORE_WEB_HOST` default `127.0.0.1`
- `SPORE_WEB_PORT` default `8788`
- `SPORE_GATEWAY_ORIGIN` default `http://127.0.0.1:8787`
- `SPORE_ORCHESTRATOR_ORIGIN` default `http://127.0.0.1:8789`

The app intentionally stays thin. It proxies `/api/*` to the gateway and `/api/orchestrator/*` to the orchestrator service, and it does not read local state files directly.

## Optional Execution Payload Fields

The execution surface is now prepared to consume these fields when they appear in list or detail payloads:

- `coordinationGroupId`
- `parentExecutionId`
- `childExecutionIds`
- `branchKey`
- `holdReason`
- `pausedAt`
- `heldAt`
- `resumedAt`
- `heldFromState`

When the backend does not provide them, the UI degrades gracefully to the existing linear execution view.
