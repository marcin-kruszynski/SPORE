#!/usr/bin/env node
import { spawn } from "node:child_process";

import {
  applyExecutionTreeAction,
  applyExecutionTreeGovernance,
  createExecution,
  driveCoordinationGroup,
  driveExecution,
  driveExecutionTree,
  forkExecution,
  getCoordinationGroupDetail,
  getExecutionDetail,
  getExecutionHistory,
  getExecutionPolicyDiff,
  getRegressionCatalogEntry,
  getRegressionRuns,
  getScenarioCatalogEntry,
  getScenarioRuns,
  getExecutionTree,
  holdExecution,
  listRegressionCatalog,
  listCoordinationGroups,
  listExecutionAudit,
  listExecutionChildren,
  listExecutionEscalations,
  listExecutionEvents,
  listExecutionSummaries,
  listScenarioCatalog,
  pauseExecution,
  recordApprovalDecision,
  recordReviewDecision,
  resumeExecution,
  resolveExecutionEscalation,
  spawnExecutionBranches
} from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import { PROJECT_ROOT } from "../../../runtime-pi/src/metadata/constants.js";
import {
  getRegressionRunDetail,
  getRegressionRunReport,
  getRegressionTrends,
  getScenarioRunSummaryById,
  getScenarioRunArtifacts,
  getScenarioTrends,
  rerunRegressionRun,
  rerunScenarioRun,
  runRegressionById,
  runScenarioById
} from "../scenarios/run-history.js";

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

async function buildInvocation(flags) {
  const roles = flags.roles ? String(flags.roles).split(",").map((item) => item.trim()).filter(Boolean) : null;
  return planWorkflowInvocation({
    workflowPath: flags.workflow ?? null,
    projectPath: flags.project ?? "config/projects/example-project.yaml",
    domainId: flags.domain ?? null,
    roles,
    maxRoles: Number.parseInt(String(flags["max-roles"] ?? "1"), 10),
    invocationId: flags["invocation-id"] ?? null,
    objective: flags.objective ?? "",
    coordinationGroupId: flags["coordination-group"] ?? null,
    parentExecutionId: flags["parent-execution"] ?? null,
    branchKey: flags["branch-key"] ?? null
  });
}

function spawnDetachedExecutionDriver(executionId, flags) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "drive",
    "--execution",
    executionId,
    "--wait",
    "--timeout",
    String(flags.timeout ?? "86400000"),
    "--interval",
    String(flags.interval ?? "1500")
  ];
  if (flags.stub) {
    args.push("--stub");
  }
  if (flags.launcher) {
    args.push("--launcher", String(flags.launcher));
  }
  if (flags["no-monitor"]) {
    args.push("--no-monitor");
  }
  if (flags["step-soft-timeout"]) {
    args.push("--step-soft-timeout", String(flags["step-soft-timeout"]));
  }
  if (flags["step-hard-timeout"]) {
    args.push("--step-hard-timeout", String(flags["step-hard-timeout"]));
  }

  const child = spawn("node", args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return {
    command: "node",
    args
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "plan";

  if (command === "plan") {
    const invocation = await buildInvocation(flags);
    console.log(JSON.stringify({ ok: true, invocation }, null, 2));
    return;
  }

  if (command === "invoke") {
    const invocation = await buildInvocation(flags);
    const created = createExecution(invocation);
    const detail = await driveExecution(invocation.invocationId, {
      wait: flags.wait === true,
      timeoutMs: flags.timeout ?? "180000",
      intervalMs: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    const monitor =
      flags.wait === true || flags["no-detach"] === true
        ? null
        : spawnDetachedExecutionDriver(invocation.invocationId, flags);
    console.log(JSON.stringify({ ok: true, invocation, created, detail, monitor }, null, 2));
    return;
  }

  if (command === "fork") {
    if (!flags.execution) {
      throw new Error("use fork --execution <id> [--roles lead,reviewer]");
    }
    const roles = flags.roles ? String(flags.roles).split(",").map((item) => item.trim()).filter(Boolean) : null;
    const result = await forkExecution(flags.execution, {
      workflowPath: flags.workflow ?? null,
      projectPath: flags.project ?? null,
      domainId: flags.domain ?? null,
      roles,
      maxRoles: Number.parseInt(String(flags["max-roles"] ?? "1"), 10),
      invocationId: flags["invocation-id"] ?? null,
      objective: flags.objective ?? null,
      branchKey: flags["branch-key"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "list") {
    console.log(JSON.stringify({ ok: true, executions: listExecutionSummaries() }, null, 2));
    return;
  }

  if (command === "show") {
    if (!flags.execution) {
      throw new Error("use show --execution <id>");
    }
    const detail = getExecutionDetail(flags.execution);
    if (!detail) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "children") {
    if (!flags.execution) {
      throw new Error("use children --execution <id>");
    }
    const children = listExecutionChildren(flags.execution);
    if (!children) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, executionId: flags.execution, children }, null, 2));
    return;
  }

  if (command === "tree") {
    if (!flags.execution) {
      throw new Error("use tree --execution <id>");
    }
    const tree = getExecutionTree(flags.execution);
    if (!tree) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, tree }, null, 2));
    return;
  }

  if (command === "groups") {
    console.log(JSON.stringify({ ok: true, groups: listCoordinationGroups() }, null, 2));
    return;
  }

  if (command === "group") {
    if (!flags.group) {
      throw new Error("use group --group <id>");
    }
    const detail = getCoordinationGroupDetail(flags.group);
    if (!detail) {
      throw new Error(`coordination group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "drive-group") {
    if (!flags.group) {
      throw new Error("use drive-group --group <id>");
    }
    const detail = await driveCoordinationGroup(flags.group, {
      wait: flags.wait === true,
      timeoutMs: flags.timeout ?? "180000",
      intervalMs: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "drive-tree") {
    if (!flags.execution) {
      throw new Error("use drive-tree --execution <id>");
    }
    const detail = await driveExecutionTree(flags.execution, {
      wait: flags.wait === true,
      timeoutMs: flags.timeout ?? "180000",
      intervalMs: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "spawn-branches") {
    if (!flags.execution) {
      throw new Error("use spawn-branches --execution <id> --branches-json '[{\"roles\":[\"builder\"]}]'");
    }
    const branches = JSON.parse(String(flags["branches-json"] ?? "[]"));
    const result = await spawnExecutionBranches(flags.execution, branches, {
      wait: flags.wait === true,
      timeoutMs: flags.timeout ?? "180000",
      intervalMs: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "events") {
    if (!flags.execution) {
      throw new Error("use events --execution <id>");
    }
    const events = listExecutionEvents(flags.execution);
    if (!events) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, executionId: flags.execution, events }, null, 2));
    return;
  }

  if (command === "escalations") {
    if (!flags.execution) {
      throw new Error("use escalations --execution <id>");
    }
    const escalations = listExecutionEscalations(flags.execution);
    if (!escalations) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, executionId: flags.execution, escalations }, null, 2));
    return;
  }

  if (command === "audit") {
    if (!flags.execution) {
      throw new Error("use audit --execution <id>");
    }
    const audit = listExecutionAudit(flags.execution);
    if (!audit) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, executionId: flags.execution, audit }, null, 2));
    return;
  }

  if (command === "history") {
    if (!flags.execution) {
      throw new Error("use history --execution <id>");
    }
    const detail = await getExecutionHistory(flags.execution, {
      scope: flags.scope ?? "execution"
    });
    if (!detail) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "policy-diff") {
    if (!flags.execution) {
      throw new Error("use policy-diff --execution <id>");
    }
    const detail = await getExecutionPolicyDiff(flags.execution);
    if (!detail) {
      throw new Error(`execution not found: ${flags.execution}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "scenario-list") {
    const scenarios = await listScenarioCatalog();
    console.log(JSON.stringify({ ok: true, scenarios }, null, 2));
    return;
  }

  if (command === "scenario-show") {
    if (!flags.scenario) {
      throw new Error("use scenario-show --scenario <id>");
    }
    const scenario = await getScenarioCatalogEntry(flags.scenario);
    if (!scenario) {
      throw new Error(`scenario not found: ${flags.scenario}`);
    }
    console.log(JSON.stringify({ ok: true, scenario }, null, 2));
    return;
  }

  if (command === "scenario-runs") {
    if (!flags.scenario) {
      throw new Error("use scenario-runs --scenario <id>");
    }
    const detail = await getScenarioRuns(flags.scenario, undefined, Number.parseInt(String(flags.limit ?? "20"), 10));
    if (!detail) {
      throw new Error(`scenario not found: ${flags.scenario}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "scenario-run-artifacts") {
    if (!flags.run) {
      throw new Error("use scenario-run-artifacts --run <id>");
    }
    const detail = await getScenarioRunArtifacts(flags.run);
    if (!detail) {
      throw new Error(`scenario run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "scenario-run-show") {
    if (!flags.run) {
      throw new Error("use scenario-run-show --run <id>");
    }
    const detail = await getScenarioRunSummaryById(flags.run);
    if (!detail) {
      throw new Error(`scenario run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "scenario-trends") {
    if (!flags.scenario) {
      throw new Error("use scenario-trends --scenario <id>");
    }
    const detail = await getScenarioTrends(flags.scenario, undefined, Number.parseInt(String(flags.limit ?? "100"), 10));
    if (!detail) {
      throw new Error(`scenario not found: ${flags.scenario}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "scenario-run") {
    if (!flags.scenario) {
      throw new Error("use scenario-run --scenario <id>");
    }
    const result = await runScenarioById(flags.scenario, {
      project: flags.project ?? "config/projects/example-project.yaml",
      wait: flags.wait !== undefined ? flags.wait === true : true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      objective: flags.objective ?? null,
      source: flags.source ?? "cli",
      by: flags.by ?? "operator",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "scenario-rerun") {
    if (!flags.run) {
      throw new Error("use scenario-rerun --run <id>");
    }
    const result = await rerunScenarioRun(flags.run, {
      project: flags.project ?? null,
      wait: flags.wait !== undefined ? flags.wait === true : true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      objective: flags.objective ?? null,
      source: flags.source ?? "cli",
      by: flags.by ?? "operator",
      reason: flags.reason ?? "",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    if (!result) {
      throw new Error(`scenario run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "regression-list") {
    const regressions = await listRegressionCatalog();
    console.log(JSON.stringify({ ok: true, regressions }, null, 2));
    return;
  }

  if (command === "regression-show") {
    if (!flags.regression) {
      throw new Error("use regression-show --regression <id>");
    }
    const regression = await getRegressionCatalogEntry(flags.regression);
    if (!regression) {
      throw new Error(`regression not found: ${flags.regression}`);
    }
    console.log(JSON.stringify({ ok: true, regression }, null, 2));
    return;
  }

  if (command === "regression-runs") {
    if (!flags.regression) {
      throw new Error("use regression-runs --regression <id>");
    }
    const detail = await getRegressionRuns(flags.regression, undefined, Number.parseInt(String(flags.limit ?? "20"), 10));
    if (!detail) {
      throw new Error(`regression not found: ${flags.regression}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-run") {
    if (!flags.regression) {
      throw new Error("use regression-run --regression <id>");
    }
    const result = await runRegressionById(flags.regression, {
      project: flags.project ?? "config/projects/example-project.yaml",
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      source: flags.source ?? "cli",
      by: flags.by ?? "operator",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "regression-run-show") {
    if (!flags.run) {
      throw new Error("use regression-run-show --run <id>");
    }
    const detail = await getRegressionRunDetail(flags.run);
    if (!detail) {
      throw new Error(`regression run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-report") {
    if (!flags.run) {
      throw new Error("use regression-report --run <id>");
    }
    const detail = await getRegressionRunReport(flags.run);
    if (!detail) {
      throw new Error(`regression run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-trends") {
    if (!flags.regression) {
      throw new Error("use regression-trends --regression <id>");
    }
    const detail = await getRegressionTrends(flags.regression, undefined, Number.parseInt(String(flags.limit ?? "100"), 10));
    if (!detail) {
      throw new Error(`regression not found: ${flags.regression}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-rerun") {
    if (!flags.run) {
      throw new Error("use regression-rerun --run <id>");
    }
    const result = await rerunRegressionRun(flags.run, {
      project: flags.project ?? null,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      source: flags.source ?? "cli",
      by: flags.by ?? "operator",
      reason: flags.reason ?? "",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    if (!result) {
      throw new Error(`regression run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "drive") {
    if (!flags.execution) {
      throw new Error("use drive --execution <id>");
    }
    const detail = await driveExecution(flags.execution, {
      wait: flags.wait === true,
      timeoutMs: flags.timeout ?? "180000",
      intervalMs: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "review") {
    if (!flags.execution || !flags.status) {
      throw new Error("use review --execution <id> --status <approved|changes_requested|rejected>");
    }
    const detail = await recordReviewDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "review-tree") {
    if (!flags.execution || !flags.status) {
      throw new Error("use review-tree --execution <id> --status <approved|changes_requested|rejected>");
    }
    const result = await applyExecutionTreeGovernance(flags.execution, "review", {
      status: flags.status,
      scope: flags.scope ?? "all-pending",
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "approve") {
    if (!flags.execution || !flags.status) {
      throw new Error("use approve --execution <id> --status <approved|rejected>");
    }
    const detail = await recordApprovalDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "approve-tree") {
    if (!flags.execution || !flags.status) {
      throw new Error("use approve-tree --execution <id> --status <approved|rejected>");
    }
    const result = await applyExecutionTreeGovernance(flags.execution, "approval", {
      status: flags.status,
      scope: flags.scope ?? "all-pending",
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "resolve-escalation") {
    if (!flags.execution || !flags.escalation) {
      throw new Error("use resolve-escalation --execution <id> --escalation <id> [--resume]");
    }
    const detail = resolveExecutionEscalation(flags.execution, flags.escalation, {
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? "",
      resume: flags.resume === true
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "pause") {
    if (!flags.execution) {
      throw new Error("use pause --execution <id> [--reason <text>]");
    }
    const detail = pauseExecution(flags.execution, {
      decidedBy: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      owner: flags.owner ?? flags.by ?? "operator",
      guidance: flags.guidance ?? flags.comments ?? "",
      timeoutMs: flags["timeout-ms"] ?? null
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "pause-tree") {
    if (!flags.execution) {
      throw new Error("use pause-tree --execution <id> [--reason <text>]");
    }
    const result = applyExecutionTreeAction(flags.execution, "pause", {
      decidedBy: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      owner: flags.owner ?? flags.by ?? "operator",
      guidance: flags.guidance ?? flags.comments ?? "",
      timeoutMs: flags["timeout-ms"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "hold") {
    if (!flags.execution) {
      throw new Error("use hold --execution <id> [--reason <text>]");
    }
    const detail = holdExecution(flags.execution, {
      decidedBy: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      owner: flags.owner ?? flags.by ?? "operator",
      guidance: flags.guidance ?? flags.comments ?? "",
      timeoutMs: flags["timeout-ms"] ?? null
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "hold-tree") {
    if (!flags.execution) {
      throw new Error("use hold-tree --execution <id> [--reason <text>]");
    }
    const result = applyExecutionTreeAction(flags.execution, "hold", {
      decidedBy: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      owner: flags.owner ?? flags.by ?? "operator",
      guidance: flags.guidance ?? flags.comments ?? "",
      timeoutMs: flags["timeout-ms"] ?? null
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "resume") {
    if (!flags.execution) {
      throw new Error("use resume --execution <id> [--comments <text>]");
    }
    const detail = resumeExecution(flags.execution, {
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "resume-tree") {
    if (!flags.execution) {
      throw new Error("use resume-tree --execution <id> [--comments <text>]");
    }
    const result = applyExecutionTreeAction(flags.execution, "resume", {
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`spore-orchestrator error: ${error.message}`);
  process.exitCode = 1;
});
