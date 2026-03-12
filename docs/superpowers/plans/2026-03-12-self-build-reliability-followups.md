# Self-Build Reliability Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize runtime session reconciliation, expose stronger terminal signals and observability, and add durable dashboard/webui smoke coverage so self-build runs finish cleanly without recovery gates.

**Architecture:** Move artifact-based session terminalization into `packages/session-manager` so the session boundary stays the source of truth. Extend runtime artifacts to expose reusable terminal signals, surface artifact-recovery telemetry through session and orchestrator events, and add repeatable real-PI smoke tests that exercise operator-thread to promotion-candidate flows on dashboard/webui prompts.

**Tech Stack:** TypeScript, NodeNext ESM, SQLite, `node:test`, tmux-backed PI runtime, HTTP self-build tests.

---

### Task 1: Plan And Shared Session Reconcile Boundary

**Files:**
- Create: `docs/superpowers/plans/2026-03-12-self-build-reliability-followups.md`
- Modify: `packages/session-manager/src/cli/session-manager.ts`
- Modify: `packages/session-manager/src/index.ts`
- Create: `packages/session-manager/src/reconcile/session-reconcile.ts`
- Test: `packages/orchestrator/test/domain-policy.test.ts`

- [ ] Write a failing test showing an `active` session with final runtime artifacts must reconcile to a terminal state before the orchestrator settles the wave.
- [ ] Run the targeted test and confirm it fails for the expected reason.
- [ ] Extract shared terminal-signal detection and artifact-based reconciliation into `packages/session-manager/src/reconcile/session-reconcile.ts`.
- [ ] Rewire `session-manager reconcile` and orchestrator session reads to use the shared helper.
- [ ] Re-run the targeted test until it passes.

### Task 2: Richer Runtime Terminal Signals

**Files:**
- Modify: `packages/runtime-pi/src/launchers/pi-rpc-runner.ts`
- Modify: `packages/runtime-pi/src/launchers/tmux-launcher.ts`
- Modify: `packages/session-manager/src/reconcile/session-reconcile.ts`
- Test: `packages/runtime-pi/test/pi-rpc-smoke.test.ts`
- Test: `packages/session-manager/test/session-reconcile.test.ts`

- [ ] Write failing tests for `rpc-status.json` terminal fallback and for ignoring non-terminal status snapshots.
- [ ] Run only those tests and confirm they fail correctly.
- [ ] Extend runtime status artifacts with stable terminal fields that session-manager can read without parsing runner internals ad hoc.
- [ ] Teach session reconcile to prefer `.exit.json`, then use final `rpc-status.json` when the exit file is missing.
- [ ] Re-run the targeted tests until they pass.

### Task 3: Observability For Artifact-Based Auto-Heal

**Files:**
- Modify: `packages/session-manager/src/reconcile/session-reconcile.ts`
- Modify: `packages/session-manager/src/types.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/orchestrator/src/types/contracts.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Modify: `docs/architecture/observability-model.md`
- Modify: `docs/architecture/runtime-model.md`

- [ ] Write failing tests proving artifact-based terminalization emits explicit signal-source metadata and that self-build HTTP surfaces preserve those clues.
- [ ] Run the focused tests and confirm they fail for the missing observability fields.
- [ ] Add artifact-recovery telemetry (`signalSource`, fallback reason, recovery counts/events) to session and orchestrator event/history payloads.
- [ ] Update architecture docs to describe the new signal flow and auto-heal visibility.
- [ ] Re-run the targeted tests until they pass.

### Task 4: Durable Dashboard/WebUI Real-PI Smoke Coverage

**Files:**
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Create: `services/orchestrator/test/http-self-build-smoke.test.ts`
- Modify: `package.json`
- Modify: `docs/runbooks/local-dev.md`

- [ ] Write a failing opt-in real-PI smoke test that runs a dashboard/webui prompt from operator thread creation through promotion candidate and fails if `managed-run-recovery` appears.
- [ ] Run the smoke test in its current failing state and confirm the harness shape is correct.
- [ ] Extract reusable helper code for alternate-port smoke stacks, polling, review/approval/validation/promotion, and final assertions.
- [ ] Add at least two dashboard/webui prompts to the smoke coverage matrix.
- [ ] Re-run the smoke test(s) until they pass cleanly.

### Task 5: Full Verification And Final Evidence

**Files:**
- Verify only

- [ ] Run `npm run test:policy`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:http` if the new smoke suite is excluded from the default HTTP list; otherwise run the relevant focused HTTP suite.
- [ ] Run the opt-in dashboard/webui real-PI smoke command and capture the passing thread/proposal/integrator identifiers.
- [ ] Summarize what changed, what was verified, and any remaining risks.
