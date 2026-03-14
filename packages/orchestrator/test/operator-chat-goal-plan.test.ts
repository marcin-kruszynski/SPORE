import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOperatorThread,
  postOperatorThreadMessage,
} from "../src/self-build/operator-chat.js";

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

test("operator threads normalize project ids into durable project paths", async () => {
  const { root, dbPath } = await makeTempDbPath();

  try {
    const thread = await createOperatorThread(
      {
        message:
          "Refresh the README introduction to emphasize that SPORE is modular, profile-driven, and documentation-first.",
        projectId: "spore",
        safeMode: false,
      },
      dbPath,
    );

    assert.equal(thread.metadata?.execution?.projectId, "spore");
    assert.equal(
      thread.metadata?.execution?.projectPath,
      "config/projects/spore.yaml",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("operator chat help reply mentions merge phrasing for the final operator action", async () => {
  const { root, dbPath } = await makeTempDbPath();

  try {
    const thread = await createOperatorThread(
      {
        message:
          "Add a compact density toggle for Agent Cockpit lane cards and verify the final merge path.",
        projectId: "spore",
        safeMode: false,
      },
      dbPath,
    );

    const help = await postOperatorThreadMessage(
      String(thread.id),
      {
        message: "help",
        by: "test-runner",
        source: "test",
      },
      dbPath,
    );

    assert.match(
      JSON.stringify(help.messages ?? []),
      /merge/i,
    );
    assert.ok(thread.metadata?.execution?.projectPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
