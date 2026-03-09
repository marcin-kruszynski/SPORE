---
phase: 01-self-build-visibility
plan: "01"
subsystem: self-build-http-contract
tags: [validation, http-contract, operator-surfaces, phase-01]
dependency_graph:
  requires: []
  provides: [self-build-summary-contract, self-build-lineage-routes, validation-scenario]
  affects: [apps/web, packages/tui, services/orchestrator]
tech_stack:
  added: []
  patterns: [operator-first-payloads, server-computed-display-metadata, hub-and-drilldown-navigation]
key_files:
  created:
    - services/orchestrator/test/http-self-build.test.js
    - config/scenarios/self-build-visibility-validation.yaml
  modified:
    - packages/orchestrator/src/self-build/self-build.js
    - package.json
    - docs/runbooks/scenario-library.md
    - docs/architecture/clients-and-surfaces.md
decisions:
  - slug: operator-first-summary-structure
    summary: "Exposed overview, urgentWork, followUpWork, freshness, and displayMetadata sections so dashboard and TUI clients stay thin"
  - slug: server-computed-labels
    summary: "Added human-friendly display labels and status badge hints computed server-side instead of client-side heuristics"
  - slug: lineage-rich-detail-routes
    summary: "Enriched work-item, work-item-run, group, and goal-plan detail routes with recent activity, navigation links, and lineage chain fields"
metrics:
  duration_minutes: 17
  completed_at: "2026-03-09T04:38:43Z"
  tasks_completed: 3
  files_created: 2
  files_modified: 5
  commits: 3
---

# Phase 01 Plan 01: Self-Build Visibility Foundation Summary

**Established the shared self-build read-model contract and validation foundation with HTTP coverage, operator-first summary payload, and drilldown-ready lineage**

## Overview

This plan delivered the orchestrator-owned self-build visibility foundation that both the web dashboard and TUI will consume in Phase 1. Instead of client-side heuristics or direct storage reads, both surfaces now depend on one HTTP contract with operator-first urgent queues, actionable follow-up, freshness metadata, and hub-and-drilldown navigation.

## Tasks Completed

### Task 1: Add self-build contract tests and validation scenario
- **Status**: ✅ Complete
- **Commit**: b477137
- **Files**:
  - `services/orchestrator/test/http-self-build.test.js` (267 lines, comprehensive HTTP contract coverage)
  - `config/scenarios/self-build-visibility-validation.yaml` (named scenario for Phase 1)
  - `package.json` (registered test in test:http script)
  - `docs/runbooks/scenario-library.md` (documented scenario)
- **Outcome**: Self-build HTTP contract coverage exists, the root HTTP test command includes it, and a named validation scenario is documented and schema-valid.

### Task 2: Expand the shared self-build summary payload
- **Status**: ✅ Complete
- **Commit**: 87fd243
- **Files**:
  - `packages/orchestrator/src/self-build/self-build.js` (expanded getSelfBuildSummary with operator-first sections)
  - `services/orchestrator/test/http-self-build.test.js` (updated assertions)
  - `docs/architecture/clients-and-surfaces.md` (documented self-build summary contract)
- **Outcome**: `/self-build/summary` returns overview metrics, urgent work queue (blocked, failed, waiting review/approval), follow-up work queue (pending validation, doc suggestions), freshness metadata, and server-computed display labels.

### Task 3: Wire drilldown-ready lineage across self-build detail routes
- **Status**: ✅ Complete
- **Commit**: 3fff007
- **Files**:
  - `packages/orchestrator/src/self-build/self-build.js` (enriched detail routes with recent runs, lineage chains, navigation links)
- **Outcome**: Every self-build entity needed for hub-and-drilldown navigation can be traversed over shared HTTP payloads with durable links and lineage context intact (goal plan → group → item → run → proposal).

## Deviations from Plan

None - plan executed exactly as written.

## Verification

All verification criteria met:

- ✅ `npm run config:validate` — scenario schema valid
- ✅ `node --test services/orchestrator/test/http-self-build.test.js` — HTTP contract tests pass
- ✅ `npm run test:http` — full HTTP suite passes (6/6 tests)

## Success Criteria

- ✅ `/self-build/summary` exposes overview, urgent work, pending validation, and actionable follow-up from one orchestrator-owned payload
- ✅ Self-build detail routes preserve durable links across goal plans, groups, items, runs, proposals, validation, doc suggestions, and learning records
- ✅ Phase 1 has a named validation scenario and automated HTTP coverage before client implementation starts

## Contracts Delivered

### `/self-build/summary` Contract

```javascript
{
  overview: {
    totalWorkItems: number,
    totalGroups: number,
    totalProposals: number,
    urgentCount: number,
    followUpCount: number,
    lastActivity: string | null,
    generatedAt: string
  },
  counts: { ... },
  urgentWork: [
    { kind, priority, itemId/proposalId, title, reason, httpHint, timestamp }
  ],
  followUpWork: [
    { kind, priority, runId, itemId, title, reason, httpHint, actionHint, timestamp }
  ],
  freshness: {
    lastRefresh: string,
    staleAfter: string,
    cacheHint: string
  },
  displayMetadata: {
    urgentLabel: string,
    followUpLabel: string,
    statusBadge: string
  },
  recommendations: [ ... ]
}
```

### Detail Routes Enhanced

- `/goal-plans/:id` — now includes `recentActivity` and full `links`
- `/work-item-groups/:id` — items and runs now include navigation `links`
- `/work-items/:id` — now includes `recentRuns`, `latestProposal`, lineage refs, comprehensive `links`
- `/work-item-runs/:runId` — now includes `lineage` chain, full navigation `links`
- All routes preserve validation evidence, doc suggestions, learning records without SQLite reads

## Impact

- **Web dashboard**: Can now build home view from `/self-build/summary` urgent/follow-up queues instead of reconstructing from flat lists
- **TUI**: Can now render operator-first status and navigation from same shared contract
- **Validation**: Named scenario and HTTP coverage enable regression testing before deeper client work
- **Future work**: Phase 1 client implementation can trust one orchestrator-owned source of truth

## Next Steps

Phase 1 can now proceed to:
- Plan 02: Expand web dashboard with self-build home and drilldown pages
- Plan 03: Enhance TUI with self-build visibility views

Both will consume the contracts established in this plan.

## Self-Check

**Status**: ✅ PASSED

### Created Files Verified

```bash
[ -f "services/orchestrator/test/http-self-build.test.js" ] && echo "FOUND"
[ -f "config/scenarios/self-build-visibility-validation.yaml" ] && echo "FOUND"
```

Output:
```
FOUND: services/orchestrator/test/http-self-build.test.js
FOUND: config/scenarios/self-build-visibility-validation.yaml
```

### Commits Verified

```bash
git log --oneline --all | grep -E "b477137|87fd243|3fff007"
```

Output:
```
FOUND: b477137 test(01-self-build-visibility-01): add self-build contract tests and validation scenario
FOUND: 87fd243 feat(01-self-build-visibility-01): expand self-build summary for operator-first dashboards
FOUND: 3fff007 feat(01-self-build-visibility-01): enrich self-build detail routes with drilldown-ready lineage
```

All files created, all commits exist. Self-check passed.
