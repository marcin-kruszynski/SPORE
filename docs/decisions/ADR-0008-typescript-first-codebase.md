# ADR-0008: Adopt a TypeScript-First First-Party Codebase

- Status: Accepted
- Date: 2026-03-10

## Context

As of 2026-03-10, SPORE operates as a Node 24 and npm workspace with TypeScript as the canonical implementation language for first-party code.

The current repository state is:

- first-party source and test code under `apps/`, `packages/`, and `services/` is authored in TypeScript
- root and package-level TypeScript project configuration exists
- Node-side entrypoints run from TypeScript through `tsx`
- tests run through `node --import=tsx --test`
- browser assets under `apps/web/public/` are generated from `apps/web/src/` through `npm run web:build`
- `npm run typecheck` passes
- the shared compiler config has `allowJs` and `checkJs` disabled for first-party source paths
- the current compiler posture is still not fully strict
- some internal cross-package `src` imports still exist as implementation debt

This outcome preserves the existing runtime model. SPORE still depends on Node 24 behavior and APIs such as `node:sqlite`, `node:test`, `child_process`, tmux-backed process handling, and PI execution flows. A runtime switch to Bun remains unnecessary risk for the current architecture.

## Decision

SPORE adopts and keeps this TypeScript-first operating model:

- TypeScript is the canonical source-of-truth language for first-party source and test code under `apps/`, `packages/`, and `services/`
- Node `>= 24` remains the canonical runtime
- `npm` remains the canonical package manager
- the repository remains ESM-first and uses `NodeNext`-compatible TypeScript settings
- Node-side CLIs and services run directly from TypeScript source via `tsx`
- repository tests run through `node --import=tsx --test`
- browser assets are emitted from TypeScript into `apps/web/public/` via `npm run web:build`
- generated browser JavaScript is acceptable only as build output, not as hand-authored source-of-truth code
- workspace packages and exported package APIs are the default cross-package boundary model
- new hand-authored first-party `.js` files under `apps/`, `packages/`, or `services/` should not be introduced unless a later ADR explicitly changes that boundary

This ADR does not require repository-wide strict mode or immediate removal of every compatibility escape hatch. TS-first status in SPORE means TypeScript owns the source of truth and execution path; stricter compiler enforcement can continue incrementally.

## Consequences

- cross-package and cross-surface contracts now have a canonical TypeScript home
- `npm run typecheck` becomes a baseline repository verification step
- runtime and service entrypoints are documented and maintained as TS-first workflows
- emitted browser JavaScript in `apps/web/public/` should be treated as generated output and not edited by hand
- `*.tsbuildinfo` should be treated as generated local compiler state and not as reviewable repository source
- contributors should prefer `@spore/*` package imports and exported APIs over new deep sibling imports
- remaining hardening work, such as tighter compiler settings and cleanup of residual internal deep imports, is follow-up work rather than a blocker to this architectural choice
- Bun remains out of scope as the primary runtime unless a later ADR revisits that boundary
