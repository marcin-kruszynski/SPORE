# Roadmap

SPORE progresses through bootstrap-first phases before runtime implementation.

## Phases

- Phase 0: repository and docs foundation
- Phase 1: research synthesis and architecture baseline
- Phase 2: config/profile/workflow scaffolding
- Phase 3: knowledge retrieval architecture and tooling
- Phase 4: runtime/session/ui planning
- Phase 5: readiness audit and handoff

Detailed wave-level plan is in `docs/roadmap/IMPLEMENTATION_ROADMAP.md`.

## Current Focus After Bootstrap

The next implementation slice should build on the already landed durable orchestrator foundation:

1. harden multi-execution coordination-group policy and parent/child execution behavior,
2. improve grouped execution visualization and lineage clarity in operator surfaces,
3. formalize workflow-level `paused` and `held` semantics with stronger recovery guidance,
4. connect domain-specific workflow templates to coordination behavior without overcommitting to one scheduler design.
