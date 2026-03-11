# SPORE Docs Operating Index

This file is the broader inventory view over `docs/`. It separates active ground-truth docs from historical notes, supplemental references, and compatibility stubs.

## Canonical Current Docs

### State, Direction, And Planning

- `docs/plans/project-state-and-direction-handoff.md`
- `docs/plans/self-build-status-and-next-steps.md`
- `docs/plans/roadmap.md`
- `docs/plans/operator-chat-surface-plan.md`
- `docs/plans/long-range-self-build-roadmap.md`
- `docs/plans/full-self-build-implementation-plan.md`

### Vision

- `docs/vision/product-vision.md`
- `docs/vision/principles.md`
- `docs/vision/glossary.md`

### Architecture

- `docs/architecture/system-overview.md`
- `docs/architecture/role-model.md`
- `docs/architecture/workflow-model.md`
- `docs/architecture/runtime-model.md`
- `docs/architecture/session-model.md`
- `docs/architecture/clients-and-surfaces.md`
- `docs/architecture/config-model.md`
- `docs/architecture/event-model.md`
- `docs/architecture/observability-model.md`
- `docs/architecture/knowledge-model.md`
- `docs/architecture/embeddings-search.md`

### Runbooks And Operations

- `docs/runbooks/local-dev.md`
- `docs/runbooks/scenario-library.md`
- `docs/runbooks/documentation-maintenance.md`
- `docs/operations/workspace-operating-model.md`

### Specs

- `docs/specs/worktree-and-workspace-isolation.md`

### Decisions

- `docs/decisions/ADR-0001-project-scope.md`
- `docs/decisions/ADR-0001-repo-foundation.md`
- `docs/decisions/ADR-0002-runtime-pi-first.md`
- `docs/decisions/ADR-0005-builder-tester-verification-workspaces.md`
- `docs/decisions/ADR-0006-project-coordinator-role.md`
- `docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md`
- `docs/decisions/ADR-0008-typescript-first-codebase.md`
- `docs/decisions/ADR-0012-operator-chat-surface.md`

### References And Research

- `docs/references/reference-synthesis.md`
- `docs/architecture/comparative-analysis.md`
- `docs/research/agent-to-agent-communication.md`
- `docs/research/open-questions.md`

## Historical But Kept

These files remain useful as milestone records or implementation archaeology, but they are not the primary description of current SPORE behavior.

- `docs/plans/bootstrap-completion-summary.md`
- `docs/operations/BOOTSTRAP_STATUS.md`
- `docs/roadmap/IMPLEMENTATION_ROADMAP.md`
- `docs/plans/backlog.md`
- `docs/plans/environment-phases.md`
- `docs/plans/implementation-waves.md`
- `docs/plans/builder-tester-verification-workspaces.md`
- `docs/plans/project-coordinator-role-plan.md`
- `docs/plans/feature-integrator-role-plan.md`
- `docs/plans/javascript-to-typescript-migration-plan.md`
- `docs/decisions/ADR-0011-docs-adr-pass-1773113810406.md`

## Supplemental Notes

These documents may still contain useful context, but they should not be read before the canonical docs above when establishing current project truth.

- `docs/architecture/pi-integration-strategy.md`
- `docs/architecture/boundaries-and-modules.md`
- `docs/architecture/interfaces-overview.md`
- `docs/architecture/ui-model.md`
- `docs/specs/bootstrap-architect-instruction.md`
- `docs/specs/docs-search-tool.md`
- `docs/specs/environment-bootstrap.md`
- `docs/decisions/ADR-0003-documentation-governance.md`
- `docs/decisions/ADR-0004-docs-adr-pass-process.md`
- `docs/decisions/ADR-0009-docs-adr-pass-open-question-handoff.md`
- `docs/decisions/ADR-0010-docs-adr-pass-output-governance.md`
- `docs/research/overstory-notes.md`
- `docs/research/gastown-notes.md`
- `docs/research/mulch-notes.md`
- `docs/research/beads-notes.md`
- `docs/research/pi-notes.md`
- `docs/research/agentic-engineering-notes.md`

## Compatibility Stubs

The following uppercase paths exist only to preserve older links. They should point to lowercase canonical files and should not accumulate separate content.

- `docs/vision/PROJECT_VISION.md`
- `docs/architecture/SYSTEM_OVERVIEW.md`
- `docs/architecture/SESSION_MODEL.md`
- `docs/architecture/CLIENTS_AND_SURFACES.md`
- `docs/architecture/BOUNDARIES_AND_MODULES.md`
- `docs/architecture/EVENT_MODEL.md`
- `docs/architecture/INTERFACES_OVERVIEW.md`
- `docs/architecture/OBSERVABILITY_MODEL.md`
- `docs/architecture/COMPARATIVE_ANALYSIS.md`
- `docs/architecture/PI_INTEGRATION_STRATEGY.md`
- `docs/operations/WORKSPACE_OPERATING_MODEL.md`
- `docs/references/REFERENCE_SYNTHESIS.md`
- `docs/research/OPEN_QUESTIONS.md`

## Intentionally Removed Placeholder Areas

The old placeholder narrative docs under `docs/domains/`, `docs/profiles/`, `docs/sessions/`, and `docs/workflows/` were generic scaffolding and are no longer treated as current documentation.

Use these sources instead:

- `config/domains/*.yaml`
- `config/profiles/*.yaml`
- `config/workflows/*.yaml`
- `docs/architecture/*.md`
- `docs/runbooks/*.md`

## Notes

- `docs/INDEX.md` is the human-first entrypoint.
- `docs/index/docs_manifest.yaml` tracks the docs intentionally surfaced from `docs/INDEX.md`.
- Early bootstrap history contains two accepted `ADR-0001` files; preserve both and do not reuse the number.
