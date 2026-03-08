# Implementation Roadmap

## Phase 0 - Bootstrap and Orientation

### Wave 0.1 - Repository Skeleton
Goal: establish baseline structure.
Inputs: merged bootstrap instruction.
Outputs: directory tree, root docs, placeholders.
Deliverables: skeleton across docs/config/workspace/packages/tools.
Risks: inconsistent naming, missing index links.
Dependencies: none.
Checklist: structure complete, root files present, docs hub created.
Definition of done: repository is navigable and auditable.

### Wave 0.2 - References
Goal: acquire study repositories.
Inputs: reference URL list.
Outputs: cloned references, alias notes.
Deliverables: `references/README.md`, `references/REFERENCE_MANIFEST.md`.
Risks: upstream churn, shallow clone limits.
Dependencies: wave 0.1.
Checklist: all references present, SHA recorded.
Definition of done: references are available and documented.

### Wave 0.3 - Global Documentation
Goal: establish docs operating system.
Inputs: architecture mission and constraints.
Outputs: docs index, manifest, core docs.
Deliverables: `docs/INDEX.md`, `docs/index/DOCS_INDEX.md`, manifest.
Risks: orphan docs.
Dependencies: wave 0.1.
Checklist: canonical docs linked.
Definition of done: no critical docs are unindexed.

## Phase 1 - Documentation OS and Architecture

### Wave 1.1 - Knowledge Classification
Goal: classify docs and policies.
Inputs: bootstrap structure.
Outputs: operations policies and classification docs.
Deliverables: `docs/operations/*` policies.
Risks: ambiguous ownership.
Dependencies: phase 0.
Checklist: policy docs exist and are linked.
Definition of done: contributors know where content belongs.

### Wave 1.2 - Core Architecture
Goal: define boundaries and target model.
Inputs: reference synthesis.
Outputs: architecture docs for runtime/session/workflow/knowledge/ui.
Deliverables: `docs/architecture/*`.
Risks: over-specification before implementation.
Dependencies: wave 1.1.
Checklist: architecture docs present and cross-linked.
Definition of done: execution teams have clear target contracts.

### Wave 1.3 - Initial ADR Set
Goal: lock bootstrap decisions.
Inputs: architecture docs.
Outputs: accepted ADRs for scope and runtime strategy.
Deliverables: ADR-0001/0002.
Risks: decision ambiguity.
Dependencies: wave 1.2.
Checklist: ADRs indexed and visible.
Definition of done: baseline decisions are explicit.

## Phase 2 - Profiles, Domains, and Workflow Composition

### Wave 2.1 - Domain Scaffolding
Goal: define domain boundaries.
Inputs: architecture docs.
Outputs: domain docs and profile seeds.
Deliverables: `docs/domains/*`, `workspace/domain-profiles/*`.
Risks: overlapping domain scope.
Dependencies: phase 1.
Checklist: each domain has scope/responsibilities/open questions.
Definition of done: domain ownership model is clear.

### Wave 2.2 - Agent Profiles
Goal: seed role profiles.
Inputs: role model.
Outputs: agent profile YAMLs.
Deliverables: `workspace/agent-profiles/*`, `config/profiles/*`.
Risks: too generic behavior contracts.
Dependencies: wave 2.1.
Checklist: profile fields populated consistently.
Definition of done: profiles are load-ready examples.

### Wave 2.3 - Workflow and Team Composition
Goal: scaffold execution templates.
Inputs: domain + profile definitions.
Outputs: workflow/team/project configs.
Deliverables: `workspace/workflow-profiles/*`, `workspace/teams/*`, `workspace/projects/*`, `config/workflows/*`.
Risks: invalid assumptions about runtime.
Dependencies: wave 2.2.
Checklist: role sequences and output contracts captured.
Definition of done: composition model is demonstrable.

## Phase 3 - Knowledge Retrieval Foundation

### Wave 3.1 - Bootstrap Doc Search
Goal: define pragmatic local retrieval plan.
Inputs: docs corpus structure.
Outputs: docsearch design docs.
Deliverables: `tools/docsearch/*.md`, `docs/architecture/embeddings-search.md`.
Risks: provider lock-in.
Dependencies: phase 1.
Checklist: provider contract and usage patterns defined.
Definition of done: retrieval design is implementable.

### Wave 3.2 - Provider Abstraction
Goal: ensure backend replaceability.
Inputs: bootstrap search plan.
Outputs: abstraction contracts.
Deliverables: provider contract, collections plan, query recipes.
Risks: abstraction too vague.
Dependencies: wave 3.1.
Checklist: expected inputs/outputs/metadata documented.
Definition of done: backend can be swapped with minimal disruption.

### Wave 3.3 - Agent Usage Patterns
Goal: define how agents consume docs-kb.
Inputs: orchestration and policy docs.
Outputs: planned retrieval hooks and governance constraints.
Deliverables: docs in architecture and operations layers.
Risks: misuse of stale docs.
Dependencies: wave 3.2.
Checklist: retrieval expectations documented by workflow stage.
Definition of done: retrieval behavior is testable in future implementation.

## Phase 4 - Clients, Sessions, and Runtime Planning

### Wave 4.1 - Web Surface Planning
Goal: define operator web console requirements.
Inputs: session/event contracts.
Outputs: web app boundary docs.
Deliverables: `apps/web/README.md`, architecture docs.
Risks: UI-driven architecture drift.
Dependencies: phase 1.
Checklist: web responsibilities and dependencies documented.
Definition of done: web scope is clear and constrained.

### Wave 4.2 - CLI/TUI Planning
Goal: define terminal operator experience.
Inputs: session and observability models.
Outputs: CLI/TUI boundary docs.
Deliverables: `apps/cli/README.md`, `packages/tui/README.md`.
Risks: inconsistent feature parity.
Dependencies: wave 4.1.
Checklist: CLI/TUI contract aligned with web data model.
Definition of done: surfaces share contract assumptions.

### Wave 4.3 - Session Gateway and Contracts
Goal: frame service boundaries.
Inputs: event/session schema placeholders.
Outputs: service responsibility docs and schema seeds.
Deliverables: `services/*/README.md`, `schemas/session/*`, `schemas/event/*`.
Risks: contract instability.
Dependencies: wave 4.2.
Checklist: schema placeholders created and linked.
Definition of done: future services have defined interfaces.

## Phase 5 - Governance and Readiness

### Wave 5.1 - Environment Audit
Goal: verify foundation completeness.
Inputs: all bootstrap artifacts.
Outputs: audit and status report.
Deliverables: `docs/operations/BOOTSTRAP_STATUS.md`.
Risks: hidden gaps in indexing or ownership.
Dependencies: phases 0-4.
Checklist: docs linked, references documented, configs present.
Definition of done: bootstrap readiness is explicit.

### Wave 5.2 - Handoff-Ready State
Goal: define immediate next implementation milestones.
Inputs: audit report.
Outputs: prioritized next steps.
Deliverables: backlog and completion summary updates.
Risks: unclear execution priorities.
Dependencies: wave 5.1.
Checklist: top three next milestones identified.
Definition of done: implementation can start without ambiguity.
