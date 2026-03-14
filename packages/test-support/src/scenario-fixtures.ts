import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createExecution,
  getExecutionDetail,
  openOrchestratorDatabase,
  planWorkflowInvocation,
  spawnExecutionBranches,
  transitionStepRecord,
  updateStep,
} from "@spore/orchestrator";

type ScenarioExecutionArgs = {
  workflowPath?: string | null;
  projectPath?: string;
  domainId?: string | null;
  roles?: string[] | null;
  invocationId?: string;
  objective?: string;
  dbPath: string;
};

type FamilyScenarioArgs = {
  workflowPath?: string | null;
  projectPath?: string;
  rootRoles: string[];
  childBranches: Array<Record<string, unknown>>;
  domainId?: string | null;
  invocationId?: string;
  objective?: string;
  dbPath: string;
  sessionDbPath: string;
};

type ReviewerPendingContext = {
  dbPath: string;
  sessionDbPath: string;
};

export type TempPaths = {
  root: string;
  dbPath: string;
  sessionDbPath: string;
  eventLogPath: string;
};

export async function makeTempPaths(prefix = "spore-scenario-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    dbPath: path.join(root, "orchestrator.sqlite"),
    sessionDbPath: path.join(root, "sessions.sqlite"),
    eventLogPath: path.join(root, "events.ndjson"),
  };
}

export async function createScenarioExecution({
  workflowPath,
  projectPath = "config/projects/example-project.yaml",
  domainId,
  roles,
  invocationId,
  objective,
  dbPath,
}: ScenarioExecutionArgs) {
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
  workflowPath,
  projectPath = "config/projects/example-project.yaml",
  rootRoles,
  childBranches,
  domainId,
  invocationId,
  objective,
  dbPath,
  sessionDbPath,
}: FamilyScenarioArgs) {
  const rootInvocation = await createScenarioExecution({
    workflowPath,
    projectPath,
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

export function setReviewerPending(
  executionId: string,
  { dbPath, sessionDbPath }: ReviewerPendingContext,
) {
  const detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  const reviewer = detail.steps.find(
    (step: { role?: string }) => step.role === "reviewer",
  );
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
