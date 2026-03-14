#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTsxEntrypointArgs } from "@spore/core";
import type { RuntimeAdapter, RuntimeSessionBinding } from "@spore/runtime-core";
import {
  DEFAULT_SESSION_DB_PATH,
  getSession,
  openSessionDatabase,
} from "@spore/session-manager";
import { createPiSdkEmbeddedAdapter } from "../adapters/pi-sdk-embedded-adapter.js";
import { createPiSdkWorkerAdapter } from "../adapters/pi-sdk-worker-adapter.js";
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
    backendKind: flags["backend-kind"] ?? null,
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

async function appendRuntimeEvent(
  runtimeEventsPath: string,
  event: Record<string, unknown>,
) {
  await fs.mkdir(path.dirname(runtimeEventsPath), { recursive: true });
  await fs.appendFile(runtimeEventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function writeRuntimeStatus(
  runtimeStatusPath: string,
  payload: Record<string, unknown>,
) {
  await fs.mkdir(path.dirname(runtimeStatusPath), { recursive: true });
  await fs.writeFile(
    runtimeStatusPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function waitForRuntimeStatus(
  runtimeStatusPath: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(runtimeStatusPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const terminalSignal = parsed.terminalSignal as
        | { settled?: boolean }
        | null
        | undefined;
      if (terminalSignal?.settled) {
        return parsed;
      }
    } catch (error) {
      const typed = error as NodeJS.ErrnoException;
      if (typed.code !== "ENOENT") {
        throw typed;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function getAdapterForBackend(backendKind: string): RuntimeAdapter | null {
  if (backendKind === "pi_sdk_embedded") {
    return createPiSdkEmbeddedAdapter();
  }
  if (backendKind === "pi_sdk_worker") {
    return createPiSdkWorkerAdapter();
  }
  return null;
}

async function startStubSdkBackend(options: {
  backendKind: string;
  sessionId: string;
  runtimeStatusPath: string;
  runtimeEventsPath: string;
  transcriptPath: string;
  promptPath: string;
  launchContextPath: string;
  delayMs: number;
}) {
  const startedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(options.launchContextPath), { recursive: true });
  await fs.writeFile(options.launchContextPath, `${JSON.stringify({
    launcherType:
      options.backendKind === "pi_sdk_embedded" ? "pi-sdk-embedded" : "pi-sdk-worker",
    backendKind: options.backendKind,
    cwd: null,
    recordedAt: startedAt,
  }, null, 2)}\n`, "utf8");
  await writeRuntimeStatus(options.runtimeStatusPath, {
    backendKind: options.backendKind,
    providerFamily: "pi",
    state: "active",
    health: "healthy",
    heartbeatAt: startedAt,
    terminalSignal: null,
  });
  await appendRuntimeEvent(options.runtimeEventsPath, {
    eventId: `${options.sessionId}:started`,
    sessionId: options.sessionId,
    backendKind: options.backendKind,
    sequence: 1,
    timestamp: startedAt,
    type: "runtime.session.active",
    snapshot: { state: "active", health: "healthy" },
    payload: { stub: true },
    rawRef: null,
  });
  const finalize = async () => {
    const finishedAt = new Date().toISOString();
    await fs.writeFile(
      options.transcriptPath,
      `Stub ${options.backendKind} transcript for ${options.sessionId}\n`,
      "utf8",
    );
    await writeRuntimeStatus(options.runtimeStatusPath, {
      backendKind: options.backendKind,
      providerFamily: "pi",
      state: "completed",
      health: "terminated",
      heartbeatAt: finishedAt,
      terminalSignal: {
        settled: true,
        exitCode: 0,
        finishedAt,
        source: "stub-sdk-backend",
      },
    });
    await appendRuntimeEvent(options.runtimeEventsPath, {
      eventId: `${options.sessionId}:completed`,
      sessionId: options.sessionId,
      backendKind: options.backendKind,
      sequence: 2,
      timestamp: finishedAt,
      type: "runtime.session.completed",
      snapshot: { state: "completed", health: "terminated" },
      payload: { stub: true },
      rawRef: null,
    });
  };
  if (options.delayMs <= 0) {
    await finalize();
  } else {
    setTimeout(() => {
      void finalize();
    }, options.delayMs);
  }
  return {
    binding: {
      sessionId: options.sessionId,
      backendKind: options.backendKind,
      providerFamily: "pi",
      runtimeInstanceId: options.sessionId,
      controlEndpoint: null,
      protocolVersion: null,
      capabilities:
        options.backendKind === "pi_sdk_embedded"
          ? createPiSdkEmbeddedAdapter().capabilities
          : createPiSdkWorkerAdapter().capabilities,
      artifacts: {
        transcriptPath: path.relative(PROJECT_ROOT, options.transcriptPath),
        runtimeStatusPath: path.relative(PROJECT_ROOT, options.runtimeStatusPath),
        runtimeEventsPath: path.relative(PROJECT_ROOT, options.runtimeEventsPath),
        rawEventsPath: path.relative(PROJECT_ROOT, options.runtimeEventsPath),
        controlPath: `tmp/sessions/${options.sessionId}.control.ndjson`,
        handoffPath: `tmp/sessions/${options.sessionId}.handoff.json`,
        launchContextPath: path.relative(PROJECT_ROOT, options.launchContextPath),
        debugPaths: [],
      },
    },
    launchCommand: null,
    launcherType:
      options.backendKind === "pi_sdk_embedded" ? "pi-sdk-embedded" : "pi-sdk-worker",
  };
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
  const runtimeStatusPath = path.join(
    PROJECT_ROOT,
    "tmp",
    "sessions",
    `${plan.session.id}.runtime-status.json`,
  );
  const runtimeEventsPath = path.join(
    PROJECT_ROOT,
    "tmp",
    "sessions",
    `${plan.session.id}.runtime-events.jsonl`,
  );

  const launcherType =
    plan.backendKind === "pi_sdk_embedded"
      ? "pi-sdk-embedded"
      : plan.backendKind === "pi_sdk_worker"
        ? "pi-sdk-worker"
        : await resolveLauncherType(flags);
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

  const backendKind = plan.backendKind ?? "pi_rpc";
  const sessionManagerBaseArgs = [
    "packages/session-manager/src/cli/session-manager.js",
  ];
  let createResult: ProcessResult;
  let startingResult: ProcessResult;
  let activeResult: ProcessResult;
  let runtimeStartResult: Record<string, unknown> | null = null;

  if (backendKind === "pi_rpc") {
    createResult = await runCli("node", [
      ...sessionManagerBaseArgs,
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
      "--runtime-status",
      path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      path.relative(PROJECT_ROOT, runtimeEventsPath),
    ]);
    await launchTmuxSession(tmuxSession, assets.launchScriptPath);
    startingResult = await runCli("node", [
      ...sessionManagerBaseArgs,
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
      "--runtime-status",
      path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      path.relative(PROJECT_ROOT, runtimeEventsPath),
    ]);
    activeResult = await runCli("node", [
      ...sessionManagerBaseArgs,
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
      "--runtime-status",
      path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      path.relative(PROJECT_ROOT, runtimeEventsPath),
    ]);
  } else {
    const adapter = getAdapterForBackend(backendKind);
    if (!adapter) {
      throw new Error(`unsupported backend kind: ${backendKind}`);
    }
    const backendLauncherType =
      backendKind === "pi_sdk_embedded" ? "pi-sdk-embedded" : "pi-sdk-worker";
    createResult = await runCli("node", [
      ...sessionManagerBaseArgs,
      "create-from-plan",
      "--plan",
      path.relative(PROJECT_ROOT, tempPlanPath),
      "--context",
      writtenContext.path,
      ...(flags.domain ? ["--domain", String(flags.domain)] : []),
      ...(flags.workflow ? ["--workflow", String(flags.workflow)] : []),
      ...(flags.parent ? ["--parent", String(flags.parent)] : []),
      "--launcher",
      backendLauncherType,
      "--runtime-status",
      path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      path.relative(PROJECT_ROOT, runtimeEventsPath),
      "--runtime-capabilities-json",
      JSON.stringify(adapter.capabilities),
    ]);
    startingResult = await runCli("node", [
      ...sessionManagerBaseArgs,
      "transition",
      "--session",
      plan.session.id,
      "--state",
      "starting",
      "--launcher",
      backendLauncherType,
      "--runtime-status",
      path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      path.relative(PROJECT_ROOT, runtimeEventsPath),
      "--runtime-capabilities-json",
      JSON.stringify(adapter.capabilities),
    ]);
    runtimeStartResult = (flags.stub
      ? await startStubSdkBackend({
          backendKind,
          sessionId: plan.session.id,
          runtimeStatusPath,
          runtimeEventsPath,
          transcriptPath: assets.transcriptPath,
          promptPath: assets.promptPath,
          launchContextPath: assets.launchContextPath,
          delayMs: Number.parseInt(flags["stub-seconds"] ?? "2", 10) * 1000,
        })
      : await adapter.start(
          {
            sessionId: plan.session.id,
            runId: plan.session.runId,
            executionId: null,
            stepId: null,
            providerFamily: "pi",
            backendKind: backendKind as "pi_sdk_embedded" | "pi_sdk_worker",
            artifactRoot: path.join("tmp", "sessions", plan.session.id),
            planPath: path.relative(PROJECT_ROOT, tempPlanPath),
            contextPath: writtenContext.path,
            promptPath: path.relative(PROJECT_ROOT, assets.promptPath),
            cwd: resolvePlanWorkingDirectory(plan) ?? PROJECT_ROOT,
            metadata: {
              promptPath: path.relative(PROJECT_ROOT, assets.promptPath),
              cwd: resolvePlanWorkingDirectory(plan) ?? PROJECT_ROOT,
            },
          },
          {},
        )) as unknown as Record<string, unknown>;
    const binding = runtimeStartResult.binding as RuntimeSessionBinding;
    activeResult = await runCli("node", [
      ...sessionManagerBaseArgs,
      "transition",
      "--session",
      plan.session.id,
      "--state",
      "active",
      "--launcher",
      backendLauncherType,
      "--transcript",
      path.relative(PROJECT_ROOT, assets.transcriptPath),
      "--runtime-instance",
      binding.runtimeInstanceId ?? plan.session.id,
      "--runtime-status",
      binding.artifacts.runtimeStatusPath ?? path.relative(PROJECT_ROOT, runtimeStatusPath),
      "--runtime-events",
      binding.artifacts.runtimeEventsPath ?? path.relative(PROJECT_ROOT, runtimeEventsPath),
      "--runtime-capabilities-json",
      JSON.stringify(binding.capabilities),
    ]);
  }
  if (backendKind === "pi_rpc") {
    await writeRuntimeStatus(runtimeStatusPath, {
      backendKind: plan.backendKind,
      providerFamily: plan.providerFamily,
      state: "active",
      health: "healthy",
      heartbeatAt: new Date().toISOString(),
      terminalSignal: null,
    });
    await appendRuntimeEvent(runtimeEventsPath, {
      eventId: `${plan.session.id}:started`,
      sessionId: plan.session.id,
      backendKind: plan.backendKind,
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "runtime.session.active",
      snapshot: {
        state: "active",
        health: "healthy",
      },
      payload: {
        launcherType,
        tmuxSession,
      },
      rawRef: path.relative(PROJECT_ROOT, assets.piEventsPath),
    });
  }

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
    if (backendKind === "pi_rpc") {
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
            ...sessionManagerBaseArgs,
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
            "--runtime-status",
            path.relative(PROJECT_ROOT, runtimeStatusPath),
            "--runtime-events",
            path.relative(PROJECT_ROOT, runtimeEventsPath),
          ]);
          finalResult = JSON.parse(transitionResult.stdout);
        }
        await writeRuntimeStatus(runtimeStatusPath, {
          backendKind: plan.backendKind,
          providerFamily: plan.providerFamily,
          state:
            finalResult?.session?.state ??
            (exitInfo.exitCode === 0 ? "completed" : "failed"),
          health: "terminated",
          heartbeatAt: new Date().toISOString(),
          terminalSignal: {
            settled: true,
            exitCode: exitInfo.exitCode,
            finishedAt: new Date().toISOString(),
            source: "run-session-plan",
          },
        });
        await appendRuntimeEvent(runtimeEventsPath, {
          eventId: `${plan.session.id}:settled`,
          sessionId: plan.session.id,
          backendKind: plan.backendKind,
          sequence: 2,
          timestamp: new Date().toISOString(),
          type:
            exitInfo.exitCode === 0
              ? "runtime.session.completed"
              : "runtime.session.failed",
          snapshot: {
            state: exitInfo.exitCode === 0 ? "completed" : "failed",
            health: "terminated",
          },
          payload: {
            exitCode: exitInfo.exitCode,
          },
          rawRef: path.relative(PROJECT_ROOT, assets.piEventsPath),
        });
      }
    } else {
      const runtimeStatus = await waitForRuntimeStatus(
        runtimeStatusPath,
        Number.parseInt(flags.timeout ?? "30000", 10),
      );
      if (runtimeStatus) {
        const terminalSignal = (runtimeStatus.terminalSignal ?? {}) as {
          exitCode?: number;
        };
        const finalState =
          flags.fail || Number(terminalSignal.exitCode ?? 1) !== 0
            ? "failed"
            : "completed";
        const transitionResult = await runCli("node", [
          ...sessionManagerBaseArgs,
          "transition",
          "--session",
          plan.session.id,
          "--state",
          finalState,
          "--transcript",
          transcriptPath,
          "--launcher",
          backendKind === "pi_sdk_embedded" ? "pi-sdk-embedded" : "pi-sdk-worker",
          "--runtime-status",
          path.relative(PROJECT_ROOT, runtimeStatusPath),
          "--runtime-events",
          path.relative(PROJECT_ROOT, runtimeEventsPath),
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
        backendKind: plan.backendKind,
        tmuxSession,
        launchScriptPath: path.relative(PROJECT_ROOT, assets.launchScriptPath),
        runtimeStatusPath: path.relative(PROJECT_ROOT, runtimeStatusPath),
        runtimeEventsPath: path.relative(PROJECT_ROOT, runtimeEventsPath),
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
