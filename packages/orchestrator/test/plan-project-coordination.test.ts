import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { planProjectCoordination } from "../src/invocation/plan-workflow-invocation.js";

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
