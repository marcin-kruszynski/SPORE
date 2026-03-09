# ADR-0004: Standardize Docs ADR-Pass Documentation Flow

- Status: Proposed
- Date: 2026-03-09

## Context

The docs ADR-pass workflow currently requires an ADR-backed documentation pass, but existing decision records are not consistently linked from the shared indexes, making it difficult for operators to discover prior documentation decisions during execution planning.

## Decision

Each docs ADR-pass must produce a dedicated ADR entry capturing:

- the pass-level documentation decision made in that run,
- required index updates (`docs/index/DOCS_INDEX.md`, `docs/index/docs_manifest.yaml`, and `docs/INDEX.md` when a new durable artifact is added),
- and one recorded open question for follow-up governance review.

## Consequences

- ADR output becomes directly discoverable through repository indexes, reducing drift between workflow decisions and documented intent.
- Reviewers can validate that each docs run leaves an auditable governance artifact before execution completion.
- Future docs runs can resolve recurring ambiguities by appending to, rather than recreating, the documented decision history.

## Open Question

Should ADRs for docs-only pass updates include minor stylistic/wording changes, or only decisions that affect architecture, operations, or workflow policy?
