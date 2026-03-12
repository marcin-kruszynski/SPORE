# Agent Cockpit Home Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new session-first `Agent Cockpit` route and lane detail route that make active runtime work, artifacts, and blockers visible without disturbing the existing dashboard pages.

**Architecture:** Build a new `cockpit` feature on top of existing session-gateway, operator thread, execution, and self-build read surfaces. Derive stable `lane` view models in adapters, keep lane and detail pages real-backed, and add semantic deduplication so repeated workflow updates collapse into stable operator-visible state instead of flooding the UI.

**Tech Stack:** TypeScript, React, React Router, TanStack Query, existing SPORE web proxy routes, `node:test`, `tsx`.

---

## File Map

- Create: `apps/web/src/types/agent-cockpit.ts`
  - Stable lane, attention, artifact, and detail contracts.
- Create: `apps/web/src/adapters/agent-cockpit.ts`
  - Lane derivation, artifact merge rules, attention aggregation, and repeated-update deduplication.
- Create: `apps/web/src/features/agent-cockpit/use-agent-cockpit.ts`
  - Cockpit home query orchestration and refresh behavior.
- Create: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts`
  - Lane detail query orchestration and live session refresh.
- Create: `apps/web/src/components/cockpit/AgentLaneCard.tsx`
- Create: `apps/web/src/components/cockpit/AttentionPanel.tsx`
- Create: `apps/web/src/components/cockpit/RecentArtifactsPanel.tsx`
- Create: `apps/web/src/components/cockpit/AgentSessionSummary.tsx`
- Create: `apps/web/src/components/cockpit/LaneUnavailableState.tsx`
  - Focused cockpit presentation components.
- Create: `apps/web/src/pages/AgentCockpitPage.tsx`
- Create: `apps/web/src/pages/AgentLaneDetailPage.tsx`
  - New cockpit routes.
- Modify: `apps/web/src/App.tsx`
  - Add `/cockpit` and `/cockpit/agents/:laneId` routes.
- Modify: `apps/web/src/components/dashboard/AppSidebar.tsx`
  - Add navigation entry for the new cockpit without disturbing `/agents` catalog.
- Modify: `apps/web/src/lib/api/sessions.ts`
  - Extend if needed for cockpit detail reads.
- Modify: `apps/web/src/lib/api/operator.ts`
- Modify: `apps/web/src/lib/api/executions.ts`
- Modify: `apps/web/src/lib/api/self-build.ts`
  - Reuse current APIs and add any thin helpers needed by cockpit derivation.
- Create: `apps/web/test/agent-cockpit-adapter.test.ts`
- Create: `apps/web/test/agent-cockpit-page.test.ts`
- Create: `apps/web/test/agent-lane-detail-page.test.ts`
  - Focused tests for lane derivation, deduplication, and detail fallback behavior.
- Modify: `package.json`
  - Include the new cockpit tests in `npm run test:web` from the first chunk onward.

## Chunk 1: Stable Lane Derivation And Cockpit Home Route

### Task 1: Define lane identity and repeated-update deduplication in tests first

**Files:**
- Create: `apps/web/test/agent-cockpit-adapter.test.ts`

- [ ] **Step 1: Write a failing test for stable lane identity precedence**

Cover:

- `sessionId` wins when present,
- `executionId + roleLabel` is next,
- `threadId + roleLabel` is the final fallback,
- two distinct `sessionId`s never collapse into one lane.

- [ ] **Step 2: Write a failing test for repeated workflow-update deduplication**

Use repeated updates for the same proposal and stage, such as repeated validation-start messages, and require one lane state plus one attention item rather than unbounded duplicates.

- [ ] **Step 2A: Write a failing test for attention precedence rules**

Require:

- pending approval to outrank promotion-ready for the same proposal,
- blocked or error lane states to outrank informational workflow updates,
- one semantic target to produce one attention item.

- [ ] **Step 3: Write a failing test for artifact deduplication and freshness merge**

Require artifacts to deduplicate by `type + id` while preserving the freshest timestamp and best label.

- [ ] **Step 3A: Write a failing test for partial artifact enrichment failure**

Require the adapter to keep an artifact shell visible when enrichment fields fail to load, rather than dropping the artifact entirely.

- [ ] **Step 4: Run the focused adapter test to verify failure**

Run: `node --import=tsx --test apps/web/test/agent-cockpit-adapter.test.ts`

Expected: FAIL because the cockpit contracts and adapter do not exist yet.

### Task 2: Implement cockpit contracts and lane-derivation adapter

**Files:**
- Create: `apps/web/src/types/agent-cockpit.ts`
- Create: `apps/web/src/adapters/agent-cockpit.ts`
- Modify: `apps/web/src/lib/api/operator.ts`
- Modify: `apps/web/src/lib/api/executions.ts`
- Modify: `apps/web/src/lib/api/self-build.ts`
- Modify: `package.json`

- [ ] **Step 1: Add explicit cockpit view-model contracts**

Define `AgentLaneCardViewModel`, `AttentionItemViewModel`, `RecentArtifactViewModel`, and `AgentSessionDetailViewModel` in `apps/web/src/types/agent-cockpit.ts`.

- [ ] **Step 2: Implement lane identity helpers in the adapter**

Add small helpers for deterministic `laneId`, alias-safe grouping, and stage normalization.

- [ ] **Step 3: Implement semantic deduplication for repeated workflow updates**

Collapse repeated validation-start or equivalent identical updates into one lane state and one attention item keyed by semantic target.

- [ ] **Step 3A: Implement attention precedence rules**

Encode the spec rules so approval outranks promotion-ready for the same target and blocked or errored lane state outranks informational workflow updates.

- [ ] **Step 4: Implement artifact merge rules in the adapter**

Deduplicate by `type + id`, prefer freshest timestamps, and prefer backend-authored labels over fallback labels.

- [ ] **Step 4A: Preserve artifact shells through partial enrichment failures**

If enrichment fetches fail, keep the artifact identity visible with degraded detail instead of dropping it.

- [ ] **Step 5: Add any missing thin API helpers needed by cockpit derivation**

Only extend the existing API modules where a real route is already available and needed by the cockpit adapter or hooks.

- [ ] **Step 5A: Register cockpit tests in `npm run test:web`**

Update `package.json` so `npm run test:web` includes the cockpit tests that exist in this chunk:

- `apps/web/test/agent-cockpit-adapter.test.ts`
- `apps/web/test/agent-cockpit-page.test.ts`

Add the lane-detail test in Chunk 3 once that file exists.

- [ ] **Step 6: Run the focused adapter test and verify it passes**

Run: `node --import=tsx --test apps/web/test/agent-cockpit-adapter.test.ts`

Expected: PASS.

### Task 3: Add the cockpit home route and active-lane cards

**Files:**
- Create: `apps/web/src/features/agent-cockpit/use-agent-cockpit.ts`
- Create: `apps/web/src/components/cockpit/AgentLaneCard.tsx`
- Create: `apps/web/src/components/cockpit/AttentionPanel.tsx`
- Create: `apps/web/src/components/cockpit/RecentArtifactsPanel.tsx`
- Create: `apps/web/src/pages/AgentLaneDetailPage.tsx`
- Create: `apps/web/src/pages/AgentCockpitPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/dashboard/AppSidebar.tsx`
- Create: `apps/web/test/agent-cockpit-page.test.ts`

- [ ] **Step 1: Write a failing page test for cockpit home rendering**

Require `/cockpit` to render active lanes, attention items, and recent artifacts from real-derived view models.

At minimum, each lane card should show state badge, current step, latest meaningful update, and relative freshness.

- [ ] **Step 1A: Write a failing page test for clickable lane cards and quick links**

Require each lane card to expose click-through behavior plus visible links or buttons for session, mission, and newest artifact when available.

- [ ] **Step 2: Write a failing page test for empty and degraded states**

Require explicit empty-state and degraded-state treatment instead of blank UI.

Require the empty state to link to `Chat` and `Mission Map`, and require degraded mode to preserve last-known lane cards while marking them degraded.

- [ ] **Step 3: Run the focused page test to verify failure**

Run: `node --import=tsx --test apps/web/test/agent-cockpit-page.test.ts`

Expected: FAIL because the cockpit route and page do not exist yet.

- [ ] **Step 4: Implement the cockpit home hook**

Use current operator, execution, session-summary-adjacent, and self-build surfaces to derive active lanes, attention, and recent artifacts.

- [ ] **Step 5: Implement the cockpit home page and cards**

Render `Active Agents`, `Needs Attention`, and `Recent Artifacts` with lane-first visual priority.

- [ ] **Step 5A: Make lane cards clickable and expose quick links**

Ensure each lane card can open its detail route and expose quick links to session, mission, and newest artifact where the data exist.

- [ ] **Step 5B: Add a minimal clickable lane-detail route shell in this chunk**

Create a temporary but valid `AgentLaneDetailPage` route target so lane-card click-through works as a standalone slice before the full detail implementation lands in Chunk 2.

- [ ] **Step 6: Add cockpit route and sidebar navigation**

Add `/cockpit` and a minimal `/cockpit/agents/:laneId` route without breaking the existing `/agents` catalog route.

- [ ] **Step 7: Run the focused cockpit page test and verify it passes**

Run: `node --import=tsx --test apps/web/test/agent-cockpit-page.test.ts`

Expected: PASS.

- [ ] **Step 8: Run web verification for this chunk**

Run:

```bash
npm run test:web
npm run typecheck
npm run web:build
```

Expected: PASS.

## Chunk 2: Lane Detail, Session Visibility, And Artifact Drill-In

### Task 4: Define detail-route fallback behavior in tests first

**Files:**
- Create: `apps/web/test/agent-lane-detail-page.test.ts`

- [ ] **Step 1: Write a failing test for opening a lane detail route**

Require `/cockpit/agents/:laneId` to show current session status, mission linkage, artifact links, and recent updates.

- [ ] **Step 1A: Write a failing test for direct route bootstrap without warmed cockpit cache**

Require the detail route to load correctly when opened directly, without first visiting `/cockpit`.

- [ ] **Step 2: Write a failing test for stale or unknown lane ids**

Require a recoverable `lane unavailable` state with retry and link-back behavior.

- [ ] **Step 2A: Extend the stale-lane test with route-param and last-known linkage output**

Require the fallback UI to show the route param and last known mission or session linkage when available.

- [ ] **Step 3: Write a failing test for partial session-live failure**

Require the detail page to keep last known lane and artifact context visible when session live reads fail or degrade.

- [ ] **Step 3A: Write a failing test for visible session unavailable and reconnect state**

Require a visible `session unavailable` or reconnecting state plus retry affordance during live-session degradation.

- [ ] **Step 4: Run the focused lane-detail test to verify failure**

Run: `node --import=tsx --test apps/web/test/agent-lane-detail-page.test.ts`

Expected: FAIL because the new detail route does not exist yet.

### Task 5: Implement the lane detail route and session-focused detail components

**Files:**
- Create: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts`
- Create: `apps/web/src/components/cockpit/AgentSessionSummary.tsx`
- Create: `apps/web/src/components/cockpit/LaneUnavailableState.tsx`
- Create: `apps/web/src/pages/AgentLaneDetailPage.tsx`
- Modify: `apps/web/src/lib/api/sessions.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Implement the lane detail hook**

Resolve the selected lane from derived home data, then enrich it with session live detail and linked artifact context.

If the cockpit home cache is absent, bootstrap enough summary data directly from real sources to resolve the lane safely.

- [ ] **Step 2: Implement lane unavailable and degraded-session states**

Keep explicit fallback UI for stale `laneId`, missing live session, and partial artifact failures.

- [ ] **Step 2A: Preserve the previous lane snapshot during live-session degradation**

Do not blank the detail page when session live refresh fails after a previous successful load.

- [ ] **Step 2B: Keep ambiguous linkage explicitly partial instead of guessing**

If mission or execution linkage is uncertain, show unknown or partial linkage rather than attaching the lane to the wrong context.

- [ ] **Step 3: Implement the lane detail page**

Render current state first, then recent updates, then linked artifacts and related mission/execution context.

- [ ] **Step 3A: Include direct session inspection entrypoints and last visible outputs**

The detail page should expose clear session inspection links or launch metadata plus the latest meaningful outputs or summaries from that lane.

- [ ] **Step 4: Run the focused lane-detail test and verify it passes**

Run: `node --import=tsx --test apps/web/test/agent-lane-detail-page.test.ts`

Expected: PASS.

- [ ] **Step 5: Run direct lane-detail verification before curated suite**

Run:

```bash
node --import=tsx --test apps/web/test/agent-lane-detail-page.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run web verification for this chunk**

Run:

```bash
npm run test:web
npm run typecheck
npm run web:build
```

Expected: PASS.

## Chunk 3: Test Registration, Navigation Fit, And Final Verification

### Task 6: Register the new cockpit tests and tighten route-level coverage

**Files:**
- Modify: `package.json`
- Modify: `apps/web/test/react-dashboard-shell.test.ts`
- Modify: `apps/web/test/agent-cockpit-page.test.ts`
- Modify: `apps/web/test/agent-lane-detail-page.test.ts`
- Modify: `apps/web/src/components/dashboard/AppSidebar.tsx`

- [ ] **Step 1: Update `npm run test:web` to include the new cockpit tests**

Add:

- `apps/web/test/agent-cockpit-adapter.test.ts`
- `apps/web/test/agent-cockpit-page.test.ts`
- `apps/web/test/agent-lane-detail-page.test.ts`

- [ ] **Step 2: Add shell-level route coverage for the new cockpit URLs**

Extend the existing shell test so `/cockpit` and `/cockpit/agents/test-lane` receive the SPA shell rather than a 404.

- [ ] **Step 2A: Add App-level route coverage for the cockpit pages**

Extend the cockpit page tests so rendering `App` at `/cockpit` and `/cockpit/agents/:laneId` proves the client routes are registered and do not hydrate into `NotFound`.

- [ ] **Step 2B: Add sidebar navigation coverage for the new cockpit entry**

Verify the sidebar renders an `Agent Cockpit` entry and that it does not collide with the existing `/agents` catalog navigation.

- [ ] **Step 3: Run the focused shell test and verify it passes**

Run: `node --import=tsx --test apps/web/test/react-dashboard-shell.test.ts`

Expected: PASS.

### Task 7: Run final verification for the feature slice

**Files:**
- No additional file changes required unless verification exposes regressions.

- [ ] **Step 1: Run full web verification**

Run: `npm run test:web`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run build verification**

Run: `npm run web:build`

Expected: PASS.

- [ ] **Step 4: Refresh docs index if docs changed beyond plan/spec**

Run: `npm run docs-kb:index`

Expected: PASS.
