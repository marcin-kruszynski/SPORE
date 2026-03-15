import assert from "node:assert/strict";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createExecution,
  driveExecution,
  recordApprovalDecision,
  recordReviewDecision,
} from "../src/execution/workflow-execution.js";
import { buildExpectedHandoff } from "../src/execution/handoff-context.js";
import { publishWorkflowStepHandoffs } from "../src/execution/workflow-handoffs.js";
import { transitionStepRecord } from "../src/lifecycle/execution-lifecycle.js";
import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import {
  getWorkflowHandoff,
  listWorkflowHandoffConsumers,
  listWorkflowHandoffs,
  markWorkflowHandoffConsumed,
  openOrchestratorDatabase,
  upsertWorkflowHandoff,
  updateStep,
} from "../src/store/execution-store.js";

function run(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(stderr || stdout || `${command} failed with code ${code}`),
      );
    });
  });
}

async function makeTempRepo() {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-repo-"),
  );
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "SPORE Test"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "spore-test@example.com"], {
    cwd: repoRoot,
  });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await fs.mkdir(path.join(repoRoot, "apps", "web"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "apps", "web", "index.tsx"),
    "export const ui = true;\n",
    "utf8",
  );
  await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "docs", "guide.md"), "# guide\n", "utf8");
  await run("git", ["add", "."], { cwd: repoRoot });
  await run("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

function sessionArtifactPath(sessionId: string, suffix: string) {
  return path.join(process.cwd(), "tmp", "sessions", `${sessionId}.${suffix}`);
}

test("workflow handoffs persist ready and consumed records by execution order", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const db = openOrchestratorDatabase(dbPath);
  try {
    upsertWorkflowHandoff(db, {
      id: "handoff-builder-summary",
      executionId: "execution-1",
      fromStepId: "step-builder",
      toStepId: "step-tester",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "implementation_summary",
      status: "ready",
      summary: {
        title: "Builder summary",
        objective: "Ship workflow handoffs",
        outcome: "implemented",
        confidence: "high",
      },
      artifacts: {
        sessionId: "session-builder",
        transcriptPath: "tmp/sessions/session-builder.transcript.md",
        briefPath: "tmp/orchestrator/execution-1/session-builder.brief.md",
        handoffPath: "tmp/sessions/session-builder.handoff.json",
        workspaceId: "workspace-builder",
        proposalArtifactId: null,
        snapshotRef: null,
        snapshotCommit: null,
      },
      payload: {
        changedPaths: ["packages/orchestrator/src/execution/workflow-execution.impl.ts"],
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:00.000Z",
      consumedAt: null,
    });

    upsertWorkflowHandoff(db, {
      id: "handoff-builder-snapshot",
      executionId: "execution-1",
      fromStepId: "step-builder",
      toStepId: "step-tester",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "workspace_snapshot",
      status: "ready",
      summary: {
        title: "Builder snapshot",
        objective: "Ship workflow handoffs",
        outcome: "snapshot-published",
        confidence: "high",
      },
      artifacts: {
        sessionId: "session-builder",
        transcriptPath: "tmp/sessions/session-builder.transcript.md",
        briefPath: "tmp/orchestrator/execution-1/session-builder.brief.md",
        handoffPath: "tmp/sessions/session-builder.handoff.json",
        workspaceId: "workspace-builder",
        proposalArtifactId: null,
        snapshotRef: "refs/spore/handoffs/execution-1/step-builder",
        snapshotCommit: "abc123",
      },
      payload: {
        workspacePurpose: "authoring",
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-12T10:00:01.000Z",
      updatedAt: "2026-03-12T10:00:01.000Z",
      consumedAt: null,
    });

    markWorkflowHandoffConsumed(
      db,
      "handoff-builder-summary",
      "2026-03-12T10:05:00.000Z",
    );

    const allHandoffs = listWorkflowHandoffs(db, {
      executionId: "execution-1",
      limit: 10,
    });
    assert.equal(allHandoffs.length, 2);
    assert.deepEqual(
      allHandoffs.map((record) => record.kind),
      ["implementation_summary", "workspace_snapshot"],
    );

    const consumedHandoff = getWorkflowHandoff(db, "handoff-builder-summary");
    assert.equal(consumedHandoff?.status, "consumed");
    assert.equal(consumedHandoff?.validation?.valid, true);
    assert.equal(
      consumedHandoff?.consumedAt,
      "2026-03-12T10:05:00.000Z",
    );

    const readyOnly = listWorkflowHandoffs(db, {
      executionId: "execution-1",
      status: "ready",
      limit: 10,
    });
    assert.equal(readyOnly.length, 1);
    assert.equal(readyOnly[0]?.kind, "workspace_snapshot");
  } finally {
    db.close();
  }
});

test("published handoffs persist degraded validation metadata for invalid output", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-invalid-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const transcriptPath = path.join(tempRoot, "session.transcript.md");
  const profilePath = path.join(tempRoot, "invalid-builder.yaml");
  await fs.writeFile(
    profilePath,
    [
      "id: builder-invalid",
      "role: builder",
      "handoffPolicy:",
      "  mode: artifact-plus-summary",
      "  outputKind: implementation_summary",
      "  marker: SPORE_HANDOFF_JSON",
      "  requiredSections: [summary, changed_paths, tests_run]",
      "  enforcementMode: review_pending",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    transcriptPath,
    [
      "[stub:agent-output:start]",
      "Builder finished the task without a structured handoff.",
      "[stub:agent-output:end]",
      "",
    ].join("\n"),
    "utf8",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-invalid",
        updatedAt: "2026-03-12T10:00:00.000Z",
        objective: "Validate degraded handoff metadata.",
      },
      step: {
        id: "execution-invalid:step:1",
        sessionId: "session-invalid",
        role: "builder",
        profilePath,
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        {
          id: "execution-invalid:step:1",
          role: "builder",
          wave: 0,
        },
        {
          id: "execution-invalid:step:2",
          role: "tester",
          wave: 1,
        },
      ],
    });

    assert.equal(published.length, 1);
    const primary = published[0] as Record<string, any>;
    assert.equal(primary.validation?.valid, false);
    assert.equal(primary.validation?.mode, "review_pending");
    assert.equal(primary.validation?.degraded, true);
    assert.equal(
      primary.validation?.issues?.some(
        (issue) => issue.code === "missing_marker",
      ),
      true,
    );

    const persisted = getWorkflowHandoff(
      db,
      "handoff-execution-invalid-step-1-implementation_summary",
    );
    assert.equal(persisted?.validation?.valid, false);
    assert.equal(persisted?.validation?.mode, "review_pending");
  } finally {
    db.close();
  }
});

test("coordinator and integrator profiles expose structured handoff contracts", async () => {
  const coordinator = await buildExpectedHandoff({
    profilePath: "config/profiles/coordinator.yaml",
  });
  const integrator = await buildExpectedHandoff({
    profilePath: "config/profiles/integrator.yaml",
  });

  assert.equal(coordinator?.kind, "routing_summary");
  assert.equal(coordinator?.enforcementMode, "review_pending");
  assert.deepEqual(coordinator?.requiredSections, [
    "summary",
    "active_lanes",
    "blockers",
    "next_actions",
  ]);
  assert.equal(integrator?.kind, "integration_summary");
  assert.equal(integrator?.enforcementMode, "blocked");
  assert.deepEqual(integrator?.requiredSections, [
    "summary",
    "verdict",
    "target_branch",
    "integration_branch",
    "blockers",
  ]);
});

test("published planner handoffs degrade malformed coordination plan artifacts", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-planner-invalid-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const transcriptPath = path.join(tempRoot, "planner.transcript.md");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    transcriptPath,
    [
      "[stub:agent-output:start]",
      "[SPORE_HANDOFF_JSON_BEGIN]",
      JSON.stringify(
        {
          summary: "Planner summary",
          affected_domains: "backend",
          domain_tasks: { backend: "ship API" },
          waves: "wave-1",
          dependencies: true,
          shared_contracts: 123,
          unresolved_questions: false,
        },
        null,
        2,
      ),
      "[SPORE_HANDOFF_JSON_END]",
      "[stub:agent-output:end]",
      "",
    ].join("\n"),
    "utf8",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-planner-invalid",
        updatedAt: "2026-03-14T10:00:00.000Z",
        objective: "Validate planner coordination plan handoffs.",
      },
      step: {
        id: "execution-planner-invalid:step:1",
        sessionId: "session-planner-invalid",
        role: "planner",
        profilePath: "config/profiles/planner.yaml",
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        {
          id: "execution-planner-invalid:step:1",
          role: "planner",
          wave: 0,
        },
        {
          id: "execution-planner-invalid:step:2",
          role: "coordinator",
          wave: 1,
        },
      ],
    });

    assert.equal(published.length, 1);
    const primary = published[0] as Record<string, any>;
    assert.equal(primary.kind, "coordination_plan");
    assert.equal(primary.validation?.valid, false);
    assert.equal(primary.validation?.mode, "review_pending");
    assert.deepEqual(
      primary.validation?.issues?.map((issue: Record<string, unknown>) => issue.section),
      [
        "affected_domains",
        "domain_tasks",
        "waves",
        "dependencies",
        "shared_contracts",
        "unresolved_questions",
      ],
    );
  } finally {
    db.close();
  }
});

test("published lead handoffs include durable lead_progress artifacts", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoff-lead-progress-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const transcriptPath = path.join(tempRoot, "lead.transcript.md");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    transcriptPath,
    [
      "[agent:start]",
      "Lead is updating the frontend shell plan.",
      "",
      "[SPORE_HANDOFF_JSON_BEGIN]",
      JSON.stringify(
        {
          summary: "Frontend lane found a hidden dependency in the API contract.",
          next_role: "builder",
          scope: ["apps/web/src"],
          blockers: ["Waiting on backend API contract completion."],
          risks: ["Frontend shell cannot finalize until contract lands."],
          task_id: "task-frontend-shell",
          active_task_id: "task-frontend-shell",
          status: "blocked",
          blocked_on_task_ids: ["task-backend-api"],
          replan_reason: "hidden_dependency",
        },
        null,
        2,
      ),
      "[SPORE_HANDOFF_JSON_END]",
      "[agent:end]",
    ].join("\n"),
    "utf8",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-lead-progress",
        objective: "Dispatch a frontend lane from a coordination plan.",
        metadata: {
          dispatchTask: {
            taskId: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
        },
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
      step: {
        id: "execution-lead-progress:step:1",
        sessionId: "session-lead-progress",
        role: "lead",
        state: "held",
        profilePath: "config/profiles/lead.yaml",
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        {
          id: "execution-lead-progress:step:1",
          role: "lead",
          wave: 0,
        },
        {
          id: "execution-lead-progress:step:2",
          role: "builder",
          wave: 1,
        },
      ],
    });

    const leadProgress = published.find((handoff) => handoff.kind === "lead_progress") as Record<string, any> | undefined;
    assert.ok(leadProgress);
    assert.equal(leadProgress?.payload?.task_id, "task-frontend-shell");
    assert.deepEqual(leadProgress?.payload?.blocked_on_task_ids, ["task-backend-api"]);
    assert.equal(leadProgress?.payload?.replan_reason, "hidden_dependency");
  } finally {
    db.close();
  }
});

test("lead_progress preserves object-form summary outcome text", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoff-lead-object-summary-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const transcriptPath = path.join(tempRoot, "lead-object.transcript.md");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    transcriptPath,
    [
      "[agent:start]",
      "Lead is coordinating frontend work.",
      "",
      "[SPORE_HANDOFF_JSON_BEGIN]",
      JSON.stringify(
        {
          summary: {
            outcome: "Frontend lane is blocked on a backend dependency.",
          },
          next_role: "builder",
          scope: ["apps/web/src"],
          blockers: ["Waiting on backend contract."],
          risks: ["Frontend work may drift from API expectations."],
          task_id: "task-frontend-shell",
          active_task_id: "task-frontend-shell",
          status: "blocked",
          blocked_on_task_ids: ["task-backend-api"],
        },
        null,
        2,
      ),
      "[SPORE_HANDOFF_JSON_END]",
      "[agent:end]",
    ].join("\n"),
    "utf8",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-lead-object-summary",
        objective: "Coordinate frontend lane.",
        metadata: {
          dispatchTask: {
            taskId: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
        },
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
      step: {
        id: "execution-lead-object-summary:step:1",
        sessionId: "session-lead-object-summary",
        role: "lead",
        state: "held",
        profilePath: "config/profiles/lead.yaml",
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        {
          id: "execution-lead-object-summary:step:1",
          role: "lead",
          wave: 0,
        },
        {
          id: "execution-lead-object-summary:step:2",
          role: "builder",
          wave: 1,
        },
      ],
    });

    const leadProgress = published.find((handoff) => handoff.kind === "lead_progress") as Record<string, any> | undefined;
    assert.equal(
      leadProgress?.summary?.outcome,
      "Frontend lane is blocked on a backend dependency.",
    );
    assert.equal(
      leadProgress?.payload?.summary,
      "Frontend lane is blocked on a backend dependency.",
    );
  } finally {
    db.close();
  }
});

test("published workflow handoffs keep clean summary text when the structured summary is a string", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoff-summary-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const transcriptPath = path.join(tempRoot, "scout.transcript.md");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    transcriptPath,
    [
      "[agent:start]",
      '[tool:update] bash: LICENSE',
      "README.md",
      "apps",
      "The builder should add the shared header toggle after wiring the theme provider.",
      "",
      "[SPORE_HANDOFF_JSON_BEGIN]",
      JSON.stringify(
        {
          summary:
            "The dashboard needs a shared header toggle plus app-wide theme context before day/night mode can work.",
          findings: ["Theme provider missing."],
          recommendations: ["Builder adds ThemeProvider and header toggle."],
          risks: ["Token drift in light mode."],
          evidence: ["apps/web/src/main.tsx"],
          scope: {
            in_scope: ["apps/web/src/main.tsx", "apps/web/src/index.css"],
            out_of_scope: ["services/orchestrator"],
          },
          next_role: "builder",
        },
        null,
        2,
      ),
      "[SPORE_HANDOFF_JSON_END]",
      "[agent:end]",
      "",
    ].join("\n"),
    "utf8",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const published = await publishWorkflowStepHandoffs({
      db,
      execution: {
        id: "execution-summary",
        updatedAt: "2026-03-13T21:00:00.000Z",
        objective: "Keep handoff summaries clean.",
      },
      step: {
        id: "execution-summary:step:1",
        sessionId: "session-summary",
        role: "scout",
        profilePath: "config/profiles/scout.yaml",
        updatedAt: "2026-03-13T21:00:00.000Z",
      },
      session: {
        transcriptPath,
      },
      steps: [
        {
          id: "execution-summary:step:1",
          role: "scout",
          wave: 0,
        },
        {
          id: "execution-summary:step:2",
          role: "builder",
          wave: 1,
        },
      ],
    });

    assert.equal(published.length, 1);
    const summary = (published[0]?.summary ?? {}) as Record<string, unknown>;
    assert.match(
      String(summary.outcome ?? ""),
      /shared header toggle plus app-wide theme context/i,
    );
    assert.doesNotMatch(String(summary.outcome ?? ""), /^README\.md/m);
  } finally {
    db.close();
  }
});

test("completed steps publish normalized workflow handoff artifacts", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-execution-"),
  );
  const repoRoot = await makeTempRepo();
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const worktreeRoot = path.join(tempRoot, "worktrees");
  const previousEnv = {
    SPORE_WORKSPACE_REPO_ROOT: process.env.SPORE_WORKSPACE_REPO_ROOT,
    SPORE_WORKTREE_ROOT: process.env.SPORE_WORKTREE_ROOT,
    SPORE_SESSION_DB_PATH: process.env.SPORE_SESSION_DB_PATH,
    SPORE_EVENT_LOG_PATH: process.env.SPORE_EVENT_LOG_PATH,
    SPORE_ORCHESTRATOR_DB_PATH: process.env.SPORE_ORCHESTRATOR_DB_PATH,
  };

  process.env.SPORE_WORKSPACE_REPO_ROOT = repoRoot;
  process.env.SPORE_WORKTREE_ROOT = worktreeRoot;
  process.env.SPORE_SESSION_DB_PATH = sessionDbPath;
  process.env.SPORE_EVENT_LOG_PATH = eventLogPath;
  process.env.SPORE_ORCHESTRATOR_DB_PATH = dbPath;

  t.after(async () => {
    process.env.SPORE_WORKSPACE_REPO_ROOT = previousEnv.SPORE_WORKSPACE_REPO_ROOT;
    process.env.SPORE_WORKTREE_ROOT = previousEnv.SPORE_WORKTREE_ROOT;
    process.env.SPORE_SESSION_DB_PATH = previousEnv.SPORE_SESSION_DB_PATH;
    process.env.SPORE_EVENT_LOG_PATH = previousEnv.SPORE_EVENT_LOG_PATH;
    process.env.SPORE_ORCHESTRATOR_DB_PATH = previousEnv.SPORE_ORCHESTRATOR_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Validate workflow handoff publication and consumption.",
    invocationId: `workflow-handoffs-${Date.now()}`,
  });

  const created = createExecution(invocation, dbPath);
  let detail = await driveExecution(created.execution.id, {
    wait: true,
    timeoutMs: 30000,
    intervalMs: 500,
    stub: true,
    dbPath,
    sessionDbPath,
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reviewPending = detail.steps.find((step) => step.state === "review_pending");
    if (reviewPending) {
      await recordReviewDecision(
        created.execution.id,
        {
          status: "approved",
          decidedBy: "test-runner",
          comments: `advance ${reviewPending.role}`,
        },
        dbPath,
        sessionDbPath,
      );
      detail = await driveExecution(created.execution.id, {
        wait: true,
        timeoutMs: 30000,
        intervalMs: 500,
        stub: true,
        dbPath,
        sessionDbPath,
      });
      continue;
    }
    const approvalPending = detail.steps.find((step) => step.state === "approval_pending");
    if (approvalPending) {
      await recordApprovalDecision(
        created.execution.id,
        {
          status: "approved",
          decidedBy: "test-runner",
          comments: `approve ${approvalPending.role}`,
        },
        dbPath,
        sessionDbPath,
      );
      detail = await driveExecution(created.execution.id, {
        wait: true,
        timeoutMs: 30000,
        intervalMs: 500,
        stub: true,
        dbPath,
        sessionDbPath,
      });
      continue;
    }
    break;
  }

  const db = openOrchestratorDatabase(dbPath);
  try {
    const handoffs = listWorkflowHandoffs(db, {
      executionId: created.execution.id,
      limit: 20,
    });
    const handoffKinds = handoffs.map((record) => record.kind).sort();
    assert.deepEqual(handoffKinds, [
      "implementation_summary",
      "scout_findings",
      "task_brief",
      "verification_summary",
      "workspace_snapshot",
    ]);

    const leadStep = detail.steps.find((step) => step.role === "lead");
    const scoutStep = detail.steps.find((step) => step.role === "scout");
    assert.ok(leadStep?.sessionId);
    assert.ok(scoutStep?.sessionId);

    const [leadHandoffRaw, scoutHandoffRaw] = await Promise.all([
      fs.readFile(sessionArtifactPath(leadStep.sessionId, "handoff.json"), "utf8"),
      fs.readFile(sessionArtifactPath(scoutStep.sessionId, "handoff.json"), "utf8"),
    ]);
    const leadHandoff = JSON.parse(leadHandoffRaw);
    const scoutHandoff = JSON.parse(scoutHandoffRaw);

    assert.equal(leadHandoff.primary.kind, "task_brief");
    assert.equal(leadHandoff.primary.validation.valid, true);
    assert.equal(scoutHandoff.primary.kind, "scout_findings");
    assert.equal(scoutHandoff.primary.validation.valid, true);
  } finally {
    db.close();
  }
});

test("downstream sessions receive curated inbound workflow handoffs", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-context-"),
  );
  const repoRoot = await makeTempRepo();
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const worktreeRoot = path.join(tempRoot, "worktrees");
  const previousEnv = {
    SPORE_WORKSPACE_REPO_ROOT: process.env.SPORE_WORKSPACE_REPO_ROOT,
    SPORE_WORKTREE_ROOT: process.env.SPORE_WORKTREE_ROOT,
    SPORE_SESSION_DB_PATH: process.env.SPORE_SESSION_DB_PATH,
    SPORE_EVENT_LOG_PATH: process.env.SPORE_EVENT_LOG_PATH,
    SPORE_ORCHESTRATOR_DB_PATH: process.env.SPORE_ORCHESTRATOR_DB_PATH,
  };

  process.env.SPORE_WORKSPACE_REPO_ROOT = repoRoot;
  process.env.SPORE_WORKTREE_ROOT = worktreeRoot;
  process.env.SPORE_SESSION_DB_PATH = sessionDbPath;
  process.env.SPORE_EVENT_LOG_PATH = eventLogPath;
  process.env.SPORE_ORCHESTRATOR_DB_PATH = dbPath;

  t.after(async () => {
    process.env.SPORE_WORKSPACE_REPO_ROOT = previousEnv.SPORE_WORKSPACE_REPO_ROOT;
    process.env.SPORE_WORKTREE_ROOT = previousEnv.SPORE_WORKTREE_ROOT;
    process.env.SPORE_SESSION_DB_PATH = previousEnv.SPORE_SESSION_DB_PATH;
    process.env.SPORE_EVENT_LOG_PATH = previousEnv.SPORE_EVENT_LOG_PATH;
    process.env.SPORE_ORCHESTRATOR_DB_PATH = previousEnv.SPORE_ORCHESTRATOR_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Validate workflow handoff publication and consumption.",
    invocationId: `workflow-handoffs-context-${Date.now()}`,
  });

  const created = createExecution(invocation, dbPath);
  let detail = await driveExecution(created.execution.id, {
    wait: true,
    timeoutMs: 30000,
    intervalMs: 500,
    stub: true,
    dbPath,
    sessionDbPath,
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reviewPending = detail.steps.find((step) => step.state === "review_pending");
    if (reviewPending) {
      await recordReviewDecision(
        created.execution.id,
        {
          status: "approved",
          decidedBy: "test-runner",
          comments: `advance ${reviewPending.role}`,
        },
        dbPath,
        sessionDbPath,
      );
      detail = await driveExecution(created.execution.id, {
        wait: true,
        timeoutMs: 30000,
        intervalMs: 500,
        stub: true,
        dbPath,
        sessionDbPath,
      });
      continue;
    }
    const approvalPending = detail.steps.find((step) => step.state === "approval_pending");
    if (approvalPending) {
      await recordApprovalDecision(
        created.execution.id,
        {
          status: "approved",
          decidedBy: "test-runner",
          comments: `approve ${approvalPending.role}`,
        },
        dbPath,
        sessionDbPath,
      );
      detail = await driveExecution(created.execution.id, {
        wait: true,
        timeoutMs: 30000,
        intervalMs: 500,
        stub: true,
        dbPath,
        sessionDbPath,
      });
      continue;
    }
    break;
  }

  const builderStep = detail.steps.find((step) => step.role === "builder");
  const testerStep = detail.steps.find((step) => step.role === "tester");
  assert.ok(builderStep?.sessionId);
  assert.ok(testerStep?.sessionId);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const consumers = listWorkflowHandoffConsumers(db, {
      executionId: created.execution.id,
      limit: 20,
    });
    assert.ok(consumers.length >= 2);
    assert.ok(
      consumers.some((record) => record.consumerStepId === builderStep.id),
    );
    assert.ok(
      consumers.some((record) => record.consumerStepId === testerStep.id),
    );
  } finally {
    db.close();
  }

  const [builderPlanRaw, testerPlanRaw] = await Promise.all([
    fs.readFile(sessionArtifactPath(builderStep.sessionId, "plan.json"), "utf8"),
    fs.readFile(sessionArtifactPath(testerStep.sessionId, "plan.json"), "utf8"),
  ]);
  const builderPlan = JSON.parse(builderPlanRaw);
  const testerPlan = JSON.parse(testerPlanRaw);

  assert.deepEqual(
    builderPlan.metadata.inboundHandoffs.map((record) => record.kind).sort(),
    ["scout_findings", "task_brief"],
  );
  assert.equal(
    builderPlan.metadata.expectedHandoff.kind,
    "implementation_summary",
  );
  assert.deepEqual(
    testerPlan.metadata.inboundHandoffs.map((record) => record.kind).sort(),
    ["implementation_summary", "workspace_snapshot"],
  );
  assert.equal(
    testerPlan.metadata.expectedHandoff.kind,
    "verification_summary",
  );
});

test("blocked handoff validation prevents review approval from advancing the step", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-blocked-review-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/review-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "docs",
    roles: ["lead", "reviewer"],
    objective: "Validate blocked handoff approval protection.",
    invocationId: `workflow-handoffs-blocked-${Date.now()}`,
  });
  const created = createExecution(invocation, dbPath);
  const reviewStep = created.steps.find((step) => step.role === "reviewer");
  assert.ok(reviewStep?.id);

  const db = openOrchestratorDatabase(dbPath);
  try {
    upsertWorkflowHandoff(db, {
      id: "handoff-blocked-review-step",
      executionId: created.execution.id,
      fromStepId: reviewStep.id,
      toStepId: "",
      sourceRole: "reviewer",
      targetRole: null,
      kind: "review_summary",
      status: "ready",
      summary: {
        title: "Blocked review summary",
        outcome: "invalid structured payload",
        confidence: "low",
      },
      artifacts: {
        sessionId: reviewStep.sessionId,
        transcriptPath: null,
        briefPath: null,
        handoffPath: null,
        workspaceId: null,
        proposalArtifactId: null,
        snapshotRef: null,
        snapshotCommit: null,
      },
      payload: {},
      validation: {
        valid: false,
        degraded: true,
        mode: "blocked",
        issues: [
          {
            code: "missing_required_section",
            message: "summary is malformed",
            section: "summary",
          },
        ],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consumedAt: null,
    });
    updateStep(
      db,
      transitionStepRecord(reviewStep, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: null,
      }),
    );
  } finally {
    db.close();
  }

  await assert.rejects(
    () =>
      recordReviewDecision(
        created.execution.id,
        {
          status: "approved",
          decidedBy: "test-runner",
          comments: "approve",
        },
        dbPath,
        sessionDbPath,
      ),
    /blocked workflow handoff validation issues/,
  );
});

test("approving a review-pending step without approval requirement completes it", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-review-complete-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Validate review approval semantics for degraded handoffs.",
    invocationId: `workflow-handoffs-review-complete-${Date.now()}`,
  });
  const created = createExecution(invocation, dbPath);
  const leadStep = created.steps.find((step) => step.role === "lead");
  assert.ok(leadStep?.id);

  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(leadStep, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: null,
        approvalRequired: false,
      }),
    );
  } finally {
    db.close();
  }

  const detail = await recordReviewDecision(
    created.execution.id,
    {
      status: "approved",
      decidedBy: "test-runner",
      comments: "approve degraded handoff",
    },
    dbPath,
    sessionDbPath,
  );
  const updatedLeadStep = detail?.steps.find((step) => step.id === leadStep.id);
  assert.equal(updatedLeadStep?.state, "completed");
  assert.equal(updatedLeadStep?.approvalStatus, "approved");
});

test("changes requested can rerun a single-step blocked handoff workflow", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-single-step-rework-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/feature-promotion.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "backend",
    roles: ["integrator"],
    objective: "Validate blocked single-step handoff recovery.",
    invocationId: `workflow-handoffs-single-step-${Date.now()}`,
  });
  const created = createExecution(invocation, dbPath);
  const integratorStep = created.steps[0];
  assert.ok(integratorStep?.id);

  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(integratorStep, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: null,
        lastError: "handoff_validation_blocked",
      }),
    );
    upsertWorkflowHandoff(db, {
      id: "handoff-single-step-integrator",
      executionId: created.execution.id,
      fromStepId: integratorStep.id,
      toStepId: "",
      sourceRole: "integrator",
      targetRole: null,
      kind: "integration_summary",
      status: "ready",
      summary: {
        title: "Invalid integration summary",
        outcome: "blocked",
      },
      artifacts: {},
      payload: {},
      validation: {
        valid: false,
        degraded: true,
        mode: "blocked",
        issues: [{ code: "missing_required_section", message: "missing verdict" }],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consumedAt: null,
    });
  } finally {
    db.close();
  }

  const detail = await recordReviewDecision(
    created.execution.id,
    {
      status: "changes_requested",
      decidedBy: "test-runner",
      comments: "rerun integrator with fixed handoff",
    },
    dbPath,
    sessionDbPath,
  );
  const updatedStep = detail?.steps.find((step) => step.id === integratorStep.id);
  assert.equal(updatedStep?.state, "planned");
  assert.equal(updatedStep?.attemptCount, 2);
  assert.match(String(updatedStep?.lastError ?? ""), /handoff_validation_rework/);
});
