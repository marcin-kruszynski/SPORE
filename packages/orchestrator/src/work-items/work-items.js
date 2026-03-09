import crypto from "node:crypto";

import { DEFAULT_ORCHESTRATOR_DB_PATH } from "../metadata/constants.js";
import { createExecution, driveExecution, getExecutionDetail } from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import { runRegressionById, runScenarioById } from "../scenarios/run-history.js";
import {
  getWorkItem,
  getWorkItemRun,
  insertWorkItem,
  insertWorkItemRun,
  listWorkItemRuns,
  listWorkItems,
  openOrchestratorDatabase,
  updateWorkItem,
  updateWorkItemRun
} from "../store/execution-store.js";

function withDatabase(dbPath, fn) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function mapWorkItemState(state) {
  if (["completed", "passed"].includes(state)) {
    return "completed";
  }
  if (["running", "planned", "starting"].includes(state)) {
    return "running";
  }
  if (["waiting_review", "waiting_approval", "held", "paused"].includes(state)) {
    return "blocked";
  }
  if (["failed", "rejected", "canceled", "stopped"].includes(state)) {
    return "failed";
  }
  return state || "pending";
}

function buildWorkItemLinks(item) {
  return {
    self: `/work-items/${encodeURIComponent(item.id)}`,
    runs: `/work-items/${encodeURIComponent(item.id)}/runs`,
    run: `/work-items/${encodeURIComponent(item.id)}/run`
  };
}

function buildWorkItemSummary(item, runs = []) {
  const latestRun = runs[0] ?? null;
  return {
    ...item,
    latestRun,
    links: buildWorkItemLinks(item)
  };
}

export function createWorkItem(payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const now = new Date().toISOString();
  const item = {
    id: payload.id ?? createId("work-item"),
    title: String(payload.title ?? "").trim() || "Untitled Work Item",
    kind: String(payload.kind ?? "scenario").trim() || "scenario",
    source: payload.source ?? "operator",
    goal: payload.goal ?? "",
    status: payload.status ?? "pending",
    priority: payload.priority ?? "medium",
    acceptanceCriteria: asArray(payload.acceptanceCriteria),
    relatedDocs: asArray(payload.relatedDocs),
    relatedScenarios: asArray(payload.relatedScenarios),
    relatedRegressions: asArray(payload.relatedRegressions),
    metadata: payload.metadata ?? {},
    createdAt: now,
    updatedAt: now,
    lastRunAt: null
  };
  withDatabase(dbPath, (db) => insertWorkItem(db, item));
  return buildWorkItemSummary(item, []);
}

export function listManagedWorkItems(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  return withDatabase(dbPath, (db) =>
    listWorkItems(db, status, limit).map((item) => buildWorkItemSummary(item, listWorkItemRuns(db, item.id, 5)))
  );
}

export function getManagedWorkItem(itemId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) => {
    const item = getWorkItem(db, itemId);
    if (!item) {
      return null;
    }
    const runs = listWorkItemRuns(db, itemId, 20);
    return {
      ...buildWorkItemSummary(item, runs),
      runs
    };
  });
}

function normalizeWorkItemResult(kind, result) {
  if (kind === "scenario") {
    return {
      scenarioRunId: result?.run?.id ?? null,
      executionId: result?.execution?.execution?.id ?? result?.execution?.id ?? null,
      status: result?.run?.status ?? null
    };
  }
  if (kind === "regression") {
    return {
      regressionRunId: result?.run?.id ?? null,
      status: result?.run?.status ?? null,
      itemCount: Array.isArray(result?.items) ? result.items.length : 0
    };
  }
  if (kind === "workflow") {
    return {
      executionId: result?.execution?.id ?? null,
      status: result?.execution?.state ?? null
    };
  }
  return result ?? {};
}

async function runWorkflowWorkItem(item, options, dbPath) {
  const metadata = item.metadata ?? {};
  const roles = Array.isArray(metadata.roles) ? metadata.roles : null;
  const invocation = await planWorkflowInvocation({
    workflowPath: metadata.workflowPath ?? metadata.workflow ?? null,
    projectPath: metadata.projectPath ?? "config/projects/spore.yaml",
    domainId: metadata.domainId ?? null,
    roles,
    maxRoles: Number.parseInt(String(metadata.maxRoles ?? options.maxRoles ?? "1"), 10) || 1,
    objective: metadata.objective ?? item.goal ?? "",
    invocationId: metadata.invocationId ?? null,
    coordinationGroupId: metadata.coordinationGroupId ?? null,
    parentExecutionId: metadata.parentExecutionId ?? null,
    branchKey: metadata.branchKey ?? null
  });
  const created = createExecution(invocation, dbPath);
  const wait = options.wait !== false;
  if (!wait) {
    return { execution: created.execution };
  }
  return driveExecution(created.execution.id, {
    wait: true,
    timeoutMs: options.timeout ?? metadata.timeout ?? "180000",
    intervalMs: options.interval ?? metadata.interval ?? "1500",
    noMonitor: options.noMonitor === true,
    stub: options.stub === true,
    launcher: options.launcher ?? metadata.launcher ?? null,
    stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? metadata.stepSoftTimeoutMs ?? null,
    stepHardTimeoutMs: options.stepHardTimeoutMs ?? metadata.stepHardTimeoutMs ?? null,
    dbPath
  });
}

export async function runManagedWorkItem(itemId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item) {
    return null;
  }

  const startedAt = new Date().toISOString();
  const run = {
    id: options.runId ?? createId("work-item-run"),
    workItemId: item.id,
    status: "running",
    triggerSource: options.source ?? "operator",
    requestedBy: options.by ?? "operator",
    result: {},
    metadata: {
      itemKind: item.kind,
      itemStatusBeforeRun: item.status
    },
    createdAt: startedAt,
    startedAt,
    endedAt: null
  };
  withDatabase(dbPath, (db) => insertWorkItemRun(db, run));

  try {
    let result;
    if (item.kind === "scenario") {
      const scenarioId = item.metadata?.scenarioId ?? item.relatedScenarios?.[0];
      if (!scenarioId) {
        throw new Error(`work item ${item.id} is missing metadata.scenarioId`);
      }
      result = await runScenarioById(scenarioId, {
        project: options.project ?? item.metadata?.projectPath ?? "config/projects/spore.yaml",
        wait: options.wait !== false,
        timeout: options.timeout ?? item.metadata?.timeout ?? "180000",
        interval: options.interval ?? item.metadata?.interval ?? "1500",
        noMonitor: options.noMonitor === true,
        stub: options.stub === true,
        launcher: options.launcher ?? item.metadata?.launcher ?? null,
        objective: item.metadata?.objective ?? item.goal ?? null,
        source: options.source ?? "work-item",
        by: options.by ?? "operator",
        stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? item.metadata?.stepSoftTimeoutMs ?? null,
        stepHardTimeoutMs: options.stepHardTimeoutMs ?? item.metadata?.stepHardTimeoutMs ?? null
      }, dbPath);
    } else if (item.kind === "regression") {
      const regressionId = item.metadata?.regressionId ?? item.relatedRegressions?.[0];
      if (!regressionId) {
        throw new Error(`work item ${item.id} is missing metadata.regressionId`);
      }
      result = await runRegressionById(regressionId, {
        project: options.project ?? item.metadata?.projectPath ?? "config/projects/spore.yaml",
        timeout: options.timeout ?? item.metadata?.timeout ?? "180000",
        interval: options.interval ?? item.metadata?.interval ?? "1500",
        noMonitor: options.noMonitor === true,
        stub: options.stub === true,
        launcher: options.launcher ?? item.metadata?.launcher ?? null,
        source: options.source ?? "work-item",
        by: options.by ?? "operator",
        stepSoftTimeoutMs: options.stepSoftTimeoutMs ?? item.metadata?.stepSoftTimeoutMs ?? null,
        stepHardTimeoutMs: options.stepHardTimeoutMs ?? item.metadata?.stepHardTimeoutMs ?? null
      }, dbPath);
    } else if (item.kind === "workflow") {
      result = await runWorkflowWorkItem(item, options, dbPath);
    } else {
      throw new Error(`unsupported work item kind: ${item.kind}`);
    }

    const normalizedResult = normalizeWorkItemResult(item.kind, result);
    const settledRun = {
      ...run,
      status: mapWorkItemState(normalizedResult.status ?? result?.run?.status ?? result?.execution?.state ?? "completed"),
      result: normalizedResult,
      metadata: {
        ...run.metadata,
        rawResultType: item.kind
      },
      endedAt: new Date().toISOString()
    };
    const settledItem = {
      ...item,
      status: mapWorkItemState(settledRun.status),
      updatedAt: settledRun.endedAt,
      lastRunAt: settledRun.endedAt,
      metadata: {
        ...item.metadata,
        lastRunId: settledRun.id,
        lastResult: normalizedResult
      }
    };
    withDatabase(dbPath, (db) => {
      updateWorkItemRun(db, settledRun);
      updateWorkItem(db, settledItem);
    });
    return {
      item: settledItem,
      run: settledRun
    };
  } catch (error) {
    const failedRun = {
      ...run,
      status: "failed",
      result: {
        error: error.message
      },
      metadata: {
        ...run.metadata,
        error: error.message
      },
      endedAt: new Date().toISOString()
    };
    const failedItem = {
      ...item,
      status: "failed",
      updatedAt: failedRun.endedAt,
      lastRunAt: failedRun.endedAt,
      metadata: {
        ...item.metadata,
        lastRunId: failedRun.id,
        lastError: error.message
      }
    };
    withDatabase(dbPath, (db) => {
      updateWorkItemRun(db, failedRun);
      updateWorkItem(db, failedItem);
    });
    throw error;
  }
}

export function getManagedWorkItemRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
}
