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
*powered by [PI](https://github.com/ArtificialAnomaly/pi) · evolving into governed project work management for software teams*

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

SPORE solves this with a **structured orchestration protocol** where every decision is a durable artifact, every agent runs in an inspectable PI session, and project work is being generalized into a **governed pipeline**: goal → plan → execute → validate → promote.

> **SPORE is building toward software project delivery with the governance, traceability, and observability of the best human teams -- with PI-powered agents doing the work inside inspectable, policy-shaped loops.**

## What's New

- Cross-domain delivery is now planner-first by default: a coordinator root gets a durable plan, adopts it into a dispatch queue, and drives domain work through explicit lead and integrator lanes.
- PI execution now runs through one SPORE-owned adapter boundary, letting `pi_rpc`, `pi_sdk_embedded`, and `pi_sdk_worker` share the same governance, artifacts, and operator inspection model.
- Project work management is converging into one governed product surface for software projects, with SPORE-on-SPORE self-build as the strongest reference flow today.
- `Agent Cockpit` is now the browser home, `Mission Map` stays rooted in execution trees, and `Operator Chat` plus project-work views act as one mission-control surface.
- Coordinator-family visibility, workflow handoffs, validation, execution-tree lineage, and promotion governance were hardened across the stack.

> See the full update summary in [docs/operations/2026-03-14-platform-runtime-and-ops-release-notes.md](docs/operations/2026-03-14-platform-runtime-and-ops-release-notes.md).

<br/>

## ✦ Key Capabilities

<table>
<tr>
<td width="33%" valign="top">

### 🎭 Role-Based Orchestration
An orchestrator dispatches through an explicit coordinator -> planner -> lead -> integrator topology. Nine agent roles, plus the human operator, shape the governance model.

</td>
<td width="33%" valign="top">

### 🔄 Governed Work Management
Objective -> Coordinate -> Dispatch -> Validate -> Promote. One governed pipeline being generalized for software projects, with self-build as the strongest SPORE reference case.

</td>
<td width="33%" valign="top">

### 🔍 Full Observability
Every agent runs in an operator-visible PI session. Every decision is recorded. Every workflow family, lane, and execution tree emits durable, inspectable artifacts across RPC and SDK-backed runtime modes.

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
│   SPORE plans the work, PI executes it, SPORE governs the result.   │
│   SPORE preserves live inspectability across tmux-backed and         │
│   SDK-backed PI runtime modes. Operators can inspect and steer       │
│   active agent work through SPORE's PI control surfaces.             │
└─────────────────────────────────────────────────────────────────────┘
```

### How PI Integrates

| Backend | Internal Kind | Use Case |
|---------|---------------|----------|
| **PI RPC** | `pi_rpc` | **Primary.** tmux-backed bidirectional control with live steer, follow-up, abort, and state inspection |
| **PI SDK Embedded** | `pi_sdk_embedded` | In-process SDK launch path behind the same SPORE runtime contract |
| **PI SDK Worker** | `pi_sdk_worker` | Worker-process SDK isolation with the same orchestration and artifact model |
| **Stub** | *(no PI needed)* | Testing and launcher validation without requiring a live PI install |

SPORE resolves these runtime choices behind its own adapter boundary, so orchestration, governance, and operator inspection stay consistent even as the PI transport changes. When PI is unavailable, SPORE falls back to stub mode for development-only flows.

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
║   │   Orchestrator :8789 │    │ Runtime Core + Adapter  │               ║
║   │   plan · invoke      │    │ boundary · launch       │  EXECUTE     ║
║   │   drive · review     │    │ pi_rpc · sdk · worker   │               ║
║   │   work mgmt · govern │    │ artifact parity         │               ║
║   └──────────┬───────────┘    └──────────┬─────────────┘               ║
║              └───────── step drive ──────┘                              ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                                                                         ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             ║
║   │Profiles│ │Workflows│ │Projects│ │Domains │ │ Policy │  CONFIGURE  ║
║   │  9     │ │  12    │ │   2    │ │   4    │ │ Packs 7│             ║
║   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘             ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        ║
║   │Scenarios│ │Regress.│ │V-Bundle│ │Schemas │                        ║
║   │  11    │ │   7    │ │   4    │ │  17    │                        ║
║   └────────┘ └────────┘ └────────┘ └────────┘                        ║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║                                                                         ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        ║
║   │  Docs  │ │  ADRs  │ │Research│ │Docs KB │   KNOWLEDGE            ║
║   │ 100+   │ │  18    │ │   6    │ │ SQLite │                        ║
║   └────────┘ └────────┘ └────────┘ └────────┘                        ║
║                                                                         ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

**Core boundary rules:**
- Clients are thin over HTTP -- never touch SQLite directly
- Sessions explain runtime; executions explain workflow; coordinator families explain project management
- Planner-first coordination is structural: coordinator root -> planner lane -> adopted dispatch queue -> domain lead lanes -> integrator promotion lane
- Approval != Promotion != Merge -- each is a distinct governed transition

<br/>

---

<br/>

## ⚡ How It Works

### 1. Coordinate & Plan

The operator objective now materializes as a coordinator-root execution family. That root launches a planner lane, receives a `coordination_plan` handoff, and adopts the validated result into a dispatch queue before any domain lead lane starts:

```
   Operator Objective
          │
          ▼
   ┌──────────────────────┐
   │ Coordinator Root     │
   │ project family       │
   │ mode + policy state  │
   └──────────┬───────────┘
              │ launches
              ▼
   ┌──────────────────────┐
   │ Planner Lane         │
   │ domain ordering      │
   │ dependencies         │
   │ waves + contracts    │
   └──────────┬───────────┘
              │ publishes
              ▼
     `coordination_plan`
              │ adopted by
              ▼
   Coordinator Dispatch Queue
   (wave-aware durable state)
```

### 2. Dispatch & Execute

Once the adopted queue is ready, the coordinator dispatches domain tasks into lead lanes. Those lanes run their role steps through the SPORE-owned runtime adapter boundary, whether the active backend is RPC, embedded SDK, or worker SDK:

```
   Dispatch Queue          Domain Lead Lane        RuntimeAdapter Boundary
  ┌──────────────┐        ┌────────────────┐      ┌────────────────────────┐
  │ wave-1 task  │ ────►  │ backend lead   │ ───► │ `pi_rpc`               │
  │ wave-2 task  │ ────►  │ frontend lead  │ ───► │ `pi_sdk_embedded`      │
  │ held task    │        │ docs lead      │ ───► │ `pi_sdk_worker`        │
  └──────────────┘        └───────┬────────┘      └────────────┬───────────┘
                                   │                            │
                                   ▼                            ▼
                        scout_findings / task_brief     runtime-status / events
                        implementation_summary          workspace snapshots
                        verification_summary            backend-aware artifacts
```

### 3. Validate, Review & Promote

Workflow handoffs, validation bundles, and reviewer gates harden readiness before promotion. The integrator lane is the governed promotion path for work that clears those gates:

```
   Lead Lane Outputs
          │
          ▼
   Validation Bundles
   + workflow handoffs
          │
          ▼
   ┌──────────────┐
   │  Reviewer    │
   │ approve /    │
   │ revise /     │
   │ reject       │
   └──────┬───────┘
          │ ready for promotion
          ▼
   ┌──────────────┐        ┌───────────────────────────┐
   │ Integrator   │   ──►  │ Integration Branch        │
   │ promotion    │        │ governed landing zone     │
   │ lane         │        │ (never auto-merge main)   │
   └──────────────┘        └───────────────────────────┘
```

### 4. Observe & Steer

Every artifact is inspectable. Operators see the coordinator family, execution tree, runtime state, and governance posture in real time:

```
   ┌─────────────────────────────────────────────────────────────┐
   │                    OPERATOR SURFACES                         │
   │                                                             │
   │   💬 Chat       "Start a docs maintenance pass"             │
   │   ────────      Operator Chat creates objectives, reviews    │
   │                 plans, approves gates, and steers lanes      │
   │                                                             │
   │   🌐 Web UI     Agent Cockpit · Mission Map                 │
   │   ────────      Project Work · Self-Build · Operator Chat   │
   │                 Execution trees, family lanes, SSE, review  │
   │                                                             │
   │   📟 TUI        Dashboard · Inspect · Run-center            │
   │   ────────      100+ commands · coordination visibility     │
   │                                                             │
   │   📊 Events     NDJSON event log · SSE streaming            │
   │   ────────      Session + workflow + control + queue events │
   └─────────────────────────────────────────────────────────────┘
```

<br/>

---

<br/>

## 🔄 Project Work Management

SPORE's flagship capability is a **governed work pipeline** that is being unified into a reusable product surface for software delivery. Today, the strongest reference flow is SPORE using that planner-first pipeline on its own repository.

```
   ┌─────────────┐   ┌────────────────┐   ┌────────────────┐   ┌──────────────┐   ┌──────────────┐
   │ 🎯 Objective │──►│ 📋 Coordinate  │──►│ ⚙️ Dispatch    │──►│ ✅ Validate   │──►│ 🚀 Promote   │
   └──────┬──────┘   └───────┬────────┘   └────────┬───────┘   └──────┬───────┘   └──────┬───────┘
          │                  │                       │                  │                  │
          ▼                  ▼                       ▼                  ▼                  ▼
   Operator goal      Coordinator root        Domain lead lanes   Review + approval   Integrator lane
   via chat/CLI       + planner lane          in isolated         + validation        to integration
                       + adopted queue        workspaces          bundles             branch
```

### The Work Management Pipeline

| Stage | What Happens | Governance |
|-------|-------------|------------|
| **Objective** | Operator states an objective via chat or CLI | Natural language intent becomes a durable coordinator-root mission |
| **Coordinate** | Coordinator root launches the planner lane and adopts a `coordination_plan` | Family mode, adopted plan, and queue state stay visible before execution |
| **Dispatch** | The coordinator dispatch queue materializes domain work into lead lanes and isolated workspaces | Wave-aware sequencing, workspace isolation, and policy-backed routing |
| **Validate** | Workflow handoffs, validation bundles, and reviewer gates check readiness | Validation, review, approval, and promotion remain distinct governed states |
| **Promote** | Integrator lane promotes approved work to the integration branch | Never auto-merges to main; operator decides when and how to land |

> **Note:** SPORE uses this pipeline to manage its own development -- a capability we call "self-build." That self-build flow is the reference case for the broader project-work-management product surface.

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

Nine agent roles, plus the human operator, form SPORE's delegation topology. Concrete behavior is attached via **profiles** -- the same role can have domain-specific variants, while coordinator, planner, and integrator make the project-family control flow explicit.

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
                              │     persistent   │  Adopts plan, owns queue
                              └────────┬────────┘
                                        │
                               ┌────────▼────────┐
                               │   🧭 PLANNER    │  Planning lane
                               │     persistent   │  Publishes coordination_plan
                               └────────┬────────┘
                                        │ adopted into queue
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
 │📡SCOUT│  │🔨BUILD │  │🧪TEST  │  ───► │📝REVIEWER│ ───► │🔄 INTEGRATOR │
 │explore│  │ code   │  │verify  │       │ approve/ │     │ promotion    │
 │analyze│  │ docs   │  │report  │       │ revise/  │     │ lane         │
 │       │  │        │  │        │       │ reject   │     │ to branch    │
 └───────┘  └────────┘  └────────┘       └──────────┘     └──────────────┘
 ephemeral   ephemeral   ephemeral        ephemeral          persistent
```

The persistent project-family lanes are **coordinator**, **planner**, domain **lead** lanes, and the **integrator** promotion lane. **Scout**, **builder**, **tester**, and **reviewer** provide the execution and governance steps beneath those lanes.

### Workflow Handoffs

Each role produces a **semantic handoff artifact** consumed by the next step:

```
   Planner ──────► coordination_plan ───────────────► coordinator adopted queue
                                                                        │
   Lead ─────────► task_brief ─────────────────────────────────────────►│
                                                                        │
   Scout ────────► scout_findings ─────────────────────────────────────►│
                                                                        │
   Builder ──────► implementation_summary + workspace_snapshot ────────►│
                                                                        │
   Tester ───────► verification_summary ───────────────────────────────►│
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

`Agent Cockpit` is now the browser home. From there, operators move into `Mission Map`, `Operator Chat`, and project/self-build work views with execution-tree-rooted visibility:

```
┌──────────────────────────────────────────────────────────────────────┐
│  SPORE Operator Console / Agent Cockpit                     :8788   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────┐  ┌───────────────────┐ │
│  │  💬 Operator Chat                       │  │  📊 Project Work  │ │
│  │  ─────────────────                      │  │  + Self-Build     │ │
│  │  > "Run a docs maintenance pass"        │  │                   │ │
│  │                                         │  │  Goals:  3 active │ │
│  │  🤖 I created a coordinator root and    │  │  Queue:  5 tasks  │ │
│  │     planner lane. Review this adopted   │  │  Waves:  2 live   │ │
│  │     coordination plan before dispatch.  │  │  Proposals: 2     │ │
│  │                                         │  │                   │ │
│  │  [Approve Plan] [Inspect Queue] [Chat]  │  │  ⚠️ 1 needs review │ │
│  └─────────────────────────────────────────┘  │  ✅ 7 validated    │ │
│                                                └───────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  Mission Map (execution-tree rooted)                             ││
│  │  ├── coordinator-root (held)                                     ││
│  │  │   ├── planner-lane (completed) -> adopted v3                  ││
│  │  │   ├── lead-backend (running) -> builder                       ││
│  │  │   ├── lead-frontend (waiting_review)                          ││
│  │  │   └── integrator-lane (planned)                               ││
│  │  Event Timeline ─── SSE / queue / governance stream ──────────  ││
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

`spore-ops` is now broader than a dashboard/inspect helper; it is the terminal counterpart to `Agent Cockpit`, `Mission Map`, and the project-work mission-control surfaces.

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
 │  │  Gov-aware clean │  │  SQLite store    │  │  17 schema defs  │  │
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
git clone <repo-url> && cd SPORE-3
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

All configuration is **declarative YAML** validated against **17 JSON schemas**. Configuration is not just descriptive -- it **directly affects live execution behavior**.

```
config/
├── profiles/           9 agent role profiles (orchestrator, coordinator, planner, ...)
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

The foundation is executable across all layers. The immediate focus is **turning the current SPORE-on-SPORE work pipeline into a reusable project-work-management product surface** and **deepening the PI integration** for richer agent capabilities.

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
| **Sessions** | runtime artifacts + tmux/RPC | Durable, inspectable, operator-accessible |
| **PI Backends** | `pi_rpc`, `pi_sdk_embedded`, `pi_sdk_worker` | One PI-first runtime boundary with compatibility and SDK-backed modes |
| **HTTP** | `node:http` | Zero dependencies, full control |
| **Formatting** | Biome 2.4 | Fast, opinionated, single tool |
| **Testing** | `node:test` + `node:assert/strict` | Built-in, no test framework dependency |
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
| [Role Model](docs/architecture/role-model.md) | 9 roles, handoff contracts, topology |
| [Workflow Model](docs/architecture/workflow-model.md) | Templates, waves, governance states |
| [Session Model](docs/architecture/session-model.md) | Lifecycle, artifacts, diagnostics |
| [Runtime Model](docs/architecture/runtime-model.md) | PI-first strategy, runtime adapters, backend modes |
| [Config Model](docs/architecture/config-model.md) | Policy merge, domain defaults |
| [Client Surfaces](docs/architecture/clients-and-surfaces.md) | API routes, thin-client rules |
| [Event Model](docs/architecture/event-model.md) | Event envelope, observability |

### Decisions

18 Architecture Decision Records in [docs/decisions/](docs/decisions/), including:
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
