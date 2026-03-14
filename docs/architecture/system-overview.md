# System Overview

SPORE is a layered orchestration system where documentation, configuration, runtime state, and operator control are all first-class.

## Structural Model

- `orchestrator` coordinates project- or workflow-level execution.
- `coordinator` owns project-root routing when work spans multiple domain lanes.
- `lead` owns a domain lane.
- `scout`, `builder`, and `tester` execute focused work.
- `reviewer` and `integrator` provide governance and promotion boundaries after implementation work.

## Architectural Layers

1. Knowledge and governance
   - `docs/`
   - `references/`
   - ADRs, runbooks, plans, research
   - `packages/docs-kb/`

2. Configuration and policy
   - `config/profiles/`
   - `config/workflows/`
   - `config/projects/`
   - `config/domains/`
   - `config/policy-packs/`
   - `packages/config-schema/`

3. Runtime and orchestration
   - `packages/runtime-core/`
   - `packages/runtime-pi/`
   - `packages/orchestrator/`
   - `packages/workspace-manager/`
   - `services/orchestrator/`

4. Session and observability
   - `packages/session-manager/`
   - `services/session-gateway/`
   - local SQLite state and event logs

5. Operator surfaces
   - package-level CLIs in `packages/*/src/cli/`
   - `packages/tui/`
   - `apps/web/`

## What Is Actually Implemented

The executable foundation already exists across all five layers.

Active first-party packages and services include:

- `packages/core/`
- `packages/shared-types/`
- `packages/test-support/`
- `packages/docs-kb/`
- `packages/config-schema/`
- `packages/runtime-core/`
- `packages/runtime-pi/`
- `packages/session-manager/`
- `packages/workspace-manager/`
- `packages/orchestrator/`
- `packages/tui/`
- `services/session-gateway/`
- `services/orchestrator/`
- `apps/web/`

Key implemented capabilities include:

- docs-kb indexing and search,
- config validation,
- PI-first runtime planning and launch,
- multi-backend PI runtime adapters with generic runtime artifacts,
- tmux-backed sessions plus SDK-backed runtime modes with live inspection and control history,
- durable workflow execution history and governance,
- execution trees, branch spawning, and grouped execution control,
- scenario and regression run history,
- workspace-backed mutation isolation,
- supervised self-build with goal plans, work-item groups, proposals, validations, promotion candidates, quarantine, rollback, and operator review surfaces.

## Current Product Surface

Today the real operator surface is:

- HTTP services in `services/session-gateway/` and `services/orchestrator/`,
- package-level CLIs and the TUI,
- the thin browser client in `apps/web/`.

The current browser surface is no longer just a minimal shell. It includes Agent Cockpit, Mission Map, Operator Chat, lane detail, self-build dashboards, and evidence/project/workflow reads over the shared HTTP surfaces.

`apps/cli/` is still a scaffold-only future app, so "CLI" currently means the package-level CLIs and TUI commands rather than a separate polished app shell.

## Reserved Or Scaffold-Only Areas

These paths exist but are not the main product surface today:

- `apps/cli/`
- `packages/shared/`
- `packages/shared-config/`
- `packages/web-ui/`
- `services/indexer/`

Treat them as reserved or exploratory until they gain a real implementation role and are promoted into the canonical docs.

## Current Maturity Statement

SPORE is past the pure-bootstrap stage.

The current work is not "make the repo exist." It is "make supervised self-build deeper, safer, more legible, and more repeatable."
