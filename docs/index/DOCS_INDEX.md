# SPORE Docs Operating Index

## What Exists

### Vision
- `docs/vision/product-vision.md`
- `docs/vision/principles.md`
- `docs/vision/glossary.md`

### Architecture
- `docs/architecture/system-overview.md`
- `docs/architecture/role-model.md`
- `docs/architecture/runtime-model.md`
- `docs/architecture/session-model.md`
- `docs/architecture/config-model.md`
- `docs/architecture/workflow-model.md`
- `docs/architecture/ui-model.md`
- `docs/architecture/knowledge-model.md`
- `docs/architecture/embeddings-search.md`
- `docs/architecture/EVENT_MODEL.md`
- `docs/architecture/OBSERVABILITY_MODEL.md`
- `docs/architecture/CLIENTS_AND_SURFACES.md`
- `docs/architecture/PI_INTEGRATION_STRATEGY.md`
- `docs/architecture/COMPARATIVE_ANALYSIS.md`

### Planning and Governance
- `docs/plans/roadmap.md`
- `docs/plans/environment-phases.md`
- `docs/plans/implementation-waves.md`
- `docs/plans/backlog.md`
- `docs/plans/bootstrap-completion-summary.md`
- `docs/plans/self-build-status-and-next-steps.md`
- `docs/plans/builder-tester-verification-workspaces.md`
- `docs/plans/long-range-self-build-roadmap.md`
- `docs/plans/project-coordinator-role-plan.md`
- `docs/plans/feature-integrator-role-plan.md`
- `docs/plans/javascript-to-typescript-migration-plan.md`
- `docs/roadmap/IMPLEMENTATION_ROADMAP.md`
- `docs/operations/WORKSPACE_OPERATING_MODEL.md`
- `docs/operations/BOOTSTRAP_STATUS.md`
- `docs/operations/DOC_UPDATE_POLICY.md`
- `docs/operations/KNOWLEDGE_CLASSIFICATION.md`
- `docs/operations/DECISION_POLICY.md`
- `docs/operations/SESSION_NOTES_POLICY.md`

### Decisions
- `docs/decisions/ADR-0001-project-scope.md`
- `docs/decisions/ADR-0001-repo-foundation.md`
- `docs/decisions/ADR-0002-runtime-pi-first.md`
- `docs/decisions/ADR-0003-documentation-governance.md`
- `docs/decisions/ADR-0004-docs-adr-pass-process.md`
- `docs/decisions/ADR-0005-builder-tester-verification-workspaces.md`
- `docs/decisions/ADR-0006-project-coordinator-role.md`
- `docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md`
- `docs/decisions/ADR-0008-typescript-first-codebase.md`
- `docs/decisions/adr-template.md`

### Specs
- `docs/specs/spec-template.md`
- `docs/specs/environment-bootstrap.md`
- `docs/specs/docs-search-tool.md`
- `docs/specs/bootstrap-architect-instruction.md`
- `docs/specs/worktree-and-workspace-isolation.md`

### References and Research
- `references/README.md`
- `references/REFERENCE_MANIFEST.md`
- `docs/references/REFERENCE_SYNTHESIS.md`
- `docs/research/overstory-notes.md`
- `docs/research/gastown-notes.md`
- `docs/research/pi-notes.md`
- `docs/research/beads-notes.md`
- `docs/research/mulch-notes.md`
- `docs/research/agentic-engineering-notes.md`
- `docs/research/OPEN_QUESTIONS.md`

### Domains
- `docs/domains/frontend/`
- `docs/domains/backend/`
- `docs/domains/infra/`
- `docs/domains/agent-runtime/`
- `docs/domains/session-ui/`
- `docs/domains/knowledge/`
- `docs/domains/orchestration/`
- plus architecture shorthand domains under `docs/domains/cli/` and `docs/domains/shared/`

## What Is Missing

- Production runtime implementation.
- Real event bus and session broker.
- Write-side control API for live sessions.
- Operationally complete Web UI surface.
- Long-running PI session steering and richer event transport.

## What Is Planned

- Phase-driven execution in `docs/roadmap/IMPLEMENTATION_ROADMAP.md`.
- Long-range supervised self-build execution in `docs/plans/long-range-self-build-roadmap.md`.
- Knowledge retrieval foundation from `tools/docsearch/` and `packages/docs-kb/`.
- PI-first runtime adapter strategy from `docs/architecture/PI_INTEGRATION_STRATEGY.md`.
- Gateway-backed clients and richer runtime control paths.

## Current Coordination Boundary

- project-root coordination is now modeled explicitly as `orchestrator -> coordinator -> lead`
- explicit promotion is now modeled as `coordinator -> integrator`
- legacy domain workflow plan/invoke paths remain valid and unchanged
- proposal approval is not treated as merge to the target branch
