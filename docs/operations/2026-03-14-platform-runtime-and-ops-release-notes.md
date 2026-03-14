# 2026-03-14 Platform Runtime And Ops Release Notes

## Summary

This update lands a multi-backend PI runtime foundation and aligns the operator surfaces around the newer orchestration and self-build model.

The result is not only a runtime change. It also sharpens the current project truth around:

- backend-aware session/runtime inspection,
- coordinator/integrator orchestration flows,
- operator-facing browser and terminal mission-control surfaces,
- scenario/regression coverage for the current supervised self-build system.

## Runtime Highlights

- SPORE now has a dedicated backend-agnostic runtime contract in `packages/runtime-core/`.
- The PI integration boundary in `packages/runtime-pi/` now supports three backend kinds:
  - `pi_rpc`
  - `pi_sdk_embedded`
  - `pi_sdk_worker`
- Session artifacts are now normalized around generic runtime files such as:
  - `*.runtime-status.json`
  - `*.runtime-events.jsonl`
  - `*.control.ndjson`
  - `*.launch-context.json`
- Compatibility PI/RPC artifacts remain available during the migration window.
- Session reconciliation now prefers generic runtime status before legacy RPC-only terminal artifacts.

## Operator And Orchestrator Highlights

- Workflow planning now carries backend-aware runtime policy alongside existing session-mode and docs policy shaping.
- Project-root coordination and promotion flows remain explicit through coordinator and integrator lanes.
- Session gateway live payloads now expose backend-aware runtime metadata, capability flags, generic runtime artifacts, and richer launch context.
- The orchestrator and self-build HTTP surfaces continue to expose durable execution, proposal, validation, promotion, quarantine, rollback, and scenario/regression reads over one thin-client contract.

## Browser And Terminal Surface Highlights

- The browser default home is the real `Agent Cockpit` at `/cockpit`.
- `Mission Map`, `Operator Chat`, and the self-build dashboard are first-class operator surfaces, not placeholder previews.
- Lane detail and session views now show backend-aware runtime metadata instead of assuming one launcher path.
- `spore-ops` continues to grow as the broad operator terminal surface for execution trees, governance, scenarios/regressions, self-build, proposals, and project/promotion flows.

## Recommended Backend Posture

- `pi_rpc`: compatibility and operational fallback.
- `pi_sdk_embedded`: local dev and test path.
- `pi_sdk_worker`: production-candidate SDK path behind a SPORE-owned worker protocol.

## Verification Snapshot

The merged update was freshly verified with:

```bash
npm run docs-kb:index
npm run config:validate
npm run typecheck
npm run test:runtime
npm run test:all-local
npm run web:build
npm run test:http
npm run test:web
```

## Related Docs

- `docs/decisions/ADR-0014-runtime-adapter-multi-backend-pi.md`
- `docs/decisions/ADR-0015-pi-sdk-worker-transport.md`
- `docs/decisions/ADR-0016-runtime-artifact-parity.md`
- `docs/architecture/runtime-model.md`
- `docs/architecture/session-model.md`
- `docs/architecture/clients-and-surfaces.md`
- `docs/runbooks/local-dev.md`
