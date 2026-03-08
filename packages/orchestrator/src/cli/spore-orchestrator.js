#!/usr/bin/env node
import { spawn } from "node:child_process";

import {
  createExecution,
  driveCoordinationGroup,
  driveExecution,
  forkExecution,
  getCoordinationGroupDetail,
  getExecutionDetail,
  holdExecution,
  listCoordinationGroups,
  listExecutionChildren,
  listExecutionEscalations,
  listExecutionEvents,
  listExecutionSummaries,
  pauseExecution,
  recordApprovalDecision,
  recordReviewDecision,
  resumeExecution,
  resolveExecutionEscalation
} from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import { PROJECT_ROOT } from "../../../runtime-pi/src/metadata/constants.js";

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
    const detail = recordReviewDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "approve") {
    if (!flags.execution || !flags.status) {
      throw new Error("use approve --execution <id> --status <approved|rejected>");
    }
    const detail = recordApprovalDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
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
      reason: flags.reason ?? flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "hold") {
    if (!flags.execution) {
      throw new Error("use hold --execution <id> [--reason <text>]");
    }
    const detail = holdExecution(flags.execution, {
      decidedBy: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? ""
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
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

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`spore-orchestrator error: ${error.message}`);
  process.exitCode = 1;
});
