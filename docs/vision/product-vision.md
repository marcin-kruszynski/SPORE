# Product Vision

SPORE is a local-first, documentation-first orchestration platform for governed multi-agent software delivery and supervised self-build.

## Problem

Agentic workflows usually break down in the same places:

- coordination and implementation collapse into one opaque loop,
- architectural decisions disappear into chat history,
- operators cannot inspect, steer, or trust live work,
- repo mutation happens without durable governance, lineage, or recovery paths.

## Product Thesis

SPORE addresses that by separating planning, execution, review, approval, and promotion into explicit roles, workflows, and policy layers.

The product bias is:

- declarative profiles and workflow templates over hardcoded orchestration logic,
- durable sessions, executions, work items, and proposals over transient chat state,
- inspectable local runtime over remote black-box automation,
- operator governance over hidden autonomous side effects,
- documentation, ADRs, and runbooks as first-class inputs to implementation work.

## What SPORE Is Today

SPORE is no longer only a planning foundation.

Today it already includes:

- PI-first runtime planning and launch with tmux-backed inspectable sessions,
- session persistence plus gateway-backed live inspection and narrow control actions,
- orchestrator planning, invocation, durable execution history, review, approval, pause, hold, resume, and lineage-aware execution trees,
- browser, HTTP, TUI, and package-level CLI operator surfaces,
- docs-kb indexing and config validation,
- scenario and regression catalogs with durable run history,
- supervised self-build via goal plans, work-item groups, proposal artifacts, validation, workspace isolation, intake, policy recommendations, quarantine, rollback, and promotion lanes.

## Current Product Boundary

SPORE is currently best described as:

- an executable, inspectable orchestration platform,
- a supervised self-build system with guarded autonomy,
- a local control plane for agent work over one repository.

SPORE is not yet:

- a whole-repo unattended autopilot,
- an auto-merge system to `main`,
- a polished multi-tenant SaaS control plane,
- a finished end-user CLI product in `apps/cli/`.

## Current Direction

The current direction is to deepen governed self-build rather than expand surface area blindly.

Priority themes are:

- better planner and scheduler quality,
- richer validation and promotion readiness,
- stronger integration-branch diagnostics,
- clearer operator mission-control surfaces,
- safer staged autonomy expansion across repository scopes.

## North Star

The long-term goal is a system that can improve its own repository in visible, auditable, policy-gated loops without collapsing operator trust.
