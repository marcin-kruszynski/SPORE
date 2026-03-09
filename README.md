<div align="center">

```
   _____ ____  ____  ____  ______
  / ___// __ \/ __ \/ __ \/ ____/
  \__ \/ /_/ / / / / /_/ / __/   
 ___/ / ____/ /_/ / _, _/ /___   
/____/_/    \____/_/ |_/_____/   
```

### Swarm Protocol for Orchestration, Rituals & Execution

A modular, profile-driven, documentation-first foundation<br/>for multi-agent orchestration across software projects.

---

**Documentation-First** · **Profile-Driven** · **Local-First** · **PI-Runtime** · **Human-Steerable**

</div>

---

## Table of Contents

- [Vision](#vision)
- [Core Principles](#core-principles)
- [Architecture Overview](#architecture-overview)
- [Role Hierarchy](#role-hierarchy)
- [Session Lifecycle](#session-lifecycle)
- [Workflow Orchestration](#workflow-orchestration)
- [System Layers](#system-layers)
- [Package Map](#package-map)
- [Configuration Model](#configuration-model)
- [Data Architecture](#data-architecture)
- [Operator Surfaces](#operator-surfaces)
- [End-to-End Flow](#end-to-end-flow)
- [Current Stage](#current-stage)
- [Getting Started](#getting-started)
- [Working Commands](#working-commands)
- [Repository Structure](#repository-structure)
- [Design Influences](#design-influences)
- [Documentation](#documentation)
- [License](#license)

---

## Vision

Agentic workflows fail for three predictable reasons:

1. **They mix implementation with coordination** -- agents try to do everything at once.
2. **They hide architectural intent in chat** -- decisions vanish after the session ends.
3. **They provide weak inspectability** -- operators cannot see, steer, or trust what agents are doing.

SPORE addresses this by building a **structured orchestration protocol** where:

- An **orchestrator** dispatches work through **domain-aware leads**.
- Leads decompose tasks across **specialized workers** (scouts, builders, testers).
- An independent **reviewer** provides quality gates with approve/revise/reject verdicts.
- Every agent runs in a **durable, inspectable session** backed by tmux.
- All behavior is driven by **declarative profiles and workflow templates**, not hardcoded logic.
- **Documentation and decisions are first-class artifacts**, not afterthoughts.

### North Star Outcomes

| Outcome | How SPORE Achieves It |
|---|---|
| Faster multi-project execution with governance | Orchestrator-to-lead-to-worker delegation with workflow templates |
| Predictable quality gates | Reviewer lanes with approve/revise/reject handoff policies |
| Human-steerable transparent runtime | Live tmux sessions, SSE event streams, operator control actions |
| Strong retrieval of prior decisions | Local-first docs knowledge base with keyword + semantic search |
| Domain-shaped execution behavior | Domain policies override retries, watchdogs, session mode, and docs retrieval |
| Coordinated execution families | Rooted execution trees, branch spawning, and lineage-aware group control |
| Parallel work inside one execution | Workflow step sets become launch waves with multiple active steps |
| Durable operator validation loops | Scenario and regression catalogs with rerun, trends, reports, run-center summaries, and live session diagnostics |
| Actionable operator triage | Run-center alerts, explicit failure classification, and recovery suggestions on runs and live sessions |
| Snapshot-based final verification | Builder authoring workspaces hand off git-backed snapshots to separate tester verification workspaces |

---

## Core Principles

```
 1. Documentation-first              7. Observability before scale
 2. Local-first by default           8. Live inspectability of active agents
 3. Composable over monolithic       9. Human-steerable orchestration
 4. Profiles over hardcoded roles   10. Clear planning/execution/review boundaries
 5. Templates over ad hoc            11. Safe incrementalism
 6. Runtime abstraction, PI-first   12. Reference, do not clone
```

---

## Architecture Overview

SPORE is organized into five distinct architectural layers, each with clear ownership boundaries:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    5. CLIENT SURFACES                               │
│         ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│         │   CLI    │   │   TUI    │   │  Web UI  │                │
│         └────┬─────┘   └────┬─────┘   └────┬─────┘                │
│              │              │               │                       │
├──────────────┼──────────────┼───────────────┼───────────────────────┤
│              4. SESSION & OBSERVABILITY                              │
│         ┌────┴──────────────┴───────────────┴────┐                 │
│         │         Session Gateway (HTTP)          │                 │
│         │    status · events · artifacts · SSE    │                 │
│         │    control: stop · complete · steer     │                 │
│         └────────────────┬───────────────────────┘                 │
│                          │                                          │
│         ┌────────────────┴───────────────────────┐                 │
│         │         Session Manager (SQLite)        │                 │
│         │  lifecycle · metadata · events · feed   │                 │
│         │  reconciliation · detached recovery     │                 │
│         └────────────────────────────────────────┘                 │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│              3. RUNTIME & ORCHESTRATION                              │
│    ┌────────────────────┐     ┌─────────────────────────┐          │
│    │   Orchestrator     │     │     Runtime PI           │          │
│    │  plan · invoke     │     │  plan · launch · steer   │          │
│    │  drive · review    │     │  pi-rpc · pi-json · stub │          │
│    │  approve · reject  │     │  tmux-backed execution   │          │
│    └────────┬───────────┘     └──────────┬──────────────┘          │
│             │     step-by-step drive      │                         │
│             └─────────────────────────────┘                         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│              2. CONFIGURATION                                       │
│    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│    │ Profiles │ │ Workflows│ │ Projects │ │ Domains  │            │
│    │  6 roles │ │ 4 types  │ │  compose │ │  4 areas │            │
│    └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│    ┌──────────┐ ┌──────────┐ ┌───────────────────────┐            │
│    │  Teams   │ │  System  │ │  JSON Schema Validation│            │
│    │  2 seeds │ │ defaults │ │  12 schema definitions │            │
│    └──────────┘ └──────────┘ └───────────────────────┘            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│              1. KNOWLEDGE & GOVERNANCE                               │
│    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│    │   Docs   │ │   ADRs   │ │ Research │ │ Docs KB  │            │
│    │  111 md  │ │ decisions│ │  6 repos │ │  SQLite  │            │
│    │  files   │ │  tracked │ │ analyzed │ │  search  │            │
│    └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

**Boundary rules:**
- Knowledge retrieval is never hidden inside the orchestrator.
- Session metadata is never UI-specific.
- Clients never own domain logic.
- Runtime details never leak into config without an explicit adapter.

---

## Role Hierarchy

SPORE now uses eight architectural roles. Concrete behavior is attached via **profiles** -- the same role can have domain-specific variants (e.g., `backend-builder`, `docs-scout`, `browser-tester`).

```
                        ┌──────────────┐
                        │  HUMAN       │
                        │  OPERATOR    │
                        └──────┬───────┘
                               │ directs
                        ┌──────▼───────┐
                        │ ORCHESTRATOR │
                        └──────┬───────┘
                               │ portfolio / project dispatch
                        ┌──────▼───────┐
                        │ COORDINATOR  │
                        │ project root │
                        └──────┬───────┘
                               │ delegates to domain
               ┌───────────────┼───────────────┐
               │               │               │
        ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
        │    LEAD     │ │    LEAD    │ │    LEAD    │
        │  (backend)  │ │ (frontend) │ │   (cli)    │
        │             │ │            │ │            │
        │ Decomposes  │ │ Decomposes │ │ Decomposes │
        │ tasks,      │ │ tasks,     │ │ tasks,     │
        │ invokes     │ │ invokes    │ │ invokes    │
        │ workers     │ │ workers    │ │ workers    │
        └──────┬──────┘ └────────────┘ └────────────┘
               │                                      ┌────────────┐
               │                                      │ INTEGRATOR │
               │                                      │ promotion  │
               │                                      └────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼────┐ ┌───▼────┐     ┌──────────┐
│ SCOUT │ │BUILDER │ │ TESTER │     │ REVIEWER │
│       │ │        │ │        │     │          │
│Research│ │Implement│ │Validate│ ──► │ Quality  │
│explore│ │ code   │ │ verify │     │ gate     │
│analyze│ │ docs   │ │ report │     │ approve/ │
│       │ │        │ │        │     │ revise/  │
└───────┘ └────────┘ └────────┘     │ reject   │
                                     └──────────┘
```

| Role | Session Mode | Core Responsibility |
|---|---|---|
| **Orchestrator** | persistent | Portfolio and top-level workflow coordinator |
| **Coordinator** | persistent | Project-root coordinator over one execution family; read-mostly by default |
| **Lead** | persistent | Domain-scoped coordinator; task decomposition; worker invocation |
| **Scout** | ephemeral | Research-first exploration; source/docs analysis; findings handoff |
| **Builder** | ephemeral | Implementation-focused; produces code and artifacts; requires review |
| **Tester** | ephemeral | Validation; runs tests/probes/checklists; reports defects with evidence |
| **Reviewer** | ephemeral | Independent quality gate; approve/revise/reject verdicts |
| **Integrator** | ephemeral | Explicit post-review promotion lane using a dedicated integration workspace |

---

## Session Lifecycle

Every agent runs in a **durable, inspectable session**. Sessions are backed by tmux for live terminal inspection, tracked in SQLite for metadata, and observable through NDJSON event logs.

```
                    ┌─────────┐
                    │ PLANNED │
                    └────┬────┘
                         │ launch
                    ┌────▼────┐
                    │STARTING │
                    └────┬────┘
                         │ agent responds
                    ┌────▼────┐
             ┌──────│ ACTIVE  │──────┐
             │      └────┬────┘      │
             │           │           │
        operator    task done    error/timeout
        pause            │           │
             │      ┌────▼─────┐ ┌───▼────┐
             │      │COMPLETED │ │ FAILED │
             │      └──────────┘ └────────┘
        ┌────▼────┐
        │ PAUSED  │      operator    ┌─────────┐
        └─────────┘      stop ──────►│ STOPPED │
                                     └─────────┘
              operator cancel        ┌──────────┐
              ──────────────────────►│ CANCELED │
                                     └──────────┘

        All terminal states ──────►  ┌──────────┐
                                     │ ARCHIVED │
                                     └──────────┘
```

**Session metadata links to:** project, domain, team, workflow template, task/goal, role profile, parent/child relationships, tmux session name, launcher type, launch command.

**Per-session artifacts** (stored in `tmp/sessions/`):

| Artifact | Format | Purpose |
|---|---|---|
| `<id>.plan.json` | JSON | Session launch plan |
| `<id>.context.json` | JSON | Startup retrieval context from docs-kb |
| `<id>.prompt.md` | Markdown | Generated system prompt |
| `<id>.launch.sh` | Bash | tmux launch script |
| `<id>.transcript.md` | Markdown | Live-appended session transcript |
| `<id>.pi-events.jsonl` | NDJSON | Raw PI event stream |
| `<id>.pi-session.jsonl` | NDJSON | RPC session log |
| `<id>.control.ndjson` | NDJSON | Control message queue |
| `<id>.exit.json` | JSON | Process exit code |
| `<id>.rpc-status.json` | JSON | RPC runner state snapshot |

---

## Workflow Orchestration

Workflows are **durable, multi-step execution plans** with built-in review and approval gates. The orchestrator drives each step sequentially, launching sessions and monitoring completion.

Workflow behavior now also passes through a merged domain policy layer. The effective execution policy is composed from:

- workflow defaults from `config/workflows/*.yaml`
- domain defaults from `config/domains/*.yaml`
- project-specific domain overrides from `config/projects/* activeDomains[]`

That policy currently controls:

- default role sets when a caller does not specify roles,
- per-role retry limits,
- step watchdog soft and hard timeouts,
- reviewer-step review and approval requirements,
- per-role session mode overrides,
- role-scoped workspace defaults for the canonical builder/tester verification handoff,
- startup retrieval query terms and result limits for `docs-kb`.

Reusable policy packs in `config/policy-packs/` can feed those same merged blocks before raw domain and project overrides are applied.

The merged policy is snapshotted into each execution and step record at creation time so later config edits do not erase the provenance of a past run.

Workflow templates can now define `stepSets` with explicit wave gates:

- `all`
- `any`
- `min_success_count`

This lets one execution express both strict sequential stages and partially unlocked parallel work.

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKFLOW EXECUTION                            │
│                                                                 │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │  PLAN   │──►│ RUNNING  │──►│ WAITING  │──►│  WAITING    │ │
│  │         │   │          │   │ REVIEW   │   │  APPROVAL   │ │
│  └─────────┘   └──────────┘   └──────────┘   └──────┬──────┘ │
│                                                       │        │
│                          ┌───────────────┬────────────┤        │
│                          │               │            │        │
│                    ┌─────▼─────┐  ┌──────▼───┐ ┌─────▼─────┐ │
│                    │ COMPLETED │  │ REJECTED │ │  FAILED   │ │
│                    └───────────┘  └──────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Step execution within a workflow:**

```
                ┌───────────────────────────────────────────┐
  Step 1        │  Scout   ─── research & findings ───────► │
  (scout)       └───────────────────────────────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────────┐
  Step 2        │  Builder ─── implement & document ──────► │
  (builder)     └───────────────────────────────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────────┐
  Step 3        │  Tester  ─── validate & report ─────────► │
  (tester)      └───────────────────────────────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────────┐
  Step 4        │  Reviewer ── approve / revise / reject ─► │
  (reviewer)    └───────────────────────────────────────────┘
                                    │
                            ┌───────┼───────┐
                            │       │       │
                         approve  revise  reject
                            │       │       │
                            ▼       ▼       ▼
                         proceed  retry   fail
```

**Step watchdog:** soft timeout (20s) sends a steer message; hard timeout (45s) sends abort.

### Seeded Workflow Templates

| Workflow | Trigger | Role Sequence | Review Required | Max Retries |
|---|---|---|---|---|
| `feature-delivery` | manual | orchestrator -> lead -> scout -> builder -> tester -> reviewer | yes | 2 |
| `bugfix` | manual | orchestrator -> lead -> builder -> tester -> reviewer | yes | 3 |
| `research-spike` | manual | orchestrator -> lead -> scout -> reviewer | no | 1 |
| `review-pass` | handoff | lead -> reviewer | yes | 1 |

---

## System Layers

### Layer 1: Knowledge & Governance

The documentation operating system is the project's backbone. Every architectural change must produce a doc update. Decisions are tracked as ADRs. Knowledge is classified by type, domain, status, and owner.

```
docs/
├── vision/            Product vision, principles, glossary
├── architecture/      System overview, session/runtime/event/config/role/workflow models
├── decisions/         Architecture Decision Records (ADR-XXXX-topic.md)
├── research/          Reference study notes (overstory, gastown, mulch, beads, pi, book)
├── specs/             Formal specifications
├── plans/             Roadmap, backlog, implementation waves
├── roadmap/           13-wave implementation roadmap across 5 phases
├── operations/        Policies (decisions, docs, knowledge, sessions, workspace)
├── runbooks/          Local dev, doc maintenance, reference sync, bootstrap
├── domains/           9 domain scaffolds (frontend, backend, cli, agent-runtime, ...)
├── templates/         Doc, profile, project, research, workflow templates
└── index/             DOCS_INDEX.md + docs_manifest.yaml
```

**Docs KB** (`packages/docs-kb/`) provides local-first search:
- SQLite-backed index with documents, chunks, and embeddings
- Heading-aware markdown chunking (target 900 chars)
- Blended keyword + semantic scoring (FNV-1a hash embeddings)
- CLI: `docs-kb index | search "query" | status | rebuild`

### Layer 2: Configuration

All configuration is declarative YAML, validated against 12 JSON schemas.

```
config/
├── profiles/     6 role profiles (orchestrator, lead, builder, reviewer, scout, tester)
├── workflows/    4 workflow templates (feature-delivery, bugfix, research-spike, review-pass)
├── projects/     1 example project (multi-domain platform)
├── domains/      4 domain configs (backend, frontend, cli, docs)
├── teams/        2 team compositions (service-team, web-app-team)
└── system/       4 system configs (defaults, runtime, observability, permissions)
```

### Layer 3: Runtime & Orchestration

**Runtime PI** translates SPORE profiles into PI session plans and manages tmux-backed execution with three launcher modes:

| Launcher | Mode | Use Case |
|---|---|---|
| `pi-rpc` | `pi --mode rpc` | **Primary.** Full bidirectional RPC: steer, follow_up, prompt, abort, get_state |
| `pi-json` | `pi --mode json` | Debug. One-shot JSON event streaming |
| `stub` | no pi needed | Fallback. Simulates session for testing without PI |

**Orchestrator** drives multi-step durable workflow executions with review/approval gates, step watchdogs, retry/rework branching, escalation records, and execution state persistence in SQLite.

### Layer 4: Session & Observability

**Session Manager** provides the lifecycle state machine, SQLite metadata store, NDJSON event log, follow-mode feed, and detached session reconciliation.

**Event model** uses a shared metadata envelope:

```json
{
  "id": "uuid",
  "type": "session.active",
  "timestamp": "ISO-8601",
  "runId": "...",
  "sessionId": "...",
  "agentIdentityId": "...",
  "payload": { ... }
}
```

Currently emitted events:
- Lifecycle: `session.planned`, `session.starting`, `session.active`, `session.completed`, `session.failed`, `session.stopped`
- Control: `session.stop_requested`, `session.complete_requested`, `session.steer`
- Workflow: `workflow.execution.created`, `workflow.step.planned|started|completed|review_pending|retry_scheduled|failed`, `workflow.review.*`, `workflow.approval.*`, `workflow.execution.completed|escalated`
- Recovery: `workflow.execution.resumed`, `workflow.escalation.resolved`

### Layer 5: Client Surfaces

| Surface | Port | Technology | Status |
|---|---|---|---|
| **TUI** | terminal | Node CLI | Implemented (dashboard + inspect) |
| **Session Gateway** | 8787 | `node:http` | Implemented (REST + SSE) |
| **Orchestrator Service** | 8789 | `node:http` | Implemented (workflow CRUD + control) |
| **Web Console** | 8788 | Vanilla JS SPA | Implemented (proxies to gateway + orchestrator) |
| **CLI** | terminal | planned | Scaffold only |

---

## Package Map

```
packages/
├── docs-kb/            Local documentation indexing & search (SQLite)
├── config-schema/      YAML parsing & JSON schema validation
├── runtime-pi/         PI runtime integration (plan, launch, steer)
├── session-manager/    Session lifecycle, metadata store, event log
├── orchestrator/       Workflow planning, execution, review gates
├── workspace-manager/  Git worktree provisioning, inspection, cleanup
├── tui/                Terminal operator dashboard & session inspector
├── core/               [scaffold] Shared orchestration contracts
├── shared/             [scaffold] Shared utilities
├── shared-config/      [scaffold] Shared config helpers
├── shared-types/       [scaffold] Schema-derived types
└── web-ui/             [scaffold] Browser operator surfaces

services/
├── session-gateway/    HTTP API: sessions, events, artifacts, SSE, control
├── orchestrator/       HTTP API: workflow plan, invoke, drive, review, approve
└── indexer/            [scaffold] Future indexing service

apps/
├── web/                Browser operator console (SPA + proxy server)
└── cli/                [scaffold] Future CLI application
```

### Internal Dependency Graph

```
config-schema ─────────────────────────────────── (standalone)
docs-kb ───────────────────────────────────────── (standalone)

runtime-pi ──────┬── config-schema (YAML parsing)
                 ├── docs-kb (context retrieval)
                 └── session-manager (session records)

session-manager ─┬── runtime-pi (tmux ops for reconcile)
                 └── (SQLite stores)

orchestrator ────┬── config-schema (YAML parsing)
                 ├── runtime-pi (session launch + control queue)
                 └── session-manager (session state queries)

tui ─────────────┬── session-manager (store + events)
                 └── runtime-pi (tmux pane capture)

session-gateway ─┬── session-manager (store + events + actions)
                 └── runtime-pi (tmux + control queue)

web ─────────────┬── proxies to session-gateway (:8787)
                 └── proxies to orchestrator-service (:8789)
```

**Zero external dependencies.** The entire codebase runs on Node built-in modules (`node:fs`, `node:path`, `node:crypto`, `node:http`, `node:sqlite`, `node:child_process`, `node:stream`).

---

## Configuration Model

Configuration is no longer only descriptive. Domain and project config now affect live execution behavior.

Profiles are the central abstraction. A profile defines **what an agent is, what it can do, and how it behaves**:

```yaml
# config/profiles/builder.yaml
id: builder
name: Builder
role: builder
description: Implementation-focused agent producing code and documentation
domain: any
runtime: pi
systemPromptRef: .pi/prompts/builder.md
skills:
  - code-generation
  - refactoring
  - documentation-update
tools:
  - editor
  - terminal
  - docs-search
permissions:
  - workspace-write
  - run-tests
sessionMode: ephemeral
reviewPolicy: required
handoffPolicy: artifact-plus-summary
docsPolicy: update-with-changes
telemetryPolicy: standard
```

**Projects** compose domains, teams, profiles, and workflows into a deployable unit:

```yaml
# config/projects/example-project.yaml
id: example-platform
name: Example Platform Project
type: multi-domain-platform
activeDomains: [frontend, backend, cli]
attachedTeams: [service-team, web-app-team]
workflowDefaults:
  defaultWorkflow: feature-delivery
  reviewRequired: true
```

**Policy-carrying domains** can now supply executable defaults:

```yaml
# config/domains/backend.yaml
workflowPolicy:
  defaultRoles: [lead, builder, tester, reviewer]
  stepSoftTimeoutMs: 30000
  stepHardTimeoutMs: 90000
  defaultMaxAttempts: 3
  maxAttemptsByRole:
    builder: 4
runtimePolicy:
  sessionModeByRole:
    lead: persistent
    builder: ephemeral
docsKbPolicy:
  resultLimit: 6
  queryTerms: [backend, service, api, integration]
```

---

## Data Architecture

All runtime state is local-first, using SQLite with WAL mode for concurrent reads.

```
data/
├── docs-index/
│   └── spore-docs.sqlite       Docs KB: documents, chunks, embeddings
├── state/
│   ├── spore-sessions.sqlite   Session metadata (23 columns)
│   ├── spore-orchestrator.sqlite  Workflow executions, steps, reviews, approvals, events, escalations
│   └── events.ndjson           Session lifecycle event log
├── embeddings/                 Embedding storage (future)
└── cache/                      Runtime cache (future)

tmp/
├── sessions/                   Per-session artifacts (plans, prompts, transcripts, ...)
└── orchestrator/               Per-execution step briefs
```

---

## Operator Surfaces

### Session Gateway API (port 8787)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/status` | Aggregate status (counts by state, active sessions) |
| `GET` | `/sessions` | List all sessions |
| `GET` | `/sessions/:id` | Session detail + events + artifact summary |
| `GET` | `/sessions/:id/artifacts` | Artifact file metadata |
| `GET` | `/sessions/:id/artifacts/:name` | Read artifact content |
| `GET` | `/events` | Filtered event log (`?session=`, `?run=`, `?type=`, `?since=`, `?limit=`) |
| `GET` | `/stream/events` | **SSE** live event stream with heartbeats |
| `POST` | `/sessions/:id/actions/stop` | Stop a session |
| `POST` | `/sessions/:id/actions/mark-complete` | Mark session completed |
| `POST` | `/sessions/:id/actions/steer` | Send steer/follow-up message |

### Orchestrator Service API (port 8789)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/executions` | List all workflow executions |
| `GET` | `/executions/:id` | Execution detail (steps, reviews, approvals, events, escalations) |
| `GET` | `/executions/:id/children` | Child execution list for lineage-aware clients |
| `GET` | `/coordination-groups` | Coordination-group summaries |
| `GET` | `/coordination-groups/:id` | Coordination-group detail and grouped execution state |
| `GET` | `/executions/:id/events` | Workflow event history for one execution |
| `GET` | `/executions/:id/escalations` | Escalation records for one execution |
| `GET` | `/stream/executions?execution=:id` | **SSE** live workflow event stream for one execution |
| `POST` | `/workflows/plan` | Plan a workflow invocation |
| `POST` | `/workflows/invoke` | Create and drive a workflow execution |
| `POST` | `/executions/:id/drive` | Drive execution forward |
| `POST` | `/coordination-groups/:id/drive` | Drive a grouped execution family forward |
| `POST` | `/executions/:id/pause` | Pause execution without treating it as failure |
| `POST` | `/executions/:id/hold` | Hold execution for coordination/dependency waiting |
| `POST` | `/executions/:id/resume` | Resume a paused or held execution |
| `POST` | `/executions/:id/review` | Submit review decision |
| `POST` | `/executions/:id/approval` | Submit approval decision |
| `POST` | `/executions/:id/escalations/:escalationId/resolve` | Resolve escalation and optionally resume execution |

### Web Console (port 8788)

A vanilla JavaScript SPA that proxies to both services, providing:
- Status dashboard with session counts by state
- Coordination-group aware execution list with root/child grouping and branch cues
- Execution detail view (coordination/lineage board, step/session tree, event timeline, decision log, escalation history)
- Execution lifecycle management (drive execution, drive group, pause, hold, resume, review, approve)
- Escalation recovery actions (resolve, resolve + resume)
- Session detail view (events, transcript, PI events, artifacts)
- Session control actions (stop, mark-complete, steer)
- Workflow invocation form
- Live SSE event streaming

### Terminal UI

```bash
npm run ops:dashboard              # Status overview with session table & recent events
npm run ops:dashboard -- --watch   # Continuous refresh
npm run ops:inspect -- --session <id>  # Deep session inspection with tmux pane capture
```

---

## End-to-End Flow

### Single Session Launch

```
 Profile YAML                        docs-kb
 + Project YAML                      (SQLite)
       │                                │
       ▼                                │
 ┌─────────────┐    query context  ┌────▼──────┐
 │  Plan Build  │ ────────────────►│  Context   │
 │  (runtime-pi)│                  │  Builder   │
 └──────┬──────┘                   └────┬───────┘
        │                               │
        │ plan.json + context.json      │
        │ + prompt.md + launch.sh       │
        ▼                               │
 ┌──────────────┐    create record ┌────▼───────┐
 │ Session      │ ────────────────►│  Session   │
 │ Launcher     │                  │  Manager   │
 │ (tmux-backed)│                  │  (SQLite)  │
 └──────┬───────┘                  └────────────┘
        │
        │ tmux new-session
        ▼
 ┌──────────────┐    events.ndjson
 │ PI RPC Runner│ ──────────────────► event log
 │ (pi --mode   │    transcript.md
 │  rpc)        │ ──────────────────► artifacts
 └──────┬───────┘    control.ndjson
        │          ◄──────────────── operator steer
        │
        ▼
 exit.json ──► reconciler ──► state transition
```

### Orchestrated Workflow

```
 Workflow YAML              Profile + Project
 + Domain + Roles               configs
       │                          │
       ▼                          ▼
 ┌──────────────────────────────────────┐
 │       Orchestrator: Plan             │
 │  Resolve profiles per domain/role    │
 │  Build multi-step invocation plan    │
 └──────────────────┬───────────────────┘
                    │
                    ▼
 ┌──────────────────────────────────────┐
 │       Orchestrator: Invoke           │
 │  Create durable execution record     │
 │  Create step records in SQLite       │
 └──────────────────┬───────────────────┘
                    │
          ┌─────────▼─────────┐
          │  Drive Execution  │◄──── step watchdog
          │  (step by step)   │      (soft 20s, hard 45s)
          └─────────┬─────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
 Step 1          Step 2          Step N
 (scout)         (builder)       (reviewer)
 launch ──►      launch ──►      launch ──►
 session         session         session
 wait ◄──        wait ◄──        wait ◄──
 complete        complete        complete
                                    │
                              ┌─────▼──────┐
                              │  Review    │
                              │  Gate      │
                              ├────────────┤
                              │  approve   │──► execution completed
                              │  revise    │──► retry step
                              │  reject    │──► execution failed
                              └────────────┘
```

---

## Current Stage

This repository is in the **bootstrap-plus-executable-foundation** phase.

### What is implemented

| Area | Status | Details |
|---|---|---|
| Documentation OS | **Complete** | 111 docs, manifest, indices, policies, 9 domain scaffolds |
| Configuration | **Complete** | 21 YAML configs, 12 JSON schemas, CLI validator |
| Docs KB | **Working** | SQLite index, keyword + semantic search, incremental reindex |
| Runtime PI | **Working** | Session planning, tmux launch, pi-rpc/pi-json/stub launchers |
| Session Manager | **Working** | SQLite store, lifecycle FSM, event log, feed, reconciliation |
| Orchestrator | **Working** | Workflow plan/invoke/drive, step-set waves, tree governance, retry/rework branching, escalation tracking, escalation resume, durable execution |
| TUI | **Working** | Dashboard (watch mode), session inspection, tmux pane capture |
| Session Gateway | **Working** | REST API, SSE streaming, control actions (stop/complete/steer) |
| Web Console | **Working** | SPA over gateway + orchestrator proxies with wave timeline and family controls |
| Reference Analysis | **Complete** | 6 repositories studied, synthesis documented |

### What is not yet implemented

- Production orchestrator scheduler
- Durable queueing / message broker
- Production event transport
- Production-grade Web UI and CLI
- Live session streaming bridge
- Full review automation engine
- Domain-specific content in domain docs (all placeholder)

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| `node` | >= 24 | Runtime (built-in SQLite, ESM) |
| `npm` | latest | Script runner |
| `tmux` | any | Session backing |
| `pi` | `@mariozechner/pi-coding-agent` | Agent runtime (optional -- stub fallback) |
| `jq` | any | JSON processing |
| `sqlite3` | any | Database inspection |
| `python3` | any | Utility scripts |
| `git` | any | Version control |
| `rg` | any | Fast search |

### Quick Start

```bash
# Clone and enter repository
git clone <repo-url> && cd SPORE

# Optional: install PI agent runtime
npm install -g @mariozechner/pi-coding-agent
pi          # authenticate with /login

# If the current shell does not expose the global PI binary, export it explicitly
export SPORE_PI_BIN="${SPORE_PI_BIN:-$(npm prefix -g)/bin/pi}"

# Build docs search index
npm run docs-kb:index

# Validate all configuration
npm run config:validate

# Plan and run a session
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml \
  --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml \
  --project config/projects/example-project.yaml \
  --session-id smoke-001 --run-id smoke-001

# Check session status
npm run session:status

# Start operator surfaces
npm run gateway:start          # HTTP API on :8787
npm run orchestrator:start     # Workflow API on :8789
npm run web:start              # Browser console on :8788
npm run ops:dashboard          # Terminal dashboard
```

### Smoke Test

```bash
npm run docs-kb:index
npm run config:validate
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml \
  --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml \
  --project config/projects/example-project.yaml \
  --session-id smoke-001 --run-id smoke-001
npm run session:status
npm run gateway:start
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer \
  --objective "Lead should produce one sentence; reviewer should return approve, revise, or reject." \
  --wait
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control
```

If `pi` is not installed, the runtime falls back to the stub launcher automatically. The default real launcher is `pi-rpc`, which maintains tmux inspectability while routing operator control through PI RPC.

For isolated local runs, you can redirect durable state with `SPORE_ORCHESTRATOR_DB_PATH`, `SPORE_SESSION_DB_PATH`, and `SPORE_EVENT_LOG_PATH`.

See [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) for the full setup and smoke test guide.
See [docs/runbooks/scenario-library.md](docs/runbooks/scenario-library.md) for canonical named scenarios.
Executable scenario and regression catalogs live in `config/scenarios/` and `config/regressions/`.

---

## Working Commands

### Documentation & Configuration

```bash
npm run docs-kb -- index                   # Build/refresh docs search index
npm run docs-kb -- search "session model"  # Search documentation
npm run docs-kb -- status                  # Index metadata
npm run docs-kb -- rebuild                 # Full index rebuild
npm run config:validate                    # Validate all YAML against schemas
```

### Runtime & Sessions

```bash
npm run runtime-pi:plan -- --profile <profile.yaml> --project <project.yaml>
npm run runtime-pi:run -- --profile <profile.yaml> --project <project.yaml>
npm run session:list                       # List all sessions
npm run session:status                     # Aggregate status overview
npm run session:events -- --session <id>   # Session event history
npm run session:feed                       # Live event feed (follow mode)
npm run session:reconcile                  # Reconcile detached sessions
npm run session:reconcile:watch -- --stop-on-settled  # Continuous reconciliation
npm run gateway:start                      # Shared session HTTP surface
```

### Orchestration

```bash
npm run orchestrator:plan -- --domain backend --roles lead
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:project-plan -- --project config/projects/example-project.yaml --domains backend,frontend
npm run orchestrator:project-invoke -- --project config/projects/example-project.yaml --domains backend,frontend \
  --objective "Coordinate backend and frontend work for one project." --wait --stub --timeout 25000
npm run orchestrator:promotion-plan -- --execution <coordinator-root-execution-id> --target-branch main
npm run orchestrator:promotion-invoke -- --execution <coordinator-root-execution-id> --target-branch main \
  --wait --stub --timeout 25000
npm run orchestrator:invoke -- --domain backend --roles lead --objective "..."
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer \
  --objective "..." --wait
npm run orchestrator:drive -- --execution <id>
npm run orchestrator:review -- --execution <id> --status approved
npm run orchestrator:approve -- --execution <id> --status approved
npm run orchestrator:tree -- --execution <id>
npm run orchestrator:drive-tree -- --execution <id> --wait
npm run orchestrator:review-tree -- --execution <id> --status approved
npm run orchestrator:approve-tree -- --execution <id> --status approved
npm run orchestrator:audit -- --execution <id>
npm run orchestrator:policy-diff -- --execution <id>
npm run test:policy
npm run test:http
npm run test:web-proxy
npm run test:tui
npm run test:all-local
npm run test:e2e:pi                      # opt-in real PI smoke; set SPORE_RUN_PI_E2E=1
npm run test:e2e:gateway-control         # opt-in real gateway control E2E
```

### Operator Surfaces

```bash
npm run ops:dashboard                      # Terminal dashboard
npm run ops:dashboard -- --watch           # Continuous refresh
npm run ops:inspect -- --session <id>      # Deep session inspection
node packages/tui/src/cli/spore-ops.js family --execution <id> --api http://127.0.0.1:8789
npm run gateway:start                      # HTTP gateway on :8787
npm run orchestrator:start                 # Orchestrator service on :8789
npm run web:start                          # Web console on :8788
npm run orchestrator:groups                # Coordination-group summaries
npm run orchestrator:group -- --group <id> # One coordination-group detail
npm run orchestrator:pause -- --execution <id> --reason "Operator pause"
npm run orchestrator:hold -- --execution <id> --reason "Dependency wait"
npm run orchestrator:resume -- --execution <id> --comments "Resume after hold"
npm run orchestrator:history -- --execution <id>
npm run orchestrator:scenario-list
npm run orchestrator:scenario-show -- --scenario backend-service-delivery
npm run orchestrator:scenario-run -- --scenario cli-verification-pass --stub
npm run orchestrator:scenario-run-show -- --run <run-id>
npm run orchestrator:scenario-run-artifacts -- --run <run-id>
npm run orchestrator:scenario-rerun -- --run <run-id>
npm run orchestrator:scenario-trends -- --scenario backend-service-delivery
npm run orchestrator:run-center
npm run orchestrator:self-build-summary
npm run orchestrator:self-build-dashboard
npm run orchestrator:regression-list
npm run orchestrator:regression-show -- --regression local-fast
npm run orchestrator:regression-run -- --regression local-fast --stub
npm run orchestrator:regression-run-show -- --run <run-id>
npm run orchestrator:regression-report -- --run <run-id>
npm run orchestrator:regression-latest-report -- --regression local-fast
npm run orchestrator:regression-rerun -- --run <run-id>
npm run orchestrator:regression-trends -- --regression local-fast
npm run orchestrator:work-item-template-list
npm run orchestrator:work-item-template-show -- --template operator-ui-pass
npm run orchestrator:goal-plan-create -- --goal "Stabilize CLI verification and docs follow-up"
npm run orchestrator:goal-plan-list
npm run orchestrator:goal-plan-show -- --plan <goal-plan-id>
npm run orchestrator:goal-plan-materialize -- --plan <goal-plan-id>
npm run orchestrator:work-item-group-list
npm run orchestrator:work-item-group-show -- --group <group-id>
npm run orchestrator:work-item-group-run -- --group <group-id> --stub
npm run orchestrator:work-item-create -- --template operator-ui-pass
npm run orchestrator:work-item-list
npm run orchestrator:work-item-show -- --item <work-item-id>
npm run orchestrator:work-item-runs -- --item <work-item-id>
npm run orchestrator:work-item-run -- --item <work-item-id> --stub
npm run orchestrator:work-item-run-show -- --run <work-item-run-id>
npm run orchestrator:work-item-run-rerun -- --run <work-item-run-id>
npm run orchestrator:workspace-show -- --run <work-item-run-id>
npm run orchestrator:workspace-reconcile -- --workspace <workspace-id>
npm run orchestrator:workspace-cleanup -- --workspace <workspace-id> --force
npm run orchestrator:execution-workspaces -- --execution <execution-id>
npm run orchestrator:work-item-validate -- --run <work-item-run-id> --stub
npm run orchestrator:work-item-doc-suggestions -- --run <work-item-run-id>
npm run orchestrator:proposal-show -- --run <work-item-run-id>
npm run workspace:list
npm run orchestrator:proposal-review -- --proposal <proposal-id> --status reviewed
npm run orchestrator:proposal-approve -- --proposal <proposal-id> --status approved
```

### Shared HTTP Surfaces

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/executions/:id/history` | Combined ordered execution history with governance, audit, waves, and policy diff |
| `GET` | `/run-center/summary` | Aggregate operator summary for scenarios, regressions, and recent runs |
| `GET` | `/self-build/dashboard` | Dedicated self-build dashboard aggregate with queue, attention, recent runs, and workspace health |
| `GET` | `/self-build/summary` | Aggregate self-build state across plans, groups, work items, runs, and proposals |
| `GET` | `/scenarios` | Scenario catalog with latest run summary |
| `GET` | `/scenarios/:id` | One scenario definition with latest run |
| `GET` | `/scenarios/:id/runs` | Durable scenario run history |
| `GET` | `/scenario-runs/:runId` | One durable scenario run by run id, including explicit failure and suggested actions |
| `GET` | `/scenario-runs/:runId/artifacts` | Artifact summary for one durable scenario run |
| `GET` | `/scenarios/:id/runs/:runId/artifacts` | Artifact summary for one scenario run |
| `GET` | `/scenarios/:id/trends` | Trend summary for one scenario |
| `POST` | `/scenarios/:id/run` | Launch one named scenario |
| `POST` | `/scenario-runs/:runId/rerun` | Rerun one prior scenario run with optional overrides |
| `GET` | `/regressions` | Regression catalog with latest run summary |
| `GET` | `/regressions/:id` | One regression profile with latest run |
| `GET` | `/regressions/:id/runs` | Durable regression run history |
| `GET` | `/regression-runs/:runId` | One durable regression run by run id, including explicit failure and suggested actions |
| `GET` | `/regression-runs/:runId/report` | Report metadata, top failure reasons, and suggested actions for one durable regression run |
| `GET` | `/regressions/:id/latest-report` | Latest durable report pointer for one regression profile |
| `GET` | `/regressions/scheduler/status` | Read-only scheduler status, retention summary, and latest scheduled-run pointers |
| `GET` | `/regressions/:id/trends` | Trend summary for one regression profile |
| `POST` | `/regressions/:id/run` | Launch one named regression profile |
| `POST` | `/regression-runs/:runId/rerun` | Rerun one prior regression run with optional overrides |
| `GET` | `/work-items` | Durable managed work-item list for supervised self-work |
| `GET` | `/work-items/:id` | One durable work item with recent runs |
| `GET` | `/work-items/:id/runs` | Durable run history for one work item |
| `POST` | `/work-items` | Create one managed work item |
| `POST` | `/work-items/:id/run` | Execute one managed work item through scenario, regression, or workflow paths |
| `GET` | `/work-item-runs/:runId` | One durable work-item run result |
| `POST` | `/work-item-runs/:runId/rerun` | Rerun one prior work-item run with durable lineage back to the original run |
| `GET` | `/work-item-runs/:runId/workspace` | Workspace allocation linked to one work-item run |
| `GET` | `/work-item-runs/:runId/proposal` | Proposal artifact summary linked to one work-item run |
| `POST` | `/work-item-runs/:runId/validate` | Validation pass over one work-item run with durable evaluation output |
| `GET` | `/work-item-runs/:runId/doc-suggestions` | Suggested documentation follow-up actions for one run |
| `GET` | `/work-item-templates` | Work-item template catalog for repeatable self-build tasks |
| `GET` | `/work-item-templates/:id` | One work-item template detail |
| `GET` | `/goal-plans` | Durable goal-plan list for planning before execution |
| `POST` | `/goals/plan` | Create one goal plan |
| `GET` | `/goal-plans/:id` | One goal-plan detail |
| `POST` | `/goal-plans/:id/materialize` | Materialize a goal plan into a work-item group and managed items |
| `GET` | `/work-item-groups` | Durable work-item group list |
| `GET` | `/work-item-groups/:id` | One work-item group detail |
| `POST` | `/work-item-groups/:id/run` | Execute one work-item group through managed child work items |
| `GET` | `/proposal-artifacts/:id` | One proposal artifact with review/approval status |
| `POST` | `/proposal-artifacts/:id/review` | Review transition for one proposal artifact |
| `POST` | `/proposal-artifacts/:id/approval` | Approval transition for one proposal artifact |
| `GET` | `/workspaces` | Durable workspace allocation list for mutating self-work |
| `GET` | `/workspaces/:id` | One workspace allocation with worktree metadata |
| `POST` | `/workspaces/:id/reconcile` | Compare allocation state with `git worktree list` and on-disk reality |
| `POST` | `/workspaces/:id/cleanup` | Apply governance-aware workspace cleanup with optional force and branch retention |
| `GET` | `/executions/:id/workspaces` | Workspace allocations linked to one workflow execution |
| `GET` | `/sessions/:id/live` | Combined live session metadata, events, artifacts, workspace linkage, control history, diagnostics, and operator suggestions |
| `GET` | `/sessions/:id/control-history` | Durable control request history for one session |
| `GET` | `/sessions/:id/control-status/:requestId` | One durable control request with ack/result status |

Recent operator payloads also expose additive drilldown helpers where available:

- `links.*` for report, trend, run, artifacts, and execution drilldowns
- `trendSnapshot`
- `latestReports[]`
- `recentRuns[]`
- `failureBreakdown`

SPORE now also ships a first-class managed project profile in [spore.yaml](/home/antman/projects/SPORE/config/projects/spore.yaml), so new supervised self-work items can target the repository itself instead of the generic example project.

### Canonical Scenario Invocations

```bash
npm run orchestrator:plan -- --workflow config/workflows/backend-service-delivery.yaml --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:plan -- --workflow config/workflows/frontend-ui-pass.yaml --domain frontend --roles lead,scout,builder,tester,reviewer
npm run orchestrator:plan -- --workflow config/workflows/cli-verification-pass.yaml --domain cli --roles lead,builder,tester,reviewer
npm run orchestrator:plan -- --workflow config/workflows/docs-adr-pass.yaml --domain docs --roles lead,scout,reviewer
```

### Gateway Control Examples

```bash
# Stop a session
curl -X POST http://127.0.0.1:8787/sessions/<id>/actions/stop \
  -H 'content-type: application/json' \
  -d '{"reason":"operator stop","force":true}'

# Mark complete
curl -X POST http://127.0.0.1:8787/sessions/<id>/actions/mark-complete \
  -H 'content-type: application/json' \
  -d '{"reason":"operator override"}'

# Steer an active session
curl -X POST http://127.0.0.1:8787/sessions/<id>/actions/steer \
  -H 'content-type: application/json' \
  -d '{"message":"Report status","enter":true}'

# Read durable control request history
curl http://127.0.0.1:8787/sessions/<id>/control-history

# Read one durable control request
curl http://127.0.0.1:8787/sessions/<id>/control-status/<request-id>

# Read artifacts
curl http://127.0.0.1:8787/sessions/<id>/artifacts

# Stream events (SSE)
curl -N http://127.0.0.1:8787/stream/events?session=<id>
```

---

## Repository Structure

```
SPORE/
├── docs/                   Documentation operating system (111 markdown files)
│   ├── vision/             Product vision, principles, glossary
│   ├── architecture/       System, session, runtime, event, config, role, workflow models
│   ├── decisions/          ADRs (Architecture Decision Records)
│   ├── research/           Reference study notes
│   ├── specs/              Specifications
│   ├── plans/              Roadmap, backlog, waves
│   ├── roadmap/            13-wave implementation roadmap
│   ├── operations/         Governance policies
│   ├── runbooks/           Operational procedures
│   ├── domains/            9 domain scaffolds
│   ├── templates/          Doc, profile, project, research, workflow templates
│   └── index/              DOCS_INDEX.md + docs_manifest.yaml
│
├── config/                 Declarative YAML configuration (21 files)
│   ├── profiles/           6 agent role profiles
│   ├── workflows/          4 workflow templates
│   ├── projects/           Project assembly configs
│   ├── domains/            4 domain configs
│   ├── teams/              2 team compositions
│   └── system/             System defaults, runtime, observability, permissions
│
├── schemas/                JSON schemas for validation (12 schemas)
├── workspace/              Extended profiles, workflows, teams, templates
│
├── packages/               Core modules
│   ├── docs-kb/            Documentation indexing & search
│   ├── config-schema/      YAML parsing & schema validation
│   ├── runtime-pi/         PI runtime integration
│   ├── session-manager/    Session lifecycle & metadata
│   ├── orchestrator/       Workflow execution engine
│   └── tui/                Terminal operator surface
│
├── services/               HTTP services
│   ├── session-gateway/    Session/event/artifact API + SSE + control
│   └── orchestrator/       Workflow plan/invoke/drive/review API
│
├── apps/                   Client applications
│   └── web/                Browser operator console
│
├── tools/                  Tooling documentation
├── references/             Upstream study repositories (read-only)
├── data/                   SQLite databases, event logs, embeddings
├── tmp/                    Session artifacts, execution briefs
├── scripts/                Repository-level helper scripts
├── .pi/                    PI agent context (system prompt, settings, role overlays)
├── AGENTS.md               Agent work rules and governance contract
├── README.md               This file
└── package.json            Root scripts (expanded operator command surface), zero dependencies
```

---

## Design Influences

SPORE synthesizes concepts from six reference projects, adapting (never cloning) their best ideas:

| Reference | Key Concept Borrowed | SPORE Adaptation |
|---|---|---|
| **Overstory** | Hierarchical delegation, isolated execution, mail-style coordination | Orchestrator -> Lead -> Worker role hierarchy with profile-driven behavior |
| **Gastown** | Durable sessions, tmux-first operation, persistent agent identity | tmux-backed sessions with SQLite metadata and operator control actions |
| **Mulch** | Structured knowledge capture, typed records, execution/knowledge separation | Local-first docs KB with classification policy and semantic search |
| **Beads** | Dependency-aware task graphs, durable state with event history | Durable workflow executions with step-by-step drive and review gates |
| **PI Mono** | Extensible runtime packages, model/provider abstraction, web+terminal UI | PI-first runtime with RPC launcher, event capture, and session artifacts |
| **Agentic Engineering Book** | Disciplined plan-build-review loops, context-as-code, governance patterns | Documentation-first operating model, 12 principles, phased delivery |

---

## Documentation

| Document | Description |
|---|---|
| [docs/INDEX.md](docs/INDEX.md) | Documentation navigation hub |
| [docs/vision/product-vision.md](docs/vision/product-vision.md) | Product vision and north star outcomes |
| [docs/vision/principles.md](docs/vision/principles.md) | 12 core design principles |
| [docs/architecture/system-overview.md](docs/architecture/system-overview.md) | Five-layer architecture overview |
| [docs/architecture/session-model.md](docs/architecture/session-model.md) | Session lifecycle and inspectability model |
| [docs/architecture/runtime-model.md](docs/architecture/runtime-model.md) | PI-first runtime strategy |
| [docs/architecture/workflow-model.md](docs/architecture/workflow-model.md) | Workflow template system |
| [docs/architecture/event-model.md](docs/architecture/event-model.md) | Event envelope and observability |
| [docs/architecture/config-model.md](docs/architecture/config-model.md) | Configuration split-by-concern |
| [docs/architecture/role-model.md](docs/architecture/role-model.md) | Six abstract roles |
| [docs/architecture/knowledge-model.md](docs/architecture/knowledge-model.md) | Knowledge layer design |
| [docs/architecture/embeddings-search.md](docs/architecture/embeddings-search.md) | Docs KB search strategy |
| [docs/architecture/clients-and-surfaces.md](docs/architecture/clients-and-surfaces.md) | Client surface boundaries |
| [docs/architecture/observability-model.md](docs/architecture/observability-model.md) | Observability design |
| [docs/decisions/ADR-0001-repo-foundation.md](docs/decisions/ADR-0001-repo-foundation.md) | ADR: Repository foundation |
| [docs/decisions/ADR-0002-runtime-pi-first.md](docs/decisions/ADR-0002-runtime-pi-first.md) | ADR: PI-first runtime |
| [docs/roadmap/IMPLEMENTATION_ROADMAP.md](docs/roadmap/IMPLEMENTATION_ROADMAP.md) | 13-wave implementation roadmap |
| [docs/plans/bootstrap-completion-summary.md](docs/plans/bootstrap-completion-summary.md) | Bootstrap completion summary |
| [docs/operations/BOOTSTRAP_STATUS.md](docs/operations/BOOTSTRAP_STATUS.md) | Current bootstrap status |
| [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) | Local development setup and smoke tests |
| [docs/references/REFERENCE_SYNTHESIS.md](docs/references/REFERENCE_SYNTHESIS.md) | Reference project synthesis |
| [AGENTS.md](AGENTS.md) | Agent work rules and governance contract |

---

## License

MIT
