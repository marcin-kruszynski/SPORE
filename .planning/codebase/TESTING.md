# Testing Patterns

**Analysis Date:** 2026-03-09

## Test Framework

**Runner:**
- Node built-in `node:test`.
- Config: Not detected. Tests are invoked directly from root scripts in `package.json`; no `jest.config.*` or `vitest.config.*` files are present.

**Assertion Library:**
- Node built-in `node:assert/strict`, used in every current test file such as `packages/orchestrator/test/domain-policy.test.js`, `services/orchestrator/test/http-scenarios.test.js`, and `packages/runtime-pi/test/pi-rpc-smoke.test.js`.

**Run Commands:**
```bash
npm run test:policy                              # Planner/policy/orchestrator/runtime policy tests
npm run test:http                                # HTTP contract tests for orchestrator and session gateway
npm run test:tui                                 # TUI parity test against orchestrator HTTP APIs
npm run test:all-local                           # Local non-PI suite from root `package.json`
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi          # Real PI smoke and canonical scenario tests
SPORE_RUN_PI_E2E=1 SPORE_RUN_PI_CONTROL_E2E=1 npm run test:e2e:gateway-control  # Real gateway control E2E
```

## Test File Organization

**Location:**
- Keep package tests under package-local `test/` directories, for example `packages/orchestrator/test/`, `packages/runtime-pi/test/`, and `packages/tui/test/`.
- Keep service tests under service-local `test/` directories, for example `services/orchestrator/test/` and `services/session-gateway/test/`.
- Put reusable fixtures and harnesses in `test/helpers/`, such as `packages/orchestrator/test/helpers/scenario-fixtures.js`, `services/orchestrator/test/helpers/http-harness.js`, `packages/runtime-pi/test/helpers/e2e-harness.js`, and `services/session-gateway/test/helpers/gateway-harness.js`.

**Naming:**
- Use `*.test.js` for normal tests, for example `packages/orchestrator/test/domain-policy-propagation.test.js` and `services/session-gateway/test/live-route.test.js`.
- Use `*.e2e.test.js` for real runtime workflows, for example `packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.js` and `services/session-gateway/test/real-pi-session-control.e2e.test.js`.
- Use `*.pending.test.js` for readiness probes that accept partially available surfaces, currently `packages/runtime-pi/test/pi-rpc-canonical-scenarios.pending.test.js`.

**Structure:**
```text
packages/orchestrator/test/
packages/orchestrator/test/helpers/
packages/runtime-pi/test/
packages/runtime-pi/test/helpers/
packages/tui/test/
services/orchestrator/test/
services/orchestrator/test/helpers/
services/session-gateway/test/
services/session-gateway/test/helpers/
```

## Test Structure

**Suite Organization:**
```javascript
import test from "node:test";
import assert from "node:assert/strict";

test("orchestrator HTTP and web proxy expose policy-aware plan preview", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const { dbPath, sessionDbPath } = await makeTempPaths("spore-http-policy-");

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath
  });

  t.after(() => {
    orchestrator.kill("SIGTERM");
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  assert.equal(orchestratorResponse.status, 200);
});
```
This pattern comes directly from `services/orchestrator/test/http-policy.test.js`.

**Patterns:**
- Setup usually creates isolated temp state first, using `makeTempPaths(...)` from `packages/orchestrator/test/helpers/scenario-fixtures.js` or `buildIsolatedStateEnv(...)` from `packages/runtime-pi/test/helpers/e2e-harness.js`.
- Teardown uses `t.after(...)` for spawned processes and temp directories, and `try/finally` for database handles, as seen in `packages/orchestrator/test/domain-policy-propagation.test.js`, `services/orchestrator/test/http-scenarios.test.js`, and `services/session-gateway/test/live-route.test.js`.
- Assertions rely on `assert.equal`, `assert.deepEqual`, `assert.ok`, and `assert.match` against real payloads and real files rather than snapshots, as seen in `packages/runtime-pi/test/pi-rpc-smoke.test.js` and `packages/tui/test/tui-parity.test.js`.

## Mocking

**Framework:** None detected.

**Patterns:**
```javascript
const result = await postJson(`${baseUrl}/scenarios/cli-verification-pass/run`, {
  stub: true,
  wait: true,
  by: "test-runner",
  timeout: 6000,
  interval: 250,
  stepSoftTimeout: 250,
  stepHardTimeout: 1000
});
```
This is the dominant substitute for mocks in `services/orchestrator/test/http-scenarios.test.js`.

- Use stub mode or `launcher: "stub"` to isolate orchestration behavior without PI, for example in `services/orchestrator/test/http-scenarios.test.js` and `packages/orchestrator/test/domain-policy.test.js`.
- Prefer spawning the real Node process for CLIs and HTTP servers over mocking module internals, as in `packages/tui/test/tui-parity.test.js`, `services/orchestrator/test/http-policy.test.js`, and `services/session-gateway/test/live-route.test.js`.

**What to Mock:**
- Mock the runtime boundary by using stub launcher flows when the test target is planner, governance, history, or HTTP surface behavior.
- Mock external availability with conditional skips instead of fake adapters when PI or optional routes are not available, as in `packages/runtime-pi/test/pi-rpc-smoke.test.js` and `packages/runtime-pi/test/pi-rpc-canonical-scenarios.pending.test.js`.

**What NOT to Mock:**
- Do not replace the SQLite store, filesystem artifacts, or HTTP surfaces with fake in-memory implementations when the goal is contract coverage; current tests exercise real temp databases, event logs, spawned services, and `fetch` calls.

## Fixtures and Factories

**Test Data:**
```javascript
export async function makeTempPaths(prefix = "spore-scenario-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    dbPath: path.join(root, "orchestrator.sqlite"),
    sessionDbPath: path.join(root, "sessions.sqlite")
  };
}
```
This fixture comes from `packages/orchestrator/test/helpers/scenario-fixtures.js`.

**Location:**
- Scenario/execution fixtures: `packages/orchestrator/test/helpers/scenario-fixtures.js`.
- HTTP process helpers: `services/orchestrator/test/helpers/http-harness.js`.
- Real PI and isolated state helpers: `packages/runtime-pi/test/helpers/e2e-harness.js`.
- Gateway control helpers: `services/session-gateway/test/helpers/gateway-harness.js`.

## Coverage

**Requirements:** None enforced.

**View Coverage:**
```bash
Not configured
```

- No coverage script is present in the root `package.json`.
- No `c8`, `nyc`, Jest coverage config, or Vitest coverage config is detected.

## Test Types

**Unit Tests:**
- Narrow behavior checks focus on planner, policy propagation, and runtime-context assembly, for example `packages/orchestrator/test/domain-policy-propagation.test.js` and `packages/runtime-pi/test/domain-policy-runtime-context.test.js`.
- Even these tests typically use real temp files and SQLite databases instead of pure function-only mocks.

**Integration Tests:**
- Service tests spawn real HTTP servers and speak to them over `fetch`, for example `services/orchestrator/test/http-policy.test.js`, `services/orchestrator/test/http-governance.test.js`, `services/orchestrator/test/http-lineage.test.js`, `services/orchestrator/test/http-scenarios.test.js`, and `services/session-gateway/test/live-route.test.js`.
- CLI parity tests spawn the real CLI against the real orchestrator service, as in `packages/tui/test/tui-parity.test.js`.

**E2E Tests:**
- Real PI smoke coverage lives in `packages/runtime-pi/test/pi-rpc-smoke.test.js`.
- Real PI canonical scenario coverage lives in `packages/runtime-pi/test/pi-rpc-canonical-scenarios.e2e.test.js`.
- Real gateway control coverage lives in `services/session-gateway/test/real-pi-session-control.e2e.test.js`.
- Probe-style pending coverage for scenario and regression surfaces lives in `packages/runtime-pi/test/pi-rpc-canonical-scenarios.pending.test.js`.

## Common Patterns

**Async Testing:**
```javascript
export async function waitFor(fn, options = {}) {
  const timeoutMs = Number.parseInt(String(options.timeoutMs ?? "30000"), 10);
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "250"), 10);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await fn();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
```
This polling pattern comes from `packages/runtime-pi/test/helpers/e2e-harness.js` and is reused indirectly by gateway and scenario harnesses.

**Error Testing:**
```javascript
const scenarioTrend = await probeOptionalJson(
  harness.baseUrl,
  "/scenarios/docs-adr-pass/trends"
);
assert.ok([200, 404].includes(scenarioTrend.status));
```
This forward-compatible negative-path style comes from `packages/runtime-pi/test/pi-rpc-canonical-scenarios.pending.test.js`.

- Current negative-path coverage is mostly status-code and payload-shape based rather than `assert.rejects(...)` based.
- When failure metadata is expected, tests inspect durable fields such as `failure`, `suggestedActions`, `links`, or `trendSnapshot`, as in `services/orchestrator/test/http-scenarios.test.js` and `packages/tui/test/tui-parity.test.js`.

## Smoke and Verification Flows

**Repository Loop:**
- The default local verification loop is documented in `AGENTS.md`, `docs/runbooks/local-dev.md`, and `docs/runbooks/scenario-library.md`.
- Use `npm run docs-kb:index`, `npm run config:validate`, and `npm run test:all-local` before PI-backed checks, matching `docs/runbooks/local-dev.md` and `docs/runbooks/scenario-library.md`.

**Real Runtime Gates:**
- `packages/runtime-pi/test/pi-rpc-smoke.test.js` requires `SPORE_RUN_PI_E2E=1` and skips if the `pi` binary is unavailable.
- `services/session-gateway/test/real-pi-session-control.e2e.test.js` adds the stricter `SPORE_RUN_PI_CONTROL_E2E=1` gate for control actions.
- `packages/runtime-pi/test/helpers/e2e-harness.js` isolates state with `SPORE_ORCHESTRATOR_DB_PATH`, `SPORE_SESSION_DB_PATH`, and `SPORE_EVENT_LOG_PATH`; reuse that pattern for new E2E work.

---

*Testing analysis: 2026-03-09*
