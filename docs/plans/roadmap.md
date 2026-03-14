# Current Roadmap

This is the current strategic roadmap for SPORE.

Use this file for direction. Use `docs/plans/self-build-status-and-next-steps.md` for the tactical next packages. Use `docs/roadmap/IMPLEMENTATION_ROADMAP.md` only as archived bootstrap history.

## Current Stage

SPORE has crossed the bootstrap boundary.

The foundation is now executable across docs, config, runtime, orchestrator, session surfaces, web, TUI, and supervised self-build.

The current question is no longer "can SPORE run?" The current question is "how far can SPORE safely improve itself while preserving operator trust and architectural clarity?"

## Now

The next waves should focus on five product priorities:

1. Improve planner and autonomous scheduler quality.
2. Deepen validation bundles, proposal readiness, and rework discipline.
3. Strengthen integration-branch diagnostics and promotion visibility.
4. Make the self-build dashboard and TUI the primary operator mission-control surface.
5. Expand self-build-specific scenario and regression coverage.

Approved exception in the current wave:

- land the bounded multi-backend PI runtime adapter migration from `ADR-0014`, `ADR-0015`, and `ADR-0016` so SPORE can keep PI-first integration while decoupling the core runtime boundary from a single launcher implementation.

## Next

After those land, the next layer should be:

- learning-to-planning feedback loops,
- clearer autonomy rollout tiers by repo scope,
- broader template catalog coverage,
- one reference end-to-end demo flow that shows SPORE's full operator story clearly.

## Later

Longer-range work can include:

- productizing a dedicated `apps/cli/` experience,
- broader autonomous operation over selected repo scopes,
- richer packaging and onboarding for external users,
- stronger release-quality operator experiences over web and terminal surfaces.

## Explicit Non-Goals Right Now

- auto-merging to `main`,
- bypassing gateway/orchestrator read surfaces in favor of raw SQLite scraping,
- shared mutable worktrees as a shortcut,
- broadening autonomy faster than governance, diagnostics, and validation can support.

## Related Documents

- Current state handoff: `docs/plans/project-state-and-direction-handoff.md`
- Tactical next work: `docs/plans/self-build-status-and-next-steps.md`
- Long-range self-build plan: `docs/plans/long-range-self-build-roadmap.md`
- Detailed execution plan: `docs/plans/full-self-build-implementation-plan.md`
