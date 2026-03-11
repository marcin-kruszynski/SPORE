import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { buildTsxEntrypointArgs } from "@spore/core";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  postJson,
  startProcess,
  stopProcess,
  waitForHealth,
  withEventLogPath,
} from "@spore/test-support";

import {
  insertWorkItemGroup,
  getProposalArtifact,
  insertProposalArtifact,
  insertWorkItemRun,
  openOrchestratorDatabase,
  updateProposalArtifact,
  updateWorkItemRun,
} from "../../../packages/orchestrator/src/store/execution-store.js";
import {
  createManagedWorkItem,
  getSelfBuildWorkItemRun,
  runSelfBuildWorkItem,
} from "../../../packages/orchestrator/src/self-build/managed-work.js";
import { validateWorkItemGroupBundle } from "../../../packages/orchestrator/src/self-build/work-item-groups.js";
import {
  queueWorkItemRunValidation,
  waitForWorkItemRunValidation,
} from "../../../packages/orchestrator/src/self-build/validation-followup.js";
import type { HarnessTempPathsWithEventLog } from "./helpers/http-harness.js";

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray<T = JsonRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function startServer(t: test.TestContext, prefix: string) {
  const port = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths(prefix),
  ) as HarnessTempPathsWithEventLog;

  const server = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(port),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath,
  });

  t.after(async () => {
    await stopProcess(server);
  });

  await waitForHealth(`http://127.0.0.1:${port}/health`);
  return { port, dbPath, sessionDbPath, eventLogPath };
}

async function runCliJson(args: string[], env: NodeJS.ProcessEnv = {}) {
  return await new Promise<JsonRecord>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      buildTsxEntrypointArgs("packages/orchestrator/src/cli/spore-orchestrator.js", args),
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(stderr || stdout || `cli failed with code ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

async function withValidationEnv<T>(
  env: {
    dbPath: string;
    sessionDbPath: string;
    eventLogPath: string;
  },
  fn: () => Promise<T>,
) {
  const previous = {
    SPORE_ORCHESTRATOR_DB_PATH: process.env.SPORE_ORCHESTRATOR_DB_PATH,
    SPORE_SESSION_DB_PATH: process.env.SPORE_SESSION_DB_PATH,
    SPORE_EVENT_LOG_PATH: process.env.SPORE_EVENT_LOG_PATH,
  };
  process.env.SPORE_ORCHESTRATOR_DB_PATH = env.dbPath;
  process.env.SPORE_SESSION_DB_PATH = env.sessionDbPath;
  process.env.SPORE_EVENT_LOG_PATH = env.eventLogPath;
  try {
    return await fn();
  } finally {
    if (previous.SPORE_ORCHESTRATOR_DB_PATH === undefined) {
      delete process.env.SPORE_ORCHESTRATOR_DB_PATH;
    } else {
      process.env.SPORE_ORCHESTRATOR_DB_PATH = previous.SPORE_ORCHESTRATOR_DB_PATH;
    }
    if (previous.SPORE_SESSION_DB_PATH === undefined) {
      delete process.env.SPORE_SESSION_DB_PATH;
    } else {
      process.env.SPORE_SESSION_DB_PATH = previous.SPORE_SESSION_DB_PATH;
    }
    if (previous.SPORE_EVENT_LOG_PATH === undefined) {
      delete process.env.SPORE_EVENT_LOG_PATH;
    } else {
      process.env.SPORE_EVENT_LOG_PATH = previous.SPORE_EVENT_LOG_PATH;
    }
  }
}

async function waitForValidationState(
  port: number,
  runId: string,
  predicate: (state: JsonRecord) => boolean,
  timeoutMs = 60000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await getJson(
      `http://127.0.0.1:${port}/work-item-runs/${encodeURIComponent(runId)}`,
    );
    assert.equal(payload.status, 200);
    const state = asObject(payload.json.detail?.validation);
    if (predicate(state)) {
      return {
        detail: asObject(payload.json.detail),
        state,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for validation state on run ${runId}`);
}

async function waitForValidationStateInDb(
  dbPath: string,
  runId: string,
  predicate: (state: JsonRecord) => boolean,
  timeoutMs = 60000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const detail = asObject(getSelfBuildWorkItemRun(runId, dbPath));
    const state = asObject(detail.validation);
    if (predicate(state)) {
      return {
        detail,
        state,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for persisted validation state on run ${runId}`);
}

async function waitForThreadDetail(
  port: number,
  threadId: string,
  predicate: (detail: JsonRecord) => boolean,
  timeoutMs = 60000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await getJson(
      `http://127.0.0.1:${port}/operator/threads/${encodeURIComponent(threadId)}`,
    );
    assert.equal(payload.status, 200);
    assert.ok(payload.json.ok);
    const detail = asObject(payload.json.detail);
    if (predicate(detail)) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for thread ${threadId}`);
}

async function replyInThread(port: number, threadId: string, message: string) {
  const payload = await postJson(
    `http://127.0.0.1:${port}/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message,
      by: "test-runner",
      source: "http-self-build-validation-test",
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  return asObject(payload.json.detail);
}

async function createOperatorUiRun(port: number, dbPath: string) {
  const item = await postJson(`http://127.0.0.1:${port}/work-items`, {
    templateId: "operator-ui-pass",
    goal: "Add a day/night mode toggle to the operator dashboard.",
    by: "test-runner",
    source: "http-self-build-validation-test",
  });
  assert.equal(item.status, 200);
  assert.ok(item.json.ok);

  const itemId = String(item.json.detail.id);
  const { runId, proposalId } = seedProposalForWorkItem(
    dbPath,
    itemId,
    String(item.json.detail.title ?? "Operator UI pass"),
    String(item.json.detail.goal ?? ""),
    "validation_required",
  );

  return {
    itemId,
    runId,
    proposalId,
  };
}

function seedProposalForWorkItem(
  dbPath: string,
  itemId: string,
  itemTitle: string,
  itemGoal: string,
  proposalStatus = "validation_required",
) {
  const runId = `work-item-run-${Date.now()}`;
  const proposalId = `proposal-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    insertWorkItemRun(db, {
      id: runId,
      workItemId: itemId,
      status: "completed",
      triggerSource: "test-seed",
      requestedBy: "test-runner",
      result: {
        executionId: `execution:${runId}`,
      },
      metadata: {
        itemKind: "workflow",
        itemStatusBeforeRun: "pending",
      },
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: timestamp,
    });
    insertProposalArtifact(db, {
      id: proposalId,
      workItemRunId: runId,
      workItemId: itemId,
      status: proposalStatus,
      kind: "workflow",
      summary: {
        title: `${itemTitle} proposal`,
        goal: itemGoal,
        runStatus: "completed",
        safeMode: true,
      },
      artifacts: {
        changeSummary: itemGoal,
        proposedFiles: [],
        diffSummary: {
          fileCount: 0,
          trackedFileCount: 0,
          untrackedFileCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          renamedCount: 0,
          conflictedCount: 0,
          insertionCount: 0,
          deletionCount: 0,
        },
        changedFilesByScope: [],
        patchArtifact: {
          path: `artifacts/proposals/${proposalId}.patch`,
          byteLength: 0,
          preview: "",
        },
        reviewNotes: {
          requiredReview: true,
          requiredApproval: true,
          safeMode: true,
        },
        testSummary: {
          validationStatus: "pending",
          scenarioRunIds: [],
          regressionRunIds: [],
        },
        docImpact: {
          relatedDocs: [],
          relatedScenarios: [],
          relatedRegressions: [],
        },
      },
      metadata: {
        source: "test-seed",
        promotion: {
          status: "blocked",
          targetBranch: "main",
          sourceExecutionId: `execution:${runId}`,
        },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewedAt: timestamp,
      approvedAt: timestamp,
    });
  } finally {
    db.close();
  }
  return { runId, proposalId };
}

function seedPersistedValidationState(
  dbPath: string,
  runId: string,
  proposalId: string,
  overrides: JsonRecord = {},
) {
  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    const runDetail = getSelfBuildWorkItemRun(runId, dbPath);
    assert.ok(runDetail);
    updateWorkItemRun(db, {
      ...asObject(runDetail),
      id: runId,
      workItemId: runDetail.workItemId,
      status: runDetail.status,
      triggerSource: runDetail.triggerSource,
      requestedBy: runDetail.requestedBy,
      result: runDetail.result ?? {},
      metadata: {
        ...asObject(runDetail.metadata),
        validation: {
          id: `validation-${Date.now()}`,
          targetType: "proposal",
          targetId: proposalId,
          bundleId: "frontend-ui-pass",
          bundleIds: ["frontend-ui-pass"],
          status: "queued",
          scenarioRunIds: [],
          regressionRunIds: [],
          startedAt: null,
          endedAt: null,
          error: null,
          errors: [],
          bundleResults: [],
          validatedAt: null,
          validationFingerprint: null,
          validationDrift: false,
          ...overrides,
        },
      },
      createdAt: runDetail.createdAt,
      startedAt: runDetail.startedAt,
      endedAt: runDetail.endedAt,
    });
    const proposal = getProposalArtifact(db, proposalId);
    assert.ok(proposal);
    updateProposalArtifact(db, {
      ...proposal,
      metadata: {
        ...asObject(proposal.metadata),
        validation: {
          id: `validation-${Date.now()}`,
          targetType: "proposal",
          targetId: proposalId,
          bundleId: "frontend-ui-pass",
          bundleIds: ["frontend-ui-pass"],
          status: "queued",
          scenarioRunIds: [],
          regressionRunIds: [],
          startedAt: null,
          endedAt: null,
          error: null,
          errors: [],
          bundleResults: [],
          validatedAt: null,
          validationFingerprint: null,
          validationDrift: false,
          ...overrides,
        },
      },
      updatedAt: timestamp,
    });
  } finally {
    db.close();
  }
}

test("work-item validation queues a narrow frontend bundle and persists state", async (t) => {
  const { port, dbPath } = await startServer(
    t,
    "spore-http-self-build-validation-",
  );
  const { runId, proposalId } = await createOperatorUiRun(port, dbPath);

  const queued = await postJson(
    `http://127.0.0.1:${port}/work-item-runs/${encodeURIComponent(runId)}/validate`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-validation-test",
    },
  );
  assert.equal(queued.status, 200);
  assert.ok(queued.json.ok);

  const queuedState = asObject(queued.json.detail?.validation);
  assert.equal(queuedState.status, "queued");
  assert.ok(typeof queuedState.id === "string");
  assert.equal(queuedState.targetType, "proposal");
  assert.equal(queuedState.targetId, proposalId);
  assert.equal(queuedState.bundleId, "frontend-ui-pass");
  assert.deepEqual(asArray(queuedState.scenarioRunIds), []);
  assert.deepEqual(asArray(queuedState.regressionRunIds), []);
  assert.equal(queuedState.startedAt ?? null, null);
  assert.equal(queuedState.endedAt ?? null, null);
  assert.equal(queuedState.error ?? null, null);

  const persistedQueued = await getJson(
    `http://127.0.0.1:${port}/work-item-runs/${encodeURIComponent(runId)}`,
  );
  assert.equal(persistedQueued.status, 200);
  assert.equal(
    asObject(persistedQueued.json.detail?.validation).id,
    queuedState.id,
  );

  const completed = await waitForValidationState(
    port,
    runId,
    (state) => String(state.status) === "completed",
  );
  assert.equal(completed.state.id, queuedState.id);
  assert.equal(completed.state.targetType, "proposal");
  assert.equal(completed.state.targetId, proposalId);
  assert.equal(completed.state.bundleId, "frontend-ui-pass");
  assert.ok(typeof completed.state.startedAt === "string");
  assert.ok(typeof completed.state.endedAt === "string");
  assert.ok(asArray(completed.state.scenarioRunIds).length > 0);
  assert.deepEqual(asArray(completed.state.regressionRunIds), []);
  assert.equal(completed.state.error ?? null, null);

  const proposal = await getJson(
    `http://127.0.0.1:${port}/proposal-artifacts/${encodeURIComponent(proposalId)}`,
  );
  assert.equal(proposal.status, 200);
  assert.equal(asObject(proposal.json.detail?.validation).id, queuedState.id);
  assert.equal(
    asObject(proposal.json.detail?.validation).bundleId,
    "frontend-ui-pass",
  );

  const localFastRuns = await getJson(
    `http://127.0.0.1:${port}/regressions/local-fast/runs?limit=5`,
  );
  assert.equal(localFastRuns.status, 200);
  assert.ok(localFastRuns.json.ok);
  assert.deepEqual(asArray(localFastRuns.json.detail?.runs), []);
});

test("operator chat reads persisted validation state while auto-validation runs", async (t) => {
  const { port, dbPath } = await startServer(
    t,
    "spore-http-self-build-validation-operator-chat-",
  );

  const createdThread = await postJson(`http://127.0.0.1:${port}/operator/threads`, {
    message:
      "Improve the operator web dashboard for self-build review and keep the work in safe mode.",
    projectId: "spore",
    safeMode: true,
    stub: true,
    wait: false,
    by: "test-runner",
    source: "http-self-build-validation-test",
  });
  assert.equal(createdThread.status, 200);
  assert.ok(createdThread.json.ok);

  const threadId = String(createdThread.json.detail.id);
  await replyInThread(port, threadId, "approve");

  const materialized = await waitForThreadDetail(
    port,
    threadId,
    (detail) =>
      asArray<JsonRecord>(asObject(asObject(detail.context).group).items).length >
      0,
  );

  const group = asObject(asObject(materialized.context).group);
  const seededItem = asArray<JsonRecord>(group.items)[0];
  assert.ok(seededItem);

  const { runId, proposalId } = seedProposalForWorkItem(
    dbPath,
    String(seededItem.id),
    String(seededItem.title ?? "Work item"),
    String(seededItem.goal ?? ""),
    "ready_for_review",
  );
  assert.ok(runId);
  assert.ok(proposalId);

  await waitForThreadDetail(
    port,
    threadId,
    (detail) =>
      asArray<JsonRecord>(detail.pendingActions).some(
        (action) => action.actionKind === "proposal-review",
      ),
  );

  await replyInThread(port, threadId, "reviewed");

  await waitForThreadDetail(
    port,
    threadId,
    (detail) =>
      asArray<JsonRecord>(detail.pendingActions).some(
        (action) => action.actionKind === "proposal-approval",
      ),
  );

  const triggered = await replyInThread(port, threadId, "approve");

  const progress = asObject(triggered.progress);
  assert.equal(progress.currentStage, "validation");

  const evidenceValidation = asObject(
    asObject(triggered.evidenceSummary).validation,
  );
  const proposalValidation = asObject(
    asObject(asObject(triggered.context).proposal).validation,
  );

  assert.ok(["queued", "running", "completed"].includes(String(evidenceValidation.status)));
  assert.equal(evidenceValidation.id, proposalValidation.id);
  assert.equal(evidenceValidation.targetType, "proposal");
  assert.equal(evidenceValidation.targetId, proposalId);
  assert.equal(evidenceValidation.bundleId, "frontend-ui-pass");

  const completed = await waitForValidationState(
    port,
    runId,
    (state) => String(state.status) === "completed",
  );
  assert.equal(completed.state.targetType, "proposal");
  assert.equal(completed.state.targetId, proposalId);

  const settledThread = await getJson(
    `http://127.0.0.1:${port}/operator/threads/${encodeURIComponent(threadId)}`,
  );
  assert.equal(settledThread.status, 200);
  assert.ok(settledThread.json.ok);
  const settledEvidenceValidation = asObject(
    asObject(settledThread.json.detail?.evidenceSummary).validation,
  );
  assert.equal(settledEvidenceValidation.id, completed.state.id);
  assert.equal(settledEvidenceValidation.status, "completed");
  assert.equal(settledEvidenceValidation.bundleId, "frontend-ui-pass");

  const db = openOrchestratorDatabase(dbPath);
  try {
    const proposal = getProposalArtifact(db, proposalId);
    assert.ok(proposal);
    assert.equal(
      asObject(proposal.metadata).validation &&
        asObject(asObject(proposal.metadata).validation).id,
      completed.state.id,
    );
  } finally {
    db.close();
  }
});

test("CLI validation commands queue validation instead of waiting for completion", async (t) => {
  const { dbPath, sessionDbPath, eventLogPath, port } = await startServer(
    t,
    "spore-cli-self-build-validation-",
  );
  const { runId, proposalId } = await createOperatorUiRun(port, dbPath);

  const payload = await runCliJson(
    [
      "work-item-validate",
      "--run",
      runId,
      "--stub",
      "--by",
      "test-runner",
      "--source",
      "http-self-build-validation-test",
    ],
    {
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
  );

  assert.equal(payload.ok, true);
  const validation = asObject(asObject(payload.detail).validation);
  assert.ok(["queued", "running"].includes(String(validation.status)));
  assert.equal(validation.targetType, "proposal");
  assert.equal(validation.targetId, proposalId);
  assert.equal(validation.bundleId, "frontend-ui-pass");
  assert.equal(validation.endedAt ?? null, null);

  const completed = await waitForValidationState(
    port,
    runId,
    (state) => String(state.status) === "completed",
  );
  assert.equal(completed.state.bundleId, "frontend-ui-pass");
});

test("internal group validation bundle queues instead of waiting for completion", async (t) => {
  const { dbPath } = await startServer(t, "spore-group-validation-");
  const groupId = `group-${Date.now()}`;
  const timestamp = new Date().toISOString();

  const db = openOrchestratorDatabase(dbPath);
  try {
    insertWorkItemGroup(db, {
      id: groupId,
      title: "Operator UI validation group",
      goalPlanId: null,
      status: "pending",
      summary: {},
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRunAt: null,
    });
  } finally {
    db.close();
  }

  const item = await createManagedWorkItem(
    {
      templateId: "operator-ui-pass",
      goal: "Add a day/night mode toggle to the operator dashboard.",
      metadata: {
        groupId,
      },
      by: "test-runner",
      source: "http-self-build-validation-test",
    },
    dbPath,
  );

  const seededRun = await runSelfBuildWorkItem(
    item.id,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-validation-test",
    },
    dbPath,
  );
  const runId = String(asObject(seededRun?.run).id ?? "");
  assert.ok(runId);

  const result = await validateWorkItemGroupBundle(
    groupId,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-validation-test",
    },
    dbPath,
  );

  assert.ok(result);
  const validationResults = asArray<JsonRecord>(result.validationResults);
  assert.ok(validationResults.length > 0);
  assert.ok(
    validationResults.every((entry) =>
      ["queued", "running"].includes(String(asObject(entry.validation).status)),
    ),
  );

  const persisted = asObject(getSelfBuildWorkItemRun(runId, dbPath));
  const persistedValidation = asObject(persisted.validation);
  assert.ok(["queued", "running"].includes(String(persistedValidation.status)));
  assert.equal(persistedValidation.bundleId, "frontend-ui-pass");
  assert.equal(asObject(persisted.item).id, item.id);
});

test("queueWorkItemRunValidation re-schedules persisted queued validation without an in-memory task", async (t) => {
  const { dbPath, sessionDbPath, eventLogPath, port } = await startServer(
    t,
    "spore-validation-requeue-",
  );
  const { runId, proposalId } = await createOperatorUiRun(port, dbPath);
  seedPersistedValidationState(dbPath, runId, proposalId, {
    status: "queued",
  });

  const queued = await withValidationEnv(
    { dbPath, sessionDbPath, eventLogPath },
    () =>
      queueWorkItemRunValidation(
        runId,
        {
          stub: true,
          timeout: 12000,
          interval: 250,
          by: "test-runner",
          source: "http-self-build-validation-test",
        },
        dbPath,
      ),
  );

  assert.ok(queued);
  assert.ok(
    ["queued", "running"].includes(String(asObject(queued.validation).status)),
  );
  const resumed = await waitForValidationStateInDb(
    dbPath,
    runId,
    (state) => String(state.status) !== "queued",
  );
  assert.ok(
    ["running", "completed", "failed"].includes(String(resumed.state.status)),
  );
  assert.ok(
    resumed.state.startedAt === null || typeof resumed.state.startedAt === "string",
  );
  assert.equal(resumed.state.bundleId, "frontend-ui-pass");
});

test("waitForWorkItemRunValidation resumes persisted queued validation and waits for a terminal state", async (t) => {
  const { dbPath, sessionDbPath, eventLogPath, port } = await startServer(
    t,
    "spore-validation-resume-",
  );
  const { runId, proposalId } = await createOperatorUiRun(port, dbPath);
  seedPersistedValidationState(dbPath, runId, proposalId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const completed = await withValidationEnv(
    { dbPath, sessionDbPath, eventLogPath },
    () =>
      waitForWorkItemRunValidation(
        runId,
        {
          stub: true,
          timeout: 12000,
          interval: 250,
          by: "test-runner",
          source: "http-self-build-validation-test",
        },
        dbPath,
      ),
  );

  assert.ok(completed);
  assert.ok(
    ["completed", "failed"].includes(String(asObject(completed.validation).status)),
  );
  assert.equal(typeof asObject(completed.validation).endedAt, "string");
  assert.equal(asObject(completed.validation).bundleId, "frontend-ui-pass");
});
