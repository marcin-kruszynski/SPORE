import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildExpectedHandoff } from "../src/execution/handoff-context.js";
import { buildProjectCoordinationPlan } from "../src/execution/workflow-execution.js";
import {
  planProjectCoordination,
  planWorkflowInvocation,
} from "../src/invocation/plan-workflow-invocation.js";

test("planProjectCoordination defaults coordinationMode to delivery", async () => {
  const plan = await planProjectCoordination({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend", "frontend"],
    invocationId: `coord-plan-${Date.now()}`,
    objective: "Coordinate delivery across backend and frontend lanes.",
  });

  assert.equal(
    plan.metadata.invocationMetadata.coordinationMode,
    "delivery",
  );
  assert.equal(
    plan.metadata.invocationMetadata.projectRole,
    "coordinator",
  );
});

test("planProjectCoordination accepts supported coordinationMode overrides", async () => {
  const plan = await planProjectCoordination({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend"],
    invocationId: `coord-plan-mode-${Date.now()}`,
    objective: "Break the project into governed delivery lanes.",
    metadata: {
      coordinationMode: "project-breakdown",
    },
  });

  assert.equal(
    plan.metadata.invocationMetadata.coordinationMode,
    "project-breakdown",
  );
});

test("planProjectCoordination rejects unsupported coordinationMode values", async () => {
  await assert.rejects(
    () =>
      planProjectCoordination({
        projectPath: "config/projects/spore.yaml",
        domains: ["backend"],
        invocationId: `coord-plan-invalid-${Date.now()}`,
        objective: "Reject unsupported coordinator modes.",
        metadata: {
          coordinationMode: "incident-response",
        },
      }),
    /coordinationMode/i,
  );
});

test("planProjectCoordination trims validated coordinationMode before persisting metadata", async () => {
  const plan = await planProjectCoordination({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend"],
    invocationId: `coord-plan-trim-${Date.now()}`,
    objective: "Normalize coordinator mode before storing metadata.",
    metadata: {
      coordinationMode: " delivery ",
    },
  });

  assert.equal(plan.metadata.invocationMetadata.coordinationMode, "delivery");
});

test("planProjectCoordination honors project and workflow supported mode restrictions", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-coordination-mode-"),
  );
  const workflowPath = path.join(tempRoot, "workflow.yaml");
  const projectPath = path.join(tempRoot, "project.yaml");

  await fs.writeFile(
    workflowPath,
    [
      "id: project-coordination-root",
      "name: Project Coordination Root",
      "triggerType: manual",
      "roleSequence: [coordinator]",
      "supportedCoordinationModes: [delivery]",
      "stepSets:",
      "  - name: framing",
      "    roles: [coordinator]",
      "completionRequirements: [lead-lanes-created]",
      "reviewStep:",
      "  required: false",
      "retryPolicy:",
      "  maxAttempts: 1",
      "documentationUpdatePolicy:",
      "  required: false",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    projectPath,
    [
      "id: temp-project",
      "name: Temp Project",
      "canonicalBranch: main",
      "activeDomains:",
      "  - id: backend",
      "projectCoordinationPolicy:",
      `  workflow: ${workflowPath}`,
      "  supportedModes: [delivery]",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      planProjectCoordination({
        projectPath,
        domains: ["backend"],
        invocationId: `coord-plan-restricted-${Date.now()}`,
        objective: "Reject globally supported but locally disallowed coordinator modes.",
        metadata: {
          coordinationMode: "project-breakdown",
        },
      }),
    /coordinationMode/i,
  );
});

test("planProjectCoordination rejects invalid configured supported mode values", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-coordination-mode-invalid-"),
  );
  const workflowPath = path.join(tempRoot, "workflow.yaml");
  const projectPath = path.join(tempRoot, "project.yaml");

  await fs.writeFile(
    workflowPath,
    [
      "id: project-coordination-root",
      "name: Project Coordination Root",
      "triggerType: manual",
      "roleSequence: [coordinator]",
      "supportedCoordinationModes: [deliveri]",
      "stepSets:",
      "  - name: framing",
      "    roles: [coordinator]",
      "completionRequirements: [lead-lanes-created]",
      "reviewStep:",
      "  required: false",
      "retryPolicy:",
      "  maxAttempts: 1",
      "documentationUpdatePolicy:",
      "  required: false",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    projectPath,
    [
      "id: temp-project",
      "name: Temp Project",
      "canonicalBranch: main",
      "activeDomains:",
      "  - id: backend",
      "projectCoordinationPolicy:",
      `  workflow: ${workflowPath}`,
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      planProjectCoordination({
        projectPath,
        domains: ["backend"],
        invocationId: `coord-plan-invalid-supported-${Date.now()}`,
        objective: "Reject invalid configured supported mode values.",
      }),
    /supportedCoordinationModes|supportedModes/i,
  );
});

test("project coordination resolves a planner project role profile with a durable coordination plan contract", async () => {
  const plannerPlan = await planWorkflowInvocation({
    workflowPath: "config/workflows/project-coordination-root.yaml",
    projectPath: "config/projects/spore.yaml",
    roles: ["planner"],
    maxRoles: 1,
    invocationId: `coord-plan-planner-${Date.now()}`,
    objective: "Produce a durable coordination plan before lead dispatch.",
  });

  assert.equal(plannerPlan.launches[0]?.requestedProfileId, "planner");
  assert.equal(plannerPlan.launches[0]?.profilePath, "config/profiles/planner.yaml");

  const handoff = await buildExpectedHandoff({
    profilePath: "config/profiles/planner.yaml",
  });
  assert.equal(handoff?.kind, "coordination_plan");
  assert.deepEqual(handoff?.requiredSections, [
    "summary",
    "affected_domains",
    "domain_tasks",
    "waves",
    "dependencies",
    "shared_contracts",
    "unresolved_questions",
  ]);

  const prompt = await fs.readFile(
    path.join(process.cwd(), ".pi", "prompts", "planner.md"),
    "utf8",
  );
  assert.match(prompt, /coordination_plan/i);
  assert.match(prompt, /durable/i);
  assert.match(prompt, /domain_tasks.*id.*domainId.*summary/i);
  assert.match(prompt, /waves.*task_ids/i);
  assert.match(prompt, /dependencies.*from_task_id.*to_task_id/i);
  assert.match(prompt, /selected domains/i);
  assert.match(prompt, /keep task ids stable/i);
});

test("buildProjectCoordinationPlan defaults to a planner-first child lane and defers lead lanes until a plan is adopted", async () => {
  const invocationId = `coord-plan-default-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Coordinate delivery without dispatching domain leads before planning.",
  });

  assert.equal(plan.rootInvocation.invocationId, invocationId);
  assert.deepEqual(plan.rootInvocation.launches.map((launch) => launch.role), [
    "coordinator",
  ]);
  assert.equal(plan.rootInvocation.metadata.invocationMetadata.projectRole, "coordinator");
  assert.deepEqual(
    plan.rootInvocation.metadata.invocationMetadata.selectedDomains,
    ["backend", "frontend"],
  );
  assert.equal(
    plan.rootInvocation.metadata.invocationMetadata.adoptedPlan?.status,
    "pending",
  );

  assert.equal(plan.childInvocations.length, 1);
  assert.equal(plan.childInvocations[0]?.invocationId, `${invocationId}-planner`);
  assert.deepEqual(plan.childInvocations[0]?.launches.map((launch) => launch.role), [
    "planner",
  ]);
  assert.equal(
    plan.childInvocations[0]?.metadata.invocationMetadata.projectRole,
    "planner",
  );
  assert.equal(
    plan.childInvocations[0]?.metadata.invocationMetadata.projectLaneType,
    "planner",
  );
  assert.equal(
    plan.childInvocations[0]?.metadata.invocationMetadata.projectRootExecutionId,
    invocationId,
  );
  assert.equal(
    plan.childInvocations[0]?.metadata.invocationMetadata.adoptedPlan?.status,
    "pending",
  );
});

test("buildProjectCoordinationPlan encodes mode-sensitive planner intent for delivery, project-breakdown, and brownfield-intake", async () => {
  const delivery = await buildProjectCoordinationPlan({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend", "frontend"],
    invocationId: `coord-mode-delivery-${Date.now()}`,
    objective: "Plan delivery-oriented execution waves.",
    metadata: {
      coordinationMode: "delivery",
    },
  });
  const projectBreakdown = await buildProjectCoordinationPlan({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend", "frontend"],
    invocationId: `coord-mode-breakdown-${Date.now()}`,
    objective: "Decompose the project into ordered domain slices.",
    metadata: {
      coordinationMode: "project-breakdown",
    },
  });
  const brownfieldIntake = await buildProjectCoordinationPlan({
    projectPath: "config/projects/spore.yaml",
    domains: ["backend", "frontend"],
    invocationId: `coord-mode-intake-${Date.now()}`,
    objective: "Investigate an existing system before dispatch.",
    metadata: {
      coordinationMode: "brownfield-intake",
    },
  });

  const deliveryIntent =
    delivery.childInvocations[0]?.metadata.invocationMetadata.plannerIntent;
  const breakdownIntent =
    projectBreakdown.childInvocations[0]?.metadata.invocationMetadata.plannerIntent;
  const intakeIntent =
    brownfieldIntake.childInvocations[0]?.metadata.invocationMetadata.plannerIntent;

  assert.equal(deliveryIntent?.focus, "implementation");
  assert.deepEqual(deliveryIntent?.expectedOutputs, [
    "implementation_work_packages",
    "execution_waves",
    "delivery_dependencies",
  ]);

  assert.equal(breakdownIntent?.focus, "decomposition");
  assert.deepEqual(breakdownIntent?.expectedOutputs, [
    "domain_slices",
    "dependency_ordering",
    "handoff_boundaries",
  ]);

  assert.equal(intakeIntent?.focus, "discovery");
  assert.deepEqual(intakeIntent?.expectedOutputs, [
    "shared_contracts",
    "unresolved_questions",
    "pre_dispatch_discovery",
  ]);
  assert.equal(intakeIntent?.requiresDiscoveryBeforeDispatch, true);
});
