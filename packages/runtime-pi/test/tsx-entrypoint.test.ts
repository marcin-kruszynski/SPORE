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

test("pi launch scripts fail loudly when PI is unavailable instead of falling back to stub", async () => {
  const sessionId = `tsx-launch-script-missing-pi-${Date.now()}`;
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

  const originalPiBin = process.env.SPORE_PI_BIN;
  process.env.SPORE_PI_BIN = path.join(os.tmpdir(), `missing-pi-${Date.now()}`);
  try {
    await writeLaunchScript({
      launcherType: "pi-rpc",
      assets,
      plan,
      cwd: PROJECT_ROOT,
      piBinaryOverride: null,
    });
  } finally {
    if (originalPiBin === undefined) {
      delete process.env.SPORE_PI_BIN;
    } else {
      process.env.SPORE_PI_BIN = originalPiBin;
    }
  }

  const launchScript = await fs.readFile(assets.launchScriptPath, "utf8");
  assert.doesNotMatch(launchScript, /bootstrap stub launcher/i);
  assert.match(launchScript, /pi CLI is required for runtime launch/i);
});

test("writeLaunchAssets does not duplicate expected handoff contract when a brief is attached", async () => {
  const sessionId = `tsx-launch-brief-${Date.now()}`;
  const contextPath = path.join(
    PROJECT_ROOT,
    "tmp",
    "sessions",
    `${sessionId}.context.json`,
  );
  const briefPath = path.join(
    PROJECT_ROOT,
    "tmp",
    "sessions",
    `${sessionId}.brief.md`,
  );
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/scout.yaml",
    projectPath: "config/projects/spore.yaml",
    sessionId,
    runId: `${sessionId}-run`,
    expectedHandoff: {
      kind: "scout_findings",
      marker: "SPORE_HANDOFF_JSON",
      requiredSections: [
        "summary",
        "findings",
        "recommendations",
        "risks",
        "evidence",
        "scope",
        "next_role",
      ],
      allowedNextRoles: ["builder"],
    },
  } as never);

  await fs.writeFile(contextPath, "{}\n", "utf8");
  await fs.writeFile(
    briefPath,
    [
      "# SPORE Workflow Invocation Brief",
      "",
      "## Expected Handoff Output",
      "- Kind: scout_findings",
      "- Marker: SPORE_HANDOFF_JSON",
      "- Required sections: summary, findings, recommendations, risks, evidence, scope, next_role",
      "- Allowed next roles: builder",
      "",
      "- End with [SPORE_HANDOFF_JSON_BEGIN] ... [SPORE_HANDOFF_JSON_END].",
      "",
    ].join("\n"),
    "utf8",
  );

  const assets = await writeLaunchAssets({
    sessionId,
    plan,
    contextPath,
    briefPath,
  });

  const prompt = await fs.readFile(assets.promptPath, "utf8");
  assert.equal(prompt.match(/## Expected Handoff Output/g)?.length ?? 0, 1);
});
