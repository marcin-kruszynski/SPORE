# Operator Chat Surface Plan

## Goal

Turn SPORE's current self-build backend into a conversation-first operator experience where:

- the operator states intent once,
- the orchestrator manages the durable flow,
- the system stops only for real governance decisions.

## Product Outcome

The target experience is:

1. Operator starts a mission in chat.
2. Orchestrator creates and explains the goal plan in a mission-control view.
3. Operator reviews the plan and approves it from the same thread or the global inbox.
4. Orchestrator runs the managed flow and returns with proposal evidence.
5. Operator reviews the proposal and decides to approve, promote, or request rework.
6. The same thread stays live while the inbox and mission detail refresh around the selected mission.

The shortest operator path is `start mission -> review plan -> approve -> review proposal -> approve/promote/rework`.

## Delivery Rules

- Keep goal plans, work-item groups, proposals, validation bundles, and promotion lanes as the durable source of truth.
- Do not invent a second hidden state machine in the browser.
- Keep Web UI thin over orchestrator HTTP.
- Prefer additive chat orchestration over replacing current self-build routes.
- Keep protected-scope and promotion decisions explicit.

## Phase Map

### Phase 1 - Durable Conversation Backbone

- [x] Add durable operator thread records.
- [x] Add durable operator message records.
- [x] Add durable operator pending-action records.
- [x] Expose thread list/detail and action resolution through orchestrator HTTP.

### Phase 2 - Orchestrator-Controlled Self-Build Flow

- [x] Start a new mission from freeform operator text.
- [x] Translate the first mission message into a goal plan.
- [x] Surface goal-plan review as a pending operator action.
- [x] Allow resolving a pending action by explicit action button or chat reply.
- [x] Auto-progress from approved goal plan into managed execution.
- [x] Auto-run validation when proposal state requires it and policy allows it.
- [x] Surface proposal review and approval gates as pending actions.
- [x] Surface promotion decisions as pending actions.

### Phase 3 - Dedicated Web Mission Control

- [x] Add a dedicated `Operator Chat` view in the browser console.
- [x] Add a thread list sidebar.
- [x] Add a conversation timeline.
- [x] Add pending action cards inside the chat and in the side context panel.
- [x] Add linked artifact cards so operators can jump to the underlying self-build records.
- [x] Add thread-level execution settings for safe mode, stub/real execution, and auto-validation defaults.

### Phase 4 - Deeper Orchestrator Assistance

- [x] Add richer intent routing for follow-up instructions like scope narrowing and plan edits.
- [x] Add explicit handling for proposal rework and quarantine/release from chat.
- [x] Add a conversation-level inbox that aggregates pending actions across all threads.
- [x] Add inbox-ready thread and decision projections directly to pending-action payloads.
- [ ] Add better summarization for validation failures and promotion blockers.

### Phase 5 - Streaming And Mission Control Polish

- [x] Add SSE or incremental polling for live thread updates.
- [x] Add server-authored hero, progress, decision, and evidence projections for the selected mission.
- [x] Add quick replies for safe review stages such as goal-plan scope edits.
- [x] Keep the selected mission detail and the cross-thread inbox synchronized from selected-thread live updates.
- [ ] Add richer evidence cards and diff-focused proposal summaries in chat.
- [ ] Add keyboard-first chat ergonomics and action shortcuts.
- [ ] Add cross-links between Operator Chat and self-build dashboard cards.

## Current Implementation Slice

The current slice delivers:

- a dedicated Operator Chat mission-control panel in Web UI,
- thread/message/action persistence in orchestrator SQLite,
- mission creation from chat,
- goal-plan review requests,
- chat-driven approval responses,
- chat-driven plan edits such as `keep only docs`, `drop 2`, and `prioritize operator-ui-pass`,
- orchestrator-owned progression into self-build artifacts,
- proposal review/approval/rework/quarantine-release/promotion gates as pending actions,
- server-authored mission `hero`, `progress`, `decisionGuidance`, and `evidenceSummary` projections on thread detail,
- a global inbox of pending actions across all operator threads with `threadSummary`, `inboxSummary`, `decisionGuidance`, and direct `choices`,
- quick replies for safe review stages,
- live thread streaming for the selected operator conversation with inbox and thread-list refresh,
- linked artifact context for goal plans, work-item groups, proposals, and integration branches.

## Current Mission-Control Contract

`GET /operator/threads/:id` is the preferred selected-mission read surface. It now carries the hero, progress, current-decision guidance, evidence summary, pending actions, and linked artifacts that the browser uses directly.

`GET /operator/actions` is the preferred global inbox surface. Each pending action already includes the thread title/objective, inbox summary, decision guidance, and action choices needed for compact inbox rendering.

`GET /operator/threads/:id/stream` is the preferred live update surface for the active mission. Clients should refresh the selected mission detail and the global inbox when stream events arrive.

## Next Recommended Work

1. Add richer proposal evidence cards in the Web UI chat panel.
2. Add better summarization for validation failures and promotion blockers.
3. Add keyboard-first chat ergonomics and action shortcuts.
4. Expand tests for promotion-ready and blocked-integration chat flows.
5. Add stronger proposal diff summaries so promotion decisions can stay inside the same mission-control loop.

## Verification

Minimum verification for this slice:

```bash
npm run typecheck
node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts
node --import=tsx --test apps/web/test/self-build-dashboard.test.ts
```
