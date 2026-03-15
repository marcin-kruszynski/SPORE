# Coordinator Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SPORE coordinator a first-class, operator-visible project execution owner with stable readiness/blocker semantics, while preserving the existing integrator promotion boundary.

**Architecture:** Add a reusable `CoordinatorSummary` read model derived from project-root execution families, lead child lanes, family-level blockers, and durable handoffs. Expose the summary through orchestrator HTTP routes and operator-thread context, then add lightweight `coordinationMode` metadata so coordinator-root workflows can intentionally represent delivery, project breakdown, or brownfield intake without introducing a new prompt platform.

**Tech Stack:** TypeScript, NodeNext ESM, Node `node:test`, orchestrator HTTP routes, execution-family metadata, Operator Chat read models, YAML workflow/project config.

---

## File Structure

- `packages/orchestrator/src/execution/coordination-summary.ts`
  - new read-model builder for project-root coordinator families
- `packages/orchestrator/src/execution/execution-metadata.ts`
  - stable metadata helpers for coordinator-root family identity and modes
- `packages/orchestrator/src/index.ts`
  - export coordinator-family read helpers to HTTP surfaces
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
  - family-level blocker/readiness aggregation and coordinator links
- `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
  - add `coordinationMode` to project-root planning metadata
- `packages/orchestrator/test/plan-project-coordination.test.ts`
  - planner-level tests for explicit `coordinationMode` values
- `packages/orchestrator/src/self-build/operator-chat.impl.ts`
  - enrich thread context with coordinator-family summaries/links
- `packages/orchestrator/test/coordination-summary.test.ts`
  - read-model coverage for coordinator identity, integrator lane, blockers, readiness, and pending decisions
- `packages/orchestrator/test/execution-metadata.test.ts`
  - canonical `rootExecutionId` vs `familyKey` metadata tests
- `services/orchestrator/server.ts`
  - dedicated coordinator-family read routes
- `services/orchestrator/test/http-project-roles.test.ts`
  - role-lane and family-summary assertions
- `services/orchestrator/test/http-self-build.test.ts`
  - operator-thread assertions for coordination visibility
- `config/projects/spore.yaml`
  - coordinator mode defaults / allowed modes if needed
- `config/workflows/project-coordination-root.yaml`
  - explicit coordinator-root semantics and default mode metadata
- `docs/architecture/role-model.md`
  - clarify coordinator/operator surfaces and mode semantics
- `docs/architecture/workflow-model.md`
  - document coordinator-family summary and readiness flow
- `docs/decisions/ADR-0006-project-coordinator-role.md`
  - capture the stronger operator-visible coordinator contract

## Chunk 1: Coordinator Family Read Model

### Task 1: Add Coordinator Summary Builder

**Files:**
- Create: `packages/orchestrator/src/execution/coordination-summary.ts`
- Modify: `packages/orchestrator/src/execution/execution-metadata.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/test/coordination-summary.test.ts` with coverage for:
- a project-root execution with `projectRole=coordinator`
- multiple lead child executions with mixed states
- family-level blockers and readiness summary
- latest routing summary handoff exposure

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts`
Expected: FAIL because the builder does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add `packages/orchestrator/src/execution/coordination-summary.ts` with a focused builder, e.g.:

```ts
export interface CoordinatorSummary { /* ... */ }

export function buildCoordinatorSummary(detail: ExecutionFamilyDetail): CoordinatorSummary {
  // derive root identity, familyKey, lead lanes, integrator lane,
  // blockers, readiness, pending decisions, latest routing summary,
  // and coordinationMode projection
}
```

Keep this file read-side only; do not mutate execution state here.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/coordination-summary.ts packages/orchestrator/src/execution/execution-metadata.ts packages/orchestrator/test/coordination-summary.test.ts
git commit -m "feat: add coordinator family summary read model"
```

### Task 1B: Add Execution Metadata Tests For Family Identity

**Files:**
- Modify: `packages/orchestrator/src/execution/execution-metadata.ts`
- Test: `packages/orchestrator/test/execution-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests asserting:
- `rootExecutionId` is the canonical family identifier for coordinator-root families
- `familyKey` is optional and maps to grouping metadata like `coordinationGroupId`
- `coordinationMode` is surfaced through metadata helpers

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/execution-metadata.test.ts`
Expected: FAIL because the metadata contract is incomplete.

- [ ] **Step 3: Write minimal implementation**

Add the metadata helpers needed by the coordinator summary and route surfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/execution-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/execution-metadata.ts packages/orchestrator/test/execution-metadata.test.ts
git commit -m "test: lock coordinator family metadata contract"
```

### Task 2: Harden Coordinator Readiness And Blocker Semantics

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/coordination-summary.ts`
- Test: `packages/orchestrator/test/domain-policy.test.ts`
- Test: `packages/orchestrator/test/coordination-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests covering:
- family readiness when lead lanes are still active
- readiness when review/approval is pending
- blocker aggregation for open escalations and promotion blockers

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/domain-policy.test.ts`
Expected: FAIL on new readiness/blocker expectations.

- [ ] **Step 3: Write minimal implementation**

Use a single aggregation path inside orchestrator execution reads so readiness and blockers are computed consistently for:
- family detail reads
- execution detail `coordination` sections or links
- project-role detail payloads
- operator-thread context

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/domain-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/execution/workflow-execution.impl.ts packages/orchestrator/src/execution/coordination-summary.ts packages/orchestrator/test/coordination-summary.test.ts packages/orchestrator/test/domain-policy.test.ts
git commit -m "feat: harden coordinator family readiness semantics"
```

## Chunk 2: HTTP And Operator Surfaces

### Task 3: Add Coordinator Family HTTP Routes

**Files:**
- Modify: `services/orchestrator/server.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Test: `services/orchestrator/test/http-project-roles.test.ts`

- [ ] **Step 1: Write the failing test**

Add HTTP tests for:
- `GET /coordination-families/:rootExecutionId`
- `GET /coordination-families/:rootExecutionId/lanes`
- `GET /coordination-families/:rootExecutionId/readiness`

Assert that `rootExecutionId` is the canonical route key and any `coordinationGroupId`-like family key is exposed only as metadata.
Also assert that execution detail payloads expose a `coordination` section or links back to the family summary.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts`
Expected: FAIL with missing route/status assertions.

- [ ] **Step 3: Write minimal implementation**

Expose the coordinator summary builder through orchestrator package reads and add the three HTTP routes in `services/orchestrator/server.ts`.
Also enrich existing execution detail responses with a `coordination` section or links so older surfaces can discover the family summary without a separate lookup.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/orchestrator/server.ts packages/orchestrator/src/index.ts services/orchestrator/test/http-project-roles.test.ts
git commit -m "feat: add coordinator family read routes"
```

### Task 4: Surface Coordinator Context In Operator Chat

**Files:**
- Modify: `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- Test: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing test**

Extend operator-thread tests to assert that thread detail includes:
- coordinator family identity or link
- lead lane summaries
- integrator lane summary when present
- blockers/readiness snippet when applicable
- pending decision summaries sourced from the coordinator family

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test services/orchestrator/test/http-self-build.test.ts`
Expected: FAIL because thread payload does not yet include the new coordination section.

- [ ] **Step 3: Write minimal implementation**

Enrich thread context and pending-decision summaries from the shared coordinator summary builder instead of reconstructing project coordination from proposals/runs alone.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=tsx --test services/orchestrator/test/http-self-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/self-build/operator-chat.impl.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: expose coordinator family context in operator threads"
```

## Chunk 3: Lightweight Coordinator Modes

### Task 5: Add Coordination Mode To Planner And Config

**Files:**
- Modify: `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
- Modify: `config/projects/spore.yaml`
- Modify: `config/workflows/project-coordination-root.yaml`
- Test: `packages/orchestrator/test/plan-project-coordination.test.ts`
- Test: `services/orchestrator/test/http-project-roles.test.ts`
- Test: `services/orchestrator/test/http-self-build.test.ts`

- [ ] **Step 1: Write the failing test**

Add planner tests expecting coordinator-root planning metadata to carry explicit `coordinationMode` values, defaulting to `delivery` and allowing configured overrides only from the supported mode set.

Also add operator-surface assertions that the selected mode is visible in the thread-level `coordination` payload.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: FAIL because `coordinationMode` is absent, unconstrained, or not exposed to operator surfaces.

- [ ] **Step 3: Write minimal implementation**

Add explicit `coordinationMode` support to project coordination planning/config. Seed modes:
- `delivery`
- `project-breakdown`
- `brownfield-intake`

Make sure the chosen mode is also exposed through `CoordinatorSummary` and any operator-facing coordination section. Do not add a large prompt framework in this task.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts
node --import=tsx --test services/orchestrator/test/http-project-roles.test.ts
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/invocation/plan-workflow-invocation.ts config/projects/spore.yaml config/workflows/project-coordination-root.yaml packages/orchestrator/test/plan-project-coordination.test.ts services/orchestrator/test/http-project-roles.test.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "feat: add coordinator workflow mode metadata"
```

## Chunk 4: Docs And Final Verification

### Task 6: Document Stronger Coordinator Contract

**Files:**
- Modify: `docs/architecture/role-model.md`
- Modify: `docs/architecture/workflow-model.md`
- Modify: `docs/decisions/ADR-0006-project-coordinator-role.md`

- [ ] **Step 1: Write the failing test**

No code test. Instead create a checklist from the approved design:
- coordinator is family owner
- integrator remains promotion owner
- coordinator summary is operator-visible
- coordination modes are explicit metadata

- [ ] **Step 2: Run docs verification**

Run: `npm run docs-kb:index`
Expected: PASS, but docs may not yet mention the new contract.

- [ ] **Step 3: Write minimal implementation**

Update docs to reflect the final coordinator contract, coordinator summary read model, and coordination modes.

- [ ] **Step 4: Run verification to confirm docs are indexed**

Run: `npm run docs-kb:index && npm run config:validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/role-model.md docs/architecture/workflow-model.md docs/decisions/ADR-0006-project-coordinator-role.md
git commit -m "docs: clarify coordinator family contract"
```

### Task 7: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted orchestrator tests**

Run:

```bash
node --import=tsx --test packages/orchestrator/test/coordination-summary.test.ts
node --import=tsx --test packages/orchestrator/test/execution-metadata.test.ts
node --import=tsx --test packages/orchestrator/test/plan-project-coordination.test.ts
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
```

Expected: PASS.

- [ ] **Step 3: Verify requirements against the approved design**

Check:
- coordinator summary exists and is reusable,
- coordinator read routes exist,
- operator threads expose coordinator-family state,
- `coordinationMode` is explicit,
- integrator boundary remains unchanged.

- [ ] **Step 4: Commit any final fixups if needed**

```bash
git add .
git commit -m "chore: finalize coordinator hardening verification"
```

- [ ] **Step 5: Prepare branch completion**

Use `superpowers:finishing-a-development-branch` after all verification is green.
