# SPORE Documentation Index

This is the canonical navigation hub for SPORE documentation.

Use `docs/` as ground truth for product state, architecture, operations, and direction. Treat package and service `README.md` files as implementation-adjacent notes, not the primary narrative.

## Start Here

- Current project state: [plans/project-state-and-direction-handoff.md](plans/project-state-and-direction-handoff.md)
- Tactical backlog and next work: [plans/self-build-status-and-next-steps.md](plans/self-build-status-and-next-steps.md)
- Current roadmap: [plans/roadmap.md](plans/roadmap.md)
- Local development and verification: [runbooks/local-dev.md](runbooks/local-dev.md)

## Current Architecture

- System overview: [architecture/system-overview.md](architecture/system-overview.md)
- Role model: [architecture/role-model.md](architecture/role-model.md)
- Workflow model: [architecture/workflow-model.md](architecture/workflow-model.md)
- Runtime model: [architecture/runtime-model.md](architecture/runtime-model.md)
- Session model: [architecture/session-model.md](architecture/session-model.md)
- Clients and surfaces: [architecture/clients-and-surfaces.md](architecture/clients-and-surfaces.md)
- Config model: [architecture/config-model.md](architecture/config-model.md)
- Event model: [architecture/event-model.md](architecture/event-model.md)
- Observability model: [architecture/observability-model.md](architecture/observability-model.md)
- Knowledge model: [architecture/knowledge-model.md](architecture/knowledge-model.md)
- Embeddings and search: [architecture/embeddings-search.md](architecture/embeddings-search.md)
- Worktree and workspace isolation: [specs/worktree-and-workspace-isolation.md](specs/worktree-and-workspace-isolation.md)

## Current Operations

- Local development runbook: [runbooks/local-dev.md](runbooks/local-dev.md)
- Scenario library: [runbooks/scenario-library.md](runbooks/scenario-library.md)
- Documentation maintenance runbook: [runbooks/documentation-maintenance.md](runbooks/documentation-maintenance.md)
- Workspace operating model: [operations/workspace-operating-model.md](operations/workspace-operating-model.md)

## Current Status And Direction

- Product vision: [vision/product-vision.md](vision/product-vision.md)
- Principles: [vision/principles.md](vision/principles.md)
- Glossary: [vision/glossary.md](vision/glossary.md)
- Project handoff: [plans/project-state-and-direction-handoff.md](plans/project-state-and-direction-handoff.md)
- Self-build status: [plans/self-build-status-and-next-steps.md](plans/self-build-status-and-next-steps.md)
- Current roadmap: [plans/roadmap.md](plans/roadmap.md)
- Long-range self-build roadmap: [plans/long-range-self-build-roadmap.md](plans/long-range-self-build-roadmap.md)
- Full self-build implementation plan: [plans/full-self-build-implementation-plan.md](plans/full-self-build-implementation-plan.md)

## Decisions

- Bootstrap scope boundary: [decisions/ADR-0001-project-scope.md](decisions/ADR-0001-project-scope.md)
- Repository foundation and docs OS: [decisions/ADR-0001-repo-foundation.md](decisions/ADR-0001-repo-foundation.md)
- PI-first runtime foundation: [decisions/ADR-0002-runtime-pi-first.md](decisions/ADR-0002-runtime-pi-first.md)
- Builder/tester verification workspaces: [decisions/ADR-0005-builder-tester-verification-workspaces.md](decisions/ADR-0005-builder-tester-verification-workspaces.md)
- Project coordinator role: [decisions/ADR-0006-project-coordinator-role.md](decisions/ADR-0006-project-coordinator-role.md)
- Feature integrator promotion boundary: [decisions/ADR-0007-feature-integrator-promotion-boundary.md](decisions/ADR-0007-feature-integrator-promotion-boundary.md)
- TypeScript-first codebase: [decisions/ADR-0008-typescript-first-codebase.md](decisions/ADR-0008-typescript-first-codebase.md)

Note: early bootstrap history contains two accepted `ADR-0001` files. Keep both as historical foundation records and do not reuse that number.

## References And Research

- Reference synthesis: [references/reference-synthesis.md](references/reference-synthesis.md)
- Comparative analysis: [architecture/comparative-analysis.md](architecture/comparative-analysis.md)
- Agent-to-agent communication research: [research/agent-to-agent-communication.md](research/agent-to-agent-communication.md)
- Open questions: [research/open-questions.md](research/open-questions.md)

## Historical Notes Kept For Context

- Bootstrap completion summary: [plans/bootstrap-completion-summary.md](plans/bootstrap-completion-summary.md)
- Bootstrap status snapshot: [operations/BOOTSTRAP_STATUS.md](operations/BOOTSTRAP_STATUS.md)
- Bootstrap implementation roadmap: [roadmap/IMPLEMENTATION_ROADMAP.md](roadmap/IMPLEMENTATION_ROADMAP.md)
- Bootstrap backlog: [plans/backlog.md](plans/backlog.md)
- Bootstrap phases: [plans/environment-phases.md](plans/environment-phases.md)
- Bootstrap wave template: [plans/implementation-waves.md](plans/implementation-waves.md)
- Builder/tester implementation note: [plans/builder-tester-verification-workspaces.md](plans/builder-tester-verification-workspaces.md)
- Coordinator implementation note: [plans/project-coordinator-role-plan.md](plans/project-coordinator-role-plan.md)
- Integrator implementation note: [plans/feature-integrator-role-plan.md](plans/feature-integrator-role-plan.md)
- TypeScript migration completion note: [plans/javascript-to-typescript-migration-plan.md](plans/javascript-to-typescript-migration-plan.md)

## Documentation Conventions

- Lowercase kebab-case files are canonical.
- Uppercase duplicates are compatibility stubs that point to the canonical lowercase path.
- `docs/index/docs_manifest.yaml` tracks documents intentionally surfaced from this index.
- `docs/index/DOCS_INDEX.md` is the broader inventory with active, historical, and supplemental groupings.
- Narrative docs for domains, profiles, sessions, and workflows are not separately maintained right now; use `config/` plus the architecture docs as source of truth.

## Secondary Index

For the broader inventory and status grouping, see [index/DOCS_INDEX.md](index/DOCS_INDEX.md).
