# Project Coordinator Role Plan

## Status

Historical implementation plan.

The coordinator lane is now implemented. Use `docs/architecture/role-model.md`, `docs/architecture/workflow-model.md`, `docs/decisions/ADR-0006-project-coordinator-role.md`, and `docs/plans/project-state-and-direction-handoff.md` as current ground truth.

## Intent

Introduce a new `coordinator` role between the top-level orchestrator and domain leads so SPORE can manage multiple projects in parallel without collapsing existing lead-first workflows.

Target chain:

- `orchestrator -> coordinator -> lead -> scout/builder/tester/reviewer`
- one coordinator per project
- one coordinator manages one project only
- the top-level orchestrator remains the portfolio control plane
- leads remain responsible for domain or substream execution inside a project

## Desired End State

SPORE should be able to run several projects at the same time.

Each active project should have:

- its own coordinator-root execution family
- a dedicated coordinator profile and session
- one or more lead child executions under that coordinator
- project-local visibility into status, escalations, review stops, and handoffs
- clean separation from other project families in lineage, status, and operator surfaces

The desired execution shape is:

```text
portfolio orchestrator service
  -> project A coordinator root
       -> backend lead execution
       -> frontend lead execution
       -> docs lead execution
  -> project B coordinator root
       -> backend lead execution
       -> cli lead execution
```

## MVP Interpretation Of "Per Project"

For the first implementation, "per project" should mean:

- one persistent coordinator session per active project execution family
- not a forever-running daemon reused across unrelated runs
- one lead child lane per selected active domain by default
- support for multiple projects by running multiple coordinator-root families concurrently

Do not turn this into a resident worker-pool architecture in the first pass.

## Why The Current Model Is Not Enough

The current repository has two overlapping realities:

- the docs still describe `orchestrator -> lead -> workers`
- the executable default path is already mostly `service/API orchestrator -> lead-first workflow`

This works for one project invocation at a time, but it does not give a durable project-level coordination layer that:

- owns one project's overall objective
- knows which leads are active for that project
- can route work across multiple leads inside the same project
- can isolate one project's state from another project's state
- can surface project-level health without flattening everything into direct lead work

## Current Architecture Snapshot

### 1. Canonical role model

Current docs still encode a direct orchestrator-to-lead handoff.

Primary references:

- `docs/architecture/role-model.md`
- `README.md`
- `config/profiles/orchestrator.yaml`
- `config/profiles/lead.yaml`

Current meaning:

- orchestrator receives human direction and dispatches to leads
- lead owns a domain stream and manages specialists
- no project-scoped role exists between them

### 2. Executable planning defaults

Current planner behavior is defined in:

- `packages/orchestrator/src/invocation/plan-workflow-invocation.js`
- `services/orchestrator/server.js`
- `packages/orchestrator/src/cli/spore-orchestrator.js`

Important current facts:

- direct `plan` and `invoke` default to `maxRoles = 1`
- selected roles come from:
  1. explicit invocation roles
  2. merged domain `workflowPolicy.defaultRoles`
  3. workflow `roleSequence`
- most domain policy packs already start with `lead`

This means many current calls launch only the first role in the domain default sequence.

That is why simply prepending `coordinator` to existing role lists would be dangerous.

### 3. Config model

Current config contracts live in:

- `docs/architecture/config-model.md`
- `config/projects/spore.yaml`
- `config/projects/example-project.yaml`
- `config/domains/*.yaml`
- `schemas/project/project.schema.json`
- `schemas/domain/domain.schema.json`
- `schemas/team/team.schema.json`

Important current facts:

- domain-level role mapping exists for `lead/scout/builder/tester/reviewer`
- project config has `activeDomains[]` but no top-level `coordinatorProfile`
- project config does not currently provide a project-scoped workflow/runtime/docs/coordination policy block for a coordinator-root path
- top-level project `policyPacks` exist in some configs, but workflow planning is currently domain-oriented and does not treat the project itself as a policy source for workflow invocation

This becomes important because a project-scoped coordinator needs a policy source that is not tied to one domain.

### 4. Workflow and execution model

Current execution model references:

- `docs/architecture/workflow-model.md`
- `packages/orchestrator/src/execution/workflow-execution.js`
- `packages/orchestrator/src/store/execution-store.js`
- `packages/orchestrator/test/family-coordination.test.js`

What already exists and should be reused:

- `coordinationGroupId`
- `parentExecutionId`
- `branchKey`
- rooted execution tree reads
- family-level hold, resume, review, and approval controls
- escalation records and family stall handling

This is a strong fit for modeling a coordinator root with lead children.

### 5. Current project and domain workflows

Current workflows are mixed:

- newer domain workflows are lead-first, for example `config/workflows/backend-service-delivery.yaml`
- older templates still mention `orchestrator` in `roleSequence`, for example `config/workflows/feature-delivery.yaml`

For implementation purposes, the important fact is:

- real domain execution already works better as lead-first than as orchestrator-first

So the coordinator should sit above those workflows, not inside every one of them.

### 6. Self-build and work-item assumptions

Current managed-work touchpoints:

- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/work-items/work-items.js`
- `services/orchestrator/test/http-self-build.test.js`

Important current facts:

- several self-build flows default to `config/projects/spore.yaml`
- recommendation metadata often contains lead-first role arrays
- work-item workspace attachment logic can attach a workspace to the first role if there is no explicit mutating role
- if a future work-item launches a coordinator-first role list, the coordinator could accidentally inherit a workspace unless guarded explicitly

### 7. Workspace boundary is already favorable

Current workspace guidance already says coordinator-style roles should remain outside mutating worktrees.

Primary reference:

- `docs/specs/worktree-and-workspace-isolation.md`

Useful existing guidance already present in the repo:

- coordinator stays at project root
- coordinator and supervisors do not get worktrees
- mutating workers do

This should remain true after introducing the new role.

### 8. Operator surfaces already understand families

Current surfaces already support tree and family views:

- `services/orchestrator/server.js`
- `packages/orchestrator/src/cli/spore-orchestrator.js`
- `apps/web/public/app.js`
- `packages/tui/test/tui-parity.test.js`
- `services/orchestrator/test/http-lineage.test.js`

This means the coordinator can be introduced primarily as a new root topology, not as a brand-new operator model.

## Core Design Principles

The next agent should use these principles as hard constraints.

### 1. Preserve backward compatibility

- existing direct workflow `plan` and `invoke` flows must continue to work
- existing lead-first domain scenarios must continue to work unchanged
- do not silently convert current lead-first invocations into coordinator-root flows

### 2. Make project coordination explicit

- project-root coordination must be an explicit mode, command, or API path
- do not overload the meaning of existing `plan` and `invoke` in a way that changes old callers without opt-in

### 3. Keep coordinator project-scoped

- coordinator belongs to the project config, not to individual domains
- do not add `coordinatorProfile` to every `activeDomains[]` entry unless a later design proves it necessary

### 4. Keep leads domain-scoped

- leads still own decomposition, worker routing, and local rework loops
- coordinator manages lead lanes and project-level visibility, not builder/tester minutiae

### 5. Reuse lineage and family primitives

- prefer `coordinationGroupId`, `parentExecutionId`, tree views, and family controls
- do not invent a second project hierarchy model beside the execution family model

### 6. Keep workspace boundaries strict

- coordinator and orchestrator do not receive mutating workspaces by default
- builder/tester or other mutating lanes keep workspace ownership

### 7. Keep clients thin

- prefer additive server-authored fields over client-side heuristics
- Web and TUI should not infer coordinator topology from fragile assumptions if the server can expose it clearly

### 8. Do not expand scope into a portfolio scheduler redesign

- the top-level orchestrator service can manage many project families without introducing a brand-new portfolio execution engine in the same change

## Recommended Target Architecture

## Role Split

### Orchestrator

- receives operator intent
- selects project(s)
- chooses project-level coordination path
- starts or inspects project coordinator families
- summarizes status across projects

### Coordinator

- owns one project's active objective
- turns project intent into lead lanes
- tracks progress across those leads
- routes cross-domain dependencies or escalations upward/downward
- synthesizes project-local status for the top-level orchestrator

### Lead

- owns one domain or substream inside one project
- decomposes work into scout/builder/tester/reviewer lanes
- handles local retry, review, and approval loops
- escalates to the project coordinator only when the issue is beyond normal domain rework

### Scout / Builder / Tester / Reviewer

- unchanged baseline semantics
- continue to operate inside lead-owned workflows

## Execution Topology

Recommended topology:

```text
execution family root
  workflow: project-coordination-root
  step 1: coordinator

child execution A
  domain: backend
  workflow: backend-service-delivery
  root role: lead

child execution B
  domain: frontend
  workflow: frontend-ui-pass
  root role: lead

child execution C
  domain: docs
  workflow: docs-adr-pass
  root role: lead
```

Interpretation:

- one root execution family per active project run
- one coordinator root per project family
- one lead child execution per selected active domain in MVP
- later expansion can support multiple lead child branches per domain or substream by reusing `branchKey`

## How To Represent This In The Existing Model

Use the current execution family model directly.

Recommended durable fields:

- root execution:
  - `parentExecutionId = null`
  - `coordinationGroupId = <root execution id>`
  - workflow = project-root coordination workflow
  - root step role = `coordinator`
- child lead executions:
  - `parentExecutionId = <coordinator root execution id>`
  - `coordinationGroupId = <root execution id>`
  - `branchKey = domain:<domainId>` in MVP

Do not add a second project hierarchy outside this family model unless truly necessary.

## Coordinator Lifecycle Recommendation

Recommended root execution lifecycle:

1. create project-root execution
2. run coordinator framing step
3. spawn lead child executions for selected domains
4. hold the root execution while child lead executions are active
5. resume or settle the root when all children are settled
6. complete the project-root execution with a project summary outcome

Important note:

- the coordinator root does not need to own every child review or approval gate
- family-level tree controls already exist for operator use when needed

## Lead Lifecycle Recommendation

Lead child executions should remain structurally similar to today.

Recommended rule:

- inside the child execution, keep existing lead-first domain workflow behavior

Example child paths:

- backend: `lead -> builder -> tester -> reviewer`
- frontend: `lead -> scout -> builder -> tester -> reviewer`
- docs: `lead -> scout -> reviewer`

## Governance And Escalation Boundaries

Recommended boundary:

- domain review and approval stay inside the lead child execution
- project-wide blocking, cross-domain conflicts, or exhausted lead-level recovery can surface to the coordinator root

For MVP, do not make the coordinator the default retry target for builder or tester failures.

### Escalation routing recommendation

Use two layers:

- local lane issues keep targeting `lead`
- family or project-level issues can target `coordinator`

Current risk to address:

- escalation record creation still defaults to `targetRole = "lead"` in the execution/lifecycle layer

Implementation recommendation:

- do not globally switch that default to `coordinator`
- instead add explicit project-family escalation logic where the source context is a coordinator-root family event

## Workspace Boundary Recommendation

Coordinator rules:

- persistent or read-mostly session
- no default worktree allocation
- no proposal-backed mutation workspace by default

Lead rules:

- can remain read-mostly if only coordinating
- may receive a workspace only when current workflow semantics intentionally permit lead mutation

Builder/tester rules:

- keep current workspace semantics
- do not widen workspace attachment because coordinator exists

## Data Ownership Recommendation

Keep the current ownership split clear:

- execution family = project workflow state and lineage
- sessions = live runtime activity per role
- workspaces = mutating filesystem isolation only

Do not try to model project coordination only in session metadata.

## Recommended Contract Changes

## 1. New profile and prompt

Add:

- `config/profiles/coordinator.yaml`
- `.pi/prompts/coordinator.md`

Recommended coordinator profile baseline:

- role: `coordinator`
- session mode: persistent
- tools similar to lead, but more project-routing oriented than implementation-oriented
- permissions focused on read-config, read-docs, inspect-status, delegate-to-leads, and update-project-status
- no default mutation permissions

Recommended responsibilities in prompt:

- understand one project's current objective and active lead lanes
- route work to leads instead of workers
- summarize project state upward to orchestrator
- watch cross-domain dependencies and blocked work
- avoid direct code mutation unless a future policy explicitly allows it

## 2. Project config additions

Recommended minimum addition to project config:

```yaml
id: example-project
name: Example Multi-Domain Project
type: platform
coordinatorProfile: coordinator
```

Recommended stronger contract for project-root execution:

```yaml
id: example-project
name: Example Multi-Domain Project
type: platform
coordinatorProfile: coordinator
projectCoordinationPolicy:
  workflow: project-coordination-root
  workflowPolicy:
    stepSoftTimeoutMs: 30000
    stepHardTimeoutMs: 120000
  runtimePolicy:
    sessionModeByRole:
      coordinator: persistent
  docsKbPolicy:
    queryTerms: [example-project, project, architecture, coordination]
    resultLimit: 8
  coordinationPolicy:
    autoHoldParentOnOpenChildEscalation: true
    resumeParentWhenChildrenSettled: true
    maxHeldMs: 180000
    escalateOnFamilyStallMs: 90000
```

Why this stronger contract is recommended:

- current planner only merges domain policy sources
- a project-scoped coordinator needs project-scoped docs, runtime, and family policy defaults
- this avoids smuggling project behavior into a fake domain config

## 3. Project schema additions

Primary schema to update:

- `schemas/project/project.schema.json`

Recommended additions:

- top-level `coordinatorProfile: string`
- top-level `projectCoordinationPolicy` object

Recommended `projectCoordinationPolicy` shape mirrors existing domain blocks:

- `workflow`
- `workflowPolicy`
- `runtimePolicy`
- `docsKbPolicy`
- `coordinationPolicy`
- optional `policyPacks`

Recommended compatibility rule:

- all new fields remain optional at first so existing project configs stay valid

## 4. New root workflow template

Add a dedicated workflow template for coordinator roots.

Recommended file:

- `config/workflows/project-coordination-root.yaml`

Recommended baseline content:

```yaml
id: project-coordination-root
name: Project Coordination Root
triggerType: manual
applicableProjectTypes: [application, platform, service, orchestration-platform]
roleSequence: [coordinator]
stepSets:
  - name: project-framing
    roles: [coordinator]
    gate:
      mode: all
    policy:
      maxActiveMs: 30000
      onTimeout: hold_execution
      onFailure: open_escalation
      blockNextWaveOnOpenEscalation: true
reviewStep:
  required: false
retryPolicy:
  maxAttempts: 1
documentationUpdatePolicy:
  required: false
completionRequirements:
  - lead-lanes-created
  - child-executions-settled
  - project-status-synthesized
```

Important rule:

- this workflow is only for the project-root coordinator execution
- do not rewrite every domain workflow to include coordinator

## 5. Optional additive payload fields for clients

If clients become too heuristic-heavy, add optional derived fields on orchestrator payloads instead of making UI infer coordinator topology from raw steps.

Reasonable additive fields could include:

- `topology.kind = standalone | project_root | child_workflow | branch`
- `topology.rootRole`
- `topology.projectRootExecutionId`
- `topology.projectLaneType = coordinator | lead | worker-branch`

This is useful but should not block MVP if existing step data is enough.

## Recommended Planner And Invocation Approach

## Keep existing workflow planning intact

Do not repurpose `planWorkflowInvocation()` into a coordinator-aware mega-planner that silently changes old behavior.

Current direct path should remain:

- workflow-level planner for one execution
- lead-first child workflows unchanged

## Add a dedicated project-root path

Recommended new planner surface:

- `planProjectCoordination()`

Recommended new invocation surface:

- `invokeProjectCoordination()`

Recommended new CLI commands:

- `project-plan`
- `project-invoke`

Recommended new HTTP routes:

- `POST /projects/plan`
- `POST /projects/invoke`

This avoids breaking existing callers that use:

- `POST /workflows/plan`
- `POST /workflows/invoke`

## Recommended Planning Algorithm

For `project-plan` or `project-invoke`, use this sequence.

### Step 1: load the project

- read `config/projects/<project>.yaml`
- validate presence of `coordinatorProfile`
- determine selected domains

Recommended default domain selection:

- if operator passes domains, use them
- otherwise use all `activeDomains[]`

### Step 2: resolve project-root policy

- merge project-level coordination policy sources
- if using policy packs, merge project coordination packs before raw project overrides
- resolve root workflow path from `projectCoordinationPolicy.workflow` or default to `project-coordination-root`

### Step 3: plan the coordinator root

- role list: `['coordinator']`
- project-scoped profile resolution from `coordinatorProfile`
- `domainId = null` or `domainId = shared` for the root, but be consistent across code and payloads
- invocation id becomes the root execution id unless explicitly supplied

### Step 4: plan child lead executions

For each selected domain:

- choose the domain workflow using existing workflow resolution rules
- create a lead-first child invocation using current `planWorkflowInvocation()` logic
- set:
  - `parentExecutionId = <root execution id>`
  - `coordinationGroupId = <root execution id>`
  - `branchKey = domain:<domainId>`

Recommended child invocation id pattern:

- `<root execution id>-<domainId>-lead`

### Step 5: return a project-level plan shape

Recommended plan payload should contain:

- root coordinator invocation
- selected project metadata
- selected domains
- child lead invocations
- effective project coordination policy

This gives the next layer enough information to create the full family deterministically.

## Important Planner Details Not To Miss

### Profile resolution gap

Current planner maps domain roles through `DOMAIN_ROLE_KEYS`.

To support coordinator safely, add a separate project-scoped mapping path, for example:

- project role keys for `coordinator`
- domain role keys remain for `lead/scout/builder/tester/reviewer`

Do not pretend the coordinator is a domain role.

### Docs query gap

Current docs query builder uses role, domain, workflow, and project type.

For a project-scoped coordinator, that can be too generic.

Recommended improvement:

- include project id and project name in project-root docs queries
- allow project coordination docs query terms from project config

### Policy-source gap

Current `planWorkflowInvocation()` merges domain policy sources only.

If the next agent keeps using that function for the root without change, the coordinator root will miss:

- project-level docs query terms
- project-level coordination policy
- project-level session mode overrides
- project-level timeout policy

This is one of the easiest holes to miss.

## Recommended Execution-Engine Approach

## Root creation

Recommended sequence for `project-invoke`:

1. build project plan
2. create the coordinator root execution first
3. create all child lead executions under that root
4. drive the root family with existing tree or group controls

## Child creation

Use existing child/family primitives.

Preferred implementation choices:

- either call existing branch/fork helpers with project-planned child payloads
- or call `createExecution()` for each planned child and then reconcile the family

Important rule:

- whichever path is chosen, the child executions must be durable first-class executions, not hidden session side effects

## Recommended root-family behavior

When child lead executions exist:

- the coordinator root should enter a held or waiting state rather than pretending the project is done
- family policy should govern when the root resumes

Recommended hold reason for the root:

- `waiting_for_project_leads`

If code reuse makes that difficult initially, a project-specific hold reason can be added as additive metadata while still relying on the existing held-state model.

## Retry and rework boundary recommendation

Keep these boundaries clear:

- builder/tester/reviewer rework remains inside the lead child execution
- lead-level retry target stays driven by current domain policy
- coordinator is only involved when the issue is no longer a normal local lane problem

Examples that should remain lead-owned:

- builder test failure
- reviewer requests changes inside one domain lane
- normal retry budget use for a worker step

Examples that can justify coordinator involvement:

- cross-domain dependency conflict
- a domain lane is blocked on another lead lane
- a lead lane exhausts recovery and requires project-level rerouting
- the project family has stalled for too long

## Project completion recommendation

The root execution should not complete merely because the coordinator step ran once.

Recommended completion condition:

- all required child lead executions are settled
- no unresolved project-level escalation remains open
- the root family has emitted a final project summary or final settled state

The exact implementation can vary, but the invariant should remain.

## API, CLI, Web, And TUI Impact

## CLI

Recommended CLI additions in `packages/orchestrator/src/cli/spore-orchestrator.js`:

- `project-plan --project <path> [--domains a,b] [--objective ...]`
- `project-invoke --project <path> [--domains a,b] [--objective ...] [--wait]`

Recommended CLI compatibility rule:

- existing `plan` and `invoke` keep current behavior
- new commands handle coordinator-root families

## HTTP API

Recommended server additions in `services/orchestrator/server.js`:

- `POST /projects/plan`
- `POST /projects/invoke`

Recommended request fields:

- `project`
- `domains`
- `objective`
- `invocationId`
- `wait`
- `timeout`
- `interval`
- `launcher`
- `stub`

## Web UI

Web impact should be kept additive.

Recommended expectations for `apps/web/public/app.js`:

- show when a root execution is a project coordinator root
- label child lanes as domain lead lanes where possible
- group status by project before by raw execution id when rendering coordinator-root families
- preserve current behavior for old standalone or lead-rooted families

Useful display affordances:

- badge: `project root`
- badge: `coordinator`
- project name and project path near the root node
- domain label on child lead branches

## TUI

Recommended expectations for `packages/tui/`:

- family view should clearly show coordinator root vs lead children
- execution detail should surface project identity and topology kind when available
- legacy family view must continue to work for non-coordinator trees

## Session and live inspection

Coordinator sessions should remain inspectable through the same session and live routes.

Recommended session metadata pattern:

- project populated
- domain empty or `shared`
- role profile = coordinator
- execution id = root execution id
- no workspace linkage by default

## Self-Build And Managed Work Impact

This area is easy to overlook and can re-break the architecture later if ignored.

## Immediate risks to address

- hardcoded project defaults to `config/projects/spore.yaml`
- lead-first recommended role arrays in self-build templates
- workspace attachment fallback that may choose the first role when no builder is present

Relevant code:

- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/work-items/work-items.js`

## Recommended self-build strategy

For managed work items, add an explicit topology flag instead of inferring behavior from roles.

Recommended metadata field:

- `executionTopology: direct | project-root`

Recommended behavior:

- `direct` continues using existing `planWorkflowInvocation()` path
- `project-root` uses the new project coordination path

## Workspace attachment guardrail

Current `shouldAttachWorkspaceToRole()` can attach a workspace to the first role if there is no explicit mutating role.

That is unsafe if coordinator-root flows ever pass through work-item execution.

Recommended fix:

- explicitly exclude `coordinator` from default workspace attachment
- prefer explicit `mutatingRoles` metadata when running managed work

## Goal planner and templates

Recommended adjustments:

- stop assuming `config/projects/spore.yaml` when the project is operator-selected
- allow templates or goal plans to target a chosen project path
- do not automatically generate coordinator-first role arrays for existing workflow templates

## Migration And Compatibility Strategy

Use a staged rollout.

## Stage 1: add contracts without changing behavior

- add profile and prompt
- add project schema fields
- add docs and ADR
- keep all old workflow commands unchanged

## Stage 2: add explicit project-root commands

- add project planner and invoker
- add new root workflow template
- add one new smoke scenario

## Stage 3: update surfaces and managed work

- teach Web/TUI/CLI to recognize coordinator roots
- update work-items and self-build to tolerate project-root topology

## Stage 4: selectively adopt the new path

- add `coordinatorProfile` to project configs
- add project-root scenario(s)
- keep existing lead-first domain scenarios operational for regression coverage

## What Not To Migrate Immediately

- do not rewrite all old workflow templates
- do not remove direct domain invoke flows
- do not make every existing test depend on coordinator

## Detailed Workstreams And File Map

## Workstream A: docs and ADR

Update:

- `docs/architecture/role-model.md`
- `docs/architecture/workflow-model.md`
- `docs/architecture/config-model.md`
- `docs/architecture/clients-and-surfaces.md`
- `README.md`

Add:

- new ADR in `docs/decisions/` describing the coordinator-as-project-root decision

Main message to encode:

- orchestrator becomes portfolio control plane
- coordinator becomes project-scoped coordination role
- lead remains domain-scoped coordination role

## Workstream B: config and schema

Add or update:

- `config/profiles/coordinator.yaml`
- `.pi/prompts/coordinator.md`
- `config/workflows/project-coordination-root.yaml`
- `config/projects/spore.yaml`
- `config/projects/example-project.yaml`
- `schemas/project/project.schema.json`

Optional, only if the implementation truly uses them:

- `schemas/workflow/workflow.schema.json`
- `schemas/policy-pack/policy-pack.schema.json`
- `schemas/team/team.schema.json`
- `schemas/domain/domain.schema.json`

## Workstream C: planner and invocation

Add or update:

- `packages/orchestrator/src/invocation/plan-workflow-invocation.js`
- new project planner module if preferred
- `packages/orchestrator/src/cli/spore-orchestrator.js`
- `services/orchestrator/server.js`

Key implementation points:

- project-scoped coordinator profile resolution
- explicit project-root plan and invoke path
- domain child invocation planning using existing logic
- no silent change to old workflow plan/invoke behavior

## Workstream D: execution and family behavior

Update:

- `packages/orchestrator/src/execution/workflow-execution.js`
- `packages/orchestrator/src/lifecycle/execution-lifecycle.js`
- `packages/orchestrator/src/store/execution-store.js` only if new indexes or additive fields are needed

Key implementation points:

- root creation and child lead spawning
- coordinator-root hold/resume semantics
- project-level escalation routing without breaking lead-local defaults
- final family settlement behavior

## Workstream E: managed work and self-build

Update:

- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/work-items/work-items.js`

Key implementation points:

- explicit topology metadata
- project-path correctness
- no accidental workspace on coordinator
- no hidden SPORE-only assumptions

## Workstream F: operator surfaces

Update:

- `apps/web/public/app.js`
- `packages/tui/src/cli/spore-ops.js`
- `packages/orchestrator/README.md`
- `services/orchestrator/README.md`
- `docs/runbooks/local-dev.md`

Key implementation points:

- coordinator-root identification
- project-centric family rendering
- backward compatibility for old trees

## Test Plan

## Unit and planner tests

Add or update tests around:

- project coordinator profile resolution
- project-root planning payload shape
- child lead invocation generation by selected domain
- backward compatibility of direct `planWorkflowInvocation()`

Likely files:

- `packages/orchestrator/test/domain-policy-propagation.test.js`
- new `packages/orchestrator/test/project-coordinator-plan.test.js`

## Family behavior tests

Add or update tests around:

- coordinator root enters held state while child leads are active
- root resumes or settles when child leads settle
- project-family escalation targets coordinator only when appropriate
- lead-local retry remains unchanged

Likely files:

- `packages/orchestrator/test/family-coordination.test.js`
- new `packages/orchestrator/test/project-coordinator-family.test.js`

## HTTP tests

Add or update tests around:

- `POST /projects/plan`
- `POST /projects/invoke`
- tree payload for coordinator-root families
- backward compatibility of existing workflow routes

Likely files:

- `services/orchestrator/test/http-lineage.test.js`
- `services/orchestrator/test/http-policy.test.js`
- new `services/orchestrator/test/http-project-coordination.test.js`

## TUI and Web tests

Add or update tests around:

- project-root family rendering
- coordinator/root badges or labels
- old lineage views still working

Likely files:

- `packages/tui/test/tui-parity.test.js`
- existing web tests under `apps/web/test/`

## Self-build tests

Add or update tests around:

- work-item execution topology selection
- coordinator never receiving default workspace attachment
- project path passed through managed work correctly

Likely files:

- `services/orchestrator/test/http-self-build.test.js`
- relevant orchestrator work-item tests if added

## Validation Checklist

The next agent should not claim success until all of these are checked.

### Backward compatibility

- existing direct domain plan still works
- existing direct domain invoke still works
- existing lead-first scenarios still pass

### New project-root path

- a project can be planned through a coordinator root
- a project can be invoked through a coordinator root
- child lead executions are created per selected domain
- execution tree clearly shows `coordinator -> lead children`

### Family behavior

- root remains blocked or held while lead children are active
- root resumes or settles when children settle
- project-level escalations do not corrupt child lineage

### Governance behavior

- lead child review and approval still apply to the correct child execution
- family-level tree controls still work on a coordinator-root family

### Workspace behavior

- coordinator has no default workspace
- builder/tester workspace behavior is unchanged unless intentionally touched

### Multi-project behavior

- two projects can run at the same time
- each has its own root family and coordinator
- statuses do not mix across project ids or coordination groups

### Managed work behavior

- work-items respect the selected project path
- self-build no longer assumes SPORE-only defaults where that would break multi-project execution

## Recommended Verification Commands

Before finalizing, prefer a verification loop along these lines.

Existing checks that must still pass:

```bash
npm run docs-kb:index
npm run config:validate
npm run orchestrator:plan -- --project config/projects/example-project.yaml --domain backend
npm run orchestrator:invoke -- --project config/projects/example-project.yaml --domain backend --roles lead,reviewer --objective "Lead should produce one sentence; reviewer should respond approve, revise, or reject." --wait --stub
npm run test:http
npm run test:tui
```

New target checks to add:

```bash
npm run orchestrator:project-plan -- --project config/projects/example-project.yaml --domains backend,frontend
npm run orchestrator:project-invoke -- --project config/projects/example-project.yaml --domains backend,frontend --objective "Coordinate backend and frontend work for one project." --wait --stub
```

If the implementation adds a named scenario for coordinator-root validation, include it in the smoke loop too.

## Open Questions With Recommended Defaults

These are the main places where the next agent could get blocked. The recommended defaults are chosen to keep the implementation moving safely.

### 1. Should coordinator be a forever-running project daemon?

Recommended default:

- no
- use one persistent session per active project execution family only

### 2. Should every existing invoke path start using coordinator automatically?

Recommended default:

- no
- keep the new path explicit

### 3. Should coordinator own review and approval for all child work?

Recommended default:

- no
- keep child review and approval inside lead executions for MVP

### 4. Should coordinator exist in every domain workflow template?

Recommended default:

- no
- add one dedicated project-root workflow only

### 5. Should domain configs gain `coordinatorProfile` too?

Recommended default:

- no
- coordinator is project-scoped, not domain-scoped

### 6. Should the first pass support multiple lead lanes per domain?

Recommended default:

- no
- one lead child per selected domain is enough for MVP
- keep room for future multi-lane expansion via `branchKey`

### 7. Should the first pass add a portfolio execution tree above all projects?

Recommended default:

- no
- let the service manage multiple coordinator-root families without introducing a super-root execution layer

## Main Failure Modes To Avoid

These are the most likely ways to break the system.

- prepending `coordinator` to existing `defaultRoles` and accidentally launching only `coordinator`
- adding coordinator as a domain role instead of a project role
- forgetting project-scoped policy sources and leaving coordinator with weak docs/runtime/coordination defaults
- routing all escalations to coordinator and breaking lead-local recovery semantics
- accidentally attaching workspaces to coordinator-root flows
- changing UI/TUI assumptions without preserving old tree rendering
- keeping hidden `config/projects/spore.yaml` defaults in managed work while claiming multi-project support

## Suggested Implementation Order

If one agent is doing the whole slice, this order is safest.

### Phase 1: lock docs and config contracts

- add ADR
- add coordinator profile and prompt
- add project schema fields
- add root workflow template
- update project configs

### Phase 2: add explicit project-root planning

- add project planner
- add CLI and HTTP entrypoints
- keep old workflow entrypoints unchanged

### Phase 3: add root-family execution behavior

- create root + child executions
- add hold/resume/settle semantics
- verify escalation routing boundaries

### Phase 4: update operator surfaces

- Web labels and tree rendering
- TUI family rendering
- docs and runbooks

### Phase 5: update managed work

- topology metadata
- project path handling
- workspace guardrails

### Phase 6: validate and only then adopt

- run backward-compat tests
- run new coordinator-root tests
- add named scenario if appropriate

## Non-Goals For The First Pass

- no permanent project daemon architecture
- no rewrite of every workflow template to include coordinator
- no full portfolio scheduler or global planning redesign
- no mutation-workspace support for coordinator
- no replacement of current lead-first domain workflows

## Done Means

This change is in a safe state when all of the following are true:

- direct lead-first domain workflows still run as before
- one project can be started through a coordinator root
- one coordinator can supervise multiple lead lanes for one project
- two different projects can each have separate coordinator-root families
- child lead review and approval loops still behave correctly
- coordinator remains outside mutating workspace allocation
- self-build and work-items no longer hide SPORE-only assumptions that break multi-project use
- Web, TUI, CLI, and HTTP surfaces make the hierarchy understandable

## Paste-Ready Brief For The Next Agent

Implement a new project-scoped `coordinator` role between the top-level orchestrator and domain leads. Do not add it by prepending `coordinator` to existing workflow role lists. Model it as a dedicated project-root execution family: one coordinator root execution per active project run, with one lead child execution per selected active domain in MVP. Keep existing domain workflows lead-first inside those child executions. Add `config/profiles/coordinator.yaml`, `.pi/prompts/coordinator.md`, a dedicated root workflow such as `config/workflows/project-coordination-root.yaml`, and new project config/schema support for `coordinatorProfile` plus a project-scoped coordination policy block. Add explicit project-root planner/invoker entrypoints instead of silently changing existing workflow `plan`/`invoke` behavior. Reuse `coordinationGroupId`, `parentExecutionId`, and rooted execution tree behavior for the project family. Keep builder/tester/reviewer retry loops lead-local unless a true project-level issue requires coordinator involvement. Ensure coordinator never gets a default workspace. Update self-build/work-items so they can target a selected project and an explicit topology without falling back to `config/projects/spore.yaml`. Update Web/TUI/API surfaces so coordinator-root families are recognizable without breaking old lineage views. Validate both backward compatibility of current lead-first flows and the new multi-project coordinator-root flow.
