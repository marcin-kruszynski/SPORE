# JavaScript to TypeScript Migration Plan

## Status

- Status: Completed
- Completed on: 2026-03-10
- Canonical decision: `docs/decisions/ADR-0008-typescript-first-codebase.md`

## Purpose

This document records the final repository shape produced by the JavaScript-to-TypeScript migration and the verification loop that keeps that TypeScript-first shape intact.

## Final Repository State

As of 2026-03-10, the repository has crossed the migration boundary:

- first-party source and test code under `apps/`, `packages/`, and `services/` is authored in TypeScript
- the current tree contains 130 first-party `.ts` or `.tsx` files in those execution paths
- the current tree contains 2 first-party `.js` files in those execution paths, both under `apps/web/public/` and both generated browser assets emitted by `npm run web:build`
- root and package-level TypeScript project configuration exists:
  - `tsconfig.base.json`
  - `tsconfig.json`
  - package/app/service `tsconfig.json` files
  - `apps/web/tsconfig.browser.json` for browser emit
- root `package.json` defines npm workspaces for `apps/*`, `packages/*`, and `services/*`
- first-party workspace packages publish local `exports` entrypoints
- `npm run typecheck` passes against the root TypeScript project

Generated JavaScript remains acceptable only as build output. Hand-authored first-party source-of-truth code should continue to live in TypeScript.

## Canonical Execution Model

The final TypeScript-first execution model is mixed by target, not by language ownership:

- Node-side CLIs and services run directly from TypeScript source via `tsx`
  - examples: `npm run runtime-pi:run`, `npm run gateway:start`, `npm run orchestrator:start`, `npm run ops:dashboard`
- tests run under Node's test runner with TS loading enabled via `node --import=tsx --test`
- the browser app is authored in TypeScript under `apps/web/src/` and emitted into `apps/web/public/` via `npm run web:build`
- `npm run web:start` is the canonical web entrypoint because it builds browser assets and then serves them through `tsx apps/web/server.ts`

## Compiler and Build Profile

Current shared compiler posture:

- `target: ES2023`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- `verbatimModuleSyntax: true`
- `resolveJsonModule: true`
- `declaration: true`
- `declarationMap: true`
- `sourceMap: true`
- `forceConsistentCasingInFileNames: true`

Current compatibility choices that are still part of the final TS-first setup:

- root `tsconfig.base.json` keeps `allowJs: false` and `checkJs: false`
- root `tsconfig.base.json` is not yet in full strict mode (`strict: false`)
- browser emit under `apps/web/tsconfig.browser.json` turns `allowJs` and `checkJs` off and emits plain JavaScript into `apps/web/public/`
- no first-party files under `apps/`, `packages/`, or `services/` currently rely on `// @ts-nocheck`

In this repository, TS-first means TypeScript is the canonical source language and tooling path. It does not currently mean every file is under strict static checking.

## Package Boundary Outcome

The migration established the intended package structure:

- shared contracts and identifiers live in `packages/shared-types/`, `packages/core/`, and `packages/test-support/`
- most cross-package consumers now import through `@spore/*` workspace packages
- package manifests expose `exports` entrypoints for public APIs

The boundary cleanup is improved but not absolute:

- reusable cross-package test harnesses now flow through `@spore/test-support` instead of ad hoc sibling `test/helpers/*` imports
- some internal or white-box imports still reach into sibling `src/` trees inside the same package or in a few remaining internal runtime/orchestrator seams
- those imports should be treated as implementation debt, not as the recommended repository pattern
- the first post-migration hardening pass already moved remaining cross-package test imports toward `@spore/*` and `@spore/test-support`, but it did not yet eliminate every deep import or every broad JSON-shaped type
- the second post-migration hardening pass replaced several broad `any`-based JSON helpers in the web app, TUI, and orchestrator planning/read-model layers with `@spore/shared-types` `JsonObject` contracts
- the third post-migration hardening pass introduced smaller typed helper modules for orchestrator failure descriptors, classification counts, report-path normalization, dependency-state handling, and workspace list filters instead of attempting a risky repo-wide `any` removal in one sweep
- the fourth post-migration hardening pass continued the DTO-first approach by extracting workflow event/promotion payload helpers, SQLite row mappers for workflow event and audit reads, and self-build attention/summary helpers instead of widening strictness changes across the whole orchestrator package in one shot

## Phase Outcome Summary

### Phase 1: Foundation and Shared Contracts

Completed outcomes:

- root TypeScript toolchain landed
- npm workspaces landed
- `packages/shared-types/` and `packages/core/` became the shared contract anchors
- `packages/config-schema/`, `packages/docs-kb/`, and `packages/workspace-manager/` moved to TypeScript

### Phase 2: Core Runtime and Service Migration

Completed outcomes:

- `packages/session-manager/`, `packages/runtime-pi/`, and `packages/orchestrator/` moved to TypeScript
- `services/session-gateway/` and `services/orchestrator/` now run from TypeScript entrypoints
- Node-side tests and HTTP surfaces use TypeScript-aware execution paths
- runtime, session, gateway, orchestrator, and self-build flows now share typed repository contracts

### Phase 3: Operator Surfaces and Final Cutover

Completed outcomes:

- `packages/tui/` and `apps/web/` use TypeScript as the canonical source language
- `apps/web/server.ts` replaced the old JavaScript server entrypoint
- browser assets are emitted from `apps/web/src/*.ts` into `apps/web/public/`
- root docs and operator instructions now describe TS-first development as the default workflow

Current caveats carried into the completed state:

- the web client is TypeScript-authored but is still concentrated mostly in `apps/web/src/main.ts`
- strict-mode hardening and cleanup of remaining deep package-boundary imports remain incremental follow-up work rather than prerequisites for TS-first status
- some integration and TUI helper paths still intentionally use loose JSON envelopes for readability; those are now localized to harness boundaries rather than spread through production packages

Recent post-migration hardening work has also:

- extracted more orchestrator helper modules for execution metadata, wave-state evaluation, proposal artifact assembly, and entity row mapping
- reduced inline bag-assembly inside `workflow-execution`, `execution-store`, and `self-build`
- stabilized heavy HTTP/TUI integration suites with stronger subprocess teardown semantics
- introduced explicit orchestrator module facades for execution history/promotion/governance/coordination/runtime-launch, store DAO areas, and self-build domains so future work no longer has to grow the old monolithic files directly

## Final Adaptation Checkpoint

The last large old-code adaptation batch is now complete:

- `workflow-execution`, `execution-store`, and `self-build` no longer act as the only public implementation surfaces for their domains
- their responsibility areas are now split behind explicit execution, store, and self-build module boundaries
- remaining follow-up work is normal iterative hardening, not migration cleanup

The next planned work should therefore return to new SPORE capabilities, especially supervised self-build behavior, rather than more repository-wide TypeScript migration work.

## Ongoing Verification Baseline

Use this as the minimum ongoing verification loop for TypeScript-first work:

```bash
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
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer --objective "Lead should produce one sentence; reviewer should return approve, revise, or reject." --wait
npm run test:policy
npm run test:http
npm run test:web
npm run test:tui
npm run test:workspace
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

If `pi` is unavailable, say so explicitly and treat the PI-backed E2E runs as skipped rather than passed.

For isolated validation, prefer environment-scoped state paths:

```bash
export SPORE_ORCHESTRATOR_DB_PATH=/tmp/spore-orchestrator.sqlite
export SPORE_SESSION_DB_PATH=/tmp/spore-sessions.sqlite
export SPORE_EVENT_LOG_PATH=/tmp/spore-events.ndjson
```

## Non-Goals That Remain Out of Scope

The migration did not change these repository boundaries:

- Node remains the canonical runtime; Bun is still out of scope
- npm remains the canonical package manager
- the repository remains ESM-first
- SQLite remains the durable local store for current runtime/session/orchestrator flows
- the web surface stays a lightweight gateway-backed app rather than a new framework rewrite

## TS-First Invariants

Treat the migration as complete only while these statements remain true:

- first-party source-of-truth code under `apps/`, `packages/`, and `services/` stays in TypeScript
- generated browser JavaScript stays confined to build output such as `apps/web/public/`
- generated browser JavaScript and `*.tsbuildinfo` remain disposable build output rather than reviewable source artifacts
- Node/npm remains the documented runtime baseline
- `tsx`, `tsc`, and `node --import=tsx --test` remain the documented execution paths
- documentation continues to describe the TypeScript-first workflow accurately
