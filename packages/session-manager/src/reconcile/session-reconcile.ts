import fs from "node:fs/promises";
import path from "node:path";

import { transitionSessionRecord } from "../lifecycle/session-lifecycle.js";
import { PROJECT_ROOT } from "../metadata/constants.js";
import {
  getSession,
  openSessionDatabase,
  upsertSessionInTransaction,
} from "../store/session-store.js";
import type {
  SessionArtifactFallbackReason,
  SessionArtifactRecoveryTelemetry,
  SessionArtifactSignalSource,
  SessionRecord,
} from "../types.js";

const RECONCILE_CANDIDATE_STATES = new Set(["planned", "starting", "active"]);

type JsonRecord = Record<string, unknown>;

interface JsonFileReadResult {
  state: "missing" | "invalid" | "parsed";
  value: unknown | null;
}

interface ExitArtifact {
  exitCode?: number;
}

interface RpcTerminalSignal {
  settled?: boolean;
  exitCode?: number;
  finishedAt?: string | null;
  source?: string | null;
}

interface RpcStatusArtifact {
  status?: string;
  terminalSignal?: RpcTerminalSignal | null;
}

export interface SessionArtifactSignal {
  source: SessionArtifactSignalSource;
  signalSource: SessionArtifactSignalSource;
  artifactPath: string;
  exitCode: number;
  nextState: "completed" | "failed";
  status: string | null;
  finishedAt: string | null;
  terminalSignalSource: string | null;
  fallbackReason: SessionArtifactFallbackReason | null;
}

export interface ReconcileSessionFromArtifactsOptions {
  dbPath: string;
  sessionId: string;
  projectRoot?: string;
}

export interface ReconcileSessionFromArtifactsResult {
  reconciled: boolean;
  session: SessionRecord | null;
  signal: SessionArtifactSignal | null;
}

export function isSessionReconcileCandidateState(
  state: SessionRecord["state"] | null | undefined,
): boolean {
  return typeof state === "string" && RECONCILE_CANDIDATE_STATES.has(state);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonFileIfExists(
  filePath: string,
): Promise<JsonFileReadResult> {
  try {
    return {
      state: "parsed",
      value: JSON.parse(await fs.readFile(filePath, "utf8")) as unknown,
    } satisfies JsonFileReadResult;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        state: "invalid",
        value: null,
      } satisfies JsonFileReadResult;
    }
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        state: "missing",
        value: null,
      } satisfies JsonFileReadResult;
    }
    throw error;
  }
}

function buildSessionArtifactRecoveryTelemetry(
  signal: SessionArtifactSignal,
  artifactRecoveryCount = 1,
): SessionArtifactRecoveryTelemetry {
  return {
    recovered: true,
    signalSource: signal.signalSource,
    terminalSignalSource: signal.terminalSignalSource,
    fallbackReason: signal.fallbackReason,
    artifactPath: signal.artifactPath,
    exitCode: signal.exitCode,
    nextState: signal.nextState,
    finishedAt: signal.finishedAt,
    status: signal.status,
    artifactRecoveryCount,
  };
}

export { buildSessionArtifactRecoveryTelemetry };

function signalFromArtifactRecoveryTelemetry(
  telemetry: SessionArtifactRecoveryTelemetry | null | undefined,
): SessionArtifactSignal | null {
  if (!telemetry?.recovered) {
    return null;
  }
  return {
    source: telemetry.signalSource,
    signalSource: telemetry.signalSource,
    artifactPath: telemetry.artifactPath,
    exitCode: telemetry.exitCode,
    nextState: telemetry.nextState,
    status: telemetry.status,
    finishedAt: telemetry.finishedAt,
    terminalSignalSource: telemetry.terminalSignalSource,
    fallbackReason: telemetry.fallbackReason,
  };
}

function fallbackReasonFromExitArtifact(
  exitArtifact: JsonFileReadResult,
  exitSignal: SessionArtifactSignal | null,
): SessionArtifactFallbackReason | null {
  if (exitArtifact.state === "missing") {
    return "exit-file-missing";
  }
  if (exitArtifact.state === "invalid") {
    return "exit-file-invalid";
  }
  if (exitArtifact.state === "parsed" && !exitSignal) {
    return "exit-file-invalid";
  }
  return null;
}

function mergeTerminalSignalMetadata(
  signal: SessionArtifactSignal,
  terminalSignal: SessionArtifactSignal | null,
): SessionArtifactSignal {
  if (!terminalSignal) {
    return signal;
  }
  return {
    ...signal,
    finishedAt: terminalSignal.finishedAt ?? signal.finishedAt,
    status: terminalSignal.status ?? signal.status,
    terminalSignalSource:
      terminalSignal.terminalSignalSource ?? signal.terminalSignalSource,
  };
}

function readJsonValue(result: JsonFileReadResult): unknown | null {
  return result.state === "parsed" ? result.value : null;
}

function deriveArtifactPaths(
  session: SessionRecord,
  projectRoot: string,
): { exitPath: string; rpcStatusPath: string } | null {
  if (!session.launchCommand) {
    return null;
  }
  const launchCommand = path.isAbsolute(session.launchCommand)
    ? session.launchCommand
    : path.join(projectRoot, session.launchCommand);
  if (!launchCommand.endsWith(".launch.sh")) {
    return null;
  }
  return {
    exitPath: launchCommand.replace(/\.launch\.sh$/, ".exit.json"),
    rpcStatusPath: launchCommand.replace(/\.launch\.sh$/, ".rpc-status.json"),
  };
}

function buildSessionSignal(
  signalSource: SessionArtifactSignalSource,
  artifactPath: string,
  exitCode: number,
  options: {
    finishedAt?: string | null;
    status?: string | null;
    terminalSignalSource?: string | null;
    fallbackReason?: SessionArtifactFallbackReason | null;
  } = {},
): SessionArtifactSignal {
  return {
    source: signalSource,
    signalSource,
    artifactPath,
    exitCode,
    nextState: exitCode === 0 ? "completed" : "failed",
    finishedAt: options.finishedAt ?? null,
    status: options.status ?? null,
    terminalSignalSource: options.terminalSignalSource ?? null,
    fallbackReason: options.fallbackReason ?? null,
  };
}

function parseExitSignal(
  artifactPath: string,
  raw: unknown,
): SessionArtifactSignal | null {
  if (!isJsonRecord(raw)) {
    return null;
  }
  const exitInfo = raw as ExitArtifact;
  if (!Number.isInteger(exitInfo.exitCode)) {
    return null;
  }
  return buildSessionSignal("exit-file", artifactPath, exitInfo.exitCode);
}

function parseRpcStatusSignal(
  artifactPath: string,
  raw: unknown,
  options: {
    fallbackReason?: SessionArtifactFallbackReason | null;
  } = {},
): SessionArtifactSignal | null {
  if (!isJsonRecord(raw)) {
    return null;
  }
  const rpcStatus = raw as RpcStatusArtifact;
  const terminalSignal = isJsonRecord(rpcStatus.terminalSignal)
    ? (rpcStatus.terminalSignal as RpcTerminalSignal)
    : null;
  if (!terminalSignal?.settled || !Number.isInteger(terminalSignal.exitCode)) {
    return null;
  }
  return buildSessionSignal("rpc-status", artifactPath, terminalSignal.exitCode, {
    finishedAt:
      typeof terminalSignal.finishedAt === "string"
        ? terminalSignal.finishedAt
        : null,
    status: typeof rpcStatus.status === "string" ? rpcStatus.status : null,
    terminalSignalSource:
      typeof terminalSignal.source === "string" ? terminalSignal.source : null,
    fallbackReason: options.fallbackReason ?? null,
  });
}

async function readSessionArtifactSignal(
  session: SessionRecord,
  projectRoot: string,
): Promise<SessionArtifactSignal | null> {
  if (!isSessionReconcileCandidateState(session.state)) {
    return null;
  }
  const artifactPaths = deriveArtifactPaths(session, projectRoot);
  if (!artifactPaths) {
    return null;
  }

  const exitArtifact = await readJsonFileIfExists(artifactPaths.exitPath);
  const exitSignal = parseExitSignal(
    artifactPaths.exitPath,
    readJsonValue(exitArtifact),
  );
  const rpcStatusArtifact = await readJsonFileIfExists(artifactPaths.rpcStatusPath);
  const rpcStatusSignal = parseRpcStatusSignal(
    artifactPaths.rpcStatusPath,
    readJsonValue(rpcStatusArtifact),
    {
      fallbackReason: fallbackReasonFromExitArtifact(exitArtifact, exitSignal),
    },
  );
  if (exitSignal) {
    return mergeTerminalSignalMetadata(exitSignal, rpcStatusSignal);
  }

  return rpcStatusSignal;
}

export async function reconcileSessionFromArtifacts({
  dbPath,
  sessionId,
  projectRoot = PROJECT_ROOT,
}: ReconcileSessionFromArtifactsOptions): Promise<ReconcileSessionFromArtifactsResult> {
  const db = openSessionDatabase(dbPath);
  try {
    const session = getSession(db, sessionId);
    if (!session) {
      return {
        reconciled: false,
        session: null,
        signal: null,
      };
    }

    const persistedSignal = signalFromArtifactRecoveryTelemetry(
      session.artifactRecovery,
    );
    if (!isSessionReconcileCandidateState(session.state)) {
      return {
        reconciled: false,
        session,
        signal: persistedSignal,
      };
    }

    const signal = await readSessionArtifactSignal(session, projectRoot);
    if (!signal) {
      return {
        reconciled: false,
        session,
        signal: null,
      };
    }

    let result: ReconcileSessionFromArtifactsResult = {
      reconciled: false,
      session,
      signal: null,
    };

    db.exec("BEGIN IMMEDIATE");
    try {
      const current = getSession(db, session.id);
      if (!current || !isSessionReconcileCandidateState(current.state)) {
        result = {
          reconciled: false,
          session: current ?? session,
          signal: signalFromArtifactRecoveryTelemetry(
            current?.artifactRecovery ?? null,
          ),
        };
      } else {
        const updated = {
          ...transitionSessionRecord(current, signal.nextState),
          artifactRecovery: buildSessionArtifactRecoveryTelemetry(signal),
        };
        upsertSessionInTransaction(db, updated);
        result = {
          reconciled: true,
          session: updated,
          signal,
        };
      }
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
