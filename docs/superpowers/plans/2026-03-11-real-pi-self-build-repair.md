# Real PI Self-Build Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Real-PI self-build runs safe and coherent by fixing workspace allocation collisions, enforcing repo isolation, stabilizing proposal/chat state, narrowing validation fan-out, and repairing promotion/observability behavior.

**Architecture:** Fix the system from the bottom up. First enforce workspace/worktree invariants so executions cannot corrupt the main repo or collide in allocation records. Then repair proposal lifecycle and operator-chat state selection so governance surfaces reflect the latest real artifact. Finally narrow validation defaults, fix promotion semantics, and add observability strong enough to diagnose the next Real-PI run without SQLite spelunking.

**Tech Stack:** TypeScript, Node HTTP services, SQLite stores, tmux-backed PI runtime, `node:test`, `tsx`, Biome.

---

## File Map

- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
  - Fix work-item-run workspace allocation, proposal creation semantics, validation orchestration, promotion readiness, and self-build observability.
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - Fix latest-artifact selection, pending-action generation, and recovery-state handling in operator chat.
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
  - Prevent allocation duplication and ensure execution steps consume the correct workspace context.
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
  - Ensure launch context preserves explicit isolated cwd/workspace semantics for Real PI runs.
- Modify: `packages/runtime-pi/src/launchers/tmux-launcher.ts`
  - Keep launch script cwd/workspace propagation explicit for all roles.
- Modify: `.pi/SYSTEM.md`
  - Add repo-safety guidance for roles that must inspect but not mutate.
- Modify: `config/policy-packs/ui-core.yaml`
  - Revisit workspace policy so all roles in self-build Real-PI execution get safe cwd semantics.
- Modify: `config/workflows/frontend-ui-pass.yaml`
  - Keep workflow/runtime expectations aligned with repaired workspace and validation behavior if the validation or role isolation fixes require workflow-level policy changes.
- Modify: `config/work-item-templates/operator-ui-pass.yaml`
  - Narrow default validation bundle expectations for UI work.
- Create/Modify: `config/validation-bundles/frontend-ui-pass.yaml`
  - Define a narrow validation path for UI-focused self-build work.
- Modify: `services/orchestrator/server.ts`
  - Expose any needed async validation / richer observability fields without changing authority boundaries.
- Modify: `docs/runbooks/local-dev.md`
  - Add a reproducible Real-PI self-build trace loop and failure-inspection runbook.

### Tests

- Create: `packages/orchestrator/test/self-build-workspace-allocation.test.ts`
- Create: `packages/orchestrator/test/self-build-proposal-lifecycle.test.ts`
- Create: `services/orchestrator/test/http-self-build-validation.test.ts`
- Modify: `packages/orchestrator/test/builder-tester-workspaces.test.ts`
- Modify: `packages/runtime-pi/test/workspace-launch-context.test.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Modify: `services/orchestrator/test/http-project-roles.test.ts`
  - Only if promotion/source-execution fixes require coverage at the coordinator/integrator HTTP surface.

## Chunk 1: Workspace Identity And Repo Isolation

### Task 1: Reproduce workspace allocation collision with a focused failing test

**Files:**
- Create: `packages/orchestrator/test/self-build-workspace-allocation.test.ts`
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`

- [ ] **Step 1: Write the failing test for duplicate workspace allocation IDs**

Model the failing path from the Real-PI trace: a self-build work-item run provisions a workspace, then workflow execution tries to allocate again.

The test should assert that rerunning or handing the workspace into execution does **not** raise:

```ts
assert.doesNotReject(async () => {
  await runSelfBuildWorkItem(itemId, options, dbPath);
});
```

and should verify one authoritative allocation record exists for the run/workspace pair.

- [ ] **Step 2: Run the test to verify it fails with the current duplicate allocation behavior**

Run: `node --import=tsx --test packages/orchestrator/test/self-build-workspace-allocation.test.ts`

Expected: FAIL with a collision involving `workspace_allocations.id`.

- [ ] **Step 3: Implement the minimal fix to establish a single allocation authority**

Choose one invariant and encode it consistently:

- self-build owns allocation creation for work-item runs,
- workflow execution reuses/link-updates instead of reinserting.

Do **not** leave both code paths able to `INSERT` the same logical allocation.

- [ ] **Step 4: Re-run the focused test and confirm it passes**

Run: `node --import=tsx --test packages/orchestrator/test/self-build-workspace-allocation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the workspace allocation fix**

```bash
git add packages/orchestrator/test/self-build-workspace-allocation.test.ts packages/orchestrator/src/self-build/self-build.impl.ts packages/orchestrator/src/execution/workflow-execution.impl.ts
git commit -m "fix: prevent duplicate self-build workspace allocations"
```

### Task 2: Enforce isolated cwd/workspace semantics for all Real-PI roles

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
- Modify: `packages/runtime-pi/src/launchers/tmux-launcher.ts`
- Modify: `packages/runtime-pi/test/workspace-launch-context.test.ts`
- Modify: `packages/orchestrator/test/builder-tester-workspaces.test.ts`
- Modify: `.pi/SYSTEM.md`
- Modify: `config/policy-packs/ui-core.yaml`
- Modify: `config/workflows/frontend-ui-pass.yaml` (only if role/workspace policy must be made explicit at workflow level)

- [ ] **Step 1: Write the failing launch-context test showing lead/scout receive root repo cwd**

Add assertions that self-build workflow steps for `lead` and `scout` do not point at `PROJECT_ROOT` when a work-item workspace exists.

```ts
assert.notEqual(leadLaunch.cwd, PROJECT_ROOT);
assert.notEqual(scoutLaunch.cwd, PROJECT_ROOT);
```

- [ ] **Step 2: Run the focused runtime tests and confirm failure**

Run:

```bash
node --import=tsx --test packages/runtime-pi/test/workspace-launch-context.test.ts
node --import=tsx --test packages/orchestrator/test/builder-tester-workspaces.test.ts
```

Expected: FAIL because non-builder/tester roles still resolve to the main repo during work-item-driven execution.

- [ ] **Step 3: Thread the authoritative workspace context through execution planning for all roles in work-item-driven runs**

Ensure lead/scout/reviewer get an isolated cwd as well, even if they remain non-authoring roles.

- [ ] **Step 4: Add a runtime-level safety guard for non-authoring roles**

Use launch context and `.pi/SYSTEM.md` to make the policy explicit: non-authoring roles may inspect and propose, but must not mutate outside the allocated workspace.

- [ ] **Step 5: Re-run the focused runtime/orchestrator tests and confirm pass**

Run:

```bash
node --import=tsx --test packages/runtime-pi/test/workspace-launch-context.test.ts
node --import=tsx --test packages/orchestrator/test/builder-tester-workspaces.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the repo-isolation fix**

```bash
git add packages/orchestrator/src/execution/workflow-execution.impl.ts packages/runtime-pi/src/cli/run-session-plan.ts packages/runtime-pi/src/launchers/tmux-launcher.ts packages/runtime-pi/test/workspace-launch-context.test.ts packages/orchestrator/test/builder-tester-workspaces.test.ts .pi/SYSTEM.md config/policy-packs/ui-core.yaml config/workflows/frontend-ui-pass.yaml
git commit -m "fix: isolate real-pi self-build roles from repo root"
```

## Chunk 2: Proposal Lifecycle Integrity

### Task 3: Stop creating reviewable proposals from failed or held runs

**Files:**
- Create: `packages/orchestrator/test/self-build-proposal-lifecycle.test.ts`
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing lifecycle tests**

Cover at least:

- successful run -> reviewable proposal allowed
- failed run -> no `ready_for_review` proposal
- held/blocked execution -> no reviewable proposal with empty diff/patch

- [ ] **Step 2: Run the focused lifecycle test and verify failure**

Run: `node --import=tsx --test packages/orchestrator/test/self-build-proposal-lifecycle.test.ts`

Expected: FAIL because current code still emits `ready_for_review` proposals from failed/held paths.

- [ ] **Step 3: Implement the minimal proposal state fix**

Split success path from failure path:

- success -> proposal artifact for review
- failure/blocked -> diagnostic artifact or recovery signal, but not a reviewable proposal

- [ ] **Step 4: Re-run focused lifecycle and HTTP tests**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/self-build-proposal-lifecycle.test.ts
node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the proposal-lifecycle integrity fix**

```bash
git add packages/orchestrator/test/self-build-proposal-lifecycle.test.ts packages/orchestrator/src/self-build/self-build.impl.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "fix: block reviewable proposals for failed self-build runs"
```

### Task 4: Attach correct source execution semantics for promotion

**Files:**
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `packages/orchestrator/src/self-build/proposal-lifecycle.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Modify: `services/orchestrator/test/http-project-roles.test.ts` (only if promotion/source-execution fixes affect coordinator/integrator HTTP behavior)

- [ ] **Step 1: Add failing tests for promotion source correctness**

Assert that:

- a proposal may only become promotion-ready when it has a durable source execution,
- workspace branch names are not treated as integration branches,
- failed/diagnostic proposals never expose a promotion-ready path.

- [ ] **Step 2: Run the focused HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: FAIL on promotion/source-execution assertions.

- [ ] **Step 3: Implement the minimal source-execution / integration-branch fix**

Keep separate:

- work-item workspace branch
- durable source execution id
- actual integration branch candidate

- [ ] **Step 4: Re-run the focused HTTP test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the promotion-source fix**

```bash
git add packages/orchestrator/src/self-build/self-build.impl.ts packages/orchestrator/src/self-build/proposal-lifecycle.ts services/orchestrator/test/http-self-build.test.ts services/orchestrator/test/http-project-roles.test.ts
git commit -m "fix: align self-build promotion with real source executions"
```

## Chunk 3: Operator Chat Coherence

### Task 5: Always select the latest relevant proposal in operator chat

**Files:**
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing operator-chat regression test**

Model rerun/failure state and assert that thread context plus pending actions point to the latest relevant proposal/run instead of the first matching status.

- [ ] **Step 2: Run the focused HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: FAIL because operator chat currently prefers an older `ready_for_review` proposal.

- [ ] **Step 3: Implement minimal latest-artifact selection logic**

Prefer in order:

- latest linked run,
- latest linked proposal id,
- then status priority only as a fallback.

- [ ] **Step 4: Re-run the focused HTTP test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the operator-chat proposal selection fix**

```bash
git add packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "fix: keep operator chat aligned with latest proposal state"
```

### Task 6: Surface recovery actions instead of stale review gates

**Files:**
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing test for failed-run recovery gating**

Assert that a failed latest run yields `rework`, `rerun`, or `quarantine` guidance instead of surfacing review for stale artifacts.

- [ ] **Step 2: Run the focused HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the minimal recovery pending-action fix**

Keep chat coherent with current run status and current proposal recoverability.

- [ ] **Step 4: Re-run the focused HTTP test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the recovery-gating fix**

```bash
git add packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "fix: surface self-build recovery actions in operator chat"
```

## Chunk 4: Validation Scope And Async Semantics

### Task 7: Narrow default validation for operator UI work

**Files:**
- Modify: `config/work-item-templates/operator-ui-pass.yaml`
- Create/Modify: `config/validation-bundles/frontend-ui-pass.yaml`
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Create: `services/orchestrator/test/http-self-build-validation.test.ts`

- [ ] **Step 1: Write the failing validation-scope test**

Assert that validating an `operator-ui-pass` work item does **not** implicitly fan out into `backend-service-delivery` and `cli-verification-pass` through `local-fast`.

- [ ] **Step 2: Run the focused validation test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build-validation.test.ts`

Expected: FAIL because validation currently falls back to broad regression coverage.

- [ ] **Step 3: Implement the narrow frontend validation bundle**

Use UI-specific scenarios/regressions only for the default operator UI path.

- [ ] **Step 4: Re-run the focused validation test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the validation-scope fix**

```bash
git add config/work-item-templates/operator-ui-pass.yaml config/validation-bundles/frontend-ui-pass.yaml packages/orchestrator/src/self-build/self-build.impl.ts services/orchestrator/test/http-self-build-validation.test.ts
git commit -m "fix: narrow default validation for operator ui work"
```

### Task 8: Make validation orchestration non-blocking and observable

**Files:**
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `services/orchestrator/server.ts`
- Modify: `services/orchestrator/test/http-self-build-validation.test.ts`

- [ ] **Step 1: Write the failing async validation test**

Assert that the validation endpoint returns quickly with queued/running state instead of holding the request for the entire scenario/regression lifecycle.

- [ ] **Step 2: Run the focused validation HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build-validation.test.ts`

Expected: FAIL because current behavior blocks synchronously.

- [ ] **Step 3: Implement minimal async validation orchestration**

Return quickly, persist validation-in-progress state, and let chat/UI poll or stream status.

- [ ] **Step 4: Pin down the persisted validation contract explicitly**

Use one authoritative persisted record shape before touching broader APIs. At minimum, the implementation should expose:

```ts
{
  id: string,
  targetType: "work-item-run" | "proposal",
  targetId: string,
  bundleId: string,
  status: "queued" | "running" | "completed" | "failed",
  scenarioRunIds: string[],
  regressionRunIds: string[],
  startedAt: string | null,
  endedAt: string | null,
  error: string | null,
}
```

and the HTTP/detail surfaces should read from that persisted state instead of inferring status ad hoc.

- [ ] **Step 5: Re-run the focused validation HTTP test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build-validation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the async validation fix**

```bash
git add packages/orchestrator/src/self-build/self-build.impl.ts packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/server.ts services/orchestrator/test/http-self-build-validation.test.ts
git commit -m "fix: make self-build validation async and observable"
```

## Chunk 5: Observability And Repro Support

### Task 9: Add first-class trace surfaces for Real-PI self-build debugging

**Files:**
- Modify: `packages/orchestrator/src/self-build/self-build.impl.ts`
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `services/orchestrator/server.ts`
- Modify: `docs/runbooks/local-dev.md`
- Modify: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing HTTP test for richer self-build trace fields**

Require enough structured detail to explain:

- why a proposal was selected,
- why a pending action was chosen,
- which validation bundle was selected,
- why a workspace allocation failed/reused,
- why promotion is blocked.

- [ ] **Step 2: Run the focused HTTP test and verify failure**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: FAIL because trace fields are insufficient.

- [ ] **Step 3: Implement minimal structured trace summaries**

Keep them human-readable and API-safe; do not dump raw internals when a concise trace object will do.

- [ ] **Step 4: Update the local-dev runbook with a Real-PI repro trace loop**

Document how to:

- launch isolated services,
- submit a real operator-chat mission,
- inspect thread/dashboard/session state,
- identify workspace/proposal/validation/promotion failure points.

- [ ] **Step 5: Re-run the focused HTTP test and confirm pass**

Run: `node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the observability/runbook improvements**

```bash
git add packages/orchestrator/src/self-build/self-build.impl.ts packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/server.ts docs/runbooks/local-dev.md services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: improve self-build runtime observability"
```

## Chunk 6: Final Verification And Real-PI Repro

### Task 10: Run the full verification suite

**Files:**
- Test only

- [ ] **Step 1: Run formatting check**

Run: `npm run format:check`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run web build**

Run: `npm run web:build`

Expected: PASS.

- [ ] **Step 5: Run focused package/service tests**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/self-build-workspace-allocation.test.ts
node --import=tsx --test packages/orchestrator/test/self-build-proposal-lifecycle.test.ts
node --import=tsx --test packages/orchestrator/test/builder-tester-workspaces.test.ts
node --import=tsx --test packages/runtime-pi/test/workspace-launch-context.test.ts
node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build-validation.test.ts
node --import=tsx --test --test-concurrency=1 services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run curated repo suites**

Run:

```bash
npm run test:web
npm run test:http
npm run config:validate
npm run docs-kb:index
```

Expected: PASS.

### Task 11: Run one fresh Real-PI smoke trace

**Files:**
- Runtime state only by default
- Conditionally modify: `docs/runbooks/local-dev.md`
- Conditionally modify: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Start isolated gateway/orchestrator/web with fresh DB/log paths**

- [ ] **Step 2: Submit one real operator-chat mission**

Mission:

```text
Add day/night mode switch to the WebUI.
```

- [ ] **Step 3: Approve the full happy-path gate sequence**

Trace and record:

- thread state
- pending actions
- session launches
- workspace allocations
- proposal status
- validation status
- promotion readiness

- [ ] **Step 4: Verify success conditions**

Success means:

- no mutation in the main repo working tree,
- no duplicate workspace allocation errors,
- operator chat follows the latest artifact,
- validation stays narrow and bounded,
- no unexpected backend/cli fan-out,
- promotion either becomes validly ready or stops with a clear, correct blocker.

- [ ] **Step 5: If the smoke trace reveals a new bug, stop and create a failing automated test before making any further production change**

Do **not** patch code directly off the smoke trace. Convert the finding into the smallest reproducible failing automated test first.

- [ ] **Step 6: Run config/docs verification for any changed config or runbook files**

Run:

```bash
npm run config:validate
npm run docs-kb:index
```

Expected: PASS.

- [ ] **Step 7: Commit any final repro/runbook adjustment only if it was driven by a failing test or explicit docs/config change**

```bash
git add docs/runbooks/local-dev.md services/orchestrator/test/http-self-build.test.ts
git commit -m "test: document stable real-pi self-build trace"
```
