# Feature Integrator Role Plan

## Status

Historical implementation plan.

The integrator promotion lane is now implemented. Use `docs/architecture/role-model.md`, `docs/architecture/workflow-model.md`, `docs/decisions/ADR-0007-feature-integrator-promotion-boundary.md`, and `docs/plans/project-state-and-direction-handoff.md` as current ground truth.

## Intent

Introduce a new `integrator` role as the explicit post-review promotion and merge lane for one feature-sized change set inside a project.

This role should:

- start only after the required task and domain review loops are already settled,
- check whether the full feature can be integrated safely against the target branch, usually `main`,
- resolve clearly mechanical conflicts when that is safe,
- run the required integration validation,
- either land the change or escalate the blocker back to the project coordinator so the relevant leads can repair the underlying issue.

Recommended target chain:

- `orchestrator -> coordinator -> lead -> scout/builder/tester/reviewer`
- `orchestrator -> coordinator -> integrator`
- one coordinator per active project execution family,
- one integrator execution per explicit promotion attempt,
- leads keep owning domain delivery and rework,
- coordinator keeps owning project routing and escalations,
- integrator owns guarded integration and merge readiness.

## Feature Assumptions

For this plan, a feature should be interpreted with these assumptions.

- A feature is already decomposed into tasks or domain lanes before the integrator runs.
- Each task or lane has already gone through its normal review path.
- The feature may span one or more domains and one or more lead-owned child executions.
- The feature has one intended target branch, defaulting to `main` unless project policy says otherwise.
- The feature can only be promoted if the child lanes produced durable mergeable outputs, not only chat summaries.
- Promotion is an explicit operator or workflow action, not an automatic side effect of reviewer approval.

## MVP Interpretation Of "Feature"

For the first implementation, "feature" should mean:

- one bounded promotion set under one project execution family,
- usually the current coordinator-root family objective,
- optionally labeled by `featureId` when the caller already has one,
- otherwise keyed by the project root execution id or promotion execution id,
- not a brand-new durable feature registry in the first pass.

Recommended default:

- if the operator runs one project-root family for one feature objective, treat that family as the promotion scope.

Do not add a second parallel hierarchy for feature tracking if rooted execution families are already sufficient for MVP.

## Desired End State

SPORE should be able to take a fully reviewed feature-sized change and run one explicit promotion path that:

- checks whether all required lead lanes are settled and approved,
- gathers durable source artifacts for the lanes that must be integrated,
- creates or reuses a dedicated integration workspace and branch,
- compares the sources against the target branch,
- resolves only safe mechanical conflicts,
- runs integration validation,
- either:
  - produces a durable `promotion_candidate`,
  - performs a guarded merge to the target branch when project policy explicitly allows it,
  - or creates a durable blocker or escalation that routes back through the coordinator.

The desired execution shape is:

```text
portfolio orchestrator service
  -> project coordinator root
       -> backend lead execution
       -> frontend lead execution
       -> docs lead execution
       -> feature integrator execution
```

Interpretation:

- the integrator is not a replacement for the coordinator,
- the integrator is not the new default final step of every domain workflow,
- the integrator is a project-scoped promotion lane that runs after required child work is ready.

## Why The Current Model Is Not Enough

The current repository already has strong workflow, review, and workspace building blocks, but it still stops short of a clear post-review promotion boundary.

### 1. The canonical role model stops at reviewer

Current docs describe:

- `orchestrator`,
- `lead`,
- `scout`,
- `builder`,
- `tester`,
- `reviewer`.

Primary references:

- `docs/architecture/role-model.md`
- `README.md`
- `config/profiles/*.yaml`

The missing piece is a role that owns feature-level integration after domain review is already done.

### 2. Current workflow governance ends at review and approval

The workflow model already supports:

- review and approval gates,
- escalation records,
- held or paused execution states,
- rooted execution trees.

Primary references:

- `docs/architecture/workflow-model.md`
- `packages/orchestrator/src/lifecycle/execution-lifecycle.js`
- `packages/orchestrator/src/store/execution-store.js`

What is still missing is an explicit promotion stage between "approved work exists" and "the target branch has been updated safely".

### 3. The long-range roadmap already points to a promotion boundary

The roadmap already anticipates:

- a durable `promotion candidate` state,
- validation before integration,
- a separate explicit integration boundary after proposal approval.

Primary references:

- `docs/plans/long-range-self-build-roadmap.md`

This means the integrator is not an arbitrary new concept. It is the missing execution role that turns those roadmap ideas into a concrete lane.

### 4. The workspace model already has the right physical shape

Current workspace guidance already says:

- the canonical root stays read-mostly,
- mutating work should happen in dedicated worktrees,
- execution families may later share integration branch metadata,
- a family should not default to one shared worktree.

Primary references:

- `docs/specs/worktree-and-workspace-isolation.md`
- `packages/workspace-manager/README.md`
- `packages/orchestrator/src/execution/workflow-execution.js`

That is already a good fit for an integrator that needs one integration workspace without collapsing the whole family into one mutable directory.

### 5. The planner is still domain-role oriented

Current planner behavior maps profiles through domain role keys such as:

- `lead`,
- `scout`,
- `builder`,
- `tester`,
- `reviewer`.

Primary reference:

- `packages/orchestrator/src/invocation/plan-workflow-invocation.js`

That means the integrator should not be smuggled in as a fake domain role.

### 6. Escalation defaults still assume lead-local recovery

Current escalation record creation still defaults to `targetRole = "lead"`.

Primary reference:

- `packages/orchestrator/src/lifecycle/execution-lifecycle.js`

That is correct for builder or tester failures, but it is incomplete for promotion blockers that are project-level or cross-domain.

### 7. Current promotion inputs are not yet a first-class contract

Today, reviewed work may exist as:

- execution results,
- proposal artifacts,
- workspace branches,
- diff summaries,
- validation outputs.

Those are promising primitives, but the system does not yet define one durable contract for what an integrator is allowed to merge from.

This is one of the most important gaps to close in the first pass.

## Why `integrator` Should Be Separate From `lead` And `coordinator`

Recommended boundary:

- `lead` owns domain delivery, decomposition, local rework, and local review loops,
- `coordinator` owns cross-domain routing, status synthesis, and escalation management,
- `integrator` owns the explicit promotion step that checks whether the reviewed outputs can safely move toward the target branch.

Reasons not to overload `lead`:

- a single lead should not own cross-domain merge arbitration for the whole feature,
- that would couple one domain lane to project-level integration decisions,
- it becomes unclear which lead is authoritative for mixed backend or frontend or docs conflicts.

Reasons not to overload `coordinator`:

- the coordinator plan intentionally keeps that role read-mostly and project-routing focused,
- merge mechanics and validation runs are mutating and operationally different work,
- mixing project supervision and target-branch mutation into one role makes safety boundaries weaker.

## Core Design Principles

The next agent should use these principles as hard constraints.

### 1. Keep promotion explicit

- do not silently merge to `main` because reviewers approved child lanes,
- require an explicit planner or invoker path for promotion.

### 2. Keep coordinator read-mostly by default

- coordinator should not become the default mutating merge actor,
- integrator should own the integration workspace instead.

### 3. Keep leads responsible for rework

- if promotion reveals a semantic blocker, route it back to the relevant leads through the coordinator,
- do not force the integrator to become the repair lane for domain bugs.

### 4. Merge only from durable artifacts

- promotion should consume proposal artifacts, workspace branches, or equivalent durable outputs,
- do not infer mergeable state from chat transcripts or one-line task summaries.

### 5. Distinguish mechanical conflicts from semantic conflicts

- clearly mechanical conflicts may be resolved by the integrator,
- ambiguous or semantic conflicts must escalate,
- when in doubt, escalate.

### 6. Preserve backward compatibility

- existing direct domain plan and invoke flows must continue to work,
- existing lead-first child workflows must continue to work unchanged,
- reviewed work that does not opt into promotion should still stop where it stops today.

### 7. Reuse lineage, family, and workspace primitives

- prefer rooted execution trees,
- prefer `coordinationGroupId`, `parentExecutionId`, and `branchKey`,
- prefer dedicated integration workspaces over ad hoc root mutations.

### 8. Keep client surfaces additive

- web and TUI should receive promotion status as additive data,
- do not make clients reverse-engineer promotion state from raw events if the server can expose it directly.

### 9. Prefer promotion before auto-merge

- the first pass should aim for explicit `promotion_candidate` or `ready_to_merge` semantics,
- only merge directly to `main` when project policy explicitly allows it.

## Recommended Target Architecture

## Role Split

### Orchestrator

- receives operator intent,
- selects the project or execution family,
- chooses whether to inspect, continue, or start a promotion flow,
- summarizes status across project families.

### Coordinator

- owns one project's active objective,
- supervises lead lanes,
- decides when a feature is ready for promotion,
- receives promotion blockers from the integrator,
- routes semantic conflicts back to the right leads.

### Lead

- owns one domain or substream,
- manages scout or builder or tester or reviewer lanes,
- resolves local review and rework loops,
- produces durable outputs that are suitable for promotion,
- does not own final target-branch integration for the whole feature.

### Integrator

- gathers the outputs from the required feature lanes,
- checks target-branch freshness and integration readiness,
- provisions and manages the integration workspace,
- applies or merges source artifacts into an integration branch,
- resolves clearly mechanical conflicts when safe,
- runs required integration validation,
- either:
  - produces a promotion candidate,
  - lands the change when policy explicitly allows it,
  - or escalates a blocker back to the coordinator.

### Scout / Builder / Tester / Reviewer

- unchanged baseline semantics inside lead-owned workflows,
- reviewer remains the independent gate for lane quality,
- integrator does not replace the reviewer.

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

child execution D
  domain: shared
  workflow: feature-promotion
  root role: integrator
```

Interpretation:

- one coordinator-root execution family still represents the project or feature objective,
- lead children remain the delivery lanes,
- one integrator child execution is added only when promotion is explicitly requested,
- the integrator child belongs to the same coordination family as the lead lanes,
- the coordinator root can hold while the integrator child is active.

## How To Represent This In The Existing Model

Use the current execution family model directly.

Recommended durable fields:

- coordinator root execution:
  - `parentExecutionId = null`
  - `coordinationGroupId = <root execution id>`
  - root role = `coordinator`
- lead child executions:
  - `parentExecutionId = <root execution id>`
  - `coordinationGroupId = <root execution id>`
  - `branchKey = domain:<domainId>`
- integrator child execution:
  - `parentExecutionId = <root execution id>`
  - `coordinationGroupId = <root execution id>`
  - `branchKey = promotion:<featureId>` in MVP, or `promotion:<rootExecutionId>` when no feature id exists

Do not build a second unrelated promotion hierarchy if the existing family model can already express the relationship.

## Promotion Preconditions Recommendation

The integrator should not start unless these checks pass or are explicitly overridden by policy.

### Required family readiness

- all required lead child executions for the feature are settled,
- no required lead lane is still in normal local rework,
- required review and approval decisions are already recorded,
- no unresolved project-level escalation remains open unless policy explicitly allows promotion to inspect a blocked family.

### Required source readiness

- every required lane produced a durable integration source,
- every source can be traced to an execution, proposal artifact, branch, or workspace allocation,
- the source records identify the intended base ref or can be reconciled safely.

### Required target readiness

- the project target branch is known,
- the target ref can be fetched or resolved,
- the promotion policy for auto-merge or promotion-candidate mode is known before work starts.

## Durable Source Contract Recommendation

This area is easy to underspecify. The first pass should define clearly what an integrator is allowed to merge from.

Recommended accepted source types for MVP:

- proposal artifact with normalized diff or patch data,
- workspace allocation with branch metadata,
- execution-step workspace branch metadata,
- explicitly provided source branch refs from managed work.

Recommended normalized source record shape:

```yaml
executionId: exec-backend-001
domainId: backend
role: builder
proposalArtifactId: proposal-123
workspaceId: ws-123
branchName: spore/example-project/execution-step/exec-backend-001-step-2
baseRef: main
status: approved
```

Important rule:

- if a required lane only produced a textual summary and no durable change artifact, the integrator should stop with a promotion blocker such as `missing_promotion_source`.

## Conflict Handling Recommendation

The integrator needs explicit conflict classification rules.

### Safe-to-resolve mechanical conflicts

Examples that may be acceptable for integrator-owned resolution when evidence is clear:

- docs index ordering collisions,
- manifest or config key ordering collisions,
- deterministic generated-file refresh after the actual source merge is already understood,
- non-overlapping import list or export list merges where intent is unambiguous and validation can prove correctness.

### Semantic or ambiguous conflicts

Examples that should escalate instead of auto-resolving:

- two lanes change the same logic path with different behavior,
- one lane changes an API contract and another lane still depends on the old shape,
- migrations or schema changes require ordering or rollback decisions,
- conflicting product or architecture intent is visible in the merged diff,
- the integrator cannot explain the resolution in one precise sentence.

Recommended default:

- if the conflict is not obviously mechanical, treat it as semantic and escalate.

## Integrator Lifecycle Recommendation

Recommended integrator child execution lifecycle:

1. receive a promotion request for one coordinator-root family,
2. inspect child lane status and promotion prerequisites,
3. gather durable source artifacts,
4. resolve project promotion policy,
5. provision an integration workspace and branch,
6. update or fetch the target branch state,
7. apply or merge the source artifacts into the integration branch,
8. classify and resolve safe conflicts when possible,
9. run required validation bundles or named validations,
10. if validation passes:
   - create `promotion_candidate` output by default,
   - or merge to the target branch only when project policy allows it,
11. if promotion is blocked:
   - create a durable blocker summary,
   - open a coordinator-targeted escalation,
   - keep the workspace and evidence available for recovery.

## Coordinator Interaction Recommendation

Recommended coordinator behavior around promotion:

- the coordinator decides whether the family is ready to promote,
- the coordinator spawns or authorizes the integrator lane,
- the coordinator root may enter a held state while promotion is active,
- if the integrator escalates a semantic blocker, the coordinator routes that blocker to the responsible lead lanes,
- the coordinator does not become the merge worker.

Recommended root hold reason:

- `waiting_for_feature_promotion`

## Promotion Outcome Recommendation

Keep execution terminal states and promotion outcomes separate.

Recommended additive promotion outcome values:

- `promotion_candidate`
- `merged`
- `blocked`
- `validation_failed`
- `policy_waiting_approval`
- `escalated`

Recommended interpretation:

- the integrator execution may be `completed` while `promotionStatus = promotion_candidate`,
- the integrator execution may be `held` while `promotionStatus = blocked`,
- the project root may stay `held` while promotion blockers remain unresolved.

This avoids overloading workflow execution state with target-branch semantics.

## Governance And Escalation Boundaries

Recommended boundary:

- task review stays inside the lead child executions,
- feature promotion review stays with the integrator and operator policy,
- semantic blockers route upward to the coordinator,
- repair work routes back downward to the relevant leads.

### Escalation routing recommendation

Use two layers:

- local lane issues continue targeting `lead`,
- promotion blockers target `coordinator` when the source role is `integrator`.

Current risk to address:

- escalation creation still defaults to `targetRole = "lead"`.

Implementation recommendation:

- do not globally change that default,
- add explicit promotion escalation logic where `sourceRole = integrator` and the family root is coordinator-owned.

Recommended blocker classes:

- `missing_promotion_source`
- `target_branch_not_fresh`
- `mechanical_conflict_resolved`
- `semantic_conflict`
- `validation_failed`
- `policy_blocked`
- `unsafe_merge_request`

Only some of those are terminal blockers. For example, `mechanical_conflict_resolved` is an event class, not necessarily a failure class.

## Workspace Boundary Recommendation

Coordinator rules:

- no default mutation workspace,
- no direct merge activity in the canonical root.

Lead rules:

- no change from the coordinator plan,
- lead workspaces remain domain-lane scoped when mutation is required.

Integrator rules:

- must use a dedicated integration workspace when mutating,
- may record `integrationBranch` metadata,
- should not mutate the project root directly,
- should preserve the workspace while promotion is blocked or awaiting approval.

Important rule:

- do not introduce a shared family worktree as the default promotion boundary.

## Data Ownership Recommendation

Keep the ownership split explicit:

- execution family = project and promotion workflow state,
- sessions = runtime activity per role,
- workspaces = mutating filesystem isolation,
- proposal artifacts = durable source inputs for promotion,
- promotion outcome = additive execution metadata or events in MVP.

Recommended MVP data strategy:

- do not require a brand-new top-level promotion database table in the first pass if execution metadata and event history are sufficient,
- but do persist one normalized promotion summary on the integrator execution so clients do not need to infer it from raw git logs.

## Recommended Contract Changes

## 1. New profile and prompt

Add:

- `config/profiles/integrator.yaml`
- `.pi/prompts/integrator.md`

Recommended integrator profile baseline:

- role: `integrator`
- session mode: persistent for the duration of one promotion attempt,
- tools oriented around status inspection, proposal inspection, workspace inspection, git integration, and validation triggering,
- permissions focused on read-config, read-docs, inspect-status, mutate-integration-workspace, run-validation, and update-promotion-status,
- no default mutation permission in the canonical project root.

Recommended responsibilities in prompt:

- understand the promotion request and target branch,
- gather approved child outputs,
- integrate only from durable sources,
- resolve safe mechanical conflicts only,
- explain blockers precisely,
- stop and escalate when the issue becomes semantic or policy-sensitive.

## 2. Project config additions

Recommended minimum addition to project config:

```yaml
id: example-project
name: Example Multi-Domain Project
type: platform
coordinatorProfile: coordinator
integratorProfile: integrator
promotionPolicy:
  workflow: feature-promotion
  targetBranch: main
  autoMergeToTarget: false
  requireFreshTarget: true
  allowMechanicalConflictResolution: true
  requireHumanApprovalToLand: true
```

Recommended stronger contract:

```yaml
id: example-project
name: Example Multi-Domain Project
type: platform
coordinatorProfile: coordinator
integratorProfile: integrator
promotionPolicy:
  workflow: feature-promotion
  targetBranch: main
  integrationBranchPrefix: spore/promote
  autoMergeToTarget: false
  requireFreshTarget: true
  allowMechanicalConflictResolution: true
  maxConflictFiles: 20
  requireHumanApprovalToLand: true
  validationBundles: [smoke, regression]
  coordinationPolicy:
    autoHoldParentOnOpenPromotionEscalation: true
    resumeParentWhenPromotionSettled: true
    maxHeldMs: 180000
```

Why this stronger contract is recommended:

- promotion needs project-scoped target-branch policy,
- promotion needs a project-scoped validation requirement,
- promotion needs explicit rules for whether merge-to-target is allowed automatically,
- this policy should not be hidden inside a domain override.

## 3. Project schema additions

Primary schema to update:

- `schemas/project/project.schema.json`

Recommended additions:

- top-level `integratorProfile: string`
- top-level `promotionPolicy` object

Recommended `promotionPolicy` shape:

- `workflow`
- `targetBranch`
- `integrationBranchPrefix`
- `autoMergeToTarget`
- `requireFreshTarget`
- `allowMechanicalConflictResolution`
- `maxConflictFiles`
- `requireHumanApprovalToLand`
- `validationBundles`
- `coordinationPolicy`

Recommended compatibility rule:

- all new fields remain optional at first so existing project configs stay valid.

## 4. New promotion workflow template

Add a dedicated workflow template for integrator executions.

Recommended file:

- `config/workflows/feature-promotion.yaml`

Recommended baseline content:

```yaml
id: feature-promotion
name: Feature Promotion
triggerType: manual
applicableProjectTypes: [application, platform, service, orchestration-platform]
roleSequence: [integrator]
stepSets:
  - name: promotion
    roles: [integrator]
    gate:
      mode: all
    policy:
      maxActiveMs: 60000
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
  - promotion-sources-collected
  - target-branch-compared
  - validation-result-recorded
  - promotion-outcome-recorded
```

Important rule:

- this workflow is only for the explicit promotion lane,
- do not rewrite every domain workflow to include `integrator`.

## 5. Optional additive execution payload fields for clients

If client heuristics become too heavy, add optional derived fields instead of forcing Web and TUI to infer promotion state from raw events.

Reasonable additive fields could include:

- `topology.projectLaneType = coordinator | lead | integrator | worker-branch`
- `promotion.status`
- `promotion.targetBranch`
- `promotion.integrationBranch`
- `promotion.sourceCount`
- `promotion.validationStatus`
- `promotion.blockerReason`
- `promotion.mergeCommit`

## Recommended Planner And Invocation Approach

## Keep existing workflow planning intact

Do not repurpose the current domain workflow planner into an implicit promotion-aware mega-planner.

Current direct path should remain:

- workflow-level planner for one execution,
- lead-first child workflows unchanged,
- reviewed work can still stop at review or approval when promotion is not requested.

## Add a dedicated promotion path

Recommended new planner surface:

- `planFeaturePromotion()`

Recommended new invocation surface:

- `invokeFeaturePromotion()`

Recommended new CLI commands:

- `promotion-plan`
- `promotion-invoke`

Recommended new HTTP routes:

- `POST /promotions/plan`
- `POST /promotions/invoke`

Optional convenience alias if the implementation prefers execution-family entrypoints:

- `POST /executions/:id/promote`

## Recommended Planning Algorithm

For `promotion-plan` or `promotion-invoke`, use this sequence.

### Step 1: load the root execution family

- read the selected root execution or promotion scope,
- verify that it belongs to a coordinator-root family when using the coordinator model,
- resolve the project config,
- infer `featureId` from input or fall back to the root execution id.

### Step 2: validate promotion preconditions

- inspect child lead execution states,
- confirm required review and approval decisions are settled,
- confirm there are no open project-level blockers that should stop promotion,
- discover the candidate source artifacts.

### Step 3: resolve project promotion policy

- resolve `integratorProfile`,
- merge project promotion policy sources,
- resolve the promotion workflow path from `promotionPolicy.workflow` or default to `feature-promotion`,
- determine target branch and validation requirements.

### Step 4: plan the integrator child execution

- role list: `['integrator']`
- `parentExecutionId = <root execution id>`
- `coordinationGroupId = <root execution id>`
- `branchKey = promotion:<featureId>`
- project-scoped profile resolution from `integratorProfile`

Recommended child invocation id pattern:

- `<root execution id>-promotion`

### Step 5: return a promotion-level plan payload

Recommended plan payload should contain:

- root execution summary,
- selected project metadata,
- selected source artifacts,
- integrator invocation,
- effective promotion policy,
- validation targets,
- initial promotion-readiness classification.

## Important Planner Details Not To Miss

### Profile resolution gap

Current planner resolves domain role keys only.

Recommended improvement:

- add a separate project-scoped role mapping path for `coordinator` and `integrator`,
- keep domain role keys unchanged for `lead/scout/builder/tester/reviewer`.

### Governance gap

Current governance defaults are reviewer-oriented.

Current risk:

- if the project wants human approval before a merge-to-target, the system cannot safely fake that as a normal reviewer step.

Recommended default:

- treat `requireHumanApprovalToLand` as promotion policy, not as a disguised reviewer lane in the first pass.

### Source artifact gap

If the next agent forgets to define what the integrator can merge from, promotion will become unreliable quickly.

Recommended rule:

- fail early when required promotion sources are missing.

### Docs query gap

Promotion docs queries should include more than role and project type.

Recommended improvement:

- include project id,
- include project name,
- include target branch,
- include `promotion` or `integration` query terms,
- include `featureId` when available.

## Recommended Execution-Engine Approach

## Integrator child creation

Recommended sequence for `promotion-invoke`:

1. build promotion plan,
2. create the integrator child execution under the selected coordinator root,
3. hold or mark the root family as waiting for promotion while the child is active,
4. drive the child execution with explicit promotion metadata,
5. reconcile the parent family when the child settles.

## Integration workspace creation

Recommended approach:

- provision one dedicated integration workspace using existing workspace manager primitives,
- attach `integrationBranch` metadata to that workspace allocation,
- keep the canonical root read-mostly,
- do not reuse a random lead workspace as the family integration surface.

Recommended branch shape:

- `spore/<projectId>/promotion/<promotionExecutionId>`

## Source application strategy

The implementation can vary, but the contract should stay explicit.

Reasonable first-pass source application strategies could include:

- merge source branches into the integration branch,
- cherry-pick known commits,
- apply proposal patches in a deterministic order.

Important rule:

- whichever strategy is used, it must be durable, inspectable, and attributable to concrete source artifacts.

## Root-family behavior

When the integrator child exists:

- the coordinator root should remain held or waiting,
- the family should not pretend the feature is finished until the promotion lane settles,
- a blocked integrator should keep the family in a recoverable state rather than silently failing unrelated child lanes.

Recommended root hold reason:

- `waiting_for_feature_promotion`

## Validation strategy recommendation

Promotion validation should be explicit and durable.

Recommended first-pass behavior:

- trigger named scenario or regression bundles from the integrator lane,
- persist summary status and evidence links on the integrator execution,
- treat failed validation as a promotion blocker,
- avoid inventing a second hidden tester lane unless the architecture deliberately chooses that later.

## Merge-to-target recommendation

Recommended default behavior:

- do not auto-merge to `main` in the first pass,
- produce a `promotion_candidate` plus validation and conflict summary,
- require explicit project policy and optional human approval for final landing.

If the implementation does support direct merge in MVP, require all of the following:

- `autoMergeToTarget = true`,
- validation success,
- no unresolved promotion blocker,
- no policy requirement for additional human approval,
- no destructive git behavior such as force-push.

## API, CLI, Web, And TUI Impact

## CLI

Recommended CLI additions in `packages/orchestrator/src/cli/spore-orchestrator.js`:

- `promotion-plan --execution <root-execution-id> [--feature-id ...] [--target-branch main]`
- `promotion-invoke --execution <root-execution-id> [--feature-id ...] [--target-branch main] [--wait]`

Recommended compatibility rule:

- existing `plan` and `invoke` keep current behavior,
- existing `project-plan` and `project-invoke` keep coordinator-root behavior,
- promotion commands handle integrator child execution creation.

## HTTP API

Recommended server additions in `services/orchestrator/server.js`:

- `POST /promotions/plan`
- `POST /promotions/invoke`

Recommended request fields:

- `executionId`
- `featureId`
- `targetBranch`
- `wait`
- `timeout`
- `interval`
- `launcher`
- `stub`

## Web UI

Web impact should be additive.

Recommended expectations for `apps/web/public/app.js`:

- show when a child execution is a promotion or integrator lane,
- render `promotion.status` clearly,
- show target branch and integration branch,
- show conflict summary and validation summary,
- preserve existing family rendering for lead-only families.

Useful display affordances:

- badge: `promotion`
- badge: `integrator`
- badge: `promotion candidate`
- badge: `merge blocked`
- badge: `merged`

## TUI

Recommended expectations for `packages/tui/`:

- family view should distinguish lead lanes from the integrator lane,
- execution detail should show promotion inputs, blockers, and validations,
- legacy family views must continue working for non-promotion trees.

## Session and live inspection

Integrator sessions should remain inspectable through the same session and live routes.

Recommended session metadata pattern:

- project populated,
- domain empty or `shared`,
- role profile = `integrator`,
- execution id = promotion child execution id,
- workspace linkage points to the integration workspace when one exists.

## Self-Build And Managed Work Impact

This area is easy to overlook and can re-break the model later if ignored.

## Immediate risks to address

- approved proposals are not yet the same thing as promotion-ready work,
- proposal lifecycle currently stops short of explicit promotion execution,
- integration branch metadata already exists but is not yet used as a first-class promotion contract,
- cleanup rules could remove the integration workspace too early if promotion is blocked or waiting.

Relevant code:

- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/work-items/work-items.js`
- `packages/orchestrator/src/execution/workflow-execution.js`
- `packages/workspace-manager/src/manager.js`

## Recommended self-build strategy

For managed work and proposal-backed flows:

- treat approval as a prerequisite for promotion, not as the promotion itself,
- add explicit promotion metadata to work-item or execution-family context when needed,
- preserve the proposal-to-workspace-to-branch linkage that the integrator needs,
- do not clean a promotion-blocked workspace until recovery is complete.

## Workspace cleanup guardrail

Recommended rule:

- if a workspace is attached to a pending `promotion_candidate` or blocked promotion attempt, cleanup should require explicit operator action.

## Migration And Compatibility Strategy

Use a staged rollout.

## Stage 1: add docs and config contracts without changing behavior

- add profile and prompt,
- add project schema fields,
- add promotion workflow template,
- add docs and plan updates,
- keep all old workflow and coordinator commands unchanged.

## Stage 2: add explicit promotion planning

- add the promotion planner and invoker,
- add new CLI and HTTP entrypoints,
- keep lead-first child workflows unchanged.

## Stage 3: add integrator execution behavior

- create the integrator child execution,
- hold the coordinator root while promotion is active,
- persist promotion outcome metadata,
- add escalation routing for promotion blockers.

## Stage 4: add integration workspace and validation behavior

- provision dedicated promotion workspaces,
- record integration branch metadata,
- run validation bundles,
- keep promotion evidence durable.

## Stage 5: update operator surfaces and self-build

- Web and TUI promotion rendering,
- self-build and proposal lifecycle adjustments,
- workspace cleanup guardrails.

## Stage 6: selectively adopt merge-to-target behavior

- keep `promotion_candidate` as the baseline,
- enable direct merge only where project policy explicitly allows it,
- validate protected-branch safety before broader rollout.

## What Not To Migrate Immediately

- do not prepend `integrator` to existing domain workflow role lists,
- do not remove current review and approval stops,
- do not turn coordinator into the merge actor,
- do not introduce a background auto-merge queue in the first pass,
- do not use a shared family worktree as the default workspace boundary.

## Detailed Workstreams And File Map

## Workstream A: docs and architecture guidance

Update:

- `docs/architecture/role-model.md`
- `docs/architecture/workflow-model.md`
- `docs/architecture/config-model.md`
- `docs/architecture/clients-and-surfaces.md`
- `docs/specs/worktree-and-workspace-isolation.md`
- `README.md`

Add:

- this plan document,
- a future ADR once the architecture decision is accepted.

Main message to encode:

- coordinator remains the project routing layer,
- integrator becomes the explicit promotion lane,
- lead remains the domain delivery and rework layer.

## Workstream B: config and schema

Add or update:

- `config/profiles/integrator.yaml`
- `.pi/prompts/integrator.md`
- `config/workflows/feature-promotion.yaml`
- `config/projects/spore.yaml`
- `config/projects/example-project.yaml`
- `schemas/project/project.schema.json`

Optional only if the implementation truly needs them:

- `schemas/workflow/workflow.schema.json`
- `schemas/policy-pack/policy-pack.schema.json`

## Workstream C: planner and invocation

Add or update:

- `packages/orchestrator/src/invocation/plan-workflow-invocation.js`
- new promotion planner module if preferred,
- `packages/orchestrator/src/cli/spore-orchestrator.js`
- `services/orchestrator/server.js`

Key implementation points:

- project-scoped integrator profile resolution,
- explicit promotion plan and invoke path,
- promotion precondition checks,
- no silent change to old workflow or coordinator plan and invoke behavior.

## Workstream D: execution, lifecycle, and git integration

Update:

- `packages/orchestrator/src/execution/workflow-execution.js`
- `packages/orchestrator/src/lifecycle/execution-lifecycle.js`
- `packages/orchestrator/src/store/execution-store.js`
- `packages/workspace-manager/src/manager.js`

Key implementation points:

- integrator child execution creation,
- integration workspace allocation,
- promotion outcome persistence,
- coordinator-targeted escalation routing for promotion blockers,
- root hold and resume semantics.

## Workstream E: managed work and proposal lifecycle

Update:

- `packages/orchestrator/src/self-build/self-build.js`
- `packages/orchestrator/src/work-items/work-items.js`

Key implementation points:

- approved proposal is not yet merged,
- promotion candidate support,
- workspace retention while promotion is pending or blocked,
- durable linkage from promotion outcome back to source proposal artifacts.

## Workstream F: operator surfaces

Update:

- `apps/web/public/app.js`
- `packages/tui/src/cli/spore-ops.js`
- `packages/orchestrator/README.md`
- `services/orchestrator/README.md`
- `docs/runbooks/local-dev.md`

Key implementation points:

- promotion lane identification,
- target branch and integration branch rendering,
- promotion blocker summaries,
- backward compatibility for old family trees.

## Test Plan

## Unit and planner tests

Add or update tests around:

- project-scoped integrator profile resolution,
- promotion precondition classification,
- promotion plan payload shape,
- source artifact selection,
- backward compatibility of direct `planWorkflowInvocation()`.

Likely files:

- new `packages/orchestrator/test/feature-integrator-plan.test.js`
- existing planner tests under `packages/orchestrator/test/`

## Family behavior tests

Add or update tests around:

- coordinator root enters held state while promotion is active,
- integrator child lineage is correct,
- root resumes or settles when promotion settles,
- promotion blockers target coordinator when appropriate,
- lead-local review and retry behavior remains unchanged.

Likely files:

- `packages/orchestrator/test/family-coordination.test.js`
- new `packages/orchestrator/test/feature-integrator-family.test.js`

## Workspace and git behavior tests

Add or update tests around:

- integration workspace creation,
- integration branch naming,
- target branch freshness checks,
- safe mechanical conflict resolution,
- ambiguous conflict escalation,
- blocked promotion workspace retention.

Likely files:

- `packages/workspace-manager/test/workspace-manager.test.js`
- new orchestrator promotion execution tests if needed.

## HTTP tests

Add or update tests around:

- `POST /promotions/plan`
- `POST /promotions/invoke`
- promotion detail payload on execution reads,
- backward compatibility of existing workflow and project routes.

Likely files:

- new `services/orchestrator/test/http-feature-promotion.test.js`
- existing lineage and policy tests under `services/orchestrator/test/`

## TUI and Web tests

Add or update tests around:

- promotion lane rendering,
- promotion status badges,
- target branch and blocker summary rendering,
- old lineage views still working.

Likely files:

- `packages/tui/test/tui-parity.test.js`
- existing web tests under `apps/web/test/`

## Self-build tests

Add or update tests around:

- approved proposals can enter a promotion path,
- promotion candidate state is durable,
- blocked promotion workspaces are not cleaned automatically,
- proposal-to-promotion lineage is inspectable.

Likely files:

- `services/orchestrator/test/http-self-build.test.js`
- relevant orchestrator work-item tests if added.

## Validation Checklist

The next agent should not claim success until all of these are checked.

### Backward compatibility

- existing direct domain plan still works,
- existing direct domain invoke still works,
- existing lead-first scenarios still pass,
- existing coordinator-root project flows still work when promotion is not used.

### New promotion path

- a coordinator-root family can be promoted through an integrator child execution,
- promotion preconditions are checked before mutation starts,
- source artifact selection is explicit and inspectable,
- promotion output is durable and visible.

### Conflict handling

- clearly mechanical conflicts can be resolved when policy allows it,
- ambiguous or semantic conflicts escalate instead of being auto-resolved,
- escalation payload explains which lane or domain needs repair.

### Governance behavior

- lead child review and approval still apply to the correct child execution,
- promotion does not bypass required approvals,
- merge-to-target only happens when project policy explicitly allows it.

### Workspace behavior

- integrator gets a dedicated integration workspace,
- coordinator still has no default workspace,
- blocked or promotion-candidate workspaces are not cleaned automatically,
- canonical root is not mutated directly by promotion logic.

### Validation behavior

- required validation bundles run or are recorded as skipped with reason,
- failed validation blocks promotion,
- promotion status surfaces validation outcome clearly.

### Multi-project behavior

- two different project families can promote independently,
- promotion statuses do not mix across coordination groups or project ids.

### Managed work behavior

- approved proposals are not mistaken for merged work,
- proposal-to-promotion linkage is visible,
- self-build surfaces show approved-but-not-promoted work separately.

## Recommended Verification Commands

Before finalizing, prefer a verification loop along these lines.

Existing checks that must still pass:

```bash
npm run docs-kb:index
npm run config:validate
npm run orchestrator:project-plan -- --project config/projects/example-project.yaml --domains backend,frontend
npm run orchestrator:project-invoke -- --project config/projects/example-project.yaml --domains backend,frontend --objective "Coordinate backend and frontend work for one project." --wait --stub
npm run test:http
npm run test:tui
```

New target checks to add:

```bash
npm run orchestrator:promotion-plan -- --execution <coordinator-root-execution-id> --target-branch main
npm run orchestrator:promotion-invoke -- --execution <coordinator-root-execution-id> --target-branch main --wait --stub
```

If the implementation adds a named scenario for promotion validation, include it in the smoke loop too.

## Open Questions With Recommended Defaults

These are the main places where the next agent could get blocked. The recommended defaults are chosen to keep the implementation moving safely.

### 1. Should the first pass auto-merge to `main`?

Recommended default:

- no,
- produce a `promotion_candidate` by default,
- require explicit project policy before landing automatically.

### 2. Should integrator be a permanent project daemon?

Recommended default:

- no,
- use one persistent session only for the duration of one promotion attempt.

### 3. Should integrator resolve conflicts automatically?

Recommended default:

- only clearly mechanical conflicts,
- anything ambiguous should escalate.

### 4. Should integrator live inside every domain workflow template?

Recommended default:

- no,
- add one dedicated promotion workflow only.

### 5. Should domain configs gain `integratorProfile` too?

Recommended default:

- no,
- integrator is project-scoped, not domain-scoped.

### 6. Should the first pass require a brand-new promotion store?

Recommended default:

- no,
- persist promotion summary on the integrator execution first,
- add a dedicated store only if operator use cases prove it necessary.

### 7. Should promotion failure reopen child reviewer gates automatically?

Recommended default:

- no,
- open a coordinator-level blocker and send repair work back through lead-owned paths.

### 8. Should the first pass use a shared family worktree?

Recommended default:

- no,
- use one dedicated integration workspace for the integrator lane only.

## Main Failure Modes To Avoid

These are the most likely ways to break the system.

- prepending `integrator` to existing `defaultRoles` and accidentally launching only `integrator`,
- adding `integrator` as a domain role instead of a project role,
- auto-merging to `main` simply because child reviewers approved,
- trying to promote from chat summaries instead of durable artifacts,
- resolving semantic conflicts automatically,
- mutating the canonical project root directly,
- cleaning a blocked promotion workspace too early,
- routing every promotion blocker back to `lead` and bypassing the coordinator,
- treating `promotion_candidate` as equivalent to `merged`.

## Suggested Implementation Order

If one agent is doing the whole slice, this order is safest.

### Phase 1: lock docs and config contracts

- add integrator profile and prompt,
- add project schema fields,
- add promotion workflow template,
- update docs and runbooks.

### Phase 2: add explicit promotion planning

- add the promotion planner,
- add CLI and HTTP entrypoints,
- keep old workflow and project paths unchanged.

### Phase 3: add child execution and promotion state behavior

- create the integrator child execution,
- add hold and settle semantics,
- persist promotion summaries.

### Phase 4: add integration workspace and git operations

- provision the workspace,
- apply sources to the integration branch,
- classify and resolve safe conflicts,
- record blockers and escalation details.

### Phase 5: add validation and surface updates

- trigger validation bundles,
- render promotion state in Web and TUI,
- keep legacy rendering intact.

### Phase 6: update managed work and only then widen adoption

- teach self-build and proposal lifecycle about promotion,
- add cleanup guardrails,
- only then consider enabling direct merge on selected projects.

## Non-Goals For The First Pass

- no background merge queue,
- no global auto-merge to protected branches,
- no semantic conflict auto-resolution,
- no rewrite of every domain workflow template,
- no shared family worktree,
- no destructive git recovery such as force-push or hard reset,
- no replacement of current lead-local review loops.

## Done Means

This change is in a safe state when all of the following are true:

- direct lead-first domain workflows still run as before,
- coordinator-root project execution still works as before,
- one project family can spawn an integrator child execution explicitly,
- the integrator can classify readiness from durable child outputs,
- promotion status is durable and operator-visible,
- semantic blockers route back to the coordinator and then to the right leads,
- integration happens in a dedicated workspace instead of the canonical root,
- self-build and proposal surfaces no longer imply that approval means merge,
- Web, TUI, CLI, and HTTP surfaces make the promotion boundary understandable.

## Paste-Ready Brief For The Next Agent

Implement a new project-scoped `integrator` role as the explicit post-review promotion lane for one feature-sized change inside a coordinator-root execution family. Do not add it by prepending `integrator` to existing domain workflow role lists. Keep current lead-first child workflows unchanged. Add `config/profiles/integrator.yaml`, `.pi/prompts/integrator.md`, a dedicated workflow such as `config/workflows/feature-promotion.yaml`, and project-level config and schema support for `integratorProfile` plus a `promotionPolicy` block. Add explicit promotion planner and invoker entrypoints instead of silently changing existing workflow or project invocation behavior. Represent the integrator as a child execution under the coordinator root by reusing `coordinationGroupId`, `parentExecutionId`, and `branchKey`. The integrator should only promote from durable artifacts such as proposal-backed branches or equivalent mergeable outputs. It may resolve clearly mechanical conflicts when policy allows it, but it must escalate semantic or ambiguous conflicts back to the coordinator so the relevant leads can repair them. Use a dedicated integration workspace and branch, not the canonical root and not a shared family worktree. Persist additive promotion summary data on the integrator execution so operators and clients can see target branch, source count, validation outcome, blocker reason, and whether the result is `promotion_candidate`, `merged`, or `blocked`. Keep `promotion_candidate` as the safe default outcome and allow direct merge to `main` only when project policy explicitly opts in.
