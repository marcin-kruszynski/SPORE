# SPORE Documentation Index

This is the canonical navigation hub for SPORE documentation.

## Purpose

The docs system is the operational backbone of the project. It organizes vision, architecture, research, planning, decisions, templates, and operating policies.

## Canonical Docs

- Vision: [vision/product-vision.md](vision/product-vision.md)
- Principles: [vision/principles.md](vision/principles.md)
- System overview: [architecture/system-overview.md](architecture/system-overview.md)
- Runtime model: [architecture/runtime-model.md](architecture/runtime-model.md)
- Session model: [architecture/session-model.md](architecture/session-model.md)
- Clients and surfaces: [architecture/clients-and-surfaces.md](architecture/clients-and-surfaces.md)
- Config model: [architecture/config-model.md](architecture/config-model.md)
- Knowledge model: [architecture/knowledge-model.md](architecture/knowledge-model.md)
- Embeddings/search strategy: [architecture/embeddings-search.md](architecture/embeddings-search.md)
- Reference synthesis: [references/reference-synthesis.md](references/reference-synthesis.md)
- Comparative analysis: [architecture/comparative-analysis.md](architecture/comparative-analysis.md)
- Workspace operating model: [operations/workspace-operating-model.md](operations/workspace-operating-model.md)
- Local development runbook: [runbooks/local-dev.md](runbooks/local-dev.md)
- Bootstrap architect instruction: [specs/bootstrap-architect-instruction.md](specs/bootstrap-architect-instruction.md)
- Bootstrap roadmap: [plans/roadmap.md](plans/roadmap.md)
- Completion summary: [plans/bootstrap-completion-summary.md](plans/bootstrap-completion-summary.md)

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
