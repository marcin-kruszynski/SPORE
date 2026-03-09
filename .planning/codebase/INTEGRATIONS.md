# External Integrations

**Analysis Date:** 2026-03-09

## APIs & External Services

**Agent Runtime:**
- PI CLI - real agent runtime used by `packages/runtime-pi/`
  - SDK/Client: external CLI `pi` from `@mariozechner/pi-coding-agent`, launched by `packages/runtime-pi/src/launchers/pi-rpc-runner.js` and `packages/runtime-pi/src/launchers/pi-json-runner.js`
  - Auth: handled outside the repo; `docs/runbooks/local-dev.md` requires PI login or exported provider API keys before real runtime testing
- tmux - session transport and live inspection boundary for launched sessions
  - SDK/Client: system CLI invoked by `packages/runtime-pi/src/launchers/tmux-launcher.js`
  - Auth: Not applicable

**Internal Service Boundaries:**
- Session Gateway - session/event HTTP surface on loopback `:8787`
  - SDK/Client: implemented in `services/session-gateway/server.js`; consumed by `apps/web/server.js` and `apps/web/public/app.js`
  - Auth: None detected
- Orchestrator Service - workflow/execution HTTP surface on loopback `:8789`
  - SDK/Client: implemented in `services/orchestrator/server.js`; consumed by `packages/tui/src/cli/spore-ops.js`, `apps/web/server.js`, and `apps/web/public/app.js`
  - Auth: None detected
- Web Operator Console - browser proxy and static UI on loopback `:8788`
  - SDK/Client: `apps/web/server.js` with static assets in `apps/web/public/`
  - Auth: None detected

**Developer Tooling:**
- OpenCode provider configuration - repository-local GSD agent mapping in `opencode.json`
  - SDK/Client: `opencode.json`
  - Auth: provider credentials are handled by the local OpenCode installation; the repo does not store them

**Other External SaaS APIs:**
- Not detected - no Stripe, Supabase, AWS, GitHub API, Slack, Redis, PostgreSQL, MongoDB, Sentry, or OpenTelemetry client usage is present in tracked runtime source under `packages/`, `services/`, or `apps/`

## Data Storage

**Databases:**
- SQLite docs index at `data/docs-index/spore-docs.sqlite`
  - Connection: CLI override via `--index` in `packages/docs-kb/src/cli/docs-kb.js`
  - Client: `node:sqlite` via `packages/docs-kb/src/store/sqlite-store.js`
- SQLite session store at `data/state/spore-sessions.sqlite`
  - Connection: `SPORE_SESSION_DB_PATH` in `packages/session-manager/src/metadata/constants.js`
  - Client: `node:sqlite` via `packages/session-manager/src/store/session-store.js`
- SQLite orchestrator store at `data/state/spore-orchestrator.sqlite`
  - Connection: `SPORE_ORCHESTRATOR_DB_PATH` in `packages/orchestrator/src/metadata/constants.js`
  - Client: `node:sqlite` via `packages/orchestrator/src/store/execution-store.js`
- Observability metadata store is referenced in `config/system/observability.yaml` as `data/state/metadata.sqlite`, but active runtime code in this scan centers on `events.ndjson` plus the session and orchestrator SQLite stores

**File Storage:**
- Local filesystem only
- Runtime artifacts are written under `tmp/sessions/` by `packages/runtime-pi/src/launchers/tmux-launcher.js` and `packages/runtime-pi/src/cli/run-session-plan.js`
- Docs KB metadata lives under `data/docs-index/` per `packages/docs-kb/src/metadata/constants.js`
- Event logs live at `data/state/events.ndjson` per `packages/session-manager/src/metadata/constants.js`
- Repository docs remain the knowledge source under `docs/` and are indexed by `packages/docs-kb/src/ingestion/scan-documents.js`

**Caching:**
- No cache service detected
- Placeholder local cache directory exists at `data/cache/` and is ignored by `.gitignore`

## Authentication & Identity

**Auth Provider:**
- Custom/local for SPORE services; no OAuth, JWT middleware, or application auth provider is implemented in `services/session-gateway/server.js`, `services/orchestrator/server.js`, or `apps/web/server.js`
  - Implementation: loopback-local services with no request authentication checks in the scanned server code
- PI runtime authentication is delegated to the external `pi` CLI per `docs/runbooks/local-dev.md`
  - Implementation: operator logs into PI separately; repository config does not define provider credentials

## Monitoring & Observability

**Error Tracking:**
- None detected - no Sentry, Datadog, or OpenTelemetry client code is present in runtime source

**Logs:**
- Session lifecycle events append to `data/state/events.ndjson` via `packages/session-manager/src/events/event-log.js`
- Session Gateway exposes SSE at `/stream/events` in `services/session-gateway/server.js`
- Orchestrator exposes SSE at `/stream/executions` in `services/orchestrator/server.js`
- Runtime artifacts include transcript, stderr, PI event JSONL, PI session JSONL, RPC status, exit status, and control queue files in `tmp/sessions/` as documented in `packages/runtime-pi/README.md`

## CI/CD & Deployment

**Hosting:**
- Local Node processes launched by root scripts in `package.json`
- `npm run gateway:start` runs `services/session-gateway/server.js`
- `npm run orchestrator:start` runs `services/orchestrator/server.js`
- `npm run web:start` runs `apps/web/server.js`

**CI Pipeline:**
- None detected - `.github/workflows/`, `Dockerfile*`, `docker-compose*.yml`, and `Makefile` are absent from the repository root
- Validation and smoke coverage are local script flows in `package.json` and `docs/runbooks/local-dev.md`

## Environment Configuration

**Required env vars:**
- `SPORE_PI_BIN` - explicit PI binary path for `packages/runtime-pi/src/launchers/resolve-binary.js`
- `SPORE_SESSION_DB_PATH`, `SPORE_EVENT_LOG_PATH`, `SPORE_ORCHESTRATOR_DB_PATH` - local durable state overrides in `packages/session-manager/src/metadata/constants.js` and `packages/orchestrator/src/metadata/constants.js`
- `SPORE_GATEWAY_HOST`, `SPORE_GATEWAY_PORT`, `SPORE_ORCHESTRATOR_HOST`, `SPORE_ORCHESTRATOR_PORT`, `SPORE_WEB_HOST`, `SPORE_WEB_PORT` - service bind controls in `services/session-gateway/server.js`, `services/orchestrator/server.js`, and `apps/web/server.js`
- `SPORE_GATEWAY_ORIGIN`, `SPORE_ORCHESTRATOR_ORIGIN` - proxy and client routing in `apps/web/server.js` and `packages/tui/src/cli/spore-ops.js`
- `SPORE_RUN_PI_E2E`, `SPORE_RUN_PI_CONTROL_E2E`, `SPORE_SCENARIO_BASE_URL` - opt-in test and scenario probe controls in `packages/runtime-pi/test/` and `services/session-gateway/test/`

**Secrets location:**
- `.env.example` is present at repository root for environment shape only
- Real `.env` files are ignored by `.gitignore`
- PI/provider secrets are expected in the operator shell environment or PI login state; secret values are not committed in tracked config

## Webhooks & Callbacks

**Incoming:**
- None detected
- The repository exposes HTTP endpoints and SSE streams, but no webhook receiver pattern or signed callback handler is implemented in `services/session-gateway/server.js` or `services/orchestrator/server.js`

**Outgoing:**
- None detected
- Browser and TUI clients call internal HTTP routes and subscribe to SSE streams; scanned runtime code does not post callbacks to third-party services

---

*Integration audit: 2026-03-09*
