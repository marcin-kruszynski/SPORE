# JavaScript to TypeScript Migration Plan

## Purpose

This plan defines the complete migration of SPORE first-party code from JavaScript to TypeScript in three phases.

The migration must:

- end with all first-party source and test code under `apps/`, `packages/`, and `services/` moved to TypeScript,
- preserve the current Node 24, npm, PI-first, tmux-backed runtime model,
- avoid a risky runtime swap to Bun during the migration,
- keep the repository runnable at the end of each phase,
- finish with a full verification pass and a fix-until-green loop that does not stop until every required test passes.

## Current Baseline

The repository is already structured like a monorepo, but it is still implemented as plain ESM JavaScript.

Observed baseline from the current tree:

- 73 first-party `.js` files across `apps/`, `packages/`, and `services/`
- 0 first-party `.ts` or `.tsx` files in those same execution paths
- no root `tsconfig.json` or package-level TypeScript project configuration
- no workspace-aware package management configuration in the root `package.json`
- root scripts execute source files directly with `node`
- tests rely on `node --test`
- SQLite access relies on `node:sqlite`
- many package boundaries are crossed with deep relative imports into another package's `src/` tree
- several hot spots are already large enough that migration should include modularization work, especially:
  - `apps/web/public/app.js`
  - `packages/orchestrator/src/execution/workflow-execution.js`
  - `packages/orchestrator/src/store/execution-store.js`
  - `packages/orchestrator/src/self-build/self-build.js`

Current first-party JavaScript footprint by area:

- `packages/runtime-pi`: 18 files
- `packages/orchestrator`: 16 files
- `services/orchestrator`: 8 files
- `packages/docs-kb`: 8 files
- `packages/session-manager`: 6 files
- `packages/config-schema`: 4 files
- `services/session-gateway`: 4 files
- `apps/web`: 4 files
- `packages/workspace-manager`: 3 files
- `packages/tui`: 2 files

## Migration Outcome Required at the End

At the end of phase 3, the target state is:

- all first-party runtime code is `.ts` or `.tsx`
- all first-party tests are `.ts` or `.tsx`
- root and package-level TypeScript configuration exists and is enforced
- package boundaries are expressed through workspace packages and public exports, not deep `src/` path imports
- shared contracts live in reusable typed modules instead of being reconstructed ad hoc in each package
- the browser operator surface is split into maintainable TypeScript modules instead of one oversized script
- `allowJs` is disabled for first-party source trees
- the verification matrix is green, including runtime, session, gateway, orchestrator, TUI, and PI smoke coverage

Generated assets may still be JavaScript when produced by a build step, but first-party source-of-truth code must no longer live as `.js` in `apps/`, `packages/`, or `services/`.

## Explicit Decisions Before Starting

These decisions should be treated as fixed migration constraints unless a later ADR changes them deliberately.

1. Keep `Node >= 24` as the canonical runtime throughout the migration.
2. Keep `npm` as the canonical package manager during the migration.
3. Do not adopt Bun as the primary runtime in this plan because the codebase depends on `node:sqlite` and `node:test`, and Bun does not fully match those APIs today.
4. Keep the repository ESM-first.
5. Prefer `typescript` + `tsx` + `node --test` integration over introducing a separate transpile-only dev runtime.
6. Use TypeScript `NodeNext` module settings so emitted behavior matches the current Node ESM model.
7. Preserve `.js` import specifiers inside TypeScript source when importing local ESM modules so Node-compatible output remains stable after emit.
8. Treat shared workflow/session/orchestrator payloads as first-class contracts and centralize them in typed packages.

## Non-Goals

This plan does not include:

- replacing Node with Bun,
- rewriting the architecture away from PI-first runtime execution,
- replacing SQLite storage with a different database,
- rebuilding the web UI in a new frontend framework unless a later decision explicitly expands scope,
- changing product boundaries beyond what is needed to make the TypeScript migration clean and maintainable.

## Migration Principles

The migration should follow these rules in every phase.

### 1. No Big-Bang Rewrite

Move package by package, with the repo staying runnable after each package group is migrated.

### 2. Tighten Boundaries While Migrating

Do not mechanically rename files and keep all existing cross-package leakage. Each phase should remove deep `../../../other-package/src/...` imports and replace them with exported package APIs.

### 3. Type Contracts First, Helpers Second

Shared types for workflow states, session records, API payloads, scenario/regression results, and workspace allocations should be created before large consumers are migrated.

### 4. Keep Runtime Validation Real

Do not let the migration become a purely compile-time exercise. The PI-backed, tmux-backed, session and orchestrator smoke flows stay mandatory.

### 5. Phase Exit Means Green

No phase is complete while the phase verification commands are failing.

### 6. Fix-Until-Green at the End

The migration is not done when files are renamed. It is done only when the full validation matrix passes and any regressions uncovered by TypeScript are fixed.

## Recommended Technical Shape

Use this target technical shape for the migration.

### Repository Tooling

- add root `tsconfig.base.json`
- add root solution `tsconfig.json` with project references
- add package-level `tsconfig.json` files for each executable package/app/service
- add local dev dependencies:
  - `typescript`
  - `tsx`
  - `@types/node`
  - `@biomejs/biome`
- add root scripts such as:
  - `typecheck`
  - `typecheck:watch`
  - `lint`
  - `format`
  - `format:check`
- update test scripts to run TypeScript through Node-compatible loading, preferably with `node --import=tsx --test`

### Package Boundaries

- add npm workspaces to the root `package.json`
- add package `exports` fields so consumers import package APIs rather than package internals
- use `packages/shared-types/` for stable DTOs, enums, discriminated unions, and API shapes
- use `packages/core/` for reusable core identifiers and contracts that are not specific to one runtime slice

### TypeScript Compiler Defaults

Recommended baseline compiler flags:

- `target: ES2023`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- `verbatimModuleSyntax: true`
- `strict: true`
- `noImplicitOverride: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `forceConsistentCasingInFileNames: true`
- `resolveJsonModule: true`
- `declaration: true` for shared packages
- `allowJs: true` only during transition, then disabled in phase 3
- `checkJs: true` only during transition, then removed in phase 3

### Browser Operator Surface

`apps/web/public/app.js` should not be migrated as one giant TypeScript file. Split it into modules before or during conversion, for example:

- `apps/web/src/state.ts`
- `apps/web/src/api/*.ts`
- `apps/web/src/views/*.ts`
- `apps/web/src/render/*.ts`
- `apps/web/src/events/*.ts`
- `apps/web/src/utils/*.ts`

If a build step is introduced for browser TypeScript, prefer a small modern toolchain with minimal moving parts. `Vite` is the preferred option if bundling becomes necessary for maintainability. If the team wants to avoid a bundler, a smaller TypeScript-to-browser pipeline is acceptable, but modularization is still mandatory.

## Scope Map by Phase

### Phase 1: Foundation and Shared Contracts

Primary areas:

- root repo configuration
- package boundaries and workspace setup
- `packages/shared-types/`
- `packages/core/`
- `packages/config-schema/`
- `packages/docs-kb/`
- `packages/workspace-manager/`

### Phase 2: Core Runtime and Service Migration

Primary areas:

- `packages/session-manager/`
- `packages/runtime-pi/`
- `packages/orchestrator/`
- `services/session-gateway/`
- `services/orchestrator/`

### Phase 3: Operator Surfaces, Cleanup, and Enforcement

Primary areas:

- `packages/tui/`
- `apps/web/`
- remaining tests and helpers
- removal of transitional JavaScript support
- final docs and verification closure

## Phase 1 - Foundation and Shared Contracts

### Objective

Establish the TypeScript toolchain, formalize package boundaries, create shared contracts, and migrate the lowest-risk packages first.

### Why This Phase Comes First

The later backend packages depend heavily on shared payloads, Node ESM behavior, and deep cross-package imports. If TypeScript is introduced without first stabilizing repo-wide conventions, the team will accumulate compiler workarounds instead of durable structure.

### Deliverables

- root TypeScript configuration and scripts
- npm workspace configuration
- public package exports for migrated packages
- first shared contract modules in `packages/shared-types/` and `packages/core/`
- TypeScript migration of:
  - `packages/config-schema/`
  - `packages/docs-kb/`
  - `packages/workspace-manager/`
- targeted tests green for migrated areas

### Detailed Work

#### 1. Root Tooling Setup

- add npm workspaces covering `apps/*`, `packages/*`, and `services/*`
- add root `devDependencies` for TypeScript, `tsx`, Biome, and Node types
- add root `tsconfig.base.json`
- add root solution `tsconfig.json`
- add root scripts:
  - `typecheck`
  - `lint`
  - `format`
  - `format:check`
  - updated test scripts that can run `.ts` files through Node
- decide whether builds are emitted package-by-package with `tsc -b` or source is executed directly through `tsx`; document the chosen path and keep it consistent

#### 2. Transitional Compiler Mode

- enable `allowJs: true` and `checkJs: true` in the shared config
- turn on strict mode immediately instead of postponing it
- let untouched JavaScript files participate in type-checking during transition so hidden problems surface early
- add `exclude` rules for generated outputs, `tmp/`, `.spore/`, `references/`, and any future `dist/` folders

#### 3. Package Boundary Cleanup Before Heavy Migration

- add `exports` to each package that is migrated in this phase
- stop importing from another package's `src/` tree when a stable exported function or type should exist
- define the first public API surfaces for:
  - config loading and validation
  - docs knowledge base indexing/search primitives
  - workspace creation/inspection/reconciliation contracts
- reserve `packages/shared-types/` for payload shapes, record types, and union states
- reserve `packages/core/` for stable identifiers and non-runtime-specific concepts

#### 4. Create Shared Types and Utility Contracts

At minimum, create reusable TypeScript definitions for:

- workflow state enums and discriminated unions
- session record shapes and session state values
- scenario run and regression run summaries
- workspace allocation records and status values
- API response envelopes used by gateway and orchestrator surfaces
- common timestamps, IDs, and metadata wrappers

This work should start small. Do not attempt to model the entire system at once. Focus on the shared contracts that phase 2 will immediately consume.

#### 5. Migrate `packages/config-schema/`

Specific expectations:

- rename source and test files to `.ts`
- type parsed YAML/config payloads
- add explicit validation result types
- remove weak `any` flows from schema loading and validation helpers
- expose typed config parser/validator entrypoints through package exports

#### 6. Migrate `packages/docs-kb/`

Specific expectations:

- type SQLite row mappings and search result payloads
- type embedding provider registry contracts
- type chunking and metadata helper inputs/outputs
- type CLI option parsing and CLI result payloads
- expose stable public types for search results and index status so later services do not reconstruct them loosely

#### 7. Migrate `packages/workspace-manager/`

Specific expectations:

- type workspace creation input, workspace summary output, cleanup and reconcile payloads
- type git command result parsing and workspace diagnostics
- expose typed public helpers for creation, inspection, cleanup, and reconcile operations
- keep compatibility with the existing git worktree model and operator governance rules

#### 8. Update Documentation During the Phase

- update developer-facing instructions for new TypeScript commands
- document import-extension rules for Node ESM + TypeScript
- document how to run migrated tests under Node
- keep docs indices synchronized for any new migration documents or tooling docs

### Verification Gate

At the end of phase 1, run at minimum:

```bash
npm run typecheck
npm run config:validate
npm run docs-kb:index
npm run test:workspace
```

If phase 1 changes touch docs-kb internals materially, also run any direct docs-kb smoke commands needed to prove indexing and search behavior still works.

### Exit Criteria

Phase 1 is complete only when all of the following are true:

- root TypeScript configuration exists and is used
- migrated packages compile and run through the selected TS execution path
- shared types package exists and is used by at least one migrated package
- workspace package imports no longer rely on deep cross-package `src` paths where a public API should exist
- phase 1 verification commands are green

### Risks and Mitigations

- Risk: Node ESM + TypeScript import resolution confusion
  - Mitigation: standardize on `NodeNext` and keep `.js` import specifiers in source
- Risk: strict typing exposes many existing shape mismatches at once
  - Mitigation: migrate smaller packages first and centralize shared DTOs early
- Risk: workspace setup changes package resolution unexpectedly
  - Mitigation: update one package boundary at a time and verify imports after each package cutover

### Estimated Effort

- 1 to 2 weeks for one engineer
- 0.5 to 1 week with two engineers if one owns tooling/contracts and the other owns package conversion

## Phase 2 - Core Runtime and Service Migration

### Objective

Migrate the operational core of SPORE to TypeScript: session lifecycle, PI runtime integration, orchestrator execution logic, and the shared HTTP services.

### Why This Phase Is the Hardest

This phase contains the most integration-heavy code, the largest files, the deepest cross-package coupling, the most durable state, and the highest risk of runtime regressions. It is also the phase where TypeScript will pay off the most because SPORE is fundamentally a system of state machines, payload contracts, and cross-surface coordination.

### Deliverables

- TypeScript migration of:
  - `packages/session-manager/`
  - `packages/runtime-pi/`
  - `packages/orchestrator/`
  - `services/session-gateway/`
  - `services/orchestrator/`
- typed public contracts for gateway and orchestrator HTTP payloads
- large orchestrator modules split into maintainable TypeScript units
- deep relative imports replaced with workspace package imports wherever possible
- backend validation and smoke flows green

### Detailed Work

#### 1. Migrate `packages/session-manager/`

Specific expectations:

- type session store records, metadata records, event log records, and control history payloads
- type CLI flags and output payloads
- type all file-system and SQLite interactions at the boundary
- centralize session status unions so gateway, TUI, and orchestrator all consume the same state vocabulary

#### 2. Migrate `packages/runtime-pi/`

Specific expectations:

- define runtime launcher interfaces and result types
- type PI JSON runner events and PI RPC event payloads as discriminated unions
- type startup context construction, launch metadata, control queue entries, and runtime doctor outputs
- type tmux launcher helpers and command results
- make environment-variable access explicit and typed

#### 3. Migrate `packages/orchestrator/`

This package should not be converted as one large rename. It should be decomposed while being migrated.

Required decomposition targets include at least:

- workflow execution lifecycle logic
- workspace allocation helpers
- execution tree and family coordination logic
- governance transitions and review/approval helpers
- scenario and regression run helpers
- self-build read/write helpers
- typed SQLite row mappers and DAO helpers

Mandatory cleanup targets:

- split `workflow-execution.js` into several smaller TypeScript modules by responsibility
- split `execution-store.js` into typed store layers or grouped DAO modules where sensible
- replace broad object bags with named interfaces and discriminated unions
- encode workflow, step, escalation, review, approval, and audit states as explicit types rather than loosely shaped objects
- move reusable execution/session/shared payload types into `packages/shared-types/` when they are used by more than one package or surface

#### 4. Migrate `services/session-gateway/`

Specific expectations:

- type request parsing and route params
- type response payloads for status, sessions, session live, artifacts, stream endpoints, and control operations
- type SSE event payloads
- consume shared session and runtime types instead of reconstructing payloads inline

#### 5. Migrate `services/orchestrator/`

Specific expectations:

- type all workflow plan/invoke routes
- type execution list/detail/tree/history payloads
- type review, approval, pause, hold, resume, escalation, work-item, goal-plan, workspace, and proposal routes
- type run-center and self-build dashboard responses
- ensure the service reuses shared DTOs from orchestrator/session packages instead of defining route-local shapes ad hoc

#### 6. Replace Deep Relative Imports With Public Package APIs

This is mandatory during phase 2, not optional cleanup for later.

The goal is to stop patterns like direct imports into another package's `src/` tree when the imported value is part of a real dependency contract. By the end of phase 2:

- services should import runtime/session/orchestrator APIs through package names or clearly exported entrypoints
- packages should expose typed public APIs for cross-package use
- test helpers should import through public APIs unless the test is deliberately white-boxing internal behavior inside the same package

#### 7. Standardize Backend Runtime Scripts

- update root scripts to run migrated TypeScript entrypoints consistently
- ensure CLI commands still match the existing operational contract documented in `README.md`, `docs/runbooks/local-dev.md`, and `.pi/SYSTEM.md` if command behavior changes
- keep `node:sqlite` and `node:test` based execution intact

#### 8. Backfill Missing Type Coverage Found During Migration

Expect TypeScript to reveal weak areas in:

- JSON parsing and stringification boundaries
- SQLite row deserialization
- CLI flag parsing
- union state handling for workflow/session/escalation status
- optional payload fields in service responses

Do not suppress these findings with blanket `any` or broad non-null assertions unless there is a documented reason.

### Verification Gate

At the end of phase 2, run at minimum:

```bash
npm run typecheck
npm run docs-kb:index
npm run config:validate
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --session-id smoke-001 --run-id smoke-001
npm run session:status
npm run test:policy
npm run test:http
npm run test:workspace
```

If `pi` is installed but not visible in `PATH`, use the documented override before runtime validation:

```bash
export SPORE_PI_BIN="${SPORE_PI_BIN:-$(npm prefix -g)/bin/pi}"
```

If `pi` is unavailable, the team must say so explicitly and verify what ran against the stub path versus the real runtime path.

### Exit Criteria

Phase 2 is complete only when all of the following are true:

- the runtime, session, orchestrator, and service packages are in TypeScript
- shared HTTP payload types are centralized instead of duplicated loosely in services and clients
- deep cross-package `src` imports are removed where a public API should exist
- the phase 2 verification gate is green
- the largest backend files have been materially reduced or decomposed instead of simply renamed

### Risks and Mitigations

- Risk: migration changes runtime behavior in PI or tmux flows
  - Mitigation: keep real runtime smoke tests in the gate, not only compile checks
- Risk: large orchestrator modules become harder to migrate because they are too coupled
  - Mitigation: split by responsibility before typing every branch in place
- Risk: service payload typing exposes inconsistent field semantics
  - Mitigation: normalize DTOs in shared packages and update consumers together
- Risk: package exports break tests that relied on internals
  - Mitigation: separate intentional internal tests from accidental deep-import usage

### Estimated Effort

- 2 to 4 weeks for one engineer
- 1.5 to 3 weeks with two engineers if one focuses on runtime/session and the other on orchestrator/services

## Phase 3 - Operator Surfaces, Final Cutover, and Enforcement

### Objective

Finish the migration by converting the remaining operator-facing code, removing transitional JavaScript support, hardening the repository rules, and proving the entire system still works end to end.

### Deliverables

- TypeScript migration of:
  - `packages/tui/`
  - `apps/web/`
  - any remaining tests, helpers, or entrypoints under `apps/`, `packages/`, and `services/`
- modular TypeScript browser operator surface replacing the oversized `public/app.js`
- removal of `allowJs` and other transitional compatibility settings
- zero first-party source `.js` files remaining in `apps/`, `packages/`, and `services/`
- full validation matrix green

### Detailed Work

#### 1. Migrate `packages/tui/`

Specific expectations:

- type API client payloads used by the TUI
- type CLI flags, rendering helpers, and JSON parsing boundaries
- consume shared orchestrator/session DTOs instead of loose inline parsing

#### 2. Migrate `apps/web/`

This area needs both migration and structural cleanup.

Required work:

- migrate `apps/web/server.js` to `apps/web/server.ts`
- replace `apps/web/public/app.js` with a modular TypeScript source tree
- type state models for sessions, executions, scenarios, regressions, work items, proposals, and dashboard views
- type API client functions and route payloads
- isolate rendering, state management, event wiring, and formatting helpers into separate modules
- ensure browser build or load strategy is documented and repeatable
- keep the existing shared HTTP surface model intact; do not add ad hoc file reads to avoid typing API gaps

Recommended module layout:

- `apps/web/src/main.ts`
- `apps/web/src/state/*.ts`
- `apps/web/src/api/*.ts`
- `apps/web/src/views/*.ts`
- `apps/web/src/render/*.ts`
- `apps/web/src/events/*.ts`
- `apps/web/src/lib/*.ts`

#### 3. Migrate Remaining Tests and Helpers

- convert any remaining `*.test.js` and helper scripts under first-party trees
- keep test naming aligned with current discovery patterns or update scripts accordingly
- ensure fixtures and snapshots, if introduced later, are typed and documented

#### 4. Remove Transitional JavaScript Support

Once all first-party source is migrated:

- set `allowJs: false`
- remove `checkJs` transitional behavior if no longer needed
- tighten compiler rules where the repo is ready
- add repo checks that fail if new first-party `.js` source files are introduced in migrated trees
- update package scripts, entrypoints, and bins so TypeScript is now the canonical source-of-truth path

#### 5. Update Docs and Operator Instructions

Before closing the phase:

- update `README.md`
- update `docs/runbooks/local-dev.md`
- update `.pi/SYSTEM.md` if operator commands or execution expectations changed
- update `AGENTS.md` only if environment assumptions or required workflows changed
- update docs indices and manifest for any new docs created during the migration

#### 6. Validate for Hidden Runtime Regressions

Phase 3 must include explicit checks for:

- route payload compatibility between services, TUI, and web
- PI launcher behavior and session lifecycle persistence
- workspace-backed self-build flows
- orchestrator review/approval/escalation flows
- run-center and self-build dashboard rendering

### Verification Gate

At the end of phase 3, run the full validation matrix from an isolated state path when possible:

```bash
export SPORE_ORCHESTRATOR_DB_PATH=/tmp/spore-orchestrator.sqlite
export SPORE_SESSION_DB_PATH=/tmp/spore-sessions.sqlite
export SPORE_EVENT_LOG_PATH=/tmp/spore-events.ndjson

npm run typecheck
npm run lint
npm run format:check
npm run docs-kb:index
npm run config:validate
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --session-id smoke-001 --run-id smoke-001
npm run session:status
npm run gateway:start
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer --objective "Lead should produce one sentence; reviewer should return approve, revise, or reject." --wait
npm run test:policy
npm run test:http
npm run test:web
npm run test:tui
npm run test:workspace
npm run test:e2e:pi
```

If the real PI suite is intended, run the opt-in smoke path as well:

```bash
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

### Exit Criteria

Phase 3 is complete only when all of the following are true:

- there are no first-party `.js` source files left in `apps/`, `packages/`, or `services/`
- transitional compiler settings have been removed
- TUI and web consume shared typed contracts cleanly
- full validation matrix is green
- documentation reflects the TypeScript-first development workflow

### Risks and Mitigations

- Risk: browser operator surface migration turns into a frontend rewrite
  - Mitigation: keep the same UX contract and shared gateway/orchestrator API model; change implementation structure, not product scope
- Risk: hidden client/service payload drift appears only after web or TUI migration
  - Mitigation: share DTOs and run client-level tests plus HTTP tests before final cutover
- Risk: final strictness settings create a large cleanup tail
  - Mitigation: enable strictness early in phase 1 and pay down issues continuously rather than deferring all cleanup to the end

### Estimated Effort

- 2 to 3 weeks for one engineer
- 1 to 2 weeks with two engineers if frontend/TUI and final hardening are split

## Final Full-Test and Fix-Until-Green Loop

This is mandatory. It is not optional cleanup.

After phase 3 code conversion is complete, execute the full validation matrix. If any test, smoke run, typecheck, or runtime validation fails, the team must enter a repair loop and stay in that loop until everything passes.

Use this exact operating rule:

1. Run the full verification matrix.
2. If a command fails, identify the smallest failing package, service, route, or runtime slice.
3. Fix the failure at the source.
4. Re-run the narrowest failing test or smoke command until it passes.
5. Re-run the broader suite that contains it.
6. Re-run the full matrix.
7. Repeat until every required command is green.

Do not declare the migration complete while any required check is red.

## Suggested Failure Triage Order During the Repair Loop

When failures happen, repair them in this order so the feedback loop stays efficient:

1. `npm run typecheck`
2. package-local failing tests
3. `npm run test:workspace`
4. `npm run test:policy`
5. `npm run test:http`
6. `npm run test:web`
7. `npm run test:tui`
8. runtime smoke commands
9. PI end-to-end smoke tests

## Repository-Level Done Definition

The migration is done only when all of the following statements are true:

- SPORE is TypeScript-first across all first-party source trees
- Node/npm remains the documented and working runtime baseline
- package boundaries are cleaner than before the migration, not merely renamed
- backend, TUI, and web all share typed contracts for the data they exchange
- documentation matches the new workflow
- the full test and smoke matrix passes
- any failures found during the final matrix were fixed and re-tested until green

## Rough Total Effort

Expected total effort:

- 5 to 9 weeks for one engineer depending on how much orchestrator decomposition happens in parallel with migration
- 3 to 5 weeks with two engineers and disciplined package ownership

The upper end is the more realistic estimate if the team also uses the migration to improve package boundaries, reduce oversized files, and tighten API contracts instead of doing a risky rename-only conversion.
