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

async function regressionLatestReport(flags) {
  if (!flags.regression) {
    throw new Error("use regression-latest-report --regression <id>");
  }
  const payload = await orchestratorRequest(
    flags,
    `/regressions/${encodeURIComponent(flags.regression)}/latest-report`
  );
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

async function regressionScheduler(flags) {
  const body = {
    regression: flags.regression,
    all: flags.all === true,
    dryRun: flags["dry-run"] === true,
    maxRuns: flags["max-runs"] ? toNumber(flags["max-runs"], null) : undefined,
    project: flags.project,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    stub: flags.stub === true,
    launcher: flags.launcher,
    by: flags.by ?? "scheduler",
    source: "tui",
    noMonitor: flags["no-monitor"] === true
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, "/regressions/scheduler/run", {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function regressionSchedulerStatus(flags) {
  const payload = await orchestratorRequest(flags, "/regressions/scheduler/status");
  console.log(formatJson(payload));
}

function renderSelfBuildTriage(payload) {
  const detail = payload?.detail ?? {};
  const overview = detail.overview ?? {};
  const groups = Array.isArray(detail.groups) ? [...detail.groups] : [];
  const urgentWork = detail.urgentWork ?? [];
  const followUpWork = detail.followUpWork ?? [];
  const counts = detail.counts ?? {};
  const recentActivity = detail.recentActivity ?? {};
  const currentIndicator = detail.currentIndicator ?? "";

  const lines = [];
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("  SPORE Self-Build Triage");
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");

  // Overview section
  lines.push("OVERVIEW");
  lines.push("--------");
  lines.push(`Work Items: ${overview.totalWorkItems ?? 0} | Groups: ${overview.totalGroups ?? 0} | Proposals: ${overview.totalProposals ?? 0}`);
  lines.push("");

  // Status counts
  if (Object.keys(counts).length > 0) {
    const statusParts = [];
    for (const [key, value] of Object.entries(counts)) {
      if (value > 0) {
        statusParts.push(`${key}=${value}`);
      }
    }
    if (statusParts.length > 0) {
      lines.push(`Status: ${statusParts.join(", ")}`);
      lines.push("");
    }
  }

  lines.push('GROUP READINESS');
  lines.push('---------------');
  if (groups.length === 0) {
    lines.push('No work-item groups materialized yet');
  } else {
    const sortedGroups = groups.sort((left, right) => {
      const order = { failed: 0, blocked: 1, running: 2, ready: 3, completed: 4, pending: 5 };
      const leftState = order[left?.readiness?.headlineState ?? left?.status ?? 'pending'] ?? 6;
      const rightState = order[right?.readiness?.headlineState ?? right?.status ?? 'pending'] ?? 6;
      if (leftState !== rightState) {
        return leftState - rightState;
      }
      return String(left?.title ?? left?.id ?? '').localeCompare(String(right?.title ?? right?.id ?? ''));
    });

    for (const group of sortedGroups.slice(0, 6)) {
      const readiness = group.readiness ?? {};
      const readinessCounts = readiness.counts ?? {};
      lines.push(`[${String(readiness.headlineState ?? group.status ?? 'pending').toUpperCase()}] ${group.title ?? group.id}`);
      lines.push(`      ${readiness.preRunSummary?.label ?? 'No pre-run dependency summary available.'}`);
      lines.push(
        `      counts: ready=${readinessCounts.ready ?? 0}, blocked=${readinessCounts.blocked ?? 0}, review-needed=${readinessCounts.reviewNeeded ?? 0}, failed=${readinessCounts.failed ?? 0}`
      );
      if ((readiness.blockerIds ?? []).length > 0) {
        lines.push(`      blockers: ${readiness.blockerIds.slice(0, 2).join(', ')}`);
      }
      if (readiness.nextActionHint) {
        lines.push(`      next: ${readiness.nextActionHint}`);
      }
      lines.push(`      → /work-item-groups/${group.id}`);
      lines.push('');
    }
  }

  // Urgent work queue
  lines.push("URGENT WORK");
  lines.push("-----------");
  if (urgentWork.length === 0) {
    lines.push("✓ No urgent work - all clear");
  } else {
    for (const item of urgentWork.slice(0, 10)) {
      const badge = item.priority === "high" ? "[HIGH]" : "[MED] ";
      const id = item.itemId ?? item.proposalId ?? item.runId ?? "unknown";
      lines.push(`${badge} ${item.kind}`);
      lines.push(`      ${item.title}`);
      lines.push(`      ${item.reason}`);
      if (Array.isArray(item.blockerIds) && item.blockerIds.length > 0) {
        lines.push(`      blockers: ${item.blockerIds.slice(0, 2).join(', ')}`);
      }
      if (item.nextActionHint) {
        lines.push(`      next: ${item.nextActionHint}`);
      }
      lines.push(`      → ${item.httpHint}`);
      lines.push("");
    }
    if (urgentWork.length > 10) {
      lines.push(`... and ${urgentWork.length - 10} more urgent items`);
      lines.push("");
    }
  }

  // Follow-up work queue
  lines.push("FOLLOW-UP WORK");
  lines.push("--------------");
  if (followUpWork.length === 0) {
    lines.push("✓ No pending follow-up work");
  } else {
    for (const item of followUpWork.slice(0, 8)) {
      const badge = item.priority === "high" ? "[HIGH]" : item.priority === "medium" ? "[MED] " : "[LOW] ";
      lines.push(`${badge} ${item.kind}`);
      lines.push(`      ${item.title}`);
      lines.push(`      ${item.reason}`);
      lines.push(`      → ${item.httpHint}`);
      if (item.actionHint) {
        lines.push(`      Action: ${item.actionHint}`);
      }
      lines.push("");
    }
    if (followUpWork.length > 8) {
      lines.push(`... and ${followUpWork.length - 8} more follow-up items`);
      lines.push("");
    }
  }

  // Recent activity timestamp
  if (recentActivity.timestamp) {
    lines.push("FRESHNESS");
    lines.push("---------");
    lines.push(`Most recent activity: ${recentActivity.timestamp} (${recentActivity.kind ?? "unknown"})`);
    lines.push("");
  }

  // Current status indicator
  if (currentIndicator) {
    lines.push(`Status: ${currentIndicator}`);
    lines.push("");
  }

  // Next actions
  lines.push("NEXT ACTIONS");
  lines.push("------------");
  if (urgentWork.length > 0) {
    lines.push("→ Review urgent work above and take action");
    lines.push("→ Use drilldown commands for detail:");
    lines.push("    spore-ops self-build --item <id>");
    lines.push("    spore-ops self-build --proposal <id>");
    lines.push("    spore-ops self-build --group <id>");
  } else if (followUpWork.length > 0) {
    lines.push("→ Consider follow-up work queue");
    lines.push("→ Validate completed runs or follow doc suggestions");
  } else {
    lines.push("→ System idle - use orchestrator to create new work");
    lines.push("    goal-plan-create, work-item-create, work-item-group-run");
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

function renderWorkItemGroupDetail(detail = {}) {
  const readiness = detail.readiness ?? {};
  const counts = readiness.counts ?? {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const edges = Array.isArray(detail.dependencyGraph?.edges) ? detail.dependencyGraph.edges : [];
  const transitions = Array.isArray(detail.dependencyGraph?.transitionLog) ? detail.dependencyGraph.transitionLog : [];
  const attentionItems = items.filter((item) => ['blocked', 'review_needed'].includes(item?.dependencyState?.state));

  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('  SPORE Work-Item Group');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('GROUP');
  lines.push('-----');
  lines.push(`${detail.title ?? detail.id}`);
  lines.push(`State: ${readiness.headlineState ?? detail.status ?? 'pending'}`);
  lines.push(`Summary: ${readiness.preRunSummary?.label ?? 'No pre-run dependency summary available.'}`);
  lines.push(
    `Counts: ready=${counts.ready ?? 0}, blocked=${counts.blocked ?? 0}, review-needed=${counts.reviewNeeded ?? 0}, running=${counts.running ?? 0}, completed=${counts.completed ?? 0}, failed=${counts.failed ?? 0}`
  );
  if ((readiness.blockerIds ?? []).length > 0) {
    lines.push(`Blockers: ${readiness.blockerIds.join(', ')}`);
  }
  if (readiness.nextActionHint) {
    lines.push(`Next: ${readiness.nextActionHint}`);
  }
  lines.push('');

  lines.push('DEPENDENCIES');
  lines.push('------------');
  if (edges.length === 0) {
    lines.push('No dependency edges configured');
  } else {
    for (const edge of edges) {
      lines.push(`[${String(edge.strictness ?? 'hard').toUpperCase()}] ${edge.itemTitle ?? edge.itemId}`);
      lines.push(`      waits on: ${edge.dependencyTitle ?? edge.dependencyItemId}`);
      lines.push(`      label: ${edge.label ?? `${edge.strictness ?? 'hard'} dependency`}`);
      if (edge.autoRelaxation?.enabled) {
        lines.push(`      auto-relax: ${edge.autoRelaxation.mode ?? 'warn-and-run'}`);
      }
      lines.push('');
    }
  }

  lines.push('ATTENTION');
  lines.push('---------');
  if (attentionItems.length === 0) {
    lines.push('No blocked or review-needed items');
  } else {
    for (const item of attentionItems) {
      const dependencyState = item.dependencyState ?? {};
      const blocker = dependencyState.blockers?.[0] ?? null;
      lines.push(`[${String(dependencyState.state ?? item.status ?? 'pending').toUpperCase()}] ${item.title ?? item.id}`);
      if (blocker?.id) {
        lines.push(`      blocker: ${blocker.id}`);
      }
      if (blocker?.strictness) {
        lines.push(`      strictness: ${blocker.strictness}`);
      }
      lines.push(`      reason: ${dependencyState.reason ?? item.blockedReason ?? 'No dependency reason available.'}`);
      lines.push(`      next: ${item.nextActionHint ?? dependencyState.nextActionHint ?? 'Inspect the group detail.'}`);
      lines.push(`      → /work-items/${item.id}`);
      lines.push('');
    }
  }

  lines.push('TRANSITIONS');
  lines.push('-----------');
  if (transitions.length === 0) {
    lines.push('No dependency transitions recorded');
  } else {
    for (const entry of transitions.slice(0, 6)) {
      lines.push(`${entry.type ?? 'dependency-update'} | state=${entry.state ?? '-'} | blocker=${entry.blockerId ?? '-'}`);
      lines.push(`      ${entry.reason ?? 'Dependency state updated.'}`);
    }
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  return lines.join('\n');
}

async function selfBuildSummary(flags) {
  const payload = await orchestratorRequest(flags, "/self-build/summary");
  // self-build-summary always returns JSON for backward compatibility
  console.log(formatJson(payload));
}

async function selfBuild(flags) {
  // Drilldown support for self-build records
  if (flags.item) {
    await workItemShow(flags);
    return;
  }
  if (flags.proposal) {
    await proposalShow(flags);
    return;
  }
  if (flags.group) {
    await workItemGroupShow(flags);
    return;
  }
  if (flags.run) {
    await workItemRunShow(flags);
    return;
  }
  if (flags.plan) {
    await goalPlanShow(flags);
    return;
  }
  // Default to triage summary
  const payload = await orchestratorRequest(flags, "/self-build/summary");
  if (flags.json) {
    console.log(formatJson(payload));
    return;
  }
  console.log(renderSelfBuildTriage(payload));
}

async function workItemTemplateList(flags) {
  const payload = await orchestratorRequest(flags, "/work-item-templates");
  console.log(formatJson(payload));
}

async function workItemTemplateShow(flags) {
  if (!flags.template) {
    throw new Error("use work-item-template-show --template <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-templates/${encodeURIComponent(flags.template)}`);
  console.log(formatJson(payload));
}

async function goalPlanCreate(flags) {
  if (!flags.goal) {
    throw new Error("use goal-plan-create --goal <text>");
  }
  const payload = await orchestratorRequest(flags, "/goals/plan", {
    method: "POST",
    body: JSON.stringify({
      title: flags.title ?? null,
      goal: flags.goal,
      projectId: flags.project ?? "spore",
      domainId: flags.domain ?? null,
      mode: flags.mode ?? "supervised",
      safeMode: flags["safe-mode"] !== false,
      constraints: flags.constraints ? JSON.parse(String(flags.constraints)) : {},
      by: flags.by ?? "operator",
      source: "tui"
    })
  });
  console.log(formatJson(payload));
}

async function goalPlanList(flags) {
  const search = new URLSearchParams();
  if (flags.status) search.set("status", flags.status);
  if (flags.limit) search.set("limit", String(flags.limit));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const payload = await orchestratorRequest(flags, `/goal-plans${suffix}`);
  console.log(formatJson(payload));
}

async function goalPlanShow(flags) {
  if (!flags.plan) {
    throw new Error("use goal-plan-show --plan <id>");
  }
  const payload = await orchestratorRequest(flags, `/goal-plans/${encodeURIComponent(flags.plan)}`);
  console.log(formatJson(payload));
}

async function goalPlanMaterialize(flags) {
  if (!flags.plan) {
    throw new Error("use goal-plan-materialize --plan <id>");
  }
  const payload = await orchestratorRequest(flags, `/goal-plans/${encodeURIComponent(flags.plan)}/materialize`, {
    method: "POST",
    body: JSON.stringify({
      by: flags.by ?? "operator",
      source: "tui"
    })
  });
  console.log(formatJson(payload));
}

async function workItemGroupList(flags) {
  const search = new URLSearchParams();
  if (flags.status) search.set("status", flags.status);
  if (flags.limit) search.set("limit", String(flags.limit));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const payload = await orchestratorRequest(flags, `/work-item-groups${suffix}`);
  if (flags.json) {
    console.log(formatJson(payload));
    return;
  }
  console.log(formatJson(payload));
}

async function workItemGroupShow(flags) {
  if (!flags.group) {
    throw new Error("use work-item-group-show --group <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-groups/${encodeURIComponent(flags.group)}`);
  if (flags.json) {
    console.log(formatJson(payload));
    return;
  }
  console.log(renderWorkItemGroupDetail(payload.detail ?? payload));
}

async function workItemGroupRun(flags) {
  if (!flags.group) {
    throw new Error("use work-item-group-run --group <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-groups/${encodeURIComponent(flags.group)}/run`, {
    method: "POST",
    body: JSON.stringify({
      project: flags.project,
      wait: flags.wait !== false,
      timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
      interval: flags.interval ? toNumber(flags.interval, null) : undefined,
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher,
      by: flags.by ?? "operator",
      source: "tui"
    })
  });
  console.log(formatJson(payload));
}

async function workItemList(flags) {
  const search = new URLSearchParams();
  if (flags.status) search.set("status", flags.status);
  if (flags.limit) search.set("limit", String(flags.limit));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const payload = await orchestratorRequest(flags, `/work-items${suffix}`);
  console.log(formatJson(payload));
}

async function workItemShow(flags) {
  if (!flags.item) {
    throw new Error("use work-item-show --item <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-items/${encodeURIComponent(flags.item)}`);
  console.log(formatJson(payload));
}

async function workItemRuns(flags) {
  if (!flags.item) {
    throw new Error("use work-item-runs --item <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-items/${encodeURIComponent(flags.item)}/runs`);
  console.log(formatJson(payload));
}

async function workItemCreate(flags) {
  if ((!flags.title || !flags.kind) && !flags.template) {
    throw new Error("use work-item-create --title <text> --kind <scenario|regression|workflow> or --template <id>");
  }
  const body = {
    templateId: flags.template ?? null,
    title: flags.title,
    kind: flags.kind,
    source: flags.source ?? "tui",
    goal: flags.goal ?? "",
    priority: flags.priority ?? "medium",
    acceptanceCriteria: flags.acceptance ? String(flags.acceptance).split("|").map((item) => item.trim()).filter(Boolean) : [],
    relatedDocs: flags.docs ? String(flags.docs).split(",").map((item) => item.trim()).filter(Boolean) : [],
    relatedScenarios: flags.scenarios ? String(flags.scenarios).split(",").map((item) => item.trim()).filter(Boolean) : [],
    relatedRegressions: flags.regressions ? String(flags.regressions).split(",").map((item) => item.trim()).filter(Boolean) : [],
    metadata: {
      scenarioId: flags.scenario ?? null,
      regressionId: flags.regression ?? null,
      workflowPath: flags.workflow ?? null,
      domainId: flags.domain ?? null,
      roles: flags.roles ? String(flags.roles).split(",").map((item) => item.trim()).filter(Boolean) : null,
      projectPath: flags.project ?? null,
      safeMode: flags["safe-mode"] !== false,
      mutationScope: flags["mutation-scope"]
        ? String(flags["mutation-scope"]).split(",").map((item) => item.trim()).filter(Boolean)
        : null
    }
  };
  const payload = await orchestratorRequest(flags, "/work-items", {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function workItemRun(flags) {
  if (!flags.item) {
    throw new Error("use work-item-run --item <id>");
  }
  const body = {
    project: flags.project,
    wait: flags.wait !== false,
    timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
    interval: flags.interval ? toNumber(flags.interval, null) : undefined,
    noMonitor: flags["no-monitor"] === true,
    stub: flags.stub === true,
    launcher: flags.launcher,
    by: flags.by ?? "operator",
    source: "tui"
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const payload = await orchestratorRequest(flags, `/work-items/${encodeURIComponent(flags.item)}/run`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(formatJson(payload));
}

async function workItemRunShow(flags) {
  if (!flags.run) {
    throw new Error("use work-item-run-show --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-runs/${encodeURIComponent(flags.run)}`);
  console.log(formatJson(payload));
}

async function workItemValidate(flags) {
  if (!flags.run) {
    throw new Error("use work-item-validate --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-runs/${encodeURIComponent(flags.run)}/validate`, {
    method: "POST",
    body: JSON.stringify({
      timeout: flags.timeout ? toNumber(flags.timeout, null) : undefined,
      interval: flags.interval ? toNumber(flags.interval, null) : undefined,
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub !== false,
      launcher: flags.launcher,
      by: flags.by ?? "operator",
      source: "tui"
    })
  });
  console.log(formatJson(payload));
}

async function workItemDocSuggestions(flags) {
  if (!flags.run) {
    throw new Error("use work-item-doc-suggestions --run <id>");
  }
  const payload = await orchestratorRequest(flags, `/work-item-runs/${encodeURIComponent(flags.run)}/doc-suggestions`);
  console.log(formatJson(payload));
}

async function proposalShow(flags) {
  if (!flags.proposal && !flags.run) {
    throw new Error("use proposal-show --proposal <id> or --run <work-item-run-id>");
  }
  const target = flags.proposal
    ? `/proposal-artifacts/${encodeURIComponent(flags.proposal)}`
    : `/work-item-runs/${encodeURIComponent(flags.run)}/proposal`;
  const payload = await orchestratorRequest(flags, target);
  console.log(formatJson(payload));
}

async function proposalReview(flags) {
  if (!flags.proposal || !flags.status) {
    throw new Error("use proposal-review --proposal <id> --status <ready_for_review|reviewed|rejected>");
  }
  const payload = await orchestratorRequest(flags, `/proposal-artifacts/${encodeURIComponent(flags.proposal)}/review`, {
    method: "POST",
    body: JSON.stringify({
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? ""
    })
  });
  console.log(formatJson(payload));
}

async function proposalApprove(flags) {
  if (!flags.proposal || !flags.status) {
    throw new Error("use proposal-approve --proposal <id> --status <approved|rejected>");
  }
  const payload = await orchestratorRequest(flags, `/proposal-artifacts/${encodeURIComponent(flags.proposal)}/approval`, {
    method: "POST",
    body: JSON.stringify({
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? ""
    })
  });
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
  if (command === "regression-latest-report") {
    await regressionLatestReport(flags);
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
  if (command === "regression-scheduler") {
    await regressionScheduler(flags);
    return;
  }
  if (command === "regression-scheduler-status") {
    await regressionSchedulerStatus(flags);
    return;
  }
  if (command === "self-build-summary") {
    await selfBuildSummary(flags);
    return;
  }
  if (command === "self-build") {
    await selfBuild(flags);
    return;
  }
  if (command === "work-item-template-list") {
    await workItemTemplateList(flags);
    return;
  }
  if (command === "work-item-template-show") {
    await workItemTemplateShow(flags);
    return;
  }
  if (command === "goal-plan-create") {
    await goalPlanCreate(flags);
    return;
  }
  if (command === "goal-plan-list") {
    await goalPlanList(flags);
    return;
  }
  if (command === "goal-plan-show") {
    await goalPlanShow(flags);
    return;
  }
  if (command === "goal-plan-materialize") {
    await goalPlanMaterialize(flags);
    return;
  }
  if (command === "work-item-group-list") {
    await workItemGroupList(flags);
    return;
  }
  if (command === "work-item-group-show") {
    await workItemGroupShow(flags);
    return;
  }
  if (command === "work-item-group-run") {
    await workItemGroupRun(flags);
    return;
  }
  if (command === "work-item-list") {
    await workItemList(flags);
    return;
  }
  if (command === "work-item-show") {
    await workItemShow(flags);
    return;
  }
  if (command === "work-item-runs") {
    await workItemRuns(flags);
    return;
  }
  if (command === "work-item-create") {
    await workItemCreate(flags);
    return;
  }
  if (command === "work-item-run") {
    await workItemRun(flags);
    return;
  }
  if (command === "work-item-run-show") {
    await workItemRunShow(flags);
    return;
  }
  if (command === "work-item-validate") {
    await workItemValidate(flags);
    return;
  }
  if (command === "work-item-doc-suggestions") {
    await workItemDocSuggestions(flags);
    return;
  }
  if (command === "proposal-show") {
    await proposalShow(flags);
    return;
  }
  if (command === "proposal-review") {
    await proposalReview(flags);
    return;
  }
  if (command === "proposal-approve") {
    await proposalApprove(flags);
    return;
  }
  if (["pause", "hold", "resume", "review", "approval", "drive"].includes(command)) {
    await treeAction(flags, command);
    return;
  }
  throw new Error("commands: dashboard | inspect | execution | tree | family | audit | policy-diff | history | run-center | self-build | self-build-summary | scenario-list | scenario-show | scenario-runs | scenario-run | scenario-run-show | scenario-run-artifacts | scenario-rerun | scenario-trends | regression-list | regression-show | regression-runs | regression-run | regression-run-show | regression-report | regression-latest-report | regression-rerun | regression-trends | regression-scheduler | regression-scheduler-status | work-item-template-list | work-item-template-show | goal-plan-create | goal-plan-list | goal-plan-show | goal-plan-materialize | work-item-group-list | work-item-group-show | work-item-group-run | work-item-list | work-item-show | work-item-runs | work-item-create | work-item-run | work-item-run-show | work-item-validate | work-item-doc-suggestions | proposal-show | proposal-review | proposal-approve | drive | pause | hold | resume | review | approval");
}

main().catch((error) => {
  console.error(`spore-ops error: ${error.message}`);
  process.exitCode = 1;
});
