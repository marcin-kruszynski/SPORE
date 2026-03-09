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
- adds workflow plan preview so operators can inspect invocation policy before launch:
  - merged execution `effectivePolicy`
  - per-launch `policy` blocks for each planned step
  - readable per-launch deltas against preview `effectivePolicy`
- adds durable execution visibility and governance controls over orchestrator APIs:
  - execution list (`GET /executions`)
  - execution detail (`GET /executions/:id`)
  - execution tree (`GET /executions/:id/tree`)
  - execution event stream (`GET /stream/executions?execution=:id`)
  - drive (`POST /executions/:id/drive`)
  - drive tree (`POST /executions/:id/tree/drive`)
  - pause (`POST /executions/:id/pause`)
  - pause tree (`POST /executions/:id/tree/pause`)
  - hold (`POST /executions/:id/hold`)
  - hold tree (`POST /executions/:id/tree/hold`)
  - resume (`POST /executions/:id/resume`)
  - resume tree (`POST /executions/:id/tree/resume`)
  - branch spawn (`POST /executions/:id/branches`)
  - review (`POST /executions/:id/review`)
  - family review (`POST /executions/:id/tree/review`)
  - approval (`POST /executions/:id/approval`)
  - family approval (`POST /executions/:id/tree/approval`)
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
- renders execution effective policy from the persisted execution payload when available
- adds rooted tree controls so operators can drive, pause, hold, or resume the whole execution family from the selected execution
- adds family governance controls so operators can review or approve all pending descendants from the selected rooted execution
- adds branch-spawn controls with JSON branch specs, optional post-spawn drive, and first-created branch focus after creation
- compares current workflow plan preview policy against the selected persisted execution policy when both are present
- renders per-step policy detail inside the execution tree from each step `policy` payload
- renders step-level policy deltas against persisted execution policy and preview launch policy when available
- renders wave progression summaries from rooted execution tree payloads, including gate mode and per-wave state totals
- renders lineage and execution hierarchy from the orchestrator tree payload instead of reconstructing hierarchy only from coordination-group members
- shows hold ownership and timeout guidance affordances when additive backend fields are present, while still exposing policy-based watchdog defaults
- surfaces policy pack and preset labels when backend or config metadata exposes them in additive payload fields
- renders execution step/session tree with clearer lineage cues from orchestrator detail payloads
- renders a coordination and lineage board for parent/child execution context when optional payload fields are present
- renders execution timeline/history from workflow events where available
- renders structured execution history from `/executions/:id/history`, including wave summary and policy diff in one view
- renders scenario catalog, latest scenario runs, and one-click scenario launch over orchestrator APIs
- renders regression catalog summaries and one-click regression runs over orchestrator APIs
- adds richer run-center drilldowns:
  - dedicated run-center summary panel (`GET /orchestrator/run-center/summary`) with:
    - scenario summaries
    - regression summaries
    - recent scenario runs
    - recent regression runs
    - aggregated route count cards
    - operator advisories from `alerts[]` and `recommendations[]` when present
    - aggregate trend, failure, and flaky summary cards when additive breakdown payloads are present
    - latest report cards with direct report/artifact path links when additive report summaries are present
  - scenario run selection with per-run metadata, execution links, and scenario-run artifact route integration
  - regression run selection with per-item scenario outcomes, execution jump links, and report/artifact path references
  - route-backed drilldown blocks for selected run/report/artifact payloads when corresponding scenario/regression routes are available
  - trend snapshot rendering in summaries and run drilldowns when `trendSnapshot`-style payloads are present
  - route-backed trend detail drilldowns from:
    - `GET /orchestrator/scenarios/:id/trends`
    - `GET /orchestrator/regressions/:id/trends`
  - route-backed regression report drilldown from:
    - `GET /orchestrator/regression-runs/:runId/report`
  - failure classification and reason rendering from additive `failure`/`latestFailure` payloads
  - suggested action rendering from additive `suggestedActions`/`latestSuggestedActions` payloads
  - execution-history row selection with in-panel drilldowns to execution/session/audit/escalation/scenario-run references when payload fields are present
- keeps the browser proxy aligned with new self-build/work-item orchestrator surfaces so thin-client drilldowns can rely on HTTP contracts instead of local file reads:
  - `GET /self-build/summary`
  - `GET /work-item-templates` and `GET /work-item-templates/:id`
  - `GET /goal-plans`, `POST /goals/plan`, `GET /goal-plans/:id`, `POST /goal-plans/:id/materialize`
  - `GET /work-item-groups`, `GET /work-item-groups/:id`, `POST /work-item-groups/:id/run`
  - `GET /work-items`, `GET /work-items/:id`, `GET /work-items/:id/runs`, `POST /work-items/:id/run`
  - `GET /work-item-runs/:runId`, `GET /work-item-runs/:runId/proposal`, `POST /work-item-runs/:runId/validate`, `GET /work-item-runs/:runId/doc-suggestions`
  - `GET /proposal-artifacts/:id`, `POST /proposal-artifacts/:id/review`, `POST /proposal-artifacts/:id/approval`
- enriches session detail with Session Live v2 diagnostics from `GET /sessions/:id/live`, including:
  - operator urgency
  - stale session flag and stale reason
  - settle lag
  - launcher metadata snapshot
  - control ack status/result
  - latest control action timestamp
  - additive control history and recovery suggestion hints
  - `expectedOutcome` and `httpHint` fields in suggestions when present
- renders execution wave progression summaries from rooted tree `stepSummary.byWave` data in both the tree and timeline surfaces
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

The browser remains compatible with additive payloads. When trend, report, or run-detail routes are unavailable, the UI falls back to aggregate run-center summaries and embedded run metadata instead of assuming a fixed backend schema.

## Optional Execution Payload Fields

The execution surface is now prepared to consume these fields when they appear in list or detail payloads:

- `coordinationGroupId`
- `parentExecutionId`
- `childExecutionIds`
- `branchKey`
- `holdReason`
- `holdOwner`
- `holdOwnerRole`
- `holdExpiresAt`
- `holdTimeoutMs`
- `holdGuidance`
- `operatorGuidance`
- `pausedAt`
- `heldAt`
- `resumedAt`
- `heldFromState`

When the backend does not provide them, the UI degrades gracefully to the existing linear execution view.
