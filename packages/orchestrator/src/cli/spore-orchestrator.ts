#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noExplicitAny: the orchestrator CLI is a dynamic flag parser over many additive command payloads.
import { spawn } from "node:child_process";
import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";
import { normalizeProjectRef } from "../project-config.js";
import {
  applyExecutionTreeAction,
  applyExecutionTreeGovernance,
  buildProjectCoordinationPlan,
  createExecution,
  driveCoordinationGroup,
  driveExecution,
  driveExecutionTree,
  forkExecution,
  getCoordinationGroupDetail,
  getExecutionDetail,
  getExecutionHistory,
  getExecutionPolicyDiff,
  getExecutionTree,
  getRegressionCatalogEntry,
  getRegressionRuns,
  getScenarioCatalogEntry,
  getScenarioRuns,
  holdExecution,
  invokeFeaturePromotion,
  invokeProjectCoordination,
  listCoordinationGroups,
  listExecutionAudit,
  listExecutionChildren,
  listExecutionEscalations,
  listExecutionEvents,
  listExecutionSummaries,
  listRegressionCatalog,
  listScenarioCatalog,
  pauseExecution,
  planPromotionForExecution,
  recordApprovalDecision,
  recordReviewDecision,
  resolveExecutionEscalation,
  resumeExecution,
  spawnExecutionBranches,
} from "../execution/workflow-execution.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";
import {
  getRegressionLatestReport,
  getRegressionRunReport,
  getRegressionRunSummaryById,
  getRegressionSchedulerStatus,
  getRegressionTrends,
  getRunCenterSummary,
  getScenarioRunArtifacts,
  getScenarioRunSummaryById,
  getScenarioTrends,
  rerunRegressionRun,
  rerunScenarioRun,
  runRegressionById,
  runRegressionScheduler,
  runScenarioById,
} from "../scenarios/run-history.js";
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
  queueWorkItemGroupValidationBundle,
  queueWorkItemRunValidation,
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
  waitForWorkItemGroupValidationBundle,
  waitForWorkItemRunValidation,
} from "../self-build/self-build.js";

type CliFlags = Record<string, any>;

function toOptionalString(value: string | boolean | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: CliFlags = {};
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

function parseCsv(value: string | boolean | undefined) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function buildInvocation(flags: CliFlags) {
  const roles = flags.roles ? parseCsv(flags.roles) : null;
  return planWorkflowInvocation({
    workflowPath: toOptionalString(flags.workflow),
    projectPath:
      toOptionalString(flags.project) ?? "config/projects/example-project.yaml",
    domainId: toOptionalString(flags.domain),
    roles,
    maxRoles: Number.parseInt(String(flags["max-roles"] ?? "1"), 10),
    invocationId: toOptionalString(flags["invocation-id"]),
    objective: toOptionalString(flags.objective) ?? "",
    coordinationGroupId: toOptionalString(flags["coordination-group"]),
    parentExecutionId: toOptionalString(flags["parent-execution"]),
    branchKey: toOptionalString(flags["branch-key"]),
  });
}

function spawnDetachedExecutionDriver(executionId: string, flags: CliFlags) {
  const args = [
    "packages/orchestrator/src/cli/spore-orchestrator.ts",
    "drive",
    "--execution",
    executionId,
    "--wait",
    "--timeout",
    String(flags.timeout ?? "86400000"),
    "--interval",
    String(flags.interval ?? "1500"),
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

  const invocation = {
    command: process.execPath,
    args: buildTsxEntrypointArgs(args[0], args.slice(1)),
  };

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

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const rawCommand = positional[0] ?? "plan";
  const commandAliases = {
    "project-goals": "goal-plan-list",
    "project-goal-create": "goal-plan-create",
    "project-work-items": "work-item-list",
    "project-dashboard": "self-build-dashboard",
    "project-summary": "self-build-summary",
  } as const;
  const command = commandAliases[rawCommand] ?? rawCommand;

  if (command === "plan") {
    const invocation = await buildInvocation(flags);
    console.log(JSON.stringify({ ok: true, invocation }, null, 2));
    return;
  }

  if (command === "project-plan") {
    const detail = await buildProjectCoordinationPlan({
      projectPath: flags.project ?? "config/projects/example-project.yaml",
      domains: parseCsv(flags.domains),
      objective: flags.objective ?? "",
      invocationId: flags["invocation-id"] ?? null,
      metadata: flags["coordination-mode"]
        ? { coordinationMode: flags["coordination-mode"] }
        : null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "project-invoke") {
    const detail = await invokeProjectCoordination({
      projectPath: flags.project ?? "config/projects/example-project.yaml",
      domains: parseCsv(flags.domains),
      objective: flags.objective ?? "",
      invocationId: flags["invocation-id"] ?? null,
      metadata: flags["coordination-mode"]
        ? { coordinationMode: flags["coordination-mode"] }
        : null,
      wait: flags.wait === true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "promotion-plan") {
    if (!flags.execution) {
      throw new Error(
        "use promotion-plan --execution <coordinator-root-execution-id> [--target-branch main]",
      );
    }
    const detail = await planPromotionForExecution(flags.execution, {
      invocationId: flags["invocation-id"] ?? null,
      targetBranch: flags["target-branch"] ?? null,
      objective: flags.objective ?? null,
      featureKey: flags["feature-id"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "promotion-invoke") {
    if (!flags.execution) {
      throw new Error(
        "use promotion-invoke --execution <coordinator-root-execution-id> [--target-branch main]",
      );
    }
    const detail = await invokeFeaturePromotion(flags.execution, {
      invocationId: flags["invocation-id"] ?? null,
      targetBranch: flags["target-branch"] ?? null,
      objective: flags.objective ?? null,
      featureKey: flags["feature-id"] ?? null,
      wait: flags.wait === true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    const monitor =
      flags.wait === true || flags["no-detach"] === true
        ? null
        : spawnDetachedExecutionDriver(invocation.invocationId, flags);
    console.log(
      JSON.stringify(
        { ok: true, invocation, created, detail, monitor },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "fork") {
    if (!flags.execution) {
      throw new Error("use fork --execution <id> [--roles lead,reviewer]");
    }
    const roles = flags.roles
      ? String(flags.roles)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : null;
    const result = await forkExecution(flags.execution, {
      workflowPath: flags.workflow ?? null,
      projectPath: flags.project ?? null,
      domainId: flags.domain ?? null,
      roles,
      maxRoles: Number.parseInt(String(flags["max-roles"] ?? "1"), 10),
      invocationId: flags["invocation-id"] ?? null,
      objective: flags.objective ?? null,
      branchKey: flags["branch-key"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "list") {
    console.log(
      JSON.stringify(
        { ok: true, executions: listExecutionSummaries() },
        null,
        2,
      ),
    );
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
    console.log(
      JSON.stringify(
        { ok: true, executionId: flags.execution, children },
        null,
        2,
      ),
    );
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
    console.log(
      JSON.stringify({ ok: true, groups: listCoordinationGroups() }, null, 2),
    );
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "spawn-branches") {
    if (!flags.execution) {
      throw new Error(
        'use spawn-branches --execution <id> --branches-json \'[{"roles":["builder"]}]\'',
      );
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
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
    console.log(
      JSON.stringify(
        { ok: true, executionId: flags.execution, events },
        null,
        2,
      ),
    );
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
    console.log(
      JSON.stringify(
        { ok: true, executionId: flags.execution, escalations },
        null,
        2,
      ),
    );
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
    console.log(
      JSON.stringify(
        { ok: true, executionId: flags.execution, audit },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "history") {
    if (!flags.execution) {
      throw new Error("use history --execution <id>");
    }
    const detail = await getExecutionHistory(flags.execution, {
      scope: flags.scope ?? "execution",
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

  if (command === "execution-workspaces") {
    if (!flags.execution) {
      throw new Error("use execution-workspaces --execution <id>");
    }
    const payload = listExecutionWorkspaces(flags.execution);
    console.log(JSON.stringify({ ok: true, detail: payload }, null, 2));
    return;
  }

  if (command === "scenario-list") {
    const scenarios = await listScenarioCatalog();
    console.log(JSON.stringify({ ok: true, scenarios }, null, 2));
    return;
  }

  if (command === "run-center") {
    const detail = await getRunCenterSummary(
      undefined,
      Number.parseInt(String(flags.limit ?? "10"), 10),
    );
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
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
    const detail = await getScenarioRuns(
      flags.scenario,
      undefined,
      Number.parseInt(String(flags.limit ?? "20"), 10),
    );
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
    const detail = await getScenarioTrends(
      flags.scenario,
      undefined,
      Number.parseInt(String(flags.limit ?? "100"), 10),
    );
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
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
    const detail = await getRegressionRuns(
      flags.regression,
      undefined,
      Number.parseInt(String(flags.limit ?? "20"), 10),
    );
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "regression-run-show") {
    if (!flags.run) {
      throw new Error("use regression-run-show --run <id>");
    }
    const detail = await getRegressionRunSummaryById(flags.run);
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

  if (command === "regression-latest-report") {
    if (!flags.regression) {
      throw new Error("use regression-latest-report --regression <id>");
    }
    const detail = await getRegressionLatestReport(flags.regression);
    if (!detail) {
      throw new Error(`regression report not found: ${flags.regression}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-scheduler-status") {
    const detail = await getRegressionSchedulerStatus();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-summary") {
    const detail = getSelfBuildSummary();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-dashboard") {
    const detail = getSelfBuildDashboard({
      status: flags.status ?? null,
      group: flags.group ?? null,
      template: flags.template ?? null,
      domain: flags.domain ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-decisions") {
    const detail = listSelfBuildDecisionSummaries({
      state: flags.state ?? null,
      action: flags.action ?? null,
      targetType: flags["target-type"] ?? null,
      targetId: flags["target-id"] ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-quarantine") {
    const detail = listSelfBuildQuarantineSummaries({
      status: flags.status ?? null,
      targetType: flags["target-type"] ?? null,
      targetId: flags["target-id"] ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-rollback") {
    const detail = listSelfBuildRollbackSummaries({
      targetType: flags["target-type"] ?? null,
      targetId: flags["target-id"] ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-learnings") {
    const detail = listSelfBuildLearningSummaries({
      sourceType: flags["source-type"] ?? null,
      status: flags.status ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-learning-trends") {
    const detail = getSelfBuildLearningTrends();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-policy-recommendations") {
    const detail = getSelfBuildPolicyRecommendations();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-policy-recommendation-show") {
    if (!flags.recommendation) {
      throw new Error(
        "use self-build-policy-recommendation-show --recommendation <id>",
      );
    }
    const detail = getPolicyRecommendationSummary(flags.recommendation);
    if (!detail) {
      throw new Error(
        `policy recommendation not found: ${flags.recommendation}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-policy-recommendation-reviews") {
    const detail = listPolicyRecommendationReviewSummaries({
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-policy-recommendation-review") {
    if (!flags.recommendation || !flags.status) {
      throw new Error(
        "use self-build-policy-recommendation-review --recommendation <id> --status <accepted|held|dismissed>",
      );
    }
    const detail = await reviewPolicyRecommendation(flags.recommendation, {
      status: flags.status,
      by: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      comments: flags.comments ?? "",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(
        `policy recommendation not found: ${flags.recommendation}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-policy-recommendation-materialize") {
    if (!flags.recommendation) {
      throw new Error(
        "use self-build-policy-recommendation-materialize --recommendation <id>",
      );
    }
    const detail = await materializePolicyRecommendation(flags.recommendation, {
      projectId: normalizeProjectRef(flags.project),
      domain: flags.domain ?? null,
      safeMode: flags["safe-mode"] !== false,
      reviewRequired: flags["review-required"] !== false,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(
        `policy recommendation not found: ${flags.recommendation}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-overrides") {
    const detail = listSelfBuildOverrideSummaries({
      kind: flags.kind ?? null,
      status: flags.status ?? null,
      targetType: flags["target-type"] ?? null,
      targetId: flags["target-id"] ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-override-show") {
    if (!flags.override) {
      throw new Error("use self-build-override-show --override <id>");
    }
    const detail = getSelfBuildOverrideSummary(flags.override);
    if (!detail) {
      throw new Error(`self-build override not found: ${flags.override}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-override-create") {
    if (!flags["target-type"] || !flags["target-id"]) {
      throw new Error(
        "use self-build-override-create --target-type <goal-plan|work-item-group|proposal|integration-branch> --target-id <id>",
      );
    }
    const detail = await createSelfBuildOverride({
      kind: flags.kind ?? "protected-tier",
      targetType: flags["target-type"],
      targetId: flags["target-id"],
      reason: flags.reason ?? flags.comments ?? "",
      rationale: flags.rationale ?? flags.comments ?? "",
      status: flags.status ?? "pending_review",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      metadata: flags["metadata-json"]
        ? JSON.parse(String(flags["metadata-json"]))
        : {},
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-override-review") {
    if (!flags.override || !flags.status) {
      throw new Error(
        "use self-build-override-review --override <id> --status <approved|held|rejected>",
      );
    }
    const detail = await reviewSelfBuildOverride(flags.override, {
      status: flags.status,
      reason: flags.reason ?? flags.comments ?? "",
      comments: flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`self-build override not found: ${flags.override}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-override-release") {
    if (!flags.override) {
      throw new Error("use self-build-override-release --override <id>");
    }
    const detail = await releaseSelfBuildOverride(flags.override, {
      reason: flags.reason ?? flags.comments ?? "",
      comments: flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`self-build override not found: ${flags.override}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-doc-suggestions") {
    const detail = listSelfBuildDocSuggestionSummaries({
      status: flags.status ?? null,
      workItemRunId: flags.run ?? null,
      workItemId: flags.item ?? null,
      proposalArtifactId: flags.proposal ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-intake") {
    const detail = listSelfBuildIntakeSummaries({
      status: flags.status ?? null,
      kind: flags.kind ?? null,
      sourceType: flags["source-type"] ?? null,
      projectId: flags.project ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-intake-show") {
    if (!flags.intake) {
      throw new Error("use self-build-intake-show --intake <id>");
    }
    const detail = getSelfBuildIntakeSummary(flags.intake);
    if (!detail) {
      throw new Error(`self-build intake not found: ${flags.intake}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-intake-refresh") {
    const detail = await refreshSelfBuildIntake({
      includeAccepted: flags["include-accepted"] === true,
      projectId: flags.project ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-intake-review") {
    if (!flags.intake || !flags.status) {
      throw new Error(
        "use self-build-intake-review --intake <id> --status <accepted|dismissed>",
      );
    }
    const detail = await reviewSelfBuildIntake(flags.intake, {
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? "",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`self-build intake not found: ${flags.intake}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-intake-materialize") {
    if (!flags.intake) {
      throw new Error("use self-build-intake-materialize --intake <id>");
    }
    const detail = await materializeSelfBuildIntake(flags.intake, {
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      projectId: flags.project ?? null,
    });
    if (!detail) {
      throw new Error(`self-build intake not found: ${flags.intake}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-template-list") {
    const detail = await listWorkItemTemplates();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-template-show") {
    if (!flags.template) {
      throw new Error("use work-item-template-show --template <id>");
    }
    const detail = await getWorkItemTemplate(flags.template);
    if (!detail) {
      throw new Error(`work item template not found: ${flags.template}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-create") {
    if (!flags.goal) {
      throw new Error("use goal-plan-create --goal <text>");
    }
    const detail = await createGoalPlan({
      title: flags.title ?? null,
      goal: flags.goal,
      projectId: normalizeProjectRef(flags.project),
      domainId: flags.domain ?? null,
      mode: flags.mode ?? "supervised",
      safeMode: flags["safe-mode"] !== false,
      constraints: flags.constraints
        ? JSON.parse(String(flags.constraints))
        : {},
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-list") {
    const detail = listGoalPlansSummary({
      status: flags.status ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-show") {
    if (!flags.plan) {
      throw new Error("use goal-plan-show --plan <id>");
    }
    const detail = getGoalPlanSummary(flags.plan);
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-history") {
    if (!flags.plan) {
      throw new Error("use goal-plan-history --plan <id>");
    }
    const detail = getGoalPlanHistory(flags.plan);
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-edit") {
    if (!flags.plan) {
      throw new Error(
        "use goal-plan-edit --plan <id> --recommendations-json '[...]'",
      );
    }
    const detail = await editGoalPlan(flags.plan, {
      recommendations: flags["recommendations-json"]
        ? JSON.parse(String(flags["recommendations-json"]))
        : undefined,
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-review") {
    if (!flags.plan || !flags.status) {
      throw new Error(
        "use goal-plan-review --plan <id> --status <reviewed|rejected>",
      );
    }
    const detail = await reviewGoalPlan(flags.plan, {
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? "",
      reason: flags.reason ?? flags.comments ?? "",
    });
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-quarantine") {
    if (!flags.plan) {
      throw new Error("use goal-plan-quarantine --plan <id>");
    }
    const detail = await quarantineSelfBuildTarget("goal-plan", flags.plan, {
      reason: flags.reason ?? flags.comments ?? "",
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      sourceType: flags.source ?? "cli",
      metadata: {
        nextStatus: flags["next-status"] ?? null,
      },
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-materialize") {
    if (!flags.plan) {
      throw new Error("use goal-plan-materialize --plan <id>");
    }
    const detail = await materializeGoalPlan(flags.plan, {
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "goal-plan-run") {
    if (!flags.plan) {
      throw new Error("use goal-plan-run --plan <id>");
    }
    const detail = await runGoalPlan(flags.plan, {
      reviewStatus: flags["review-status"] ?? null,
      reviewComments: flags["review-comments"] ?? "",
      reviewReason: flags["review-reason"] ?? "",
      force: flags.force === true,
      autoValidate: flags["auto-validate"] !== false,
      wait: flags.wait === true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`goal plan not found: ${flags.plan}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-list") {
    const detail = listWorkItemGroupsSummary({
      status: flags.status ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-show") {
    if (!flags.group) {
      throw new Error("use work-item-group-show --group <id>");
    }
    const detail = getWorkItemGroupSummary(flags.group);
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-dependencies") {
    if (!flags.group || !flags["edges-json"]) {
      throw new Error(
        "use work-item-group-dependencies --group <id> --edges-json '[...]'",
      );
    }
    const detail = setWorkItemGroupDependencies(flags.group, {
      edges: JSON.parse(String(flags["edges-json"] ?? "[]")),
      replace: flags.replace !== false,
    });
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, ...detail }, null, 2));
    return;
  }

  if (command === "work-item-group-run") {
    if (!flags.group) {
      throw new Error("use work-item-group-run --group <id>");
    }
    const detail = await runWorkItemGroup(flags.group, {
      project: flags.project ?? null,
      wait: flags.wait !== false,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-unblock") {
    if (!flags.group) {
      throw new Error("use work-item-group-unblock --group <id> [--items a,b]");
    }
    const detail = unblockWorkItemGroup(flags.group, {
      itemIds: flags.items ? parseCsv(flags.items) : [],
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-quarantine") {
    if (!flags.group) {
      throw new Error("use work-item-group-quarantine --group <id>");
    }
    const detail = await quarantineSelfBuildTarget(
      "work-item-group",
      flags.group,
      {
        reason: flags.reason ?? flags.comments ?? "",
        rationale: flags.rationale ?? flags.comments ?? "",
        by: flags.by ?? "operator",
        sourceType: flags.source ?? "cli",
      },
    );
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-reroute") {
    if (!flags.group || !flags.item) {
      throw new Error(
        "use work-item-group-reroute --group <id> --item <id> [--title <text>]",
      );
    }
    const detail = await rerouteWorkItemGroup(flags.group, {
      itemId: flags.item,
      title: flags.title ?? null,
      goal: flags.goal ?? null,
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(
        `work item group or item not found: ${flags.group}/${flags.item}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-retry-downstream") {
    if (!flags.group) {
      throw new Error(
        "use work-item-group-retry-downstream --group <id> [--items a,b]",
      );
    }
    const detail = await retryDownstreamWorkItemGroup(flags.group, {
      itemIds: flags.items ? parseCsv(flags.items) : [],
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-requeue-item") {
    if (!flags.group || !flags.item) {
      throw new Error(
        "use work-item-group-requeue-item --group <id> --item <id>",
      );
    }
    const detail = requeueWorkItemGroupItem(flags.group, flags.item, {
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(
        `work item group or item not found: ${flags.group}/${flags.item}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-skip-item") {
    if (!flags.group || !flags.item) {
      throw new Error("use work-item-group-skip-item --group <id> --item <id>");
    }
    const detail = skipWorkItemGroupItem(flags.group, flags.item, {
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(
        `work item group or item not found: ${flags.group}/${flags.item}`,
      );
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-group-validate-bundle") {
    if (!flags.group) {
      throw new Error(
        "use work-item-group-validate-bundle --group <id> [--bundles a,b]",
      );
    }
    const detail = await (flags.wait === true
      ? waitForWorkItemGroupValidationBundle(flags.group, {
          bundleIds: flags.bundles ? parseCsv(flags.bundles) : [],
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
        })
      : queueWorkItemGroupValidationBundle(flags.group, {
          bundleIds: flags.bundles ? parseCsv(flags.bundles) : [],
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
        }));
    if (!detail) {
      throw new Error(`work item group not found: ${flags.group}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "regression-trends") {
    if (!flags.regression) {
      throw new Error("use regression-trends --regression <id>");
    }
    const detail = await getRegressionTrends(
      flags.regression,
      undefined,
      Number.parseInt(String(flags.limit ?? "100"), 10),
    );
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    if (!result) {
      throw new Error(`regression run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "regression-scheduler") {
    const detail = await runRegressionScheduler({
      regressionId: flags.regression ?? null,
      dueOnly: !flags.all,
      dryRun: flags["dry-run"] === true,
      maxRuns: flags["max-runs"] ?? "1",
      project: flags.project ?? null,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      source: flags.source ?? "scheduler",
      by: flags.by ?? "scheduler",
      timeout: flags.timeout ?? null,
      interval: flags.interval ?? null,
      noMonitor: flags["no-monitor"] === true,
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-list") {
    const detail = listSelfBuildWorkItems({
      status: flags.status ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-show") {
    if (!flags.item) {
      throw new Error("use work-item-show --item <id>");
    }
    const detail = getSelfBuildWorkItem(flags.item);
    if (!detail) {
      throw new Error(`work item not found: ${flags.item}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-runs") {
    if (!flags.item) {
      throw new Error("use work-item-runs --item <id>");
    }
    const detail = {
      item: getSelfBuildWorkItem(flags.item),
      runs: listSelfBuildWorkItemRuns(flags.item, {
        limit: flags.limit ?? "20",
      }),
    };
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-create") {
    if ((!flags.title || !flags.kind) && !flags.template) {
      throw new Error(
        "use work-item-create --title <text> --kind <scenario|regression|workflow> or --template <id>",
      );
    }
    const detail = await createManagedWorkItem({
      templateId: flags.template ?? null,
      title: flags.title,
      kind: flags.kind,
      source: flags.source ?? "cli",
      goal: flags.goal ?? "",
      priority: flags.priority ?? "medium",
      acceptanceCriteria: flags.acceptance
        ? String(flags.acceptance)
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      relatedDocs: flags.docs
        ? String(flags.docs)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      relatedScenarios: flags.scenarios
        ? String(flags.scenarios)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      relatedRegressions: flags.regressions
        ? String(flags.regressions)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      metadata: {
        scenarioId: flags.scenario ?? null,
        regressionId: flags.regression ?? null,
        workflowPath: flags.workflow ?? null,
        domainId: flags.domain ?? null,
        roles: flags.roles
          ? String(flags.roles)
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : null,
        projectPath: flags.project ?? null,
        safeMode: flags["safe-mode"] !== false,
        mutationScope: flags["mutation-scope"]
          ? String(flags["mutation-scope"])
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : null,
      },
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-run") {
    if (!flags.item) {
      throw new Error("use work-item-run --item <id>");
    }
    const detail = await runSelfBuildWorkItem(flags.item, {
      project: flags.project ?? null,
      wait: flags.wait !== false,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    if (!detail) {
      throw new Error(`work item not found: ${flags.item}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-run-show") {
    if (!flags.run) {
      throw new Error("use work-item-run-show --run <id>");
    }
    const detail = getSelfBuildWorkItemRun(flags.run);
    if (!detail) {
      throw new Error(`work item run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-run-rerun") {
    if (!flags.run) {
      throw new Error("use work-item-run-rerun --run <id>");
    }
    const detail = await rerunSelfBuildWorkItemRun(flags.run, {
      project: flags.project ?? null,
      wait: flags.wait !== false,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      reason: flags.reason ?? "",
      stepSoftTimeoutMs: flags["step-soft-timeout"] ?? null,
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    if (!detail) {
      throw new Error(`work item run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-validate") {
    if (!flags.run) {
      throw new Error("use work-item-validate --run <id>");
    }
    const detail = await (flags.wait === true
      ? waitForWorkItemRunValidation(flags.run, {
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
        })
      : queueWorkItemRunValidation(flags.run, {
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
        }));
    if (!detail) {
      throw new Error(`work item run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-validate-bundle") {
    if (!flags.run) {
      throw new Error(
        "use work-item-validate-bundle --run <id> [--bundles a,b]",
      );
    }
    const detail = await (flags.wait === true
      ? waitForWorkItemRunValidation(flags.run, {
          bundleIds: flags.bundles ? parseCsv(flags.bundles) : [],
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
        })
      : queueWorkItemRunValidation(flags.run, {
          bundleIds: flags.bundles ? parseCsv(flags.bundles) : [],
          timeout: flags.timeout ?? "180000",
          interval: flags.interval ?? "1500",
          noMonitor: flags["no-monitor"] === true,
          stub: flags.stub !== false,
          launcher: flags.launcher ?? null,
          by: flags.by ?? "operator",
          source: flags.source ?? "cli",
        }));
    if (!detail) {
      throw new Error(`work item run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "work-item-doc-suggestions") {
    if (!flags.run) {
      throw new Error("use work-item-doc-suggestions --run <id>");
    }
    const detail = getDocSuggestionsForRun(flags.run);
    if (!detail) {
      throw new Error(`work item run not found: ${flags.run}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "doc-suggestion-show") {
    if (!flags.suggestion) {
      throw new Error("use doc-suggestion-show --suggestion <id>");
    }
    const detail = getDocSuggestionSummary(flags.suggestion);
    if (!detail) {
      throw new Error(`doc suggestion not found: ${flags.suggestion}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "doc-suggestion-review") {
    if (!flags.suggestion || !flags.status) {
      throw new Error(
        "use doc-suggestion-review --suggestion <id> --status <accepted|dismissed>",
      );
    }
    const detail = await reviewDocSuggestionRecord(flags.suggestion, {
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? "",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`doc suggestion not found: ${flags.suggestion}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "doc-suggestion-materialize") {
    if (!flags.suggestion) {
      throw new Error("use doc-suggestion-materialize --suggestion <id>");
    }
    const detail = await materializeDocSuggestionRecord(flags.suggestion, {
      templateId: flags.template ?? null,
      title: flags.title ?? null,
      goal: flags.goal ?? null,
      priority: flags.priority ?? null,
      domainId: flags.domain ?? null,
      safeMode:
        flags["safe-mode"] === undefined
          ? undefined
          : flags["safe-mode"] !== false,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`doc suggestion not found: ${flags.suggestion}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-show") {
    if (!flags.proposal && !flags.run) {
      throw new Error(
        "use proposal-show --proposal <id> or --run <work-item-run-id>",
      );
    }
    const detail = flags.proposal
      ? getProposalSummary(flags.proposal)
      : getProposalByRun(flags.run);
    if (!detail) {
      throw new Error("proposal artifact not found");
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-review-package") {
    if (!flags.proposal) {
      throw new Error("use proposal-review-package --proposal <id>");
    }
    const detail = getProposalReviewPackage(flags.proposal);
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-quarantine") {
    if (!flags.proposal) {
      throw new Error("use proposal-quarantine --proposal <id>");
    }
    const detail = await quarantineSelfBuildTarget("proposal", flags.proposal, {
      reason: flags.reason ?? flags.comments ?? "",
      rationale: flags.rationale ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      sourceType: flags.source ?? "cli",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "workspace-list") {
    console.log(
      JSON.stringify(
        listWorkspaceSummaries({
          status: flags.status ?? null,
          workItemId: flags.item ?? null,
          workItemRunId: flags.run ?? null,
          executionId: flags.execution ?? null,
          limit: flags.limit ?? "50",
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (command === "workspace-show") {
    if (!flags.workspace && !flags.run) {
      throw new Error(
        "use workspace-show --workspace <id> or --run <work-item-run-id>",
      );
    }
    const detail = flags.workspace
      ? await getWorkspaceDetail(flags.workspace)
      : await getWorkspaceDetailByRun(flags.run);
    if (!detail) {
      throw new Error(`workspace not found: ${flags.workspace ?? flags.run}`);
    }
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (command === "integration-branch-list") {
    const detail = listIntegrationBranchSummaries({
      status: flags.status ?? null,
      limit: flags.limit ?? "50",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "integration-branch-show") {
    if (!flags.name) {
      throw new Error("use integration-branch-show --name <branch>");
    }
    const detail = getIntegrationBranchSummary(flags.name);
    if (!detail) {
      throw new Error(`integration branch not found: ${flags.name}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "integration-branch-quarantine") {
    if (!flags.name) {
      throw new Error("use integration-branch-quarantine --name <branch>");
    }
    const detail = await quarantineSelfBuildTarget(
      "integration-branch",
      flags.name,
      {
        reason: flags.reason ?? flags.comments ?? "",
        rationale: flags.rationale ?? flags.comments ?? "",
        by: flags.by ?? "operator",
        sourceType: flags.source ?? "cli",
      },
    );
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "integration-branch-rollback") {
    if (!flags.name) {
      throw new Error("use integration-branch-rollback --name <branch>");
    }
    const detail = await rollbackIntegrationBranch(flags.name, {
      reason: flags.reason ?? flags.comments ?? "",
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`integration branch not found: ${flags.name}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-loop-status") {
    const detail = getSelfBuildLoopStatus();
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-loop-start") {
    const detail = await startSelfBuildLoop({
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      project: flags.project ?? null,
      stub: flags.stub !== false,
      launcher: flags.launcher ?? null,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-loop-stop") {
    const detail = await stopSelfBuildLoop({
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      reason: flags.reason ?? flags.comments ?? "",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "self-build-quarantine-release") {
    if (!flags.quarantine) {
      throw new Error("use self-build-quarantine-release --quarantine <id>");
    }
    const detail = await releaseSelfBuildQuarantine(flags.quarantine, {
      by: flags.by ?? "operator",
      reason: flags.reason ?? flags.comments ?? "",
      nextStatus: flags["next-status"] ?? null,
    });
    if (!detail) {
      throw new Error(`quarantine not found: ${flags.quarantine}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "workspace-reconcile") {
    if (!flags.workspace) {
      throw new Error("use workspace-reconcile --workspace <id>");
    }
    const detail = await reconcileManagedWorkspace(flags.workspace, {
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`workspace not found: ${flags.workspace}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "workspace-cleanup") {
    if (!flags.workspace) {
      throw new Error(
        "use workspace-cleanup --workspace <id> [--force] [--keep-branch]",
      );
    }
    const detail = await cleanupManagedWorkspace(flags.workspace, {
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
      force: flags.force === true,
      keepBranch: flags["keep-branch"] === true,
    });
    if (!detail) {
      throw new Error(`workspace not found: ${flags.workspace}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-review") {
    if (!flags.proposal || !flags.status) {
      throw new Error(
        "use proposal-review --proposal <id> --status <ready_for_review|reviewed|rejected>",
      );
    }
    const detail = await reviewProposalArtifact(flags.proposal, {
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? "",
    });
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-approve") {
    if (!flags.proposal || !flags.status) {
      throw new Error(
        "use proposal-approve --proposal <id> --status <approved|rejected>",
      );
    }
    const detail = await approveProposalArtifact(flags.proposal, {
      status: flags.status,
      by: flags.by ?? "operator",
      comments: flags.comments ?? "",
    });
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-promotion-plan") {
    if (!flags.proposal) {
      throw new Error("use proposal-promotion-plan --proposal <id>");
    }
    const detail = await planProposalPromotion(flags.proposal, {
      invocationId: flags["invocation-id"] ?? null,
      targetBranch: flags["target-branch"] ?? null,
      objective: flags.objective ?? null,
      featureKey: flags["feature-id"] ?? null,
    });
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-promotion-invoke") {
    if (!flags.proposal) {
      throw new Error("use proposal-promotion-invoke --proposal <id>");
    }
    const detail = await invokeProposalPromotion(flags.proposal, {
      invocationId: flags["invocation-id"] ?? null,
      targetBranch: flags["target-branch"] ?? null,
      objective: flags.objective ?? null,
      featureKey: flags["feature-id"] ?? null,
      wait: flags.wait === true,
      timeout: flags.timeout ?? "180000",
      interval: flags.interval ?? "1500",
      noMonitor: flags["no-monitor"] === true,
      stub: flags.stub === true,
      launcher: flags.launcher ?? null,
      by: flags.by ?? "operator",
      source: flags.source ?? "cli",
    });
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "proposal-rework") {
    if (!flags.proposal) {
      throw new Error("use proposal-rework --proposal <id>");
    }
    const detail = await reworkProposalArtifact(flags.proposal, {
      rationale: flags.rationale ?? flags.comments ?? flags.reason ?? "",
      title: flags.title ?? null,
      goal: flags.goal ?? null,
      source: flags.source ?? "cli",
      by: flags.by ?? "operator",
    });
    if (!detail) {
      throw new Error(`proposal artifact not found: ${flags.proposal}`);
    }
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
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
      stepHardTimeoutMs: flags["step-hard-timeout"] ?? null,
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "review") {
    if (!flags.execution || !flags.status) {
      throw new Error(
        "use review --execution <id> --status <approved|changes_requested|rejected>",
      );
    }
    const detail = await recordReviewDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? "",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "review-tree") {
    if (!flags.execution || !flags.status) {
      throw new Error(
        "use review-tree --execution <id> --status <approved|changes_requested|rejected>",
      );
    }
    const result = await applyExecutionTreeGovernance(
      flags.execution,
      "review",
      {
        status: flags.status,
        scope: flags.scope ?? "all-pending",
        decidedBy: flags.by ?? "operator",
        comments: flags.comments ?? "",
      },
    );
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "approve") {
    if (!flags.execution || !flags.status) {
      throw new Error(
        "use approve --execution <id> --status <approved|rejected>",
      );
    }
    const detail = await recordApprovalDecision(flags.execution, {
      status: flags.status,
      decidedBy: flags.by ?? "operator",
      comments: flags.comments ?? "",
    });
    console.log(JSON.stringify({ ok: true, detail }, null, 2));
    return;
  }

  if (command === "approve-tree") {
    if (!flags.execution || !flags.status) {
      throw new Error(
        "use approve-tree --execution <id> --status <approved|rejected>",
      );
    }
    const result = await applyExecutionTreeGovernance(
      flags.execution,
      "approval",
      {
        status: flags.status,
        scope: flags.scope ?? "all-pending",
        decidedBy: flags.by ?? "operator",
        comments: flags.comments ?? "",
      },
    );
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "resolve-escalation") {
    if (!flags.execution || !flags.escalation) {
      throw new Error(
        "use resolve-escalation --execution <id> --escalation <id> [--resume]",
      );
    }
    const detail = resolveExecutionEscalation(
      flags.execution,
      flags.escalation,
      {
        decidedBy: flags.by ?? "operator",
        comments: flags.comments ?? "",
        resume: flags.resume === true,
      },
    );
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
      timeoutMs: flags["timeout-ms"] ?? null,
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
      timeoutMs: flags["timeout-ms"] ?? null,
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
      timeoutMs: flags["timeout-ms"] ?? null,
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
      timeoutMs: flags["timeout-ms"] ?? null,
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
      comments: flags.comments ?? "",
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
      comments: flags.comments ?? "",
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  throw new Error(
    `unknown command: ${command}. commands: plan | invoke | project-plan | project-invoke | promotion-plan | promotion-invoke | list | show | children | tree | groups | group | events | escalations | audit | history | policy-diff | execution-workspaces | run-center | scenario-* | regression-* | self-build-* | self-build-loop-* | self-build-overrides* | self-build-policy-recommendation-* | self-build-decisions | self-build-learnings | self-build-learning-trends | self-build-policy-recommendations | self-build-doc-suggestions | self-build-intake* | self-build-quarantine | self-build-rollback | self-build-quarantine-release | work-item-* | work-item-group-* | goal-plan-* | doc-suggestion-* | proposal-* | integration-branch-* | workspace-* | drive | drive-tree | drive-group | fork | spawn-branches | pause | pause-tree | hold | hold-tree | resume | resume-tree | review | review-tree | approve | approve-tree | resolve-escalation`,
  );
}

main().catch((error) => {
  console.error(`spore-orchestrator error: ${error.message}`);
  process.exitCode = 1;
});
