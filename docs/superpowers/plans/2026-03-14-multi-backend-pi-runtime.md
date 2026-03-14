# Multi-Backend PI Runtime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a SPORE-owned `RuntimeAdapter` boundary that supports `pi_rpc`, `pi_sdk_embedded`, and `pi_sdk_worker` without regressing inspectability, operator steering, durable artifacts, or recovery.

**Architecture:** Add a generic runtime contract and supervisor layer between orchestrator and PI-specific runtime code, then wrap the current RPC path behind that contract before adding the two SDK-backed modes. Preserve the existing session-manager and session-gateway authority model by standardizing runtime snapshots, control acknowledgments, and generic runtime artifacts while keeping PI-specific raw diagnostics below the adapter boundary.

**Tech Stack:** TypeScript, Node 24 ESM, `node:test`, `node:sqlite`, `tsx`, tmux, SPORE workspaces, PI CLI RPC, PI SDK (new dependency), Zod for worker protocol validation.

---

## Execution Strategy

- Repo-fit note: `AGENTS.md` treats broad runtime/foundation rebuilding as outside the routine near-term scope, so execute this plan only as an explicit architecture exception. Keep the work tightly bounded to adding the adapter boundary and backend modes around the existing PI-first runtime slice; do not turn it into a general orchestrator/runtime redesign.
- This plan is intended to be executable in one long dedicated work session.
- Keep Tasks 0-8 single-threaded. They establish the approved architecture-exception gate, shared contract, registry/supervisor, schema, launch seam, generic recovery logic, client compatibility layer, and the RPC parity gate that every SDK backend depends on.
- Do not start Tasks 9-13 until Task 8 passes. Task 8 is the explicit parity gate that proves `pi_rpc` already satisfies the generic contract.
- After Task 8 lands and passes its verification loop, use `superpowers:subagent-driven-development` to split the remaining work into parallel lanes, but reserve shared hot files for one integrator lane:
  - Lane A (shared-files owner): `packages/runtime-pi/src/index.ts`, `packages/runtime-pi/src/cli/run-session-plan.ts`, `packages/runtime-pi/src/cli/pi-session-plan.ts`, `packages/runtime-pi/src/cli/pi-runtime-doctor.ts`, `packages/runtime-pi/package.json`, `package-lock.json`, `services/session-gateway/server.ts`, `config/system/runtime.yaml`.
  - Lane B (adapter-local): Tasks 9-10 (`pi_sdk_embedded`) except when changes are needed in the shared-files owner set.
  - Lane C (adapter-local): Tasks 11-13 (`pi_sdk_worker`) except when changes are needed in the shared-files owner set.
- Do not parallelize edits inside `packages/orchestrator/src/execution/workflow-execution.impl.ts`, `packages/session-manager/src/reconcile/session-reconcile.ts`, or `services/session-gateway/server.ts` until their owning prerequisite task is merged in the working tree, because those files are already high-churn and central.
- Keep `pi_rpc` working at every checkpoint. If a later task destabilizes runtime behavior, revert only the in-progress task branch/worktree, not the already-wrapped RPC adapter path.

## File Map

### New packages and core runtime contract

- Create: `packages/runtime-core/package.json` - new workspace package for backend-agnostic runtime contracts.
- Create: `packages/runtime-core/src/index.ts` - public exports.
- Create: `packages/runtime-core/src/types.ts` - backend kinds, capabilities, snapshots, control envelopes, artifact manifest types.
- Create: `packages/runtime-core/src/runtime-adapter.ts` - `RuntimeAdapter` and `RuntimeAdapterHooks` interfaces.
- Create: `packages/runtime-core/src/runtime-registry.ts` - backend lookup and capability metadata.
- Create: `packages/runtime-core/src/runtime-supervisor.ts` - generic launch, event normalization handoff, artifact write orchestration.
- Create: `packages/runtime-core/src/runtime-artifacts.ts` - generic artifact names and write helpers.
- Create: `packages/runtime-core/src/runtime-events.ts` - normalized runtime event types.
- Create: `packages/runtime-core/test/runtime-adapter-contract.test.ts` - contract-level tests.
- Create: `packages/runtime-core/test/runtime-artifact-manifest.test.ts` - artifact manifest tests.
- Modify: `tsconfig.base.json` - add the `@spore/runtime-core` path alias.

### PI-specific backend implementations

- Modify: `packages/runtime-pi/package.json` - add runtime dependencies such as the PI SDK and `zod` when the worker protocol work begins.
- Modify: `packages/runtime-pi/src/index.ts` - export adapter implementations and compatibility helpers.
- Modify: `packages/runtime-pi/src/types.ts` - extend `SessionPlan` with `providerFamily`, `backendKind`, runtime binding metadata, and generic runtime artifact fields.
- Modify: `packages/runtime-pi/src/planner/build-session-plan.ts` - carry backend selection and artifact defaults into the plan.
- Modify: `packages/runtime-pi/src/context/build-startup-context.ts` - preserve startup context file emission across all backends.
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts` - turn this into a compatibility CLI over the new supervisor instead of the primary architecture seam.
- Modify: `packages/runtime-pi/src/cli/pi-session-plan.ts` - expose backend-aware plan previews.
- Modify: `packages/runtime-pi/src/cli/pi-runtime-doctor.ts` - report adapter/backend diagnostics instead of RPC-only checks.
- Modify: `packages/runtime-pi/src/control/session-control-queue.ts` - preserve durable control history while supporting non-RPC adapters.
- Modify: `packages/runtime-pi/src/launchers/tmux-launcher.ts` - demote tmux launch script writing into the RPC adapter implementation.
- Modify: `packages/runtime-pi/src/launchers/pi-rpc-runner.ts` - keep it as the PI RPC transport worker behind `pi_rpc`.
- Modify: `packages/runtime-pi/src/launchers/pi-json-runner.ts` - preserve or explicitly deprecate the legacy JSON-event launcher as a debug sub-mode of `pi_rpc`.
- Create: `packages/runtime-pi/src/adapters/pi-rpc-adapter.ts` - wraps the existing CLI/tmux/RPC behavior behind `RuntimeAdapter`.
- Create: `packages/runtime-pi/src/adapters/pi-sdk-embedded-adapter.ts` - same-process SDK integration.
- Create: `packages/runtime-pi/src/adapters/pi-sdk-worker-adapter.ts` - parent-side worker backend.
- Create: `packages/runtime-pi/src/adapters/register-pi-backends.ts` - PI-owned composition root that registers runtime adapters into the pure registry.
- Create: `packages/runtime-pi/src/sdk/create-pi-sdk-session.ts` - PI SDK session boot helper shared by embedded and worker backends.
- Create: `packages/runtime-pi/src/normalize/pi-rpc-events.ts` - normalize RPC events.
- Create: `packages/runtime-pi/src/normalize/pi-sdk-events.ts` - normalize SDK events.
- Create: `packages/runtime-pi/src/worker/protocol.ts` - worker message types and validators.
- Create: `packages/runtime-pi/src/worker/pi-sdk-worker-main.ts` - worker runtime entrypoint.

### Orchestrator/runtime launch seam

- Modify: `packages/orchestrator/src/invocation/plan-workflow-invocation.ts` - add backend resolution and `runtimePolicy.backendKindByRole` support.
- Modify: `packages/orchestrator/src/types/contracts.ts` - extend policy container and live payload contracts.
- Modify: `packages/orchestrator/src/execution/runtime-launch.ts` - convert from re-export stub into the real launch seam.
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts` - delegate runtime start/control/snapshot concerns to the launch seam and stop branching on PI internals.
- Modify: `packages/orchestrator/src/scenarios/run-history.ts` - preserve history/report behavior when runtime artifacts become backend-agnostic.
- Modify: `packages/orchestrator/src/index.ts` - export runtime launch utilities where needed.

### Session durability and live inspection

- Modify: `packages/session-manager/src/types.ts` - persist backend kind, runtime binding metadata, generic runtime artifact paths, and capability flags.
- Modify: `packages/session-manager/src/store/session-store.ts` - add SQLite columns and parsers.
- Modify: `packages/session-manager/src/lifecycle/session-lifecycle.ts` - create session records from the richer plan.
- Modify: `packages/session-manager/src/control/session-actions.ts` - preserve generic event emission.
- Modify: `packages/session-manager/src/events/event-log.ts` - keep event-feed semantics stable while runtime events become backend-agnostic.
- Modify: `packages/session-manager/src/reconcile/session-reconcile.ts` - generic `runtime-status.json` first, RPC legacy artifacts second.
- Modify: `packages/session-manager/src/cli/session-manager.ts` - surface generic runtime recovery fields.
- Modify: `services/session-gateway/server.ts` - move from `launcherType === "pi-rpc"` to capability-driven live inspection and control.

### Client surfaces

- Modify: `packages/tui/src/cli/spore-ops.ts` - stop assuming tmux is always the inspection mechanism.
- Modify: `apps/web/src/lib/api/sessions.ts` - preserve live route contract while allowing backend-agnostic payloads.
- Modify: `apps/web/src/types/mission-map.ts` - new live payload fields.
- Modify: `apps/web/src/types/agent-cockpit.ts` - backend/capability metadata.
- Modify: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts` - capability-based inspection display.
- Modify: `apps/web/src/components/cockpit/AgentSessionSummary.tsx` - stop hardwiring tmux/launcher-centric inspection labels.
- Modify: `apps/web/src/adapters/agent-cockpit.ts` - normalize runtime metadata.
- Modify: `apps/web/src/adapters/mission-map.ts` - normalize backend-aware session inspection.
- Modify: `apps/web/src/main.ts` - display generic runtime capabilities and artifact status.
- Modify: `apps/web/test/agent-cockpit-adapter.test.ts` - keep adapter-level contracts stable.
- Modify: `apps/web/test/mission-map-adapter.test.ts` - keep adapter-level contracts stable.

### Harnesses and install artifacts

- Modify: `packages/test-support/src/e2e-harness.ts` - backend selection and artifact-aware E2E helpers.
- Modify: `packages/runtime-pi/test/helpers/e2e-harness.ts` - backend-aware PI runtime smoke helpers.
- Modify: `package-lock.json` - dependency lock updates for PI SDK and `zod`.
- Modify: `packages/runtime-pi/test/workspace-launch-context.test.ts` - keep workspace metadata stable across all backends.
- Modify: `packages/orchestrator/test/builder-tester-workspaces.test.ts` - keep builder/tester workspace handoffs stable.
- Modify: `packages/orchestrator/test/domain-policy.test.ts` - keep backend policy selection stable.
- Modify: `services/orchestrator/test/http-self-build.test.ts` - keep self-build HTTP surfaces stable with generic runtime artifacts.

### Config, schema, and docs

- Modify: `config/system/runtime.yaml` - add multi-backend registry and defaults.
- Modify: `config/projects/spore.yaml` - add explicit production/dev backend policy after parity work lands.
- Modify: `schemas/system/system.schema.json` - finally validate the runtime system config shape.
- Modify: `schemas/profile/profile.schema.json` - optional per-profile backend hints only if needed.
- Modify: `schemas/project/project.schema.json` - allow runtime backend policy overrides.
- Modify: `schemas/domain/domain.schema.json` - allow domain runtime backend policy overrides.
- Modify: `schemas/policy-pack/policy-pack.schema.json` - allow backend-related runtime policy.
- Modify: `schemas/session/session-launch-plan.schema.json` - generic runtime launch plan shape.
- Modify: `schemas/session/session.schema.json` - backend kind and runtime metadata.
- Modify: `schemas/event/agent-event.schema.json` - normalized runtime/agent events.
- Modify: `schemas/event/session-lifecycle-event.schema.json` - optional new lifecycle kinds if needed.
- Modify: `schemas/event/session-control-event.schema.json` - capability-agnostic control events.
- Modify: `AGENTS.md` - record the approved architecture exception for agent-facing repo instructions.
- Modify: `docs/INDEX.md` - primary docs navigation.
- Modify: `docs/index/DOCS_INDEX.md` - docs index surface.
- Modify: `docs/index/docs_manifest.yaml` - docs manifest source of truth.
- Modify: `docs/plans/project-state-and-direction-handoff.md` - update the current-direction handoff once this exception is approved and implemented.
- Modify: `docs/plans/self-build-status-and-next-steps.md` - update near-term work guidance.
- Modify: `docs/plans/roadmap.md` - update roadmap/current wave guidance.
- Modify: `docs/architecture/runtime-model.md`, `docs/architecture/session-model.md`, `docs/architecture/clients-and-surfaces.md`, `docs/architecture/pi-integration-strategy.md`, `docs/architecture/workflow-model.md`, `docs/runbooks/local-dev.md`, `docs/research/pi-notes.md`.
- Create: `docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md`.
- Create: `docs/decisions/ADR-0015-pi-sdk-worker-transport.md`.
- Create: `docs/decisions/ADR-0016-runtime-artifact-parity.md`.

## Chunk 0: Architecture Exception and ADR Gate

### Task 0: Record the architecture exception and boundary decisions before code changes

**Files:**
- Create: `docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md`
- Create: `docs/decisions/ADR-0015-pi-sdk-worker-transport.md`
- Create: `docs/decisions/ADR-0016-runtime-artifact-parity.md`
- Modify: `AGENTS.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/index/DOCS_INDEX.md`
- Modify: `docs/index/docs_manifest.yaml`
- Modify: `docs/plans/project-state-and-direction-handoff.md`
- Modify: `docs/plans/self-build-status-and-next-steps.md`
- Modify: `docs/plans/roadmap.md`
- Test: `npm run docs-kb:index`

- [ ] **Step 1: Write the three ADR stubs first and make the architecture-exception/why-now gate explicit**

Required content in this step:
- ADR-0014 states that SPORE is intentionally adding a generic runtime adapter boundary around the already-existing PI-first runtime slice, not rebuilding the orchestrator or replacing PI.
- ADR-0015 states that `pi_sdk_worker` will use stdio NDJSON first because it preserves process isolation and inspectable message streams.
- ADR-0016 states that every backend must emit durable generic runtime artifacts and must preserve compatibility artifacts until all operator surfaces migrate.

- [ ] **Step 2: Add an explicit approval line to ADR-0014 and update the canonical direction docs before any code work starts**

```md
## Why Now

This is an approved architecture exception to the current near-term roadmap because SPORE already has a real PI-first runtime slice and needs a safer backend boundary before more operator/runtime features land.
```

Update these docs in the same step so the repo ground truth no longer says this work is out-of-scope while the long session is executing:
- `AGENTS.md`
- `docs/INDEX.md`
- `docs/index/DOCS_INDEX.md`
- `docs/index/docs_manifest.yaml`
- `docs/plans/project-state-and-direction-handoff.md`
- `docs/plans/self-build-status-and-next-steps.md`
- `docs/plans/roadmap.md`

- [ ] **Step 3: Run docs indexing so the exception gate is visible in the repo knowledge surfaces before implementation begins**

Run: `npm run docs-kb:index`
Expected: PASS, with the new ADRs included in the docs knowledge base.

- [ ] **Step 4: Commit the exception gate and ADR stubs**

```bash
git add AGENTS.md docs/INDEX.md docs/index/DOCS_INDEX.md docs/index/docs_manifest.yaml docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md docs/decisions/ADR-0015-pi-sdk-worker-transport.md docs/decisions/ADR-0016-runtime-artifact-parity.md docs/plans/project-state-and-direction-handoff.md docs/plans/self-build-status-and-next-steps.md docs/plans/roadmap.md
git commit -m "docs: record runtime adapter architecture exception"
```

## Chunk 1: Contract, Schema, and Planning Inputs

### Task 1: Create the generic runtime-core contract package

**Files:**
- Create: `packages/runtime-core/package.json`
- Create: `packages/runtime-core/src/index.ts`
- Create: `packages/runtime-core/src/types.ts`
- Create: `packages/runtime-core/src/runtime-adapter.ts`
- Create: `packages/runtime-core/src/runtime-events.ts`
- Create: `packages/runtime-core/src/runtime-artifacts.ts`
- Create: `packages/runtime-core/test/runtime-adapter-contract.test.ts`
- Create: `packages/runtime-core/test/runtime-artifact-manifest.test.ts`
- Modify: `tsconfig.base.json`
- Test: `packages/runtime-core/test/runtime-adapter-contract.test.ts`
- Test: `packages/runtime-core/test/runtime-artifact-manifest.test.ts`

- [ ] **Step 1: Write the failing contract tests**

```ts
test("runtime adapter contract captures backend identity and capabilities", () => {
  const snapshot: RuntimeSnapshot = {
    sessionId: "session-1",
    backendKind: "pi_rpc",
    state: "starting",
    health: "healthy",
    startedAt: null,
    finishedAt: null,
    lastEventAt: null,
    terminalSignal: null,
    rawStateRef: null,
  };
  assert.equal(snapshot.backendKind, "pi_rpc");
});
```

- [ ] **Step 2: Run the new tests and verify they fail because the package does not exist yet**

Run: `node --import=tsx --test packages/runtime-core/test/runtime-adapter-contract.test.ts packages/runtime-core/test/runtime-artifact-manifest.test.ts`
Expected: FAIL with module/file not found errors for `packages/runtime-core/*`.

- [ ] **Step 3: Create the package skeleton, exports, and TypeScript path alias**

```json
{
  "name": "@spore/runtime-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Update `tsconfig.base.json` to add the workspace alias alongside the other `@spore/*` entries.

- [ ] **Step 4: Implement the core runtime contract types**

```ts
export type RuntimeProviderFamily = "pi";

export type RuntimeBackendKind =
  | "pi_rpc"
  | "pi_sdk_embedded"
  | "pi_sdk_worker";

export interface RuntimeCapabilities {
  supportsSteer: boolean;
  supportsFollowUp: boolean;
  supportsPrompt: boolean;
  supportsAbort: boolean;
  supportsSnapshot: boolean;
  supportsAttach: boolean;
  supportsRawEvents: boolean;
  supportsTmuxInspection: boolean;
}
```

- [ ] **Step 5: Implement adapter, event, and artifact-manifest helpers**

```ts
export interface RuntimeArtifactManifest {
  transcriptPath: string | null;
  runtimeStatusPath: string | null;
  runtimeEventsPath: string | null;
  rawEventsPath: string | null;
  controlPath: string | null;
  handoffPath: string | null;
  debugPaths: string[];
}
```

- [ ] **Step 6: Run the new package tests and repo typecheck**

Run: `node --import=tsx --test packages/runtime-core/test/runtime-adapter-contract.test.ts packages/runtime-core/test/runtime-artifact-manifest.test.ts && npm run typecheck`
Expected: PASS for both tests and no new typecheck errors.

- [ ] **Step 7: Commit the contract package**

```bash
git add packages/runtime-core/package.json packages/runtime-core/src/index.ts packages/runtime-core/src/types.ts packages/runtime-core/src/runtime-adapter.ts packages/runtime-core/src/runtime-events.ts packages/runtime-core/src/runtime-artifacts.ts packages/runtime-core/test/runtime-adapter-contract.test.ts packages/runtime-core/test/runtime-artifact-manifest.test.ts tsconfig.base.json
git commit -m "refactor: add generic runtime adapter contract"
```

### Task 2: Extend config, policy, and schema surfaces for backend selection

**Files:**
- Modify: `packages/orchestrator/src/types/contracts.ts`
- Modify: `packages/config-schema/src/index.ts`
- Modify: `schemas/system/system.schema.json`
- Modify: `schemas/profile/profile.schema.json`
- Modify: `schemas/project/project.schema.json`
- Modify: `schemas/domain/domain.schema.json`
- Modify: `schemas/policy-pack/policy-pack.schema.json`
- Modify: `schemas/session/session-launch-plan.schema.json`
- Modify: `schemas/session/session.schema.json`
- Modify: `schemas/event/agent-event.schema.json`
- Modify: `schemas/event/session-lifecycle-event.schema.json`
- Modify: `schemas/event/session-control-event.schema.json`
- Modify: `config/system/runtime.yaml`
- Create: `packages/config-schema/test/runtime-system-schema.test.ts`
- Test: `packages/config-schema/test/runtime-system-schema.test.ts`

- [ ] **Step 1: Write a failing config-schema test that expects the system runtime config to allow provider-family `pi` plus explicit backend kinds**

```ts
test("system runtime config keeps profile runtime=pi while registering backend kinds", async () => {
  const parsed = validateConfigFile("config/system/runtime.yaml");
  assert.equal(parsed.primaryRuntime.providerFamily, "pi");
  assert.equal(parsed.primaryRuntime.backendKind, "pi_rpc");
});
```

- [ ] **Step 2: Run the new test and verify it fails because the system schema does not know about backend kinds yet**

Run: `node --import=tsx --test packages/config-schema/test/runtime-system-schema.test.ts`
Expected: FAIL with schema validation errors for the new runtime config keys.

- [ ] **Step 3: Extend policy and schema types with `backendKindByRole` and default backend settings**

```ts
runtimePolicy: {
  sessionModeByRole?: Record<string, JsonValue>;
  backendKindByRole?: Record<string, JsonValue>;
  defaultBackendKind?: JsonValue;
  workspace?: JsonValue;
}
```

- [ ] **Step 4: Replace the minimal system schema with a real runtime config schema**

```json
{
  "type": "object",
  "required": ["id", "primaryRuntime", "runtimeAdapters", "sessionDefaults"],
  "properties": {
    "primaryRuntime": {
      "type": "object",
      "required": ["providerFamily", "backendKind"]
    }
  }
}
```

- [ ] **Step 5: Expand `config/system/runtime.yaml` to keep the existing profile runtime family `pi` while registering all three backend kinds without changing the default yet**

```yaml
primaryRuntime:
  providerFamily: pi
  backendKind: pi_rpc
runtimeAdapters:
  - id: pi
    providerFamily: pi
    package: packages/runtime-pi
    defaultBackendKind: pi_rpc
    supportedBackends:
      - backendKind: pi_rpc
      - backendKind: pi_sdk_embedded
      - backendKind: pi_sdk_worker
```

- [ ] **Step 6: Run config validation, the new schema test, and the existing policy suite**

Run: `node --import=tsx --test packages/config-schema/test/runtime-system-schema.test.ts && npm run config:validate && node --import=tsx --test packages/orchestrator/test/domain-policy.test.ts packages/orchestrator/test/domain-policy-propagation.test.ts`
Expected: PASS, with the new test proving backend registration is carried in validated config while profile runtime stays `pi`.

- [ ] **Step 7: Commit the schema and config surface**

```bash
git add packages/orchestrator/src/types/contracts.ts packages/config-schema/src/index.ts schemas/system/system.schema.json schemas/profile/profile.schema.json schemas/project/project.schema.json schemas/domain/domain.schema.json schemas/policy-pack/policy-pack.schema.json schemas/session/session-launch-plan.schema.json schemas/session/session.schema.json schemas/event/agent-event.schema.json schemas/event/session-lifecycle-event.schema.json schemas/event/session-control-event.schema.json config/system/runtime.yaml packages/config-schema/test/runtime-system-schema.test.ts
git commit -m "feat: add runtime backend policy and schema support"
```

### Task 3: Thread backend selection through invocation planning and session-plan generation

**Files:**
- Modify: `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
- Modify: `packages/runtime-pi/src/types.ts`
- Modify: `packages/runtime-pi/src/planner/build-session-plan.ts`
- Modify: `packages/runtime-pi/src/context/build-startup-context.ts`
- Create: `packages/orchestrator/test/runtime-backend-policy.test.ts`
- Modify: `packages/runtime-pi/test/domain-policy-runtime-context.test.ts`
- Create: `packages/runtime-pi/test/runtime-backend-plan.test.ts`
- Test: `packages/orchestrator/test/runtime-backend-policy.test.ts`
- Test: `packages/runtime-pi/test/runtime-backend-plan.test.ts`
- Test: `packages/runtime-pi/test/domain-policy-runtime-context.test.ts`

- [ ] **Step 1: Write failing planner and session-plan tests that expect backend kind resolution to flow from validated policy into invocation launches and plans**

```ts
test("planWorkflowInvocation resolves backend kind by role", async () => {
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/spore.yaml",
    domainId: "backend",
    roles: ["builder"],
    objective: "backend policy selection",
  });
  assert.equal(invocation.launches[0].policy.runtimePolicy.backendKind, "pi_rpc");
});

test("buildSessionPlan carries provider family and backend kind", async () => {
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/lead.yaml",
    projectPath: "config/projects/spore.yaml",
    backendKind: "pi_rpc",
  });
  assert.equal(plan.providerFamily, "pi");
  assert.equal(plan.backendKind, "pi_rpc");
});
```

- [ ] **Step 2: Run the targeted plan tests and verify they fail on missing fields**

Run: `node --import=tsx --test packages/orchestrator/test/runtime-backend-policy.test.ts packages/runtime-pi/test/runtime-backend-plan.test.ts packages/runtime-pi/test/domain-policy-runtime-context.test.ts`
Expected: FAIL with undefined field assertions and/or unsupported option errors.

- [ ] **Step 3: Update invocation planning to resolve `runtimePolicy.backendKindByRole` using the same precedence as `sessionModeByRole`**

```ts
const backendKindOverride =
  policy.runtimePolicy?.backendKindByRole?.[role] ??
  policy.runtimePolicy?.defaultBackendKind ??
  systemDefaultBackendKind;
```

- [ ] **Step 4: Extend `SessionPlan` and `buildSessionPlan(...)` to carry backend identity and generic runtime artifact defaults**

```ts
const plan: SessionPlan = {
  version: 2,
  providerFamily: "pi",
  backendKind,
  adapterId: backendKind,
  runtime: "pi",
  // existing session/project/pi/retrieval/metadata remain
};
```

- [ ] **Step 5: Keep startup-context output stable while adding backend metadata for later gateway/UI use**

```ts
payload.runtime = {
  providerFamily: plan.providerFamily,
  backendKind: plan.backendKind,
};
```

- [ ] **Step 6: Run targeted tests plus the existing policy/runtime context loop**

Run: `node --import=tsx --test packages/orchestrator/test/runtime-backend-policy.test.ts packages/runtime-pi/test/runtime-backend-plan.test.ts packages/runtime-pi/test/domain-policy-runtime-context.test.ts`
Expected: PASS, with both invocation and session plan carrying backend identity.

- [ ] **Step 7: Commit backend-aware planning inputs**

```bash
git add packages/orchestrator/src/invocation/plan-workflow-invocation.ts packages/runtime-pi/src/types.ts packages/runtime-pi/src/planner/build-session-plan.ts packages/runtime-pi/src/context/build-startup-context.ts packages/orchestrator/test/runtime-backend-policy.test.ts packages/runtime-pi/test/runtime-backend-plan.test.ts packages/runtime-pi/test/domain-policy-runtime-context.test.ts
git commit -m "feat: thread runtime backend selection into launch plans"
```

## Chunk 2: Launch Seam and Wrapped RPC Backend

### Task 4: Extract a real runtime launch seam and supervisor

**Files:**
- Modify: `packages/runtime-core/src/index.ts`
- Create: `packages/runtime-core/src/runtime-registry.ts`
- Create: `packages/runtime-core/src/runtime-supervisor.ts`
- Create: `packages/runtime-core/test/runtime-registry.test.ts`
- Modify: `packages/orchestrator/src/execution/runtime-launch.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Create: `packages/orchestrator/test/runtime-launch.test.ts`
- Test: `packages/runtime-core/test/runtime-registry.test.ts`
- Test: `packages/orchestrator/test/runtime-launch.test.ts`

- [ ] **Step 1: Write failing registry and launch tests that prove backend resolution and supervisor dispatch happen before orchestrator launch**

```ts
test("runtime registry can register and resolve a backend kind without importing PI adapters", () => {
  const registry = createRuntimeRegistry();
  registry.register(fakeAdapter);
  assert.equal(registry.get(fakeAdapter.backendKind)?.backendKind, fakeAdapter.backendKind);
});

test("launchStep delegates runtime start to runtime-launch", async () => {
  const startRuntime = mock.fn();
  // inject seam and assert it was called with execution/step/session-plan metadata
  assert.equal(startRuntime.mock.callCount(), 1);
});
```

- [ ] **Step 2: Run the registry and launch tests and verify they fail because the registry/supervisor files do not exist yet**

Run: `node --import=tsx --test packages/runtime-core/test/runtime-registry.test.ts packages/orchestrator/test/runtime-launch.test.ts`
Expected: FAIL because there is no registry, no supervisor, and no injectable runtime launch function yet.

- [ ] **Step 3: Implement `packages/runtime-core/src/runtime-registry.ts` and export it from `packages/runtime-core/src/index.ts`**

```ts
export function createRuntimeRegistry() {
  return new RuntimeRegistry();
}
```

Keep `packages/runtime-core` pure here: the registry only stores and resolves adapters; it must not import `@spore/runtime-pi` directly.

- [ ] **Step 4: Implement `packages/runtime-core/src/runtime-supervisor.ts` so it owns adapter start, generic artifact setup, and normalized hook wiring**

```ts
export class RuntimeSupervisor {
  async start(options: StartRuntimeForStepOptions) {
    const adapter = this.registry.require(options.sessionPlan.backendKind);
    return adapter.start(options.request, options.hooks);
  }
}
```

- [ ] **Step 5: Turn `packages/orchestrator/src/execution/runtime-launch.ts` into the real seam over the supervisor**

```ts
export function createRuntimeLauncher(registry: RuntimeRegistry) {
  const supervisor = new RuntimeSupervisor({ registry });
  return {
    async startRuntimeForStep(options: StartRuntimeForStepOptions) {
      return supervisor.start(options);
    },
  };
}
```

Create the PI-specific composition root in a PI-owned file during Task 5, for example `packages/runtime-pi/src/adapters/register-pi-backends.ts`, and use it to build the registry instance that the orchestrator seam consumes instead of making `packages/runtime-core` depend on PI adapters.

- [ ] **Step 6: Move CLI/session-launch orchestration out of `workflow-execution.impl.ts` and into the supervisor-backed seam**

```ts
const runtime = await startRuntimeForStep({
  execution,
  step,
  sessionPlan,
  briefPath,
  workspace,
  parentSessionId,
});
```

- [ ] **Step 7: Reduce `run-session-plan.ts` to a compatibility CLI over the same supervisor used by orchestrator**

```ts
const result = await runtimeSupervisor.startFromCliFlags(flags);
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 8: Run the new registry/launch tests and the existing workflow planning/runtime tests**

Run: `node --import=tsx --test packages/runtime-core/test/runtime-registry.test.ts packages/orchestrator/test/runtime-launch.test.ts packages/runtime-pi/test/launcher-selection.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts`
Expected: PASS, with no change to external CLI behavior and with the pure registry resolving registered adapters without importing `@spore/runtime-pi`.

- [ ] **Step 9: Commit the registry, supervisor, and launch seam extraction**

```bash
git add packages/runtime-core/src/index.ts packages/runtime-core/src/runtime-registry.ts packages/runtime-core/src/runtime-supervisor.ts packages/runtime-core/test/runtime-registry.test.ts packages/orchestrator/src/execution/runtime-launch.ts packages/orchestrator/src/execution/workflow-execution.impl.ts packages/runtime-pi/src/cli/run-session-plan.ts packages/orchestrator/src/index.ts packages/orchestrator/test/runtime-launch.test.ts
git commit -m "refactor: add runtime registry and supervisor seam"
```

### Task 5: Wrap the current RPC path behind `PiRpcAdapter`

**Files:**
- Create: `packages/runtime-pi/src/adapters/pi-rpc-adapter.ts`
- Create: `packages/runtime-pi/src/adapters/register-pi-backends.ts`
- Create: `packages/runtime-pi/src/normalize/pi-rpc-events.ts`
- Modify: `packages/runtime-pi/src/index.ts`
- Modify: `packages/runtime-pi/src/cli/pi-session-plan.ts`
- Modify: `packages/runtime-pi/src/cli/pi-runtime-doctor.ts`
- Modify: `packages/runtime-pi/src/launchers/tmux-launcher.ts`
- Modify: `packages/runtime-pi/src/launchers/pi-rpc-runner.ts`
- Modify: `packages/runtime-pi/src/launchers/pi-json-runner.ts`
- Modify: `packages/runtime-pi/src/control/session-control-queue.ts`
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
- Modify: `packages/orchestrator/src/execution/runtime-launch.ts`
- Modify: `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- Modify: `packages/session-manager/src/cli/session-manager.ts`
- Modify: `packages/runtime-pi/test/launcher-selection.test.ts`
- Modify: `packages/runtime-pi/test/tsx-entrypoint.test.ts`
- Modify: `packages/runtime-pi/test/pi-rpc-smoke.test.ts`
- Modify: `packages/runtime-pi/test/json-file.test.ts`
- Create: `packages/runtime-pi/test/pi-rpc-adapter.test.ts`
- Test: `packages/runtime-pi/test/pi-rpc-adapter.test.ts`
- Test: `packages/runtime-pi/test/tsx-entrypoint.test.ts`

- [ ] **Step 1: Write a failing adapter test that expects the RPC backend to expose normalized capabilities and artifacts**

```ts
test("PiRpcAdapter reports tmux inspection and raw event support", async () => {
  const adapter = createPiRpcAdapter();
  assert.equal(adapter.capabilities.supportsTmuxInspection, true);
  assert.equal(adapter.capabilities.supportsRawEvents, true);
});
```

- [ ] **Step 2: Run the RPC adapter tests and verify they fail because the adapter file does not exist yet**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-rpc-adapter.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts`
Expected: FAIL with missing adapter exports and/or outdated launch-script assumptions.

- [ ] **Step 3: Implement `PiRpcAdapter` as a thin wrapper over the current tmux/RPC behavior**

```ts
export function createPiRpcAdapter(): RuntimeAdapter {
  return {
    providerFamily: "pi",
    backendKind: "pi_rpc",
    capabilities: {
      supportsSteer: true,
      supportsFollowUp: true,
      supportsPrompt: true,
      supportsAbort: true,
      supportsSnapshot: true,
      supportsAttach: true,
      supportsRawEvents: true,
      supportsTmuxInspection: true,
    },
    async start(request, hooks) {
      // reuse writeLaunchAssets, writeLaunchScript, launchTmuxSession, pi-rpc-runner
    },
  };
}
```

- [ ] **Step 4: Normalize RPC runner events into the generic runtime event envelope while preserving the raw `.pi-events.jsonl` artifact**

```ts
export function normalizePiRpcEvent(raw: RpcEvent): RuntimeEventEnvelope | null {
  // map agent_start/agent_end/message_end/get_state snapshots into generic runtime events
}
```

- [ ] **Step 5: Keep the compatibility CLI and tmux launcher writing the existing legacy artifacts, but also return a generic runtime artifact manifest and backend-aware CLI diagnostics**

```ts
{
  backendKind: "pi_rpc",
  capabilities: adapter.capabilities,
  artifacts: {
    runtimeStatusPath: `tmp/sessions/${sessionId}.runtime-status.json`,
    runtimeEventsPath: `tmp/sessions/${sessionId}.runtime-events.jsonl`,
    legacyRpcStatusPath: `tmp/sessions/${sessionId}.rpc-status.json`,
  },
}
```

- [ ] **Step 6: Update `pi-session-plan.ts` and `pi-runtime-doctor.ts` so they print backend kind, adapter capabilities, and artifact paths rather than RPC-only assumptions**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-rpc-adapter.test.ts packages/runtime-pi/test/launcher-selection.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts`
Expected: PASS, with RPC still emitting `*.transcript.md`, `*.pi-events.jsonl`, `*.rpc-status.json`, and the new manifest-backed generic paths.

- [ ] **Step 7: Preserve the existing `pi-json` compatibility path as a debug sub-mode of `pi_rpc`, or deprecate it explicitly with matching test and doctor output updates**

Files to touch in this step only:
- `packages/runtime-pi/src/launchers/pi-json-runner.ts`
- `packages/runtime-pi/test/json-file.test.ts`
- `packages/runtime-pi/test/launcher-selection.test.ts`
- `packages/runtime-pi/src/cli/pi-runtime-doctor.ts`

Expected outcome:
- `pi-json` is no longer an accidental side path,
- either it still works as a documented debug launcher under the `pi_rpc` backend, or the doctor/tests mark it as deprecated intentionally.

- [ ] **Step 8: Define a concrete `RuntimeBinding` / `StartRuntimeResult` and thread it through the launch path before session recovery work begins**

Use this step to define and thread the structure through the launch path only; Task 6 is still the task that adds the SQLite/session-manager fields needed to persist it durably.

```ts
interface StartRuntimeResult {
  binding: RuntimeBinding;
  launchCommand: string | null;
  launcherType: string | null;
  artifactPaths: RuntimeArtifactManifest;
  runtimeInstanceId: string | null;
  capabilities: RuntimeCapabilities;
}
```

Thread this result through:
- `packages/orchestrator/src/execution/runtime-launch.ts`
- `packages/orchestrator/src/execution/workflow-execution.impl.ts`
- `packages/runtime-pi/src/cli/run-session-plan.ts`
- `packages/session-manager/src/cli/session-manager.ts`

Expected outcome:
- orchestrator launch code, CLI output, and in-memory launch results all use the same `StartRuntimeResult` shape,
- Task 6 can then persist that shape into session rows without inventing new fields mid-stream.

- [ ] **Step 9: Run the real RPC smoke test gate if PI is available; otherwise run the local contract loop only**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-rpc-adapter.test.ts packages/runtime-pi/test/launcher-selection.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts`
Expected: PASS locally.

Optional real-PI check when configured: `SPORE_RUN_PI_E2E=1 node --import=tsx --test packages/runtime-pi/test/pi-rpc-smoke.test.ts`
Expected: PASS or explicit skip if PI is unavailable.

- [ ] **Step 10: Commit the wrapped RPC backend**

```bash
git add packages/runtime-pi/src/adapters/pi-rpc-adapter.ts packages/runtime-pi/src/adapters/register-pi-backends.ts packages/runtime-pi/src/normalize/pi-rpc-events.ts packages/runtime-pi/src/index.ts packages/runtime-pi/src/cli/pi-session-plan.ts packages/runtime-pi/src/cli/pi-runtime-doctor.ts packages/runtime-pi/src/launchers/tmux-launcher.ts packages/runtime-pi/src/launchers/pi-rpc-runner.ts packages/runtime-pi/src/launchers/pi-json-runner.ts packages/runtime-pi/src/control/session-control-queue.ts packages/runtime-pi/src/cli/run-session-plan.ts packages/orchestrator/src/execution/runtime-launch.ts packages/orchestrator/src/execution/workflow-execution.impl.ts packages/session-manager/src/cli/session-manager.ts packages/runtime-pi/test/pi-rpc-adapter.test.ts packages/runtime-pi/test/json-file.test.ts packages/runtime-pi/test/launcher-selection.test.ts packages/runtime-pi/test/tsx-entrypoint.test.ts packages/runtime-pi/test/pi-rpc-smoke.test.ts
git commit -m "refactor: wrap pi rpc runtime behind adapter"
```

### Task 6: Add generic runtime artifacts, richer session records, and generic-first recovery

**Files:**
- Modify: `packages/session-manager/src/types.ts`
- Modify: `packages/session-manager/src/store/session-store.ts`
- Modify: `packages/session-manager/src/lifecycle/session-lifecycle.ts`
- Modify: `packages/session-manager/src/reconcile/session-reconcile.ts`
- Modify: `packages/session-manager/src/cli/session-manager.ts`
- Modify: `packages/session-manager/src/events/event-log.ts`
- Modify: `services/session-gateway/server.ts`
- Create: `packages/session-manager/test/runtime-status-reconcile.test.ts`
- Create: `packages/session-manager/test/runtime-heartbeat-reconcile.test.ts`
- Modify: `packages/session-manager/test/session-reconcile.test.ts`
- Modify: `services/session-gateway/test/live-route.test.ts`
- Test: `packages/session-manager/test/runtime-status-reconcile.test.ts`
- Test: `packages/session-manager/test/runtime-heartbeat-reconcile.test.ts`
- Test: `packages/session-manager/test/session-reconcile.test.ts`
- Test: `services/session-gateway/test/live-route.test.ts`

- [ ] **Step 1: Write failing reconcile tests for both generic-status priority and healthy non-tmux backends with fresh heartbeats**

```ts
test("reconcileSessionFromArtifacts prefers runtime-status before rpc-status", async () => {
  // create both files, make runtime-status authoritative, assert the generic path wins
});

test("reconcile watch does not fail a healthy pi_sdk_embedded session with a fresh heartbeat just because tmux is absent", async () => {
  // session.backendKind = "pi_sdk_embedded" and runtime-status.json heartbeatAt is recent
});
```

- [ ] **Step 2: Run reconcile and live-route tests to verify the generic artifact path and heartbeat logic are missing today**

Run: `node --import=tsx --test packages/session-manager/test/runtime-status-reconcile.test.ts packages/session-manager/test/runtime-heartbeat-reconcile.test.ts packages/session-manager/test/session-reconcile.test.ts services/session-gateway/test/live-route.test.ts`
Expected: FAIL because `runtime-status.json`, backend capabilities, heartbeat-aware reconcile behavior, and generic artifact fields do not exist yet.

- [ ] **Step 3: Extend session records and SQLite columns with backend and runtime-binding metadata**

```ts
backendKind: string | null;
runtimeInstanceId: string | null;
runtimeCapabilities?: RuntimeCapabilities | null;
runtimeStatusPath: string | null;
runtimeEventsPath: string | null;
```

- [ ] **Step 4: Make session reconciliation generic-first while keeping legacy RPC recovery as a fallback**

```ts
const signal =
  (await readGenericRuntimeSignal(session, projectRoot)) ??
  (await readSessionArtifactSignal(session, projectRoot));

const recentHeartbeat =
  genericStatus?.heartbeatAt &&
  Date.now() - Date.parse(genericStatus.heartbeatAt) < graceMs;
```

- [ ] **Step 5: Update the live route and artifact map to expose exact generic runtime artifacts and capabilities without assuming RPC-only control**

```ts
supportsControl: Boolean(session.runtimeCapabilities?.supportsSteer),
backendKind: session.backendKind,
runtimeStatus: artifacts.runtimeStatus?.exists ? ... : null,
artifacts: {
  runtimeStatus: `${base}.runtime-status.json`,
  runtimeEvents: `${base}.runtime-events.jsonl`,
  workerProtocol: `${base}.worker-protocol.ndjson`,
  rawEvents: `${base}.raw-events.jsonl`,
  legacyRpcStatus: `${base}.rpc-status.json`,
},
```

- [ ] **Step 6: Run reconcile, gateway, and session CLI tests**

Run: `node --import=tsx --test packages/session-manager/test/runtime-status-reconcile.test.ts packages/session-manager/test/runtime-heartbeat-reconcile.test.ts packages/session-manager/test/session-reconcile.test.ts services/session-gateway/test/live-route.test.ts && npm run typecheck`
Expected: PASS, with `GET /sessions/:id/live` still returning legacy fields plus the new backend-aware metadata.

- [ ] **Step 7: Commit generic runtime durability and recovery**

```bash
git add packages/session-manager/src/types.ts packages/session-manager/src/store/session-store.ts packages/session-manager/src/lifecycle/session-lifecycle.ts packages/session-manager/src/control/session-actions.ts packages/session-manager/src/events/event-log.ts packages/session-manager/src/reconcile/session-reconcile.ts packages/session-manager/src/cli/session-manager.ts services/session-gateway/server.ts packages/session-manager/test/runtime-status-reconcile.test.ts packages/session-manager/test/runtime-heartbeat-reconcile.test.ts packages/session-manager/test/session-reconcile.test.ts services/session-gateway/test/live-route.test.ts
git commit -m "feat: add backend-aware runtime artifacts and recovery"
```

## Chunk 3: Operator Surface Compatibility and Contract Parity

### Task 7: Remove direct RPC/tmux assumptions from gateway, TUI, and web clients

**Files:**
- Modify: `services/session-gateway/server.ts`
- Modify: `packages/tui/src/cli/spore-ops.ts`
- Modify: `packages/tui/test/tui-parity.test.ts`
- Modify: `apps/web/src/lib/api/sessions.ts`
- Modify: `apps/web/src/types/mission-map.ts`
- Modify: `apps/web/src/types/agent-cockpit.ts`
- Modify: `apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts`
- Modify: `apps/web/src/components/cockpit/AgentSessionSummary.tsx`
- Modify: `apps/web/src/adapters/agent-cockpit.ts`
- Modify: `apps/web/src/adapters/mission-map.ts`
- Modify: `apps/web/src/main.ts`
- Modify: `apps/web/test/agent-cockpit-adapter.test.ts`
- Modify: `apps/web/test/mission-map-adapter.test.ts`
- Modify: `apps/web/test/agent-lane-detail-page.test.ts`
- Modify: `apps/web/test/mission-map-page.test.ts`
- Modify: `apps/web/test/agent-cockpit-page.test.ts`
- Test: `apps/web/test/agent-cockpit-adapter.test.ts`
- Test: `apps/web/test/mission-map-adapter.test.ts`
- Test: `packages/tui/test/tui-parity.test.ts`
- Test: `apps/web/test/agent-lane-detail-page.test.ts`
- Test: `apps/web/test/mission-map-page.test.ts`

- [ ] **Step 1: Write/update failing client tests so they read capability-driven metadata instead of `launcherType === "pi-rpc"`**

```ts
assert.equal(response.json.diagnostics.supportsControl, true);
assert.equal(response.json.launcherMetadata.backendKind, "pi_rpc");
```

- [ ] **Step 2: Run the targeted TUI and web tests and verify they fail against the old assumptions**

Run: `node --import=tsx --test packages/tui/test/tui-parity.test.ts apps/web/test/agent-lane-detail-page.test.ts apps/web/test/mission-map-page.test.ts apps/web/test/agent-cockpit-page.test.ts`
Expected: FAIL because the client code still keys directly off launcher/tmux-specific fields.

- [ ] **Step 3: Teach the gateway to expose exact compatibility aliases and generic fields together**

```ts
diagnostics: {
  supportsControl: Boolean(session.runtimeCapabilities?.supportsSteer),
  supportsRpcControl: session.backendKind === "pi_rpc",
  controlMode: session.backendKind === "pi_rpc" ? "rpc" : "adapter",
},
launcherMetadata: {
  backendKind: session.backendKind,
  runtimeAdapter: session.runtimeAdapter,
  transportMode: session.transportMode,
  launcherType: session.launcherType,
  capabilities: session.runtimeCapabilities ?? {},
},
```

- [ ] **Step 4: Update TUI and web adapters to prefer generic fields and only fall back to legacy launcher metadata in a single normalization path**

```ts
const supportsControl =
  toBoolean(live.diagnostics?.supportsControl) ||
  toBoolean(live.diagnostics?.supportsRpcControl);

const backendKind =
  toText(live.launcherMetadata?.backendKind, "") ||
  toText(live.session?.backendKind, "") ||
  "pi_rpc";
```

- [ ] **Step 5: Re-run targeted TUI/web tests plus the gateway live-route test**

Run: `node --import=tsx --test packages/tui/test/tui-parity.test.ts services/session-gateway/test/live-route.test.ts apps/web/test/agent-cockpit-adapter.test.ts apps/web/test/mission-map-adapter.test.ts apps/web/test/agent-lane-detail-page.test.ts apps/web/test/mission-map-page.test.ts apps/web/test/agent-cockpit-page.test.ts`
Expected: PASS, with RPC remaining visually intact while making room for embedded and worker backends.

- [ ] **Step 6: Commit the client compatibility pass**

```bash
git add services/session-gateway/server.ts packages/tui/src/cli/spore-ops.ts packages/tui/test/tui-parity.test.ts apps/web/src/lib/api/sessions.ts apps/web/src/types/mission-map.ts apps/web/src/types/agent-cockpit.ts apps/web/src/features/agent-cockpit/use-agent-lane-detail.ts apps/web/src/components/cockpit/AgentSessionSummary.tsx apps/web/src/adapters/agent-cockpit.ts apps/web/src/adapters/mission-map.ts apps/web/src/main.ts apps/web/test/agent-cockpit-adapter.test.ts apps/web/test/mission-map-adapter.test.ts apps/web/test/agent-lane-detail-page.test.ts apps/web/test/mission-map-page.test.ts apps/web/test/agent-cockpit-page.test.ts
git commit -m "refactor: make operator surfaces runtime-backend aware"
```

### Task 8: Lock a reusable adapter contract and RPC parity test matrix before adding SDK backends

**Files:**
- Modify: `packages/runtime-core/test/runtime-adapter-contract.test.ts`
- Create: `packages/runtime-pi/test/runtime-backend-contract.test.ts`
- Create: `packages/runtime-pi/test/runtime-event-normalization.test.ts`
- Modify: `packages/runtime-pi/test/pi-rpc-smoke.test.ts`
- Modify: `packages/test-support/src/e2e-harness.ts`
- Modify: `packages/runtime-pi/test/helpers/e2e-harness.ts`
- Modify: `packages/runtime-pi/test/workspace-launch-context.test.ts`
- Modify: `packages/orchestrator/test/builder-tester-workspaces.test.ts`
- Modify: `packages/orchestrator/test/domain-policy.test.ts`
- Modify: `services/session-gateway/test/real-pi-session-control.e2e.test.ts`
- Modify: `services/orchestrator/test/http-self-build.test.ts`
- Test: `packages/runtime-pi/test/runtime-backend-contract.test.ts`
- Test: `packages/runtime-pi/test/runtime-event-normalization.test.ts`

- [ ] **Step 1: Write failing backend contract tests that all adapters must eventually satisfy**

```ts
test("adapter exposes snapshot, control ack, and artifact manifest", async () => {
  const binding = await adapter.start(request, hooks);
  const snapshot = await adapter.getSnapshot(binding);
  assert.equal(typeof snapshot.state, "string");
});
```

- [ ] **Step 2: Run the new contract tests against `pi_rpc` and verify the gaps explicitly**

Run: `node --import=tsx --test packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-event-normalization.test.ts`
Expected: FAIL until the RPC adapter fully satisfies the generic contract and normalization helpers.

- [ ] **Step 3: Fill the RPC adapter gaps in exact files until the generic contract passes cleanly**

Files to touch in this step only:
- `packages/runtime-pi/src/adapters/pi-rpc-adapter.ts`
- `packages/runtime-pi/src/normalize/pi-rpc-events.ts`
- `packages/runtime-core/test/runtime-adapter-contract.test.ts`

Expected outcome:
- `getSnapshot(...)` returns the generic runtime snapshot shape.
- `sendControl(...)` returns generic `accepted/queued/completed` acknowledgments.
- `start(...)` returns a manifest containing both generic and legacy artifact paths.

- [ ] **Step 4: Extend the real gateway-control E2E and harnesses to assert generic control capability fields, generic artifact paths, and backend identity**

Files to touch in this step only:
- `packages/test-support/src/e2e-harness.ts`
- `packages/runtime-pi/test/helpers/e2e-harness.ts`
- `services/session-gateway/test/real-pi-session-control.e2e.test.ts`

Expected outcome:
- the harness can request a backend kind explicitly,
- the E2E can assert `backendKind`, `supportsControl`, and `runtimeStatus`/`runtimeEvents` paths,
- workspace launch context, builder/tester workspace handoff tests, domain-policy tests, and self-build HTTP tests still accept the compatibility aliases (`rpc-status`, `launch-context`) while the generic manifest is introduced,
- the RPC fallback still passes unchanged.

- [ ] **Step 5: Run the local contract suite, then the real PI control E2E when configured**

Run: `node --import=tsx --test packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-event-normalization.test.ts`
Expected: PASS locally.

Optional real-PI check when configured: `SPORE_RUN_PI_CONTROL_E2E=1 node --import=tsx --test services/session-gateway/test/real-pi-session-control.e2e.test.ts`
Expected: PASS or explicit skip.

- [ ] **Step 6: Commit the parity guardrails**

```bash
git add packages/runtime-core/test/runtime-adapter-contract.test.ts packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-event-normalization.test.ts packages/runtime-pi/test/pi-rpc-smoke.test.ts packages/test-support/src/e2e-harness.ts packages/runtime-pi/test/helpers/e2e-harness.ts packages/runtime-pi/test/workspace-launch-context.test.ts packages/orchestrator/test/builder-tester-workspaces.test.ts packages/orchestrator/test/domain-policy.test.ts services/session-gateway/test/real-pi-session-control.e2e.test.ts services/orchestrator/test/http-self-build.test.ts
git commit -m "test: add runtime adapter parity guardrails"
```

## Chunk 4: `pi_sdk_embedded` Backend

### Task 9: Implement the embedded SDK adapter behind the same contract

**Files:**
- Modify: `packages/runtime-pi/package.json`
- Modify: `package-lock.json`
- Create: `packages/runtime-pi/src/sdk/create-pi-sdk-session.ts`
- Create: `packages/runtime-pi/src/adapters/pi-sdk-embedded-adapter.ts`
- Create: `packages/runtime-pi/src/normalize/pi-sdk-events.ts`
- Modify: `packages/runtime-pi/src/index.ts`
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
- Create: `packages/runtime-pi/test/pi-sdk-embedded-adapter.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-embedded-adapter.test.ts`

- [ ] **Step 1: Add a failing embedded-adapter test that expects same-process launch with generic artifacts and snapshots**

```ts
test("pi_sdk_embedded emits transcript and runtime-status artifacts without spawning a worker", async () => {
  const adapter = createPiSdkEmbeddedAdapter();
  const binding = await adapter.start(request, hooks);
  assert.equal(binding.backendKind, "pi_sdk_embedded");
});
```

- [ ] **Step 2: Run the embedded-adapter test and verify it fails because the adapter and SDK dependency are missing**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-embedded-adapter.test.ts`
Expected: FAIL with missing adapter/dependency errors.

- [ ] **Step 3: Add the PI SDK dependency and create a narrow boot helper rather than importing SDK details all over the package**

```ts
export async function createPiSdkSession(options: CreatePiSdkSessionOptions) {
  // centralize PI SDK session/config/auth wiring here
}
```

- [ ] **Step 4: Implement `PiSdkEmbeddedAdapter` with explicit capability and lifecycle differences**

```ts
supportsAttach: false,
supportsTmuxInspection: false,
supportsRawEvents: true,
```

- [ ] **Step 5: Make the embedded adapter write the exact generic and compatibility artifacts below, even though it can access data in memory**

Required artifact set for this step:
- `tmp/sessions/<session>.transcript.md`
- `tmp/sessions/<session>.handoff.json`
- `tmp/sessions/<session>.runtime-status.json`
- `tmp/sessions/<session>.runtime-events.jsonl`
- `tmp/sessions/<session>.raw-events.jsonl`
- `tmp/sessions/<session>.control.ndjson`
- `tmp/sessions/<session>.launch-context.json`

Required `runtime-status.json` fields for this step:

```json
{
  "backendKind": "pi_sdk_embedded",
  "state": "active",
  "health": "healthy",
  "heartbeatAt": "2026-03-14T12:00:00.000Z",
  "terminalSignal": null,
  "capabilities": {
    "supportsSteer": true,
    "supportsAttach": false
  }
}
```

- [ ] **Step 6: Run the embedded adapter test, the generic contract suite, and typecheck**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-embedded-adapter.test.ts packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-event-normalization.test.ts && npm run typecheck`
Expected: PASS, with embedded mode explicitly marked non-production and non-reattachable.

- [ ] **Step 7: Commit the embedded adapter**

```bash
git add packages/runtime-pi/package.json package-lock.json packages/runtime-pi/src/sdk/create-pi-sdk-session.ts packages/runtime-pi/src/adapters/pi-sdk-embedded-adapter.ts packages/runtime-pi/src/normalize/pi-sdk-events.ts packages/runtime-pi/src/index.ts packages/runtime-pi/src/cli/run-session-plan.ts packages/runtime-pi/test/pi-sdk-embedded-adapter.test.ts
git commit -m "feat: add embedded PI SDK runtime adapter"
```

### Task 10: Limit embedded mode to dev/test scopes and prove its artifact/control parity

**Files:**
- Modify: `config/system/runtime.yaml`
- Modify: `schemas/system/system.schema.json`
- Modify: `config/projects/spore.yaml`
- Modify: `packages/orchestrator/src/invocation/plan-workflow-invocation.ts`
- Modify: `services/orchestrator/test/http-policy.test.ts`
- Create: `packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts`
- Create: `packages/runtime-pi/test/pi-sdk-embedded-control.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-embedded-control.test.ts`

- [ ] **Step 1: Write failing tests that require embedded mode to be opt-in and to preserve control semantics**

```ts
assert.equal(invocation.launches[0].policy.runtimePolicy.backendKind, "pi_sdk_embedded");
assert.equal(live.json.diagnostics.supportsControl, true);
```

- [ ] **Step 2: Run the embedded-mode tests and verify policy/default gating is missing**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts packages/runtime-pi/test/pi-sdk-embedded-control.test.ts services/orchestrator/test/http-policy.test.ts`
Expected: FAIL because there is no dev/test-only gating and no embedded backend selection path yet.

- [ ] **Step 3: Add explicit backend policy rules so embedded mode is allowed only through opt-in dev/test policy, never as the default for real builder flows**

```yaml
runtimePolicy:
  defaultBackendKind: pi_rpc
developmentRuntime:
  providerFamily: pi
  backendKind: pi_sdk_embedded
testRuntime:
  providerFamily: pi
  backendKind: pi_sdk_embedded
```

Update `schemas/system/system.schema.json` in the same step so `npm run config:validate` understands these keys before any config file is changed.

- [ ] **Step 4: Verify embedded mode still emits durable transcript, handoff, `runtime-status.json`, `runtime-events.jsonl`, and `raw-events.jsonl`, and still accepts steer/abort through the generic control path**

Files to touch in this step only:
- `packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts`
- `packages/runtime-pi/test/pi-sdk-embedded-control.test.ts`
- `services/orchestrator/test/http-policy.test.ts`

Expected outcome:
- live route shows `backendKind: pi_sdk_embedded`,
- control ack remains generic,
- absence of tmux does not trigger failure,
- artifacts remain inspectable on disk.

- [ ] **Step 5: Run the embedded backend smoke/control tests plus the policy preview test**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts packages/runtime-pi/test/pi-sdk-embedded-control.test.ts services/orchestrator/test/http-policy.test.ts`
Expected: PASS, with embedded mode usable for local/test flows but not chosen as the production default.

- [ ] **Step 6: Commit embedded backend gating and parity tests**

```bash
git add config/system/runtime.yaml schemas/system/system.schema.json config/projects/spore.yaml packages/orchestrator/src/invocation/plan-workflow-invocation.ts services/orchestrator/test/http-policy.test.ts packages/runtime-pi/test/pi-sdk-embedded-smoke.test.ts packages/runtime-pi/test/pi-sdk-embedded-control.test.ts
git commit -m "feat: gate embedded PI SDK runtime to dev and test flows"
```

## Chunk 5: `pi_sdk_worker` Backend and Internal Protocol

### Task 11: Define and validate the internal worker protocol

**Files:**
- Modify: `packages/runtime-pi/package.json`
- Modify: `package-lock.json`
- Create: `packages/runtime-pi/src/worker/protocol.ts`
- Create: `packages/runtime-pi/test/pi-sdk-worker-protocol.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-worker-protocol.test.ts`

- [ ] **Step 1: Write a failing protocol test that validates command, response, and event envelopes with request IDs and protocol version**

```ts
test("worker protocol envelopes require protocolVersion and requestId", () => {
  const parsed = WorkerCommandSchema.parse({
    protocolVersion: "1",
    messageType: "command",
    requestId: "req-1",
    sessionId: "session-1",
    command: "session.start",
    timestamp: new Date().toISOString(),
    payload: {},
  });
  assert.equal(parsed.command, "session.start");
});
```

- [ ] **Step 2: Run the protocol test and verify it fails because the protocol module and `zod` dependency are missing**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-protocol.test.ts`
Expected: FAIL with missing dependency/module errors.

- [ ] **Step 3: Add `zod` and implement versioned protocol schemas and helper types**

```ts
export const WorkerCommandSchema = z.object({
  protocolVersion: z.literal("1"),
  messageType: z.literal("command"),
  requestId: z.string(),
  sessionId: z.string(),
  command: z.enum(["session.start", "session.control", "session.snapshot", "session.shutdown", "runtime.ping"]),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
```

- [ ] **Step 4: Add helpers for serializing protocol frames into a durable `.worker-protocol.ndjson` artifact**

- [ ] **Step 5: Run the protocol test and typecheck**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-protocol.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit the worker protocol contract**

```bash
git add packages/runtime-pi/package.json package-lock.json packages/runtime-pi/src/worker/protocol.ts packages/runtime-pi/test/pi-sdk-worker-protocol.test.ts
git commit -m "feat: add versioned PI SDK worker protocol"
```

### Worker protocol and liveness defaults

Use these exact defaults when implementing Tasks 12-13 so the worker path is deterministic and testable:

| Concern | Required value / rule |
|---|---|
| Transport | child process over stdio NDJSON |
| Protocol version | `1` |
| Command types | `session.start`, `session.control`, `session.snapshot`, `session.shutdown`, `runtime.ping` |
| Control kinds inside `session.control` | `steer`, `follow_up`, `prompt`, `abort` |
| Response envelope | `{ protocolVersion, messageType: "response", requestId, sessionId, ok, result|error }` |
| Event envelope | `{ protocolVersion, messageType: "event", eventId, sequence, sessionId, timestamp, eventType, snapshot, payload, rawRef }` |
| Heartbeat cadence | emit `runtime.heartbeat` every `1000ms` while active |
| Heartbeat timeout | mark degraded after `5000ms` without heartbeat |
| Idle grace | reuse `1500ms` default from the current RPC runner unless policy overrides it |
| Shutdown timeout | wait `5000ms`, then `SIGTERM`, then `SIGKILL`, then synthetic terminal artifact |
| Attach rule | only `pi_sdk_worker` may support attach across parent restarts in the first iteration |
| Crash classification | backend crash -> `runtime.error` + synthetic terminal signal with source `worker-crash` |

Canonical artifact matrix for all backends after Task 13:

| Artifact | `pi_rpc` | `pi_sdk_embedded` | `pi_sdk_worker` |
|---|---|---|---|
| `*.plan.json` | yes | yes | yes |
| `*.context.json` | yes | yes | yes |
| `*.transcript.md` | yes | yes | yes |
| `*.handoff.json` | yes | yes | yes |
| `*.control.ndjson` | yes | yes | yes |
| `*.launch-context.json` | yes | yes (synthetic compatibility file) | yes |
| `*.runtime-status.json` | yes | yes | yes |
| `*.runtime-events.jsonl` | yes | yes | yes |
| `*.raw-events.jsonl` | optional raw PI/RPC frames | yes | yes |
| `*.worker-protocol.ndjson` | no | no | yes |
| `*.rpc-status.json` | yes (legacy compatibility) | no | no |
| `*.pi-events.jsonl` | yes (legacy compatibility) | no | no |

### Task 12: Implement the worker entrypoint and parent-side worker adapter

**Files:**
- Create: `packages/runtime-pi/src/worker/pi-sdk-worker-main.ts`
- Create: `packages/runtime-pi/src/adapters/pi-sdk-worker-adapter.ts`
- Modify: `packages/runtime-pi/src/sdk/create-pi-sdk-session.ts`
- Modify: `packages/runtime-pi/src/index.ts`
- Modify: `packages/runtime-pi/src/cli/run-session-plan.ts`
- Modify: `packages/runtime-pi/src/cli/pi-session-plan.ts`
- Modify: `packages/runtime-pi/src/cli/pi-runtime-doctor.ts`
- Create: `packages/runtime-pi/test/pi-sdk-worker-adapter.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-worker-adapter.test.ts`

- [ ] **Step 1: Write a failing worker-adapter test that expects stdio NDJSON request/response plus streamed events**

```ts
test("pi_sdk_worker starts a child process and emits normalized runtime events", async () => {
  const adapter = createPiSdkWorkerAdapter();
  const binding = await adapter.start(request, hooks);
  assert.equal(binding.backendKind, "pi_sdk_worker");
});
```

- [ ] **Step 2: Run the worker-adapter test and verify it fails because neither the worker nor adapter exists**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-adapter.test.ts`
Expected: FAIL with missing adapter/worker entrypoint errors.

- [ ] **Step 3: Implement the worker main process over the protocol contract in `packages/runtime-pi/src/worker/pi-sdk-worker-main.ts`**

```ts
// stdin -> parse `session.start` / `session.control` / `session.snapshot` / `session.shutdown`
// invoke `createPiSdkSession(...)`
// stdout -> emit response frames and `runtime.*` event frames
```

- [ ] **Step 4: Implement the parent-side adapter with child-process spawn, command correlation, event streaming, `worker-protocol.ndjson` mirroring, and generic artifact emission**

```ts
const child = spawn(process.execPath, buildTsxEntrypointArgs(workerMainPath, []), {
  cwd: PROJECT_ROOT,
  stdio: ["pipe", "pipe", "pipe"],
});

await appendProtocolFrame(protocolPath, outgoingCommand);
child.stdout.on("data", handleWorkerFrames);
```

- [ ] **Step 5: Route `run-session-plan.ts`, `pi-session-plan.ts`, and `pi-runtime-doctor.ts` through the worker adapter when `backendKind === "pi_sdk_worker"` while keeping RPC and embedded untouched**

Expected outcome:
- `pi-session-plan.ts` can print worker-backed plan metadata,
- `pi-runtime-doctor.ts` can report worker protocol health,
- `run-session-plan.ts` can launch worker-backed sessions without any direct SDK imports outside the adapter/worker files.

- [ ] **Step 6: Run the worker adapter test plus the generic contract suite**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-adapter.test.ts packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-event-normalization.test.ts`
Expected: PASS for worker startup, command routing, and normalized event output.

- [ ] **Step 7: Commit the worker backend implementation**

```bash
git add packages/runtime-pi/src/worker/pi-sdk-worker-main.ts packages/runtime-pi/src/adapters/pi-sdk-worker-adapter.ts packages/runtime-pi/src/sdk/create-pi-sdk-session.ts packages/runtime-pi/src/index.ts packages/runtime-pi/src/cli/run-session-plan.ts packages/runtime-pi/src/cli/pi-session-plan.ts packages/runtime-pi/src/cli/pi-runtime-doctor.ts packages/runtime-pi/test/pi-sdk-worker-adapter.test.ts
git commit -m "feat: add PI SDK worker runtime adapter"
```

### Task 13: Add heartbeat, attach, shutdown, and failure recovery for worker mode

**Files:**
- Modify: `packages/runtime-pi/src/adapters/pi-sdk-worker-adapter.ts`
- Modify: `packages/runtime-pi/src/worker/pi-sdk-worker-main.ts`
- Modify: `packages/session-manager/src/reconcile/session-reconcile.ts`
- Modify: `services/session-gateway/server.ts`
- Create: `packages/runtime-pi/test/pi-sdk-worker-recovery.test.ts`
- Create: `packages/runtime-pi/test/pi-sdk-worker-chaos.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-worker-recovery.test.ts`
- Test: `packages/runtime-pi/test/pi-sdk-worker-chaos.test.ts`

- [ ] **Step 1: Write failing tests for heartbeats, attach-after-start, worker crash recovery, and graceful shutdown**

```ts
test("worker adapter records heartbeat loss and emits terminal synthetic failure on crash", async () => {
  // kill worker, assert runtime-status and reconcile path classify the failure
});
```

- [ ] **Step 2: Run the worker recovery tests and verify they fail because heartbeat and attach semantics are incomplete**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-recovery.test.ts packages/runtime-pi/test/pi-sdk-worker-chaos.test.ts`
Expected: FAIL around missing attach, heartbeat timeout, or zombie cleanup behavior.

- [ ] **Step 3: Add heartbeat events, timeout detection, and attach support to the worker adapter**

```ts
if (Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) {
  emitRuntimeError("liveness_timeout");
}
```

- [ ] **Step 4: Flush generic runtime status and synthetic terminal artifacts on worker crash so session-manager recovery remains artifact-first**

- [ ] **Step 5: Update the live route to expose worker protocol health without leaking raw SDK objects**

- [ ] **Step 6: Run the worker recovery tests, gateway live-route test, and targeted typecheck**

Run: `node --import=tsx --test packages/runtime-pi/test/pi-sdk-worker-recovery.test.ts packages/runtime-pi/test/pi-sdk-worker-chaos.test.ts services/session-gateway/test/live-route.test.ts && npm run typecheck`
Expected: PASS, with graceful shutdown and crash recovery now explicit and durable.

- [ ] **Step 7: Commit worker supervision hardening**

```bash
git add packages/runtime-pi/src/adapters/pi-sdk-worker-adapter.ts packages/runtime-pi/src/worker/pi-sdk-worker-main.ts packages/session-manager/src/reconcile/session-reconcile.ts services/session-gateway/server.ts packages/runtime-pi/test/pi-sdk-worker-recovery.test.ts packages/runtime-pi/test/pi-sdk-worker-chaos.test.ts
git commit -m "feat: harden PI SDK worker recovery and liveness"
```

## Chunk 6: Parity Matrix, Docs, and Rollout Defaults

### Task 14: Build the cross-backend parity and regression matrix

**Files:**
- Create: `packages/runtime-pi/test/runtime-backend-parity.test.ts`
- Modify: `packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.ts`
- Modify: `packages/test-support/src/e2e-harness.ts`
- Modify: `packages/runtime-pi/test/helpers/e2e-harness.ts`
- Modify: `packages/session-manager/src/events/event-log.ts`
- Modify: `packages/orchestrator/src/scenarios/run-history.ts`
- Modify: `services/session-gateway/test/real-pi-session-control.e2e.test.ts`
- Modify: `services/orchestrator/test/http-self-build-smoke.test.ts`
- Modify: `services/orchestrator/test/http-scenarios.test.ts`
- Modify: `apps/web/test/agent-cockpit-adapter.test.ts`
- Modify: `apps/web/test/mission-map-adapter.test.ts`
- Modify: `config/regressions/pi-canonical.yaml`
- Modify: `config/regressions/local-fast.yaml`
- Create: `config/regressions/runtime-backend-matrix.yaml`
- Test: `packages/runtime-pi/test/runtime-backend-parity.test.ts`

- [ ] **Step 1: Write a failing parity test that runs the same contract expectations against `pi_rpc`, `pi_sdk_embedded`, and `pi_sdk_worker`**

```ts
for (const backendKind of ["pi_rpc", "pi_sdk_embedded", "pi_sdk_worker"] as const) {
  test(`parity: ${backendKind}`, async () => {
    // run the same launch/control/snapshot/handoff expectations
  });
}
```

- [ ] **Step 2: Run the parity test and verify at least one backend still diverges**

Run: `node --import=tsx --test packages/runtime-pi/test/runtime-backend-parity.test.ts`
Expected: FAIL until all three backends emit equivalent normalized runtime behavior.

- [ ] **Step 3: Fix the remaining normalization and artifact mismatches in exact files until the parity test passes**

Files to touch in this step only:
- `packages/runtime-pi/src/normalize/pi-rpc-events.ts`
- `packages/runtime-pi/src/normalize/pi-sdk-events.ts`
- `services/session-gateway/server.ts`
- `packages/session-manager/src/events/event-log.ts`
- `packages/orchestrator/src/scenarios/run-history.ts`
- `apps/web/test/agent-cockpit-adapter.test.ts`
- `apps/web/test/mission-map-adapter.test.ts`

Expected outcome:
- session/event feeds carry equivalent normalized runtime events for all three backends,
- adapter-level web contracts remain stable before rendered-page tests run,
- parity no longer depends on launcher-specific branches.

- [ ] **Step 4: Update regression definitions and E2E harnesses so local and PI-backed regression suites can target the backend matrix explicitly**

Files to touch in this step only:
- `packages/test-support/src/e2e-harness.ts`
- `packages/runtime-pi/test/helpers/e2e-harness.ts`
- `config/regressions/pi-canonical.yaml`
- `config/regressions/local-fast.yaml`
- `config/regressions/runtime-backend-matrix.yaml`

Expected outcome:
- the harness can request `pi_rpc`, `pi_sdk_embedded`, or `pi_sdk_worker`,
- regression YAML can opt into a backend matrix without renaming existing suites,
- real-PI-only scenarios stay isolated.

- [ ] **Step 5: Run the parity test, targeted gateway-control E2E, and the self-build smoke test in the most stable backend combination available in the environment**

Run: `node --import=tsx --test packages/runtime-pi/test/runtime-backend-parity.test.ts`
Expected: PASS locally.

Optional extended checks when configured:
- `SPORE_RUN_PI_CONTROL_E2E=1 node --import=tsx --test services/session-gateway/test/real-pi-session-control.e2e.test.ts`
- `SPORE_RUN_PI_E2E=1 node --import=tsx --test services/orchestrator/test/http-self-build-smoke.test.ts`

Required scenario-history check in local mode:
- `node --import=tsx --test services/orchestrator/test/http-scenarios.test.ts`

- [ ] **Step 6: Commit the backend regression matrix**

```bash
git add packages/runtime-pi/test/runtime-backend-parity.test.ts packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.ts packages/test-support/src/e2e-harness.ts packages/runtime-pi/test/helpers/e2e-harness.ts packages/session-manager/src/events/event-log.ts packages/orchestrator/src/scenarios/run-history.ts services/session-gateway/test/real-pi-session-control.e2e.test.ts services/orchestrator/test/http-self-build-smoke.test.ts services/orchestrator/test/http-scenarios.test.ts apps/web/test/agent-cockpit-adapter.test.ts apps/web/test/mission-map-adapter.test.ts config/regressions/pi-canonical.yaml config/regressions/local-fast.yaml config/regressions/runtime-backend-matrix.yaml
git commit -m "test: add multi-backend PI runtime regression matrix"
```

### Task 15: Document the architecture, add ADRs, and set rollout defaults conservatively

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md`
- Modify: `docs/decisions/ADR-0015-pi-sdk-worker-transport.md`
- Modify: `docs/decisions/ADR-0016-runtime-artifact-parity.md`
- Modify: `docs/architecture/runtime-model.md`
- Modify: `docs/architecture/session-model.md`
- Modify: `docs/architecture/clients-and-surfaces.md`
- Modify: `docs/architecture/pi-integration-strategy.md`
- Modify: `docs/architecture/workflow-model.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/index/DOCS_INDEX.md`
- Modify: `docs/index/docs_manifest.yaml`
- Modify: `docs/plans/project-state-and-direction-handoff.md`
- Modify: `docs/plans/self-build-status-and-next-steps.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/runbooks/local-dev.md`
- Modify: `docs/research/pi-notes.md`
- Modify: `config/system/runtime.yaml`
- Modify: `schemas/system/system.schema.json`
- Modify: `config/projects/spore.yaml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `npm run docs-kb:index`
- Test: `npm run config:validate`

- [ ] **Step 1: Write the ADRs and docs updates before changing defaults**

```md
- ADR-0014: SPORE depends on a generic runtime adapter boundary, not PI CLI or PI SDK internals directly.
- ADR-0015: `pi_sdk_worker` uses stdio NDJSON as the initial internal protocol.
- ADR-0016: all runtime backends must emit durable generic runtime artifacts.
```

- [ ] **Step 2: Update the runbooks, architecture docs, docs index sources of truth, and current-direction plan docs to describe the three backend kinds, capability model, operational tradeoffs, and why this became an approved exception to the previous near-term roadmap**

- [ ] **Step 3: Keep production defaults conservative in config**

```yaml
primaryRuntime:
  providerFamily: pi
  backendKind: pi_rpc
developmentRuntime:
  providerFamily: pi
  backendKind: pi_sdk_embedded
candidateProductionRuntime:
  providerFamily: pi
  backendKind: pi_sdk_worker
```

- [ ] **Step 4: Add curated root test script entries and lockfile updates needed for the new runtime matrix without breaking existing command names**

- [ ] **Step 5: Run docs indexing, config validation, targeted typecheck, and the local curated test loop that should still pass in one session**

Run: `npm run docs-kb:index && npm run config:validate && npm run lint && npm run typecheck && npm run web:build && npm run test:web && npm run test:tui && npm run test:policy && npm run test:http && npm run test:workspace && node --import=tsx --test services/orchestrator/test/http-self-build.test.ts`
Expected: PASS, or explicit, narrow failures only in opt-in real-PI suites when PI is unavailable.

- [ ] **Step 6: Commit docs, ADRs, and conservative rollout defaults**

```bash
git add AGENTS.md docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md docs/decisions/ADR-0015-pi-sdk-worker-transport.md docs/decisions/ADR-0016-runtime-artifact-parity.md docs/architecture/runtime-model.md docs/architecture/session-model.md docs/architecture/clients-and-surfaces.md docs/architecture/pi-integration-strategy.md docs/architecture/workflow-model.md docs/INDEX.md docs/index/DOCS_INDEX.md docs/index/docs_manifest.yaml docs/plans/project-state-and-direction-handoff.md docs/plans/self-build-status-and-next-steps.md docs/plans/roadmap.md docs/runbooks/local-dev.md docs/research/pi-notes.md config/system/runtime.yaml schemas/system/system.schema.json config/projects/spore.yaml package.json package-lock.json
git commit -m "docs: record multi-backend PI runtime architecture"
```

## Parallel Work Windows

### Parallel window A: after Task 8 passes

- Keep one integrator lane as the sole owner of shared files:
  - `packages/runtime-pi/src/index.ts`
  - `packages/runtime-pi/src/cli/run-session-plan.ts`
  - `packages/runtime-pi/src/cli/pi-session-plan.ts`
  - `packages/runtime-pi/src/cli/pi-runtime-doctor.ts`
  - `packages/runtime-pi/package.json`
  - `package-lock.json`
  - `packages/runtime-pi/src/sdk/create-pi-sdk-session.ts`
  - `services/session-gateway/server.ts`
  - `config/system/runtime.yaml`
- Before spawning adapter-local subagents, the integrator lane lands the shared SDK/bootstrap prerequisite: dependency installs, `create-pi-sdk-session.ts`, export wiring, and CLI routing placeholders. Only after that commit should backend-local lanes branch off.
- Spawn Subagent 1 for Task 9 adapter-local embedded files only.
- Spawn Subagent 2 for Task 11 protocol-only files.
- Do not reopen Task 7 in parallel here; any post-parity gateway/UI cleanup remains owned by the integrator lane.

### Parallel window B: after Task 11 passes

- Subagent 1 continues with Task 10 adapter-local embedded parity tests.
- Subagent 2 continues with Task 12 adapter-local worker files.
- The integrator lane owns all required merges into `run-session-plan.ts`, CLI surfaces, gateway surfaces, and package manifests.
- Primary/integrator can start Task 14 harness and regression scaffolding once both adapters compile.

### Parallel window C: after Tasks 10 and 13 pass

- One subagent updates docs/ADRs (Task 15 draft only).
- One subagent expands regression fixtures and CI-facing tests (Task 14 follow-through).
- Primary agent keeps ownership of final config defaults, schema updates, and the last verification loop.

## Final Verification Gate For The Long Session

Before declaring the migration session complete, run this exact sequence from the repo root:

```bash
npm run docs-kb:index
npm run config:validate
npm run lint
npm run typecheck
npm run web:build
npm run test:web
npm run test:tui
npm run test:policy
npm run test:http
npm run test:workspace
node --import=tsx --test services/orchestrator/test/http-self-build.test.ts
node --import=tsx --test services/orchestrator/test/http-scenarios.test.ts
node --import=tsx --test packages/runtime-pi/test/runtime-backend-contract.test.ts packages/runtime-pi/test/runtime-backend-parity.test.ts
```

Expected:

- docs index rebuild succeeds,
- config validation succeeds,
- lint succeeds,
- typecheck succeeds,
- web build succeeds,
- curated web tests pass,
- curated TUI tests pass,
- curated local policy/HTTP/workspace suites pass,
- targeted self-build HTTP regression passes,
- targeted scenario-history HTTP regression passes,
- runtime backend contract/parity tests pass,
- any real-PI smoke/control suites either pass or skip explicitly when PI is unavailable.

## Rollback Notes

- If Task 9 or later destabilizes runtime behavior, set the effective default backend back to `pi_rpc` in `config/system/runtime.yaml` and keep the SDK adapters behind explicit opt-in policy.
- If worker protocol behavior is unreliable, keep the protocol files and tests, but disable `pi_sdk_worker` selection in config rather than deleting the code.
- Do not remove legacy artifacts (`*.pi-events.jsonl`, `*.rpc-status.json`, `*.launch.sh`) until all client surfaces and session recovery paths have been proven against the generic runtime artifacts.
