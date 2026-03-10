# ADR-0009: Standardize Open Question Handoff in Docs ADR Passes

- Status: Accepted
- Date: 2026-03-10

## Context

Recent Docs ADR-pass cycles have captured useful architecture and governance questions informally, but unresolved items are not consistently persisted in a durable, indexed location.

## Decision

Each Docs ADR-pass execution now requires the lead-authored ADR for that pass to include exactly one explicitly named open question in the ADR text when ambiguities remain after lead/scout/reviewer passes, so it is auditable and discoverable alongside the pass decision.

The reviewer wave is responsible for validating whether an unresolved item should be recorded as the pass open question. Final disposition ownership for that open question belongs to the lead in the next planning cycle, who must explicitly close, convert, or shelve it in a durable, indexed artifact.

The canonical closure record for that follow-up is the next ADR in the decision series that references the prior open question and records its disposition. A linked planning artifact may carry the execution work created from that disposition, but the decision trail remains authoritative in `docs/decisions/`.

## Consequences

- Every run-level Docs ADR pass produces an ADR artifact that captures both the decision and unresolved follow-up risk.
- Open questions become first-class governance inputs for the next planned pass or review cycle instead of being inferred from chat logs.
- Reviewer and lead responsibilities remain distinct: reviewer validates the unresolved question, while lead owns the next-cycle disposition.
- Open-question closure remains discoverable in the same ADR decision trail even when the outcome is to convert the item into a planning artifact.
- Index and manifest updates remain mandatory for discoverability of the new ADR entry.
