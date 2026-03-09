import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_ORCHESTRATOR_DB_PATH } from "../metadata/constants.js";
import { createExecution, driveExecution, getExecutionDetail } from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import {
  getRegressionRun,
  getSchedulerEvaluation,
  getScenarioRun,
  insertRegressionRun,
  insertRegressionRunItem,
  insertSchedulerEvaluation,
  insertScenarioRun,
  insertScenarioRunExecution,
  listRegressionRunItems,
  listRegressionRuns,
  listProposalArtifacts,
  listSchedulerEvaluations,
  listScenarioRunExecutions,
  listScenarioRuns,
  listWorkItemRuns,
  listWorkItems,
  openOrchestratorDatabase,
  updateSchedulerEvaluation,
  updateRegressionRun,
  updateRegressionRunItem,
  updateScenarioRun
} from "../store/execution-store.js";
import {
  getRegressionDefinition,
  getScenarioDefinition,
  listRegressionDefinitions,
  listScenarioDefinitions
} from "./catalog.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");

function withDatabase(dbPath, fn) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function createRunId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function toErrorMessage(value) {
  return String(value ?? "").trim();
}

function humanizeClassification(code) {
  return String(code ?? "unknown")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isInfrastructureFailure(code) {
  return [
    "runtime_setup_failure",
    "launcher_failure",
    "gateway_control_failure",
    "artifact_integrity_failure"
  ].includes(code);
}

function isRecoverableFailure(code) {
  return [
    "timeout_or_stall",
    "gateway_control_failure",
    "artifact_integrity_failure",
    "governance_failure"
  ].includes(code);
}

function classificationSeverity(code) {
  if (code === "success") {
    return "info";
  }
  if (code === "runtime_setup_failure" || code === "launcher_failure") {
    return "critical";
  }
  if (code === "gateway_control_failure" || code === "timeout_or_stall") {
    return "high";
  }
  if (code === "governance_failure") {
    return "medium";
  }
  return "medium";
}

function classifyFailureFromMessage(message) {
  const normalized = toErrorMessage(message).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("auth") || normalized.includes("provider") || normalized.includes("api key")) {
    return "runtime_setup_failure";
  }
  if (normalized.includes("pi") || normalized.includes("launcher") || normalized.includes("rpc")) {
    return "launcher_failure";
  }
  if (normalized.includes("gateway") || normalized.includes("control")) {
    return "gateway_control_failure";
  }
  if (normalized.includes("timeout") || normalized.includes("stuck") || normalized.includes("stall") || normalized.includes("held")) {
    return "timeout_or_stall";
  }
  return "scenario_assertion_failure";
}

function classifyScenarioOutcome(run, detail = null) {
  const finalState = detail?.execution?.state ?? run?.status ?? "unknown";
  const errorMessage = run?.metadata?.error ?? run?.assertionSummary?.error ?? null;
  if (isSuccessfulState(finalState)) {
    return { code: "success", reason: finalState };
  }
  if (finalState === "held" || finalState === "paused") {
    return { code: "timeout_or_stall", reason: finalState };
  }
  if (finalState === "failed") {
    return {
      code: classifyFailureFromMessage(errorMessage) ?? "scenario_assertion_failure",
      reason: errorMessage ?? finalState
    };
  }
  if (finalState === "rejected" || finalState === "canceled") {
    return { code: "governance_failure", reason: finalState };
  }
  return {
    code: classifyFailureFromMessage(errorMessage) ?? "scenario_assertion_failure",
    reason: errorMessage ?? finalState
  };
}

function buildFailureDescriptor({ code, reason, source, finalState = null }) {
  const normalizedCode = code ?? "scenario_assertion_failure";
  return {
    code: normalizedCode,
    label: humanizeClassification(normalizedCode),
    reason: toErrorMessage(reason) || normalizedCode,
    source: source ?? "scenario",
    finalState,
    infrastructure: isInfrastructureFailure(normalizedCode),
    recoverable: isRecoverableFailure(normalizedCode),
    severity: classificationSeverity(normalizedCode),
    failed: normalizedCode !== "success"
  };
}

function normalizeFailureDescriptor(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.code) {
    return buildFailureDescriptor({
      code: value.code,
      reason: value.reason ?? fallback.reason ?? value.code,
      source: value.source ?? fallback.source ?? "scenario",
      finalState: value.finalState ?? fallback.finalState ?? null
    });
  }
  if (!value && !fallback.code) {
    return null;
  }
  return buildFailureDescriptor({
    code: value ?? fallback.code ?? "scenario_assertion_failure",
    reason: fallback.reason ?? value ?? null,
    source: fallback.source ?? "scenario",
    finalState: fallback.finalState ?? null
  });
}

function buildSuggestion(action, {
  reason,
  expectedOutcome,
  targetType,
  targetId,
  commandHint,
  httpHint,
  priority = "medium"
} = {}) {
  return {
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    priority,
    reason: toErrorMessage(reason) || action,
    expectedOutcome: toErrorMessage(expectedOutcome) || null,
    commandHint: commandHint ?? null,
    httpHint: httpHint ?? null
  };
}

function buildScenarioSuggestedActions(run, detail = null) {
  const executionId = run?.metadata?.executionId ?? detail?.execution?.id ?? null;
  const failure = normalizeFailureDescriptor(run?.metadata?.failure ?? run?.metadata?.failureClassification, {
    reason: run?.metadata?.failureReason ?? run?.assertionSummary?.error ?? null,
    source: "scenario-run",
    finalState: detail?.execution?.state ?? run?.status ?? null
  });
  if (!failure || failure.code === "success") {
    return [];
  }
  if (failure.code === "governance_failure") {
    return [
      buildSuggestion("review-governance", {
        reason: "Scenario stopped in a governance state that needs an operator decision.",
        expectedOutcome: "The execution moves past review or approval instead of remaining blocked.",
        targetType: "execution",
        targetId: executionId,
        commandHint: executionId ? `npm run orchestrator:history -- --execution ${executionId}` : null,
        httpHint: executionId ? `/executions/${encodeURIComponent(executionId)}/history` : null,
        priority: "high"
      })
    ];
  }
  if (failure.code === "timeout_or_stall") {
    return [
      buildSuggestion("inspect-execution-history", {
        reason: "Scenario stalled or held before it reached a settled success state.",
        expectedOutcome: "The operator can see whether the next action is resume, resolve-escalation, or rerun.",
        targetType: "execution",
        targetId: executionId,
        commandHint: executionId ? `npm run orchestrator:history -- --execution ${executionId}` : null,
        httpHint: executionId ? `/executions/${encodeURIComponent(executionId)}/history` : null,
        priority: "high"
      }),
      buildSuggestion("rerun-scenario", {
        reason: "Retry the named scenario after resolving the blocking cause.",
        expectedOutcome: "A fresh durable scenario run is created for comparison.",
        targetType: "scenario-run",
        targetId: run?.id ?? null,
        commandHint: run?.id ? `npm run orchestrator:scenario-rerun -- --run ${run.id}` : null,
        httpHint: run?.id ? `/scenario-runs/${encodeURIComponent(run.id)}/rerun` : null,
        priority: "medium"
      })
    ];
  }
  if (failure.infrastructure) {
    return [
      buildSuggestion("inspect-runtime", {
        reason: "The failure looks like runtime or launcher infrastructure, not domain logic.",
        expectedOutcome: "The operator can isolate the infrastructure fault before re-running the scenario.",
        targetType: "scenario-run",
        targetId: run?.id ?? null,
        commandHint: run?.id ? `npm run orchestrator:scenario-run-artifacts -- --run ${run.id}` : null,
        httpHint: run?.id ? `/scenario-runs/${encodeURIComponent(run.id)}/artifacts` : null,
        priority: "high"
      }),
      buildSuggestion("rerun-scenario", {
        reason: "Re-run the scenario after fixing runtime or gateway setup issues.",
        expectedOutcome: "The next run confirms whether the failure was transient infrastructure noise.",
        targetType: "scenario-run",
        targetId: run?.id ?? null,
        commandHint: run?.id ? `npm run orchestrator:scenario-rerun -- --run ${run.id}` : null,
        httpHint: run?.id ? `/scenario-runs/${encodeURIComponent(run.id)}/rerun` : null,
        priority: "medium"
      })
    ];
  }
  return [
    buildSuggestion("inspect-execution-history", {
      reason: "The scenario failed in execution logic or assertions.",
      expectedOutcome: "The operator can inspect the exact execution timeline and policy context before re-running.",
      targetType: "execution",
      targetId: executionId,
      commandHint: executionId ? `npm run orchestrator:history -- --execution ${executionId}` : null,
      httpHint: executionId ? `/executions/${encodeURIComponent(executionId)}/history` : null,
      priority: "medium"
    }),
    buildSuggestion("rerun-scenario", {
      reason: "Run the named scenario again after applying a fix or operator decision.",
      expectedOutcome: "A new scenario run record is created with comparable artifacts and trend impact.",
      targetType: "scenario-run",
      targetId: run?.id ?? null,
      commandHint: run?.id ? `npm run orchestrator:scenario-rerun -- --run ${run.id}` : null,
      httpHint: run?.id ? `/scenario-runs/${encodeURIComponent(run.id)}/rerun` : null,
      priority: "medium"
    })
  ];
}

function buildRegressionSuggestedActions(run, items = []) {
  const classifications = sortCountEntries(summarizeClassificationCounts(items));
  const top = classifications[0]?.code ?? null;
  const failureCount = items.filter((item) => item.status === "failed").length;
  if (!top || failureCount === 0) {
    return [];
  }
  if (isInfrastructureFailure(top)) {
    return [
      buildSuggestion("inspect-regression-report", {
        reason: "The latest regression failures cluster around infrastructure rather than product logic.",
        expectedOutcome: "The operator can identify whether launcher, runtime, or control surfaces regressed.",
        targetType: "regression-run",
        targetId: run?.id ?? null,
        commandHint: run?.id ? `npm run orchestrator:regression-report -- --run ${run.id}` : null,
        httpHint: run?.id ? `/regression-runs/${encodeURIComponent(run.id)}/report` : null,
        priority: "high"
      }),
      buildSuggestion("rerun-regression", {
        reason: "Retry the regression after fixing the infrastructure issue or confirming it was transient.",
        expectedOutcome: "A fresh durable regression run confirms whether the failure persists.",
        targetType: "regression-run",
        targetId: run?.id ?? null,
        commandHint: run?.id ? `npm run orchestrator:regression-rerun -- --run ${run.id}` : null,
        httpHint: run?.id ? `/regression-runs/${encodeURIComponent(run.id)}/rerun` : null,
        priority: "medium"
      })
    ];
  }
  return [
    buildSuggestion("inspect-regression-report", {
      reason: "The regression contains product-facing or governance failures that need triage.",
      expectedOutcome: "The operator can see which scenarios failed, why, and which artifacts to open next.",
      targetType: "regression-run",
      targetId: run?.id ?? null,
      commandHint: run?.id ? `npm run orchestrator:regression-report -- --run ${run.id}` : null,
      httpHint: run?.id ? `/regression-runs/${encodeURIComponent(run.id)}/report` : null,
      priority: "high"
    }),
    buildSuggestion("rerun-regression", {
      reason: "Re-run the regression after addressing the highest-severity failures.",
      expectedOutcome: "The next regression run updates trends and confirms whether the fixes held.",
      targetType: "regression-run",
      targetId: run?.id ?? null,
      commandHint: run?.id ? `npm run orchestrator:regression-rerun -- --run ${run.id}` : null,
      httpHint: run?.id ? `/regression-runs/${encodeURIComponent(run.id)}/rerun` : null,
      priority: "medium"
    })
  ];
}

function classifyTrendHealth(window) {
  const passRate = window?.passRate;
  if (window?.completedCount === 0 || passRate === null || passRate === undefined) {
    return "unknown";
  }
  if (passRate >= 0.9 && (window.failureStreak ?? 0) === 0) {
    return "stable";
  }
  if (passRate >= 0.6) {
    return "degrading";
  }
  return "failing";
}

function buildTopFailureSummary(items = [], fallbackSource = "regression-item") {
  const classifications = sortCountEntries(summarizeClassificationCounts(items));
  const top = classifications[0] ?? null;
  if (!top) {
    return null;
  }
  const sample = items.find((item) => item?.metadata?.failureClassification === top.code) ?? null;
  return buildFailureDescriptor({
    code: top.code,
    reason: sample?.metadata?.failureReason ?? `${top.count} item(s)`,
    source: sample?.metadata?.failureSource ?? fallbackSource,
    finalState: sample?.metadata?.scenarioStatus ?? sample?.status ?? null
  });
}

function summarizeDurations(runs = []) {
  const durations = runs
    .map((run) => {
      const started = run?.startedAt ? Date.parse(run.startedAt) : NaN;
      const ended = run?.endedAt ? Date.parse(run.endedAt) : NaN;
      return Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null;
    })
    .filter((value) => Number.isFinite(value));
  if (durations.length === 0) {
    return {
      count: 0,
      averageMs: null,
      minMs: null,
      maxMs: null
    };
  }
  return {
    count: durations.length,
    averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations)
  };
}

function extractRunFailureCode(run) {
  return (
    run?.metadata?.failureSummary?.code ??
    run?.metadata?.failure?.code ??
    run?.metadata?.failureClassification ??
    run?.assertionSummary?.failureClassification ??
    null
  );
}

function buildFlakySummary(runs = [], classifier = () => false) {
  const completed = runs.filter((run) => run && run.status !== "running").slice(0, 5);
  if (completed.length < 3) {
    return {
      flaky: false,
      flakyReason: null,
      confidence: "low"
    };
  }

  const normalized = completed.map((run) => {
    const raw = classifier(run);
    if (typeof raw === "boolean") {
      return {
        succeeded: raw,
        failureCode: extractRunFailureCode(run)
      };
    }
    if (typeof raw === "string" && raw.trim()) {
      return {
        succeeded: raw === "success",
        failureCode: raw
      };
    }
    return {
      succeeded: run?.status === "passed" || isSuccessfulState(run?.status),
      failureCode: extractRunFailureCode(run)
    };
  });
  const statuses = normalized.map((run) => (run.succeeded ? "pass" : "fail"));
  const alternating = statuses.every((value, index) => index === 0 || value !== statuses[index - 1]);
  const failureCodes = Array.from(
    new Set(
      normalized
        .map((run) => run.failureCode)
        .filter((value) => value && value !== "success")
    )
  );
  const durations = summarizeDurations(completed);
  const unstableDurations =
    Number.isFinite(durations.minMs) &&
    Number.isFinite(durations.maxMs) &&
    durations.minMs > 0 &&
    durations.maxMs / durations.minMs >= 3;

  if (alternating) {
    return {
      flaky: true,
      flakyReason: "Recent completed runs alternate between pass and fail.",
      confidence: completed.length >= 5 ? "medium" : "low"
    };
  }
  if (failureCodes.length >= 3) {
    return {
      flaky: true,
      flakyReason: "Recent failures span multiple unrelated classifications.",
      confidence: "medium"
    };
  }
  if (unstableDurations) {
    return {
      flaky: true,
      flakyReason: "Recent run durations vary significantly across the same named flow.",
      confidence: "low"
    };
  }
  return {
    flaky: false,
    flakyReason: null,
    confidence: "low"
  };
}

function buildTrendHealthBuckets(items = []) {
  return items.reduce((accumulator, item) => {
    const key = item?.trendHealth ?? item?.trendSnapshot?.health ?? "unknown";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function decorateRecentScenarioRun(run) {
  const failure = normalizeFailureDescriptor(run?.metadata?.failure ?? run?.metadata?.failureClassification, {
    reason: run?.metadata?.failureReason ?? run?.assertionSummary?.error ?? null,
    source: run?.metadata?.failureSource ?? "scenario-run",
    finalState: run?.status ?? null
  });
  return {
    ...run,
    executionId: run?.metadata?.executionId ?? null,
    failure,
    suggestedActions: buildScenarioSuggestedActions(run)
  };
}

function decorateRecentRegressionRun(run, items = []) {
  return {
    ...run,
    failure: buildTopFailureSummary(items),
    suggestedActions: buildRegressionSuggestedActions(run, items),
    topFailureReasons: sortCountEntries(summarizeClassificationCounts(items)).map((item) => ({
      ...item,
      label: humanizeClassification(item.code),
      severity: classificationSeverity(item.code)
    })),
    reportPaths: run?.metadata?.reports ?? {}
  };
}

function toDurationMs(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return null;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return end - start;
}

function buildLatestReportSummary(run) {
  if (!run?.metadata?.reports) {
    return null;
  }
  return {
    runId: run.id,
    reportPaths: run.metadata.reports,
    generatedAt: run.endedAt ?? run.startedAt ?? run.createdAt ?? null
  };
}

function parseScheduleCadence(cronLike) {
  const value = String(cronLike ?? "").trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "@hourly") {
    return 60 * 60 * 1000;
  }
  if (value === "@daily") {
    return 24 * 60 * 60 * 1000;
  }
  if (value === "@weekly") {
    return 7 * 24 * 60 * 60 * 1000;
  }
  const everyMatch = value.match(/^every-(\d+)([mhd])$/);
  if (!everyMatch) {
    return null;
  }
  const amount = Number.parseInt(everyMatch[1], 10);
  const unit = everyMatch[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (unit === "m") {
    return amount * 60 * 1000;
  }
  if (unit === "h") {
    return amount * 60 * 60 * 1000;
  }
  return amount * 24 * 60 * 60 * 1000;
}

function buildRegressionScheduleStatus(definition, recentRuns = [], now = Date.now()) {
  const schedule = definition?.schedule ?? null;
  if (!schedule?.enabled) {
    return {
      enabled: false,
      due: false,
      reason: "schedule disabled",
      intervalMs: null,
      lastStartedAt: recentRuns[0]?.startedAt ?? null,
      nextDueAt: null,
      skipIfRunActive: Boolean(schedule?.skipIfRunActive)
    };
  }

  const intervalMs = parseScheduleCadence(schedule.cronLike);
  const lastRun = recentRuns[0] ?? null;
  const lastStartedAt = lastRun?.startedAt ?? null;
  const activeRun = recentRuns.find((run) => run.status === "running") ?? null;
  if (activeRun && schedule.skipIfRunActive) {
    return {
      enabled: true,
      due: false,
      reason: "active run already exists",
      intervalMs,
      lastStartedAt,
      nextDueAt: null,
      skipIfRunActive: true
    };
  }

  if (!intervalMs) {
    return {
      enabled: true,
      due: false,
      reason: "unsupported cronLike cadence",
      intervalMs: null,
      lastStartedAt,
      nextDueAt: null,
      skipIfRunActive: Boolean(schedule.skipIfRunActive)
    };
  }

  if (!lastStartedAt) {
    return {
      enabled: true,
      due: true,
      reason: "no prior scheduled run",
      intervalMs,
      lastStartedAt: null,
      nextDueAt: new Date(now).toISOString(),
      skipIfRunActive: Boolean(schedule.skipIfRunActive)
    };
  }

  const nextDueMs = Date.parse(lastStartedAt) + intervalMs;
  return {
    enabled: true,
    due: Number.isFinite(nextDueMs) ? now >= nextDueMs : false,
    reason: Number.isFinite(nextDueMs) && now >= nextDueMs ? "cadence elapsed" : "waiting for next cadence",
    intervalMs,
    lastStartedAt,
    nextDueAt: Number.isFinite(nextDueMs) ? new Date(nextDueMs).toISOString() : null,
    skipIfRunActive: Boolean(schedule.skipIfRunActive)
  };
}

function summarizeFailureBreakdown(items = [], getCode = (item) => extractRunFailureCode(item)) {
  const counts = {};
  for (const item of items) {
    const code = getCode(item);
    if (!code || code === "success") {
      continue;
    }
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return sortCountEntries(counts).map((entry) => ({
    ...entry,
    label: humanizeClassification(entry.code),
    infrastructure: isInfrastructureFailure(entry.code),
    severity: classificationSeverity(entry.code)
  }));
}

function buildDurationSummary(items = []) {
  const durations = items
    .map((item) => {
      const startedAt = item?.startedAt ? Date.parse(item.startedAt) : null;
      const endedAt = item?.endedAt ? Date.parse(item.endedAt) : null;
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
        return null;
      }
      return endedAt - startedAt;
    })
    .filter((value) => Number.isFinite(value));

  if (!durations.length) {
    return {
      count: 0,
      minMs: null,
      maxMs: null,
      averageMs: null
    };
  }

  return {
    count: durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
  };
}

function summarizeClassificationCounts(items = [], key = "failureClassification") {
  return items.reduce((accumulator, item) => {
    const classification = item?.metadata?.[key] ?? item?.[key] ?? null;
    if (!classification || classification === "success") {
      return accumulator;
    }
    accumulator[classification] = (accumulator[classification] ?? 0) + 1;
    return accumulator;
  }, {});
}

function sortCountEntries(counts) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => ({ code, count }));
}

function scenarioArtifactPaths(sessionId) {
  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  return {
    transcript: `${base}.transcript.md`,
    piEvents: `${base}.pi-events.jsonl`,
    piSession: `${base}.pi-session.jsonl`,
    rpcStatus: `${base}.rpc-status.json`,
    control: `${base}.control.ndjson`,
    exit: `${base}.exit.json`,
    context: `${base}.context.json`,
    plan: `${base}.plan.json`
  };
}

async function describePath(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      path: path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/"),
      exists: true,
      size: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        path: path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/"),
        exists: false,
        size: 0,
        updatedAt: null
      };
    }
    throw error;
  }
}

async function buildScenarioArtifactSummary(detail) {
  const sessions = detail?.sessions ?? [];
  const result = [];
  for (const item of sessions) {
    const sessionId = item.sessionId;
    const map = scenarioArtifactPaths(sessionId);
    const artifacts = {};
    for (const [name, filePath] of Object.entries(map)) {
      artifacts[name] = await describePath(filePath);
    }
    result.push({
      sessionId,
      executionId: detail?.execution?.id ?? null,
      artifacts
    });
  }
  return result;
}

async function writeRegressionReport(run, items) {
  const reportDir = path.join(PROJECT_ROOT, "artifacts", "regressions");
  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, `${run.id}.summary.json`);
  const mdPath = path.join(reportDir, `${run.id}.summary.md`);
  const topFailureReasons = sortCountEntries(summarizeClassificationCounts(items)).map((item) => ({
    ...item,
    label: humanizeClassification(item.code),
    infrastructure: isInfrastructureFailure(item.code),
    severity: classificationSeverity(item.code)
  }));
  const linkedScenarioRunIds = items.map((item) => item.scenarioRunId).filter(Boolean);
  const linkedExecutionIds = items.map((item) => item.metadata?.executionId).filter(Boolean);
  const linkedSessionIds = items.flatMap((item) => item.metadata?.sessionIds ?? []).filter(Boolean);
  const failureSummary = buildTopFailureSummary(items);
  const suggestedActions = buildRegressionSuggestedActions(run, items);
  const durationSummary = buildDurationSummary(items.map((item) => ({
    startedAt: item.startedAt,
    endedAt: item.endedAt
  })));
  const artifactSummary = {
    retention: run?.metadata?.artifactRetention ?? null,
    reportCount: 2,
    linkedScenarioRuns: linkedScenarioRunIds.length,
    linkedExecutions: linkedExecutionIds.length,
    linkedSessions: linkedSessionIds.length
  };
  const payload = {
    run,
    items,
    topFailureReasons,
    linkedScenarioRunIds,
    linkedExecutionIds,
    linkedSessionIds,
    failureSummary,
    suggestedActions,
    durationSummary,
    artifactSummary,
    realPiUsed: Boolean(run?.metadata?.realPiUsed)
  };
  const markdown = [
    `# Regression Report: ${run.regressionLabel}`,
    "",
    `- Run ID: \`${run.id}\``,
    `- Status: \`${run.status}\``,
    `- Started At: \`${run.startedAt}\``,
    `- Ended At: \`${run.endedAt ?? "-"}\``,
    `- Pass Count: \`${run.summary?.passCount ?? 0}\``,
    `- Fail Count: \`${run.summary?.failCount ?? 0}\``,
    `- Skipped Count: \`${run.summary?.skippedCount ?? 0}\``,
    `- Real PI Used: \`${run.metadata?.realPiUsed ? "yes" : "no"}\``,
    "",
    "## Top Failure Reasons",
    "",
    ...(topFailureReasons.length > 0
      ? topFailureReasons.map((item) => `- \`${item.code}\`: \`${item.count}\``)
      : ["- none"]),
    "",
    "## Items",
    "",
    ...items.map(
      (item) =>
        `- \`${item.scenarioId}\`: \`${item.status}\`${item.metadata?.failureClassification ? ` · \`${item.metadata.failureClassification}\`` : ""}`
    )
  ].join("\n") + "\n";
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    fs.writeFile(mdPath, markdown, "utf8")
  ]);
  return {
    json: path.relative(PROJECT_ROOT, jsonPath).split(path.sep).join("/"),
    markdown: path.relative(PROJECT_ROOT, mdPath).split(path.sep).join("/")
  };
}

function isSuccessfulState(state) {
  return ["completed", "waiting_review", "waiting_approval"].includes(state);
}

function normalizeLauncher(flags = {}) {
  if (flags.stub === true) {
    return "stub";
  }
  return flags.launcher ?? "pi-rpc";
}

function resolveWorkflowPath(definition) {
  const workflow = String(definition.workflow ?? "").trim();
  if (!workflow) {
    throw new Error(`scenario ${definition.id} is missing workflow`);
  }
  return workflow.endsWith(".yaml") ? workflow : `config/workflows/${workflow}.yaml`;
}

function buildScenarioObjective(definition, options = {}) {
  if (options.objective) {
    return options.objective;
  }
  return definition.objectiveTemplate ?? `${definition.label} scenario run.`;
}

function buildAssertionSummary(definition, detail) {
  const stepCount = detail?.steps?.length ?? 0;
  const sessionCount = detail?.sessions?.length ?? 0;
  const finalState = detail?.execution?.state ?? "unknown";
  return {
    scenarioId: definition.id,
    finalState,
    stepCount,
    sessionCount,
    governanceState: ["waiting_review", "waiting_approval"].includes(finalState),
    success: isSuccessfulState(finalState)
  };
}

function summarizeScenarioRun(definition, run, executionLinks = []) {
  const latestFailure = normalizeFailureDescriptor(run?.metadata?.failure ?? run?.metadata?.failureClassification, {
    reason: run?.metadata?.failureReason ?? run?.assertionSummary?.error ?? null,
    source: run?.metadata?.failureSource ?? "scenario-run",
    finalState: run?.status ?? null
  });
  return {
    id: definition.id,
    scenarioId: definition.id,
    label: definition.label,
    workflow: definition.workflow,
    domain: definition.domain,
    roles: definition.roles ?? [],
    realPiEligible: Boolean(definition.realPiEligible),
    latestStatus: run?.status ?? null,
    latestRunId: run?.id ?? null,
    latestFailure,
    latestFailureClassification: latestFailure?.code ?? null,
    latestFailureReason: latestFailure?.reason ?? null,
    latestFailureSource: latestFailure?.source ?? null,
    latestSuggestedActions: run ? buildScenarioSuggestedActions(run) : [],
    latestReport: null,
    latestRun: run,
    latestExecutions: executionLinks,
    latestExecutionIds: executionLinks.map((entry) => entry.executionId).filter(Boolean)
  };
}

function summarizeRegressionRun(definition, run, items = []) {
  const topFailureReasons = sortCountEntries(summarizeClassificationCounts(items)).map((item) => ({
    ...item,
    label: humanizeClassification(item.code),
    infrastructure: isInfrastructureFailure(item.code),
    severity: classificationSeverity(item.code)
  }));
  const latestFailure = buildTopFailureSummary(items);
  return {
    id: definition.id,
    regressionId: definition.id,
    label: definition.label,
    scenarios: definition.scenarios ?? [],
    realPiRequired: Boolean(definition.realPiRequired),
    latestStatus: run?.status ?? null,
    latestRunId: run?.id ?? null,
    latestFailure,
    latestFailureClassification: latestFailure?.code ?? null,
    latestFailureReason: latestFailure?.reason ?? null,
    latestSuggestedActions: run ? buildRegressionSuggestedActions(run, items) : [],
    latestReport: buildLatestReportSummary(run),
    topFailureReasons,
    latestRun: run,
    latestItems: items
  };
}

export async function runScenarioById(scenarioId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    throw new Error(`scenario not found: ${scenarioId}`);
  }

  const startedAt = new Date().toISOString();
  const runId = options.runId ?? createRunId("scenario-run");
  const launcher = normalizeLauncher(options);
  const objective = buildScenarioObjective(definition, options);
  const usesRealPi = launcher !== "stub";
  const scenarioRun = {
    id: runId,
    scenarioId: definition.id,
      scenarioLabel: definition.label,
      workflowId: definition.workflow,
      workflowPath: resolveWorkflowPath(definition),
    domainId: definition.domain,
    launcher,
    usesRealPi,
    requestedBy: options.by ?? "operator",
    triggerSource: options.source ?? "cli",
    objective,
    status: "running",
    assertionSummary: {},
    metadata: {
      roles: definition.roles ?? [],
      expectedGovernance: definition.expectedGovernance ?? null,
      expectedWaveTopology: definition.expectedWaveTopology ?? null,
      policyPackExpectation: definition.policyPackExpectation ?? null,
      regressionProfiles: definition.regressionProfiles ?? [],
      tags: definition.tags ?? []
    },
    createdAt: startedAt,
    startedAt,
    endedAt: null
  };

  withDatabase(dbPath, (db) => insertScenarioRun(db, scenarioRun));

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: scenarioRun.workflowPath,
      projectPath: options.project ?? "config/projects/example-project.yaml",
      domainId: definition.domain,
      roles: definition.roles ?? null,
      maxRoles: Math.max(1, (definition.roles ?? []).length || Number.parseInt(String(options.maxRoles ?? "1"), 10)),
      invocationId: options.invocationId ?? `${definition.id}-${Date.now()}`,
      objective,
      coordinationGroupId: options.coordinationGroupId ?? null,
      parentExecutionId: options.parentExecutionId ?? null,
      branchKey: options.branchKey ?? null
    });

    createExecution(invocation, dbPath);
    const detail = await driveExecution(invocation.invocationId, {
      wait: options.wait !== false,
      timeoutMs: options.timeoutMs ?? options.timeout ?? "180000",
      intervalMs: options.intervalMs ?? options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub === true,
      launcher: options.launcher ?? null,
      stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? null,
      stepHardTimeoutMs: options.stepHardTimeoutMs ?? null
    }, dbPath);

    const settledDetail = getExecutionDetail(invocation.invocationId, dbPath);
    const classification = classifyScenarioOutcome(
      {
        ...scenarioRun,
        status: settledDetail?.execution?.state ?? detail?.execution?.state ?? "completed"
      },
      settledDetail ?? detail
    );
    const assertionSummary = {
      ...buildAssertionSummary(definition, settledDetail ?? detail),
      failureClassification: classification.code
    };
    const artifactSummary = await buildScenarioArtifactSummary(settledDetail ?? detail);
    const endedAt = new Date().toISOString();
    const settledRun = {
      ...scenarioRun,
      status: settledDetail?.execution?.state ?? detail?.execution?.state ?? "completed",
      assertionSummary,
      metadata: {
        ...scenarioRun.metadata,
        executionId: invocation.invocationId,
        coordinationGroupId: invocation.coordination.groupId,
        branchKey: invocation.coordination.branchKey,
        projectPath: options.project ?? "config/projects/example-project.yaml",
        artifactSummary,
        failureClassification: classification.code,
        failureReason: classification.reason,
        failureSource: "scenario-run",
        failure: buildFailureDescriptor({
          code: classification.code,
          reason: classification.reason,
          source: "scenario-run",
          finalState: settledDetail?.execution?.state ?? detail?.execution?.state ?? "completed"
        })
      },
      endedAt
    };

    withDatabase(dbPath, (db) => {
      updateScenarioRun(db, settledRun);
      insertScenarioRunExecution(db, {
        id: createRunId("scenario-exec"),
        scenarioRunId: runId,
        executionId: invocation.invocationId,
        sessionCount: settledDetail?.sessions?.length ?? 0,
        metadata: {
          executionState: settledDetail?.execution?.state ?? null,
          sessionIds: (settledDetail?.sessions ?? []).map((entry) => entry.sessionId)
        },
        createdAt: endedAt
      });
    });

    return {
      scenario: definition,
      run: settledRun,
      execution: settledDetail ?? detail
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const failedRun = {
      ...scenarioRun,
      status: "failed",
      assertionSummary: {
        success: false,
        error: error.message,
        failureClassification: classifyFailureFromMessage(error.message) ?? "scenario_assertion_failure"
      },
      metadata: {
        ...scenarioRun.metadata,
        error: error.message,
        failureClassification: classifyFailureFromMessage(error.message) ?? "scenario_assertion_failure",
        failureReason: error.message,
        failureSource: "scenario-run",
        failure: buildFailureDescriptor({
          code: classifyFailureFromMessage(error.message) ?? "scenario_assertion_failure",
          reason: error.message,
          source: "scenario-run",
          finalState: "failed"
        })
      },
      endedAt
    };
    withDatabase(dbPath, (db) => updateScenarioRun(db, failedRun));
    throw error;
  }
}

export async function listScenarioSummaries(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definitions = await listScenarioDefinitions();
  return withDatabase(dbPath, (db) =>
    definitions.map((definition) => {
      const recentRuns = listScenarioRuns(db, definition.id, 25);
      const latestRun = recentRuns[0] ?? null;
      const executionLinks = latestRun ? listScenarioRunExecutions(db, latestRun.id) : [];
      const trendPayload = buildTrendPayload(
        definition.id,
        "scenario",
        recentRuns,
        (run) => isSuccessfulState(run.status)
      );
      const flaky = buildFlakySummary(
        recentRuns,
        (run) => run?.metadata?.failureClassification ?? (isSuccessfulState(run?.status) ? "success" : run?.status)
      );
      return {
        ...summarizeScenarioRun(definition, latestRun, executionLinks),
        latestSuccessfulRun: recentRuns.find((run) => isSuccessfulState(run.status)) ?? null,
        latestFailingRun: recentRuns.find((run) => !isSuccessfulState(run.status)) ?? null,
        trendSnapshot: trendPayload.windows.last10,
        trendHealth: classifyTrendHealth(trendPayload.windows.last10),
        flaky
      };
    })
  );
}

export async function getScenarioSummary(scenarioId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const recentRuns = listScenarioRuns(db, definition.id, 25);
    const latestRun = recentRuns[0] ?? null;
    const executionLinks = latestRun ? listScenarioRunExecutions(db, latestRun.id) : [];
    const trendPayload = buildTrendPayload(
      definition.id,
      "scenario",
      recentRuns,
      (run) => isSuccessfulState(run.status)
    );
    const flaky = buildFlakySummary(
      recentRuns,
      (run) => run?.metadata?.failureClassification ?? (isSuccessfulState(run?.status) ? "success" : run?.status)
    );
    return {
      ...summarizeScenarioRun(definition, latestRun, executionLinks),
      latestSuccessfulRun: recentRuns.find((run) => isSuccessfulState(run.status)) ?? null,
      latestFailingRun: recentRuns.find((run) => !isSuccessfulState(run.status)) ?? null,
      trendSnapshot: trendPayload.windows.last10,
      trendHealth: classifyTrendHealth(trendPayload.windows.last10),
      flaky
    };
  });
}

export async function listScenarioHistory(scenarioId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 20) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const runs = listScenarioRuns(db, scenarioId, limit).map((run) => ({
      ...run,
      executions: listScenarioRunExecutions(db, run.id)
    }));
    return {
      scenario: definition,
      runs
    };
  });
}

export async function runRegressionById(regressionId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    throw new Error(`regression not found: ${regressionId}`);
  }

  const startedAt = new Date().toISOString();
  const runId = options.runId ?? createRunId("regression-run");
  const regressionRun = {
    id: runId,
    regressionId: definition.id,
    regressionLabel: definition.label,
    requestedBy: options.by ?? "operator",
    triggerSource: options.source ?? "cli",
    realPiRequired: Boolean(definition.realPiRequired),
    status: "running",
    summary: {},
    metadata: {
      scenarios: definition.scenarios ?? [],
      timeoutMs: definition.timeoutMs ?? null,
      concurrency: definition.concurrency ?? 1,
      stopOnFailure: Boolean(definition.stopOnFailure),
      artifactRetention: definition.artifactRetention ?? "local"
    },
    createdAt: startedAt,
    startedAt,
    endedAt: null
  };

  withDatabase(dbPath, (db) => insertRegressionRun(db, regressionRun));

  const items = [];
  let passCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const scenarioId of definition.scenarios ?? []) {
    const itemId = createRunId("regression-item");
    const itemStartedAt = new Date().toISOString();
    const item = {
      id: itemId,
      regressionRunId: runId,
      scenarioId,
      scenarioRunId: null,
      status: "running",
      metadata: {},
      createdAt: itemStartedAt,
      startedAt: itemStartedAt,
      endedAt: null
    };
    withDatabase(dbPath, (db) => insertRegressionRunItem(db, item));

    try {
      const result = await runScenarioById(scenarioId, {
        ...options,
        source: "regression",
        by: options.by ?? "operator"
      }, dbPath);
      const finalStatus = isSuccessfulState(result.run.status) ? "passed" : "failed";
      if (finalStatus === "passed") {
        passCount += 1;
      } else {
        failCount += 1;
      }
      const updatedItem = {
        ...item,
        scenarioRunId: result.run.id,
        status: finalStatus,
        metadata: {
          executionId: result.execution?.execution?.id ?? null,
          executionState: result.execution?.execution?.state ?? null,
          scenarioStatus: result.run.status,
          launcher: result.run.launcher ?? null,
          sessionIds: (result.execution?.sessions ?? []).map((entry) => entry.sessionId).filter(Boolean),
          failureClassification: result.run.metadata?.failureClassification ?? null,
          failureReason: result.run.metadata?.failureReason ?? null,
          failureSource: result.run.metadata?.failureSource ?? "scenario-run",
          failure: normalizeFailureDescriptor(result.run.metadata?.failure, {
            code: result.run.metadata?.failureClassification ?? null,
            reason: result.run.metadata?.failureReason ?? null,
            source: result.run.metadata?.failureSource ?? "scenario-run",
            finalState: result.run.status
          })
        },
        endedAt: new Date().toISOString()
      };
      withDatabase(dbPath, (db) => updateRegressionRunItem(db, updatedItem));
      items.push(updatedItem);
      if (definition.stopOnFailure && finalStatus === "failed") {
        break;
      }
    } catch (error) {
      failCount += 1;
      const updatedItem = {
        ...item,
        status: "failed",
        metadata: {
          error: error.message,
          failureClassification: classifyFailureFromMessage(error.message) ?? "scenario_assertion_failure",
          failureReason: error.message,
          failureSource: "regression-item",
          failure: buildFailureDescriptor({
            code: classifyFailureFromMessage(error.message) ?? "scenario_assertion_failure",
            reason: error.message,
            source: "regression-item",
            finalState: "failed"
          })
        },
        endedAt: new Date().toISOString()
      };
      withDatabase(dbPath, (db) => updateRegressionRunItem(db, updatedItem));
      items.push(updatedItem);
      if (definition.stopOnFailure) {
        break;
      }
    }
  }

  const processedScenarioIds = new Set(items.map((item) => item.scenarioId));
  for (const scenarioId of definition.scenarios ?? []) {
    if (!processedScenarioIds.has(scenarioId)) {
      skippedCount += 1;
    }
  }

  const endedAt = new Date().toISOString();
  const finalStatus = failCount > 0 ? "failed" : "passed";
  const summary = {
    passCount,
    failCount,
    skippedCount,
    scenarioCount: (definition.scenarios ?? []).length
  };
  const settledRun = {
    ...regressionRun,
    status: finalStatus,
    summary,
    metadata: {
      ...regressionRun.metadata,
      processedScenarioIds: items.map((item) => item.scenarioId),
      realPiUsed: options.stub !== true,
      failureSummary: buildTopFailureSummary(items),
      suggestedActions: buildRegressionSuggestedActions(regressionRun, items)
    },
    endedAt
  };
  const reportPaths = await writeRegressionReport(settledRun, items);
  settledRun.metadata = {
    ...settledRun.metadata,
    reports: reportPaths
  };
  withDatabase(dbPath, (db) => updateRegressionRun(db, settledRun));

  return {
    regression: definition,
    run: settledRun,
    items
  };
}

export async function listRegressionSummaries(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definitions = await listRegressionDefinitions();
  return withDatabase(dbPath, (db) =>
    definitions.map((definition) => {
      const recentRuns = listRegressionRuns(db, definition.id, 25);
      const latestRun = recentRuns[0] ?? null;
      const items = latestRun ? listRegressionRunItems(db, latestRun.id) : [];
      const trendPayload = buildTrendPayload(
        definition.id,
        "regression",
        recentRuns,
        (run) => run.status === "passed"
      );
      const flaky = buildFlakySummary(
        recentRuns,
        (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
      );
      return {
        ...summarizeRegressionRun(definition, latestRun, items),
        latestSuccessfulRun: recentRuns.find((run) => run.status === "passed") ?? null,
        latestFailingRun: recentRuns.find((run) => run.status !== "passed") ?? null,
        trendSnapshot: trendPayload.windows.last10,
        trendHealth: classifyTrendHealth(trendPayload.windows.last10),
        flaky,
        scheduleStatus: buildRegressionScheduleStatus(definition, recentRuns)
      };
    })
  );
}

export async function getRegressionSummary(regressionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const recentRuns = listRegressionRuns(db, regressionId, 25);
    const latestRun = recentRuns[0] ?? null;
    const items = latestRun ? listRegressionRunItems(db, latestRun.id) : [];
    const trendPayload = buildTrendPayload(
      definition.id,
      "regression",
      recentRuns,
      (run) => run.status === "passed"
    );
    const flaky = buildFlakySummary(
      recentRuns,
      (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
    );
    return {
      ...summarizeRegressionRun(definition, latestRun, items),
      latestSuccessfulRun: recentRuns.find((run) => run.status === "passed") ?? null,
      latestFailingRun: recentRuns.find((run) => run.status !== "passed") ?? null,
      trendSnapshot: trendPayload.windows.last10,
      trendHealth: classifyTrendHealth(trendPayload.windows.last10),
      flaky,
      scheduleStatus: buildRegressionScheduleStatus(definition, recentRuns)
    };
  });
}

export async function listRegressionHistory(regressionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 20) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const runs = listRegressionRuns(db, regressionId, limit).map((run) => ({
      ...run,
      items: listRegressionRunItems(db, run.id)
    }));
    return {
      regression: definition,
      runs
    };
  });
}

export function getScenarioRunDetail(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) => {
    const run = getScenarioRun(db, runId);
    if (!run) {
      return null;
    }
    return {
      run,
      executions: listScenarioRunExecutions(db, runId)
    };
  });
}

export async function getScenarioRunSummaryById(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getScenarioRunDetail(runId, dbPath);
  if (!detail) {
    return null;
  }
  const scenario = await getScenarioDefinition(detail.run.scenarioId);
  const failure = normalizeFailureDescriptor(detail.run.metadata?.failure ?? detail.run.metadata?.failureClassification, {
    reason: detail.run.metadata?.failureReason ?? detail.run.assertionSummary?.error ?? null,
    source: detail.run.metadata?.failureSource ?? "scenario-run",
    finalState: detail.run.status
  });
  return {
    scenario,
    ...detail,
    failure,
    suggestedActions: buildScenarioSuggestedActions(detail.run)
  };
}

export async function getScenarioRunArtifacts(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getScenarioRunDetail(runId, dbPath);
  if (!detail) {
    return null;
  }
  const executionArtifacts = [];
  for (const executionLink of detail.executions) {
    const executionDetail = getExecutionDetail(executionLink.executionId, dbPath);
    executionArtifacts.push({
      executionId: executionLink.executionId,
      sessionCount: executionLink.sessionCount,
      artifacts: await buildScenarioArtifactSummary(executionDetail)
    });
  }
  return {
    run: detail.run,
    executions: executionArtifacts,
    failure: normalizeFailureDescriptor(detail.run.metadata?.failure ?? detail.run.metadata?.failureClassification, {
      reason: detail.run.metadata?.failureReason ?? detail.run.assertionSummary?.error ?? null,
      source: detail.run.metadata?.failureSource ?? "scenario-run",
      finalState: detail.run.status
    }),
    suggestedActions: buildScenarioSuggestedActions(detail.run)
  };
}

function buildTrendWindow(runs, isSuccess) {
  const normalizedRuns = runs
    .filter(Boolean)
    .map((run) => ({
      ...run,
      durationMs:
        run.startedAt && run.endedAt
          ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt))
          : null,
      succeeded: isSuccess(run)
    }));
  const completedRuns = normalizedRuns.filter((run) => run.status !== "running");
  const passCount = completedRuns.filter((run) => run.succeeded).length;
  const failCount = completedRuns.filter((run) => !run.succeeded).length;
  const durations = completedRuns.map((run) => run.durationMs).filter((value) => Number.isFinite(value));
  let failureStreak = 0;
  for (const run of completedRuns) {
    if (run.succeeded) {
      break;
    }
    failureStreak += 1;
  }
  return {
    runCount: normalizedRuns.length,
    completedCount: completedRuns.length,
    passCount,
    failCount,
    passRate: completedRuns.length > 0 ? passCount / completedRuns.length : null,
    averageDurationMs:
      durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    failureStreak,
    latestGreenAt: completedRuns.find((run) => run.succeeded)?.endedAt ?? null,
    latestRedAt: completedRuns.find((run) => !run.succeeded)?.endedAt ?? null,
    health: classifyTrendHealth({
      completedCount: completedRuns.length,
      passRate: completedRuns.length > 0 ? passCount / completedRuns.length : null,
      failureStreak
    })
  };
}

function buildTrendPayload(id, kind, runs, isSuccess, getFailureCode = extractRunFailureCode) {
  const flakySummary = buildFlakySummary(runs, getFailureCode);
  return {
    id,
    kind,
    flakySummary,
    windows: {
      last10: buildTrendWindow(runs.slice(0, 10), isSuccess),
      last25: buildTrendWindow(runs.slice(0, 25), isSuccess),
      allTime: buildTrendWindow(runs, isSuccess)
    }
  };
}

export async function getScenarioTrends(scenarioId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 100) {
  const detail = await listScenarioHistory(scenarioId, dbPath, limit);
  if (!detail) {
    return null;
  }
  const trendPayload = buildTrendPayload(
    scenarioId,
    "scenario",
    detail.runs,
    (run) => isSuccessfulState(run.status),
    (run) => run?.metadata?.failureClassification ?? (isSuccessfulState(run?.status) ? "success" : run?.status)
  );
  return {
    scenario: detail.scenario,
    ...trendPayload,
    flaky: buildFlakySummary(
      detail.runs,
      (run) => run?.metadata?.failureClassification ?? (isSuccessfulState(run?.status) ? "success" : run?.status)
    )
  };
}

export function getRegressionRunDetail(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) => {
    const run = getRegressionRun(db, runId);
    if (!run) {
      return null;
    }
    return {
      run,
      items: listRegressionRunItems(db, runId)
    };
  });
}

export async function getRegressionRunSummaryById(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getRegressionRunDetail(runId, dbPath);
  if (!detail) {
    return null;
  }
  const regression = await getRegressionDefinition(detail.run.regressionId);
  const failure = buildTopFailureSummary(detail.items);
  return {
    regression,
    ...detail,
    failure,
    suggestedActions: buildRegressionSuggestedActions(detail.run, detail.items)
  };
}

export async function getRegressionRunReport(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = await getRegressionRunSummaryById(runId, dbPath);
  if (!detail) {
    return null;
  }
  const history = await listRegressionHistory(detail.run.regressionId, dbPath, 25);
  const reports = detail.run?.metadata?.reports ?? {};
  const normalized = {};
  for (const [name, reportPath] of Object.entries(reports)) {
    normalized[name] = await describePath(path.join(PROJECT_ROOT, reportPath));
  }
  const orderedHistory = history?.runs ?? [];
  const currentIndex = orderedHistory.findIndex((item) => item.id === detail.run.id);
  const previousRun = currentIndex >= 0 ? orderedHistory[currentIndex + 1] ?? null : orderedHistory[1] ?? null;
  const failureClassificationSummary = sortCountEntries(summarizeClassificationCounts(detail.items)).map((item) => ({
    ...item,
    label: humanizeClassification(item.code),
    infrastructure: isInfrastructureFailure(item.code),
    severity: classificationSeverity(item.code)
  }));
  return {
    ...detail,
    reports: normalized,
    topFailureReasons: failureClassificationSummary,
    failureClassificationSummary,
    linkedScenarioRunIds: detail.items.map((item) => item.scenarioRunId).filter(Boolean),
    linkedExecutionIds: detail.items.map((item) => item.metadata?.executionId).filter(Boolean),
    linkedSessionIds: detail.items.flatMap((item) => item.metadata?.sessionIds ?? []).filter(Boolean),
    failureSummary: buildTopFailureSummary(detail.items),
    suggestedActions: buildRegressionSuggestedActions(detail.run, detail.items),
    durationSummary: buildDurationSummary(detail.items),
    artifactSummary: {
      retention: detail.run?.metadata?.artifactRetention ?? null,
      reportCount: Object.keys(reports).length,
      linkedScenarioRuns: detail.items.map((item) => item.scenarioRunId).filter(Boolean).length,
      linkedExecutions: detail.items.map((item) => item.metadata?.executionId).filter(Boolean).length,
      linkedSessions: detail.items.flatMap((item) => item.metadata?.sessionIds ?? []).filter(Boolean).length
    },
    realPiUsed: Boolean(detail.run?.metadata?.realPiUsed),
    trendSnapshot: buildTrendPayload(
      detail.run.regressionId,
      "regression",
      orderedHistory,
      (run) => run.status === "passed",
      (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
    ).windows.last10,
    flaky: buildFlakySummary(
      orderedHistory,
      (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
    ),
    previousRunId: previousRun?.id ?? null,
    previousReportPaths: previousRun?.metadata?.reports ?? {},
    links: {
      regression: `/regressions/${encodeURIComponent(detail.run.regressionId)}`,
      regressionRuns: `/regressions/${encodeURIComponent(detail.run.regressionId)}/runs`,
      regressionTrends: `/regressions/${encodeURIComponent(detail.run.regressionId)}/trends`,
      latestReport: `/regressions/${encodeURIComponent(detail.run.regressionId)}/latest-report`,
      run: `/regression-runs/${encodeURIComponent(detail.run.id)}`,
      report: `/regression-runs/${encodeURIComponent(detail.run.id)}/report`
    }
  };
}

export async function getRegressionLatestReport(regressionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const summary = await getRegressionSummary(regressionId, dbPath);
  const latestRunId = summary?.latestRun?.id ?? null;
  if (!latestRunId) {
    return null;
  }
  return getRegressionRunReport(latestRunId, dbPath);
}

export async function getRegressionScheduleSummary(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definitions = await listRegressionDefinitions();
  return withDatabase(dbPath, (db) =>
    definitions.map((definition) => {
      const recentRuns = listRegressionRuns(db, definition.id, 25);
      const latestRun = recentRuns[0] ?? null;
      const latestScheduledRun = recentRuns.find((run) => run.triggerSource === "scheduler" || run.requestedBy === "scheduler") ?? null;
      return {
        id: definition.id,
        label: definition.label,
        realPiRequired: Boolean(definition.realPiRequired),
        schedule: definition.schedule ?? null,
        retention: {
          historyRetentionDays: definition.historyRetentionDays ?? null,
          artifactRetention: definition.artifactRetention ?? null,
          retainFailedRuns: definition.retainFailedRuns ?? null
        },
        latestRun,
        latestScheduledRun,
        scheduleStatus: buildRegressionScheduleStatus(definition, recentRuns),
        links: {
          regression: `/regressions/${encodeURIComponent(definition.id)}`,
          latestReport: `/regressions/${encodeURIComponent(definition.id)}/latest-report`,
          trends: `/regressions/${encodeURIComponent(definition.id)}/trends`,
          runs: `/regressions/${encodeURIComponent(definition.id)}/runs`
        }
      };
    })
  );
}

export async function getRegressionSchedulerStatus(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 10) {
  const profiles = await getRegressionScheduleSummary(dbPath);
  const evaluations = withDatabase(dbPath, (db) => listSchedulerEvaluations(db, null, limit));
  return {
    profiles,
    latestEvaluation: evaluations[0] ?? null,
    evaluations
  };
}

export async function runRegressionSchedulerOnce(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const schedule = await getRegressionScheduleSummary(dbPath);
  const due = schedule.filter((item) => item.scheduleStatus?.enabled && item.scheduleStatus?.due);
  if (options.execute !== true) {
    return {
      executed: false,
      evaluatedAt: new Date().toISOString(),
      due,
      schedule
    };
  }

  const started = [];
  for (const item of due) {
    const result = await runRegressionById(
      item.id,
      {
        project: options.project ?? "config/projects/example-project.yaml",
        source: options.source ?? "scheduler",
        by: options.by ?? "scheduler",
        stub: options.stub === true,
        launcher: options.launcher ?? null,
        timeout: options.timeout ?? null,
        interval: options.interval ?? null,
        stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? null,
        stepHardTimeoutMs: options.stepHardTimeoutMs ?? null
      },
      dbPath
    );
    started.push({
      regressionId: item.id,
      runId: result.run.id,
      status: result.run.status
    });
  }

  return {
    executed: true,
    evaluatedAt: new Date().toISOString(),
    due,
    started,
    schedule
  };
}

export async function runRegressionScheduler(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definitions = await listRegressionDefinitions();
  const selectedId = String(options.regressionId ?? "").trim() || null;
  const dueOnly = options.dueOnly !== false;
  const dryRun = options.dryRun === true;
  const now = Date.now();
  const evaluation = {
    id: createRunId("scheduler-eval"),
    regressionId: selectedId,
    requestedBy: options.by ?? "scheduler",
    triggerSource: options.source ?? "scheduler",
    dryRun,
    dueOnly,
    maxRuns: Number.parseInt(String(options.maxRuns ?? "1"), 10) || 1,
    status: "running",
    summary: {},
    metadata: {},
    createdAt: new Date(now).toISOString(),
    startedAt: new Date(now).toISOString(),
    endedAt: null
  };
  withDatabase(dbPath, (db) => insertSchedulerEvaluation(db, evaluation));

  const candidates = withDatabase(dbPath, (db) =>
    definitions
      .filter((definition) => !selectedId || definition.id === selectedId)
      .map((definition) => {
        const recentRuns = listRegressionRuns(db, definition.id, 25);
        return {
          definition,
          recentRuns,
          scheduleStatus: buildRegressionScheduleStatus(definition, recentRuns, now)
        };
      })
  );

  const runnable = candidates.filter((entry) => !dueOnly || entry.scheduleStatus.due);
  const maxRuns = Number.parseInt(String(options.maxRuns ?? "1"), 10);
  const limit = Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : 1;
  const executedRuns = [];

  if (!dryRun) {
    for (const entry of runnable.slice(0, limit)) {
      const result = await runRegressionById(
        entry.definition.id,
        {
          project: options.project ?? "config/projects/example-project.yaml",
          timeout: options.timeout ?? entry.definition.timeoutMs ?? "180000",
          interval: options.interval ?? "1500",
          noMonitor: options.noMonitor === true,
          stub: options.stub === true,
          launcher: options.launcher ?? null,
          source: options.source ?? "scheduler",
          by: options.by ?? "scheduler",
          stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? null,
          stepHardTimeoutMs: options.stepHardTimeoutMs ?? null
        },
        dbPath
      );
      executedRuns.push({
        regressionId: entry.definition.id,
        runId: result.run.id,
        status: result.run.status,
        startedAt: result.run.startedAt,
        endedAt: result.run.endedAt
      });
    }
  }
  const detail = {
    now: new Date(now).toISOString(),
    dryRun,
    dueOnly,
    candidates: candidates.map((entry) => ({
      regressionId: entry.definition.id,
      label: entry.definition.label,
      schedule: entry.definition.schedule ?? null,
      scheduleStatus: entry.scheduleStatus,
      latestRunId: entry.recentRuns[0]?.id ?? null,
      latestRunStatus: entry.recentRuns[0]?.status ?? null
    })),
    executedRuns
  };
  const settledEvaluation = {
    ...evaluation,
    status: "completed",
    summary: {
      candidateCount: detail.candidates.length,
      dueCount: runnable.length,
      executedCount: executedRuns.length
    },
    metadata: {
      selectedRegressionId: selectedId,
      executedRuns,
      candidates: detail.candidates,
      now: detail.now
    },
    endedAt: new Date().toISOString()
  };
  withDatabase(dbPath, (db) => updateSchedulerEvaluation(db, settledEvaluation));
  return {
    ...detail,
    evaluation: withDatabase(dbPath, (db) => getSchedulerEvaluation(db, settledEvaluation.id))
  };
}

export async function getRegressionTrends(regressionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 100) {
  const detail = await listRegressionHistory(regressionId, dbPath, limit);
  if (!detail) {
    return null;
  }
  const trendPayload = buildTrendPayload(
    regressionId,
    "regression",
    detail.runs,
    (run) => run.status === "passed",
    (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
  );
  return {
    regression: detail.regression,
    ...trendPayload,
    flaky: buildFlakySummary(
      detail.runs,
      (run) => run?.metadata?.failureSummary?.code ?? (run?.status === "passed" ? "success" : run?.status)
    ),
    scheduleStatus: buildRegressionScheduleStatus(detail.regression, detail.runs),
    recentRuns: detail.runs.slice(0, 5).map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      failure: normalizeFailureDescriptor(run?.metadata?.failureSummary, {
        reason: run?.metadata?.failureSummary?.reason ?? null,
        source: run?.metadata?.failureSummary?.source ?? "regression-run",
        finalState: run.status
      }),
      passCount: run.summary?.passCount ?? 0,
      failCount: run.summary?.failCount ?? 0,
      skippedCount: run.summary?.skippedCount ?? 0
    })),
    failureBreakdown: summarizeFailureBreakdown(detail.runs),
    latestFailure: normalizeFailureDescriptor(
      detail.runs.find((run) => run.status !== "passed")?.metadata?.failureSummary,
      {
        reason: detail.runs.find((run) => run.status !== "passed")?.metadata?.failureSummary?.reason ?? null,
        source: "regression-trend",
        finalState: detail.runs.find((run) => run.status !== "passed")?.status ?? null
      }
    ),
    links: {
      regression: `/regressions/${encodeURIComponent(regressionId)}`,
      latestReport: `/regressions/${encodeURIComponent(regressionId)}/latest-report`,
      runs: `/regressions/${encodeURIComponent(regressionId)}/runs`
    }
  };
}

export async function rerunScenarioRun(runId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getScenarioRunDetail(runId, dbPath);
  if (!detail) {
    return null;
  }
  const inherited = detail.run ?? {};
  return runScenarioById(
    inherited.scenarioId,
    {
      project: options.project ?? inherited.metadata?.projectPath ?? "config/projects/example-project.yaml",
      wait: options.wait !== undefined ? options.wait : true,
      timeout: options.timeout ?? "180000",
      interval: options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub === true,
      launcher: options.launcher ?? inherited.launcher ?? null,
      objective: options.objective ?? inherited.objective ?? null,
      source: options.source ?? "rerun",
      by: options.by ?? "operator",
      stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? null,
      stepHardTimeoutMs: options.stepHardTimeoutMs ?? null,
      runId: options.runId ?? undefined
    },
    dbPath
  ).then((result) => {
    const updatedRun = {
      ...result.run,
      metadata: {
        ...result.run.metadata,
        rerunOf: runId,
        rerunReason: options.reason ?? "operator rerun"
      }
    };
    withDatabase(dbPath, (db) => updateScenarioRun(db, updatedRun));
    return {
      ...result,
      rerunOf: runId,
      run: updatedRun
    };
  });
}

export async function rerunRegressionRun(runId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getRegressionRunDetail(runId, dbPath);
  if (!detail) {
    return null;
  }
  const inherited = detail.run ?? {};
  return runRegressionById(
    inherited.regressionId,
    {
      project: options.project ?? "config/projects/example-project.yaml",
      timeout: options.timeout ?? "180000",
      interval: options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub === true,
      launcher: options.launcher ?? null,
      source: options.source ?? "rerun",
      by: options.by ?? "operator",
      stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? null,
      stepHardTimeoutMs: options.stepHardTimeoutMs ?? null,
      runId: options.runId ?? undefined
    },
    dbPath
  ).then((result) => {
    const updatedRun = {
      ...result.run,
      metadata: {
        ...result.run.metadata,
        rerunOf: runId,
        rerunReason: options.reason ?? "operator rerun"
      }
    };
    withDatabase(dbPath, (db) => updateRegressionRun(db, updatedRun));
    return {
      ...result,
      rerunOf: runId,
      run: updatedRun
    };
  });
}

export async function getRunCenterSummary(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, limit = 10) {
  const [scenarios, regressions] = await Promise.all([
    listScenarioSummaries(dbPath),
    listRegressionSummaries(dbPath)
  ]);

  const recent = withDatabase(dbPath, (db) => ({
    recentScenarioRuns: listScenarioRuns(db, null, limit),
    recentRegressionRuns: listRegressionRuns(db, null, limit),
    workItems: listWorkItems(db, null, limit * 2),
    proposals: listProposalArtifacts(db, null, limit),
    workItemRunsByItem: Object.fromEntries(
      listWorkItems(db, null, limit * 2).map((item) => [item.id, listWorkItemRuns(db, item.id, 5)])
    )
  }));
  const scenarioById = new Map(scenarios.map((item) => [item.scenarioId, item]));
  const regressionById = new Map(regressions.map((item) => [item.regressionId, item]));

  const scenarioFailureBreakdown = summarizeFailureBreakdown(
    scenarios.map((item) => item.latestRun).filter(Boolean)
  );
  const regressionFailureBreakdown = summarizeFailureBreakdown(
    regressions.map((item) => item.latestRun).filter(Boolean)
  );
  const trendBreakdown = {
    stableScenarios: scenarios.filter((item) => item.trendHealth === "stable").length,
    degradingScenarios: scenarios.filter((item) => item.trendHealth === "degrading").length,
    failingScenarios: scenarios.filter((item) => item.trendHealth === "failing").length,
    stableRegressions: regressions.filter((item) => item.trendHealth === "stable").length,
    degradingRegressions: regressions.filter((item) => item.trendHealth === "degrading").length,
    failingRegressions: regressions.filter((item) => item.trendHealth === "failing").length
  };
  const flaky = {
    scenarios: scenarios
      .filter((item) => item.trendSnapshot?.flaky || item.trendSnapshot?.flakySummary?.flaky || item.flakySummary?.flaky)
      .map((item) => ({
        id: item.scenarioId,
        label: item.label,
        flakyReason: item.flakySummary?.flakyReason ?? item.trendSnapshot?.flakyReason ?? null
      })),
    regressions: regressions
      .filter((item) => item.trendSnapshot?.flaky || item.trendSnapshot?.flakySummary?.flaky || item.flakySummary?.flaky)
      .map((item) => ({
        id: item.regressionId,
        label: item.label,
        flakyReason: item.flakySummary?.flakyReason ?? item.trendSnapshot?.flakyReason ?? null
      }))
  };
  const latestReports = regressions
    .filter((item) => item.latestRun?.metadata?.reports)
    .slice(0, limit)
    .map((item) => ({
      regressionId: item.regressionId,
      label: item.label,
      runId: item.latestRunId,
      status: item.latestStatus ?? item.latestRun?.status ?? null,
      endedAt: item.latestRun?.endedAt ?? item.latestRun?.startedAt ?? null,
      reports: item.latestRun?.metadata?.reports ?? {},
      reportPaths: Object.values(item.latestRun?.metadata?.reports ?? {}).filter(Boolean),
      failure: item.latestFailure ?? null,
      suggestedActions: item.latestSuggestedActions ?? [],
      links: {
        regression: `/regressions/${encodeURIComponent(item.regressionId)}`,
        latestReport: `/regressions/${encodeURIComponent(item.regressionId)}/latest-report`,
        report: item.latestRunId ? `/regression-runs/${encodeURIComponent(item.latestRunId)}/report` : null,
        run: item.latestRunId ? `/regression-runs/${encodeURIComponent(item.latestRunId)}` : null
      }
    }));

  const severityRank = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4
  };
  const alerts = [
    ...scenarios
      .filter((item) => item.latestFailure?.failed)
      .map((item) => ({
        kind: "scenario",
        id: item.scenarioId,
        label: item.label,
        title: item.label,
        detail: item.latestFailure?.reason ?? null,
        source: item.latestFailure?.source ?? "scenario",
        severity: item.latestFailure?.severity ?? "medium",
        latestRunId: item.latestRunId,
        latestStatus: item.latestStatus,
        failure: item.latestFailure,
        trendHealth: item.trendHealth ?? item.trendSnapshot?.health ?? "unknown"
      })),
    ...regressions
      .filter((item) => item.latestFailure?.failed)
      .map((item) => ({
        kind: "regression",
        id: item.regressionId,
        label: item.label,
        title: item.label,
        detail: item.latestFailure?.reason ?? null,
        source: item.latestFailure?.source ?? "regression",
        severity: item.latestFailure?.severity ?? "medium",
        latestRunId: item.latestRunId,
        latestStatus: item.latestStatus,
        failure: item.latestFailure,
        trendHealth: item.trendHealth ?? item.trendSnapshot?.health ?? "unknown"
      }))
  ]
    .sort((left, right) => {
      const severityDelta =
        (severityRank[left.failure?.severity ?? "medium"] ?? 99) -
        (severityRank[right.failure?.severity ?? "medium"] ?? 99);
      return severityDelta || String(left.label).localeCompare(String(right.label));
    })
    .slice(0, limit);

  const recommendations = Array.from(
    new Map(
      [
        ...scenarios.flatMap((item) => item.latestSuggestedActions ?? []),
        ...regressions.flatMap((item) => item.latestSuggestedActions ?? [])
      ].map((action) => [`${action.action}:${action.targetType}:${action.targetId}:${action.reason}`, action])
    ).values()
  )
    .slice(0, limit)
    .map((action) => ({
      ...action,
      title: humanizeClassification(action.action),
      detail: action.reason,
      source: action.targetType ?? "operator",
      severity: action.priority ?? "medium"
    }));

  const recentScenarioRuns = recent.recentScenarioRuns.map((run) => {
    const scenarioSummary = scenarioById.get(run.scenarioId) ?? null;
    return {
      ...run,
      latestRunId: run.id,
      latestStatus: run.status,
      executionId: run.metadata?.executionId ?? null,
      trendSnapshot: scenarioSummary?.trendSnapshot ?? null,
      trendHealth: scenarioSummary?.trendHealth ?? scenarioSummary?.trendSnapshot?.health ?? "unknown",
      failure: normalizeFailureDescriptor(run.metadata?.failure ?? run.metadata?.failureClassification, {
        reason: run.metadata?.failureReason ?? run.assertionSummary?.error ?? null,
        source: run.metadata?.failureSource ?? "scenario-run",
        finalState: run.status
      }),
      suggestedActions: buildScenarioSuggestedActions(run),
      reportPaths: [],
      links: {
        scenario: `/scenarios/${encodeURIComponent(run.scenarioId)}`,
        trends: `/scenarios/${encodeURIComponent(run.scenarioId)}/trends`,
        run: `/scenario-runs/${encodeURIComponent(run.id)}`,
        artifacts: `/scenario-runs/${encodeURIComponent(run.id)}/artifacts`,
        execution: run.metadata?.executionId ? `/executions/${encodeURIComponent(run.metadata.executionId)}` : null
      }
    };
  });

  const recentRegressionRuns = recent.recentRegressionRuns.map((run) => {
    const regressionSummary = regressionById.get(run.regressionId) ?? null;
    return {
      ...run,
      latestRunId: run.id,
      latestStatus: run.status,
      passCount: run.summary?.passCount ?? 0,
      failCount: run.summary?.failCount ?? 0,
      skippedCount: run.summary?.skippedCount ?? 0,
      trendSnapshot: regressionSummary?.trendSnapshot ?? null,
      trendHealth: regressionSummary?.trendHealth ?? regressionSummary?.trendSnapshot?.health ?? "unknown",
      failure: normalizeFailureDescriptor(run.metadata?.failureSummary ?? regressionSummary?.latestFailure, {
        reason: run.metadata?.failureSummary?.reason ?? regressionSummary?.latestFailureReason ?? null,
        source: run.metadata?.failureSummary?.source ?? "regression-run",
        finalState: run.status
      }),
      suggestedActions: run.metadata?.suggestedActions ?? buildRegressionSuggestedActions(run, []),
      reportPaths: Object.values(run.metadata?.reports ?? {}).filter(Boolean),
      links: {
        regression: `/regressions/${encodeURIComponent(run.regressionId)}`,
        trends: `/regressions/${encodeURIComponent(run.regressionId)}/trends`,
        run: `/regression-runs/${encodeURIComponent(run.id)}`,
        report: `/regression-runs/${encodeURIComponent(run.id)}/report`
      }
    };
  });

  const recentWorkItemRuns = recent.workItems
    .flatMap((item) => (recent.workItemRunsByItem[item.id] ?? []).map((run) => ({ item, run })))
    .sort((left, right) => String(right.run.startedAt ?? "").localeCompare(String(left.run.startedAt ?? "")))
    .slice(0, limit)
    .map(({ item, run }) => ({
      workItemId: item.id,
      runId: run.id,
      title: item.title,
      kind: item.kind,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      suggestedActions: run.metadata?.validation?.status === "completed"
        ? []
        : [
            buildSuggestion("inspect-work-item", {
              reason: `Inspect managed work item ${item.title}.`,
              expectedOutcome: "The operator can review the latest work-item run, proposal, and validation state.",
              targetType: "work-item",
              targetId: item.id,
              commandHint: `npm run orchestrator:work-item-show -- --item ${item.id}`,
              httpHint: `/work-items/${encodeURIComponent(item.id)}`,
              priority: run.status === "blocked" ? "high" : "medium"
            })
          ],
      links: {
        item: `/work-items/${encodeURIComponent(item.id)}`,
        run: `/work-item-runs/${encodeURIComponent(run.id)}`,
        proposal: run.metadata?.proposalArtifactId ? `/proposal-artifacts/${encodeURIComponent(run.metadata.proposalArtifactId)}` : null
      }
    }));

  const selfBuild = {
    workItems: recent.workItems.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      status: item.status,
      lastRunAt: item.lastRunAt,
      priority: item.priority,
      links: {
        self: `/work-items/${encodeURIComponent(item.id)}`
      }
    })),
    recentWorkItemRuns,
    proposals: recent.proposals.map((artifact) => ({
      id: artifact.id,
      workItemId: artifact.workItemId,
      workItemRunId: artifact.workItemRunId,
      status: artifact.status,
      kind: artifact.kind,
      links: {
        self: `/proposal-artifacts/${encodeURIComponent(artifact.id)}`
      }
    }))
  };

  return {
    counts: {
      scenarios: scenarios.length,
      regressions: regressions.length,
      recentScenarioRuns: recent.recentScenarioRuns.length,
      recentRegressionRuns: recent.recentRegressionRuns.length,
      workItems: recent.workItems.length,
      recentWorkItemRuns: recentWorkItemRuns.length,
      pendingProposalArtifacts: selfBuild.proposals.filter((artifact) => artifact.status !== "approved").length,
      failingScenarios: scenarios.filter((item) => item.latestRun && !isSuccessfulState(item.latestRun.status)).length,
      failingRegressions: regressions.filter((item) => item.latestRun && item.latestRun.status !== "passed").length,
      flakyScenarios: flaky.scenarios.length,
      flakyRegressions: flaky.regressions.length
    },
    trendBreakdown,
    failureBreakdown: {
      scenarios: scenarioFailureBreakdown,
      regressions: regressionFailureBreakdown
    },
    flaky,
    latestReports,
    alerts,
    recommendations,
    scenarios,
    regressions,
    recentScenarioRuns,
    recentRegressionRuns,
    selfBuild
  };
}
