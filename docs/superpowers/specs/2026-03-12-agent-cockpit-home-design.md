# Agent Cockpit Home Design

## Intent

Add a new `Agent Cockpit` home surface to the SPORE dashboard that makes active execution lanes, runtime sessions, session history, artifacts, and blockers visibly operable for a human supervisor.

The new page should answer these questions immediately:

- which agents are currently working,
- what each agent is doing right now,
- whether an agent is running, waiting, blocked, errored, or finished,
- what artifacts a given agent or lane has produced,
- how to open the underlying session and inspect its recent output.

This work should leave the existing `Chat`, `Mission Map`, `Self-Build`, `Projects`, and `Workflows` pages in place for now. The cockpit becomes a new operational home, not a destructive rewrite of those surfaces.

## Problem Statement

The current dashboard shows governance and mission state, but it does not make runtime activity legible enough for operator supervision.

Observed issues:

- `Mission Map` emphasizes mission and execution topology over active runtime lanes, so an operator cannot quickly see which agent is currently working.
- session visibility is too indirect; there is no first-class, click-through session detail surface centered in the main operator flow.
- approvals are visible, but operational state is not dominant enough.
- repeated workflow updates such as `Proposal ... needs validation. I am running the configured validation flow now.` can flood the operator timeline, making it harder to understand what changed meaningfully.

The result is that a supervisor can approve work but still struggle to answer whether the system is actively progressing, stalled, or done.

## Product Goal

Make SPORE feel like a live multi-agent control room instead of a thread viewer with side evidence.

The cockpit should provide:

- a session-first operational overview,
- a clear distinction between active work and governance actions,
- direct entry into a session-focused detail page,
- stable artifact visibility per lane,
- deduplicated attention handling for noisy repeated workflow updates.

## Chosen Direction

The chosen direction is `Agent Cockpit as New Home`.

This introduces a new top-level home page and route dedicated to agent/session supervision. Existing pages remain available and continue to serve their current roles.

## Implementation Scope For This Spec

This spec covers one delivery slice only:

- a new cockpit home route,
- a new lane/session detail route,
- stable lane derivation from current real data,
- first-pass `Needs Attention` and `Recent Artifacts` summaries,
- semantic deduplication for repeated workflow updates in the cockpit view models.

This spec does not include replacing the existing `/agents` catalog, deleting current pages, or promoting `/` to the cockpit home yet.

Role split:

- `Agent Cockpit` = active lane and session supervision,
- `Chat` = decisions, approvals, and operator conversation,
- `Mission Map` = topology and execution relationships,
- `Self-Build / Evidence` = artifact and readiness drilldowns.

## Non-Goals

- replacing every existing dashboard page in the same change,
- inventing a new backend `agent` domain before the UI is useful,
- turning mock-backed admin/catalog pages into real-backed surfaces,
- rebuilding mission topology again from scratch,
- solving all operator-chat UX problems inside the cockpit page.

## Operational Model

## 1. Primary Entity: Session Lane

The cockpit's main unit is a `session lane`, not a mission node and not an approval card.

A session lane is a real or derived-real representation of one active execution participant, typically corresponding to a runtime session that can be inspected through session-gateway and linked back to mission and execution context.

Each lane should have:

- role or agent label,
- session identifier,
- runtime state,
- current stage or task,
- last activity timestamp,
- linked mission or thread,
- linked execution or work item where available,
- recent artifact references,
- open-session and open-artifact entrypoints.

## 2. Agent vs Session

The first implementation should not require a new backend-first `agent` resource.

Instead, the UI should derive agent-like presentation from:

- runtime session records,
- execution family metadata,
- coordination-group or role metadata,
- thread and evidence context.

This gives operators a practical agent view without blocking on domain modeling work.

The term `agent` in the cockpit is presentation language only. It must remain technically distinct from the existing mock-backed catalog concept under `/agents`.

- cockpit entity = `session lane`,
- catalog entity = `agent catalog record`.

The new routes and components should therefore prefer `lane` naming in code and reserve `agent` for display copy only.

## 3. Stable Lane Identity

`laneId` must be deterministic and safe across partial data.

Identity precedence:

1. linked `sessionId` when present,
2. `executionId + roleLabel` when session is absent but execution linkage is stable,
3. `threadId + roleLabel` when execution linkage is absent,
4. never merge multiple live sessions into one lane if they have different session ids.

If session rotation occurs for the same logical role, the old lane may remain in recent-history state, but the active lane should key to the current session id.

If multiple sessions exist under one execution and role, they must render as separate lanes until the backend gives a stronger grouping identity.

## Page Architecture

## 1. Agent Cockpit Home

The cockpit page should have three main zones.

### Active Agents

This is the dominant zone of the page.

It lists active or recently active session lanes as cards or rows. Each item should immediately show:

- lane name,
- state badge,
- current step,
- latest meaningful update,
- relative freshness,
- quick links to session, mission, and newest artifact.

### Needs Attention

This zone contains:

- approvals,
- validation blockers,
- promotion blockers,
- waiting review or waiting approval states,
- errored or stalled lanes.

This zone is important but should not visually overpower `Active Agents`.

Attention precedence and dedup rules:

- one semantic target produces one item,
- pending approval outranks promotion-ready status for the same proposal,
- error or blocked lane state outranks informational workflow updates,
- repeated identical workflow updates only refresh `lastSeenAt` and optional repeat count.

### Recent Artifacts

This zone shows recently produced proposal, workspace, review-package, report, or output artifacts.

It helps the operator understand what just changed without drilling into every lane.

Artifact merge rules:

- deduplicate by `type + id`,
- prefer the freshest timestamp from any source family,
- if two sources disagree on label, keep the backend-authored evidence label over a derived fallback,
- partial fetch failure may remove enrichment fields but should not remove the artifact shell if identity is known.

## 2. Agent Session Detail

Clicking a lane opens a dedicated `Agent Detail` page.

This page should include:

- current session status,
- last known stage or current task,
- recent timeline of meaningful updates,
- linked mission and execution context,
- linked artifacts,
- direct session inspection entrypoints,
- last visible outputs or summaries from that lane.

The detail page should prioritize clarity over raw volume. Show current state first, then recent changes, then deeper history.

If a lane detail route is stale or unknown, the page should render a recoverable `lane unavailable` state with:

- route param,
- last known mission or session linkage if available,
- retry affordance,
- link back to `/cockpit`.

## 3. Existing Pages Stay In Place

The existing pages remain, but their role becomes clearer.

- `Chat` keeps full approval and conversational flow.
- `Mission Map` remains the structural topology view.
- `Self-Build` keeps summary and evidence readiness surfaces.

The cockpit is an operator's runtime home, not a replacement for those deeper views.

## Data Model

## 1. Derived View Models

The cockpit should introduce explicit frontend models such as:

```ts
type AgentLaneCardViewModel = {
  id: string;
  label: string;
  sessionId: string | null;
  state: "running" | "waiting" | "blocked" | "completed" | "error" | "unknown";
  stageLabel: string | null;
  latestSummary: string | null;
  lastActivityAt: string | null;
  missionId: string | null;
  missionTitle: string | null;
  executionId: string | null;
  workItemId: string | null;
  artifactLinks: ArtifactLinkViewModel[];
  attention: AttentionChipViewModel[];
};
```

```ts
type AgentSessionDetailViewModel = {
  laneId: string;
  label: string;
  session: SessionStatusViewModel | null;
  runtime: RuntimeStateViewModel;
  mission: MissionContextViewModel | null;
  execution: ExecutionContextViewModel | null;
  recentUpdates: TimelineUpdateViewModel[];
  artifacts: ArtifactLinkViewModel[];
  attention: AttentionChipViewModel[];
};
```

## 2. Real Data Sources

The cockpit should compose from existing sources rather than wait for a new backend resource.

Primary source families:

- session-gateway live routes for runtime session state,
- orchestrator thread and pending-action routes for mission context,
- execution and coordination-family routes for lane grouping,
- self-build and evidence routes for proposal, validation, promotion, and workspace context.

Exact current surfaces to use first:

- `GET /api/orchestrator/operator/threads`
- `GET /api/orchestrator/operator/threads/:id`
- `GET /api/orchestrator/operator/actions`
- `GET /api/orchestrator/executions/:id`
- `GET /api/orchestrator/executions/:id/tree`
- `GET /api/orchestrator/coordination-groups`
- `GET /api/sessions/:id/live`
- `GET /api/orchestrator/self-build/summary`
- `GET /api/orchestrator/self-build/dashboard`
- existing proposal / workspace / validation / promotion read routes already used by the React self-build surfaces.

Adapter boundaries should be explicit:

- lane derivation adapter,
- attention aggregation adapter,
- recent-artifact adapter,
- lane detail adapter.

Live-refresh strategy:

- use polling or existing route refetch for the cockpit summary surface,
- use session live reads and existing stream-capable sources only for lane detail or clearly scoped active-lane refresh,
- do not build a new raw event console into the home page in this slice.

## 3. Stability Rule

The UI should update a stable lane card instead of creating a new row for every event.

That means repeated state messages update:

- current state,
- current step,
- last activity time,
- latest summary,

rather than multiplying visible rows.

## Repeated Event Handling

The repeated `needs validation` messages should be treated as a real product bug, not just an aesthetic issue.

The cockpit design therefore includes semantic deduplication at the view-model layer:

- identical workflow updates for the same lane, proposal, and stage collapse into one active state entry,
- repeated updates only refresh timestamps or counters,
- the detail page may still show a compact history, but the home page must not flood.

Likewise, `Needs Attention` should deduplicate by semantic target:

- one proposal awaiting approval = one attention card,
- one validation blocker = one attention card,
- one promotion-ready decision = one attention card.

For this slice, deduplication must at minimum collapse repeated validation-start workflow updates of the form already observed in operator chat.

## Error Handling

If session-gateway data are unavailable:

- the cockpit should show the last known lane metadata where possible,
- each lane should make absence explicit via `session unavailable`,
- retry affordances should be present,
- the page must not pretend nothing is running.

Additional required states:

- no active lanes -> explicit empty state with links to `Chat` and `Mission Map`,
- orchestrator/thread degradation -> keep last known lane cards and mark them degraded,
- partial artifact fetch failure -> keep lane and artifact identities visible with reduced detail,
- live reconnect/disconnect -> visible status in lane detail, not a silent failure,
- stale detail route -> recoverable not-found style lane state, not blank UI.

If linkage is ambiguous:

- prefer showing unknown or partial linkage,
- do not aggressively attach a lane to the wrong mission or execution,
- surface degraded linkage in the detail page if necessary.

## UX Principles

- active work is visually primary,
- governance is visible but secondary,
- status must be legible at a glance,
- operator clicks should open useful detail immediately,
- artifacts must be reachable from where the work happened,
- history should be layered: summary first, raw detail second.

## Routing Strategy

Recommended initial routes:

- `/cockpit` — Agent Cockpit home,
- `/cockpit/agents/:laneId` — lane/session detail.

The mock-backed `/agents` catalog remains untouched and separate.

After validation, `/` can later redirect to or render the cockpit as the default home. That cutover does not need to happen in the same change if it adds risk.

## Implementation Phases

## Phase 1

- add `Agent Cockpit` route and navigation entry,
- derive and render active session lane cards,
- keep cards clickable.

## Phase 2

- add `Agent Detail` page,
- wire session live detail, recent updates, and artifact links.

## Phase 3

- add `Needs Attention` and `Recent Artifacts` zones,
- integrate approval/blocker summarization.

## Phase 4

- add repeated-event semantic deduplication for noisy workflow updates,
- ensure home and detail views remain readable under repeated backend events.

Promotion of `/` to cockpit home is explicitly deferred to a follow-up change after this slice proves stable.

## Verification Strategy

Required verification should cover:

- cockpit renders real session lanes,
- clicking a lane opens the correct detail view,
- session detail keeps linked artifacts and mission context visible,
- approval and blocker items remain reachable,
- repeated workflow-update events do not create unbounded duplicate home-page entries,
- degraded linkage or missing session live state is surfaced clearly.

Concrete expected verification includes:

```bash
npm run web:build
npm run test:web
npm run typecheck
```

And dedicated tests for:

- lane identity derivation,
- lane detail fallback for stale route params,
- repeated validation-update deduplication,
- degraded orchestrator or session live reads,
- artifact dedup and partial enrichment failure.

## Definition Of Success

This design succeeds when an operator can open the dashboard and immediately answer:

- which agents are active,
- what each agent is doing,
- whether one is stuck or waiting,
- what each lane last produced,
- how to open the lane's session and inspect it.

It also succeeds when repeated workflow updates no longer overwhelm the operator's primary view.
