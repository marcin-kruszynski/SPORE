#!/usr/bin/env node
import path from "node:path";

import { DEFAULT_EVENT_LOG_PATH, DEFAULT_SESSION_DB_PATH, PROJECT_ROOT } from "../../../session-manager/src/metadata/constants.js";
import { filterEvents, readEvents } from "../../../session-manager/src/events/event-log.js";
import {
  getSession,
  listSessions,
  openSessionDatabase
} from "../../../session-manager/src/store/session-store.js";
import { captureTmuxPane, tmuxSessionExists } from "../../../runtime-pi/src/launchers/tmux-launcher.js";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
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
  return { positional, flags };
}

function resolvePath(filePath, fallback) {
  const target = filePath ?? fallback;
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

function clearScreen() {
  process.stdout.write("\u001Bc");
}

function toNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeByState(items, key = "state") {
  if (!items) {
    return {};
  }
  if (!Array.isArray(items) && typeof items === "object") {
    return { ...items };
  }
  return items.reduce((accumulator, item) => {
    const state = item?.[key] ?? "unknown";
    accumulator[state] = (accumulator[state] ?? 0) + 1;
    return accumulator;
  }, {});
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function renderDashboard({ sessions, events }) {
  const byState = summarizeByState(sessions);

  const lines = [];
  lines.push("SPORE Operator Dashboard");
  lines.push("");
  lines.push(`Sessions: ${sessions.length}`);
  lines.push(`States: ${JSON.stringify(byState)}`);
  lines.push("");
  lines.push("Active / Recent Sessions:");
  for (const session of sessions.slice(0, 8)) {
    lines.push(
      `- ${session.id} | role=${session.role} | state=${session.state} | run=${session.runId} | tmux=${session.tmuxSession ?? "-"}`
    );
  }
  lines.push("");
  lines.push("Recent Events:");
  for (const event of events.slice(-10)) {
    lines.push(
      `- ${event.timestamp} | ${event.type} | session=${event.sessionId} | run=${event.runId}`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function readSnapshot(flags) {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db);
    const events = filterEvents(await readEvents(eventLogPath), {
      limit: flags.limit ?? "20"
    });
    return { sessions, events };
  } finally {
    db.close();
  }
}

async function dashboard(flags) {
  const render = async () => {
    const snapshot = await readSnapshot(flags);
    clearScreen();
    process.stdout.write(renderDashboard(snapshot));
  };

  await render();
  if (!flags.watch) {
    return;
  }

  const interval = toNumber(flags.interval, 1000);
  const timer = setInterval(() => {
    render().catch((error) => {
      process.stderr.write(`spore-ops error: ${error.message}\n`);
    });
  }, interval);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });
}

async function inspect(flags) {
  if (!flags.session) {
    throw new Error("use --session <id>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const session = getSession(db, flags.session);
    const events = filterEvents(await readEvents(eventLogPath), {
      session: flags.session,
      limit: flags.limit ?? "20"
    });
    let pane = null;
    if (session?.tmuxSession && (await tmuxSessionExists(session.tmuxSession))) {
      pane = await captureTmuxPane(
        session.tmuxSession,
        toNumber(flags.lines, 80)
      );
    }
    console.log(
      JSON.stringify(
        {
          session,
          events,
          pane
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

function resolveOrchestratorOrigin(flags) {
  return flags.api ?? flags.origin ?? process.env.SPORE_ORCHESTRATOR_ORIGIN ?? "http://127.0.0.1:8789";
}

async function orchestratorRequest(flags, route, options = {}) {
  const origin = resolveOrchestratorOrigin(flags).replace(/\/$/, "");
  const response = await fetch(`${origin}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
  }
  return payload;
}

function renderStepSummary(stepSummary) {
  const byState = summarizeByState(stepSummary?.byState ?? [], "state");
  return {
    count: stepSummary?.count ?? 0,
    byState
  };
}

function renderTreeNode(node, depth = 0) {
  const indent = "  ".repeat(depth);
  const lines = [];
  const execution = node.execution ?? {};
  const stepSummary = renderStepSummary(node.stepSummary);
  lines.push(
    `${indent}- ${execution.id} | state=${execution.state ?? "unknown"} | branch=${execution.branchKey ?? "root"} | steps=${stepSummary.count}`
  );
  if (Object.keys(stepSummary.byState).length) {
    lines.push(`${indent}  step-states=${JSON.stringify(stepSummary.byState)}`);
  }
  if (node.children?.length) {
    for (const child of node.children) {
      lines.push(renderTreeNode(child, depth + 1));
    }
  }
  return lines.join("\n");
}

function renderWaveSummary(stepSummary) {
  const waves = Array.isArray(stepSummary?.byWave)
    ? stepSummary.byWave
    : Object.values(stepSummary?.waves ?? {});
  const sorted = waves.sort((left, right) => (left.wave ?? 0) - (right.wave ?? 0));
  return sorted.map((wave) => ({
    wave: wave.wave,
    name: wave.waveName,
    count: wave.count,
    satisfied: wave.satisfied,
    byState: wave.byState,
    gate: wave.gate,
    policy: wave.policy
  }));
}

async function executionTree(flags) {
  if (!flags.execution) {
    throw new Error("use tree --execution <id>");
  }
  const payload = await orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/tree`);
  const output = {
    rootExecutionId: payload.tree.rootExecutionId,
    executionCount: payload.tree.executionCount,
    tree: renderTreeNode(payload.tree.root),
    waveSummary: renderWaveSummary(payload.tree.root?.stepSummary)
  };
  console.log(formatJson(output));
}

async function executionFamily(flags) {
  if (!flags.execution) {
    throw new Error("use family --execution <id>");
  }
  if (flags.review) {
    await treeAction({
      ...flags,
      status: flags.review,
      comments: flags.comments,
      scope: flags.scope ?? "all-pending"
    }, "review");
    return;
  }
  if (flags.approve) {
    await treeAction({
      ...flags,
      status: flags.approve,
      comments: flags.comments,
      scope: flags.scope ?? "all-pending"
    }, "approval");
    return;
  }

  const [tree, audit] = await Promise.all([
    orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/tree`),
    orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/audit`).catch(() => ({ audit: [] }))
  ]);

  console.log(formatJson({
    rootExecutionId: tree.tree.rootExecutionId,
    executionCount: tree.tree.executionCount,
    tree: renderTreeNode(tree.tree.root),
    waveSummary: renderWaveSummary(tree.tree.root?.stepSummary),
    audit: (audit.audit ?? []).slice(0, toNumber(flags.limit, 12))
  }));
}

async function executionAudit(flags) {
  if (!flags.execution) {
    throw new Error("use audit --execution <id>");
  }
  const payload = await orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/audit`);
  console.log(formatJson(payload));
}

async function executionPolicyDiff(flags) {
  if (!flags.execution) {
    throw new Error("use policy-diff --execution <id>");
  }
  const payload = await orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/policy-diff`);
  console.log(formatJson(payload));
}

async function executionHistory(flags) {
  if (!flags.execution) {
    throw new Error("use history --execution <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/executions/${encodeURIComponent(flags.execution)}/history?scope=${encodeURIComponent(flags.scope ?? "execution")}`
  );
  console.log(formatJson(payload));
}

async function runCenter(flags) {
  const payload = await orchestratorRequest(
    flags,
    `/run-center/summary?limit=${encodeURIComponent(String(flags.limit ?? "10"))}`
  );
  console.log(formatJson(payload));
}

async function executionDetail(flags) {
  if (!flags.execution) {
    throw new Error("use execution --execution <id>");
  }
  const [detail, tree] = await Promise.all([
    orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}`),
    orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/tree`).catch(() => null)
  ]);
  const detailPayload = detail.detail ?? detail;
  console.log(formatJson({
    execution: detailPayload.execution,
    steps: detailPayload.steps,
    events: (detailPayload.events ?? []).slice(-toNumber(flags.limit, 20)),
    escalations: detailPayload.escalations ?? [],
    reviews: detailPayload.reviews ?? [],
    approvals: detailPayload.approvals ?? [],
    tree: tree?.tree ?? null
  }));
}

async function treeAction(flags, action) {
  if (!flags.execution) {
    throw new Error(`use ${action} --execution <id>`);
  }
  const payload = {
    by: flags.by ?? "operator",
    reason: flags.reason,
    comments: flags.comments,
    owner: flags.owner,
    guidance: flags.guidance,
    timeoutMs: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    status: flags.status,
    scope: flags.scope ?? "all-pending"
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  const response = await orchestratorRequest(flags, `/executions/${encodeURIComponent(flags.execution)}/tree/${action}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  console.log(formatJson(response));
}

async function scenarioList(flags) {
  const payload = await orchestratorRequest(flags, "/scenarios");
  console.log(formatJson(payload));
}

async function scenarioShow(flags) {
  if (!flags.scenario) {
    throw new Error("use scenario-show --scenario <id>");
  }
  const payload = await orchestratorRequest(flags, `/scenarios/${encodeURIComponent(flags.scenario)}`);
  console.log(formatJson(payload));
}

async function scenarioRuns(flags) {
  if (!flags.scenario) {
    throw new Error("use scenario-runs --scenario <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/scenarios/${encodeURIComponent(flags.scenario)}/runs?limit=${encodeURIComponent(String(flags.limit ?? "20"))}`
  );
  console.log(formatJson(payload));
}

async function scenarioRun(flags) {
  if (!flags.scenario) {
    throw new Error("use scenario-run --scenario <id>");
  }
  const body = {
    project: flags.project,
    wait: flags.wait !== false,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    stub: flags.stub === true,
    launcher: flags.launcher,
    objective: flags.objective,
    by: flags.by ?? "operator",
    source: "tui"
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, `/scenarios/${encodeURIComponent(flags.scenario)}/run`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function scenarioRunShow(flags) {
  if (!flags.run) {
    throw new Error("use scenario-run-show --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/scenario-runs/${encodeURIComponent(flags.run)}`);
  console.log(formatJson(payload));
}

async function scenarioRunArtifacts(flags) {
  if (!flags.run) {
    throw new Error("use scenario-run-artifacts --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/scenario-runs/${encodeURIComponent(flags.run)}/artifacts`);
  console.log(formatJson(payload));
}

async function scenarioRerun(flags) {
  if (!flags.run) {
    throw new Error("use scenario-rerun --run <id>");
  }
  const body = {
    project: flags.project,
    wait: flags.wait !== false,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    stub: flags.stub === true,
    launcher: flags.launcher,
    objective: flags.objective,
    by: flags.by ?? "operator",
    source: "tui",
    reason: flags.reason
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, `/scenario-runs/${encodeURIComponent(flags.run)}/rerun`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function scenarioTrends(flags) {
  if (!flags.scenario) {
    throw new Error("use scenario-trends --scenario <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/scenarios/${encodeURIComponent(flags.scenario)}/trends?limit=${encodeURIComponent(String(flags.limit ?? "100"))}`
  );
  console.log(formatJson(payload));
}

async function regressionList(flags) {
  const payload = await orchestratorRequest(flags, "/regressions");
  console.log(formatJson(payload));
}

async function regressionShow(flags) {
  if (!flags.regression) {
    throw new Error("use regression-show --regression <id>");
  }
  const payload = await orchestratorRequest(flags, `/regressions/${encodeURIComponent(flags.regression)}`);
  console.log(formatJson(payload));
}

async function regressionRuns(flags) {
  if (!flags.regression) {
    throw new Error("use regression-runs --regression <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/regressions/${encodeURIComponent(flags.regression)}/runs?limit=${encodeURIComponent(String(flags.limit ?? "20"))}`
  );
  console.log(formatJson(payload));
}

async function regressionRun(flags) {
  if (!flags.regression) {
    throw new Error("use regression-run --regression <id>");
  }
  const body = {
    project: flags.project,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    stub: flags.stub === true,
    launcher: flags.launcher,
    by: flags.by ?? "operator",
    source: "tui"
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, `/regressions/${encodeURIComponent(flags.regression)}/run`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function regressionRunShow(flags) {
  if (!flags.run) {
    throw new Error("use regression-run-show --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/regression-runs/${encodeURIComponent(flags.run)}`);
  console.log(formatJson(payload));
}

async function regressionReport(flags) {
  if (!flags.run) {
    throw new Error("use regression-report --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/regression-runs/${encodeURIComponent(flags.run)}/report`);
  console.log(formatJson(payload));
}

async function regressionRerun(flags) {
  if (!flags.run) {
    throw new Error("use regression-rerun --run <id>");
  }
  const body = {
    project: flags.project,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    stub: flags.stub === true,
    launcher: flags.launcher,
    by: flags.by ?? "operator",
    source: "tui",
    reason: flags.reason
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, `/regression-runs/${encodeURIComponent(flags.run)}/rerun`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function regressionTrends(flags) {
  if (!flags.regression) {
    throw new Error("use regression-trends --regression <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/regressions/${encodeURIComponent(flags.regression)}/trends?limit=${encodeURIComponent(String(flags.limit ?? "100"))}`
  );
  console.log(formatJson(payload));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (command === "dashboard") {
    await dashboard(flags);
    return;
  }
  if (command === "inspect") {
    await inspect(flags);
    return;
  }
  if (command === "execution") {
    await executionDetail(flags);
    return;
  }
  if (command === "tree") {
    await executionTree(flags);
    return;
  }
  if (command === "family") {
    await executionFamily(flags);
    return;
  }
  if (command === "audit") {
    await executionAudit(flags);
    return;
  }
  if (command === "policy-diff") {
    await executionPolicyDiff(flags);
    return;
  }
  if (command === "history") {
    await executionHistory(flags);
    return;
  }
  if (command === "run-center") {
    await runCenter(flags);
    return;
  }
  if (command === "scenario-list") {
    await scenarioList(flags);
    return;
  }
  if (command === "scenario-show") {
    await scenarioShow(flags);
    return;
  }
  if (command === "scenario-runs") {
    await scenarioRuns(flags);
    return;
  }
  if (command === "scenario-run") {
    await scenarioRun(flags);
    return;
  }
  if (command === "scenario-run-show") {
    await scenarioRunShow(flags);
    return;
  }
  if (command === "scenario-run-artifacts") {
    await scenarioRunArtifacts(flags);
    return;
  }
  if (command === "scenario-rerun") {
    await scenarioRerun(flags);
    return;
  }
  if (command === "scenario-trends") {
    await scenarioTrends(flags);
    return;
  }
  if (command === "regression-list") {
    await regressionList(flags);
    return;
  }
  if (command === "regression-show") {
    await regressionShow(flags);
    return;
  }
  if (command === "regression-runs") {
    await regressionRuns(flags);
    return;
  }
  if (command === "regression-run") {
    await regressionRun(flags);
    return;
  }
  if (command === "regression-run-show") {
    await regressionRunShow(flags);
    return;
  }
  if (command === "regression-report") {
    await regressionReport(flags);
    return;
  }
  if (command === "regression-rerun") {
    await regressionRerun(flags);
    return;
  }
  if (command === "regression-trends") {
    await regressionTrends(flags);
    return;
  }
  if (["pause", "hold", "resume", "review", "approval", "drive"].includes(command)) {
    await treeAction(flags, command);
    return;
  }
  throw new Error("commands: dashboard | inspect | execution | tree | family | audit | policy-diff | history | run-center | scenario-list | scenario-show | scenario-runs | scenario-run | scenario-run-show | scenario-run-artifacts | scenario-rerun | scenario-trends | regression-list | regression-show | regression-runs | regression-run | regression-run-show | regression-report | regression-rerun | regression-trends | drive | pause | hold | resume | review | approval");
}

main().catch((error) => {
  console.error(`spore-ops error: ${error.message}`);
  process.exitCode = 1;
});
