# SPORE Documentation Index

This is the canonical navigation hub for SPORE documentation.

## Purpose

The docs system is the operational backbone of the project. It organizes vision, architecture, research, planning, decisions, templates, and operating policies.

## Canonical Docs

- Vision: [vision/product-vision.md](vision/product-vision.md)
- Principles: [vision/principles.md](vision/principles.md)
- System overview: [architecture/system-overview.md](architecture/system-overview.md)
- Runtime model: [architecture/runtime-model.md](architecture/runtime-model.md)
- Role model: [architecture/role-model.md](architecture/role-model.md)
- Workflow model: [architecture/workflow-model.md](architecture/workflow-model.md)
- Session model: [architecture/session-model.md](architecture/session-model.md)
- Clients and surfaces: [architecture/clients-and-surfaces.md](architecture/clients-and-surfaces.md)
- Config model: [architecture/config-model.md](architecture/config-model.md)
- Knowledge model: [architecture/knowledge-model.md](architecture/knowledge-model.md)
- Embeddings/search strategy: [architecture/embeddings-search.md](architecture/embeddings-search.md)
- Reference synthesis: [references/reference-synthesis.md](references/reference-synthesis.md)
- Comparative analysis: [architecture/comparative-analysis.md](architecture/comparative-analysis.md)
- Agent-to-agent communication research: [research/agent-to-agent-communication.md](research/agent-to-agent-communication.md)
- Workspace operating model: [operations/workspace-operating-model.md](operations/workspace-operating-model.md)
- Local development runbook: [runbooks/local-dev.md](runbooks/local-dev.md)
- Scenario library: [runbooks/scenario-library.md](runbooks/scenario-library.md)
- Bootstrap architect instruction: [specs/bootstrap-architect-instruction.md](specs/bootstrap-architect-instruction.md)
- Worktree and workspace isolation: [specs/worktree-and-workspace-isolation.md](specs/worktree-and-workspace-isolation.md)
- ADR process: [decisions/ADR-0004-docs-adr-pass-process.md](decisions/ADR-0004-docs-adr-pass-process.md)
- Builder/tester verification workspace ADR: [decisions/ADR-0005-builder-tester-verification-workspaces.md](decisions/ADR-0005-builder-tester-verification-workspaces.md)
- Project coordinator role ADR: [decisions/ADR-0006-project-coordinator-role.md](decisions/ADR-0006-project-coordinator-role.md)
- Feature integrator promotion ADR: [decisions/ADR-0007-feature-integrator-promotion-boundary.md](decisions/ADR-0007-feature-integrator-promotion-boundary.md)
- TypeScript-first codebase ADR: [decisions/ADR-0008-typescript-first-codebase.md](decisions/ADR-0008-typescript-first-codebase.md)
- Docs ADR pass open-question handoff ADR: [decisions/ADR-0009-docs-adr-pass-open-question-handoff.md](decisions/ADR-0009-docs-adr-pass-open-question-handoff.md)
- Docs ADR-Pass output governance ADR: [decisions/ADR-0010-docs-adr-pass-output-governance.md](decisions/ADR-0010-docs-adr-pass-output-governance.md)
- Bootstrap roadmap: [plans/roadmap.md](plans/roadmap.md)
- Completion summary: [plans/bootstrap-completion-summary.md](plans/bootstrap-completion-summary.md)
- Current self-build status: [plans/self-build-status-and-next-steps.md](plans/self-build-status-and-next-steps.md)
- Builder/tester verification workspaces: [plans/builder-tester-verification-workspaces.md](plans/builder-tester-verification-workspaces.md)
- Long-range self-build roadmap: [plans/long-range-self-build-roadmap.md](plans/long-range-self-build-roadmap.md)
- Full self-build implementation plan: [plans/full-self-build-implementation-plan.md](plans/full-self-build-implementation-plan.md)
- Project coordinator role plan: [plans/project-coordinator-role-plan.md](plans/project-coordinator-role-plan.md)
- Feature integrator role plan: [plans/feature-integrator-role-plan.md](plans/feature-integrator-role-plan.md)
- JavaScript to TypeScript migration plan: [plans/javascript-to-typescript-migration-plan.md](plans/javascript-to-typescript-migration-plan.md)

## Top-Level Map

- `docs/vision/` goals, principles, vocabulary
- `docs/architecture/` target system design and integration strategies
- `docs/research/` upstream study notes and open questions
- `docs/decisions/` ADRs
- `docs/specs/` implementation-oriented specifications
- `docs/plans/` phased planning and backlog
- `docs/runbooks/` operational procedures
- `docs/templates/` reusable documentation templates
- `docs/domains/` domain-specific scopes and responsibilities
- `docs/operations/` governance policies
- `docs/index/` machine- and human-readable docs indexes
- `docs/roadmap/` expanded roadmap artifacts

## Naming Conventions

- Architecture docs: `kebab-case.md`
- ADRs: `ADR-XXXX-topic.md`
- Runbooks: concise imperative names
- Templates: `<type>-template.md`

## Maintenance Rules

- Link every major new doc from this index or a local index.
- Keep `docs/index/docs_manifest.yaml` synchronized.
- Update ADR references when architecture direction changes.
- Prefer canonical docs over duplicate note fragments.

## Secondary Index

For an expanded operational map, see [index/DOCS_INDEX.md](index/DOCS_INDEX.md).
