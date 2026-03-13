# Lead-Governed Agent Cockpit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lead` the internal workflow governor, tighten scout/builder/tester/reviewer responsibilities, and make Agent Cockpit / Agent Detail faster and clearer for operators.

**Architecture:** Adjust workflow and profile semantics so specialist transitions are lead-governed, proposal governance blocks on invalid specialist handoffs, and cockpit rendering is split into a lightweight current-family path plus lazy detail/history hydration. UI changes keep `input -> live output -> returned output` at the top of Agent Detail and reduce eager loading in Agent Cockpit.

**Tech Stack:** TypeScript, React, React Router, TanStack Query, Node test runner, SPORE orchestrator/session-gateway/runtime-pi packages, agent-browser-compatible UI flows.

---

## File Map

- Modify: `config/workflows/feature-delivery.yaml`
  - Make lead-governed transitions explicit and align completion semantics with the new governance model.
- Modify: `config/profiles/lead.yaml`
  - Keep lead coordination-only, add explicit governance responsibility, preserve no-write boundary.
- Modify: `config/profiles/scout.yaml`
- Modify: `config/profiles/builder.yaml`
- Modify: `config/profiles/tester.yaml`
- Modify: `config/profiles/reviewer.yaml`
  - Tighten role responsibilities and output expectations.
- Modify: `.pi/prompts/lead.md`
- Modify: `.pi/prompts/scout.md`
- Modify: `.pi/prompts/builder.md`
- Modify: `.pi/prompts/tester.md`
- Modify: `.pi/prompts/reviewer.md`
  - Make prompts match the intended role boundaries and outputs.
- Modify: `packages/orchestrator/src/execution/handoff-validation.ts`
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - Enforce lead-governed internal progression and block invalid specialist outputs from leaking into governance.
- Modify: `apps/web/src/features/agent-cockpit/use-agent-cockpit.ts`
- Modify: `apps/web/src/adapters/agent-cockpit.ts`
- Modify: `apps/web/src/pages/AgentCockpitPage.tsx`
  - Introduce a lighter current-family data path and reduce eager history/promotion payload loading.
- Modify: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts`
- Modify: `apps/web/src/components/cockpit/AgentSessionSummary.tsx`
- Modify: `apps/web/src/pages/AgentLaneDetailPage.tsx`
  - Make `Input / Live output / Returned output` the primary operator detail flow.
- Modify: `apps/web/test/agent-cockpit-adapter.test.ts`
- Modify: `apps/web/test/agent-cockpit-page.test.ts`
- Modify: `apps/web/test/agent-lane-detail-page.test.ts`
- Modify: `packages/orchestrator/test/handoff-validation.test.ts`
- Modify: `packages/orchestrator/test/self-build-proposal-lifecycle.test.ts`
- Create or modify: `packages/orchestrator/test/lead-governance-flow.test.ts`
  - Targeted regression coverage for role transitions and governance behavior.
- Modify: `package.json`
  - Include any new focused test files in the curated test scripts if needed.

## Chunk 1: Lead-Governed Workflow Responsibilities

### Task 1: Lock the new role/governance behavior in tests first

**Files:**
- Create or modify: `packages/orchestrator/test/lead-governance-flow.test.ts`
- Modify: `packages/orchestrator/test/operator-chat-goal-plan.test.ts`

- [ ] **Step 1: Write a failing test that lead governs internal specialist transitions**

Require a feature-delivery execution to treat `lead` as the internal governor for specialist handoffs rather than exposing those approvals directly to the operator.

- [ ] **Step 2: Write a failing test that builder remains the only write-capable specialist**

Assert the flow still expects implementation evidence from `builder`, not `lead` or `scout`.

- [ ] **Step 3: Write a failing test that invalid specialist handoffs block internal progression and final governance**

Cover the case where a malformed specialist handoff stops the next stage and cannot leak into proposal approval/promotion.

- [ ] **Step 4: Run the focused test file and verify failure**

Run: `node --import=tsx --test packages/orchestrator/test/lead-governance-flow.test.ts`

Expected: FAIL because the current workflow and prompt semantics do not yet enforce the new lead-governed model.

### Task 2: Update workflow/profile/prompt semantics to match the approved role model

**Files:**
- Modify: `config/workflows/feature-delivery.yaml`
- Modify: `config/profiles/lead.yaml`
- Modify: `config/profiles/scout.yaml`
- Modify: `config/profiles/builder.yaml`
- Modify: `config/profiles/tester.yaml`
- Modify: `config/profiles/reviewer.yaml`
- Modify: `.pi/prompts/lead.md`
- Modify: `.pi/prompts/scout.md`
- Modify: `.pi/prompts/builder.md`
- Modify: `.pi/prompts/tester.md`
- Modify: `.pi/prompts/reviewer.md`

- [ ] **Step 1: Make lead’s governance role explicit in config**

Keep lead coordination-only and no-write, but make internal stage approval/rework responsibility explicit in workflow/profile metadata.

- [ ] **Step 2: Make scout planning-only in prompts and handoffs**

Ensure scout outputs discovery, risks, files, and recommendations rather than pseudo-implementation.

- [ ] **Step 3: Make builder implementation-only**

Builder should clearly own changed files and implementation output.

- [ ] **Step 4: Make tester targeted and evidence-driven**

Prompt/config should require targeted tests for touched components/files and browser checks for UI changes when appropriate.

- [ ] **Step 5: Make reviewer a real quality gate**

Prompt/config should require correctness, quality, risk, and test-evidence review, not just a procedural handoff.

- [ ] **Step 6: Run the focused governance test and verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/lead-governance-flow.test.ts`

Expected: PASS.

## Chunk 2: Agent Detail Clarity

### Task 3: Add focused UI regressions for the top-of-detail operator questions

**Files:**
- Modify: `apps/web/test/agent-lane-detail-page.test.ts`

- [ ] **Step 1: Write a failing test that the top of Agent Detail shows input sent to the agent**

Use context/session artifact data and require the page to surface the actual task/request clearly.

- [ ] **Step 2: Write a failing test that the top of Agent Detail shows live output and returned output**

Require transcript preview / latest visible output and returned handoff/output to render before secondary metadata.

- [ ] **Step 3: Write a failing test that artifacts remain secondary**

Assert the page still exposes artifacts, but only after the primary input/output sections.

- [ ] **Step 4: Run the focused lane-detail test and verify failure if needed**

Run: `node --import=tsx --test apps/web/test/agent-lane-detail-page.test.ts`

Expected: either FAIL for the new contract or require updated assertions after code changes.

### Task 4: Simplify Agent Detail around input, live output, and returned output

**Files:**
- Modify: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts`
- Modify: `apps/web/src/components/cockpit/AgentSessionSummary.tsx`
- Modify: `apps/web/src/pages/AgentLaneDetailPage.tsx`

- [ ] **Step 1: Build explicit view-model fields for request prompt and returned output**

Source them from session context and structured handoff artifacts instead of mission-summary guesswork when possible.

- [ ] **Step 2: Keep live transcript/output as the primary middle panel**

Ensure the operator sees the actual live session text before lower-level artifacts.

- [ ] **Step 3: Push artifacts and low-level metadata below the primary operator questions**

Do not remove them, but demote them.

- [ ] **Step 4: Run the lane-detail test and verify it passes**

Run: `node --import=tsx --test apps/web/test/agent-lane-detail-page.test.ts`

Expected: PASS.

## Chunk 3: Cockpit Performance And Current-Family Rendering

### Task 5: Add focused cockpit performance/data-path regressions first

**Files:**
- Modify: `apps/web/test/agent-cockpit-page.test.ts`
- Modify: `apps/web/test/agent-cockpit-cache.test.tsx`
- Modify: `apps/web/test/agent-cockpit-adapter.test.ts`

- [ ] **Step 1: Write a failing test that current-family lanes render without waiting for history**

Require the page to foreground current mission family and hide historical lanes behind the toggle.

- [ ] **Step 2: Write a failing test that heavy promotion/history data are not required for first useful cockpit render**

Use fixtures where history is large or delayed and require the current-family lanes to render first.

- [ ] **Step 3: Write a failing test that history expansion lazily reveals older lanes**

The page should not mix everything by default.

- [ ] **Step 4: Run the focused cockpit page tests and verify the new regression is meaningful**

Run: `node --import=tsx --test apps/web/test/agent-cockpit-page.test.ts apps/web/test/agent-cockpit-cache.test.tsx`

Expected: FAIL or expose the current eager-loading behavior.

### Task 6: Introduce a lighter current-family data path

**Files:**
- Modify: `apps/web/src/features/agent-cockpit/use-agent-cockpit.ts`
- Modify: `apps/web/src/adapters/agent-cockpit.ts`
- Modify: `apps/web/src/pages/AgentCockpitPage.tsx`

- [ ] **Step 1: Split current-family fetch from history hydration**

Current-family lanes should be resolvable before full historical execution/session hydration finishes.

- [ ] **Step 2: Avoid eager giant payload dependence for first render**

Do not make the page wait on heavyweight promotion child execution payloads or all settled session-live reads before showing the current family.

- [ ] **Step 3: Keep history behind explicit reveal**

Default page shows current family; history appears only after operator asks for it.

- [ ] **Step 4: Run focused cockpit tests and verify they pass**

Run:

```bash
node --import=tsx --test apps/web/test/agent-cockpit-adapter.test.ts
node --import=tsx --test apps/web/test/agent-cockpit-page.test.ts
node --import=tsx --test apps/web/test/agent-cockpit-cache.test.tsx
```

Expected: PASS.

## Chunk 4: Verification And Browser Check

### Task 7: Verify the full slice and inspect in browser

**Files:**
- No new files unless verification reveals regressions.

- [ ] **Step 1: Run full web verification**

Run: `npm run test:web`

Expected: PASS.

- [ ] **Step 2: Run focused orchestrator/runtime regression suite**

Run:

```bash
node --import=tsx --test packages/runtime-pi/test/launcher-selection.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts packages/orchestrator/test/operator-chat-goal-plan.test.ts packages/orchestrator/test/handoff-validation.test.ts packages/orchestrator/test/self-build-proposal-lifecycle.test.ts packages/orchestrator/test/lead-governance-flow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run web:build
```

Expected: PASS.

- [ ] **Step 4: Verify with browser automation against a real run**

Use the browser tooling to confirm:

- cockpit shows current family first,
- lane detail shows input / live output / returned output clearly,
- history is collapsed by default,
- the feature flow can reach the final merge-ready state with only the final operator decision visible.
