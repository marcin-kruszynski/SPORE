import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";

import { writeLaunchAssets, writeLaunchScript } from "../src/launchers/tmux-launcher.js";
import { buildSessionPlan } from "../src/planner/build-session-plan.js";

function runNode(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
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
      reject(new Error(stderr || stdout || `node failed with ${code}`));
    });
  });
}

test("buildTsxEntrypointArgs works when node runs outside the repository tree", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spore-tsx-entrypoint-"));
  const scriptPath = path.join(tempRoot, "hello.ts");

  await fs.writeFile(scriptPath, 'console.log("tsx-entrypoint-ok");\n', "utf8");

  const result = await runNode(
    tempRoot,
    buildTsxEntrypointArgs(scriptPath),
  );

  assert.match(result.stdout, /tsx-entrypoint-ok/);
});

test("pi-rpc launch scripts embed a repository-resolved tsx import path", async () => {
  const sessionId = `tsx-launch-script-${Date.now()}`;
  const contextPath = path.join(PROJECT_ROOT, "tmp", "sessions", `${sessionId}.context.json`);
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/lead.yaml",
    projectPath: "config/projects/spore.yaml",
    sessionId,
    runId: `${sessionId}-run`,
  });

  await fs.writeFile(contextPath, "{}\n", "utf8");
  const assets = await writeLaunchAssets({
    sessionId,
    plan,
    contextPath,
  });

  await writeLaunchScript({
    launcherType: "pi-rpc",
    assets,
    plan,
    cwd: PROJECT_ROOT,
  });

  const launchScript = await fs.readFile(assets.launchScriptPath, "utf8");
  assert.match(launchScript, /node --import=['"]?\/.*tsx\/dist\/loader\.mjs['"]?/);
});
