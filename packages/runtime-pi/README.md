# `packages/runtime-pi`

This package owns the first PI-specific runtime integration layer.

## Current Capability

- translate a SPORE profile plus runtime config into a session launch plan,
- register PI runtime backends behind the generic `@spore/runtime-core` contract,
- emit explicit session metadata and PI-facing launch data,
- launch PI sessions through three backend kinds:
  - `pi_rpc`
  - `pi_sdk_embedded`
  - `pi_sdk_worker`
- use `pi --mode rpc` as the default real launcher when the `pi` CLI is installed,
- route operator steering and abort requests through backend-aware control paths while preserving durable inspectability,
- keep `pi --mode json` available as a secondary launcher for isolated debugging,
- fall back to a bootstrap stub launcher when `pi` is unavailable,
- wire session-manager and startup context generation into the runtime flow,
- capture generic runtime status/events plus raw PI artifacts under `tmp/sessions/`,
- spawn a detached reconcile watcher for launched sessions unless `--no-monitor` is used.

## Run

```bash
npm run runtime-pi:plan -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --complete
npm run runtime-pi:run -- --profile config/profiles/builder.yaml --project config/projects/example-project.yaml --session-id builder-live-001 --run-id run-006 --stub-seconds 15
npm run runtime-pi:run -- --profile config/profiles/scout.yaml --project config/projects/example-project.yaml --session-id scout-auto-001 --run-id run-007 --stub-seconds 3
npm run runtime-pi:run -- --profile config/profiles/scout.yaml --project config/projects/example-project.yaml --session-id pi-real-003 --run-id run-pi-real-003 --wait --timeout 120000
npm run runtime-pi:run -- --profile config/profiles/lead.yaml --project config/projects/example-project.yaml --launcher pi-json
npm run runtime-pi:run -- --profile config/profiles/builder.yaml --project config/projects/spore.yaml --session-id local-sdk-embedded --run-id local-sdk-embedded-run --backend-kind pi_sdk_embedded --stub --stub-seconds 0 --wait --no-monitor
npm run runtime-pi:run -- --profile config/profiles/builder.yaml --project config/projects/spore.yaml --session-id local-sdk-worker --run-id local-sdk-worker-run --backend-kind pi_sdk_worker --stub --stub-seconds 0 --wait --no-monitor
```

Generated runtime artifacts include:

- `tmp/sessions/<id>.plan.json`
- `tmp/sessions/<id>.context.json`
- `tmp/sessions/<id>.transcript.md`
- `tmp/sessions/<id>.runtime-status.json`
- `tmp/sessions/<id>.runtime-events.jsonl`
- `tmp/sessions/<id>.pi-events.jsonl`
- `tmp/sessions/<id>.stderr.log`
- `tmp/sessions/<id>.pi-session.jsonl`
- `tmp/sessions/<id>.rpc-status.json`
- `tmp/sessions/<id>.control.ndjson`
- `tmp/sessions/<id>.exit.json`

Use `--backend-kind` when you want to override the default PI backend for one launch.

## Expected Responsibilities

- translate SPORE profiles into PI session settings,
- inject skills, prompt overlays, and extensions,
- start and supervise PI-backed sessions,
- bridge PI events into SPORE session and observability contracts.
