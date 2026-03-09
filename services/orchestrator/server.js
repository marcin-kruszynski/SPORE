#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../../packages/runtime-pi/src/metadata/constants.js";
import { listExecutionEvents } from "../../packages/orchestrator/src/execution/workflow-execution.js";

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
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
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(stderr || stdout || `command failed: ${args.join(" ")}`));
    });
  });
}

function buildPlanArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "plan",
    "--project", body.project ?? "config/projects/example-project.yaml",
    "--max-roles", String(body.maxRoles ?? 1)
  ];
  if (body.workflow) args.push("--workflow", body.workflow);
  if (body.domain) args.push("--domain", body.domain);
  if (body.roles?.length) args.push("--roles", body.roles.join(","));
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.objective) args.push("--objective", body.objective);
  if (body.coordinationGroupId) args.push("--coordination-group", body.coordinationGroupId);
  if (body.parentExecutionId) args.push("--parent-execution", body.parentExecutionId);
  if (body.branchKey) args.push("--branch-key", body.branchKey);
  return args;
}

function buildInvokeArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "invoke",
    "--project", body.project ?? "config/projects/example-project.yaml",
    "--max-roles", String(body.maxRoles ?? 1)
  ];
  if (body.workflow) args.push("--workflow", body.workflow);
  if (body.domain) args.push("--domain", body.domain);
  if (body.roles?.length) args.push("--roles", body.roles.join(","));
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.objective) args.push("--objective", body.objective);
  if (body.coordinationGroupId) args.push("--coordination-group", body.coordinationGroupId);
  if (body.parentExecutionId) args.push("--parent-execution", body.parentExecutionId);
  if (body.branchKey) args.push("--branch-key", body.branchKey);
  if (body.wait) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildScenarioRunArgs(scenarioId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "scenario-run",
    "--scenario", scenarioId
  ];
  if (body.project) args.push("--project", body.project);
  if (body.wait !== false) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.objective) args.push("--objective", body.objective);
  if (body.by) args.push("--by", body.by);
  if (body.source) args.push("--source", body.source);
  if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildRegressionRunArgs(regressionId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "regression-run",
    "--regression", regressionId
  ];
  if (body.project) args.push("--project", body.project);
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.by) args.push("--by", body.by);
  if (body.source) args.push("--source", body.source);
  if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildScenarioRerunArgs(runId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "scenario-rerun",
    "--run", runId
  ];
  if (body.project) args.push("--project", body.project);
  if (body.wait !== false) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.objective) args.push("--objective", body.objective);
  if (body.by) args.push("--by", body.by);
  if (body.source) args.push("--source", body.source);
  if (body.reason) args.push("--reason", body.reason);
  if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildRegressionRerunArgs(runId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "regression-rerun",
    "--run", runId
  ];
  if (body.project) args.push("--project", body.project);
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.by) args.push("--by", body.by);
  if (body.source) args.push("--source", body.source);
  if (body.reason) args.push("--reason", body.reason);
  if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function sse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, service: "spore-orchestrator" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/executions") {
      const payload = await runCli(["packages/orchestrator/src/cli/spore-orchestrator.js", "list"]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/coordination-groups") {
      const payload = await runCli(["packages/orchestrator/src/cli/spore-orchestrator.js", "groups"]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/stream/executions") {
      const executionId = url.searchParams.get("execution")?.trim() ?? "";
      if (!executionId) {
        json(response, 400, {
          ok: false,
          error: "missing_execution",
          message: "use /stream/executions?execution=<id>"
        });
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      response.write(": connected\n\n");

      let closed = false;
      let lastEventIndex = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;

      const heartbeat = setInterval(() => {
        if (!closed) {
          response.write(": heartbeat\n\n");
        }
      }, 5000);

      const poll = async () => {
        if (closed) {
          return;
        }
        try {
          const events = listExecutionEvents(executionId) ?? [];
          const next = events.filter((event) => Number(event.eventIndex ?? 0) > lastEventIndex);
          if (next.length > 0) {
            for (const event of next) {
              lastEventIndex = Math.max(lastEventIndex, Number(event.eventIndex ?? 0));
              sse(response, "workflow-event", event);
            }
          }
        } catch (error) {
          sse(response, "error", {
            ok: false,
            message: error.message
          });
        }
      };

      const interval = setInterval(() => {
        poll().catch(() => {});
      }, 1000);

      sse(response, "ready", {
        ok: true,
        executionId,
        since: lastEventIndex
      });
      await poll();

      request.on("close", () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        if (!response.writableEnded) {
          response.end();
        }
      });
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "executions") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "show",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "children") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "children",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "tree") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "tree",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "events") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "events",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "audit") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "audit",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "history") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "history",
        "--execution",
        parts[1],
        "--scope",
        url.searchParams.get("scope")?.trim() || "execution"
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "policy-diff") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "policy-diff",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/scenarios") {
      const payload = await runCli(["packages/orchestrator/src/cli/spore-orchestrator.js", "scenario-list"]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "scenarios") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-show",
        "--scenario",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "scenarios" && parts[2] === "runs") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-runs",
        "--scenario",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "20"
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "scenarios" && parts[2] === "trends") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-trends",
        "--scenario",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "100"
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 5 && parts[0] === "scenarios" && parts[2] === "runs" && parts[4] === "artifacts") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-run-artifacts",
        "--run",
        parts[3]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "scenario-runs") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-run-show",
        "--run",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "scenario-runs" && parts[2] === "artifacts") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-run-artifacts",
        "--run",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "scenario-runs" && parts[2] === "rerun") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildScenarioRerunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "scenarios" && parts[2] === "run") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildScenarioRunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/regressions") {
      const payload = await runCli(["packages/orchestrator/src/cli/spore-orchestrator.js", "regression-list"]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "regressions") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-show",
        "--regression",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "regressions" && parts[2] === "runs") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-runs",
        "--regression",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "20"
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "regressions" && parts[2] === "trends") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-trends",
        "--regression",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "100"
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "regression-runs") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-run-show",
        "--run",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "regression-runs" && parts[2] === "report") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-report",
        "--run",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "regression-runs" && parts[2] === "rerun") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildRegressionRerunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "regressions" && parts[2] === "run") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildRegressionRunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[0] === "executions" && parts[2] === "escalations") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "escalations",
        "--execution",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "coordination-groups") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "group",
        "--group",
        parts[1]
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "coordination-groups" && parts[2] === "drive") {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive-group",
        "--group",
        parts[1]
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/workflows/plan") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildPlanArgs(body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/workflows/invoke") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildInvokeArgs(body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "drive") {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive",
        "--execution",
        parts[1]
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "drive") {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive-tree",
        "--execution",
        parts[1]
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "fork") {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "fork",
        "--execution",
        parts[1]
      ];
      if (body.workflow) args.push("--workflow", body.workflow);
      if (body.project) args.push("--project", body.project);
      if (body.domain) args.push("--domain", body.domain);
      if (body.roles?.length) args.push("--roles", body.roles.join(","));
      if (body.maxRoles) args.push("--max-roles", String(body.maxRoles));
      if (body.invocationId) args.push("--invocation-id", body.invocationId);
      if (body.objective) args.push("--objective", body.objective);
      if (body.branchKey) args.push("--branch-key", body.branchKey);
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "branches") {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "spawn-branches",
        "--execution",
        parts[1],
        "--branches-json",
        JSON.stringify(body.branches ?? [])
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout) args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout) args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "pause") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "pause",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.owner ? ["--owner", body.owner] : []),
        ...(body.reason ? ["--reason", body.reason] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
        ...(body.guidance ? ["--guidance", body.guidance] : []),
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "pause") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "pause-tree",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.owner ? ["--owner", body.owner] : []),
        ...(body.reason ? ["--reason", body.reason] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
        ...(body.guidance ? ["--guidance", body.guidance] : []),
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "hold") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "hold",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.owner ? ["--owner", body.owner] : []),
        ...(body.reason ? ["--reason", body.reason] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
        ...(body.guidance ? ["--guidance", body.guidance] : []),
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "hold") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "hold-tree",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.owner ? ["--owner", body.owner] : []),
        ...(body.reason ? ["--reason", body.reason] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
        ...(body.guidance ? ["--guidance", body.guidance] : []),
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "resume") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "resume",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "resume") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "resume-tree",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "review") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "review",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "review") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "review-tree",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.scope ? ["--scope", body.scope] : []),
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "executions" && parts[2] === "approval") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "approve",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[0] === "executions" && parts[2] === "tree" && parts[3] === "approval") {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "approve-tree",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.scope ? ["--scope", body.scope] : []),
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 5 &&
      parts[0] === "executions" &&
      parts[2] === "escalations" &&
      parts[4] === "resolve"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "resolve-escalation",
        "--execution",
        parts[1],
        "--escalation",
        parts[3],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
        ...(body.resume ? ["--resume"] : [])
      ]);
      json(response, 200, payload);
      return;
    }

    json(response, 404, {
      ok: false,
      error: "not_found",
      pathname: url.pathname
    });
  } catch (error) {
    json(response, 500, {
      ok: false,
      error: "internal_error",
      message: error.message
    });
  }
});

const host = process.env.SPORE_ORCHESTRATOR_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.SPORE_ORCHESTRATOR_PORT ?? "8789", 10);
server.listen(port, host, () => {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        service: "spore-orchestrator",
        host,
        port
      },
      null,
      2
    ) + "\n"
  );
});
