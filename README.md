<div align="center">

<br/>

```
   ███████╗██████╗  ██████╗ ██████╗ ███████╗
   ██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔════╝
   ███████╗██████╔╝██║   ██║██████╔╝█████╗  
   ╚════██║██╔═══╝ ██║   ██║██╔══██╗██╔══╝  
   ███████║██║     ╚██████╔╝██║  ██║███████╗
   ╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝
```

### **Swarm Protocol for Orchestration, Rituals & Execution**

*Governed multi-agent orchestration platform*<br/>
*powered by [PI](https://github.com/ArtificialAnomaly/pi) · built to manage any software project*

<br/>

[![Powered by PI](https://img.shields.io/badge/Powered_by-PI_Agent_Runtime-E040FB?style=for-the-badge)](https://github.com/ArtificialAnomaly/pi)
[![Node 24+](https://img.shields.io/badge/Node-24%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PI Runtime](https://img.shields.io/badge/PI_Runtime-Multi--Backend-00C853?style=for-the-badge)](.)
[![Local-First](https://img.shields.io/badge/Storage-Local--First_SQLite-FF6F00?style=for-the-badge)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-A855F7?style=for-the-badge)](LICENSE)

<br/>

**PI-Powered** · **Documentation-First** · **Profile-Driven** · **Human-Steerable** · **Fully Observable**

---

<br/>

[Why PI](#-powered-by-pi) · [Architecture](#-architecture) · [How It Works](#-how-it-works) · [Work Management](#-project-work-management) · [Roles](#-role-system) · [Surfaces](#-operator-surfaces) · [Quick Start](#-quick-start) · [Roadmap](#-roadmap) · [Docs](#-documentation)

</div>

<br/>

## Why SPORE?

Agentic workflows fail for three predictable reasons: they **mix implementation with coordination**, they **hide decisions in chat** that vanish when sessions end, and they provide **weak inspectability** -- operators cannot see, steer, or trust what agents are doing.

SPORE solves this with a **structured orchestration protocol** where every decision is a durable artifact, every agent runs in an inspectable PI session, and work on any project flows through a **governed pipeline**: goal → plan → execute → validate → promote.

> **SPORE manages software projects the way the best human teams do -- but with full observability, structural governance, and AI agents powered by PI doing the work.**

## What's New

- Multi-backend PI runtime support now exists behind a SPORE-owned runtime adapter boundary: `pi_rpc`, `pi_sdk_embedded`, and `pi_sdk_worker`.
- Session/runtime inspection is now backend-aware through generic runtime artifacts such as `runtime-status` and `runtime-events`.
- The browser default home is now the real `Agent Cockpit`, with `Mission Map`, `Operator Chat`, and the self-build dashboard as first-class operator surfaces.
- `spore-ops` and the orchestrator HTTP surface now expose the current coordinator/integrator, self-build, and scenario/regression model directly.

> See the full update summary in [docs/operations/2026-03-14-platform-runtime-and-ops-release-notes.md](docs/operations/2026-03-14-platform-runtime-and-ops-release-notes.md).

<br/>

## ✦ Key Capabilities

<table>
<tr>
<td width="33%" valign="top">

### 🎭 Role-Based Orchestration
An orchestrator dispatches through domain-aware leads to specialized workers. Eight architectural roles with profile-driven behavior.

</td>
<td width="33%" valign="top">

### 🔄 Governed Work Management
Goal → Plan → Execute → Validate → Promote. One pipeline for any project, with human checkpoints at every critical gate.

</td>
<td width="33%" valign="top">

### 🔍 Full Observability
Every agent runs in an operator-visible PI session. Every decision is recorded. Every workflow step produces durable, inspectable artifacts across tmux-backed RPC and newer SDK-backed runtime modes.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 📋 Durable Governance
Review gates, approval workflows, quarantine, rollback, escalation resolution -- governance is structural, not advisory.

</td>
<td width="33%" valign="top">

### 💬 Operator Chat Control
Natural language mission control. State goals, review plans, approve gates, and steer execution through conversation.

</td>
<td width="33%" valign="top">

### 🤖 PI-Powered Agents
Built on [PI](https://github.com/ArtificialAnomaly/pi) agent runtime. SPORE keeps PI-first integration while supporting RPC, embedded SDK, and worker-process SDK backends behind one internal runtime contract.

</td>
</tr>
</table>

<br/>

---

<br/>

## 🤖 Powered by PI

SPORE is built on [**PI**](https://github.com/ArtificialAnomaly/pi) -- an extensible agent runtime that provides the AI execution layer. PI is not an optional dependency; it's the **core runtime partner** that makes SPORE's agents actually work.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SPORE + PI Partnership                            │
│                                                                     │
│   SPORE provides:                    PI provides:                   │
│   ─────────────────                  ────────────────                │
│   ✦ Workflow orchestration           ✦ Agent execution runtime      │
│   ✦ Role-based delegation            ✦ LLM model access             │
│   ✦ Governance & review gates        ✦ Bidirectional RPC            │
│   ✦ Durable state & audit trail      ✦ Tool execution               │
│   ✦ Operator surfaces (web/TUI/CLI)  ✦ Session event streaming      │
│   ✦ Workspace isolation              ✦ Steer / follow-up / abort    │
│   ✦ Configuration & policy           ✦ Extensible profiles          │
│                                                                     │
│   Together:                                                         │
│   ─────────                                                         │
│   SPORE plans the work, PI executes it, SPORE governs the result.  │
│   Every PI session runs in tmux for live inspectability.            │
│   The operator can steer any agent in real-time through PI's RPC.   │
└─────────────────────────────────────────────────────────────────────┘
```

### How PI Integrates

| Mode | Command | Use Case |
|------|---------|----------|
| **PI RPC** | `pi --mode rpc` | **Primary.** Full bidirectional control: steer, follow up, abort, get state |
| **PI JSON** | `pi --mode json` | Debug. One-shot JSON event streaming |
| **Stub** | *(no PI needed)* | Testing. Simulates sessions for development without PI |

SPORE auto-detects PI availability and falls back to stub mode gracefully. But the real power -- actual AI agents writing code, reviewing changes, running tests -- that comes from PI.

<br/>

---

<br/>

## 🏗 Architecture

SPORE is organized into **five distinct layers**, each with clear ownership boundaries:

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                         ║
║   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                ║
║   │  🌐 Web UI  │    │  📟 TUI     │    │  ⌨️  CLIs   │                ║
║   │  :8788      │    │  Dashboard  │    │  100+ cmds  │                ║
║   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘   SURFACES    ║
║          └──────────────────┼──────────────────┘                       ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                             │                                          ║
║   ┌─────────────────────────┴──────────────────────────┐               ║
║   │             Session Gateway  :8787                  │               ║
║   │      status · events · artifacts · SSE · control    │  OBSERVE     ║
║   └─────────────────────────┬──────────────────────────┘               ║
║                             │                                          ║
║   ┌─────────────────────────┴──────────────────────────┐               ║
║   │             Session Manager (SQLite)                │               ║
║   │      lifecycle · metadata · events · reconcile      │               ║
║   └────────────────────────────────────────────────────┘               ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                                                                         ║
║   ┌──────────────────────┐    ┌────────────────────────┐               ║
║   │   Orchestrator :8789 │    │ Runtime Core + PI       │               ║
║   │   plan · invoke      │    │ adapter · launch        │  EXECUTE     ║
║   │   drive · review     │    │ rpc · embedded · worker │               ║
║   │   work mgmt · govern │    │ artifact parity         │               ║
║   └──────────┬───────────┘    └──────────┬─────────────┘               ║
║              └───────── step drive ──────┘                              ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                                                                         ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             ║
║   │Profiles│ │Workflows│ │Projects│ │Domains │ │ Policy │  CONFIGURE  ║
║   │  8     │ │  12    │ │   2    │ │   4    │ │ Packs 7│             ║
║   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘             ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        ║
║   │Scenarios│ │Regress.│ │V-Bundle│ │Schemas │                        ║
║   │  11    │ │   6    │ │   4    │ │  15    │                        ║
║   └────────┘ └────────┘ └────────┘ └────────┘                        ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                                                                         ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        ║
║   │  Docs  │ │  ADRs  │ │Research│ │Docs KB │   KNOWLEDGE            ║
║   │ 100+   │ │  16+   │ │   6    │ │ SQLite │                        ║
║   └────────┘ └────────┘ └────────┘ └────────┘                        ║
║                                                                         ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

**Core boundary rules:**
- Clients are thin over HTTP -- never touch SQLite directly
- Sessions explain runtime; executions explain workflow; coordination groups explain management
- Knowledge retrieval is domain-policy-shaped, never hidden inside the orchestrator
- Approval ≠ Promotion ≠ Merge -- each is a distinct governed transition

<br/>

---

<br/>

## ⚡ How It Works

### 1. Plan

The orchestrator resolves profiles, merges domain policies, and builds a multi-step execution plan:

```
  Workflow YAML ──┐     ┌── Domain Policy
  Profile YAML ───┤     ├── Policy Packs
  Project YAML ───┘     └── Runtime Config
          │                       │
          └───────┬───────────────┘
                  ▼
       ┌─────────────────────┐
       │   ORCHESTRATOR      │
       │   ─────────────     │
       │   Resolve profiles  │
       │   Merge policies    │
       │   Build step plan   │
       │   Snapshot config   │
       └─────────┬───────────┘
                 │
                 ▼
       Durable Execution Record
       (SQLite + event log)
```

### 2. Execute

Each step launches through a PI runtime adapter. Today that can still be a tmux-backed RPC session, but the same orchestration path can also target embedded or worker-process PI SDK backends:

```
       Step 1 (scout)          Step 2 (builder)         Step 3 (tester)
      ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
      │  📡 Research │   ──►  │  🔨 Build    │   ──►  │  🧪 Verify   │
       │ PI runtime   │        │ PI runtime   │        │ PI runtime   │
       │ rpc/sdk path │        │ workspace    │        │ snapshot     │
      └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
             │                       │                        │
             ▼                       ▼                        ▼
       scout_findings        implementation_summary    verification_summary
                             + workspace_snapshot
```

### 3. Review & Govern

Independent reviewer provides quality gates. Operator can intervene at any point:

```
       ┌──────────────┐
       │  📝 Reviewer  │
       │  Independent  │
       │  quality gate │
       └──────┬───────┘
              │
      ┌───────┼───────┐
      │       │       │
   approve  revise  reject
      │       │       │
      ▼       ▼       ▼
   proceed  retry    fail
      │
      ▼
   ┌──────────────┐        ┌───────────────────────────┐
   │  🔄 Promote  │   ──►  │  Integration Branch       │
   │  Integrator  │        │  (never auto-merge main)  │
   └──────────────┘        └───────────────────────────┘
```

### 4. Observe & Steer

Every artifact is inspectable. Operators see everything in real-time:

```
   ┌─────────────────────────────────────────────────────────────┐
   │                    OPERATOR SURFACES                         │
   │                                                             │
   │   💬 Chat       "Start a docs maintenance pass"             │
   │   ────────      Server projects plan → operator reviews     │
   │                 Approve gates via buttons or natural text    │
   │                                                             │
   │   🌐 Web UI     Agent Cockpit · Mission Map                 │
   │   ────────      Operator Chat · Self-Build dashboard        │
   │                 Lineage, governance, lane detail, SSE       │
   │                                                             │
   │   📟 TUI        Dashboard · Inspect · Run-center            │
   │   ────────      100+ commands · Self-build triage           │
   │                                                             │
   │   📊 Events     NDJSON event log · SSE streaming            │
   │   ────────      Session + workflow + control events         │
   └─────────────────────────────────────────────────────────────┘
```

<br/>

---

<br/>

## 🔄 Project Work Management

SPORE's flagship capability: a **governed work pipeline** that manages software delivery on **any project** -- including SPORE itself. Every change flows through the same pipeline with human checkpoints at every critical transition.

```
   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
   │          │     │          │     │          │     │          │     │          │
   │  🎯 Goal │────►│  📋 Plan │────►│  ⚙️ Run  │────►│  ✅ Valid │────►│  🚀 Prom │
   │          │     │          │     │          │     │          │     │          │
   │  Define  │     │  Review  │     │ Execute  │     │ Validate │     │ Promote  │
   │  intent  │     │  & edit  │     │ in       │     │ with     │     │ to       │
   │          │     │  items   │     │ isolated │     │ bundles  │     │ integ.   │
   │          │     │          │     │ workspace│     │          │     │ branch   │
   └──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
        │                │                │                │                │
        ▼                ▼                ▼                ▼                ▼
   Operator         Operator         Workspace        Proposal        Integration
   states goal      reviews plan     isolation        artifacts       branch
   in chat          edits items      git worktree     review/approve  landing zone
```

### The Work Management Pipeline

| Stage | What Happens | Governance |
|-------|-------------|------------|
| **Goal** | Operator states an objective via chat or CLI | Natural language, converted to structured plan |
| **Plan** | System creates work items from project templates | Operator reviews, edits, reorders before materialization |
| **Execute** | Each work item runs in an isolated git worktree via PI | Policy-gated, watchdog-monitored, workspace-backed |
| **Validate** | Named validation bundles check results | Typecheck, lint, tests, format -- configurable per domain |
| **Propose** | Builder outputs become proposal artifacts | Separate review and approval transitions |
| **Promote** | Integrator moves approved work to integration branch | Never auto-merges to main; operator decides |

> **Note:** SPORE uses this same pipeline to manage its own development -- a capability we call "self-build." But the pipeline is generic: configure your project, define your domains, provide work-item templates, and SPORE manages your work the same way.

### Safety Mechanisms

```
   ┌─────────────────────────────────────────────────────────┐
   │                   GOVERNANCE LAYER                       │
   │                                                         │
   │   🛡️  Protected Scope      Override requests for        │
   │       Guards               sensitive repository areas   │
   │                                                         │
   │   🔒 Quarantine            Block further attempts       │
   │       Records              until operator releases      │
   │                                                         │
   │   ⏪ Rollback              Revert integration branch    │
   │       Actions              changes with full lineage    │
   │                                                         │
   │   📊 Learning              Extract patterns from        │
   │       Trends               past runs to improve plans   │
   │                                                         │
   │   🎚️  Policy               Auto-derived tuning          │
   │       Recommendations      candidates from learnings    │
   │                                                         │
   │   📥 Autonomous            Priority-scored intake       │
   │       Intake Queue         from learnings & diagnostics │
   └─────────────────────────────────────────────────────────┘
```

<br/>

---

<br/>

## 🎭 Role System

Eight architectural roles form SPORE's delegation hierarchy. Concrete behavior is attached via **profiles** -- the same role can have domain-specific variants.

```
                              ┌─────────────────┐
                              │   👤 OPERATOR    │
                              │   Human-in-loop  │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  🎯 ORCHESTRATOR │  Portfolio coordinator
                              │     persistent   │  Dispatches projects
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  📊 COORDINATOR  │  Project-root manager
                              │     persistent   │  Read-mostly, delegates
                              └────────┬────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 │                     │                     │
        ┌────────▼────────┐   ┌────────▼────────┐  ┌────────▼────────┐
        │   📐 LEAD       │   │   📐 LEAD       │  │   📐 LEAD       │
        │   (backend)     │   │   (frontend)    │  │   (docs)        │
        │   persistent    │   │   persistent    │  │   persistent    │
        └────────┬────────┘   └─────────────────┘  └─────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐  ┌────▼───┐  ┌────▼───┐       ┌──────────┐     ┌──────────────┐
│📡SCOUT│  │🔨BUILD │  │🧪TEST  │       │📝REVIEWER│     │🔄 INTEGRATOR │
│explore│  │ code   │  │verify  │  ───► │ approve/ │     │   promote    │
│analyze│  │ docs   │  │report  │       │ revise/  │     │   to branch  │
│       │  │        │  │        │       │ reject   │     │              │
└───────┘  └────────┘  └────────┘       └──────────┘     └──────────────┘
ephemeral   ephemeral   ephemeral        ephemeral          ephemeral
```

### Workflow Handoffs

Each role produces a **semantic handoff artifact** consumed by the next step:

```
   Lead ─────────► task_brief ─────────────────────────────────────────►
                                                                        │
   Scout ────────► scout_findings ─────────────────────────────────────►│
                                                                        │
   Builder ──────► implementation_summary + workspace_snapshot ────────►│
                                                                        │
   Tester ───────► verification_summary ──────────────────────────────►│
                                                                        │
   Reviewer ─────► review_summary ─────────────────────────────────────►│
                                                                        ▼
                                                              Proposal Artifact
```

<br/>

---

<br/>

## 🖥 Operator Surfaces

### Web Console `:8788`

A TypeScript browser SPA providing full operator visibility:

```
┌──────────────────────────────────────────────────────────────────────┐
│  SPORE Operator Console                                     :8788   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────┐  ┌───────────────────┐ │
│  │  💬 Operator Chat                       │  │  📊 Project Work  │ │
│  │  ─────────────────                      │  │  Dashboard        │ │
│  │  > "Run a docs maintenance pass"        │  │                   │ │
│  │                                         │  │  Plans: 3 active  │ │
│  │  🤖 I'll create a goal plan for docs    │  │  Items: 12 total  │ │
│  │     maintenance. Here's what I suggest: │  │  Runs:  8 done    │ │
│  │                                         │  │  Proposals: 2     │ │
│  │  📋 Work Items:                         │  │                   │ │
│  │  1. ADR index sync                      │  │  ⚠️ 1 needs review │ │
│  │  2. Stale doc detection                 │  │  ✅ 7 validated    │ │
│  │  3. Manifest alignment                  │  │                   │ │
│  │                                         │  │  Workspace Health  │ │
│  │  [Approve Plan] [Edit Items] [Cancel]   │  │  Active: 3        │ │
│  └─────────────────────────────────────────┘  │  Stale:  0        │ │
│                                                └───────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  Execution Tree                                                  ││
│  │  ├── coordinator (completed)                                     ││
│  │  │   ├── lead-backend (running) ► Step 3/4: builder              ││
│  │  │   ├── lead-frontend (waiting_review)                          ││
│  │  │   └── integrator (planned)                                    ││
│  │  Event Timeline ─── SSE Live Stream ───────────────────────────  ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

### Terminal UI

```bash
npm run ops:dashboard              # Live status overview
npm run ops:dashboard -- --watch   # Continuous refresh mode
npm run ops:inspect -- --session <id>  # Deep session inspection with tmux capture
npm run orchestrator:run-center    # Operator run-center summary
npm run orchestrator:scenario-list # Scenario catalog
npm run orchestrator:project-plan -- --project config/projects/spore.yaml --domains backend,frontend
```

`spore-ops` is now broader than a dashboard/inspect helper; it is the terminal counterpart to the browser mission-control surfaces.

### HTTP APIs

| Service | Port | Endpoints | Purpose |
|---------|------|-----------|---------|
| **Session Gateway** | 8787 | 15+ | Session lifecycle, events, artifacts, SSE, control |
| **Orchestrator** | 8789 | 145+ | Workflows, governance, project work management, scenarios, promotion |

### Package CLIs

Over **100 operator commands** through npm scripts covering orchestration, sessions, workspaces, scenarios, regressions, project work management, goal plans, proposals, governance, and more.

<br/>

---

<br/>

## 📦 Package Architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                        SPORE Monorepo                               │
 │                     npm workspaces · ESM · TypeScript               │
 │                                                                     │
 │  packages/                                                          │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
 │  │  orchestrator    │  │  runtime-core    │  │  session-manager │  │
 │  │  ═══════════════ │  │  ═══════════════ │  │  ═══════════════ │  │
 │  │  ~30K lines      │  │  Runtime contract│  │  Lifecycle FSM   │  │
 │  │  Workflow engine │  │  registry/superv.│  │  SQLite store    │  │
 │  │  Work mgmt core  │  │  snapshots/events│  │  Event log       │  │
 │  │  Governance      │  │  artifact parity │  │  Reconciliation  │  │
 │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
 │  ┌──────────────────┐                                              │
 │  │  runtime-pi      │                                              │
 │  │  ═══════════════ │                                              │
 │  │  PI adapters     │                                              │
 │  │  rpc/sdk/worker  │                                              │
 │  │  control bridge  │                                              │
 │  └──────────────────┘                                              │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
 │  │  workspace-mgr   │  │  docs-kb         │  │  config-schema   │  │
 │  │  ═══════════════ │  │  ═══════════════ │  │  ═══════════════ │  │
 │  │  Git worktree    │  │  Doc indexing    │  │  YAML + JSON     │  │
 │  │  Snapshot handoff│  │  Semantic search │  │  Schema validate │  │
 │  │  Gov-aware clean │  │  SQLite store    │  │  15 schema defs  │  │
 │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
 │  │  tui             │  │  core            │  │  shared-types    │  │
 │  │  ═══════════════ │  │  ═══════════════ │  │  ═══════════════ │  │
 │  │  100+ commands   │  │  Repo root       │  │  Cross-package   │  │
 │  │  Terminal ops    │  │  Path utilities  │  │  type contracts  │  │
 │  │  HTTP consumer   │  │  Base types      │  │  API envelopes   │  │
 │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
 │                                                                     │
 │  services/                                apps/                     │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
 │  │  orchestrator    │  │  session-gateway │  │  web             │  │
 │  │  HTTP :8789      │  │  HTTP :8787      │  │  SPA :8788       │  │
 │  │  145+ endpoints  │  │  REST + SSE      │  │  Proxy server    │  │
 │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
 └─────────────────────────────────────────────────────────────────────┘
```

### Internal Dependencies

```
  orchestrator ───────┬── runtime-core (adapter registry + supervisor)
                      ├── runtime-pi (session launch + PI backends)
                      ├── session-manager (session state queries)
                      └── config-schema (YAML parsing)

  runtime-core ──────── standalone runtime contracts

  runtime-pi ─────────┬── runtime-core (adapter contracts)
                      ├── session-manager (session records)
                      ├── config-schema (YAML parsing)
                      └── docs-kb (context retrieval)

  session-manager ────┬── runtime-pi (tmux ops for reconcile)

  session-gateway ────┬── session-manager (store + events)
                      └── runtime-pi (tmux + control queue)

  web ────────────────┬── proxies to session-gateway (:8787)
                      └── proxies to orchestrator-service (:8789)

  tui ────────────────── consumes orchestrator HTTP API

  config-schema ──────── standalone
  docs-kb ────────────── standalone
  core ───────────────── standalone (repo root anchor)
  shared-types ───────── standalone (cross-package contracts)
```

<br/>

---

<br/>

## 🚀 Quick Start

### Prerequisites

```
node >= 24    npm    tmux    git    rg    jq    sqlite3
```

Required for real agent execution: `pi` agent runtime (`npm install -g @mariozechner/pi-coding-agent`)

For the newer SDK-backed runtime backends, SPORE also installs `@mariozechner/pi-coding-agent` as a workspace dependency.

### Install & Verify

```bash
git clone <repo-url> && cd SPORE-2
npm install

# Verify everything works
npm run typecheck          # TypeScript across all workspaces
npm run lint               # Biome linter
npm run docs-kb:index      # Build docs search index
npm run config:validate    # Validate the current config catalog
npm run test:all-local     # Run all local test suites
```

### Launch Operator Stack

```bash
# Terminal 1: Session gateway
npm run gateway:start              # :8787

# Terminal 2: Orchestrator service
npm run orchestrator:start         # :8789

# Terminal 3: Web console
npm run web:start                  # :8788

# Terminal 4: TUI dashboard
npm run ops:dashboard -- --watch

# Open the browser mission-control home
# http://127.0.0.1:8788/cockpit
```

### Run a Workflow

```bash
# Plan a backend feature delivery
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer

# Invoke with a real objective
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer \
  --objective "Implement a health check endpoint" --wait

# Project work: create a goal plan
npm run orchestrator:goal-plan-create -- --goal "Stabilize CLI verification and docs follow-up"

# Runtime stub smoke for SDK-backed backends
npm run runtime-pi:run -- --profile config/profiles/builder.yaml --project config/projects/spore.yaml --session-id local-sdk-embedded --run-id local-sdk-embedded-run --backend-kind pi_sdk_embedded --stub --stub-seconds 0 --wait --no-monitor
npm run runtime-pi:run -- --profile config/profiles/builder.yaml --project config/projects/spore.yaml --session-id local-sdk-worker --run-id local-sdk-worker-run --backend-kind pi_sdk_worker --stub --stub-seconds 0 --wait --no-monitor
```

> See [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md) for the full setup guide.

<br/>

---

<br/>

## ⚙️ Configuration Model

All configuration is **declarative YAML** validated against **15 JSON schemas**. Configuration is not just descriptive -- it **directly affects live execution behavior**.

```
config/
├── profiles/           8 agent role profiles (orchestrator, coordinator, lead, ...)
├── workflows/         12 workflow templates (feature-delivery, bugfix, promotion, ...)
├── projects/           2 project definitions (example + SPORE self-management)
├── domains/            4 domain configs with executable policy defaults
├── teams/              2 team compositions
├── policy-packs/       7 reusable policy presets
├── scenarios/         11 test scenarios (including project-work and SPORE self-management flows)
├── regressions/        7 regression test suites
├── validation-bundles/ 4 validation bundle presets
├── work-item-templates/4 work-item templates for project work management
└── system/             4 system configs (defaults, runtime, observability, permissions)
```

**Policy merge precedence:**
```
  Policy Packs ──► Domain Defaults ──► Project Overrides ──► Invocation Args
  (reusable)       (per domain)        (per project)         (per call)
```

<br/>

---

<br/>

## 🧪 Testing

```bash
npm run test:policy        # Policy unit tests
npm run test:http          # HTTP/service integration tests
npm run test:web           # Web app tests
npm run test:web-proxy     # Web proxy tests
npm run test:tui           # TUI parity tests
npm run test:workspace     # Workspace manager tests
npm run test:all-local     # All local tests combined

# Opt-in real PI tests
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
SPORE_RUN_PI_E2E=1 npm run test:e2e:gateway-control

# Single test file
node --import=tsx --test path/to/file.test.ts
```

The monorepo uses `node:test` and `node:assert/strict` across policy, HTTP, web, TUI, workspace, and runtime suites.

<br/>

---

<br/>

## 🗺 Roadmap

```
  ══════════════════════════════════════════════════════════════════════
   NOW                        NEXT                       LATER
  ══════════════════════════════════════════════════════════════════════

   Planner &                  Learning-to-             Dedicated
   Scheduler ────────────►    Planning ───────────►    CLI App
   Quality                    Feedback                  (apps/cli/)

   Validation &               Autonomy                 Broader
   Promotion ────────────►    Rollout ────────────►    Autonomous
   Discipline                 Tiers                     Operation

   Integration                Broader                  Release-Quality
   Branch ───────────────►    Template ───────────►    Operator
   Diagnostics                Catalog                   Experiences

   Dashboard                  Reference                Packaging
   as Mission ───────────►    End-to-End ─────────►    & Onboarding
   Control                    Demo Flow

   Project Work
   Scenario ────────────►
   Expansion

  ══════════════════════════════════════════════════════════════════════
```

### Current Focus

The foundation is executable across all layers. The immediate focus is **unifying the work management pipeline** so it serves any project, not just SPORE itself, and **deepening the PI integration** for richer agent capabilities.

| Priority | Area | Goal |
|----------|------|------|
| 1 | **Pipeline Generalization** | Externalize SPORE-specific hardcoding; make work management project-agnostic |
| 2 | **Planner Quality** | Better prioritization, deeper planning, learning feedback |
| 3 | **Validation Discipline** | Broader bundles, rework lineage, clearer readiness states |
| 4 | **Integration Diagnostics** | Stale detection, health summaries, conflict history |
| 5 | **Mission Control** | Backlog views, review queues, deeper drilldowns |

### Vision

SPORE aims to become the platform where **PI-powered agent teams deliver software with the same governance, traceability, and quality controls that the best human teams use** -- but faster, more consistently, and with full observability into every decision.

```
   Managed                 Multi-Project          Autonomous
   Single Project ────►    Orchestration  ────►   Governance
   (current)               (next)                  (future)

   One project at          Multiple projects       System proposes
   a time, human           with configured         improvements,
   steered via chat        autonomy tiers          policy-based trust
```

<br/>

---

<br/>

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Agent Runtime** | **[PI](https://github.com/ArtificialAnomaly/pi)** | **Core runtime partner.** Bidirectional RPC, event capture, LLM access, extensible profiles |
| **Language** | TypeScript 5.9 | Type-safe, ESM-first, strong tooling |
| **Runtime** | Node.js 24+ | Built-in SQLite, ESM support, stable |
| **Storage** | SQLite (WAL mode) | Zero-ops, local-first, concurrent reads |
| **Sessions** | tmux + runtime artifacts | Durable, inspectable, operator-accessible |
| **PI Backends** | `pi_rpc`, `pi_sdk_embedded`, `pi_sdk_worker` | One PI-first runtime boundary with compatibility and SDK-backed modes |
| **HTTP** | `node:http` | Zero dependencies, full control |
| **Formatting** | Biome 2.4 | Fast, opinionated, single tool |
| **Testing** | `node:test` + `node:assert` | Built-in, no test framework dependency |
| **Modules** | ESM + NodeNext | Modern, explicit, tree-shakeable |
| **Search** | FNV-1a hash embeddings | Local-first, no external API needed |

**PI is the agent engine. SPORE is the orchestration layer.** The platform stays local-first around Node.js, SQLite, tmux, and files, while the PI integration boundary now supports both CLI RPC and SDK-backed runtime modes.

<br/>

---

<br/>

## 📚 Documentation

### Start Here

| Document | Purpose |
|----------|---------|
| [Project State & Direction](docs/plans/project-state-and-direction-handoff.md) | Where the project is and where it's going |
| [Project Work Status](docs/plans/self-build-status-and-next-steps.md) | Tactical status of the project work management system |
| [Unification Refactoring Plan](docs/plans/unification-refactoring-plan.md) | How self-build becomes the standard project work pipeline |
| [Roadmap](docs/plans/roadmap.md) | Strategic priorities: Now / Next / Later |
| [Local Dev Runbook](docs/runbooks/local-dev.md) | Setup, smoke tests, development workflow |

### Architecture

| Document | Scope |
|----------|-------|
| [System Overview](docs/architecture/system-overview.md) | Five-layer architecture |
| [Role Model](docs/architecture/role-model.md) | 8 roles, handoff contracts, topology |
| [Workflow Model](docs/architecture/workflow-model.md) | Templates, waves, governance states |
| [Session Model](docs/architecture/session-model.md) | Lifecycle, artifacts, diagnostics |
| [Runtime Model](docs/architecture/runtime-model.md) | PI-first strategy, runtime adapters, backend modes |
| [Config Model](docs/architecture/config-model.md) | Policy merge, domain defaults |
| [Client Surfaces](docs/architecture/clients-and-surfaces.md) | API routes, thin-client rules |
| [Event Model](docs/architecture/event-model.md) | Event envelope, observability |

### Decisions

16 Architecture Decision Records in [docs/decisions/](docs/decisions/), including:
- [ADR-0002: PI-First Runtime](docs/decisions/ADR-0002-runtime-pi-first.md)
- [ADR-0005: Builder-Tester Verification Workspaces](docs/decisions/ADR-0005-builder-tester-verification-workspaces.md)
- [ADR-0006: Project Coordinator Role](docs/decisions/ADR-0006-project-coordinator-role.md)
- [ADR-0007: Feature Integrator Promotion Boundary](docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md)
- [ADR-0012: Operator Chat Surface](docs/decisions/ADR-0012-operator-chat-surface.md)
- [ADR-0013: Workflow Handoffs](docs/decisions/ADR-0013-workflow-handoffs-and-runtime-role-inputs.md)
- [ADR-0014: Multi-Backend PI Runtime Adapter](docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md)
- [ADR-0015: PI SDK Worker Transport](docs/decisions/ADR-0015-pi-sdk-worker-transport.md)
- [ADR-0016: Runtime Artifact Parity](docs/decisions/ADR-0016-runtime-artifact-parity.md)
- [ADR-0017: Unified Project Work Management](docs/decisions/ADR-0017-unified-project-work-management.md)

### Full Index

[docs/INDEX.md](docs/INDEX.md) -- canonical navigation hub for all documentation.

<br/>

---

<br/>

## 🎨 Design Influences

SPORE synthesizes concepts from six reference projects -- adapting the best ideas, never cloning code:

| Reference | Key Concept | SPORE Adaptation |
|-----------|------------|------------------|
| **Overstory** | Hierarchical delegation, isolation | Orchestrator → Lead → Worker hierarchy |
| **Gastown** | Durable sessions, tmux-first | tmux-backed sessions with SQLite metadata |
| **Mulch** | Structured knowledge capture | Local-first docs KB with semantic search |
| **Beads** | Dependency-aware task graphs | Durable workflow executions with review gates |
| **PI Mono** | Extensible runtime, model abstraction | PI-first runtime with RPC and SDK-backed adapters |
| **Agentic Eng. Book** | Plan-build-review loops, governance | Documentation-first, 12 principles, phased delivery |

<br/>

---

<br/>

<div align="center">

### Core Principles

```
 ┌─────────────────────────────────────────────────────────────┐
 │                                                             │
 │   1. Documentation-first        7. Observability first      │
 │   2. Local-first by default     8. Live inspectability      │
 │   3. Composable over monolith   9. Human-steerable          │
 │   4. Profiles over hardcoded   10. Clear boundaries         │
 │   5. Templates over ad hoc     11. Safe incrementalism      │
 │   6. PI-first runtime          12. Reference, don't clone   │
 │                                                             │
 └─────────────────────────────────────────────────────────────┘
```

<br/>

**Built with discipline. Governed by design. Improving itself.**

<br/>

[![MIT License](https://img.shields.io/badge/License-MIT-A855F7?style=flat-square)](LICENSE)

</div>
