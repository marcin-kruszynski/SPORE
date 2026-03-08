# System Overview

SPORE targets a modular orchestration system where configuration and documentation are first-class assets.

## Structural Model

- Orchestrator coordinates project-level execution.
- Leads own domains and coordinate worker roles.
- Worker roles (Scout, Builder, Tester) execute focused stages.
- Reviewer provides independent gatekeeping.

## Architectural Layers

1. Knowledge and governance layer (`docs/`, `decisions/`, `operations/`).
2. Configuration layer (`config/`, `workspace/`, `schemas/`).
3. Runtime and orchestration layer (`packages/runtime-pi/`, `services/orchestrator/`).
4. Session and observability layer (`packages/session-manager/`, `services/session-gateway/`).
5. Client surfaces (`apps/cli`, `apps/web`, `packages/tui`, `packages/web-ui`).

## Current State

Only layer 1 and 2 are scaffolded with documentation-level planning for layers 3-5.
