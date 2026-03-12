import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listWorkflowHandoffConsumers,
  listWorkflowHandoffs,
  openOrchestratorDatabase,
  recordWorkflowHandoffConsumption,
  upsertWorkflowHandoff,
} from "../src/store/execution-store.js";
import { publishWorkflowStepHandoffs } from "../src/execution/workflow-handoffs.js";
import { handoffsConsumedByStep, selectInboundWorkflowHandoffs } from "../src/execution/handoff-context.js";

test("workflow handoff consumers record fan-out targets idempotently", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-handoff-fanout-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const db = openOrchestratorDatabase(path.join(tempRoot, "orchestrator.sqlite"));
  try {
    upsertWorkflowHandoff(db, {
      id: "handoff-fanout-builder-summary",
      executionId: "execution-fanout",
      fromStepId: "step-builder",
      toStepId: "",
      sourceRole: "builder",
      targetRole: null,
      kind: "implementation_summary",
      status: "ready",
      summary: {
        title: "Builder summary",
      },
      artifacts: {},
      payload: {},
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-12T12:00:00.000Z",
      updatedAt: "2026-03-12T12:00:00.000Z",
      consumedAt: null,
    });

    recordWorkflowHandoffConsumption(db, {
      id: "consumer-builder-summary-tester",
      executionId: "execution-fanout",
      handoffId: "handoff-fanout-builder-summary",
      consumerStepId: "step-tester",
      consumerRole: "tester",
      consumerSessionId: "session-tester",
      consumedAt: "2026-03-12T12:05:00.000Z",
    });
    recordWorkflowHandoffConsumption(db, {
      id: "consumer-builder-summary-reviewer",
      executionId: "execution-fanout",
      handoffId: "handoff-fanout-builder-summary",
      consumerStepId: "step-reviewer",
      consumerRole: "reviewer",
      consumerSessionId: "session-reviewer",
      consumedAt: "2026-03-12T12:06:00.000Z",
    });
    recordWorkflowHandoffConsumption(db, {
      id: "consumer-builder-summary-reviewer-dup",
      executionId: "execution-fanout",
      handoffId: "handoff-fanout-builder-summary",
      consumerStepId: "step-reviewer",
      consumerRole: "reviewer",
      consumerSessionId: "session-reviewer",
      consumedAt: "2026-03-12T12:06:30.000Z",
    });

    const consumers = listWorkflowHandoffConsumers(db, {
      handoffId: "handoff-fanout-builder-summary",
      limit: 10,
    });
    assert.equal(consumers.length, 2);
    assert.deepEqual(
      consumers.map((record) => record.consumerStepId).sort(),
      ["step-reviewer", "step-tester"],
    );
    assert.equal(consumers[0]?.handoffId, "handoff-fanout-builder-summary");

    const handoffs = listWorkflowHandoffs(db, {
      executionId: "execution-fanout",
      limit: 10,
    });
    assert.equal(handoffs[0]?.status, "ready");
  } finally {
    db.close();
  }
});

test("broadcast handoffs can be selected and consumed by multiple next-wave steps", () => {
  const execution = { id: "execution-fanout" };
  const steps = [
    { id: "step-lead", role: "lead", wave: 0, sequence: 0 },
    { id: "step-builder", role: "builder", wave: 1, sequence: 1 },
    { id: "step-reviewer", role: "reviewer", wave: 1, sequence: 2 },
  ];
  const handoffs = [
    {
      id: "handoff-lead-brief",
      executionId: "execution-fanout",
      fromStepId: "step-lead",
      toStepId: "",
      sourceRole: "lead",
      targetRole: null,
      kind: "task_brief",
      status: "ready",
      summary: { title: "Lead brief" },
      artifacts: {},
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
    },
  ];

  const builderInbound = selectInboundWorkflowHandoffs({
    execution,
    step: steps[1],
    steps,
    handoffs,
  });
  const reviewerInbound = selectInboundWorkflowHandoffs({
    execution,
    step: steps[2],
    steps,
    handoffs,
  });

  assert.equal(builderInbound.length, 1);
  assert.equal(reviewerInbound.length, 1);
  assert.equal(builderInbound[0]?.id, "handoff-lead-brief");
  assert.equal(reviewerInbound[0]?.id, "handoff-lead-brief");
  assert.equal(handoffsConsumedByStep(steps[1], builderInbound).length, 1);
  assert.equal(handoffsConsumedByStep(steps[2], reviewerInbound).length, 1);
});

test("republishing a handoff clears stale consumer rows for the same handoff id", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-handoff-fanout-republish-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const db = openOrchestratorDatabase(path.join(tempRoot, "orchestrator.sqlite"));
  const transcriptPath = path.join(tempRoot, "session.transcript.md");
  const profilePath = path.join(tempRoot, "builder-profile.yaml");
  await fs.writeFile(
    profilePath,
    [
      "id: builder",
      "role: builder",
      "handoffPolicy:",
      "  mode: artifact-plus-summary",
      "  outputKind: implementation_summary",
      "  marker: SPORE_HANDOFF_JSON",
      "  requiredSections: [summary, changed_paths, tests_run]",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    await fs.writeFile(
      transcriptPath,
      [
        "[stub:agent-output:start]",
        "[SPORE_HANDOFF_JSON_BEGIN]",
        JSON.stringify(
          {
            summary: { title: "Builder summary" },
            changed_paths: ["apps/web/src/main.ts"],
            tests_run: ["npm run test:web"],
          },
          null,
          2,
        ),
        "[SPORE_HANDOFF_JSON_END]",
        "[stub:agent-output:end]",
      ].join("\n"),
      "utf8",
    );

    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-republish",
        updatedAt: "2026-03-12T12:00:00.000Z",
        objective: "Republish handoff",
      },
      step: {
        id: "execution-republish:step:1",
        sessionId: "session-republish",
        role: "builder",
        profilePath,
        updatedAt: "2026-03-12T12:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        { id: "execution-republish:step:1", role: "builder", wave: 0 },
        { id: "execution-republish:step:2", role: "tester", wave: 1 },
      ],
    });

    recordWorkflowHandoffConsumption(db, {
      id: "consumer-republish-old",
      executionId: "execution-republish",
      handoffId: String(published[0]?.id ?? ""),
      consumerStepId: "execution-republish:step:2",
      consumerRole: "tester",
      consumerSessionId: "session-tester",
      consumedAt: "2026-03-12T12:05:00.000Z",
    });

    await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-republish",
        updatedAt: "2026-03-12T12:10:00.000Z",
        objective: "Republish handoff",
      },
      step: {
        id: "execution-republish:step:1",
        sessionId: "session-republish",
        role: "builder",
        profilePath,
        updatedAt: "2026-03-12T12:10:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        { id: "execution-republish:step:1", role: "builder", wave: 0 },
        { id: "execution-republish:step:2", role: "tester", wave: 1 },
      ],
    });

    const consumers = listWorkflowHandoffConsumers(db, {
      executionId: "execution-republish",
      limit: 10,
    });
    assert.equal(consumers.length, 0);
  } finally {
    db.close();
  }
});
