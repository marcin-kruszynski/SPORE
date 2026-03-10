# AGENTS.md

## Mission

SPORE (Swarm Protocol for Orchestration, Rituals & Execution) is a modular, profile-driven, documentation-first orchestration platform for governed multi-agent software delivery and supervised self-build.

## Current Phase

- Current scope is bootstrap-plus-executable-foundation.
- In scope: repo structure, docs, config skeletons, docs search, session lifecycle, operator surfaces, PI-first runtime planning, and the first orchestrator-facing workflow slice.
- Do not build a production orchestrator runtime, production web UI, or a full execution engine in this phase.

## Primary Sources Of Truth

1. `docs/INDEX.md`
2. `docs/index/DOCS_INDEX.md`
3. `docs/index/docs_manifest.yaml`
4. `docs/decisions/`

## Current Ground Truth Docs

- Current project state: `docs/plans/project-state-and-direction-handoff.md`
- Tactical next work: `docs/plans/self-build-status-and-next-steps.md`
- Current roadmap: `docs/plans/roadmap.md`
- Historical bootstrap docs under `docs/roadmap/` and older bootstrap plans are context only, not the current implementation plan.

## Repo Shape

- `apps/web/`: browser UI and proxy server.
- `apps/cli/`: reserved scaffold for a future dedicated CLI app shell.
- `packages/`: first-party libraries and CLIs.
- `services/orchestrator/`: orchestrator HTTP surface.
- `services/session-gateway/`: session HTTP surface.
- `config/`: profiles, workflows, projects, domains, policy packs, scenarios, and regressions.
- `docs/`: canonical architecture, runbooks, decisions, specs, and plans.
- `references/`: read-only inspiration; adapt concepts, do not copy code.

## Authority Boundaries

- `packages/runtime-pi/` is the PI integration boundary.
- `packages/session-manager/` is the session state boundary.
- `packages/workspace-manager/` is the workspace/worktree boundary.
- `packages/orchestrator/` and `services/orchestrator/` own workflow planning and invocation.
- `services/session-gateway/` is the shared session HTTP surface.
- The orchestrator execution store is the source of truth for workflow state; do not infer state from transcripts or raw SQLite when HTTP or CLI surfaces already exist.

## TypeScript-First Rules

- First-party source lives in `.ts` and `.tsx` under `apps/`, `packages/`, and `services/`.
- Do not add new hand-authored first-party `.js` files there.
- `apps/web/public/*.js` is generated output from `npm run web:build`.
- `*.tsbuildinfo` is generated local compiler state, not source.
- Cross-package imports should prefer `@spore/*` aliases.

## Environment Baseline

- Required tools: `node >= 24`, `npm`, `tmux`, `pi`, `jq`, `sqlite3`, `python3`, `git`, `rg`.
- If `pi` is installed but missing from `PATH`, set `export SPORE_PI_BIN="${SPORE_PI_BIN:-$(npm prefix -g)/bin/pi}"`.
- Prefer isolated state for local runs with `SPORE_ORCHESTRATOR_DB_PATH`, `SPORE_SESSION_DB_PATH`, and `SPORE_EVENT_LOG_PATH`.

## Core Commands

- Install deps: `npm install`
- Typecheck all workspaces: `npm run typecheck`
- Lint repo: `npm run lint`
- Format repo: `npm run format`
- Check formatting only: `npm run format:check`
- Build browser bundle: `npm run web:build`
- Index docs KB: `npm run docs-kb:index`
- Check docs KB status: `npm run docs-kb:status`
- Rebuild docs KB: `npm run docs-kb:rebuild`
- Validate config: `npm run config:validate`

## Dev Servers And CLIs

- Session gateway: `npm run gateway:start`
- Orchestrator service: `npm run orchestrator:start`
- Web app: `npm run web:start`
- Package-level CLIs are the current command-line surface; do not assume `apps/cli/` is implemented.
- Session status: `npm run session:status`
- Session event feed: `npm run session:feed`
- Workspace list: `npm run workspace:list`
- Orchestrator plan: `npm run orchestrator:plan -- --domain backend --roles lead`
- Orchestrator invoke: `npm run orchestrator:invoke -- --domain backend --roles lead,reviewer --objective "..." --wait`

## Test Commands

- Policy tests: `npm run test:policy`
- HTTP/service tests: `npm run test:http`
- Web tests: `npm run test:web`
- Web proxy subset: `npm run test:web-proxy`
- TUI tests: `npm run test:tui`
- Workspace tests: `npm run test:workspace`
- Local non-E2E suite: `npm run test:all-local`
- PI E2E suite: `npm run test:e2e:pi`
- Gateway PI control E2E: `npm run test:e2e:gateway-control`

## Running One Test

- Root npm test scripts are curated lists; they do not forward file paths.
- Single file: `node --import=tsx --test path/to/file.test.ts`
- Single named test: `node --import=tsx --test --test-name-pattern="partial test name" path/to/file.test.ts`
- HTTP suites that boot real services should usually keep `--test-concurrency=1`.
- Service example: `node --import=tsx --test services/orchestrator/test/http-policy.test.ts`
- Web example: `node --import=tsx --test apps/web/test/self-build-dashboard.test.ts`
- Runtime example: `node --import=tsx --test packages/runtime-pi/test/workspace-launch-context.test.ts`

## Recommended Verification Loops

- Docs/config changes: `npm run docs-kb:index && npm run config:validate`
- TypeScript/library changes: `npm run typecheck && npm run test:all-local`
- Web changes: `npm run web:build && npm run test:web`
- Orchestrator/session changes: run `npm run test:http`, `npm run test:tui`, and the relevant runtime or session commands.
- Real PI smoke is opt-in: `SPORE_RUN_PI_E2E=1 npm run test:e2e:pi`
- If PI is unavailable, say that explicitly and note when stub mode was used.

## Import And Module Style

- Use ESM everywhere with NodeNext conventions.
- Include explicit `.js` extensions in relative TypeScript imports.
- Order imports as Node built-ins, external or `@spore/*` packages, then relative imports.
- Use `import type` for type-only imports when possible.
- Re-export public package surfaces through `src/index.ts`.

## Formatting Style

- Formatting is Biome-driven via `biome.json`.
- Use spaces for indentation.
- Use double quotes, semicolons, and trailing commas.
- Prefer small helpers and wrapped multiline argument lists over dense one-line calls.
- Keep Markdown and JSON formatted with the repo formatter instead of ad hoc styles.

## Types And Naming

- Even though `strict` is currently `false`, write new code with precise types.
- Prefer `interface` and `type` aliases for shared payloads and contracts.
- Prefer `unknown` or `Record<string, unknown>` over `any` unless the module is intentionally handling heterogeneous payloads.
- If `any` is necessary, keep it local and document the reason with a targeted `biome-ignore` comment, matching existing patterns.
- Use `PascalCase` for types and interfaces, `camelCase` for values and functions, and `UPPER_SNAKE_CASE` for module-level constants.
- Common suffixes: `*Options`, `*Record`, `*Summary`, `*Detail`, `*Payload`, and `*Result`.
- Use kebab-case filenames, including tests such as `http-policy.test.ts`.
- CLI entrypoints are usually `spore-*.ts`; implementation-heavy split modules often use `*.impl.ts`.
- Shared contracts commonly live in `types.ts`, `contracts.ts`, or package `index.ts`.
- Prefer descriptive names tied to the domain language: execution, proposal, work item, workspace, session, policy, scenario, regression.

## Error Handling Conventions

- Throw `Error` with actionable messages when inputs are invalid or required state is missing.
- Do not swallow errors silently; only ignore failures intentionally, with a short comment when the reason is non-obvious.
- In CLIs and servers, prefer `main().catch(...)` plus `process.exitCode = 1` instead of `process.exit(1)`.
- HTTP handlers should return structured JSON envelopes such as `{ ok: false, error, message }`.
- Validate request bodies and size limits before deeper processing.

## Testing Style

- Use `node:test` and `node:assert/strict`.
- Prefer integration-style tests around real CLI and HTTP boundaries.
- Reuse `@spore/test-support` instead of copying harness helpers across packages.
- Use `makeTempPaths(...)` and the `SPORE_*_DB_PATH` env vars for isolated test state.
- Clean up child processes with `t.after(...)` and `stopProcess(...)`.

## Docs And Config Hygiene

- Update docs with every material change.
- Add or update an ADR in `docs/decisions/` for architecture boundary changes.
- Keep docs indexes synchronized when adding or moving docs.
- Keep research in `docs/research/` and decisions in `docs/decisions/`.
- Keep profiles in `config/profiles/` and `workspace/agent-profiles/`.
- Keep workflows in `config/workflows/` and `workspace/workflow-profiles/`.
- Keep projects in `config/projects/` and `workspace/projects/`.
- Keep reusable policy presets in `config/policy-packs/`.

## Runtime And Operator Rules

- Prefer real PI validation when available; use stub mode only when isolating launcher behavior or when PI is unavailable.
- Use tmux-backed sessions for inspectable live runs.
- Reconcile detached sessions with `npm run session:reconcile` rather than manual database edits.
- Prefer `GET /sessions/:id/live` and orchestrator read surfaces over ad hoc file readers in new clients.
- Treat `waiting_review` and `waiting_approval` as governance states, not runtime failures.
- Workspace cleanup is governance-aware; do not remove review-pending or proposal-backed workspaces casually.

## Rule Files

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` files exist in this repository today.
- If any of those files are added later, merge their instructions into this document and treat them as agent-facing rules.
