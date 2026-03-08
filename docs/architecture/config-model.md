# Config Model

SPORE configuration is declarative and split by concern.

## Config Domains

- `config/system/` defaults, runtime, observability, permissions
- `config/profiles/` role-level defaults
- `config/teams/` domain team composition
- `config/workflows/` workflow templates
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

- `workflowPolicy`: `defaultRoles`, `defaultMaxAttempts`, `maxAttemptsByRole`, `stepSoftTimeoutMs`, `stepHardTimeoutMs`, `reviewRequired`, `approvalRequired`
- `runtimePolicy`: `sessionModeByRole`
- `docsKbPolicy`: `resultLimit`, `queryTerms`, optional `queryTemplate`

Current merge rules are:

- project `activeDomains[]` overrides the matching `config/domains/<id>.yaml` entry,
- `workflowPolicy.maxAttemptsByRole` merges by role key,
- `runtimePolicy.sessionModeByRole` merges by role key,
- `docsKbPolicy.queryTerms` is combined and deduplicated,
- explicit invocation roles still override `workflowPolicy.defaultRoles`.
