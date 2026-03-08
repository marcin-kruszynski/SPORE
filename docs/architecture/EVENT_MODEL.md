# Event Model

## Purpose

Provide shared contracts for runtime/session/observability events across orchestrator and clients.

## Event Classes

- session lifecycle events
- task/workflow events
- tool invocation events
- review and quality gate events
- operator control events

## Contract Constraints

- stable event envelope with schema version,
- causality metadata (`correlationId`, `parentEventId`),
- project/domain/workflow/session references,
- replay-safe persisted records.
