import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type test from "node:test";

import { resolveCommandBinary } from "@spore/runtime-pi";

import { findFreePort, getJson, postJson, sleep } from "./http-harness.js";

type JsonRecord = Record<string, unknown>;

export interface SelfBuildSmokeStack {
  runDir: string;
  webBaseUrl: string;
  orchestratorBaseUrl: string;
  gatewayBaseUrl: string;
}

export interface SelfBuildSmokePromptCase {
  id: string;
  prompt: string;
}

export interface SelfBuildSmokeResult {
  threadId: string;
  runId: string;
  proposalId: string;
  integratorExecutionId: string;
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray<T = JsonRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          stderr || stdout || `${command} ${args.join(" ")} failed with ${code}`,
        ),
      );
    });
  });
}

async function canListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAlternatePortBase(): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const basePort = await findFreePort();
    if (
      (await canListenOnPort(basePort + 1)) &&
      (await canListenOnPort(basePort + 2))
    ) {
      return basePort;
    }
  }
  throw new Error("could not find an alternate free port base for smoke stack");
}

async function readDashboard(stack: SelfBuildSmokeStack) {
  const payload = await getJson(
    `${stack.webBaseUrl}/api/orchestrator/self-build/dashboard`,
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  assert.equal(payload.json.detail?.route?.self, "/self-build/dashboard");
  assert.ok(Array.isArray(payload.json.detail?.recentWorkItemRuns));
  assert.ok(typeof payload.json.detail?.attentionSummary === "object");
  assert.ok(typeof payload.json.detail?.queueSummary === "object");
  return payload.json.detail;
}

function assertNoManagedRunRecovery(threadDetail: JsonRecord) {
  const threadId = asString(threadDetail.id);
  const allActions = [
    ...asArray<JsonRecord>(threadDetail.pendingActions),
    ...asArray<JsonRecord>(threadDetail.actionHistory),
  ];
  const recoveryAction = allActions.find(
    (action) => asString(action.actionKind) === "managed-run-recovery",
  );
  assert.equal(
    recoveryAction,
    undefined,
    `managed-run-recovery appeared for thread ${threadId}`,
  );
}

async function getThreadDetail(
  stack: SelfBuildSmokeStack,
  threadId: string,
): Promise<JsonRecord> {
  const payload = await getJson(
    `${stack.orchestratorBaseUrl}/operator/threads/${encodeURIComponent(threadId)}`,
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  const detail = asObject(payload.json.detail);
  assertNoManagedRunRecovery(detail);
  return detail;
}

async function waitForThread(
  stack: SelfBuildSmokeStack,
  threadId: string,
  label: string,
  predicate: (detail: JsonRecord) => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<JsonRecord> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await getThreadDetail(stack, threadId);
    if (predicate(detail)) {
      return detail;
    }
    await sleep(intervalMs);
  }

  throw new Error(`thread ${threadId} did not reach ${label} in time`);
}

async function getProposalDetail(
  stack: SelfBuildSmokeStack,
  proposalId: string,
): Promise<JsonRecord> {
  const payload = await getJson(
    `${stack.orchestratorBaseUrl}/proposal-artifacts/${encodeURIComponent(proposalId)}`,
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  return asObject(payload.json.detail);
}

async function waitForProposalStatus(
  stack: SelfBuildSmokeStack,
  proposalId: string,
  statuses: string[],
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<JsonRecord> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await getProposalDetail(stack, proposalId);
    if (statuses.includes(asString(detail.status))) {
      return detail;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `proposal ${proposalId} did not reach ${statuses.join(", ")} in time`,
  );
}

function extractThreadRunId(detail: JsonRecord): string {
  const runId = asString(asObject(asObject(detail.context).latestRun).id).trim();
  assert.ok(runId, `expected latest run id in thread ${asString(detail.id)}`);
  return runId;
}

function extractThreadProposalId(detail: JsonRecord): string {
  const proposalId = asString(asObject(asObject(detail.context).proposal).id).trim();
  assert.ok(proposalId, `expected proposal id in thread ${asString(detail.id)}`);
  return proposalId;
}

async function reviewProposal(
  stack: SelfBuildSmokeStack,
  proposalId: string,
  promptCase: SelfBuildSmokePromptCase,
) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/proposal-artifacts/${encodeURIComponent(proposalId)}/review`,
    {
      status: "reviewed",
      comments: `Reviewed during self-build smoke coverage for ${promptCase.id}.`,
      by: "smoke-test",
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
}

async function approveProposal(
  stack: SelfBuildSmokeStack,
  proposalId: string,
  promptCase: SelfBuildSmokePromptCase,
) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/proposal-artifacts/${encodeURIComponent(proposalId)}/approval`,
    {
      status: "approved",
      comments: `Approved during self-build smoke coverage for ${promptCase.id}.`,
      by: "smoke-test",
      targetBranch: "main",
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  return asObject(payload.json.detail);
}

async function validateProposalRun(
  stack: SelfBuildSmokeStack,
  runId: string,
  promptCase: SelfBuildSmokePromptCase,
) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/work-item-runs/${encodeURIComponent(runId)}/validate-bundle`,
    {
      bundleIds: ["frontend-ui-pass"],
      wait: true,
      stub: false,
      timeout: 900_000,
      interval: 1_000,
      by: "smoke-test",
      source: `http-self-build-smoke-${promptCase.id}`,
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  return asObject(payload.json.detail);
}

async function planPromotion(stack: SelfBuildSmokeStack, proposalId: string) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/proposal-artifacts/${encodeURIComponent(proposalId)}/promotion-plan`,
    {
      targetBranch: "main",
      by: "smoke-test",
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  assert.equal(payload.json.detail?.proposal?.id, proposalId);
  assert.ok(payload.json.detail?.promotion?.sourceExecutionId);
}

async function invokePromotion(stack: SelfBuildSmokeStack, proposalId: string) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/proposal-artifacts/${encodeURIComponent(proposalId)}/promotion-invoke`,
    {
      targetBranch: "main",
      by: "smoke-test",
      wait: true,
      stub: false,
      timeout: 900_000,
      interval: 1_000,
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  assert.equal(payload.json.detail?.proposal?.id, proposalId);

  const integratorExecutionId = asString(
    payload.json.detail?.detail?.created?.execution?.id ??
      payload.json.detail?.detail?.plan?.invocation?.invocationId,
  ).trim();
  assert.ok(integratorExecutionId, "expected integrator execution id");
  return integratorExecutionId;
}

async function replyInThread(
  stack: SelfBuildSmokeStack,
  threadId: string,
  message: string,
  promptCase: SelfBuildSmokePromptCase,
) {
  const payload = await postJson(
    `${stack.orchestratorBaseUrl}/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message,
      by: "smoke-test",
      source: `http-self-build-smoke-${promptCase.id}`,
    },
  );
  assert.equal(payload.status, 200);
  assert.ok(payload.json.ok);
  const detail = asObject(payload.json.detail);
  assertNoManagedRunRecovery(detail);
  return detail;
}

export async function ensureRealPiSmokePrerequisites(
  t: test.TestContext,
): Promise<boolean> {
  if (process.env.SPORE_RUN_PI_E2E !== "1") {
    t.skip("set SPORE_RUN_PI_E2E=1 to run the dashboard/webui real-PI smoke test");
    return false;
  }

  const [piBinary, tmuxBinary] = await Promise.all([
    resolveCommandBinary("pi"),
    resolveCommandBinary("tmux"),
  ]);
  if (!piBinary) {
    t.skip("pi binary not available");
    return false;
  }
  if (!tmuxBinary) {
    t.skip("tmux not available");
    return false;
  }

  return true;
}

export async function startSelfBuildSmokeStack(
  t: test.TestContext,
): Promise<SelfBuildSmokeStack> {
  await fs.mkdir(path.join(process.cwd(), "tmp", "self-build-runs"), {
    recursive: true,
  });
  const runDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-http-self-build-smoke-"),
  );
  const portBase = await findAlternatePortBase();
  const startScript = path.join(
    process.cwd(),
    "scripts",
    "run-self-build-real-pi.sh",
  );
  const stopScript = path.join(process.cwd(), "scripts", "stop-self-build.sh");

  t.after(async () => {
    await runCommand(stopScript, [runDir]).catch(() => {});
  });

  await runCommand(startScript, [
    "--port-base",
    String(portBase),
    "--run-dir",
    runDir,
    "--name",
    "http-self-build-smoke",
  ]);

  const runtime = JSON.parse(
    await fs.readFile(path.join(runDir, "runtime.json"), "utf8"),
  ) as {
    gatewayPort: number;
    webPort: number;
    orchestratorPort: number;
  };

  const stack = {
    runDir,
    gatewayBaseUrl: `http://127.0.0.1:${runtime.gatewayPort}`,
    webBaseUrl: `http://127.0.0.1:${runtime.webPort}`,
    orchestratorBaseUrl: `http://127.0.0.1:${runtime.orchestratorPort}`,
  } satisfies SelfBuildSmokeStack;

  await readDashboard(stack);
  return stack;
}

export async function runPromptToPromotionCandidate(
  stack: SelfBuildSmokeStack,
  promptCase: SelfBuildSmokePromptCase,
): Promise<SelfBuildSmokeResult> {
  await readDashboard(stack);

  const createdThread = await postJson(
    `${stack.orchestratorBaseUrl}/operator/threads`,
    {
      message: promptCase.prompt,
      projectId: "spore",
      safeMode: true,
      stub: false,
      wait: true,
      by: "smoke-test",
      source: `http-self-build-smoke-${promptCase.id}`,
    },
  );
  assert.equal(createdThread.status, 200);
  assert.ok(createdThread.json.ok);

  const initialThread = asObject(createdThread.json.detail);
  assertNoManagedRunRecovery(initialThread);
  const threadId = asString(initialThread.id).trim();
  assert.ok(threadId, `expected thread id for ${promptCase.id}`);

  await waitForThread(
    stack,
    threadId,
    "goal-plan review",
    (detail) =>
      asArray<JsonRecord>(detail.pendingActions).some(
        (action) => asString(action.actionKind) === "goal-plan-review",
      ),
    { timeoutMs: 60_000, intervalMs: 1_000 },
  );

  await replyInThread(stack, threadId, "approve", promptCase);

  const reviewPending = await waitForThread(
    stack,
    threadId,
    "proposal review",
    (detail) =>
      asArray<JsonRecord>(detail.pendingActions).some(
        (action) => asString(action.actionKind) === "proposal-review",
      ),
  );
  const runId = extractThreadRunId(reviewPending);
  const proposalId = extractThreadProposalId(reviewPending);

  await reviewProposal(stack, proposalId, promptCase);
  await waitForThread(
    stack,
    threadId,
    "proposal approval",
    (detail) =>
      asArray<JsonRecord>(detail.pendingActions).some(
        (action) => asString(action.actionKind) === "proposal-approval",
      ),
    { timeoutMs: 90_000 },
  );

  const approval = await approveProposal(stack, proposalId, promptCase);
  const approvalStatus = asString(approval.status);
  if (
    !["promotion_ready", "promotion_candidate"].includes(approvalStatus) &&
    asString(approval.promotionStatus) !== "promotion_ready"
  ) {
    await validateProposalRun(stack, runId, promptCase);
  }

  await waitForProposalStatus(stack, proposalId, [
    "promotion_ready",
    "promotion_candidate",
  ]);
  await planPromotion(stack, proposalId);
  const integratorExecutionId = await invokePromotion(stack, proposalId);

  const candidateProposal = await waitForProposalStatus(
    stack,
    proposalId,
    ["promotion_candidate"],
    { timeoutMs: 2 * 60_000 },
  );
  assert.equal(candidateProposal.promotionStatus, "promotion_candidate");

  const finalThread = await waitForThread(
    stack,
    threadId,
    "promotion candidate projection",
    (detail) => {
      const proposal = asObject(asObject(detail.context).proposal);
      return (
        asString(proposal.id) === proposalId &&
        (asString(proposal.status) === "promotion_candidate" ||
          asString(proposal.promotionStatus) === "promotion_candidate")
      );
    },
    { timeoutMs: 2 * 60_000 },
  );
  assert.equal(extractThreadProposalId(finalThread), proposalId);
  await readDashboard(stack);

  return {
    threadId,
    runId,
    proposalId,
    integratorExecutionId,
  };
}
