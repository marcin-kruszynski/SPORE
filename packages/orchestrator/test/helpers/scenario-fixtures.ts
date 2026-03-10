import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createExecution,
  getExecutionDetail,
  spawnExecutionBranches,
} from "../../src/execution/workflow-execution.js";
import { planWorkflowInvocation } from "../../src/invocation/plan-workflow-invocation.js";
import { transitionStepRecord } from "../../src/lifecycle/execution-lifecycle.js";
import {
  openOrchestratorDatabase,
  updateStep,
} from "../../src/store/execution-store.js";

export async function makeTempPaths(prefix = "spore-scenario-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    dbPath: path.join(root, "orchestrator.sqlite"),
    sessionDbPath: path.join(root, "sessions.sqlite"),
  };
}

export async function createScenarioExecution({
  workflowPath = null,
  projectPath = "config/projects/example-project.yaml",
  domainId,
  roles,
  invocationId,
  objective,
  dbPath,
}) {
  const invocation = await planWorkflowInvocation({
    workflowPath,
    projectPath,
    domainId,
    roles,
    invocationId,
    objective,
  });
  createExecution(invocation, dbPath);
  return invocation;
}

export async function createFamilyScenario({
  rootRoles,
  childBranches,
  domainId,
  invocationId,
  objective,
  dbPath,
  sessionDbPath,
}) {
  const rootInvocation = await createScenarioExecution({
    projectPath: "config/projects/example-project.yaml",
    domainId,
    roles: rootRoles,
    invocationId,
    objective,
    dbPath,
  });

  const branched = await spawnExecutionBranches(
    rootInvocation.invocationId,
    childBranches,
    {},
    dbPath,
    sessionDbPath,
  );
  return {
    rootInvocation,
    branched,
  };
}

export function setReviewerPending(executionId, { dbPath, sessionDbPath }) {
  const detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  const reviewer = detail.steps.find((step) => step.role === "reviewer");
  if (!reviewer) {
    throw new Error(`reviewer step not found for ${executionId}`);
  }
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(reviewer, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: reviewer.approvalRequired ? "pending" : null,
      }),
    );
  } finally {
    db.close();
  }
}
