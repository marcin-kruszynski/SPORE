import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOperatorThread } from "../src/self-build/operator-chat.js";

async function makeTempDbPath() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-operator-goal-plan-"));
  return {
    root,
    dbPath: path.join(root, "orchestrator.sqlite"),
  };
}

test("feature-oriented frontend requests prefer a delivery workflow over the audit-style ui pass", async () => {
  const { root, dbPath } = await makeTempDbPath();

  try {
    const thread = await createOperatorThread(
      {
        message: "Add button to switch between day/night mode in spore mission control dashboard",
        projectId: "spore",
        safeMode: false,
      },
      dbPath,
    );

    const recommendations = thread.context?.goalPlan?.recommendations ?? [];
    assert.ok(Array.isArray(recommendations));
    assert.ok(recommendations.length > 0);

    const workflowPaths = recommendations
      .map((entry) => entry?.metadata?.workflowPath)
      .filter(Boolean);

    assert.ok(
      workflowPaths.includes("config/workflows/feature-delivery.yaml"),
      `expected feature-delivery in recommendations, got ${workflowPaths.join(", ")}`,
    );
    assert.ok(
      !workflowPaths.includes("config/workflows/frontend-ui-pass.yaml"),
      `frontend-ui-pass should not be selected as the primary workflow for feature implementation requests: ${workflowPaths.join(", ")}`,
    );
    assert.equal(thread.metadata?.execution?.stub, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
