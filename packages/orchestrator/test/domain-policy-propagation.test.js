import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseYaml } from "../../config-schema/src/yaml/parse-yaml.js";
import { PROJECT_ROOT } from "../../runtime-pi/src/metadata/constants.js";
import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import { createExecution } from "../src/execution/workflow-execution.js";
import {
  getExecution,
  listSteps,
  openOrchestratorDatabase
} from "../src/store/execution-store.js";

function resolveProjectPath(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

async function readYaml(relativePath) {
  const raw = await fs.readFile(resolveProjectPath(relativePath), "utf8");
  return parseYaml(raw);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function resolveDomain(project, domainId) {
  return project.activeDomains?.find((candidate) => candidate.id === domainId) ?? null;
}

function buildExpectedDocsQuery({ role, domainId, workflow, project, queryTerms }) {
  return unique([
    role,
    domainId,
    workflow.id,
    workflow.name,
    project.type,
    ...asArray(queryTerms)
  ]).join(" ");
}

test("backend domain policy propagates from planner into execution store records", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spore-orchestrator-policy-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["builder", "reviewer"],
    invocationId: "test-domain-policy-propagation",
    objective: "Verify policy propagation"
  });

  const project = await readYaml("config/projects/example-project.yaml");
  const domainConfig = await readYaml("config/domains/backend.yaml");
  const workflow = await readYaml(invocation.workflow.path);
  const domainOverride = resolveDomain(project, "backend");

  const expectedStepSoftTimeoutMs =
    domainOverride?.workflowPolicy?.stepSoftTimeoutMs ??
    domainConfig.workflowPolicy?.stepSoftTimeoutMs ??
    null;
  const expectedStepHardTimeoutMs =
    domainOverride?.workflowPolicy?.stepHardTimeoutMs ??
    domainConfig.workflowPolicy?.stepHardTimeoutMs ??
    null;
  const expectedDefaultMaxAttempts =
    domainOverride?.workflowPolicy?.defaultMaxAttempts ??
    domainConfig.workflowPolicy?.defaultMaxAttempts ??
    workflow.retryPolicy?.maxAttempts ??
    1;
  const expectedDefaultRoles =
    domainOverride?.workflowPolicy?.defaultRoles ??
    domainConfig.workflowPolicy?.defaultRoles ??
    workflow.roleSequence ??
    [];
  const expectedRetryTargetRole =
    domainOverride?.workflowPolicy?.retryTargetRole ??
    domainConfig.workflowPolicy?.retryTargetRole ??
    null;
  const expectedResetDescendantSteps =
    domainOverride?.workflowPolicy?.resetDescendantSteps ??
    domainConfig.workflowPolicy?.resetDescendantSteps ??
    false;
  const expectedSessionModeByRole = {
    ...(domainConfig.runtimePolicy?.sessionModeByRole ?? {}),
    ...(domainOverride?.runtimePolicy?.sessionModeByRole ?? {})
  };
  const expectedDocsQueryTerms = unique([
    ...asArray(domainConfig.docsKbPolicy?.queryTerms),
    ...asArray(domainOverride?.docsKbPolicy?.queryTerms)
  ]);
  const expectedResultLimit =
    domainOverride?.docsKbPolicy?.resultLimit ??
    domainConfig.docsKbPolicy?.resultLimit ??
    5;
  const expectedBuilderAttempts =
    domainOverride?.workflowPolicy?.maxAttemptsByRole?.builder ??
    domainConfig.workflowPolicy?.maxAttemptsByRole?.builder ??
    expectedDefaultMaxAttempts;
  const expectedReviewerAttempts =
    domainOverride?.workflowPolicy?.maxAttemptsByRole?.reviewer ??
    domainConfig.workflowPolicy?.maxAttemptsByRole?.reviewer ??
    expectedDefaultMaxAttempts;

  assert.deepEqual(invocation.effectivePolicy, {
    workflowPolicy: {
      stepSoftTimeoutMs: expectedStepSoftTimeoutMs,
      stepHardTimeoutMs: expectedStepHardTimeoutMs,
      defaultMaxAttempts: expectedDefaultMaxAttempts,
      retryTargetRole: expectedRetryTargetRole,
      resetDescendantSteps: expectedResetDescendantSteps,
      defaultRoles: expectedDefaultRoles
    },
    runtimePolicy: {
      sessionModeByRole: expectedSessionModeByRole
    },
    docsKbPolicy: {
      resultLimit: expectedResultLimit,
      queryTerms: expectedDocsQueryTerms,
      queryTemplate:
        domainOverride?.docsKbPolicy?.queryTemplate ??
        domainConfig.docsKbPolicy?.queryTemplate ??
        null
    }
  });

  const launchesByRole = new Map(invocation.launches.map((launch) => [launch.role, launch]));
  const builderLaunch = launchesByRole.get("builder");
  const reviewerLaunch = launchesByRole.get("reviewer");

  assert.ok(builderLaunch);
  assert.ok(reviewerLaunch);

  assert.equal(builderLaunch.maxAttempts, expectedBuilderAttempts);
  assert.equal(builderLaunch.sessionMode, expectedSessionModeByRole.builder ?? null);
  assert.deepEqual(builderLaunch.policy, {
    workflowPolicy: {
      stepSoftTimeoutMs: expectedStepSoftTimeoutMs,
      stepHardTimeoutMs: expectedStepHardTimeoutMs,
      maxAttempts: expectedBuilderAttempts
    },
    runtimePolicy: {
      sessionMode: expectedSessionModeByRole.builder ?? null
    },
    docsKbPolicy: {
      resultLimit: expectedResultLimit,
      query: buildExpectedDocsQuery({
        role: "builder",
        domainId: invocation.domain.id,
        workflow,
        project,
        queryTerms: expectedDocsQueryTerms
      }),
      queryTerms: unique([
        "builder",
        invocation.domain.id,
        workflow.id,
        ...expectedDocsQueryTerms
      ])
    },
    governance: {
      reviewRequired: false,
      approvalRequired: false
    }
  });

  assert.equal(reviewerLaunch.maxAttempts, expectedReviewerAttempts);
  assert.equal(reviewerLaunch.sessionMode, expectedSessionModeByRole.reviewer ?? null);
  assert.equal(reviewerLaunch.reviewRequired, true);
  assert.equal(reviewerLaunch.approvalRequired, true);
  assert.equal(reviewerLaunch.policy.workflowPolicy.maxAttempts, expectedReviewerAttempts);
  assert.equal(
    reviewerLaunch.policy.docsKbPolicy.query,
    buildExpectedDocsQuery({
      role: "reviewer",
      domainId: invocation.domain.id,
      workflow,
      project,
      queryTerms: expectedDocsQueryTerms
    })
  );

  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const execution = getExecution(db, invocation.invocationId);
    const steps = listSteps(db, invocation.invocationId);
    const stepsByRole = new Map(steps.map((step) => [step.role, step]));

    assert.ok(execution);
    assert.deepEqual(execution.policy, invocation.effectivePolicy);

    assert.equal(steps.length, invocation.launches.length);
    assert.deepEqual(stepsByRole.get("builder")?.policy, builderLaunch.policy);
    assert.equal(stepsByRole.get("builder")?.sessionMode, builderLaunch.sessionMode);
    assert.deepEqual(stepsByRole.get("reviewer")?.policy, reviewerLaunch.policy);
    assert.equal(stepsByRole.get("reviewer")?.sessionMode, reviewerLaunch.sessionMode);
  } finally {
    db.close();
  }
});
