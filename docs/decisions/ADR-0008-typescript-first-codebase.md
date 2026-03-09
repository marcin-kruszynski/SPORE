# ADR-0008: Adopt a TypeScript-First First-Party Codebase

- Status: Proposed
- Date: 2026-03-09

## Context

SPORE has grown into a multi-package system with durable workflow state, PI runtime integration, tmux-backed sessions, HTTP services, a TUI, and a browser operator surface.

The current first-party implementation is still primarily plain JavaScript:

- source and tests under `apps/`, `packages/`, and `services/` are still JavaScript
- there is no root TypeScript project configuration
- there are no package-level TypeScript boundaries
- cross-package imports often reach directly into another package's `src/` tree
- shared payloads and state shapes are reconstructed in multiple places instead of being enforced as shared contracts

As SPORE grows, this increases the chance of:

- workflow, session, review, approval, escalation, and self-build state drift
- HTTP payload mismatches between services, TUI, and web clients
- unsafe refactors in large modules
- runtime-only discovery of integration mistakes that should be caught earlier

There is also active interest in modernizing the repository. One option considered was a runtime move from Node.js to Bun. However, SPORE currently depends on Node 24 behavior and APIs such as `node:sqlite`, `node:test`, `child_process`, tmux-backed process handling, and PI execution flows. A runtime change now would add unnecessary risk to a system that is still stabilizing its core execution foundation.

SPORE therefore needs a modernization decision that improves correctness, maintainability, and package discipline without destabilizing the runtime model.

## Decision

SPORE will adopt TypeScript as the canonical implementation language for all first-party source and test code under `apps/`, `packages/`, and `services/`.

This migration is governed by `docs/plans/javascript-to-typescript-migration-plan.md` and will be executed in three phases:

1. foundation and shared contracts
2. core runtime and service migration
3. operator surfaces, final cutover, and enforcement

The decision includes these mandatory constraints:

- keep `Node >= 24` as the canonical runtime during the migration
- keep `npm` as the canonical package manager during the migration
- do not adopt Bun as the primary runtime as part of this migration
- keep the repository ESM-first
- use Node-compatible TypeScript settings based on `NodeNext`
- introduce shared typed contracts for workflow, session, runtime, gateway, orchestrator, and operator-surface payloads
- introduce formal package boundaries through workspaces and exported package APIs
- remove deep cross-package imports into another package's `src/` tree where a public API should exist
- keep the repository runnable at the end of each migration phase
- treat the migration as incomplete until the full verification matrix passes and all failures have been repaired through a fix-until-green loop

## Consequences

- SPORE gains compiler-enforced contracts for cross-package state, payloads, and refactors.
- Shared DTOs and state vocabularies become reusable repository assets instead of duplicated ad hoc objects.
- The migration requires structural cleanup, not only file renames, especially in oversized modules and deep import chains.
- Tooling will expand to include TypeScript configuration, typechecking, formatting/linting enforcement, and TS-aware test execution.
- The browser operator surface and orchestrator internals will need modularization during migration.
- Contributors will need to follow stricter package API, import-boundary, and typing rules.
- Runtime validation remains mandatory; compile success alone is not enough.
- Documentation must be updated alongside implementation changes, including indexes, runbooks, and operator instructions when commands or workflows change.
- Bun stays out of scope as the primary runtime unless a future ADR revisits that choice after the TypeScript migration is complete and runtime compatibility risk is lower.

## Open Questions

- Should development execution standardize on direct TS loading, explicit build output, or a mixed model by package type?
- Which shared contracts should live in `packages/shared-types/` versus `packages/core/` once phase 2 decomposition begins?
