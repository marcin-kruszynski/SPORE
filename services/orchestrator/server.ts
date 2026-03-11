#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";
import {
  approveProposalArtifact,
  cleanupManagedWorkspace,
  createGoalPlan,
  createManagedWorkItem,
  createSelfBuildOverride,
  editGoalPlan,
  getDocSuggestionSummary,
  getDocSuggestionsForRun,
  getGoalPlanHistory,
  getGoalPlanSummary,
  getIntegrationBranchSummary,
  getPolicyRecommendationSummary,
  getProposalByRun,
  getProposalReviewPackage,
  getProposalSummary,
  getRegressionLatestReport,
  getRegressionRunReport,
  getRegressionRunSummaryById,
  getRegressionSchedulerStatus,
  getRegressionTrends,
  getRunCenterSummary,
  getScenarioRunArtifacts,
  getScenarioRunSummaryById,
  getScenarioTrends,
  getSelfBuildDashboard,
  getSelfBuildIntakeSummary,
  getSelfBuildLearningTrends,
  getSelfBuildLoopStatus,
  getSelfBuildOverrideSummary,
  getSelfBuildPolicyRecommendations,
  getSelfBuildSummary,
  getSelfBuildWorkItem,
  getSelfBuildWorkItemRun,
  getWorkItemGroupSummary,
  getWorkItemTemplate,
  getWorkspaceDetail,
  getWorkspaceDetailByRun,
  invokeProposalPromotion,
  listExecutionEvents,
  listExecutionWorkspaces,
  listGoalPlansSummary,
  listIntegrationBranchSummaries,
  listPolicyRecommendationReviewSummaries,
  listSelfBuildDecisionSummaries,
  listSelfBuildDocSuggestionSummaries,
  listSelfBuildIntakeSummaries,
  listSelfBuildLearningSummaries,
  listSelfBuildOverrideSummaries,
  listSelfBuildQuarantineSummaries,
  listSelfBuildRollbackSummaries,
  listSelfBuildWorkItemRuns,
  listSelfBuildWorkItems,
  listWorkItemGroupsSummary,
  listWorkItemTemplates,
  listWorkspaceSummaries,
  materializeDocSuggestionRecord,
  materializeGoalPlan,
  materializePolicyRecommendation,
  materializeSelfBuildIntake,
  planProposalPromotion,
  quarantineSelfBuildTarget,
  reconcileManagedWorkspace,
  refreshSelfBuildIntake,
  releaseSelfBuildOverride,
  releaseSelfBuildQuarantine,
  requeueWorkItemGroupItem,
  rerouteWorkItemGroup,
  rerunSelfBuildWorkItemRun,
  retryDownstreamWorkItemGroup,
  reviewDocSuggestionRecord,
  reviewGoalPlan,
  reviewPolicyRecommendation,
  reviewProposalArtifact,
  reviewSelfBuildIntake,
  reviewSelfBuildOverride,
  reworkProposalArtifact,
  rollbackIntegrationBranch,
  runGoalPlan,
  runSelfBuildWorkItem,
  runWorkItemGroup,
  setWorkItemGroupDependencies,
  skipWorkItemGroupItem,
  startSelfBuildLoop,
  stopSelfBuildLoop,
  unblockWorkItemGroup,
  validateWorkItemGroupBundle,
  validateWorkItemRun,
} from "@spore/orchestrator";
import {
  createOperatorThread,
  getOperatorThreadDetail,
  listOperatorPendingActions,
  listOperatorThreadsSummary,
  postOperatorThreadMessage,
  resolveOperatorThreadAction,
} from "../../packages/orchestrator/src/self-build/operator-chat.js";

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function notFound(response, message) {
  json(response, 404, {
    ok: false,
    error: "not_found",
    message,
  });
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
    const [scriptPath, ...scriptArgs] = args;
    const child = spawn(
      process.execPath,
      buildTsxEntrypointArgs(scriptPath, scriptArgs),
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
      reject(
        new Error(stderr || stdout || `command failed: ${args.join(" ")}`),
      );
    });
  });
}

function buildPlanArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "plan",
    "--project",
    body.project ?? "config/projects/example-project.yaml",
    "--max-roles",
    String(body.maxRoles ?? 1),
  ];
  if (body.workflow) args.push("--workflow", body.workflow);
  if (body.domain) args.push("--domain", body.domain);
  if (body.roles?.length) args.push("--roles", body.roles.join(","));
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.objective) args.push("--objective", body.objective);
  if (body.coordinationGroupId)
    args.push("--coordination-group", body.coordinationGroupId);
  if (body.parentExecutionId)
    args.push("--parent-execution", body.parentExecutionId);
  if (body.branchKey) args.push("--branch-key", body.branchKey);
  return args;
}

function buildInvokeArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "invoke",
    "--project",
    body.project ?? "config/projects/example-project.yaml",
    "--max-roles",
    String(body.maxRoles ?? 1),
  ];
  if (body.workflow) args.push("--workflow", body.workflow);
  if (body.domain) args.push("--domain", body.domain);
  if (body.roles?.length) args.push("--roles", body.roles.join(","));
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.objective) args.push("--objective", body.objective);
  if (body.coordinationGroupId)
    args.push("--coordination-group", body.coordinationGroupId);
  if (body.parentExecutionId)
    args.push("--parent-execution", body.parentExecutionId);
  if (body.branchKey) args.push("--branch-key", body.branchKey);
  if (body.wait) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildProjectPlanArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "project-plan",
    "--project",
    body.project ?? "config/projects/example-project.yaml",
  ];
  if (body.domains?.length) args.push("--domains", body.domains.join(","));
  if (body.objective) args.push("--objective", body.objective);
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  return args;
}

function buildProjectInvokeArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "project-invoke",
    "--project",
    body.project ?? "config/projects/example-project.yaml",
  ];
  if (body.domains?.length) args.push("--domains", body.domains.join(","));
  if (body.objective) args.push("--objective", body.objective);
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.wait) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildPromotionPlanArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "promotion-plan",
    "--execution",
    body.execution,
  ];
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.targetBranch) args.push("--target-branch", body.targetBranch);
  if (body.objective) args.push("--objective", body.objective);
  if (body.featureId) args.push("--feature-id", body.featureId);
  return args;
}

function buildPromotionInvokeArgs(body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "promotion-invoke",
    "--execution",
    body.execution,
  ];
  if (body.invocationId) args.push("--invocation-id", body.invocationId);
  if (body.targetBranch) args.push("--target-branch", body.targetBranch);
  if (body.objective) args.push("--objective", body.objective);
  if (body.featureId) args.push("--feature-id", body.featureId);
  if (body.wait) args.push("--wait");
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildScenarioRunArgs(scenarioId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "scenario-run",
    "--scenario",
    scenarioId,
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
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildRegressionRunArgs(regressionId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "regression-run",
    "--regression",
    regressionId,
  ];
  if (body.project) args.push("--project", body.project);
  if (body.timeout) args.push("--timeout", String(body.timeout));
  if (body.interval) args.push("--interval", String(body.interval));
  if (body.noMonitor) args.push("--no-monitor");
  if (body.stub) args.push("--stub");
  if (body.launcher) args.push("--launcher", body.launcher);
  if (body.by) args.push("--by", body.by);
  if (body.source) args.push("--source", body.source);
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildScenarioRerunArgs(runId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "scenario-rerun",
    "--run",
    runId,
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
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function buildRegressionRerunArgs(runId, body) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.js",
    "regression-rerun",
    "--run",
    runId,
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
  if (body.stepSoftTimeout)
    args.push("--step-soft-timeout", String(body.stepSoftTimeout));
  if (body.stepHardTimeout)
    args.push("--step-hard-timeout", String(body.stepHardTimeout));
  return args;
}

function sse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url,
      `http://${request.headers.host ?? "127.0.0.1"}`,
    );
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, service: "spore-orchestrator" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/executions") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "list",
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/run-center/summary") {
      const payload = {
        ok: true,
        detail: await getRunCenterSummary(
          undefined,
          Number.parseInt(url.searchParams.get("limit")?.trim() || "10", 10),
        ),
      };
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/summary") {
      json(response, 200, {
        ok: true,
        detail: getSelfBuildSummary(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/dashboard") {
      json(response, 200, {
        ok: true,
        detail: getSelfBuildDashboard({
          status: url.searchParams.get("status")?.trim() || null,
          group: url.searchParams.get("group")?.trim() || null,
          template: url.searchParams.get("template")?.trim() || null,
          domain: url.searchParams.get("domain")?.trim() || null,
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/operator/threads") {
      json(response, 200, {
        ok: true,
        detail: listOperatorThreadsSummary({
          status: url.searchParams.get("status")?.trim() || null,
          projectId: url.searchParams.get("projectId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/operator/threads") {
      const body = await readJsonBody(request);
      const detail = await createOperatorThread({
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/operator/actions") {
      json(response, 200, {
        ok: true,
        detail: await listOperatorPendingActions({
          threadId: url.searchParams.get("threadId")?.trim() || null,
          status: url.searchParams.get("status")?.trim() || "pending",
          actionKind: url.searchParams.get("actionKind")?.trim() || null,
          targetType: url.searchParams.get("targetType")?.trim() || null,
          targetId: url.searchParams.get("targetId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "100",
        }),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "operator" &&
      parts[1] === "threads" &&
      parts[3] === "stream"
    ) {
      const threadId = decodeURIComponent(parts[2]);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");

      let closed = false;
      let lastSignature = "";

      const heartbeat = setInterval(() => {
        if (!closed) {
          response.write(": heartbeat\n\n");
        }
      }, 5000);

      const buildSignature = (detail) =>
        JSON.stringify({
          updatedAt: detail?.updatedAt ?? null,
          latestMessageAt: detail?.summary?.lastMessageAt ?? null,
          pendingActions: Array.isArray(detail?.pendingActions)
            ? detail.pendingActions.map((entry) => [entry.id, entry.status])
            : [],
          messageCount: Array.isArray(detail?.messages)
            ? detail.messages.length
            : 0,
        });

      const poll = async (eventName = "thread-update") => {
        if (closed) {
          return;
        }
        try {
          const detail = await getOperatorThreadDetail(threadId);
          if (!detail) {
            sse(response, "error", {
              ok: false,
              message: `operator thread not found: ${threadId}`,
            });
            return;
          }
          const signature = buildSignature(detail);
          if (eventName === "thread-ready" || signature !== lastSignature) {
            lastSignature = signature;
            sse(response, eventName, {
              ok: true,
              detail,
            });
          }
        } catch (error) {
          sse(response, "error", {
            ok: false,
            message: error.message,
          });
        }
      };

      const interval = setInterval(() => {
        poll().catch(() => {});
      }, 1000);

      await poll("thread-ready");

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        clearInterval(interval);
        response.end();
      };

      request.on("close", cleanup);
      response.on("close", cleanup);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "operator" &&
      parts[1] === "threads"
    ) {
      const threadId = decodeURIComponent(parts[2]);
      const detail = await getOperatorThreadDetail(threadId);
      if (!detail) {
        notFound(response, `operator thread not found: ${threadId}`);
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "operator" &&
      parts[1] === "threads" &&
      parts[3] === "messages"
    ) {
      const threadId = decodeURIComponent(parts[2]);
      const body = await readJsonBody(request);
      const detail = await postOperatorThreadMessage(threadId, {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        notFound(response, `operator thread not found: ${threadId}`);
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "operator" &&
      parts[1] === "actions" &&
      parts[3] === "resolve"
    ) {
      const actionId = decodeURIComponent(parts[2]);
      const body = await readJsonBody(request);
      const detail = await resolveOperatorThreadAction(actionId, {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        notFound(response, `operator action not found: ${actionId}`);
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/decisions") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildDecisionSummaries({
          state: url.searchParams.get("state")?.trim() || null,
          action: url.searchParams.get("action")?.trim() || null,
          targetType: url.searchParams.get("targetType")?.trim() || null,
          targetId: url.searchParams.get("targetId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/quarantine") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildQuarantineSummaries({
          status: url.searchParams.get("status")?.trim() || null,
          targetType: url.searchParams.get("targetType")?.trim() || null,
          targetId: url.searchParams.get("targetId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/rollback") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildRollbackSummaries({
          targetType: url.searchParams.get("targetType")?.trim() || null,
          targetId: url.searchParams.get("targetId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/learnings") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildLearningSummaries({
          sourceType: url.searchParams.get("sourceType")?.trim() || null,
          status: url.searchParams.get("status")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/self-build/learning-trends"
    ) {
      json(response, 200, {
        ok: true,
        detail: getSelfBuildLearningTrends(),
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/self-build/policy-recommendations"
    ) {
      json(response, 200, {
        ok: true,
        detail: getSelfBuildPolicyRecommendations(),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "self-build" &&
      parts[1] === "policy-recommendations"
    ) {
      const detail = getPolicyRecommendationSummary(parts[2]);
      if (!detail) {
        notFound(response, `policy recommendation not found: ${parts[2]}`);
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/self-build/policy-recommendation-reviews"
    ) {
      json(response, 200, {
        ok: true,
        detail: listPolicyRecommendationReviewSummaries({
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/overrides") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildOverrideSummaries({
          kind: url.searchParams.get("kind")?.trim() || null,
          status: url.searchParams.get("status")?.trim() || null,
          targetType: url.searchParams.get("targetType")?.trim() || null,
          targetId: url.searchParams.get("targetId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "self-build" &&
      parts[1] === "overrides"
    ) {
      const detail = getSelfBuildOverrideSummary(parts[2]);
      if (!detail) {
        notFound(response, `self-build override not found: ${parts[2]}`);
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "POST" && url.pathname === "/self-build/overrides") {
      const body = await readJsonBody(request);
      const detail = await createSelfBuildOverride({
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/self-build/doc-suggestions"
    ) {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildDocSuggestionSummaries({
          status: url.searchParams.get("status")?.trim() || null,
          workItemRunId: url.searchParams.get("runId")?.trim() || null,
          workItemId: url.searchParams.get("itemId")?.trim() || null,
          proposalArtifactId:
            url.searchParams.get("proposalId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/self-build/intake") {
      json(response, 200, {
        ok: true,
        detail: listSelfBuildIntakeSummaries({
          status: url.searchParams.get("status")?.trim() || null,
          kind: url.searchParams.get("kind")?.trim() || null,
          sourceType: url.searchParams.get("sourceType")?.trim() || null,
          projectId: url.searchParams.get("projectId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/self-build/intake/refresh"
    ) {
      const body = await readJsonBody(request);
      const detail = await refreshSelfBuildIntake(body);
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/coordination-groups") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "groups",
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/stream/executions") {
      const executionId = url.searchParams.get("execution")?.trim() ?? "";
      if (!executionId) {
        json(response, 400, {
          ok: false,
          error: "missing_execution",
          message: "use /stream/executions?execution=<id>",
        });
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");

      let closed = false;
      let lastEventIndex =
        Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;

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
          const next = events.filter(
            (event) => Number(event.eventIndex ?? 0) > lastEventIndex,
          );
          if (next.length > 0) {
            for (const event of next) {
              lastEventIndex = Math.max(
                lastEventIndex,
                Number(event.eventIndex ?? 0),
              );
              sse(response, "workflow-event", event);
            }
          }
        } catch (error) {
          sse(response, "error", {
            ok: false,
            message: error.message,
          });
        }
      };

      const interval = setInterval(() => {
        poll().catch(() => {});
      }, 1000);

      sse(response, "ready", {
        ok: true,
        executionId,
        since: lastEventIndex,
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

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "executions"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "show",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "children"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "children",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "tree"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "tree",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "events"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "events",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "audit"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "audit",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "history"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "history",
        "--execution",
        parts[1],
        "--scope",
        url.searchParams.get("scope")?.trim() || "execution",
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "policy-diff"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "policy-diff",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/scenarios") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-list",
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "scenarios"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-show",
        "--scenario",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "scenarios" &&
      parts[2] === "runs"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "scenario-runs",
        "--scenario",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "20",
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "scenarios" &&
      parts[2] === "trends"
    ) {
      const detail = await getScenarioTrends(
        parts[1],
        undefined,
        Number.parseInt(url.searchParams.get("limit")?.trim() || "100", 10),
      );
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `scenario not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 5 &&
      parts[0] === "scenarios" &&
      parts[2] === "runs" &&
      parts[4] === "artifacts"
    ) {
      const detail = await getScenarioRunArtifacts(parts[3]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `scenario run not found: ${parts[3]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "scenario-runs"
    ) {
      const detail = await getScenarioRunSummaryById(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `scenario run not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "scenario-runs" &&
      parts[2] === "artifacts"
    ) {
      const detail = await getScenarioRunArtifacts(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `scenario run not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "scenario-runs" &&
      parts[2] === "rerun"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli(buildScenarioRerunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "scenarios" &&
      parts[2] === "run"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli(buildScenarioRunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/regressions") {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-list",
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "regressions"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-show",
        "--regression",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "regressions" &&
      parts[2] === "runs"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-runs",
        "--regression",
        parts[1],
        "--limit",
        url.searchParams.get("limit")?.trim() || "20",
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "regressions" &&
      parts[2] === "trends"
    ) {
      const detail = await getRegressionTrends(
        parts[1],
        undefined,
        Number.parseInt(url.searchParams.get("limit")?.trim() || "100", 10),
      );
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `regression not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "regressions" &&
      parts[2] === "latest-report"
    ) {
      const detail = await getRegressionLatestReport(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `regression report not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/regressions/scheduler/status"
    ) {
      const payload = {
        ok: true,
        detail: await getRegressionSchedulerStatus(),
      };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "regression-runs"
    ) {
      const detail = await getRegressionRunSummaryById(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `regression run not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "regression-runs" &&
      parts[2] === "report"
    ) {
      const detail = await getRegressionRunReport(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `regression run not found: ${parts[1]}`,
        });
        return;
      }
      const payload = { ok: true, detail };
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "regression-runs" &&
      parts[2] === "rerun"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli(buildRegressionRerunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/regressions/scheduler/run"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "regression-scheduler",
      ];
      if (body.regression) args.push("--regression", body.regression);
      if (body.all) args.push("--all");
      if (body.dryRun) args.push("--dry-run");
      if (body.maxRuns) args.push("--max-runs", String(body.maxRuns));
      if (body.project) args.push("--project", body.project);
      if (body.stub) args.push("--stub");
      if (body.launcher) args.push("--launcher", body.launcher);
      if (body.by) args.push("--by", body.by);
      if (body.source) args.push("--source", body.source);
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.noMonitor) args.push("--no-monitor");
      if (body.stepSoftTimeout)
        args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout)
        args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "regressions" &&
      parts[2] === "run"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli(buildRegressionRunArgs(parts[1], body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/work-item-templates") {
      json(response, 200, {
        ok: true,
        detail: await listWorkItemTemplates(),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "work-item-templates"
    ) {
      const detail = await getWorkItemTemplate(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item template not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/goal-plans") {
      json(response, 200, {
        ok: true,
        detail: listGoalPlansSummary({
          status: url.searchParams.get("status")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/goals/plan") {
      const body = await readJsonBody(request);
      json(response, 200, {
        ok: true,
        detail: await createGoalPlan(body),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "goal-plans"
    ) {
      const detail = getGoalPlanSummary(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `goal plan not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "history"
    ) {
      const detail = getGoalPlanHistory(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `goal plan not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "edit"
    ) {
      const body = await readJsonBody(request);
      const detail = await editGoalPlan(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `goal plan not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewGoalPlan(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `goal plan not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "protected-override"
    ) {
      const body = await readJsonBody(request);
      const detail = await createSelfBuildOverride({
        kind: body.kind ?? "protected-tier",
        targetType: "goal-plan",
        targetId: parts[1],
        reason:
          body.reason ??
          body.comments ??
          "Protected-tier override requested for goal plan.",
        rationale: body.rationale ?? body.comments ?? "",
        metadata: {
          ...(body.metadata ?? {}),
          overrideScope: body.overrideScope ?? null,
          protectedScope: body.overrideScope ?? null,
          requestContext: "goal-plan",
        },
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "quarantine"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await quarantineSelfBuildTarget("goal-plan", parts[1], {
          ...body,
          by: body.by ?? "operator",
          sourceType: body.sourceType ?? "http",
        });
        json(response, 200, { ok: true, detail });
      } catch (error) {
        if (
          (error as { code?: string }).code === "self_build_target_not_found"
        ) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message:
              error instanceof Error
                ? error.message
                : `goal plan not found: ${parts[1]}`,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "run"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await runGoalPlan(parts[1], body);
        if (!detail) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message: `goal plan not found: ${parts[1]}`,
          });
          return;
        }
        json(response, 200, { ok: true, detail });
      } catch (error) {
        const code =
          (error as { code?: string }).code === "goal_plan_review_required"
            ? 409
            : 500;
        json(response, code, {
          ok: false,
          error:
            (error as { code?: string }).code ??
            (code === 409 ? "goal_plan_review_required" : "internal_error"),
          message:
            error instanceof Error ? error.message : "failed to run goal plan",
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "goal-plans" &&
      parts[2] === "materialize"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await materializeGoalPlan(parts[1], body);
        if (!detail) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message: `goal plan not found: ${parts[1]}`,
          });
          return;
        }
        json(response, 200, { ok: true, detail });
      } catch (error) {
        const code =
          (error as { code?: string }).code === "goal_plan_review_required"
            ? 409
            : 500;
        json(response, code, {
          ok: false,
          error:
            (error as { code?: string }).code ??
            (code === 409 ? "goal_plan_review_required" : "internal_error"),
          message:
            error instanceof Error
              ? error.message
              : "failed to materialize goal plan",
        });
      }
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "self-build" &&
      parts[1] === "intake"
    ) {
      const detail = getSelfBuildIntakeSummary(parts[2]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `self-build intake not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "intake" &&
      parts[3] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewSelfBuildIntake(parts[2], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `self-build intake not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "intake" &&
      parts[3] === "materialize"
    ) {
      const body = await readJsonBody(request);
      const detail = await materializeSelfBuildIntake(parts[2], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `self-build intake not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/work-item-groups") {
      json(response, 200, {
        ok: true,
        detail: listWorkItemGroupsSummary({
          status: url.searchParams.get("status")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "work-item-groups"
    ) {
      const detail = getWorkItemGroupSummary(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "dependencies"
    ) {
      const body = await readJsonBody(request);
      const detail = setWorkItemGroupDependencies(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, ...detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "run"
    ) {
      const body = await readJsonBody(request);
      const detail = await runWorkItemGroup(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "unblock"
    ) {
      const body = await readJsonBody(request);
      const detail = unblockWorkItemGroup(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "protected-override"
    ) {
      const body = await readJsonBody(request);
      const detail = await createSelfBuildOverride({
        kind: body.kind ?? "protected-tier",
        targetType: "work-item-group",
        targetId: parts[1],
        reason:
          body.reason ??
          body.comments ??
          "Protected-tier override requested for work-item group.",
        rationale: body.rationale ?? body.comments ?? "",
        metadata: {
          ...(body.metadata ?? {}),
          overrideScope: body.overrideScope ?? null,
          protectedScope: body.overrideScope ?? null,
          requestContext: "work-item-group",
        },
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "quarantine"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await quarantineSelfBuildTarget(
          "work-item-group",
          parts[1],
          {
            ...body,
            by: body.by ?? "operator",
            sourceType: body.sourceType ?? "http",
          },
        );
        json(response, 200, { ok: true, detail });
      } catch (error) {
        if (
          (error as { code?: string }).code === "self_build_target_not_found"
        ) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message:
              error instanceof Error
                ? error.message
                : `work item group not found: ${parts[1]}`,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "reroute"
    ) {
      const body = await readJsonBody(request);
      const detail = await rerouteWorkItemGroup(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group or item not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "retry-downstream"
    ) {
      const body = await readJsonBody(request);
      const detail = await retryDownstreamWorkItemGroup(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "requeue-item"
    ) {
      const body = await readJsonBody(request);
      const itemId = body.itemId?.trim?.() || body.itemId;
      if (!itemId) {
        json(response, 400, {
          ok: false,
          error: "missing_item_id",
          message: "requeue-item requires itemId",
        });
        return;
      }
      const detail = requeueWorkItemGroupItem(parts[1], itemId, body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group or item not found: ${parts[1]}/${itemId}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "skip-item"
    ) {
      const body = await readJsonBody(request);
      const itemId = body.itemId?.trim?.() || body.itemId;
      if (!itemId) {
        json(response, 400, {
          ok: false,
          error: "missing_item_id",
          message: "skip-item requires itemId",
        });
        return;
      }
      const detail = skipWorkItemGroupItem(parts[1], itemId, body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group or item not found: ${parts[1]}/${itemId}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-groups" &&
      parts[2] === "validate-bundle"
    ) {
      const body = await readJsonBody(request);
      const detail = await validateWorkItemGroupBundle(parts[1], {
        ...body,
        wait: body.wait ?? false,
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item group not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/work-items") {
      const detail = listSelfBuildWorkItems({
        status: url.searchParams.get("status")?.trim() || null,
        limit: url.searchParams.get("limit")?.trim() || "50",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "POST" && url.pathname === "/work-items") {
      const body = await readJsonBody(request);
      const detail = await createManagedWorkItem(body);
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "work-items"
    ) {
      const detail = getSelfBuildWorkItem(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "work-items" &&
      parts[2] === "runs"
    ) {
      const item = getSelfBuildWorkItem(parts[1]);
      if (!item) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item not found: ${parts[1]}`,
        });
        return;
      }
      const runs = listSelfBuildWorkItemRuns(parts[1], {
        limit: url.searchParams.get("limit")?.trim() || "20",
      });
      const runCountsByStatus = runs.reduce((accumulator, run) => {
        accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
        return accumulator;
      }, {});
      json(response, 200, {
        ok: true,
        detail: {
          item,
          latestRun: runs[0] ?? null,
          runCountsByStatus,
          trend: item.runHistory?.trend ?? null,
          runs,
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-items" &&
      parts[2] === "run"
    ) {
      const body = await readJsonBody(request);
      const detail = await runSelfBuildWorkItem(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "work-item-runs"
    ) {
      const detail = getSelfBuildWorkItemRun(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item run not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "rerun"
    ) {
      const body = await readJsonBody(request);
      const detail = await rerunSelfBuildWorkItemRun(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item run not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "workspace"
    ) {
      const detail = await getWorkspaceDetailByRun(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `workspace not found for work item run: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "proposal"
    ) {
      const detail = getProposalByRun(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal not found for work item run: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "validate"
    ) {
      const body = await readJsonBody(request);
      const detail = await validateWorkItemRun(parts[1], {
        ...body,
        wait: body.wait ?? false,
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item run not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "validate-bundle"
    ) {
      const body = await readJsonBody(request);
      const detail = await validateWorkItemRun(parts[1], {
        ...body,
        wait: body.wait ?? false,
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item run not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "work-item-runs" &&
      parts[2] === "doc-suggestions"
    ) {
      const detail = getDocSuggestionsForRun(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `work item run not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "doc-suggestions"
    ) {
      const detail = getDocSuggestionSummary(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `doc suggestion not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "doc-suggestions" &&
      parts[2] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewDocSuggestionRecord(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `doc suggestion not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "doc-suggestions" &&
      parts[2] === "materialize"
    ) {
      const body = await readJsonBody(request);
      const detail = await materializeDocSuggestionRecord(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `doc suggestion not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "proposal-artifacts"
    ) {
      const detail = getProposalSummary(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal artifact not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "review-package"
    ) {
      const detail = getProposalReviewPackage(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal artifact not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewProposalArtifact(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal artifact not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "rework"
    ) {
      const body = await readJsonBody(request);
      const detail = await reworkProposalArtifact(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal artifact not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "protected-override"
    ) {
      const body = await readJsonBody(request);
      const detail = await createSelfBuildOverride({
        kind: body.kind ?? "protected-tier",
        targetType: "proposal",
        targetId: parts[1],
        reason:
          body.reason ??
          body.comments ??
          "Protected-tier override requested for proposal artifact.",
        rationale: body.rationale ?? body.comments ?? "",
        metadata: {
          ...(body.metadata ?? {}),
          overrideScope: body.overrideScope ?? null,
          protectedScope: body.overrideScope ?? null,
          requestContext: "proposal",
        },
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "quarantine"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await quarantineSelfBuildTarget("proposal", parts[1], {
          ...body,
          by: body.by ?? "operator",
          sourceType: body.sourceType ?? "http",
        });
        json(response, 200, { ok: true, detail });
      } catch (error) {
        if (
          (error as { code?: string }).code === "self_build_target_not_found"
        ) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message:
              error instanceof Error
                ? error.message
                : `proposal artifact not found: ${parts[1]}`,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "promotion-plan"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = planProposalPromotion(parts[1], body);
        if (!detail) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message: `proposal artifact not found: ${parts[1]}`,
          });
          return;
        }
        json(response, 200, { ok: true, detail });
      } catch (error) {
        const detail = (error as { detail?: unknown }).detail;
        json(response, 409, {
          ok: false,
          error:
            (error as { code?: string }).code ?? "proposal_promotion_blocked",
          message:
            error instanceof Error
              ? error.message
              : "proposal promotion blocked",
          detail,
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "promotion-invoke"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await invokeProposalPromotion(parts[1], body);
        if (!detail) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message: `proposal artifact not found: ${parts[1]}`,
          });
          return;
        }
        json(response, 200, { ok: true, detail });
      } catch (error) {
        const detail = (error as { detail?: unknown }).detail;
        json(response, 409, {
          ok: false,
          error:
            (error as { code?: string }).code ?? "proposal_promotion_blocked",
          message:
            error instanceof Error
              ? error.message
              : "proposal promotion blocked",
          detail,
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "proposal-artifacts" &&
      parts[2] === "approval"
    ) {
      const body = await readJsonBody(request);
      const detail = await approveProposalArtifact(parts[1], body);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `proposal artifact not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workspaces") {
      json(response, 200, {
        ok: true,
        detail: listWorkspaceSummaries({
          status: url.searchParams.get("status")?.trim() || null,
          workItemId: url.searchParams.get("workItemId")?.trim() || null,
          workItemRunId: url.searchParams.get("workItemRunId")?.trim() || null,
          executionId: url.searchParams.get("executionId")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/integration-branches") {
      json(response, 200, {
        ok: true,
        detail: listIntegrationBranchSummaries({
          status: url.searchParams.get("status")?.trim() || null,
          limit: url.searchParams.get("limit")?.trim() || "50",
        }),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "integration-branches"
    ) {
      const detail = getIntegrationBranchSummary(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `integration branch not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "integration-branches" &&
      parts[2] === "protected-override"
    ) {
      const body = await readJsonBody(request);
      const detail = await createSelfBuildOverride({
        kind: body.kind ?? "protected-tier",
        targetType: "integration-branch",
        targetId: parts[1],
        reason:
          body.reason ??
          body.comments ??
          "Protected-tier override requested for integration branch.",
        rationale: body.rationale ?? body.comments ?? "",
        metadata: {
          ...(body.metadata ?? {}),
          overrideScope: body.overrideScope ?? null,
          protectedScope: body.overrideScope ?? null,
          requestContext: "integration-branch",
        },
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "integration-branches" &&
      parts[2] === "quarantine"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await quarantineSelfBuildTarget(
          "integration-branch",
          parts[1],
          {
            ...body,
            by: body.by ?? "operator",
            sourceType: body.sourceType ?? "http",
          },
        );
        json(response, 200, { ok: true, detail });
      } catch (error) {
        if (
          (error as { code?: string }).code === "self_build_target_not_found"
        ) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message:
              error instanceof Error
                ? error.message
                : `integration branch not found: ${parts[1]}`,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "integration-branches" &&
      parts[2] === "rollback"
    ) {
      const body = await readJsonBody(request);
      const detail = await rollbackIntegrationBranch(parts[1], {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `integration branch not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/self-build/loop/status"
    ) {
      json(response, 200, { ok: true, detail: getSelfBuildLoopStatus() });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/self-build/loop/start"
    ) {
      const body = await readJsonBody(request);
      const detail = await startSelfBuildLoop(body);
      json(response, 200, { ok: true, detail });
      return;
    }

    if (request.method === "POST" && url.pathname === "/self-build/loop/stop") {
      const body = await readJsonBody(request);
      const detail = await stopSelfBuildLoop(body);
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "quarantine" &&
      parts[3] === "release"
    ) {
      const body = await readJsonBody(request);
      const detail = await releaseSelfBuildQuarantine(parts[2], {
        ...body,
        by: body.by ?? "operator",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `quarantine record not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "overrides" &&
      parts[3] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewSelfBuildOverride(parts[2], {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `self-build override not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "overrides" &&
      parts[3] === "release"
    ) {
      const body = await readJsonBody(request);
      const detail = await releaseSelfBuildOverride(parts[2], {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `self-build override not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "policy-recommendations" &&
      parts[3] === "review"
    ) {
      const body = await readJsonBody(request);
      const detail = await reviewPolicyRecommendation(parts[2], {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `policy recommendation not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "self-build" &&
      parts[1] === "policy-recommendations" &&
      parts[3] === "materialize"
    ) {
      const body = await readJsonBody(request);
      const detail = await materializePolicyRecommendation(parts[2], {
        ...body,
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `policy recommendation not found: ${parts[2]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "workspaces"
    ) {
      const detail = await getWorkspaceDetail(parts[1]);
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `workspace not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "workspaces" &&
      parts[2] === "reconcile"
    ) {
      const body = await readJsonBody(request);
      const detail = await reconcileManagedWorkspace(parts[1], {
        by: body.by ?? "operator",
        source: body.source ?? "http",
      });
      if (!detail) {
        json(response, 404, {
          ok: false,
          error: "not_found",
          message: `workspace not found: ${parts[1]}`,
        });
        return;
      }
      json(response, 200, { ok: true, detail });
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "workspaces" &&
      parts[2] === "cleanup"
    ) {
      const body = await readJsonBody(request);
      try {
        const detail = await cleanupManagedWorkspace(parts[1], {
          by: body.by ?? "operator",
          source: body.source ?? "http",
          force: body.force === true,
          keepBranch: body.keepBranch === true,
        });
        if (!detail) {
          json(response, 404, {
            ok: false,
            error: "not_found",
            message: `workspace not found: ${parts[1]}`,
          });
          return;
        }
        json(response, 200, { ok: true, detail });
      } catch (error) {
        if (error.code === "cleanup_blocked") {
          json(response, 409, {
            ok: false,
            error: error.code,
            message: error.message,
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "workspaces"
    ) {
      json(response, 200, {
        ok: true,
        detail: listExecutionWorkspaces(parts[1]),
      });
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "escalations"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "escalations",
        "--execution",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "coordination-groups"
    ) {
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "group",
        "--group",
        parts[1],
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "coordination-groups" &&
      parts[2] === "drive"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive-group",
        "--group",
        parts[1],
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout)
        args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout)
        args.push("--step-hard-timeout", String(body.stepHardTimeout));
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

    if (request.method === "POST" && url.pathname === "/projects/plan") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildProjectPlanArgs(body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/projects/invoke") {
      const body = await readJsonBody(request);
      const payload = await runCli(buildProjectInvokeArgs(body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/promotions/plan") {
      const body = await readJsonBody(request);
      if (!body.execution) {
        json(response, 400, {
          ok: false,
          error: "missing_execution",
          message:
            "use execution to identify the coordinator-root execution for promotion",
        });
        return;
      }
      const payload = await runCli(buildPromotionPlanArgs(body));
      json(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/promotions/invoke") {
      const body = await readJsonBody(request);
      if (!body.execution) {
        json(response, 400, {
          ok: false,
          error: "missing_execution",
          message:
            "use execution to identify the coordinator-root execution for promotion",
        });
        return;
      }
      const payload = await runCli(buildPromotionInvokeArgs(body));
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "drive"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive",
        "--execution",
        parts[1],
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout)
        args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout)
        args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "drive"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "drive-tree",
        "--execution",
        parts[1],
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout)
        args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout)
        args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "fork"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "fork",
        "--execution",
        parts[1],
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

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "branches"
    ) {
      const body = await readJsonBody(request);
      const args = [
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "spawn-branches",
        "--execution",
        parts[1],
        "--branches-json",
        JSON.stringify(body.branches ?? []),
      ];
      if (body.wait) args.push("--wait");
      if (body.timeout) args.push("--timeout", String(body.timeout));
      if (body.interval) args.push("--interval", String(body.interval));
      if (body.stepSoftTimeout)
        args.push("--step-soft-timeout", String(body.stepSoftTimeout));
      if (body.stepHardTimeout)
        args.push("--step-hard-timeout", String(body.stepHardTimeout));
      const payload = await runCli(args);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "pause"
    ) {
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
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "pause"
    ) {
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
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "hold"
    ) {
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
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "hold"
    ) {
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
        ...(body.timeoutMs ? ["--timeout-ms", String(body.timeoutMs)] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "resume"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "resume",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "resume"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "resume-tree",
        "--execution",
        parts[1],
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "review"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "review",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "review"
    ) {
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
        ...(body.comments ? ["--comments", body.comments] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[0] === "executions" &&
      parts[2] === "approval"
    ) {
      const body = await readJsonBody(request);
      const payload = await runCli([
        "packages/orchestrator/src/cli/spore-orchestrator.js",
        "approve",
        "--execution",
        parts[1],
        "--status",
        body.status ?? "approved",
        ...(body.by ? ["--by", body.by] : []),
        ...(body.comments ? ["--comments", body.comments] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "executions" &&
      parts[2] === "tree" &&
      parts[3] === "approval"
    ) {
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
        ...(body.comments ? ["--comments", body.comments] : []),
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
        ...(body.resume ? ["--resume"] : []),
      ]);
      json(response, 200, payload);
      return;
    }

    json(response, 404, {
      ok: false,
      error: "not_found",
      pathname: url.pathname,
    });
  } catch (error) {
    json(response, 500, {
      ok: false,
      error: "internal_error",
      message: error.message,
    });
  }
});

const host = process.env.SPORE_ORCHESTRATOR_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.SPORE_ORCHESTRATOR_PORT ?? "8789", 10);
server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        service: "spore-orchestrator",
        host,
        port,
      },
      null,
      2,
    )}\n`,
  );
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.stderr.write(`spore-orchestrator shutdown: ${signal}\n`);
  server.close(() => {
    process.exitCode = process.exitCode ?? 0;
  });
  const timer = setTimeout(() => {
    process.exitCode = 1;
    process.exit();
  }, 5_000);
  timer.unref?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
