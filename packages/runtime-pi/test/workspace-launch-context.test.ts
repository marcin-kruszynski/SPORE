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
