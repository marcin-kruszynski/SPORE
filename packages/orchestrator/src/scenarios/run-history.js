import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_ORCHESTRATOR_DB_PATH } from "../metadata/constants.js";
import { createExecution, driveExecution, getExecutionDetail } from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import {
  getRegressionRun,
  getScenarioRun,
  insertRegressionRun,
  insertRegressionRunItem,
  insertScenarioRun,
  insertScenarioRunExecution,
  listRegressionRunItems,
  listRegressionRuns,
  listScenarioRunExecutions,
  listScenarioRuns,
  openOrchestratorDatabase,
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
  const payload = {
    run,
    items
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
    "",
    "## Items",
    "",
    ...items.map((item) => `- \`${item.scenarioId}\`: \`${item.status}\``)
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
  return {
    scenarioId: definition.id,
    label: definition.label,
    workflow: definition.workflow,
    domain: definition.domain,
    roles: definition.roles ?? [],
    realPiEligible: Boolean(definition.realPiEligible),
    latestRun: run,
    latestExecutions: executionLinks
  };
}

function summarizeRegressionRun(definition, run, items = []) {
  return {
    regressionId: definition.id,
    label: definition.label,
    scenarios: definition.scenarios ?? [],
    realPiRequired: Boolean(definition.realPiRequired),
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
    const assertionSummary = buildAssertionSummary(definition, settledDetail ?? detail);
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
        artifactSummary
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
        error: error.message
      },
      metadata: {
        ...scenarioRun.metadata,
        error: error.message
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
      const latestRun = listScenarioRuns(db, definition.id, 1)[0] ?? null;
      const executionLinks = latestRun ? listScenarioRunExecutions(db, latestRun.id) : [];
      return summarizeScenarioRun(definition, latestRun, executionLinks);
    })
  );
}

export async function getScenarioSummary(scenarioId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const latestRun = listScenarioRuns(db, definition.id, 1)[0] ?? null;
    const executionLinks = latestRun ? listScenarioRunExecutions(db, latestRun.id) : [];
    return summarizeScenarioRun(definition, latestRun, executionLinks);
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
          scenarioStatus: result.run.status
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
          error: error.message
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
      processedScenarioIds: items.map((item) => item.scenarioId)
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
      const latestRun = listRegressionRuns(db, definition.id, 1)[0] ?? null;
      const items = latestRun ? listRegressionRunItems(db, latestRun.id) : [];
      return summarizeRegressionRun(definition, latestRun, items);
    })
  );
}

export async function getRegressionSummary(regressionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    return null;
  }
  return withDatabase(dbPath, (db) => {
    const latestRun = listRegressionRuns(db, regressionId, 1)[0] ?? null;
    const items = latestRun ? listRegressionRunItems(db, latestRun.id) : [];
    return summarizeRegressionRun(definition, latestRun, items);
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
    executions: executionArtifacts
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
