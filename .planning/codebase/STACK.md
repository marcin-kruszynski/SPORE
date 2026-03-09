# Technology Stack

**Analysis Date:** 2026-03-09

## Languages

**Primary:**
- JavaScript (ESM, Node >= 24 baseline) - runtime code in `packages/`, `services/`, `apps/web/server.js`, and browser code in `apps/web/public/app.js`
- YAML - execution and policy config in `config/` and `workspace/`

**Secondary:**
- JSON and JSON Schema - machine config and validation contracts in `package.json`, `opencode.json`, and `schemas/*.json`
- HTML and CSS - browser operator surface in `apps/web/public/index.html` and `apps/web/public/styles.css`
- Markdown - product, architecture, runbook, and prompt content in `docs/`, `README.md`, `AGENTS.md`, and `.pi/prompts/`
- TypeScript - Not detected in tracked source; `**/*.ts` returned no matches during this scan

## Runtime

**Environment:**
- Node.js >= 24 - documented baseline in `README.md`, `AGENTS.md`, and `docs/runbooks/local-dev.md`
- ESM modules - enabled by `"type": "module"` in `package.json`, `apps/web/package.json`, `packages/runtime-pi/package.json`, `packages/session-manager/package.json`, `packages/config-schema/package.json`, `packages/docs-kb/package.json`, `packages/tui/package.json`, and `services/session-gateway/package.json`

**Package Manager:**
- `npm` - script runner defined in `package.json`
- Lockfile: missing; `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, and `bun.lockb` are not present at repository root

## Frameworks

**Core:**
- No third-party application framework detected - HTTP services use `node:http` directly in `services/session-gateway/server.js`, `services/orchestrator/server.js`, and `apps/web/server.js`
- No frontend framework detected - the browser surface is a vanilla SPA in `apps/web/public/index.html`, `apps/web/public/styles.css`, and `apps/web/public/app.js`

**Testing:**
- Node built-in test runner - invoked with `node --test` in root scripts in `package.json`

**Build/Dev:**
- No transpiler or bundler detected - there is no `tsconfig.json`, `vite.config.*`, `webpack` config, or other build config in the repository root
- Custom CLI tooling drives development flows:
  - `packages/docs-kb/src/cli/docs-kb.js` - docs indexing and search
  - `packages/config-schema/src/cli/validate-config.js` - YAML and schema validation
  - `packages/session-manager/src/cli/session-manager.js` - session lifecycle operations
  - `packages/runtime-pi/src/cli/pi-session-plan.js`, `packages/runtime-pi/src/cli/run-session-plan.js`, `packages/runtime-pi/src/cli/pi-runtime-doctor.js` - runtime planning, execution, and diagnostics
  - `packages/orchestrator/src/cli/spore-orchestrator.js` - orchestration and self-build commands
  - `packages/tui/src/cli/spore-ops.js` - terminal operator surface

## Key Dependencies

**Critical:**
- Node built-in modules (`node:http`, `node:sqlite`, `node:child_process`, `node:fs/promises`, `node:stream`) - core runtime primitives across `services/` and `packages/`; `README.md` describes the repository as running with zero external npm dependencies
- `@mariozechner/pi-coding-agent` CLI (`pi`) - primary real agent runtime for `packages/runtime-pi/`; referenced in `README.md`, `docs/runbooks/local-dev.md`, and resolved in `packages/runtime-pi/src/launchers/resolve-binary.js`
- `tmux` - durable session backing and pane capture via `packages/runtime-pi/src/launchers/tmux-launcher.js` and `packages/tui/src/cli/spore-ops.js`

**Infrastructure:**
- SQLite via `node:sqlite` - local persistence for docs index, session state, and orchestrator state in `packages/docs-kb/src/store/sqlite-store.js`, `packages/session-manager/src/store/session-store.js`, and `packages/orchestrator/src/store/execution-store.js`
- Custom YAML parser and schema validator - implemented in `packages/config-schema/src/yaml/parse-yaml.js` and `packages/config-schema/src/validate/schema-validator.js`
- OpenCode agent config - `opencode.json` maps GSD agent roles to `openai/gpt-5.4`; this is repository tooling, not the SPORE runtime adapter
- Declared npm package dependencies: Not detected; the root `package.json` and child `package.json` files do not define `dependencies` or `devDependencies`

## Configuration

**Environment:**
- Runtime behavior is driven by YAML in `config/system/`, `config/profiles/`, `config/domains/`, `config/policy-packs/`, `config/workflows/`, `config/projects/`, `config/scenarios/`, `config/regressions/`, and `config/work-item-templates/`
- Workspace variants and seeded profiles live in `workspace/`
- Environment variables are consumed directly in source:
  - state paths: `SPORE_SESSION_DB_PATH`, `SPORE_EVENT_LOG_PATH`, `SPORE_ORCHESTRATOR_DB_PATH` in `packages/session-manager/src/metadata/constants.js` and `packages/orchestrator/src/metadata/constants.js`
  - runtime binary resolution: `SPORE_PI_BIN` and optional `NVM_DIR` in `packages/runtime-pi/src/launchers/resolve-binary.js`
  - service binding and routing: `SPORE_GATEWAY_HOST`, `SPORE_GATEWAY_PORT`, `SPORE_ORCHESTRATOR_HOST`, `SPORE_ORCHESTRATOR_PORT`, `SPORE_WEB_HOST`, `SPORE_WEB_PORT`, `SPORE_GATEWAY_ORIGIN`, and `SPORE_ORCHESTRATOR_ORIGIN` in `services/session-gateway/server.js`, `services/orchestrator/server.js`, `apps/web/server.js`, and `packages/tui/src/cli/spore-ops.js`
  - opt-in test/probe switches: `SPORE_RUN_PI_E2E`, `SPORE_RUN_PI_CONTROL_E2E`, and `SPORE_SCENARIO_BASE_URL` in `packages/runtime-pi/test/` and `services/session-gateway/test/`
- `.env.example` is present at repository root; actual `.env` files are ignored by `.gitignore`

**Build:**
- There is no compile step; scripts in `package.json` execute source files directly with `node`
- Runtime defaults live in `config/system/runtime.yaml`
- Observability defaults live in `config/system/observability.yaml`
- Docs index defaults live in `packages/docs-kb/src/metadata/constants.js`
- Repository-local coding agent configuration lives in `opencode.json`

## Platform Requirements

**Development:**
- `node >= 24`, `npm`, `tmux`, `pi`, `jq`, `sqlite3`, `python3`, `git`, and `rg` are the documented baseline in `README.md`, `AGENTS.md`, and `docs/runbooks/local-dev.md`
- Writable local directories are expected under `data/state/`, `data/docs-index/`, `data/cache/`, `data/embeddings/`, and `tmp/sessions/`

**Production:**
- Formal production deployment target is not detected
- Current executable surfaces run as local Node processes on loopback ports `8787`, `8788`, and `8789` from `services/session-gateway/server.js`, `apps/web/server.js`, and `services/orchestrator/server.js`
- Container, serverless, Docker, and CI deployment configuration are not detected in the repository

---

*Stack analysis: 2026-03-09*
