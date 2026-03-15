# Workflow Handoffs Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce structured workflow handoff quality, add correct fan-out consumption tracking, extend the handoff contract to coordinator and integrator, and deepen operator inspection surfaces.

**Architecture:** Extend the existing `workflow_handoffs` publication path with validation metadata and per-target consumer tracking, then thread that richer state through execution reads, runtime contracts, role profiles, and operator clients. Preserve the current Phase 1 artifact path and store boundary while making invalid handoffs governance-visible instead of silently tolerated.

**Tech Stack:** TypeScript, Node.js, SQLite, `node:test`, `tsx`, orchestrator/runtime-pi/session-gateway/web/TUI packages.

---

## File Structure

### New Files

- `packages/orchestrator/src/execution/handoff-validation.ts`
- `packages/orchestrator/test/handoff-validation.test.ts`
- `packages/orchestrator/test/handoff-fanout.test.ts`
- `apps/web/test/execution-handoffs-panel.test.ts`

### Existing Files To Modify

- `config/profiles/coordinator.yaml`
- `config/profiles/integrator.yaml`
- `config/profiles/lead.yaml`
- `config/profiles/scout.yaml`
- `config/profiles/builder.yaml`
- `config/profiles/tester.yaml`
- `config/profiles/reviewer.yaml`
- `.pi/prompts/README.md`
- `.pi/prompts/coordinator.md`
- `.pi/prompts/integrator.md`
- `packages/orchestrator/src/store/execution-store.impl.ts`
- `packages/orchestrator/src/store/entity-mappers.ts`
- `packages/orchestrator/src/store/execution-store.ts`
- `packages/orchestrator/src/types/contracts.ts`
- `packages/orchestrator/src/execution/handoff-context.ts`
- `packages/orchestrator/src/execution/handoff-extraction.ts`
- `packages/orchestrator/src/execution/workflow-handoffs.ts`
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- `packages/orchestrator/src/execution/history.ts`
- `packages/orchestrator/src/execution/brief.ts`
- `packages/orchestrator/src/self-build/self-build.impl.ts`
- `packages/runtime-pi/src/types.ts`
- `packages/runtime-pi/src/planner/build-session-plan.ts`
- `packages/runtime-pi/src/context/build-startup-context.ts`
- `packages/runtime-pi/src/launchers/tmux-launcher.ts`
- `services/orchestrator/server.ts`
- `services/session-gateway/server.ts`
- `packages/tui/src/cli/spore-ops.ts`
- `apps/web/src/main.ts`
- `docs/architecture/workflow-model.md`
- `docs/architecture/role-model.md`
- `docs/runbooks/local-dev.md`

## Chunk 1: Validation And Governance Enforcement

### Task 1: Add handoff validation primitives

**Files:**
- Create: `packages/orchestrator/src/execution/handoff-validation.ts`
- Create: `packages/orchestrator/test/handoff-validation.test.ts`
- Modify: `packages/orchestrator/src/types/contracts.ts`

- [ ] **Step 1: Write the failing validation tests**

Cover:

```ts
test("missing required sections yields invalid handoff result", ...)
test("missing marker yields degraded invalid result", ...)
test("valid payload satisfies required sections", ...)
```

- [ ] **Step 2: Run the new validation test file**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts`
Expected: FAIL because validation helpers do not exist yet

- [ ] **Step 3: Implement validation helpers**

Add types/helpers for:

```ts
type HandoffValidationMode = "accept" | "review_pending" | "blocked";
type HandoffValidationIssueCode =
  | "missing_marker"
  | "invalid_json"
  | "missing_required_section";

validateStructuredHandoff(...)
deriveHandoffEnforcementMode(...)
```

- [ ] **Step 4: Re-run the validation tests**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts`
Expected: PASS

### Task 2: Persist validation state on workflow handoff publications

**Files:**
- Modify: `packages/orchestrator/src/store/execution-store.impl.ts`
- Modify: `packages/orchestrator/src/store/entity-mappers.ts`
- Modify: `packages/orchestrator/src/store/execution-store.ts`
- Modify: `packages/orchestrator/src/execution/workflow-handoffs.ts`
- Modify: `packages/orchestrator/test/workflow-handoffs.test.ts`

- [ ] **Step 1: Extend the existing failing publication tests with validation assertions**

Assert that published handoffs carry:

```ts
validation: {
  valid: boolean;
  degraded: boolean;
  mode: string;
  issues: [];
}
```

- [ ] **Step 2: Run the targeted publication tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "publish normalized|persist validation"`
Expected: FAIL because validation metadata is not stored yet

- [ ] **Step 3: Add validation columns/json to the handoff store**

Persist `validation_json` on `workflow_handoffs` and map it back into the entity.

- [ ] **Step 4: Thread validation into publication**

`publishWorkflowStepHandoffs(...)` should:

- validate structured payloads,
- preserve degraded fallback summaries,
- attach validation metadata to primary and auxiliary handoffs.

- [ ] **Step 5: Re-run the targeted handoff publication tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "publish normalized|persist validation"`
Expected: PASS

### Task 3: Enforce invalid handoff outcomes at step settle time

**Files:**
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/execution/handoff-context.ts`
- Modify: `packages/orchestrator/test/workflow-handoffs.test.ts`

- [ ] **Step 1: Add failing tests for enforcement modes**

Cover:

- invalid handoff with `accept` still completes,
- invalid handoff with `review_pending` holds the step for review,
- invalid handoff with `blocked` prevents downstream progression.

- [ ] **Step 2: Run the enforcement tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "invalid handoff"`
Expected: FAIL because invalid handoffs do not affect step state yet

- [ ] **Step 3: Implement settle-time enforcement**

Map validation outcomes into step/execution transitions without breaking idempotent reconcile.

- [ ] **Step 4: Re-run the enforcement tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "invalid handoff"`
Expected: PASS

## Chunk 2: Fan-Out And Consumption Tracking

### Task 4: Add per-target handoff consumer tracking

**Files:**
- Modify: `packages/orchestrator/src/store/execution-store.impl.ts`
- Modify: `packages/orchestrator/src/store/entity-mappers.ts`
- Modify: `packages/orchestrator/src/store/execution-store.ts`
- Create: `packages/orchestrator/test/handoff-fanout.test.ts`

- [ ] **Step 1: Write the failing fan-out store test**

Cover one handoff consumed by two different downstream steps and enforce uniqueness on `(handoff_id, consumer_step_id)`.

- [ ] **Step 2: Run the fan-out store test**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-fanout.test.ts`
Expected: FAIL because consumer tracking does not exist yet

- [ ] **Step 3: Add `workflow_handoff_consumers` table and DAO helpers**

Helpers should include:

```ts
recordWorkflowHandoffConsumption(...)
listWorkflowHandoffConsumers(...)
```

- [ ] **Step 4: Re-run the fan-out store test**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-fanout.test.ts`
Expected: PASS

### Task 5: Fix selection and consumption semantics for broadcast handoffs

**Files:**
- Modify: `packages/orchestrator/src/execution/handoff-context.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/test/workflow-handoffs.test.ts`
- Modify: `packages/orchestrator/test/handoff-fanout.test.ts`

- [ ] **Step 1: Add failing execution tests for multi-target fan-out**

Assert:

- one broadcast handoff can feed multiple next-wave roles,
- each consumer gets recorded independently,
- repeated reconcile does not duplicate consumer rows.

- [ ] **Step 2: Run the targeted fan-out execution tests**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-fanout.test.ts packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "fan-out|broadcast|consumer"`
Expected: FAIL because consumption bookkeeping is still publication-row based

- [ ] **Step 3: Implement broadcast-safe selection and recording**

`handoffsConsumedByStep(...)` should stop assuming `targetRole === step.role` is the only valid consumer path.

- [ ] **Step 4: Re-run the fan-out execution tests**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-fanout.test.ts packages/orchestrator/test/workflow-handoffs.test.ts --test-name-pattern "fan-out|broadcast|consumer"`
Expected: PASS

## Chunk 3: Extend The Contract To Coordinator And Integrator

### Task 6: Add structured handoff contracts for coordinator and integrator

**Files:**
- Modify: `config/profiles/coordinator.yaml`
- Modify: `config/profiles/integrator.yaml`
- Modify: `.pi/prompts/coordinator.md`
- Modify: `.pi/prompts/integrator.md`
- Modify: `.pi/prompts/README.md`

- [ ] **Step 1: Add failing config/runtime expectations in targeted tests**

Extend runtime handoff tests to assert these profiles now expose `outputKind`, `marker`, and `requiredSections`.

- [ ] **Step 2: Run the targeted runtime handoff tests**

Run: `node --import=tsx --test packages/runtime-pi/test/handoff-context.test.ts --test-name-pattern "coordinator|integrator|handoff"`
Expected: FAIL because those roles do not have structured policies yet

- [ ] **Step 3: Add profile and prompt overlays**

Recommended kinds:

- `coordinator -> routing_summary`
- `integrator -> integration_summary`

- [ ] **Step 4: Re-run the targeted runtime handoff tests**

Run: `node --import=tsx --test packages/runtime-pi/test/handoff-context.test.ts --test-name-pattern "coordinator|integrator|handoff"`
Expected: PASS

### Task 7: Cover coordinator and integrator publication/consumption in execution tests

**Files:**
- Modify: `packages/orchestrator/test/workflow-handoffs.test.ts`
- Modify: `services/orchestrator/test/http-workflow-handoffs.test.ts`

- [ ] **Step 1: Add failing execution tests for coordinator/integrator handoffs**

Assert the roles publish their expected kinds and those handoffs appear in execution reads.

- [ ] **Step 2: Run the targeted role-chain tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts services/orchestrator/test/http-workflow-handoffs.test.ts --test-name-pattern "coordinator|integrator"`
Expected: FAIL because role-chain coverage is incomplete

- [ ] **Step 3: Update role mapping and read-model expectations**

Ensure `workflow-handoffs.ts` and read routes recognize the new kinds cleanly.

- [ ] **Step 4: Re-run the targeted role-chain tests**

Run: `node --import=tsx --test packages/orchestrator/test/workflow-handoffs.test.ts services/orchestrator/test/http-workflow-handoffs.test.ts --test-name-pattern "coordinator|integrator"`
Expected: PASS

## Chunk 4: Operator Surfaces And Read Models

### Task 8: Enrich handoff read models for operator surfaces

**Files:**
- Modify: `packages/orchestrator/src/execution/history.ts`
- Modify: `services/orchestrator/server.ts`
- Modify: `services/session-gateway/server.ts`
- Modify: `packages/runtime-pi/src/types.ts`

- [ ] **Step 1: Add failing HTTP assertions for validation and consumer counts**

Routes should expose:

- validation metadata,
- degraded flag,
- consumer count / expected count,
- linked artifacts.

- [ ] **Step 2: Run the targeted HTTP tests**

Run: `node --import=tsx --test services/orchestrator/test/http-workflow-handoffs.test.ts services/session-gateway/test/live-route.test.ts`
Expected: FAIL because read models are summary-only

- [ ] **Step 3: Update read surfaces**

Return richer detail payloads while keeping backward-compatible top-level fields where possible.

- [ ] **Step 4: Re-run the targeted HTTP tests**

Run: `node --import=tsx --test services/orchestrator/test/http-workflow-handoffs.test.ts services/session-gateway/test/live-route.test.ts`
Expected: PASS

### Task 9: Add richer web and TUI handoff inspection views

**Files:**
- Modify: `apps/web/src/main.ts`
- Create: `apps/web/test/execution-handoffs-panel.test.ts`
- Modify: `packages/tui/src/cli/spore-ops.ts`
- Modify: `packages/tui/test/tui-parity.test.ts`

- [ ] **Step 1: Write failing web and TUI tests**

Cover:

- handoff detail drilldown in web execution view,
- TUI command output for validation and consumer coverage.

- [ ] **Step 2: Run the targeted UI tests**

Run: `npm run test:web && node --import=tsx --test packages/tui/test/tui-parity.test.ts --test-name-pattern "handoff"`
Expected: FAIL on the new handoff expectations

- [ ] **Step 3: Implement operator-facing drilldown**

Web should render summary + validation + linked evidence. TUI should render concise structured text or stable JSON with the richer read model.

- [ ] **Step 4: Re-run the targeted UI tests and web build**

Run: `npm run web:build && npm run test:web && node --import=tsx --test packages/tui/test/tui-parity.test.ts --test-name-pattern "handoff"`
Expected: PASS

## Chunk 5: Final Docs And Verification

### Task 10: Update docs and run final verification

**Files:**
- Modify: `docs/architecture/workflow-model.md`
- Modify: `docs/architecture/role-model.md`
- Modify: `docs/runbooks/local-dev.md`

- [ ] **Step 1: Update architecture and operator docs for Phase 2 semantics**

Document:

- enforcement modes,
- fan-out consumer tracking,
- coordinator/integrator kinds,
- richer inspection surfaces.

- [ ] **Step 2: Run focused verification first**

Run: `node --import=tsx --test packages/orchestrator/test/handoff-validation.test.ts packages/orchestrator/test/handoff-fanout.test.ts packages/orchestrator/test/workflow-handoffs.test.ts packages/runtime-pi/test/handoff-context.test.ts services/orchestrator/test/http-workflow-handoffs.test.ts services/session-gateway/test/live-route.test.ts`
Expected: PASS

- [ ] **Step 3: Run final broad verification**

Run: `npm run typecheck && npm run web:build && npm run test:web && npm run test:http && npm run test:tui && npm run docs-kb:index && npm run config:validate`
Expected: PASS; if an unrelated failure appears, isolate and report it clearly before proceeding

- [ ] **Step 4: Manual smoke checklist**

Confirm manually:

1. invalid handoff appears with validation issues,
2. strict enforcement can block or hold a step,
3. broadcast handoff records multiple consumers,
4. coordinator/integrator publish structured handoffs,
5. operator surfaces show validation state and linked evidence.
