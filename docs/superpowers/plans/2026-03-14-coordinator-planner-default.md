# Coordinator Planner-First Default Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planner-driven decomposition the default project coordination schema so the coordinator first obtains a durable cross-domain plan, then dispatches domain-scoped tasks to leads in dependency-aware order.

**Architecture:** Add a project-scoped `planner` role and a durable `coordination_plan` handoff consumed by the `coordinator`. The coordinator owns family dispatch state, waves, and replanning while leads receive already-scoped domain tasks instead of the same project-level objective; the `integrator` remains a separate child lane under the coordinator root.

**Tech Stack:** TypeScript, NodeNext ESM, Node `node:test`, orchestrator execution-family state, workflow handoffs, YAML profiles/workflows/projects, orchestrator HTTP/operator surfaces.

---

## File Structure

- `config/profiles/planner.yaml`
  - new project-scoped planner profile
- `.pi/prompts/planner.md`
  - planner system prompt and output contract
- `config/workflows/project-coordination-root.yaml`
  - project coordination root becomes planner-first by default
- `config/projects/spore.yaml`
  - planner profile default and project coordination policy defaults
- `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
  - planner lane planning and planner-first project invocation shape
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
  - planner lane execution, coordinator adoption of `coordination_plan`, dispatch queue, replanning hooks
- `packages/orchestrator/src/execution/coordination-summary.ts`
  - plan-aware family summary and per-task queue projection
- `packages/orchestrator/src/execution/execution-metadata.ts`
  - planner lane metadata, adopted plan metadata, dispatch task metadata
- `packages/orchestrator/src/execution/workflow-handoffs.ts`
  - durable artifact kind support for `coordination_plan` and `lead_progress`
- `packages/orchestrator/src/execution/handoff-validation.ts`
  - validation contracts for planner and lead progress artifacts
- `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - operator-facing planner / dispatch state
- `services/orchestrator/server.ts`
  - read routes or payload expansions for adopted plan / dispatch queue / replan status
- `packages/orchestrator/test/plan-project-coordination.test.ts`
  - planner-first planning tests
- `packages/orchestrator/test/coordination-summary.test.ts`
  - summary tests for adopted plan, queue, waves, and replanning
- `packages/orchestrator/test/execution-metadata.test.ts`
  - planner lane, dispatch task, and replan metadata tests
- `packages/orchestrator/test/workflow-handoffs.test.ts`
  - handoff persistence tests for `coordination_plan` and `lead_progress`
- `packages/orchestrator/test/handoff-validation.test.ts`
  - artifact validation tests for planner and progress payloads
- `services/orchestrator/test/http-project-roles.test.ts`
  - HTTP family/detail tests for planner-first flow
- `services/orchestrator/test/http-self-build.test.ts`
  - operator surfaces for plan + dispatch visibility
- `docs/architecture/role-model.md`
- `docs/architecture/workflow-model.md`
- `docs/decisions/ADR-0006-project-coordinator-role.md`

## Chunk 1: Add Planner Role And Planning Artifact

### Task 1: Add Planner Profile And Prompt Contract

**Files:**
- Create: `config/profiles/planner.yaml`
- Create: `.pi/prompts/planner.md`
- Modify: `config/projects/spore.yaml`
- Test: `packages/orchestrator/test/plan-project-coordination.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting that project coordination config can resolve a `planner` project role profile and that planner lane planning requires a `coordination_plan` output contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts`
Expected: FAIL because planner role/profile resolution does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add:
- `config/profiles/planner.yaml` with project-scoped, read-mostly planner permissions,
- `.pi/prompts/planner.md` requiring a durable `coordination_plan` artifact,
- project config default such as `plannerProfile: planner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/profiles/planner.yaml .pi/prompts/planner.md config/projects/spore.yaml packages/orchestrator/test/plan-project-coordination.test.ts
git commit -m "feat: add planner profile for project coordination"
```

### Task 2: Add `coordination_plan` Durable Artifact Contract

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-handoffs.ts`
- Modify: `packages/orchestrator/src/execution/handoff-validation.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/execution-metadata.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`
- Test: `packages/orchestrator/test/workflow-handoffs.test.ts`
- Test: `packages/orchestrator/test/handoff-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for a new durable handoff kind `coordination_plan` containing:
- affected domains,
- domain tasks,
- waves,
- dependencies,
- shared contracts,
- unresolved questions.

Also add validation tests asserting malformed planner artifacts are rejected or degraded according to policy.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts
node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
```

Expected: FAIL because `coordination_plan` is not recognized, validated, or projected.

- [ ] **Step 3: Write minimal implementation**

Add the durable artifact shape, validation contract, and read helpers so planner output can be stored, validated, and consumed by the coordinator without transcript inference.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts
node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/workflow-handoffs.ts packages/orchestrator/src/execution/handoff-validation.ts packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/execution-metadata.ts packages/orchestrator/test/workflow-handoffs.test.ts packages/orchestrator/test/handoff-validation.test.ts packages/orchestrator/test/coordination-summary.test.ts
git commit -m "feat: add durable coordination plan artifact"
```

## Chunk 2: Planner-First Project Coordination

### Task 3: Make Project Coordination Planner-First By Default

**Files:**
- Modify: `config/workflows/project-coordination-root.yaml`
- Modify: `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
- Test: `packages/orchestrator/test/plan-project-coordination.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting that `project-plan` / `project-invoke` now plan:
- root coordinator execution,
- planner child lane first,
- no lead lanes before an adopted plan exists.

Add explicit mode-shape tests proving the planner contract differs by mode:
- `delivery` produces implementation-oriented work packages and concrete execution waves,
- `project-breakdown` produces decomposition-oriented domain slices and dependency ordering,
- `brownfield-intake` produces shared contracts, unresolved questions, and stronger pre-dispatch discovery output.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts`
Expected: FAIL because lead lanes are still created immediately.

- [ ] **Step 3: Write minimal implementation**

Update planning so project coordination defaults to:
- coordinator root,
- planner lane,
- adopted-plan wait state,
- then later lead-lane dispatch.

Do not remove direct domain workflows; only change the default project-root schema.

At this stage also encode mode-sensitive planner intent so the planner pass is not mode-neutral:
- `delivery`: plan implementation-oriented work packages,
- `project-breakdown`: emphasize decomposition and cross-domain work ordering,
- `brownfield-intake`: emphasize discovery, shared contracts, and unresolved questions before dispatch.

The implementation is incomplete unless those three modes are asserted through dedicated planner tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/workflows/project-coordination-root.yaml packages/orchestrator/src/invocation/plan-workflow-invocation.ts packages/orchestrator/test/plan-project-coordination.test.ts
git commit -m "feat: make project coordination planner-first"
```

### Task 4: Coordinator Adopts Plan And Materializes Dispatch Queue

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/coordination-summary.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting that once a planner publishes `coordination_plan`, coordinator summary shows:
- adopted plan id,
- task queue state,
- waves,
- dependencies,
- dispatch status per task.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts`
Expected: FAIL because coordinator summary does not yet project adopted plans or queue state.

- [ ] **Step 3: Write minimal implementation**

Add coordinator-owned dispatch state with statuses like:
- `pending`
- `dispatched`
- `in_progress`
- `blocked`
- `completed`
- `failed`

This queue remains coordinator-owned. Leads do not auto-claim tasks in this phase.

Also add execution metadata tests for:
- adopted plan id/version,
- current wave id,
- dispatch task metadata,
- queue status projection.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test packages/orchestrator/test/execution-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/coordination-summary.ts packages/orchestrator/src/execution/execution-metadata.ts packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/execution-metadata.test.ts
git commit -m "feat: add coordinator dispatch queue from adopted plans"
```

## Chunk 3: Domain-Scoped Lead Dispatch

### Task 5: Replace Shared Objective Fan-Out With Domain Task Dispatch

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/execution-metadata.ts`
- Modify: `packages/orchestrator/src/execution/workflow-handoffs.ts`
- Modify: `packages/orchestrator/src/execution/handoff-validation.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`
- Test: `packages/orchestrator/test/workflow-handoffs.test.ts`
- Test: `packages/orchestrator/test/handoff-validation.test.ts`
- Test: `services/orchestrator/test/http-project-roles.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting that lead lanes receive:
- domain-scoped task ids,
- task summaries,
- dependencies,
- shared contract refs,
- recommended workflow,

and that the coordinator can persist and validate these dispatch artifacts as durable contract inputs.

and do **not** merely receive the same root objective as all other lanes.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts
node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
```

Expected: FAIL because lead lane metadata/briefs are still too generic.

- [ ] **Step 3: Write minimal implementation**

Teach coordinator dispatch to materialize lead lanes from the adopted plan, giving each lane its own domain task package.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/execution-metadata.ts packages/orchestrator/src/execution/workflow-handoffs.ts packages/orchestrator/src/execution/handoff-validation.ts packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/workflow-handoffs.test.ts packages/orchestrator/test/handoff-validation.test.ts services/orchestrator/test/http-project-roles.test.ts
git commit -m "feat: dispatch domain-scoped lead tasks from coordination plans"
```

### Task 6: Add Upward Lead Progress Reporting

**Files:**
- Modify: `config/profiles/lead.yaml`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/coordination-summary.ts`
- Modify: `packages/orchestrator/src/execution/workflow-handoffs.ts`
- Modify: `packages/orchestrator/src/execution/handoff-validation.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`
- Test: `packages/orchestrator/test/workflow-handoffs.test.ts`
- Test: `packages/orchestrator/test/handoff-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting that coordinator summary receives incremental progress, not just final lead completion. Examples:
- current active task id,
- last progress summary,
- blocked-on dependency state.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts`
Expected: FAIL because lead progress is not yet projected.

- [ ] **Step 3: Write minimal implementation**

Add a durable upward progress handoff or structured progress record so the coordinator sees mid-flight lane status in plan-aware terms.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts
node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/profiles/lead.yaml packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/coordination-summary.ts packages/orchestrator/src/execution/workflow-handoffs.ts packages/orchestrator/src/execution/handoff-validation.ts packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/workflow-handoffs.test.ts packages/orchestrator/test/handoff-validation.test.ts
git commit -m "feat: surface lead progress to coordinator summaries"
```

## Chunk 4: Replanning And Operator Surfaces

### Task 7: Add Coordinator Replanning Hooks

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/coordination-summary.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`
- Test: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for replanning triggers such as:
- hidden dependency discovered,
- wrong domain assignment,
- open cross-domain blocker.

Expected result: coordinator requests a planner rerun and surfaces the replan reason.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: FAIL because replanning state is absent.

- [ ] **Step 3: Write minimal implementation**

Add planner rerun support and track:
- latest adopted plan version,
- last replanning reason,
- full replan history,
- whether operator review is required before adoption.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/coordination-summary.ts packages/orchestrator/test/coordination-summary.test.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: add coordinator replanning support"
```

### Task 8: Expose Planning And Queue State To Operators

**Files:**
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Modify: `services/orchestrator/server.ts`
- Test: `services/orchestrator/test/http-project-roles.test.ts`
- Test: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing test**

Add operator-facing assertions for:
- planner lane state,
- adopted plan summary,
- queued vs active vs blocked tasks,
- current wave,
- replan reason when present.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: FAIL because operator surfaces do not yet expose planning/queue detail.

- [ ] **Step 3: Write minimal implementation**

Expose planner-first coordination state through family summary and operator-thread context without replacing execution-store truth.

Make sure operator surfaces can inspect not only the current plan, but also the replan history and current plan version.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/server.ts services/orchestrator/test/http-project-roles.test.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: expose planner-first coordinator state to operators"
```

## Chunk 5: Docs And Full Verification

### Task 9: Update Architecture And ADR Docs

**Files:**
- Modify: `docs/architecture/role-model.md`
- Modify: `docs/architecture/workflow-model.md`
- Modify: `docs/decisions/ADR-0006-project-coordinator-role.md`

- [ ] **Step 1: Write the failing test**

Create a checklist from the approved design:
- planner is separate from coordinator,
- planner-first is the default project coordination schema,
- leads receive domain-scoped tasks,
- integrator remains under coordinator and outside lead ownership,
- replanning is durable.

- [ ] **Step 2: Run docs verification**

Run: `npm run docs-kb:index`
Expected: PASS, but docs may not yet reflect the new schema.

- [ ] **Step 3: Write minimal implementation**

Update docs so the planner-first coordinator schema is the new documented default project coordination flow.

- [ ] **Step 4: Run verification to confirm docs and config are valid**

Run: `npm run docs-kb:index && npm run config:validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/role-model.md docs/architecture/workflow-model.md docs/decisions/ADR-0006-project-coordinator-role.md
git commit -m "docs: describe planner-first coordinator schema"
```

### Task 10: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test packages/orchestrator/test/execution-metadata.test.ts
node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts
node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader repo verification**

Run:

```bash
npm run test:http
npm run test:policy
npm run typecheck
npm run docs-kb:index
npm run config:validate
```

Expected: PASS.

- [ ] **Step 3: Verify the default schema contract manually**

Check that project coordination now does this by default:
- coordinator root starts,
- planner lane runs first,
- durable `coordination_plan` exists,
- lead lanes receive domain-scoped tasks from the plan,
- coordinator sees in-flight progress,
- replan history is durable and readable,
- integrator remains a separate child lane under coordinator.

- [ ] **Step 4: Commit final fixups if needed**

```bash
git add .
git commit -m "chore: finalize planner-first coordinator verification"
```

- [ ] **Step 5: Prepare branch completion**

Use `superpowers:finishing-a-development-branch` after all verification is green.
