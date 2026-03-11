# Operator Chat UX Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Operator Chat into a guided mission console with server-authored hero/progress/decision projections, a compact global inbox, stronger decision UX, and a polished responsive layout.

**Architecture:** Keep orchestrator artifacts as the source of truth, but add UX-oriented projections to operator-thread and pending-action payloads so the browser can render a mission-first view without inferring core state from raw artifacts. The Web UI will consume those projections to render a stronger hero header, progress strip, current decision card, quick replies, evidence summaries, and a compact cross-thread inbox.

**Tech Stack:** TypeScript, Node HTTP server, orchestrator SQLite store, plain HTML/CSS browser UI, `node:test`, `tsx`, Biome.

---

## File Map

- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - Add server-authored UX projections for hero, progress, decision guidance, evidence summary, and inbox summary.
- Modify: `packages/orchestrator/src/store/execution-store.impl.ts`
  - Enrich pending-action query payloads if needed for inbox projections.
- Modify: `packages/orchestrator/src/store/entity-mappers.ts`
  - Ensure any new JSON projection fields map cleanly.
- Modify: `packages/orchestrator/src/store/self-build-dao.ts`
  - Re-export any helper/query additions.
- Modify: `packages/orchestrator/src/index.ts`
  - Keep self-build exports aligned if signatures move.
- Modify: `services/orchestrator/server.ts`
  - Keep operator routes stable while returning enriched payloads.
- Modify: `services/orchestrator/test/http-self-build.test.ts`
  - Add coverage for hero/progress/decision/inbox projection payloads.
- Modify: `apps/web/public/index.html`
  - Replace the current operator-chat shell with a hero-first guided mission layout.
- Modify: `apps/web/public/styles.css`
  - Add a stronger visual system, layout hierarchy, responsive collapse, and decision-card styling.
- Modify: `apps/web/public/main.js`
  - Generated browser bundle produced by `npm run web:build` after updating `apps/web/src/*`.
- Modify: `apps/web/src/main.ts`
  - Render backend-authored projections, suggested replies, progress strips, inbox rows, and evidence cards.
- Create: `apps/web/src/operator-chat-view.ts`
  - Hold pure operator-chat section render helpers so projection-driven UI can be tested without booting the full browser app.
- Create: `apps/web/src/operator-chat-controller.ts`
  - Hold pure interaction helpers for quick replies, inbox actions, mission focus, and stream-driven refresh decisions.
- Modify: `apps/web/test/self-build-dashboard.test.ts`
  - Add coverage for the new operator-chat structure and proxy routes.
- Create: `apps/web/test/operator-chat-view.test.ts`
  - Add direct rendering assertions for hero, progress, inbox rows, decision cards, and suggested replies.
- Create: `apps/web/test/operator-chat-controller.test.ts`
  - Add direct behavior assertions for quick-reply request shaping, inbox direct-action request shaping, mission focus transitions, and stream refresh decisions.
- Modify: `apps/web/README.md`
- Modify: `services/orchestrator/README.md`
- Modify: `docs/architecture/clients-and-surfaces.md`
- Modify: `docs/plans/operator-chat-surface-plan.md`

## Chunk 1: Orchestrator UX Projections

### Task 1: Add failing HTTP assertions for mission-control projections

**Files:**
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Test: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write failing assertions for thread-detail UX projections**

Add assertions after thread creation / status transitions that require:

```ts
assert.ok(detail.hero);
assert.equal(typeof detail.hero.statusLine, "string");
assert.ok(Array.isArray(detail.progress?.stages));
assert.equal(typeof detail.decisionGuidance?.title, "string");
assert.ok(detail.evidenceSummary);
```

- [ ] **Step 2: Write failing assertions for exceptional progress states**

Extend the advanced operator-chat flows so they must expose overlay states such as:

```ts
assert.ok(["rework", "quarantined", "completed"].includes(detail.progress?.exceptionState));
```

- [ ] **Step 3: Write failing assertions for the global inbox payload**

Require each pending action returned by `GET /operator/actions` to include thread-facing projection fields:

```ts
assert.equal(typeof action.threadSummary?.title, "string");
assert.equal(typeof action.threadSummary?.objective, "string");
assert.equal(typeof action.inboxSummary?.reason, "string");
assert.equal(typeof action.decisionGuidance?.primaryAction, "string");
assert.ok(Array.isArray(action.decisionGuidance?.secondaryActions));
assert.ok(Array.isArray(action.choices));
```

- [ ] **Step 4: Add failing coverage for all required decision kinds**

Exercise or assert payload coverage for:

- `proposal-review`
- `proposal-approval`
- `proposal-rework`
- `quarantine-release`
- `proposal-promotion`

At minimum, each must expose inbox-ready fields plus `decisionGuidance`.

- [ ] **Step 5: Run the focused HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: FAIL because thread detail and action payloads do not yet expose the new fields.

### Task 2: Implement orchestrator-authored hero, progress, decision, and inbox projections

**Files:**
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `packages/orchestrator/src/store/execution-store.impl.ts`
- Modify: `packages/orchestrator/src/store/entity-mappers.ts`
- Modify: `packages/orchestrator/src/store/self-build-dao.ts`
- Modify: `services/orchestrator/server.ts`

- [ ] **Step 1: Add small pure helpers for UX projection shaping**

Create focused helpers in `packages/orchestrator/src/self-build/operator-chat.impl.ts` for:

```ts
function buildThreadHero(...)
function buildThreadProgress(...)
function buildDecisionGuidance(...)
function buildEvidenceSummary(...)
function buildInboxSummary(...)
```

Each helper should accept already-loaded thread/artifact state and return plain JSON objects.

- [ ] **Step 2: Define the exact hero and evidence payload shapes**

Implement explicit payloads shaped like:

```ts
hero: {
  title: string,
  statusLine: string,
  phase: string,
  primaryCtaHint: string | null,
  badges: { runtime: string; safeMode: string; autoValidate: string; };
}
evidenceSummary: {
  plan: {...} | null,
  proposal: {...} | null,
  validation: {...} | null,
  promotion: {...} | null,
  quarantine: {...} | null,
}
```

- [ ] **Step 3: Define the exact decision-guidance payload shape**

Every pending action should return:

```ts
decisionGuidance: {
  title: string,
  why: string,
  nextIfApproved: string,
  riskNote: string | null,
  primaryAction: string,
  secondaryActions: string[],
  suggestedReplies: string[],
}
```

- [ ] **Step 4: Define a real progress mapping that covers current SPORE states**

Implement stage mapping for at least:

```ts
["mission_received", "plan_prepared", "plan_approval", "managed_work", "proposal_review", "proposal_approval", "validation", "promotion"]
```

and exceptional overlays for:

```ts
["held", "rework", "quarantined", "validation_failed", "promotion_blocked", "completed"]
```

- [ ] **Step 5: Build plain-language hero status lines in the orchestrator**

Examples the helper should produce:

```ts
"I prepared a plan and need your approval before I start."
"I finished the managed run and now need proposal review."
"This mission is blocked because the proposal failed validation."
```

- [ ] **Step 6: Add goal-plan quick-reply suggestions only for valid review states**

When `actionKind === "goal-plan-review"`, populate suggested replies such as:

```ts
["Keep only docs", "Keep only web", "Drop 2", "Prioritize UI first", "Show plan options"]
```

Return `[]` for other action kinds unless a safe explicit suggestion exists.

- [ ] **Step 7: Enrich `GET /operator/actions` payloads for inbox rendering**

Return projection fields directly on each action record, for example:

```ts
threadSummary: {
  title: string,
  objective: string,
}
inboxSummary: {
  urgency: string,
  reason: string,
  waitingLabel: string,
}
```

The browser should not need to join actions with thread metadata to render the inbox.

- [ ] **Step 8: Keep route contracts stable while returning richer detail**

Update `services/orchestrator/server.ts` only enough to pass through the richer projection payloads from the orchestrator helpers.

- [ ] **Step 9: Update package exports if new helpers or shapes require them**

Touch `packages/orchestrator/src/index.ts` and related export files only if the richer operator-chat helpers need re-export alignment.

- [ ] **Step 10: Run the focused HTTP test and verify it passes**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit chunk 1**

```bash
git add packages/orchestrator/src/self-build/operator-chat.impl.ts packages/orchestrator/src/store/execution-store.impl.ts packages/orchestrator/src/store/entity-mappers.ts packages/orchestrator/src/store/self-build-dao.ts packages/orchestrator/src/index.ts services/orchestrator/server.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: add operator chat UX projections"
```

## Chunk 2: Guided Mission Console UI

### Task 3: Add failing web assertions for the new mission-first layout

**Files:**
- Modify: `apps/web/test/self-build-dashboard.test.ts`
- Test: `apps/web/test/self-build-dashboard.test.ts`

- [ ] **Step 1: Write failing assertions for the new layout structure**

Require the HTML shell to contain explicit mission-first regions, for example:

```ts
assert.ok(html.includes("operator-mission-hero"));
assert.ok(html.includes("operator-current-decision"));
assert.ok(html.includes("operator-progress-strip"));
assert.ok(html.includes("operator-quick-replies"));
```

- [ ] **Step 2: Run the focused web test and verify failure**

Run: `node --import=tsx --test apps/web/test/self-build-dashboard.test.ts`

Expected: FAIL because the browser shell does not yet include the new mission-first structure.

### Task 4: Replace the operator-chat layout with a mission-first shell

**Files:**
- Modify: `apps/web/public/index.html`
- Modify: `apps/web/public/styles.css`

- [ ] **Step 1: Update the HTML shell to introduce explicit mission-control regions**

Add sections like:

```html
<section class="operator-mission-hero" id="operator-mission-hero"></section>
<section class="operator-current-decision" id="operator-current-decision"></section>
<section class="operator-progress-strip" id="operator-progress-strip"></section>
<section class="operator-message-list" id="operator-message-list"></section>
```

- [ ] **Step 2: Keep the left rail compact and secondary**

Left rail should contain:

- start mission form,
- global inbox,
- mission list.

Do not let this rail visually dominate the active mission.

- [ ] **Step 3: Add a stronger visual system in CSS**

Implement:

- a more expressive hero treatment,
- stronger card hierarchy,
- cleaner message rhythm,
- obvious current-decision styling,
- compact inbox cards,
- better badge colors for state meanings.

- [ ] **Step 4: Add concrete responsive breakpoints**

Implement:

- `>=1280px`: three columns,
- `900-1279px`: two columns with context below conversation,
- `<900px`: stacked single-column mission-first order.

- [ ] **Step 5: Run the focused web test and verify the shell passes**

Run: `node --import=tsx --test apps/web/test/self-build-dashboard.test.ts`

Expected: PASS for structure assertions.

### Task 5: Extract projection-driven operator-chat rendering into a focused module

**Files:**
- Create: `apps/web/src/operator-chat-view.ts`
- Create: `apps/web/test/operator-chat-view.test.ts`

- [ ] **Step 1: Write failing view rendering tests**

Create direct tests for pure render helpers that accept enriched thread/action payloads and return HTML fragments or view models.

Cover at least:

- mission hero rendering from `detail.hero`,
- progress rendering from `detail.progress`,
- current decision rendering from `detail.decisionGuidance`,
- quick replies from `suggestedReplies`,
- inbox row rendering from `action.threadSummary` and `action.inboxSummary`.

- [ ] **Step 2: Run the focused rendering test and verify failure**

Run: `node --import=tsx --test apps/web/test/operator-chat-view.test.ts`

Expected: FAIL because the focused render module does not exist yet.

- [ ] **Step 3: Create the focused render module**

Add helpers such as:

```ts
export function renderOperatorMissionHero(detail)
export function renderOperatorProgress(detail)
export function renderOperatorCurrentDecision(detail)
export function renderOperatorQuickReplies(detail)
export function renderOperatorEvidenceSummary(detail)
export function renderOperatorInboxRow(action)
```

- [ ] **Step 4: Keep render helpers projection-driven**

Do not derive core mission story from raw artifact internals or `state.operatorThreads` when `hero`, `progress`, `decisionGuidance`, `evidenceSummary`, `threadSummary`, and `inboxSummary` are already present.

- [ ] **Step 5: Run the focused rendering test and verify pass**

Run: `node --import=tsx --test apps/web/test/operator-chat-view.test.ts`

Expected: PASS.

### Task 6: Wire the guided mission console into the browser shell

**Files:**
- Modify: `apps/web/public/index.html`
- Modify: `apps/web/public/styles.css`
- Modify: `apps/web/src/main.ts`
- Create: `apps/web/src/operator-chat-controller.ts`
- Modify: `apps/web/test/self-build-dashboard.test.ts`
- Create: `apps/web/test/operator-chat-controller.test.ts`

- [ ] **Step 1: Add failing shell assertions for the mission-first layout**

Extend `apps/web/test/self-build-dashboard.test.ts` so it fails unless the rendered shell exposes:

```ts
assert.ok(html.includes("operator-mission-hero"));
assert.ok(html.includes("operator-current-decision"));
assert.ok(html.includes("operator-progress-strip"));
assert.ok(html.includes("operator-quick-replies"));
assert.ok(html.includes("operator-inbox-list"));
```

- [ ] **Step 2: Add failing assertions for mission-focus hooks and inbox action hooks**

Require stable data hooks for:

- inbox row selection,
- current-decision highlight target,
- quick-reply buttons.

- [ ] **Step 3: Write failing interaction tests for controller helpers**

Create direct tests for a focused interaction module covering:

- quick-reply request shaping,
- inbox direct-action request shaping,
- row-click mission focus state updates,
- SSE-driven inbox/detail refresh decisions,
- inbox row content preference for `action.threadSummary` and `action.inboxSummary` over thread-list fallbacks.

- [ ] **Step 4: Run the focused controller test and verify failure**

Run: `node --import=tsx --test apps/web/test/operator-chat-controller.test.ts`

Expected: FAIL because the controller helpers do not exist yet.

- [ ] **Step 5: Update the HTML shell to expose the mission-control regions**

Add and wire sections such as:

```html
<section class="operator-mission-hero" id="operator-mission-hero"></section>
<section class="operator-current-decision" id="operator-current-decision"></section>
<section class="operator-progress-strip" id="operator-progress-strip"></section>
<section class="operator-quick-replies" id="operator-quick-replies"></section>
```

- [ ] **Step 6: Update CSS for the stronger mission-first hierarchy**

Implement:

- hero-first emphasis,
- visually dominant current-decision card,
- compact but readable inbox rows,
- cleaner message rhythm,
- the concrete responsive breakpoints from the spec.

- [ ] **Step 7: Create the focused operator-chat controller module**

Add pure helpers such as:

```ts
export function buildQuickReplySubmission(threadId, reply)
export function buildInboxActionSubmission(actionId, choice)
export function deriveMissionFocusState(currentState, action)
export function shouldRefreshInboxFromThreadEvent(previous, next)
```

- [ ] **Step 8: Wire `main.ts` to the focused render and controller modules**

`main.ts` should handle data loading, SSE, and event wiring, while section HTML comes from `apps/web/src/operator-chat-view.ts`.

- [ ] **Step 9: Wire quick replies, inbox direct actions, and mission focus behavior**

Implement browser behavior for:

- clicking a quick-reply chip to send the corresponding message,
- resolving inbox actions directly,
- clicking an inbox row to focus the owning mission,
- visually emphasizing the current decision after mission focus.

- [ ] **Step 10: Keep SSE updates and inbox refresh in sync**

Whenever the selected thread stream updates, refresh both the selected mission detail and the global inbox.

- [ ] **Step 11: Run the focused controller test and verify pass**

Run: `node --import=tsx --test apps/web/test/operator-chat-controller.test.ts`

Expected: PASS.

- [ ] **Step 12: Build the browser bundle and verify generated assets are fresh**

Run: `npm run web:build`

Expected: PASS and `apps/web/public/main.js` updated if needed.

- [ ] **Step 13: Run focused web tests and verify pass**

Run: `node --import=tsx --test apps/web/test/self-build-dashboard.test.ts apps/web/test/operator-chat-view.test.ts apps/web/test/operator-chat-controller.test.ts`

Expected: PASS.

- [ ] **Step 14: Commit chunk 2**

```bash
git add apps/web/public/index.html apps/web/public/styles.css apps/web/public/main.js apps/web/src/main.ts apps/web/src/operator-chat-view.ts apps/web/src/operator-chat-controller.ts apps/web/test/self-build-dashboard.test.ts apps/web/test/operator-chat-view.test.ts apps/web/test/operator-chat-controller.test.ts
git commit -m "feat: polish operator chat mission console"
```

## Chunk 3: Docs And Final Verification

### Task 6: Update docs to describe the polished mission-control UX

**Files:**
- Modify: `apps/web/README.md`
- Modify: `services/orchestrator/README.md`
- Modify: `docs/architecture/clients-and-surfaces.md`
- Modify: `docs/plans/operator-chat-surface-plan.md`

- [ ] **Step 1: Update docs to mention server-authored UX projections**

Describe:

- hero/progress projections,
- global inbox contract,
- quick replies,
- live selected-thread updates.

- [ ] **Step 2: Update usage docs with the simplest operator flow**

Document the operator path as:

```text
start mission -> review plan -> approve -> review proposal -> approve/promote/rework
```

- [ ] **Step 3: Run docs index refresh**

Run: `npm run docs-kb:index`

Expected: PASS.

### Task 7: Run full verification

**Files:**
- Test: `services/orchestrator/test/http-self-build.test.ts`
- Test: `apps/web/test/self-build-dashboard.test.ts`
- Test: `apps/web/test/operator-chat-view.test.ts`
- Test: `apps/web/test/operator-chat-controller.test.ts`

- [ ] **Step 1: Run formatting check**

Run: `npm run format:check`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run HTTP tests**

Run: `npm run test:http`

Expected: PASS.

- [ ] **Step 5: Run web build**

Run: `npm run web:build`

Expected: PASS.

- [ ] **Step 6: Run web tests**

Run: `npm run test:web`

Expected: PASS.

- [ ] **Step 7: Run the focused render test directly**

Run: `node --import=tsx --test apps/web/test/operator-chat-view.test.ts`

Expected: PASS.

- [ ] **Step 8: Run the focused controller test directly**

Run: `node --import=tsx --test apps/web/test/operator-chat-controller.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit chunk 3**

```bash
git add apps/web/README.md services/orchestrator/README.md docs/architecture/clients-and-surfaces.md docs/plans/operator-chat-surface-plan.md
git commit -m "docs: describe polished operator chat UX"
```
