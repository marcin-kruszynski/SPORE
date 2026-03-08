#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { buildSessionPlan } from "../planner/build-session-plan.js";
import { PROJECT_ROOT } from "../metadata/constants.js";
import { writeStartupContext } from "../context/build-startup-context.js";
import {
  captureTmuxPane,
  commandExists,
  launchTmuxSession,
  sanitizeTmuxSessionName,
  tmuxSessionExists,
  waitForExitFile,
  writeLaunchAssets,
  writeLaunchScript
} from "../launchers/tmux-launcher.js";
import { spawn } from "node:child_process";
import { getSession, openSessionDatabase } from "../../../session-manager/src/store/session-store.js";
import { DEFAULT_SESSION_DB_PATH } from "../../../session-manager/src/metadata/constants.js";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function resolvePath(filePath) {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
}

async function loadOrBuildPlan(flags) {
  if (flags.plan) {
    const raw = await fs.readFile(resolvePath(flags.plan), "utf8");
    return JSON.parse(raw);
  }
  if (!flags.profile) {
    throw new Error("use --plan <file> or --profile <config/profiles/*.yaml>");
  }
  return buildSessionPlan({
    profilePath: flags.profile,
    runtimeConfigPath: flags.runtime,
    projectPath: flags.project,
    domainId: flags.domain ?? null,
    workflowId: flags.workflow ?? null,
    sessionId: flags["session-id"] ?? null,
    runId: flags["run-id"] ?? null,
    sessionMode: flags["session-mode"] ?? null,
    contextQuery: flags["context-query"] ?? null,
    contextQueryTerms: flags["context-query-terms"]
      ? String(flags["context-query-terms"]).split(",").map((item) => item.trim()).filter(Boolean)
      : null,
    contextLimit: flags["context-limit"] ?? null
  });
}

function runCli(command, args) {
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
      reject(new Error(stderr || stdout || `command failed: ${command}`));
    });
  });
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return {
    command,
    args
  };
}

function readCurrentSession(sessionId) {
  const db = openSessionDatabase(DEFAULT_SESSION_DB_PATH);
  try {
    return getSession(db, sessionId);
  } finally {
    db.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const plan = await loadOrBuildPlan(flags);
  const contextPath =
    flags.context ?? `tmp/sessions/${plan.session.id}.context.json`;
  const writtenContext = await writeStartupContext(plan, contextPath, {
    indexPath: flags.index,
    limit: flags.limit ? Number.parseInt(flags.limit, 10) : null
  });

  const tempPlanPath = resolvePath(
    flags["write-plan"] ?? `tmp/sessions/${plan.session.id}.plan.json`
  );
  await fs.mkdir(path.dirname(tempPlanPath), { recursive: true });
  await fs.writeFile(tempPlanPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const launcherType = flags.stub
    ? "stub"
    : flags.launcher
      ? String(flags.launcher)
      : (await commandExists("pi"))
        ? "pi-rpc"
        : "stub";
  const tmuxSession = sanitizeTmuxSessionName(plan.session.id);
  const assets = await writeLaunchAssets({
    sessionId: plan.session.id,
    plan,
    contextPath: writtenContext.path,
    briefPath: flags.brief ?? null
  });
  await writeLaunchScript({
    launcherType,
    assets,
    stubDurationSeconds: Number.parseInt(flags["stub-seconds"] ?? "2", 10)
  });

  const createResult = await runCli("node", [
    "packages/session-manager/src/cli/session-manager.js",
    "create-from-plan",
    "--plan",
    path.relative(PROJECT_ROOT, tempPlanPath),
    "--context",
    writtenContext.path,
    ...(flags.domain ? ["--domain", String(flags.domain)] : []),
    ...(flags.workflow ? ["--workflow", String(flags.workflow)] : []),
    ...(flags.parent ? ["--parent", String(flags.parent)] : []),
    "--launcher",
    launcherType,
    "--command",
    path.relative(PROJECT_ROOT, assets.launchScriptPath),
    "--tmux",
    tmuxSession
  ]);
  await launchTmuxSession(tmuxSession, assets.launchScriptPath);
  const startingResult = await runCli("node", [
    "packages/session-manager/src/cli/session-manager.js",
    "transition",
    "--session",
    plan.session.id,
    "--state",
    "starting",
    "--launcher",
    launcherType,
    "--command",
    path.relative(PROJECT_ROOT, assets.launchScriptPath),
    "--tmux",
    tmuxSession
  ]);
  const activeResult = await runCli("node", [
    "packages/session-manager/src/cli/session-manager.js",
    "transition",
    "--session",
    plan.session.id,
    "--state",
    "active",
    "--launcher",
    launcherType,
    "--command",
    path.relative(PROJECT_ROOT, assets.launchScriptPath),
    "--tmux",
    tmuxSession,
    "--transcript",
    path.relative(PROJECT_ROOT, assets.transcriptPath)
  ]);

  const monitorEnabled =
    !flags["no-monitor"] && !flags.wait && !flags.complete && !flags.fail;
  const monitor =
    monitorEnabled
      ? spawnDetached("node", [
          "packages/session-manager/src/cli/session-manager.js",
          "reconcile",
          "--watch",
          "--stop-on-settled",
          "--session",
          plan.session.id,
          "--interval",
          flags["monitor-interval"] ?? "1000",
          "--grace-ms",
          flags["grace-ms"] ?? "5000"
        ])
      : null;

  let finalResult = null;
  const transcriptPath = path.relative(PROJECT_ROOT, assets.transcriptPath);
  let paneCapture = null;
  if (flags.wait || flags.complete || flags.fail) {
    const exitInfo = await waitForExitFile(assets.exitPath, Number.parseInt(flags.timeout ?? "30000", 10));
    if (await tmuxSessionExists(tmuxSession)) {
      paneCapture = await captureTmuxPane(tmuxSession, Number.parseInt(flags.lines ?? "120", 10));
    }
    if (exitInfo) {
      const currentSession = readCurrentSession(plan.session.id);
      if (currentSession && ["completed", "failed", "stopped", "canceled"].includes(currentSession.state)) {
        finalResult = {
          ok: true,
          skippedTransition: true,
          exitInfo,
          session: currentSession
        };
      } else {
        const finalState = flags.fail ? "failed" : exitInfo.exitCode === 0 ? "completed" : "failed";
        const transitionResult = await runCli("node", [
          "packages/session-manager/src/cli/session-manager.js",
          "transition",
          "--session",
          plan.session.id,
          "--state",
          finalState,
          "--transcript",
          transcriptPath,
          "--launcher",
          launcherType,
          "--command",
          path.relative(PROJECT_ROOT, assets.launchScriptPath),
          "--tmux",
          tmuxSession
        ]);
        finalResult = JSON.parse(transitionResult.stdout);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        planPath: path.relative(PROJECT_ROOT, tempPlanPath),
        contextPath: writtenContext.path,
        launcherType,
        tmuxSession,
        launchScriptPath: path.relative(PROJECT_ROOT, assets.launchScriptPath),
        sessionCreate: JSON.parse(createResult.stdout),
        sessionStarting: JSON.parse(startingResult.stdout),
        sessionActive: JSON.parse(activeResult.stdout),
        sessionFinal: finalResult,
        monitor,
        transcriptPath,
        paneCapture
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`runtime-pi harness error: ${error.message}`);
  process.exitCode = 1;
});
