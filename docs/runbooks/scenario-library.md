# Scenario Library

This runbook defines canonical SPORE scenarios for local validation, operator demos, and future regression coverage.

## Purpose

Use named scenarios instead of ad hoc invocations whenever possible. Each scenario ties together a workflow template, a domain, a policy-pack combination, and an expected governance shape.

Execution-facing catalog files live in:

- `config/scenarios/*.yaml`
- `config/regressions/*.yaml`

Preferred operator entrypoints:

```bash
npm run orchestrator:scenario-list
npm run orchestrator:scenario-show -- --scenario backend-service-delivery
npm run orchestrator:scenario-run -- --scenario backend-service-delivery --stub
npm run orchestrator:regression-list
npm run orchestrator:regression-run -- --regression local-fast --stub
```

## Canonical Scenarios

### Backend Service Delivery

- Workflow: `config/workflows/backend-service-delivery.yaml`
- Domain: `backend`
- Policy packs: `service-core`, `platform-backend`
- Typical roles: `lead,builder,tester,reviewer`
- Expected topology:
  - Wave 1: framing
  - Wave 2: builder
  - Wave 3: service-verification
  - Wave 4: service-review
- Expected governance:
  - reviewer approval required
  - open escalation on implementation wave timeout/failure
  - tester verifies a builder handoff snapshot in a separate verification workspace

```bash
npm run orchestrator:plan -- --workflow config/workflows/backend-service-delivery.yaml --domain backend --roles lead,builder,tester,reviewer
npm run orchestrator:invoke -- --workflow config/workflows/backend-service-delivery.yaml --domain backend --roles lead,builder,tester,reviewer --objective "Deliver a backend service slice." --wait
```

### Frontend UI Pass

- Workflow: `config/workflows/frontend-ui-pass.yaml`
- Domain: `frontend`
- Policy packs: `ui-core`
- Typical roles: `lead,scout,builder,tester,reviewer`
- Expected topology:
  - Wave 1: lead + scout
  - Wave 2: ui-build
  - Wave 3: ui-verification
  - Wave 4: ui-review
- Expected governance:
  - rework may branch
  - UI review approval required
  - final tester verification runs after builder handoff and should not share the builder worktree

```bash
npm run orchestrator:plan -- --workflow config/workflows/frontend-ui-pass.yaml --domain frontend --roles lead,scout,builder,tester,reviewer
npm run orchestrator:invoke -- --workflow config/workflows/frontend-ui-pass.yaml --domain frontend --roles lead,scout,builder,tester,reviewer --objective "Run a frontend UI pass." --wait
```

### CLI Verification Pass

- Workflow: `config/workflows/cli-verification-pass.yaml`
- Domain: `cli`
- Policy packs: `cli-core`
- Typical roles: `lead,builder,tester,reviewer`
- Expected topology:
  - Wave 1: lead
  - Wave 2: implementation
  - Wave 3: verify
  - Wave 4: cli-review
- Expected governance:
  - no approval requirement by default
  - escalation on verification wave timeout/failure
  - tester verifies a git-backed builder snapshot in a separate verification workspace

```bash
npm run orchestrator:plan -- --workflow config/workflows/cli-verification-pass.yaml --domain cli --roles lead,builder,tester,reviewer
npm run orchestrator:invoke -- --workflow config/workflows/cli-verification-pass.yaml --domain cli --roles lead,builder,tester,reviewer --objective "Verify a CLI-facing change." --wait
```

### Docs ADR Pass

- Workflow: `config/workflows/docs-adr-pass.yaml`
- Domain: `docs`
- Policy packs: `docs-core`
- Typical roles: `lead,scout,reviewer`
- Expected topology:
  - Wave 1: lead
  - Wave 2: scout
  - Wave 3: reviewer
- Expected governance:
  - documentation is the main output
  - research timeout escalates or holds instead of silently failing

```bash
npm run orchestrator:plan -- --workflow config/workflows/docs-adr-pass.yaml --domain docs --roles lead,scout,reviewer
npm run orchestrator:invoke -- --workflow config/workflows/docs-adr-pass.yaml --domain docs --roles lead,scout,reviewer --objective "Draft an ADR-backed documentation pass." --wait
```

### Self-Build Visibility Validation

- Workflow: `config/workflows/cli-verification-pass.yaml`
- Domain: `cli`
- Policy packs: `cli-core`
- Typical roles: `lead,builder,tester,reviewer`
- Expected topology:
  - Wave 1: lead
  - Wave 2: implementation
  - Wave 3: verify
  - Wave 4: review
- Expected governance:
  - validation of self-build HTTP contract
  - no approval requirement by default
- Purpose: Validate Phase 1 self-build visibility foundation before dashboard/TUI implementation

```bash
npm run orchestrator:scenario-run -- --scenario self-build-visibility-validation --stub
npm run orchestrator:scenario-show -- --scenario self-build-visibility-validation
node --test services/orchestrator/test/http-self-build.test.js
```

### Self-Build Dependency Graph Validation

- Workflow: `config/workflows/cli-verification-pass.yaml`
- Domain: `cli`
- Policy packs: `cli-core`
- Typical roles: `lead,builder,tester,reviewer`
- Expected topology:
  - Wave 1: lead
  - Wave 2: implementation
  - Wave 3: verify
  - Wave 4: review
- Expected governance:
  - validation of dependency authoring and readiness semantics
  - no approval requirement by default
- Purpose: Validate Phase 2 dependency graph authoring, blocked/review-needed recovery, and advisory auto-relaxation behavior before web/TUI visibility work lands

```bash
npm run orchestrator:scenario-run -- --scenario self-build-dependency-graph-validation --stub
npm run orchestrator:scenario-show -- --scenario self-build-dependency-graph-validation
node --test services/orchestrator/test/http-self-build-dependencies.test.js
```

## Local Regression Flow

Use this order when validating the local orchestration stack:

```bash
npm run config:validate
npm run docs-kb:index
npm run test:all-local
SPORE_RUN_PI_E2E=1 npm run test:e2e:pi
```

## Notes

- Keep scenario commands stable. They are reference entrypoints for future automation and operator runbooks.
- For the canonical implementation workflows, builder and tester final verification is intentionally sequential. Builder owns the authoring workspace, publishes a handoff snapshot, and tester validates a separate verification workspace from that snapshot.
- Prefer extending this file when adding a new canonical scenario instead of scattering one-off examples across package READMEs.
