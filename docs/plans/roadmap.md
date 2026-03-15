# Current Roadmap

This is the current strategic roadmap for SPORE.

Use this file for direction. Use `docs/plans/self-build-status-and-next-steps.md` for the tactical next packages. Use `docs/roadmap/IMPLEMENTATION_ROADMAP.md` only as archived bootstrap history.

## Current Stage

SPORE has crossed the bootstrap boundary.

The foundation is now executable across docs, config, runtime, orchestrator, session surfaces, web, TUI, and governed project work management (including SPORE working on itself).

The project is entering a **unification phase**: the work management pipeline (goal plans, work items, proposals, validation, promotion) was built under the name "self-build" but is structurally generic. The immediate priority is to formalize this as SPORE's standard project work management system, usable on any project.

See `docs/decisions/ADR-0017-unified-project-work-management.md` for the architectural decision.

## Now

The next waves should focus on six product priorities:

1. **Generalize the work management pipeline.** Externalize SPORE-specific hardcoding (default project ID, goal recommendation logic, safe-mode scopes, path-to-domain mappings) into project and policy configuration. See `docs/plans/unification-refactoring-plan.md`.
2. Improve planner and autonomous scheduler quality.
3. Deepen validation bundles, proposal readiness, and rework discipline.
4. Strengthen integration-branch diagnostics and promotion visibility.
5. Make the project work dashboard and TUI the primary operator mission-control surface.
6. Expand scenario and regression coverage for the work management pipeline.

Approved exception in the current wave:

- land the bounded multi-backend PI runtime adapter migration from `ADR-0014`, `ADR-0015`, and `ADR-0016` so SPORE can keep PI-first integration while decoupling the core runtime boundary from a single launcher implementation.

## Next

After those land, the next layer should be:

- multi-project support with distinct project configs, domains, and work-item templates,
- learning-to-planning feedback loops,
- clearer autonomy rollout tiers by repo scope,
- broader template catalog coverage,
- one reference end-to-end demo flow showing SPORE managing an external project from goal to promotion.

## Later

Longer-range work can include:

- productizing a dedicated `apps/cli/` experience,
- broader autonomous operation over selected repo scopes,
- richer packaging and onboarding for external users,
- stronger release-quality operator experiences over web and terminal surfaces,
- PI runtime abstraction layer for alternative agent runtimes (future, not current priority).

## Explicit Non-Goals Right Now

- auto-merging to `main`,
- bypassing gateway/orchestrator read surfaces in favor of raw SQLite scraping,
- shared mutable worktrees as a shortcut,
- broadening autonomy faster than governance, diagnostics, and validation can support,
- replacing PI as the core runtime partner (abstraction for alternatives is a Later goal, not Now).

## Related Documents

- Current state handoff: `docs/plans/project-state-and-direction-handoff.md`
- Tactical next work: `docs/plans/self-build-status-and-next-steps.md`
- Unification ADR: `docs/decisions/ADR-0017-unified-project-work-management.md`
- Refactoring plan: `docs/plans/unification-refactoring-plan.md`
- Long-range self-build plan: `docs/plans/long-range-self-build-roadmap.md`
- Detailed execution plan: `docs/plans/full-self-build-implementation-plan.md`
