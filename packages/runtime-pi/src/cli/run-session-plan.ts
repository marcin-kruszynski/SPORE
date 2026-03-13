#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTsxEntrypointArgs } from "@spore/core";
import {
  DEFAULT_SESSION_DB_PATH,
  getSession,
  openSessionDatabase,
} from "@spore/session-manager";
import { writeStartupContext } from "../context/build-startup-context.js";
import {
  captureTmuxPane,
  commandExists,
  launchTmuxSession,
  sanitizeTmuxSessionName,
  tmuxSessionExists,
  waitForExitFile,
  writeLaunchAssets,
  writeLaunchScript,
} from "../launchers/tmux-launcher.js";
import { PROJECT_ROOT } from "../metadata/constants.js";
import { buildSessionPlan } from "../planner/build-session-plan.js";
import type { CliFlags, ProcessResult, SessionPlan } from "../types.js";

function isEntrypoint() {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  const normalized = path.basename(path.resolve(scriptPath));
  return normalized === "run-session-plan.ts" || normalized === "run-session-plan.js";
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function resolvePath(filePath?: string | null): string | null {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);
}

function resolveRequiredPath(filePath: string | null, label: string): string {
  if (!filePath) {
    throw new Error(`${label} is required`);
  }
  return filePath;
}

function parseJsonFlag<T>(value: string | undefined): T | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

function resolvePlanWorkingDirectory(plan: SessionPlan): string | null {
  const candidates = [plan.session?.cwd, plan.metadata?.workspace?.cwd];
  for (const candidate of candidates) {
    const resolved = resolvePath(candidate);
    if (resolved) {
      return resolveRequiredPath(resolved, "cwd");
    }
  }
  return null;
}

async function loadOrBuildPlan(flags: CliFlags): Promise<SessionPlan> {
  if (flags.plan) {
    const raw = await fs.readFile(
      resolveRequiredPath(resolvePath(flags.plan), "plan"),
      "utf8",
    );
    return JSON.parse(raw) as SessionPlan;
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
      ? String(flags["context-query-terms"])
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : null,
    contextLimit: flags["context-limit"] ?? null,
    cwd: flags.cwd ?? null,
    workspaceId: flags["workspace-id"] ?? null,
    workspaceBranch: flags["workspace-branch"] ?? null,
    workspaceBaseRef: flags["workspace-base-ref"] ?? null,
    workspacePurpose: flags["workspace-purpose"] ?? null,
    workspaceSourceId: flags["workspace-source-id"] ?? null,
    workspaceSourceRef: flags["workspace-source-ref"] ?? null,
    workspaceSourceCommit: flags["workspace-source-commit"] ?? null,
    inboundHandoffs: parseJsonFlag(flags["inbound-handoffs-json"]),
    expectedHandoff: parseJsonFlag(flags["expected-handoff-json"]),
  });
}

export async function resolveLauncherType(
  flags: CliFlags,
  piAvailable?: boolean,
) {
  const hasPi = piAvailable ?? (await commandExists("pi"));
  if (flags.stub) {
    return "stub";
  }
  if (flags.launcher) {
    return String(flags.launcher);
  }
  if (!hasPi) {
    throw new Error(
      "pi CLI is required for runtime launch. Install/configure PI or explicitly pass --stub for test-only runs.",
    );
  }
  return "pi-rpc";
}

function runCli(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const invocation =
      command === "node" || command === process.execPath
        ? {
            command: process.execPath,
            args: buildTsxEntrypointArgs(args[0], args.slice(1)),
          }
        : { command, args };

    const child = spawn(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
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
      reject(new Error(stderr || stdout || `command failed: ${command}`));
    });
  });
}

function spawnDetached(command: string, args: string[]) {
  const invocation =
    command === "node" || command === process.execPath
      ? {
          command: process.execPath,
          args: buildTsxEntrypointArgs(args[0], args.slice(1)),
        }
      : { command, args };

  const child = spawn(invocation.command, invocation.args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    command: invocation.command,
    args: invocation.args,
  };
}

function readCurrentSession(sessionId: string) {
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
    limit: flags.limit ? Number.parseInt(flags.limit, 10) : null,
  });

  const tempPlanPath = resolveRequiredPath(
    resolvePath(
      flags["write-plan"] ?? `tmp/sessions/${plan.session.id}.plan.json`,
    ),
    "write-plan",
  );
  await fs.mkdir(path.dirname(tempPlanPath), { recursive: true });
  await fs.writeFile(
    tempPlanPath,
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );

  const launcherType = await resolveLauncherType(flags);
  const tmuxSession = sanitizeTmuxSessionName(plan.session.id);
  const assets = await writeLaunchAssets({
    sessionId: plan.session.id,
    plan,
    contextPath: writtenContext.path,
    briefPath: flags.brief ?? null,
  });
  await writeLaunchScript({
    launcherType,
    assets,
    plan,
    stubDurationSeconds: Number.parseInt(flags["stub-seconds"] ?? "2", 10),
    cwd: resolvePlanWorkingDirectory(plan) ?? PROJECT_ROOT,
    workspace: plan.metadata?.workspace ?? null,
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
    tmuxSession,
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
    tmuxSession,
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
    path.relative(PROJECT_ROOT, assets.transcriptPath),
  ]);

  const monitorEnabled =
    !flags["no-monitor"] && !flags.wait && !flags.complete && !flags.fail;
  const monitor = monitorEnabled
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
        flags["grace-ms"] ?? "5000",
      ])
    : null;

  let finalResult = null;
  const transcriptPath = path.relative(PROJECT_ROOT, assets.transcriptPath);
  let paneCapture = null;
  if (flags.wait || flags.complete || flags.fail) {
    const exitInfo = await waitForExitFile(
      assets.exitPath,
      Number.parseInt(flags.timeout ?? "30000", 10),
    );
    if (await tmuxSessionExists(tmuxSession)) {
      paneCapture = await captureTmuxPane(
        tmuxSession,
        Number.parseInt(flags.lines ?? "120", 10),
      );
    }
    if (exitInfo) {
      const currentSession = readCurrentSession(plan.session.id);
      if (
        currentSession &&
        ["completed", "failed", "stopped", "canceled"].includes(
          currentSession.state,
        )
      ) {
        finalResult = {
          ok: true,
          skippedTransition: true,
          exitInfo,
          session: currentSession,
        };
      } else {
        const finalState = flags.fail
          ? "failed"
          : exitInfo.exitCode === 0
            ? "completed"
            : "failed";
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
          tmuxSession,
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
        paneCapture,
      },
      null,
      2,
    ),
  );
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(`runtime-pi harness error: ${error.message}`);
    process.exitCode = 1;
  });
}
