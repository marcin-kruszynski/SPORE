# ADR-0003: Documentation Governance and Structure

- Status: Proposed
- Date: 2026-03-08

## Context

The SPORE project requires a structured approach to documentation to maintain clarity and consistency across multiple domains. Current documentation is somewhat scattered, and there's no clear rule on how different types of documents should be governed.

## Decision

We will adopt a multi-tiered documentation structure:
- **Vision & Principles**: High-level goals and overarching principles.
- **Architecture**: Domain-specific and system-wide architectural decisions.
- **Decisions (ADR)**: Discrete, versioned decision records for all major changes.
- **Runbooks**: Actionable guides for operators and developers.
- **Specs**: Formal specifications for protocols and interfaces.

All architectural changes MUST be backed by an ADR. ADRs in the `Proposed` state require review by at least one domain lead.

## Consequences

- Improved traceability of architectural decisions.
- Clearer expectations for contributors on where to place documentation.
- Mandatory review process for new ADRs ensures consistency.

## Open Questions

- Should we implement an automated tool to enforce ADR numbering and state transitions?
