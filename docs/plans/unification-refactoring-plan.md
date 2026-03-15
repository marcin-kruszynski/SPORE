# Unification Refactoring Plan: Self-Build to Project Work Management

## Purpose

This plan details the code changes needed to generalize what was previously called "self-build" into SPORE's standard Project Work Management pipeline, usable on any project. The goal is to eliminate SPORE-specific hardcoding so that the same orchestration machinery that manages SPORE's own development can manage any configured project.

This plan is intentionally **orthogonal** to the runtime-core / multi-backend PI migration from `ADR-0014`, `ADR-0015`, and `ADR-0016`. Runtime abstraction and PI backend parity continue on their own track. The unification work should build on that new runtime boundary, not expand or re-litigate it.

For the execution-oriented checklist version, see `docs/superpowers/plans/2026-03-15-project-work-management-unification.md`.

## Background

Analysis revealed the following divergence in `packages/orchestrator/`:

- `self-build/` directory: 15,040 lines across 15 files
- `execution/` directory: 6,078 lines across 15 files
- 18 self-build-specific DB tables vs 13 standard execution tables
- ~70 self-build HTTP routes vs ~30 standard execution routes
- Only ~200-300 lines of actual SPORE-specific hardcoding

The self-build pipeline is significantly more mature and feature-rich than the standard execution pipeline. Rather than building the standard pipeline up to parity, the pragmatic path is to generalize the self-build pipeline so it works for any project, then let the standard execution pipeline serve its narrower workflow-invocation purpose.

---

## Phase 1: Configuration Externalization (No Breaking Changes)

Phase 1 removes hardcoded SPORE-specific values and replaces them with configuration-driven equivalents. No behavior changes, no renames, no file moves. Every change is purely mechanical: replace a literal with a config lookup.

### 1.1 Default Project ID

**Problem:** 31 hardcoded instances of `"spore"` as the default project ID in `self-build.impl.ts` and `operator-chat.impl.ts`.

**Changes:**

- Add `defaultProjectId` field to `config/system/defaults.yaml`:
  ```yaml
  defaultProjectId: spore
  ```
- Create a small config reader (or extend the existing system config loader) that reads `defaultProjectId` at startup, falling back to the first project found in `config/projects/` if not set.
- Replace all 31 hardcoded `"spore"` default project references with the config-driven value.
- Grep pattern to find instances: `rg '"spore"' packages/orchestrator/src/self-build/`

**Files affected:**

- `packages/orchestrator/src/self-build/self-build.impl.ts`
- `packages/orchestrator/src/self-build/operator-chat.impl.ts`
- `config/system/defaults.yaml` (new field)

### 1.2 Goal Recommendation Engine

**Problem:** `buildGoalRecommendations()` in `self-build.impl.ts` (~200 lines) uses hardcoded keyword matching and SPORE-specific heuristics to classify and recommend goals.

**Current behavior:**

- Keyword lists match against goal text to classify mutation scope
- Hardcoded path patterns determine which domain a goal belongs to
- Recommendation priority is computed from hardcoded weights

**Target behavior:**

- Work-item templates already carry metadata (domain, affected paths, validation bundles). Template-to-goal matching should read from template config, not hardcoded keywords.
- Mutation scope classification should come from domain config (each domain already declares its scope boundaries), not hardcoded path lists.
- Recommendation priority should be derivable from template metadata + project config weights.

**Changes:**

- Extract the keyword-to-domain mapping into a project-level config field, e.g., `config/projects/spore.yaml` gains a `goalClassification` block:
  ```yaml
  goalClassification:
    keywords:
      frontend: [ui, dashboard, browser, css, layout, component]
      backend: [runtime, session, orchestrator, pi, gateway]
      docs: [documentation, readme, adr, plan, runbook]
    scopeWeights:
      safe: 1
      moderate: 2
      broad: 3
  ```
- Refactor `buildGoalRecommendations()` to read classification data from project config rather than inline literals.
- Keep the function signature and return shape identical.

**Files affected:**

- `packages/orchestrator/src/self-build/self-build.impl.ts` (refactor ~200 lines)
- `config/projects/spore.yaml` (new fields)

### 1.3 Safe Mode Scopes

**Problem:** Hardcoded safe-mode allowed scopes: `["docs", "config", "runbooks", "scenarios", "regressions", "apps/web"]`.

**Changes:**

- Add `safeModeAllowedScopes` to the project config schema:
  ```yaml
  # config/projects/spore.yaml
  safeModeAllowedScopes:
    - docs
    - config
    - runbooks
    - scenarios
    - regressions
    - apps/web
  ```
- Alternatively, this can live in a policy pack if multiple projects share the same safe-mode policy:
  ```yaml
  # config/policy-packs/standard-safe-mode.yaml
  safeModeAllowedScopes:
    - docs
    - config
  ```
- Replace the hardcoded array with a config lookup. Fall back to the current hardcoded list if the config field is absent (backward compatible).

**Files affected:**

- `packages/orchestrator/src/self-build/self-build.impl.ts`
- `config/projects/spore.yaml` or `config/policy-packs/` (new field)

### 1.4 Path-to-Domain Mapping

**Problem:** `resolveRecommendationTaskClass()` hardcodes mappings like `apps/web` -> frontend, `packages/runtime-pi` -> backend, `docs/` -> docs, etc.

**Current behavior:**

- A sequence of `if/else` checks against path prefixes to return a domain string

**Target behavior:**

- Domain config already has `affectedPaths` or similar fields. The path-to-domain resolver should iterate domain configs and match against their declared paths.

**Changes:**

- Ensure each domain config in `config/domains/` declares its path prefixes:
  ```yaml
  # config/domains/frontend.yaml
  name: frontend
  pathPrefixes:
    - apps/web
    - packages/ui
  ```
- Replace `resolveRecommendationTaskClass()` internals with a loop over loaded domain configs.
- Keep the function signature and return type identical.

**Files affected:**

- `packages/orchestrator/src/self-build/self-build.impl.ts`
- `config/domains/*.yaml` (verify/add `pathPrefixes` fields)

---

## Phase 2: Naming and Documentation Alignment

Phase 2 adds project-generic API surfaces and updates documentation. Existing self-build routes and commands remain functional as aliases. No file renames, no function renames.

### 2.1 Public API Surface

**HTTP routes -- additive aliases:**

| Existing Route | New Alias |
|---|---|
| `GET /self-build/goals` | `GET /projects/:id/goals` |
| `POST /self-build/goals` | `POST /projects/:id/goals` |
| `GET /self-build/work-items` | `GET /projects/:id/work-items` |
| `POST /self-build/proposals` | `POST /projects/:id/proposals` |
| `GET /self-build/dashboard` | `GET /projects/:id/dashboard` |

- New routes delegate to the same handler functions.
- `:id` defaults to `defaultProjectId` from config when called without a project context.
- Self-build routes continue to work, routing to the default project.

**CLI commands -- additive aliases:**

| Existing Command | New Alias |
|---|---|
| `orchestrator:goal-plan-list` | `orchestrator:project-goals` |
| `orchestrator:goal-plan-create` | `orchestrator:project-goal-create` |

- New commands are thin wrappers that set the project context and call existing implementations.

**Files affected:**

- `packages/orchestrator/src/self-build/self-build-routes.ts` (or equivalent route registration file)
- CLI entrypoint files in `packages/orchestrator/src/`
- ~200 lines added total

### 2.2 Internal Naming

**Explicit non-goals for this phase:**

- DO NOT rename files (e.g., `self-build.impl.ts` stays as-is)
- DO NOT rename internal functions (e.g., `buildGoalRecommendations()` stays as-is)
- DO NOT rename database tables

**What to do:**

- Add JSDoc comments to key exported functions explaining their general-purpose nature:
  ```typescript
  /**
   * Lists goal plans for a project. Part of the Project Work Management
   * pipeline. When projectId is "spore", this manages SPORE's own
   * self-build goals.
   */
  export async function listGoalPlans(projectId: string, ...): Promise<...> {
  ```
- Update type/interface names incrementally where they appear in **public API responses** (e.g., if a response type is `SelfBuildDashboard`, add a `ProjectDashboard` type alias that references it).
- Keep internal types unchanged to avoid churn.

### 2.3 Documentation

- All docs should describe the pipeline as "Project Work Management."
- "Self-build" narrows to mean specifically "SPORE managing its own repository" -- one instance of project work management.
- Documents to update:
  - `docs/plans/project-state-and-direction-handoff.md`
  - `docs/plans/self-build-status-and-next-steps.md`
  - `docs/plans/roadmap.md`
  - `docs/INDEX.md` and `docs/index/DOCS_INDEX.md`
  - Relevant ADRs in `docs/decisions/`
- The architectural decision is recorded in `docs/decisions/ADR-0017-unified-project-work-management.md`

---

## Phase 3: Structural Improvements (Future)

Phase 3 involves file restructuring and module extraction. Higher risk, larger diff, but no behavior changes. This phase should only proceed after Phases 1 and 2 are stable.

### 3.1 Extract Shared Utilities

**Problem:** The following utility functions are duplicated across `self-build.impl.ts`, `operator-chat.impl.ts`, and `workflow-execution.impl.ts`:

- `withDatabase()` -- SQLite connection wrapper
- `createId()` -- ID generation
- `nowIso()` -- ISO timestamp
- `asArray()` -- normalize to array
- `toText()` -- text coercion
- `dedupe()` -- array deduplication
- `compactObject()` -- remove undefined keys

**Changes:**

- Extract into `@spore/core` or a new `packages/orchestrator/src/shared/utils.ts` module.
- Replace all duplicate definitions with imports from the shared module.
- Each replacement is a mechanical find-and-replace; no logic changes.

**Estimated scope:** ~200 lines removed (duplicates), ~50 lines added (shared module), import updates across 3-5 files.

### 3.2 Modularize self-build.impl.ts

**Problem:** At 10,769 lines, `self-build.impl.ts` is far too large for maintainable development.

**Target split:**

| New Module | Approximate Lines | Responsibility |
|---|---|---|
| `goal-plans.impl.ts` | ~1,500 | Goal plan CRUD, recommendation, prioritization |
| `proposals.impl.ts` | ~1,500 | Proposal lifecycle, review, approval |
| `validation.impl.ts` | ~1,000 | Validation bundles, test execution tracking |
| `workspace-mgmt.impl.ts` | ~800 | Workspace provisioning, cleanup, status |
| `learnings.impl.ts` | ~600 | Learning capture, retrieval, application |
| `intake.impl.ts` | ~800 | Intake queue, triage, classification |
| `autonomy.impl.ts` | ~500 | Autonomy level management, safe mode |
| `dashboard.impl.ts` | ~1,000 | Dashboard aggregation, status summaries |
| `self-build-db.ts` | ~1,500 | All DB schema, migrations, queries |
| `self-build.impl.ts` | ~1,500 | Remaining glue, re-exports for backward compat |

**Approach:**

- Each new module exports the same function signatures currently in `self-build.impl.ts`.
- `self-build.impl.ts` re-exports everything from the new modules, so no external imports break.
- Move functions one module at a time, verifying the test suite after each move.

**Estimated scope:** ~3,000 lines moved (not changed), ~100 lines of new re-export glue, import updates.

### 3.3 Unify Workspace Provisioning

**Problem:** Both the self-build pipeline (~500 lines of workspace provisioning) and workflow-execution have independent workspace provisioning logic.

**Changes:**

- Extract shared workspace provisioning into `packages/workspace-manager/`.
- Both pipelines call into the shared workspace manager.
- Self-build-specific workspace policies (e.g., governance-aware cleanup) are expressed as configuration or hooks, not hardcoded branches.

**Estimated scope:** ~500 lines extracted, ~100 lines of integration glue per consumer.

---

## Verification Strategy

Each phase should pass the full local verification suite before merging:

```bash
# Core checks
npm run typecheck
npm run lint
npm run format:check

# Local test suite
npm run test:all-local

# Web build + tests (catches dashboard regressions)
npm run web:build && npm run test:web

# Config validation (catches config schema issues)
npm run config:validate

# Docs KB (catches broken doc references)
npm run docs-kb:index
```

For Phase 1 specifically, additionally verify:

- Default project behavior is unchanged when `defaultProjectId: spore` is set.
- Goal recommendations produce identical output for the SPORE project.
- Safe mode scopes are identical when config matches the old hardcoded values.

For Phase 2, additionally verify:

- New routes return identical responses to their self-build equivalents.
- Existing self-build routes are unaffected.
- `npm run test:http` passes with both old and new route paths.

---

## Risk Assessment

| Phase | Risk Level | Rationale |
|---|---|---|
| Phase 1 | Low | Config changes only. Every replacement is a literal-to-config-lookup swap. No behavior changes. Fully backward compatible with config defaults matching old hardcoded values. |
| Phase 2 | Low | Additive aliases and documentation only. No existing routes or commands are modified or removed. |
| Phase 3 | Medium | File restructuring and import changes. Risk of broken imports, circular dependencies, or missed re-exports. Mitigated by incremental moves with test verification after each step. |

All phases maintain full backward compatibility. No existing API surface is removed or changed in behavior.

---

## Estimated Scope

| Phase | Lines Changed | Lines Added | Lines Moved | Files Touched | New Config Fields |
|---|---|---|---|---|---|
| Phase 1 | ~500 | ~50 | 0 | 5-8 | 2-3 |
| Phase 2 | ~50 | ~200 | 0 | 8-12 | 0 |
| Phase 3 | ~200 | ~250 | ~3,000 | 15-20 | 0 |

---

## Sequencing and Dependencies

```
Phase 1.1 (Default Project ID)
    ├── Phase 1.2 (Goal Recommendations) -- depends on 1.1 for project config loading
    ├── Phase 1.3 (Safe Mode Scopes) -- independent of 1.2
    └── Phase 1.4 (Path-to-Domain) -- independent of 1.2, 1.3
         │
Phase 2.1 (Route Aliases) -- depends on Phase 1 complete
Phase 2.2 (Internal Naming) -- independent of 2.1
Phase 2.3 (Documentation) -- can proceed in parallel with 2.1, 2.2
         │
Phase 3.1 (Shared Utilities) -- depends on Phase 2 complete
Phase 3.2 (Modularize) -- depends on 3.1
Phase 3.3 (Unify Workspace) -- depends on 3.2
```

Phase 1 sub-tasks can be done as independent PRs after 1.1 lands. Phase 2 sub-tasks can proceed in parallel. Phase 3 is strictly sequential.
