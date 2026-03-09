# Config Model

SPORE configuration is declarative and split by concern.

## Config Domains

- `config/system/` defaults, runtime, observability, permissions
- `config/profiles/` role-level defaults
- `config/teams/` domain team composition
- `config/workflows/` workflow templates
- `config/policy-packs/` reusable execution policy presets
- `config/projects/` project assembly
- `config/domains/` domain defaults, including domain workflow/runtime/docs-kb policy

## Profile Field Baseline

Profiles should expose:
- id, name, role, description, domain,
- runtime, systemPromptRef,
- skills, tools, permissions,
- sessionMode, reviewPolicy, handoffPolicy,
- docsPolicy, telemetryPolicy.

## Project-Level Assembly

Project config composes domains, teams, profile variants, workflow defaults, and docs/search/runtime policies.

`config/domains/*.yaml` now provides reusable per-domain policy defaults, and matching `activeDomains[]` entries in `config/projects/*.yaml` can override them for one project.

Current policy blocks are:

- `workflowPolicy`: `defaultRoles`, `defaultMaxAttempts`, `maxAttemptsByRole`, `stepSoftTimeoutMs`, `stepHardTimeoutMs`, `reviewRequired`, `approvalRequired`, `retryTargetRole`, `resetDescendantSteps`, `reworkStrategy`, `reworkRoles`
- `runtimePolicy`: `sessionModeByRole`, optional role-aware `workspace` defaults
- `docsKbPolicy`: `resultLimit`, `queryTerms`, optional `queryTemplate`

Workflow templates may also define:

- `stepSets`: ordered wave definitions, each with a `roles` array, optional `name`, and optional `gate`

Supported wave gate modes are:

- `all`
- `any`
- `min_success_count`

Those wave definitions are not merged from domain policy. They live in the workflow template and are translated by the planner into durable per-step `wave` / `waveName` metadata.

## Policy Packs

Policy packs are reusable presets stored in `config/policy-packs/`.

They let SPORE share baseline behavior across domains and projects without copying the same retry, governance, runtime, and retrieval blocks into every domain file.

Typical use:

- `service-core` for backend/service delivery
- `ui-core` for frontend/browser delivery
- `cli-core` for CLI-oriented flows
- `docs-core` for documentation and knowledge work

Project- or domain-specific packs can then layer narrower overrides on top, for example `platform-backend`.

Current merge rules are:

- policy packs listed in domain config and project domain overrides are merged before the raw domain override object,
- project `activeDomains[]` overrides the matching `config/domains/<id>.yaml` entry,
- `workflowPolicy.maxAttemptsByRole` merges by role key,
- `runtimePolicy.sessionModeByRole` merges by role key,
- `runtimePolicy.workspace` is merged as a normal object and may now enable role-scoped workspace allocation such as `enabledRoles: [builder, tester]`,
- `docsKbPolicy.queryTerms` is combined and deduplicated,
- explicit invocation roles still override `workflowPolicy.defaultRoles`.

Current canonical use of `runtimePolicy.workspace` is the snapshot-based builder/tester verification contract:

- builder gets an authoring workspace,
- builder publishes a git-backed handoff snapshot,
- tester gets a verification workspace created from that snapshot,
- reviewer remains read-only.

The effective precedence is:

1. policy packs
2. base domain config
3. project `activeDomains[]` override
4. explicit invocation arguments

Projects may now also define project-scoped orchestration roles and policies that sit outside domain config:

- `coordinatorProfile`
- `integratorProfile`
- `projectCoordinationPolicy`
- `promotionPolicy`

These are project-scoped fields, not domain-scoped fields.

`projectCoordinationPolicy` shapes the explicit project-root coordination path:

- coordinator-root workflow defaults,
- coordination hold/resume behavior,
- docs-kb defaults for project framing,
- role-aware runtime behavior for the coordinator lane.

`promotionPolicy` shapes the explicit feature-promotion path:

- target branch defaults,
- integration branch prefix,
- integrator workspace requirements,
- validation bundle expectations,
- whether mechanical conflict resolution is allowed,
- whether landing to the target branch requires extra approval.

Backward compatibility rule:

- do not add `coordinatorProfile` or `integratorProfile` to domain configs,
- do not treat them as replacements for lead/build/test/review profiles inside existing domain workflows.
