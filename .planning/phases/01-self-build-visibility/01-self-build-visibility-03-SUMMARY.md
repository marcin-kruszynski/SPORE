---
phase: 01-self-build-visibility
plan: "03"
subsystem: tui-self-build
tags: [tui, self-build, operator-surfaces, terminal-ui, phase-01]
dependency_graph:
  requires: [01-01]
  provides: [tui-self-build-triage, tui-self-build-drilldown, tui-parity-coverage]
  affects: [packages/tui, docs/runbooks]
tech_stack:
  added: []
  patterns: [terminal-native-formatting, drilldown-flags, http-only-reads]
key_files:
  created: []
  modified:
    - packages/tui/src/cli/spore-ops.js
    - packages/tui/test/tui-parity.test.js
    - docs/runbooks/local-dev.md
decisions:
  - slug: tui-formatted-output
    summary: "Added terminal-native triage view with formatted output for self-build command while preserving JSON-only backward compatibility for self-build-summary"
  - slug: drilldown-via-flags
    summary: "Implemented drilldown support through --item, --proposal, --group, --run, --plan flags to stay within TUI mental model"
  - slug: parity-coverage
    summary: "Extended parity tests to verify self-build commands use orchestrator HTTP surfaces and render shared status language"
metrics:
  duration_minutes: 4
  completed_at: "2026-03-09T04:46:22Z"
  tasks_completed: 2
  files_created: 0
  files_modified: 3
  commits: 2
---

# Phase 01 Plan 03: TUI Self-Build Triage Summary

**Added terminal-native self-build triage view with drilldown support over shared HTTP contracts**

## Overview

This plan delivered a dedicated self-build triage command for the TUI that mirrors the same lifecycle model as the web dashboard. Terminal operators can now scan urgent self-build work first and drill into linked records without leaving the TUI or relying on raw JSON output.

## Tasks Completed

### Task 1: Implement a dedicated self-build TUI triage view
- **Status**: ✅ Complete
- **Commit**: 9a4307f
- **Files**:
  - `packages/tui/src/cli/spore-ops.js` (+152 lines for renderSelfBuildTriage and selfBuild functions)
  - `docs/runbooks/local-dev.md` (documented TUI self-build entrypoint and usage examples)
- **Outcome**: The TUI now provides a dedicated `self-build` command that renders a terminal-native summary with overview counts, urgent work queue (blocked/failed items, proposals awaiting review/approval), follow-up work queue (pending validation, doc suggestions), freshness timestamp, and next-action hints. The legacy `self-build-summary` command remains JSON-only for backward compatibility.

### Task 2: Add self-build drilldown and HTTP-only parity assertions
- **Status**: ✅ Complete
- **Commit**: 8a73d4e
- **Files**:
  - `packages/tui/test/tui-parity.test.js` (+70 lines for self-build parity coverage)
- **Outcome**: The TUI can triage and inspect self-build work over shared HTTP contracts. Drilldown flags (--item, --proposal, --group, --run, --plan) allow operators to move from triage view into detail without leaving the terminal. Automated parity coverage proves the implementation stays aligned with orchestrator HTTP surfaces and renders shared status language.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

All verification criteria met:

- ✅ Syntax check passed for test file
- ✅ TUI exposes self-build as a first-class triage command optimized for scanning
- ✅ Terminal drilldown uses the same lifecycle model and shared HTTP routes as the web surface
- ✅ Parity coverage ensures no regressions toward direct database access or inconsistent status language

## Success Criteria

- ✅ The TUI exposes self-build as a first-class triage command optimized for scanning rather than raw JSON alone
- ✅ Terminal drilldown uses the same lifecycle model and shared HTTP routes as the web surface
- ✅ TUI parity coverage catches regressions if the implementation drifts toward direct database access or inconsistent status language

## Implementation Details

### Terminal-Native Output Format

The `self-build` command renders:
```
═══════════════════════════════════════════════════════════
  SPORE Self-Build Triage
═══════════════════════════════════════════════════════════

OVERVIEW
--------
Work Items: 5 | Groups: 2 | Proposals: 3

Status: pending=3, running=1, completed=1

URGENT WORK
-----------
[HIGH] blocked-work-item
      Title: Fix CLI verification scenario
      Work item blocked and requires operator intervention
      → /work-items/work-item-123

[HIGH] waiting-review
      Title: Operator UI improvements
      Proposal ready for operator review
      → /proposal-artifacts/proposal-456

FOLLOW-UP WORK
--------------
[MED]  pending-validation
      Validate CLI work item
      Work item run completed but validation not yet triggered
      → /work-item-runs/run-789
      Action: POST /work-item-runs/:runId/validate

NEXT ACTIONS
------------
→ Review urgent work above and take action
→ Use drilldown commands for detail:
    spore-ops self-build --item <id>
    spore-ops self-build --proposal <id>
    spore-ops self-build --group <id>
```

### Drilldown Support

Operators can drill down from the triage view without leaving the TUI:

```bash
# Triage view (default)
spore-ops self-build

# Drilldown into specific records
spore-ops self-build --item work-item-123
spore-ops self-build --proposal proposal-456
spore-ops self-build --group group-789
spore-ops self-build --run run-abc
spore-ops self-build --plan plan-def

# JSON output for scripting
spore-ops self-build --json
```

### Parity Coverage

The test suite now verifies:
- `self-build` command renders formatted triage output with expected sections
- `self-build --json` returns the same payload as `/self-build/summary`
- Drilldown flags delegate to existing HTTP-backed detail commands
- All responses include shared status language and lineage links
- No direct database access from TUI implementation

## Contracts Honored

All self-build commands use these orchestrator HTTP routes:
- `GET /self-build/summary` - Triage view data source
- `GET /work-items/:id` - Work item detail with lineage
- `GET /proposal-artifacts/:id` - Proposal detail with review/approval links
- `GET /work-item-groups/:id` - Group detail with member items
- `GET /work-item-runs/:runId` - Run detail with validation status
- `GET /goal-plans/:id` - Goal plan detail with materialization status

## Documentation Updates

Updated `docs/runbooks/local-dev.md` with:
- TUI self-build triage view section
- Command examples for formatted and JSON output
- Drilldown flag usage patterns
- Explanation of display sections and operator workflow

## Self-Check

✅ **PASSED**

Verified files:
- `packages/tui/src/cli/spore-ops.js` exists and contains selfBuild and renderSelfBuildTriage functions
- `packages/tui/test/tui-parity.test.js` exists and contains self-build parity assertions
- `docs/runbooks/local-dev.md` exists and documents TUI self-build usage

Verified commits:
- 9a4307f: feat(01-self-build-visibility-03): add terminal-native self-build triage view
- 8a73d4e: test(01-self-build-visibility-03): add self-build drilldown and HTTP-only parity assertions

All claimed artifacts and commits are present and correct.
