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

*A self-improving multi-agent orchestration platform*<br/>
*that governs its own development.*

<br/>

[![Node 24+](https://img.shields.io/badge/Node-24%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Zero Dependencies](https://img.shields.io/badge/Runtime_Deps-Zero-00C853?style=for-the-badge)](.)
[![Local-First](https://img.shields.io/badge/Storage-Local--First_SQLite-FF6F00?style=for-the-badge)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-A855F7?style=for-the-badge)](LICENSE)

<br/>

**Documentation-First** · **Profile-Driven** · **Self-Building** · **Human-Steerable** · **Fully Observable**

---

<br/>

[Architecture](#-architecture) · [How It Works](#-how-it-works) · [Self-Build](#-self-build-system) · [Roles](#-role-system) · [Surfaces](#-operator-surfaces) · [Quick Start](#-quick-start) · [Roadmap](#-roadmap) · [Docs](#-documentation)

</div>

<br/>

## Why SPORE?

Agentic workflows fail for three predictable reasons: they **mix implementation with coordination**, they **hide decisions in chat** that vanish when sessions end, and they provide **weak inspectability** -- operators cannot see, steer, or trust what agents are doing.

SPORE solves this with a **structured orchestration protocol** where every decision is a durable artifact, every agent runs in an inspectable session, and the system can **safely improve itself** through governed, observable loops.

> **SPORE doesn't just orchestrate agents -- it orchestrates its own evolution.**

<br/>

## ✦ Key Capabilities

<table>
<tr>
<td width="33%" valign="top">

### 🎭 Role-Based Orchestration
An orchestrator dispatches through domain-aware leads to specialized workers. Eight architectural roles with profile-driven behavior.

</td>
<td width="33%" valign="top">

### 🔄 Supervised Self-Build
SPORE plans, executes, reviews, and promotes improvements to itself through governed loops with human checkpoints.

</td>
<td width="33%" valign="top">

### 🔍 Full Observability
Every session runs in tmux. Every decision is recorded. Every workflow step produces durable, inspectable artifacts.

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

### 🧩 Zero Runtime Dependencies
Built entirely on Node.js built-ins. SQLite for state. tmux for sessions. No external services required.

</td>
</tr>
</table>

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
║   │   Orchestrator :8789 │    │    Runtime PI           │               ║
║   │   plan · invoke      │    │    plan · launch        │  EXECUTE     ║
║   │   drive · review     │    │    pi-rpc · steer       │               ║
║   │   self-build · govern│    │    tmux-backed          │               ║
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
║   │ 100+   │ │  14    │ │   6    │ │ SQLite │                        ║
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

Each step launches a tmux-backed PI session. The orchestrator drives step-by-step with watchdogs:

```
       Step 1 (scout)          Step 2 (builder)         Step 3 (tester)
      ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
      │  📡 Research │   ──►  │  🔨 Build    │   ──►  │  🧪 Verify   │
      │  tmux + PI   │        │  tmux + PI   │        │  tmux + PI   │
      │  RPC control │        │  workspace   │        │  snapshot    │
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
   │   🌐 Web UI     Execution trees · Lineage boards            │
   │   ────────      Wave progression · Governance controls      │
   │                 Self-build dashboard · Live SSE streams     │
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

## 🔄 Self-Build System

SPORE's flagship capability: **the system improves itself** through governed, observable loops with human checkpoints at every critical transition.

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

### The Self-Build Pipeline

| Stage | What Happens | Governance |
|-------|-------------|------------|
| **Goal** | Operator states an objective via chat or CLI | Natural language, converted to structured plan |
| **Plan** | System creates work items from templates | Operator reviews, edits, reorders before materialization |
| **Execute** | Each work item runs in an isolated git worktree | Policy-gated, watchdog-monitored, workspace-backed |
| **Validate** | Named validation bundles check results | Typecheck, lint, tests, format -- configurable per domain |
| **Propose** | Builder outputs become proposal artifacts | Separate review and approval transitions |
| **Promote** | Integrator moves approved work to integration branch | Never auto-merges to main; operator decides |

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
│  │  💬 Operator Chat                       │  │  📊 Self-Build    │ │
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
```

### HTTP APIs

| Service | Port | Endpoints | Purpose |
|---------|------|-----------|---------|
| **Session Gateway** | 8787 | 15+ | Session lifecycle, events, artifacts, SSE, control |
| **Orchestrator** | 8789 | 145+ | Workflows, governance, self-build, scenarios, promotion |

### Package CLIs

Over **100 operator commands** through npm scripts covering orchestration, sessions, workspaces, scenarios, regressions, self-build, goal plans, proposals, governance, and more.

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
 │  │  orchestrator    │  │  runtime-pi      │  │  session-manager │  │
 │  │  ═══════════════ │  │  ═══════════════ │  │  ═══════════════ │  │
 │  │  ~30K lines      │  │  PI integration  │  │  Lifecycle FSM   │  │
 │  │  Workflow engine  │  │  tmux launcher   │  │  SQLite store    │  │
 │  │  Self-build core  │  │  3 launcher modes│  │  Event log       │  │
 │  │  Governance       │  │  RPC control     │  │  Reconciliation  │  │
 │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
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
  orchestrator ───────┬── runtime-pi (session launch + control)
                      ├── session-manager (session state queries)
                      └── config-schema (YAML parsing)

  runtime-pi ─────────┬── session-manager (session records)
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

Optional: `pi` agent runtime (`npm install -g @mariozechner/pi-coding-agent`)

### Install & Verify

```bash
git clone <repo-url> && cd SPORE-3
npm install

# Verify everything works
npm run typecheck          # TypeScript across all workspaces
npm run lint               # Biome linter
npm run docs-kb:index      # Build docs search index
npm run config:validate    # Validate all 64 YAML configs
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
```

### Run a Workflow

```bash
# Plan a backend feature delivery
npm run orchestrator:plan -- --domain backend --roles lead,builder,tester,reviewer

# Invoke with a real objective
npm run orchestrator:invoke -- --domain backend --roles lead,reviewer \
  --objective "Implement a health check endpoint" --wait

# Self-build: create a goal plan
npm run orchestrator:goal-plan-create -- --goal "Stabilize CLI verification and docs follow-up"
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
├── workflows/         12 workflow templates (feature-delivery, bugfix, self-build, ...)
├── projects/           2 project definitions (example + spore self-reference)
├── domains/            4 domain configs with executable policy defaults
├── teams/              2 team compositions
├── policy-packs/       7 reusable policy presets
├── scenarios/         11 test scenarios (including 7 self-build scenarios)
├── regressions/        6 regression test suites
├── validation-bundles/ 4 validation bundle presets
├── work-item-templates/4 work-item templates for self-build
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

34 test files across the monorepo using `node:test` and `node:assert/strict`.

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

   Self-Build
   Scenario ─────────────►
   Expansion

  ══════════════════════════════════════════════════════════════════════
```

### Current Focus

The foundation is executable across all layers. The question has shifted from "can SPORE run?" to **"how far can SPORE safely improve itself while preserving operator trust?"**

| Priority | Area | Goal |
|----------|------|------|
| 1 | **Planner Quality** | Better prioritization, deeper planning, learning feedback |
| 2 | **Validation Discipline** | Broader bundles, rework lineage, clearer readiness states |
| 3 | **Integration Diagnostics** | Stale detection, health summaries, conflict history |
| 4 | **Mission Control** | Backlog views, review queues, deeper drilldowns |
| 5 | **Scenario Expansion** | More failure modes, protected-scope, autonomous-loop coverage |

### Vision

SPORE aims to become a platform where **multi-agent teams deliver software with the same governance, traceability, and quality controls that the best human teams use** -- but faster, more consistently, and with full observability into every decision.

The long-term trajectory:

```
   Supervised              Guarded                Autonomous
   Self-Build    ────►     Autonomy     ────►     Self-Improvement
   (current)               (next)                  (future)

   Human approves          System proposes,        System improves
   every transition        human validates         with policy-based
                           at key gates            trust boundaries
```

<br/>

---

<br/>

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Language** | TypeScript 5.9 | Type-safe, ESM-first, strong tooling |
| **Runtime** | Node.js 24+ | Built-in SQLite, ESM support, stable |
| **Storage** | SQLite (WAL mode) | Zero-ops, local-first, concurrent reads |
| **Sessions** | tmux | Durable, inspectable, operator-accessible |
| **Agent Runtime** | PI (`pi-rpc`) | Bidirectional RPC, event capture, extensible |
| **HTTP** | `node:http` | Zero dependencies, full control |
| **Formatting** | Biome 2.4 | Fast, opinionated, single tool |
| **Testing** | `node:test` + `node:assert` | Built-in, no test framework dependency |
| **Modules** | ESM + NodeNext | Modern, explicit, tree-shakeable |
| **Search** | FNV-1a hash embeddings | Local-first, no external API needed |

**Zero external runtime dependencies.** The entire platform runs on Node.js built-ins plus an optional `pi` CLI.

<br/>

---

<br/>

## 📚 Documentation

### Start Here

| Document | Purpose |
|----------|---------|
| [Project State & Direction](docs/plans/project-state-and-direction-handoff.md) | Where the project is and where it's going |
| [Self-Build Status](docs/plans/self-build-status-and-next-steps.md) | Tactical status of the self-build system |
| [Roadmap](docs/plans/roadmap.md) | Strategic priorities: Now / Next / Later |
| [Local Dev Runbook](docs/runbooks/local-dev.md) | Setup, smoke tests, development workflow |

### Architecture

| Document | Scope |
|----------|-------|
| [System Overview](docs/architecture/system-overview.md) | Five-layer architecture |
| [Role Model](docs/architecture/role-model.md) | 8 roles, handoff contracts, topology |
| [Workflow Model](docs/architecture/workflow-model.md) | Templates, waves, governance states |
| [Session Model](docs/architecture/session-model.md) | Lifecycle, artifacts, diagnostics |
| [Runtime Model](docs/architecture/runtime-model.md) | PI-first strategy, launcher modes |
| [Config Model](docs/architecture/config-model.md) | Policy merge, domain defaults |
| [Client Surfaces](docs/architecture/clients-and-surfaces.md) | API routes, thin-client rules |
| [Event Model](docs/architecture/event-model.md) | Event envelope, observability |

### Decisions

14 Architecture Decision Records in [docs/decisions/](docs/decisions/), including:
- [ADR-0002: PI-First Runtime](docs/decisions/ADR-0002-runtime-pi-first.md)
- [ADR-0005: Builder-Tester Verification Workspaces](docs/decisions/ADR-0005-builder-tester-verification-workspaces.md)
- [ADR-0006: Project Coordinator Role](docs/decisions/ADR-0006-project-coordinator-role.md)
- [ADR-0007: Feature Integrator Promotion Boundary](docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md)
- [ADR-0012: Operator Chat Surface](docs/decisions/ADR-0012-operator-chat-surface.md)
- [ADR-0013: Workflow Handoffs](docs/decisions/ADR-0013-workflow-handoffs-and-runtime-role-inputs.md)

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
| **PI Mono** | Extensible runtime, model abstraction | PI-first runtime with RPC launcher |
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
