# Coding Conventions

**Analysis Date:** 2026-03-09

## Naming Patterns

**Files:**
- Use `kebab-case` for executable and library modules, for example `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `packages/config-schema/src/validate/load-schemas.js`, and `services/session-gateway/server.js`.
- Use `*.test.js` for standard tests, `*.e2e.test.js` for real runtime flows, and `*.pending.test.js` for probe-style readiness checks, as in `packages/runtime-pi/test/pi-rpc-smoke.test.js`, `services/session-gateway/test/real-pi-session-control.e2e.test.js`, and `packages/runtime-pi/test/pi-rpc-canonical-scenarios.pending.test.js`.
- Keep config filenames aligned with their IDs and use `kebab-case`, for example `config/workflows/frontend-ui-pass.yaml`, `config/domains/backend.yaml`, and `config/projects/example-project.yaml`.

**Functions:**
- Use `camelCase` verbs for helpers and exported APIs, such as `parseArgs`, `resolvePath`, `planWorkflowInvocation`, `waitForHealth`, and `createFamilyScenario` in `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `packages/session-manager/src/cli/session-manager.js`, and `services/orchestrator/test/helpers/http-harness.js`.
- Use predicate-style names for booleans and state checks, such as `isSettled` in `packages/session-manager/src/cli/session-manager.js` and `supportsRpcControl` in `services/session-gateway/server.js`.

**Variables:**
- Use `camelCase` for locals, parameters, and options objects, such as `sessionDbPath`, `coordinationGroupId`, `stepSoftTimeoutMs`, and `scenarioRunDetail` across `packages/orchestrator/src/cli/spore-orchestrator.js` and `services/orchestrator/test/http-scenarios.test.js`.
- Reserve `UPPER_SNAKE_CASE` for environment-derived constants and static configuration like `HOST`, `PORT`, `GATEWAY_ORIGIN`, and `ORCHESTRATOR_PORT` in `apps/web/server.js`, `services/orchestrator/test/http-policy.test.js`, and `services/orchestrator/test/http-lineage.test.js`.

**Types:**
- Not applicable for source authoring. The repository is plain ESM JavaScript; no TypeScript interfaces or classes are detected in runtime or test code.
- Structural contracts live in JSON Schema files such as `schemas/workflow/workflow.schema.json` and are applied by `packages/config-schema/src/cli/validate-config.js`.

## Code Style

**Formatting:**
- No Prettier, Biome, or equivalent formatter config is detected. Repository-wide formatting comes from `.editorconfig`.
- Use UTF-8, LF line endings, 2-space indentation, final newlines, and trimmed trailing whitespace per `.editorconfig`.
- Match the quote style already used in the file you edit because quotes are not enforced globally: `packages/orchestrator/src/cli/spore-orchestrator.js` uses double quotes while `packages/runtime-pi/src/cli/pi-runtime-doctor.js` and `packages/tui/src/cli/spore-ops.js` use single quotes.

**Linting:**
- No ESLint, Biome, Prettier, Jest, or Vitest config is detected at repo root or under packages.
- Treat executable correctness and test coverage as the active quality gate instead of lint-only rules; the root `package.json` exposes verification scripts, but no lint script.
- Use Node ESM conventions everywhere: package manifests in `package.json` and `apps/web/package.json` set `"type": "module"`, and imports include explicit `.js` extensions.

## Import Organization

**Order:**
1. Node built-ins first, for example `node:fs/promises`, `node:path`, `node:test`, and `node:assert/strict` in `packages/config-schema/src/cli/validate-config.js` and `packages/orchestrator/test/domain-policy.test.js`.
2. A blank line.
3. Relative project imports with explicit `.js` extensions, including cross-package imports such as `../../packages/orchestrator/src/...` in `services/orchestrator/server.js` and `../../../services/orchestrator/test/helpers/http-harness.js` in `packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.js`.

**Path Aliases:**
- Not detected. Use explicit relative paths.
- Cross-package reuse is direct and file-specific, for example `services/session-gateway/server.js` imports `../../packages/session-manager/src/...` rather than a package alias.

## Error Handling

**Patterns:**
- Use guard clauses with `throw new Error(...)` for invalid CLI usage or missing data, as in `packages/orchestrator/src/cli/spore-orchestrator.js`, `packages/tui/src/cli/spore-ops.js`, and `packages/session-manager/src/cli/session-manager.js`.
- Close owned resources with `try/finally`, especially SQLite handles, as in `services/session-gateway/server.js`, `packages/session-manager/src/cli/session-manager.js`, `packages/orchestrator/test/domain-policy.test.js`, and `packages/runtime-pi/test/domain-policy-runtime-context.test.js`.
- Normalize HTTP failures into JSON payloads using small response helpers like `json`, `badRequest`, `conflict`, and `notFound` in `services/session-gateway/server.js`. Service bodies are also size-limited in `readJsonBody` there and in `services/orchestrator/server.js`.
- Keep validation manual in service and CLI layers. Config validation is the only schema-driven path detected, implemented by `packages/config-schema/src/validate/load-schemas.js`, `packages/config-schema/src/validate/schema-validator.js`, and `packages/config-schema/src/cli/validate-config.js`.

## Logging

**Framework:** console / `process.stdout.write`

**Patterns:**
- Emit machine-readable JSON to stdout for CLI and service success paths, usually with `JSON.stringify(..., null, 2)`, as in `packages/orchestrator/src/cli/spore-orchestrator.js`, `packages/config-schema/src/cli/validate-config.js`, `packages/runtime-pi/src/cli/pi-runtime-doctor.js`, and `apps/web/server.js`.
- Emit short prefixed errors to stderr or JSON error payloads, for example `spore-config error: ...` in `packages/config-schema/src/cli/validate-config.js` and `spore-ops error: ...` in `packages/tui/src/cli/spore-ops.js`.
- No shared logging library is detected. Browser-side failures fall back to `console.error(...)` in `apps/web/public/app.js`.

## Comments

**When to Comment:**
- Keep comments sparse. The common pattern is to prefer descriptive helper names over explanatory comments, visible in `packages/orchestrator/src/invocation/plan-workflow-invocation.js` and `packages/config-schema/src/yaml/parse-yaml.js`.
- Add comments only for transient or non-obvious behavior. A representative example is `// service still booting` in `services/orchestrator/test/helpers/http-harness.js`.

**JSDoc/TSDoc:**
- Not detected in runtime code or tests under `packages/` or `services/`.

## Function Design

**Size:**
- Prefer small local helpers followed by a larger command or request dispatcher, as in `services/orchestrator/server.js`, `services/session-gateway/server.js`, and `packages/orchestrator/src/invocation/plan-workflow-invocation.js`.
- When editing large UI modules like `apps/web/public/app.js`, extend the existing helper-and-section organization instead of introducing a new architectural style inside the file.

**Parameters:**
- Prefer options objects with defaults for exported workflows and test harnesses, such as `planWorkflowInvocation({...})` in `packages/orchestrator/src/invocation/plan-workflow-invocation.js`, `runSelfBuildWorkItem(itemId, options = {}, dbPath = ...)` in `packages/orchestrator/src/self-build/self-build.js`, and `waitFor(fn, options = {})` in `packages/runtime-pi/test/helpers/e2e-harness.js`.
- CLI argument parsing is hand-rolled and repeated consistently through `parseArgs` helpers in `packages/orchestrator/src/cli/spore-orchestrator.js`, `packages/runtime-pi/src/cli/run-session-plan.js`, `packages/session-manager/src/cli/session-manager.js`, and `packages/config-schema/src/cli/validate-config.js`.

**Return Values:**
- Return plain objects and arrays that can be serialized directly to JSON. `packages/orchestrator/src/invocation/plan-workflow-invocation.js` returns an invocation payload that is passed straight through `packages/orchestrator/src/cli/spore-orchestrator.js` and `services/orchestrator/server.js`.
- Keep filesystem paths normalized back to workspace-relative strings before exposing them, following helpers like `normalizeRelativePath` in `packages/orchestrator/src/invocation/plan-workflow-invocation.js` and `toRelative` in `packages/config-schema/src/cli/validate-config.js`.

## Module Design

**Exports:**
- Use named exports. Representative modules include `packages/orchestrator/src/store/execution-store.js`, `packages/orchestrator/src/scenarios/run-history.js`, and `packages/runtime-pi/test/helpers/e2e-harness.js`.
- `export default` is not detected in the repository's `.js` source files.

**Barrel Files:**
- Not detected. Import from concrete module paths such as `../src/execution/workflow-execution.js` and `../../packages/session-manager/src/store/session-store.js`.

## Configuration Norms

**Config Layout:**
- Keep declarative machine config under `config/` and mirror each section to a schema under `schemas/`, as documented in `docs/architecture/config-model.md` and enforced by `packages/config-schema/src/validate/load-schemas.js`.
- Align config filenames and IDs, for example `config/domains/backend.yaml` -> `id: backend`, `config/workflows/frontend-ui-pass.yaml` -> `id: frontend-ui-pass`, and `config/profiles/lead.yaml` -> `id: lead`.

**Validation:**
- Validate config with `npm run config:validate` from the root `package.json` before relying on new YAML changes.
- New config directories are not auto-discovered by schema type; `packages/config-schema/src/validate/load-schemas.js` must know the directory-to-schema mapping first.

**YAML Authoring:**
- Stay within the subset handled by `packages/config-schema/src/yaml/parse-yaml.js`: indentation-based objects, lists, booleans, integers, `null`, quoted strings, and inline arrays.
- Do not assume advanced YAML features such as anchors, aliases, multiline scalars, or custom tags; there is no support for them in `packages/config-schema/src/yaml/parse-yaml.js`.

**Policy Merge Rules:**
- Put policy behavior in config and merge it through `packages/orchestrator/src/invocation/plan-workflow-invocation.js` instead of duplicating merge logic in services or tests.
- Follow the precedence described in `docs/architecture/config-model.md`: policy packs, base domain config, project `activeDomains[]`, then explicit invocation arguments.

---

*Convention analysis: 2026-03-09*
