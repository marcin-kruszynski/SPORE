import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTsxEntrypointArgs } from "@spore/core";
import { commandExists, PROJECT_ROOT } from "@spore/runtime-pi";
import {
  type CreateWorkspaceOptions,
  createWorkspace,
  type RemoveWorkspaceOptions,
  removeWorkspace,
} from "@spore/workspace-manager";
import { buildSessionPlan } from "../src/planner/build-session-plan.js";

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...env,
      },
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
        new Error(stderr || stdout || `command failed: ${args.join(" ")}`),
      );
    });
  });
}

test("stub runtime launch records actual workspace cwd in launch context", async (t) => {
  if (!(await commandExists("tmux"))) {
    t.skip("tmux not available");
    return;
  }

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workspace-cwd-"),
  );
  const worktreeRoot = path.join(tempRoot, "worktrees");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const sessionId = `workspace-cwd-${Date.now()}`;
  const runId = `${sessionId}-run`;

  const workspaceOptions: CreateWorkspaceOptions = {
    repoRoot: PROJECT_ROOT,
    worktreeRoot,
    workspaceId: `ws-${Date.now()}`,
    projectId: "spore",
    ownerType: "work-item-run",
    ownerId: runId,
    mutationScope: ["apps/web", "docs"],
  };
  const workspace = await createWorkspace(workspaceOptions);

  const artifactsBase = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  t.after(async () => {
    const removeOptions: RemoveWorkspaceOptions = {
      repoRoot: PROJECT_ROOT,
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      force: true,
    };
    await removeWorkspace(removeOptions).catch(() => {});
    await fs.rm(worktreeRoot, { recursive: true, force: true });
    await Promise.all([
      fs.rm(`${artifactsBase}.prompt.md`, { force: true }),
      fs.rm(`${artifactsBase}.launch.sh`, { force: true }),
      fs.rm(`${artifactsBase}.transcript.md`, { force: true }),
      fs.rm(`${artifactsBase}.exit.json`, { force: true }),
      fs.rm(`${artifactsBase}.pi-events.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.stderr.log`, { force: true }),
      fs.rm(`${artifactsBase}.pi-session.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.control.ndjson`, { force: true }),
      fs.rm(`${artifactsBase}.rpc-status.json`, { force: true }),
      fs.rm(`${artifactsBase}.launch-context.json`, { force: true }),
      fs.rm(`${artifactsBase}.context.json`, { force: true }),
      fs.rm(`${artifactsBase}.plan.json`, { force: true }),
    ]);
  });

  await runNode(
    buildTsxEntrypointArgs("packages/runtime-pi/src/cli/run-session-plan.ts", [
      "--profile",
      "config/profiles/builder.yaml",
      "--project",
      "config/projects/spore.yaml",
      "--session-id",
      sessionId,
      "--run-id",
      runId,
      "--stub",
      "--stub-seconds",
      "0",
      "--wait",
      "--no-monitor",
      "--cwd",
      workspace.worktreePath,
      "--workspace-id",
      workspace.id,
      "--workspace-branch",
      workspace.branchName,
      "--workspace-base-ref",
      workspace.baseRef ?? "HEAD",
    ]),
    {
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
  );

  const [launchContextRaw, transcriptRaw] = await Promise.all([
    fs.readFile(`${artifactsBase}.launch-context.json`, "utf8"),
    fs.readFile(`${artifactsBase}.transcript.md`, "utf8"),
  ]);
  const launchContext = JSON.parse(launchContextRaw);

  assert.equal(launchContext.cwd, workspace.worktreePath);
  assert.equal(launchContext.workspaceId, workspace.id);
  assert.equal(launchContext.branchName, workspace.branchName);
  assert.match(transcriptRaw, new RegExp(workspace.id));
});

test("plan workspace cwd is used when session cwd is omitted", async (t) => {
  if (!(await commandExists("tmux"))) {
    t.skip("tmux not available");
    return;
  }

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workspace-plan-cwd-"),
  );
  const worktreeRoot = path.join(tempRoot, "worktrees");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const sessionId = `workspace-plan-cwd-${Date.now()}`;
  const runId = `${sessionId}-run`;

  const workspaceOptions: CreateWorkspaceOptions = {
    repoRoot: PROJECT_ROOT,
    worktreeRoot,
    workspaceId: `ws-${Date.now()}`,
    projectId: "spore",
    ownerType: "work-item-run",
    ownerId: runId,
    mutationScope: ["apps/web", "docs"],
  };
  const workspace = await createWorkspace(workspaceOptions);
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/builder.yaml",
    projectPath: "config/projects/spore.yaml",
    sessionId,
    runId,
    cwd: workspace.worktreePath,
    workspaceId: workspace.id,
    workspaceBranch: workspace.branchName,
    workspaceBaseRef: workspace.baseRef ?? "HEAD",
    workspacePurpose: "authoring",
  });
  plan.session.cwd = null;

  const artifactsBase = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  const planPath = path.join(tempRoot, `${sessionId}.plan.json`);
  t.after(async () => {
    const removeOptions: RemoveWorkspaceOptions = {
      repoRoot: PROJECT_ROOT,
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      force: true,
    };
    await removeWorkspace(removeOptions).catch(() => {});
    await fs.rm(worktreeRoot, { recursive: true, force: true });
    await fs.rm(planPath, { force: true });
    await Promise.all([
      fs.rm(`${artifactsBase}.prompt.md`, { force: true }),
      fs.rm(`${artifactsBase}.launch.sh`, { force: true }),
      fs.rm(`${artifactsBase}.transcript.md`, { force: true }),
      fs.rm(`${artifactsBase}.exit.json`, { force: true }),
      fs.rm(`${artifactsBase}.pi-events.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.stderr.log`, { force: true }),
      fs.rm(`${artifactsBase}.pi-session.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.control.ndjson`, { force: true }),
      fs.rm(`${artifactsBase}.rpc-status.json`, { force: true }),
      fs.rm(`${artifactsBase}.launch-context.json`, { force: true }),
      fs.rm(`${artifactsBase}.context.json`, { force: true }),
      fs.rm(`${artifactsBase}.plan.json`, { force: true }),
    ]);
  });

  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  await runNode(
    buildTsxEntrypointArgs("packages/runtime-pi/src/cli/run-session-plan.ts", [
      "--plan",
      planPath,
      "--stub",
      "--stub-seconds",
      "0",
      "--wait",
      "--no-monitor",
    ]),
    {
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
  );

  const [launchContextRaw, promptRaw] = await Promise.all([
    fs.readFile(`${artifactsBase}.launch-context.json`, "utf8"),
    fs.readFile(`${artifactsBase}.prompt.md`, "utf8"),
  ]);
  const launchContext = JSON.parse(launchContextRaw);

  assert.equal(launchContext.cwd, workspace.worktreePath);
  assert.match(promptRaw, new RegExp(workspace.worktreePath));
});

test("prompt includes inbound handoff summary and expected output contract", async (t) => {
  if (!(await commandExists("tmux"))) {
    t.skip("tmux not available");
    return;
  }

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workspace-handoffs-prompt-"),
  );
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const sessionId = `workspace-handoffs-prompt-${Date.now()}`;
  const runId = `${sessionId}-run`;
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/builder.yaml",
    projectPath: "config/projects/spore.yaml",
    sessionId,
    runId,
    inboundHandoffs: [
      {
        id: "handoff-scout-findings",
        kind: "scout_findings",
        sourceRole: "scout",
        targetRole: "builder",
        summary: {
          title: "Scout findings",
        },
        artifacts: {
          handoffPath: "tmp/sessions/scout.handoff.json",
        },
      },
    ],
    expectedHandoff: {
      kind: "implementation_summary",
      marker: "SPORE_HANDOFF_JSON",
      requiredSections: ["summary", "changed_paths", "tests_run"],
    },
  } as never);
  const planPath = path.join(tempRoot, `${sessionId}.plan.json`);
  const artifactsBase = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await Promise.all([
      fs.rm(`${artifactsBase}.prompt.md`, { force: true }),
      fs.rm(`${artifactsBase}.launch.sh`, { force: true }),
      fs.rm(`${artifactsBase}.transcript.md`, { force: true }),
      fs.rm(`${artifactsBase}.exit.json`, { force: true }),
      fs.rm(`${artifactsBase}.pi-events.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.stderr.log`, { force: true }),
      fs.rm(`${artifactsBase}.pi-session.jsonl`, { force: true }),
      fs.rm(`${artifactsBase}.control.ndjson`, { force: true }),
      fs.rm(`${artifactsBase}.rpc-status.json`, { force: true }),
      fs.rm(`${artifactsBase}.launch-context.json`, { force: true }),
      fs.rm(`${artifactsBase}.context.json`, { force: true }),
      fs.rm(`${artifactsBase}.plan.json`, { force: true }),
    ]);
  });

  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  await runNode(
    buildTsxEntrypointArgs("packages/runtime-pi/src/cli/run-session-plan.ts", [
      "--plan",
      planPath,
      "--stub",
      "--stub-seconds",
      "0",
      "--wait",
      "--no-monitor",
    ]),
    {
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
  );

  const promptRaw = await fs.readFile(`${artifactsBase}.prompt.md`, "utf8");
  assert.match(promptRaw, /## Inbound Handoffs/);
  assert.match(promptRaw, /scout_findings from scout to builder/);
  assert.match(promptRaw, /## Expected Handoff Output/);
  assert.match(promptRaw, /SPORE_HANDOFF_JSON_BEGIN/);
});
