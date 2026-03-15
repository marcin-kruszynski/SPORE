# ADR-0017: Unify Self-Build Into A Standard Project Work Management Pipeline

- Status: Accepted
- Date: 2026-03-15

## Context

SPORE's "self-build" system provides a complete governed work pipeline: goal plans, work-item groups, work items, proposals, validation bundles, and promotion lanes. It was originally built and named as SPORE's ability to improve itself -- the platform working on its own repository.

Analysis of the implementation reveals that approximately 95% of the self-build code is already project-agnostic. Only 200-300 lines contain SPORE-specific hardcoding:

- `buildGoalRecommendations` generates recommendations that assume the target project is SPORE itself,
- the default project ID is hardcoded to `"spore"`,
- path-to-domain mappings assume the SPORE repository layout.

The self-build pipeline accounts for roughly 70 of the orchestrator's ~100 HTTP routes and over 15,000 lines of code. It is the primary feature of the platform, not a secondary internal tool. Calling it "self-build" creates a false impression that this is a niche capability for SPORE's own maintenance, when it is actually SPORE's core value proposition for managing governed work on any project.

Today there are two parallel governance hierarchies:

- **Self-build hierarchy:** goal plan -> group -> work item -> run,
- **Standard workflow hierarchy:** workflow -> execution -> step.

These are complementary layers -- the self-build hierarchy manages what work to do and why, while the workflow hierarchy manages how individual work items are executed -- but the naming disconnect makes them appear to be competing alternatives.

PI is already the runtime partner that executes work-item sessions. Treating it as an optional dependency understates its role in the architecture.

## Decision

SPORE adopts **Project Work Management** as the canonical name for the pipeline currently called "self-build."

The pipeline -- goal -> plan -> execute -> validate -> promote -- is SPORE's standard way of managing governed work on any project. The two governance layers are understood as:

- **Project Work Management** (goal plan -> group -> work item -> run): decides what to build, why, and in what order,
- **Workflow Execution** (workflow -> execution -> step): decides how each unit of work is carried out by which roles.

"Self-build" remains a valid description when SPORE is the target project, but the underlying machinery is generic.

Code refactoring will address the three hardcoded coupling points:

1. **Default project ID** -- make `"spore"` a configurable default rather than a hardcoded assumption, so new projects provide their own ID at onboarding,
2. **Goal recommendation logic** -- externalize `buildGoalRecommendations` into project-level and template-level configuration so each project defines its own recommendation strategy,
3. **Safe-mode scopes and domain mappings** -- externalize path-to-domain mappings and safe-mode scope definitions into policy configuration rather than embedding them in orchestrator code.

PI is recognized as the core runtime partner. Orchestrator planning, session launch, and work-item execution all assume PI availability as the normal operating mode.

## Consequences

### Documentation and narrative

- README, architecture docs, and onboarding material will describe Project Work Management as the primary system, not a secondary internal tool.
- The term "self-build" is narrowed to mean specifically "SPORE managing work on its own repository."
- Architecture narratives will explain the two governance layers as complementary rather than presenting them as separate features.

### Project onboarding

- New projects onboard by providing project configuration, domain configuration, and work-item templates.
- Goal recommendation, domain mapping, and safe-mode scoping become per-project configuration concerns rather than orchestrator-internal assumptions.

### Code changes

- Refactoring the three hardcoded coupling points will follow in a separate implementation phase with its own plan.
- Existing self-build HTTP routes, database schemas, and CLI commands continue to function unchanged during the transition.
- Route and schema naming (whether to rename `self-build` paths to `project` paths) is deferred to the refactoring plan.

### Risk

- Renaming an established internal concept requires careful migration of docs, comments, variable names, and operator habits.
- The refactoring must not break the existing SPORE-on-SPORE workflow while generalizing for other projects.
