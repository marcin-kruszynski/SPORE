import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../metadata/constants.js";
import { commandExists, resolveCommandBinary } from "./resolve-binary.js";

export { commandExists };

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
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
      reject(new Error(stderr || stdout || `${command} failed with code ${code}`));
    });
  });
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function sanitizeTmuxSessionName(sessionId) {
  return `spore-${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function readOptionalFile(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeLaunchAssets({ sessionId, plan, contextPath, briefPath = null }) {
  const basePath = path.join(PROJECT_ROOT, "tmp", "sessions");
  await fs.mkdir(basePath, { recursive: true });

  const promptPath = path.join(basePath, `${sessionId}.prompt.md`);
  const launchScriptPath = path.join(basePath, `${sessionId}.launch.sh`);
  const transcriptPath = path.join(basePath, `${sessionId}.transcript.md`);
  const exitPath = path.join(basePath, `${sessionId}.exit.json`);
  const piEventsPath = path.join(basePath, `${sessionId}.pi-events.jsonl`);
  const stderrPath = path.join(basePath, `${sessionId}.stderr.log`);
  const piSessionPath = path.join(basePath, `${sessionId}.pi-session.jsonl`);
  const controlPath = path.join(basePath, `${sessionId}.control.ndjson`);
  const rpcStatusPath = path.join(basePath, `${sessionId}.rpc-status.json`);
  const launchContextPath = path.join(basePath, `${sessionId}.launch-context.json`);
  const rolePromptPath = plan.pi?.systemPromptRef
    ? path.join(PROJECT_ROOT, plan.pi.systemPromptRef)
    : null;
  const rolePrompt = await readOptionalFile(rolePromptPath);
  const briefContent = briefPath
    ? await readOptionalFile(path.isAbsolute(briefPath) ? briefPath : path.join(PROJECT_ROOT, briefPath))
    : null;

  const prompt = [
    "# SPORE Runtime Session",
    "",
    `You are executing session \`${plan.session.id}\` for run \`${plan.session.runId}\`.`,
    "",
    "## Profile",
    `- Role: ${plan.session.role}`,
    `- Profile: ${plan.session.profileId}`,
    "",
    "## Project",
    `- Project: ${plan.project?.name ?? "N/A"}`,
    `- Type: ${plan.project?.type ?? "N/A"}`,
    "",
    "## Context Files",
    ...plan.pi.contextFiles.map((filePath) => `- ${filePath}`),
    "",
    "## Startup Context",
    `- Retrieval bundle: ${contextPath}`,
    plan.session?.cwd ? `- Working directory: ${plan.session.cwd}` : null,
    plan.metadata?.workspace?.id ? `- Workspace ID: ${plan.metadata.workspace.id}` : null,
    plan.metadata?.workspace?.branchName ? `- Workspace branch: ${plan.metadata.workspace.branchName}` : null,
    "",
    "Use the project documentation and the startup context before taking action.",
    "",
    "## Runtime Contract",
    "- Treat this as a bounded workflow step, not an open-ended coding session.",
    "- Prefer a direct deliverable over exploratory tool usage.",
    "- Do not inspect session health, tmux state, or runtime internals unless explicitly required.",
    "- End the turn immediately after producing the requested deliverable.",
    rolePrompt
      ? [
          "",
          "## Role Overlay",
          rolePrompt.trim()
        ].join("\n")
      : "",
    briefContent
      ? [
          "",
          "## Invocation Brief",
          briefContent.trim()
        ].join("\n")
      : ""
  ].filter(Boolean).join("\n");

  await fs.writeFile(promptPath, `${prompt}\n`, "utf8");

  return {
    promptPath,
    launchScriptPath,
    transcriptPath,
    exitPath,
    piEventsPath,
    stderrPath,
    piSessionPath,
    controlPath,
    rpcStatusPath,
    launchContextPath
  };
}

export async function writeLaunchScript({
  launcherType,
  assets,
  stubDurationSeconds = 2,
  cwd = PROJECT_ROOT,
  workspace = null
}) {
  const piBinary =
    launcherType === "pi-json" || launcherType === "pi-rpc"
      ? await resolveCommandBinary("pi")
      : null;
  const effectiveCwd = path.resolve(cwd);
  const promptPath = path.resolve(assets.promptPath);
  const transcriptPath = path.resolve(assets.transcriptPath);
  const exitPath = path.resolve(assets.exitPath);
  const eventsPath = path.resolve(assets.piEventsPath);
  const stderrPath = path.resolve(assets.stderrPath);
  const sessionFilePath = path.resolve(assets.piSessionPath);
  const controlPath = path.resolve(assets.controlPath);
  const rpcStatusPath = path.resolve(assets.rpcStatusPath);
  const launchContextPath = path.resolve(assets.launchContextPath);
  const rpcRunnerPath = path.join(PROJECT_ROOT, "packages/runtime-pi/src/launchers/pi-rpc-runner.js");
  const jsonRunnerPath = path.join(PROJECT_ROOT, "packages/runtime-pi/src/launchers/pi-json-runner.js");
  const launchBody =
    launcherType === "pi-rpc" && piBinary
      ? [
          "echo \"Launching pi in RPC mode...\" | tee -a " + shellEscape(transcriptPath),
          `node ${shellEscape(rpcRunnerPath)} ` +
            `--pi-bin ${shellEscape(piBinary)} ` +
            `--prompt ${shellEscape(promptPath)} ` +
            `--transcript ${shellEscape(transcriptPath)} ` +
            `--events ${shellEscape(eventsPath)} ` +
            `--stderr ${shellEscape(stderrPath)} ` +
            `--session-file ${shellEscape(sessionFilePath)} ` +
            `--control ${shellEscape(controlPath)} ` +
            `--status-file ${shellEscape(rpcStatusPath)} ` +
            `--cwd ${shellEscape(effectiveCwd)}`
        ].join("\n")
      : launcherType === "pi-json" && piBinary
      ? [
          "echo \"Launching pi in JSON event mode...\" | tee -a " + shellEscape(transcriptPath),
          `node ${shellEscape(jsonRunnerPath)} ` +
            `--pi-bin ${shellEscape(piBinary)} ` +
            `--prompt ${shellEscape(promptPath)} ` +
            `--transcript ${shellEscape(transcriptPath)} ` +
            `--events ${shellEscape(eventsPath)} ` +
            `--stderr ${shellEscape(stderrPath)} ` +
            `--session-file ${shellEscape(sessionFilePath)} ` +
            `--cwd ${shellEscape(effectiveCwd)}`
        ].join("\n")
      : [
          "echo \"pi CLI not found. Running bootstrap stub launcher.\" | tee -a " +
            shellEscape(transcriptPath),
          workspace?.id
            ? `echo \"Workspace: ${workspace.id} (${workspace.branchName ?? "unknown"})\" | tee -a ${shellEscape(transcriptPath)}`
            : null,
          `cat ${shellEscape(promptPath)} | tee -a ${shellEscape(transcriptPath)}`,
          `sleep ${stubDurationSeconds}`,
          "echo \"Stub session finished.\" | tee -a " + shellEscape(transcriptPath)
        ].filter(Boolean).join("\n");

  const script = `#!/usr/bin/env bash
set +e
cd ${shellEscape(effectiveCwd)}
node -e "const fs=require('node:fs'); fs.writeFileSync(process.argv[1], JSON.stringify({cwd: process.cwd(), launcherType: process.argv[2], workspaceId: process.argv[3] || null, branchName: process.argv[4] || null, recordedAt: new Date().toISOString()}, null, 2) + '\\n')" ${shellEscape(launchContextPath)} ${shellEscape(launcherType)} ${shellEscape(workspace?.id ?? "")} ${shellEscape(workspace?.branchName ?? "")}
${launchBody}
exit_code=$?
printf '{"exitCode": %s}\\n' "$exit_code" > ${shellEscape(exitPath)}
exit $exit_code
`;
  await fs.writeFile(assets.launchScriptPath, script, "utf8");
  await fs.chmod(assets.launchScriptPath, 0o755);
}

export async function launchTmuxSession(tmuxSession, launchScriptPath) {
  await run("tmux", ["new-session", "-d", "-s", tmuxSession, launchScriptPath]);
}

export async function captureTmuxPane(tmuxSession, lines = 120) {
  const result = await run("tmux", ["capture-pane", "-p", "-S", `-${lines}`, "-t", tmuxSession]);
  return result.stdout;
}

export async function sendTmuxText(tmuxSession, text, enter = true) {
  await run("tmux", ["send-keys", "-t", tmuxSession, "-l", text]);
  if (enter) {
    await run("tmux", ["send-keys", "-t", tmuxSession, "Enter"]);
  }
}

export async function interruptTmuxSession(tmuxSession) {
  await run("tmux", ["send-keys", "-t", tmuxSession, "C-c"]);
}

export async function tmuxSessionExists(tmuxSession) {
  try {
    await run("tmux", ["has-session", "-t", tmuxSession]);
    return true;
  } catch {
    return false;
  }
}

export async function killTmuxSession(tmuxSession) {
  await run("tmux", ["kill-session", "-t", tmuxSession]);
}

export async function stopTmuxSession(
  tmuxSession,
  { force = false, timeoutMs = 3000, pollMs = 250 } = {}
) {
  const existed = await tmuxSessionExists(tmuxSession);
  if (!existed) {
    return {
      existed: false,
      stopped: true,
      mode: "missing"
    };
  }

  await interruptTmuxSession(tmuxSession);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await tmuxSessionExists(tmuxSession))) {
      return {
        existed: true,
        stopped: true,
        mode: "interrupt"
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (!force) {
    return {
      existed: true,
      stopped: false,
      mode: "interrupt-timeout"
    };
  }

  await killTmuxSession(tmuxSession);
  return {
    existed: true,
    stopped: true,
    mode: "kill"
  };
}

export async function waitForExitFile(exitPath, timeoutMs = 30000, intervalMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fs.readFile(exitPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
