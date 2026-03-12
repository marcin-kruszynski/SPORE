# ADR-0013: Add Durable Workflow Handoffs And Runtime Role Input Contracts

- Status: Accepted
- Date: 2026-03-12

## Context

SPORE already preserves durable workflow state, proposal artifacts, workspace metadata, review decisions, and builder-to-tester snapshot evidence.

That is enough to drive the current executable slice, but it is still weak in one important area:

- `lead`, `scout`, `builder`, `tester`, and `reviewer` do not all leave behind first-class, normalized handoff artifacts,
- downstream sessions mostly rely on docs-kb retrieval, parent session lineage, and ad hoc transcript interpretation,
- builder-to-tester workspace snapshot handoff exists, but it is role-specific and not part of a generic workflow handoff model,
- several profiles reference role prompt overlays that do not exist yet, which leaves runtime behavior under-specified.

The result is a gap between the intended role model and the durable runtime contract.

## Decision

SPORE will add a first-class `workflow_handoffs` contract that sits between raw session transcripts and higher-level governed artifacts such as proposals.

Rules:

- every settled workflow step publishes one primary semantic handoff,
- some steps may also publish auxiliary evidence handoffs,
- downstream steps consume curated inbound handoffs through runtime context and invocation briefs,
- builder-to-tester snapshot handoff remains the authoritative file-level verification path, but it is also represented as a workflow handoff artifact,
- role prompt overlays must explicitly describe the required output handoff shape for each role,
- the orchestrator owns handoff extraction, normalization, persistence, and downstream selection.

The canonical semantic chain for the current implementation workflows is:

- `lead -> task_brief`
- `scout -> scout_findings`
- `builder -> implementation_summary`
- `builder -> workspace_snapshot` as auxiliary evidence
- `tester -> verification_summary`
- `reviewer -> review_summary`

Selection remains wave-aware and role-optional so workflows without `scout`, workflows with `orchestrator`, and partial-unlock exploration waves are still valid.

## Consequences

- SPORE gains a durable, inspectable role-to-role artifact chain without introducing unrestricted agent messaging.
- Runtime sessions can receive richer upstream context without scraping parent transcripts directly.
- Builder/tester verification remains snapshot-based and reproducible.
- Proposal and promotion surfaces can reference workflow handoffs as supporting evidence instead of acting as the only durable summary layer.
- Session-gateway, orchestrator HTTP routes, TUI, and Web UI all need additive read-surface updates so operators can inspect handoff summaries and linked evidence.
- Missing role overlays for `orchestrator`, `scout`, `builder`, and `tester` become required implementation work instead of optional future polish.
