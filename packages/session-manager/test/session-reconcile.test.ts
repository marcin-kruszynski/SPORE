import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getSession,
  openSessionDatabase,
  reconcileSessionFromArtifacts,
  upsertSession,
} from "../src/index.js";

async function makeTempPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-session-reconcile-"));
  return {
    root,
    dbPath: path.join(root, "sessions.sqlite"),
  };
}

function createSessionRecord(sessionId: string, launchScriptPath: string) {
  const timestamp = new Date().toISOString();
  return {
    id: sessionId,
    runId: `${sessionId}-run`,
    agentIdentityId: "lead:lead",
    profileId: "lead",
    role: "lead",
    state: "active",
    runtimeAdapter: "runtime-pi",
    backendKind: "pi_rpc",
    transportMode: "rpc",
    sessionMode: "ephemeral",
    projectId: "spore",
    projectName: "SPORE",
    projectType: "application",
    domainId: "frontend",
    workflowId: "frontend-ui-pass",
    parentSessionId: null,
    contextPath: null,
    transcriptPath: path.join(path.dirname(launchScriptPath), `${sessionId}.transcript.md`),
    launcherType: "pi-rpc",
    launchCommand: launchScriptPath,
    tmuxSession: `tmux-${sessionId}`,
    runtimeInstanceId: `tmux-${sessionId}`,
    runtimeCapabilities: null,
    runtimeStatusPath: path.join(path.dirname(launchScriptPath), `${sessionId}.runtime-status.json`),
    runtimeEventsPath: path.join(path.dirname(launchScriptPath), `${sessionId}.runtime-events.jsonl`),
    startedAt: timestamp,
    endedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("reconcileSessionFromArtifacts falls back to final rpc-status when exit artifact is missing", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `rpc-status-fallback-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt: new Date().toISOString(),
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.session?.state, "completed");
  assert.equal(result.signal?.source, "rpc-status");
  assert.equal(result.signal?.exitCode, 0);

  const verifyDb = openSessionDatabase(dbPath);
  try {
    assert.equal(getSession(verifyDb, sessionId)?.state, "completed");
  } finally {
    verifyDb.close();
  }
});

test("reconcileSessionFromArtifacts prefers generic runtime-status when present", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `runtime-status-primary-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const runtimeStatusPath = path.join(root, `${sessionId}.runtime-status.json`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    runtimeStatusPath,
    `${JSON.stringify({
      backendKind: "pi_rpc",
      state: "completed",
      health: "terminated",
      heartbeatAt: new Date().toISOString(),
      terminalSignal: {
        settled: true,
        exitCode: 0,
        finishedAt: new Date().toISOString(),
        source: "runtime-status",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify({
      runner: "pi-rpc-runner",
      status: "failed",
      terminalSignal: {
        settled: true,
        exitCode: 9,
        finishedAt: new Date().toISOString(),
        source: "runner-finalize",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.session?.state, "completed");
  assert.equal(result.signal?.signalSource, "runtime-status");
});

test("reconcileSessionFromArtifacts returns explicit signal metadata for rpc-status recovery", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `rpc-status-observability-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");
  const finishedAt = new Date().toISOString();

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt,
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.signal?.signalSource, "rpc-status");
  assert.equal(result.signal?.fallbackReason, "exit-file-missing");
  assert.equal(result.signal?.terminalSignalSource, "runner-finalize");
  assert.equal(result.signal?.finishedAt, finishedAt);
});

test("reconcileSessionFromArtifacts ignores non-terminal rpc-status snapshots", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `rpc-status-non-terminal-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "streaming",
        terminalSignal: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, false);
  assert.equal(result.session?.state, "active");
  assert.equal(result.signal, null);

  const verifyDb = openSessionDatabase(dbPath);
  try {
    assert.equal(getSession(verifyDb, sessionId)?.state, "active");
  } finally {
    verifyDb.close();
  }
});

test("reconcileSessionFromArtifacts ignores partially written rpc-status artifacts", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `rpc-status-partial-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(rpcStatusPath, '{"runner":"pi-rpc-runner","status":"completed",', "utf8");

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, false);
  assert.equal(result.session?.state, "active");
  assert.equal(result.signal, null);
});

test("reconcileSessionFromArtifacts does not overwrite a newer terminal session state", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `rpc-status-stale-update-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt: new Date().toISOString(),
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    const session = createSessionRecord(sessionId, launchScriptPath);
    upsertSession(db, session);
    upsertSession(db, {
      ...session,
      state: "failed",
      endedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({
    dbPath,
    sessionId,
  });

  assert.equal(result.reconciled, false);
  assert.equal(result.session?.state, "failed");
  assert.equal(result.signal, null);
});

test("reconcileSessionFromArtifacts marks parsed but unusable exit artifacts as invalid fallback reasons", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `exit-artifact-invalid-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const exitPath = launchScriptPath.replace(/\.launch\.sh$/, ".exit.json");
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(exitPath, "{}\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt: new Date().toISOString(),
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({ dbPath, sessionId });

  assert.equal(result.reconciled, true);
  assert.equal(result.signal?.signalSource, "rpc-status");
  assert.equal(result.signal?.fallbackReason, "exit-file-invalid");
});

test("reconcileSessionFromArtifacts enriches exit-file signals with final rpc-status metadata", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `exit-artifact-enriched-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const exitPath = launchScriptPath.replace(/\.launch\.sh$/, ".exit.json");
  const rpcStatusPath = launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json");
  const finishedAt = new Date().toISOString();

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(exitPath, '{"exitCode":0}\n', "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt,
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, createSessionRecord(sessionId, launchScriptPath));
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({ dbPath, sessionId });

  assert.equal(result.reconciled, true);
  assert.equal(result.signal?.signalSource, "exit-file");
  assert.equal(result.signal?.terminalSignalSource, "runner-finalize");
  assert.equal(result.signal?.finishedAt, finishedAt);
  assert.equal(result.signal?.fallbackReason, null);
});

test("reconcileSessionFromArtifacts replays persisted artifact recovery telemetry for already settled sessions", async () => {
  const { root, dbPath } = await makeTempPaths();
  const sessionId = `persisted-artifact-recovery-${Date.now()}`;
  const launchScriptPath = path.join(root, `${sessionId}.launch.sh`);
  const finishedAt = new Date().toISOString();
  const timestamp = new Date().toISOString();

  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, {
      ...createSessionRecord(sessionId, launchScriptPath),
      state: "completed",
      endedAt: timestamp,
      updatedAt: timestamp,
      artifactRecovery: {
        recovered: true,
        signalSource: "rpc-status",
        terminalSignalSource: "runner-finalize",
        fallbackReason: "exit-file-missing",
        artifactPath: launchScriptPath.replace(/\.launch\.sh$/, ".rpc-status.json"),
        exitCode: 0,
        nextState: "completed",
        finishedAt,
        status: "completed",
        artifactRecoveryCount: 1,
      },
    });
  } finally {
    db.close();
  }

  const result = await reconcileSessionFromArtifacts({ dbPath, sessionId });

  assert.equal(result.reconciled, false);
  assert.equal(result.session?.state, "completed");
  assert.equal(result.signal?.signalSource, "rpc-status");
  assert.equal(result.signal?.terminalSignalSource, "runner-finalize");
  assert.equal(result.signal?.fallbackReason, "exit-file-missing");
});
