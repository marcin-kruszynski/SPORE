// biome-ignore-all lint/suspicious/noExplicitAny: execution orchestration bridges additive SQLite rows and runtime payloads whose exact shape is workflow-dependent.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { buildTsxEntrypointArgs } from "@spore/core";
import {
  appendControlMessage,
  readControlMessagesFromOffset,
} from "@spore/runtime-pi";
import {
  DEFAULT_SESSION_DB_PATH,
  getSession,
  openSessionDatabase,
} from "@spore/session-manager";
import {
  buildWorkspaceBranchName,
  buildWorkspaceSnapshotRef,
  createWorkspace,
  createWorkspaceFromSnapshot,
  inspectWorkspace,
  publishWorkspaceSnapshot,
  removeWorkspace,
} from "@spore/workspace-manager";
import {
  planFeaturePromotion,
  planProjectCoordination,
  planWorkflowInvocation,
} from "../invocation/plan-workflow-invocation.js";
import {
  createApprovalRecord,
  createAuditRecord,
  createEscalationRecord,
  createExecutionRecord,
  createReviewRecord,
  createStepRecord,
  createWorkflowEventRecord,
  transitionEscalationRecord,
  transitionExecutionRecord,
  transitionStepRecord,
} from "../lifecycle/execution-lifecycle.js";
import {
  DEFAULT_ORCHESTRATOR_DB_PATH,
  PROJECT_ROOT,
} from "../metadata/constants.js";
import {
  getRegressionDefinition,
  getScenarioDefinition,
  listRegressionDefinitions,
  listScenarioDefinitions,
} from "../scenarios/catalog.js";
import {
  getEscalation,
  getExecution,
  getStep,
  getWorkspaceAllocationByRunId,
  getWorkspaceAllocationByStepId,
  insertApproval,
  insertAuditRecord,
  insertEscalation,
  insertExecutionWithSteps,
  insertReview,
  insertWorkflowEvent,
  insertWorkspaceAllocation,
  listApprovals,
  listAuditRecords,
  listChildExecutions,
  listEscalations,
  listExecutionGroup,
  listExecutions,
  listProposalArtifacts,
  listRegressionRunItems,
  listRegressionRuns,
  listReviews,
  listScenarioRunExecutions,
  listScenarioRuns,
  listSteps,
  listWorkflowEvents,
  listWorkspaceAllocations,
  openOrchestratorDatabase,
  updateEscalation,
  updateExecution,
  updateStep,
  updateWorkspaceAllocation,
} from "../store/execution-store.js";
import { writeExecutionBrief } from "./brief.js";
import {
  type AuditEventOptions,
  asEventPayload,
  buildAuditContext,
  buildEscalationEventPayload,
  normalizePromotionSummary,
  type WorkflowEventOptions,
} from "./event-payloads.js";
import {
  buildPromotionPolicySummary,
  decorateExecution,
  defaultEscalationTargetRole,
  deriveParentHoldReason,
  getExecutionProjectRole,
  getExecutionTopologyKind,
  getPromotionSummary,
  shouldDeferImmediateParentHold,
} from "./execution-metadata.js";
import { comparePolicies } from "./policy-diff.js";
import {
  findBlockedWave,
  getActiveSteps,
  getNextLaunchableSteps,
  getStepAgeMs,
  getStepPolicy,
  getStepWave,
  getWaveAgeMs,
  getWaveGate,
  getWavePolicy,
  getWaveSteps,
  hasPlannedSteps,
  isWaveSatisfied,
  summarizeStepStates as summarizeWaveStepStates,
} from "./wave-state.js";

type LooseRecord = any;

const DEFAULT_STEP_SOFT_TIMEOUT_MS = 20_000;
const DEFAULT_STEP_HARD_TIMEOUT_MS = 45_000;
const SETTLED_EXECUTION_STATES = [
  "waiting_review",
  "waiting_approval",
  "completed",
  "failed",
  "rejected",
  "canceled",
  "paused",
  "held",
];
const TERMINAL_EXECUTION_STATES = new Set([
  "completed",
  "failed",
  "rejected",
  "canceled",
]);
const GOVERNANCE_EXECUTION_STATES = new Set([
  "waiting_review",
  "waiting_approval",
]);
const ACTIVE_STEP_STATES = new Set(["active", "launching"]);
const WAVE_SUCCESS_STEP_STATES = new Set(["completed"]);

function runCli(command, args) {
  return new Promise((resolve, reject) => {
    const invocation =
      command === "node" || command === process.execPath
        ? {
            command: process.execPath,
            args: buildTsxEntrypointArgs(args[0], args.slice(1)),
          }
        : { command, args };

    const child = spawn(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
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
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(stderr || stdout || `command failed: ${command}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withOrchestratorDatabase(dbPath, fn) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withSessionDatabase(dbPath, fn) {
  const db = openSessionDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function isSessionDatabaseLocked(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("database is locked");
}

async function readSessionWithRetry(
  dbPath,
  sessionId,
  attempts = 5,
  delayMs = 100,
) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return withSessionDatabase(dbPath, (db) => getSession(db, sessionId));
    } catch (error) {
      if (!isSessionDatabaseLocked(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  throw (
    lastError ??
    new Error(`session database remained locked for session ${sessionId}`)
  );
}

function buildRetriedSessionId(execution, step, nextAttempt) {
  const scope = execution.domainId ?? "shared";
  return `${execution.id}-${scope}-${step.role}-${step.sequence + 1}-r${nextAttempt}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createWorkspaceAllocationId(step) {
  return `workspace-${step.id.replace(/[^a-zA-Z0-9._-]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildStepWorkspaceBranchName(
  execution,
  step,
  ownerType = "execution-step",
) {
  return buildWorkspaceBranchName({
    projectId: execution.projectId ?? "default",
    ownerType,
    ownerId: step.id,
  });
}

function getWorkspacePolicy(step, execution) {
  const workspacePolicy =
    getStepPolicy(step)?.runtimePolicy?.workspace ??
    getExecutionPolicy(execution)?.runtimePolicy?.workspace ??
    null;
  if (!workspacePolicy?.enabled) {
    return null;
  }
  const enabledRoles = Array.isArray(workspacePolicy.enabledRoles)
    ? workspacePolicy.enabledRoles.filter(Boolean)
    : [];
  if (enabledRoles.length > 0 && !enabledRoles.includes(step.role)) {
    return null;
  }
  const disabledRoles = Array.isArray(workspacePolicy.disabledRoles)
    ? workspacePolicy.disabledRoles.filter(Boolean)
    : [];
  if (disabledRoles.includes(step.role)) {
    return null;
  }
  return workspacePolicy;
}

function getWorkspaceRepoRoot() {
  return process.env.SPORE_WORKSPACE_REPO_ROOT
    ? path.resolve(process.env.SPORE_WORKSPACE_REPO_ROOT)
    : PROJECT_ROOT;
}

function getWorkspaceRoot() {
  return process.env.SPORE_WORKTREE_ROOT
    ? path.resolve(process.env.SPORE_WORKTREE_ROOT)
    : null;
}

function getAuthoringWorkspacePurpose(step) {
  if (step.role === "builder") {
    return "authoring";
  }
  if (step.role === "integrator") {
    return "integration";
  }
  if (step.role === "tester") {
    return "verification";
  }
  return "general";
}

function findNearestPriorStepByRole(steps, step, role) {
  return (
    [...steps]
      .filter(
        (candidate) =>
          candidate.sequence < step.sequence && candidate.role === role,
      )
      .sort((left, right) => right.sequence - left.sequence)[0] ?? null
  );
}

function getWorkspaceHandoffMetadata(workspace) {
  return workspace?.metadata?.handoff ?? null;
}

function canUseExistingVerificationWorkspace(
  existingWorkspace,
  sourceWorkspace,
) {
  if (!existingWorkspace || !sourceWorkspace) {
    return false;
  }
  const existingHandoff = existingWorkspace.metadata?.handoff ?? {};
  const sourceHandoff = getWorkspaceHandoffMetadata(sourceWorkspace) ?? {};
  return (
    existingWorkspace.metadata?.workspacePurpose === "verification" &&
    existingWorkspace.metadata?.sourceWorkspaceId === sourceWorkspace.id &&
    Boolean(existingHandoff.snapshotCommit) &&
    existingHandoff.snapshotCommit === sourceHandoff.snapshotCommit
  );
}

async function ensureStepWorkspace(db, execution, step) {
  const workspacePolicy = getWorkspacePolicy(step, execution);
  if (!workspacePolicy?.enabled) {
    return null;
  }

  const existing = getWorkspaceAllocationByStepId(db, step.id);
  const steps = listSteps(db, execution.id);
  if (step.role === "tester") {
    const sourceStep = findNearestPriorStepByRole(steps, step, "builder");
    if (!sourceStep) {
      throw new Error(`tester step ${step.id} requires a prior builder step`);
    }
    const sourceWorkspace = getWorkspaceAllocationByStepId(db, sourceStep.id);
    const sourceHandoff = getWorkspaceHandoffMetadata(sourceWorkspace);
    if (!sourceWorkspace || !sourceHandoff?.snapshotCommit) {
      throw new Error(
        `tester step ${step.id} requires a builder handoff snapshot before verification can start`,
      );
    }
    if (
      existing &&
      canUseExistingVerificationWorkspace(existing, sourceWorkspace)
    ) {
      return existing;
    }
    if (existing) {
      try {
        await removeWorkspace({
          repoRoot: existing.metadata?.repoRoot ?? getWorkspaceRepoRoot(),
          worktreePath: existing.worktreePath,
          branchName: existing.branchName,
          force: true,
        });
      } catch {
        // best-effort cleanup before re-provisioning a verification workspace
      }
      updateWorkspaceAllocation(db, {
        ...existing,
        status: "cleaned",
        updatedAt: nowIso(),
        cleanedAt: nowIso(),
        metadata: {
          ...existing.metadata,
          cleanupReason: "reprovision-verification-workspace",
        },
      });
    }

    const now = nowIso();
    const repoRoot = workspacePolicy.repoRoot
      ? path.resolve(workspacePolicy.repoRoot)
      : getWorkspaceRepoRoot();
    const worktreeRoot = workspacePolicy.worktreeRoot
      ? path.resolve(workspacePolicy.worktreeRoot)
      : getWorkspaceRoot();
    const mutationScope = Array.isArray(sourceWorkspace.mutationScope)
      ? sourceWorkspace.mutationScope
      : [];
    const pending = {
      id: workspacePolicy.workspaceId ?? createWorkspaceAllocationId(step),
      projectId: execution.projectId,
      ownerType: "execution-step",
      ownerId: step.id,
      executionId: execution.id,
      stepId: step.id,
      workItemId:
        workspacePolicy.workItemId ?? sourceWorkspace.workItemId ?? null,
      workItemRunId:
        workspacePolicy.workItemRunId ?? sourceWorkspace.workItemRunId ?? null,
      proposalArtifactId:
        workspacePolicy.proposalArtifactId ??
        sourceWorkspace.proposalArtifactId ??
        null,
      worktreePath: path.join(
        repoRoot,
        ".spore",
        "worktrees",
        execution.projectId ?? "spore",
        `${step.id}-verification-pending`,
      ),
      branchName:
        workspacePolicy.branchName ??
        buildStepWorkspaceBranchName(
          execution,
          step,
          "execution-step-verification",
        ),
      baseRef:
        sourceHandoff.snapshotCommit ??
        sourceHandoff.snapshotRef ??
        workspacePolicy.baseRef ??
        "HEAD",
      integrationBranch:
        workspacePolicy.integrationBranch ??
        sourceWorkspace.integrationBranch ??
        null,
      mode: "git-worktree",
      safeMode:
        sourceWorkspace.safeMode !== false &&
        workspacePolicy.safeMode !== false,
      mutationScope,
      status: "provisioning",
      metadata: {
        repoRoot,
        source: workspacePolicy.source ?? "builder-handoff",
        workspacePurpose: "verification",
        sourceWorkspaceId: sourceWorkspace.id,
        sourceStepId: sourceStep.id,
        sourceRef: sourceHandoff.snapshotRef ?? null,
        sourceCommit: sourceHandoff.snapshotCommit ?? null,
        verificationForStepId: sourceStep.id,
        handoffStatus: "ready",
      },
      createdAt: now,
      updatedAt: now,
      cleanedAt: null,
    };
    insertWorkspaceAllocation(db, pending);

    try {
      const created = await createWorkspaceFromSnapshot({
        repoRoot,
        workspaceId: pending.id,
        projectId: pending.projectId,
        ownerType: pending.ownerType,
        ownerId: pending.ownerId,
        snapshotRef: sourceHandoff.snapshotRef ?? null,
        snapshotCommit: sourceHandoff.snapshotCommit ?? null,
        worktreeRoot,
        branchName: null,
        safeMode: pending.safeMode,
        mutationScope,
      });
      const inspected = await inspectWorkspace({
        repoRoot,
        worktreePath: created.worktreePath,
        branchName: created.branchName,
      });
      const updated = {
        ...pending,
        worktreePath: created.worktreePath,
        branchName: created.branchName,
        status: inspected.clean ? "provisioned" : "active",
        metadata: {
          ...pending.metadata,
          sourceRef: created.sourceRef ?? pending.metadata.sourceRef ?? null,
          sourceCommit:
            created.sourceCommit ?? pending.metadata.sourceCommit ?? null,
          inspection: inspected,
        },
        updatedAt: nowIso(),
      };
      updateWorkspaceAllocation(db, updated);
      return updated;
    } catch (error) {
      updateWorkspaceAllocation(db, {
        ...pending,
        status: "failed",
        updatedAt: nowIso(),
        metadata: {
          ...pending.metadata,
          error: error.message,
        },
      });
      throw error;
    }
  }

  if (existing) {
    return existing;
  }

  const now = nowIso();
  const repoRoot = workspacePolicy.repoRoot
    ? path.resolve(workspacePolicy.repoRoot)
    : getWorkspaceRepoRoot();
  const worktreeRoot = workspacePolicy.worktreeRoot
    ? path.resolve(workspacePolicy.worktreeRoot)
    : getWorkspaceRoot();
  const mutationScope = Array.isArray(workspacePolicy.mutationScope)
    ? workspacePolicy.mutationScope
    : [];

  if (workspacePolicy.worktreePath) {
    const allocation = {
      id: workspacePolicy.workspaceId ?? createWorkspaceAllocationId(step),
      projectId: execution.projectId,
      ownerType: "execution-step",
      ownerId: step.id,
      executionId: execution.id,
      stepId: step.id,
      workItemId: workspacePolicy.workItemId ?? null,
      workItemRunId: workspacePolicy.workItemRunId ?? null,
      proposalArtifactId: workspacePolicy.proposalArtifactId ?? null,
      worktreePath: path.resolve(workspacePolicy.worktreePath),
      branchName: workspacePolicy.branchName ?? null,
      baseRef: workspacePolicy.baseRef ?? "HEAD",
      integrationBranch: workspacePolicy.integrationBranch ?? null,
      mode: "git-worktree",
      safeMode: workspacePolicy.safeMode !== false,
      mutationScope,
      status: "provisioned",
      metadata: {
        repoRoot,
        source: workspacePolicy.source ?? "workflow-step",
        reusedWorkspace: true,
        linkedWorkspaceId: workspacePolicy.workspaceId ?? null,
        workspacePurpose: getAuthoringWorkspacePurpose(step),
        handoffStatus: step.role === "builder" ? "pending" : null,
      },
      createdAt: now,
      updatedAt: now,
      cleanedAt: null,
    };
    insertWorkspaceAllocation(db, allocation);
    return allocation;
  }

  const pending = {
    id: workspacePolicy.workspaceId ?? createWorkspaceAllocationId(step),
    projectId: execution.projectId,
    ownerType: "execution-step",
    ownerId: step.id,
    executionId: execution.id,
    stepId: step.id,
    workItemId: workspacePolicy.workItemId ?? null,
    workItemRunId: workspacePolicy.workItemRunId ?? null,
    proposalArtifactId: workspacePolicy.proposalArtifactId ?? null,
    worktreePath: path.join(
      repoRoot,
      ".spore",
      "worktrees",
      execution.projectId ?? "spore",
      `${step.id}-pending`,
    ),
    branchName:
      workspacePolicy.branchName ??
      buildStepWorkspaceBranchName(execution, step),
    baseRef: workspacePolicy.baseRef ?? "HEAD",
    integrationBranch: workspacePolicy.integrationBranch ?? null,
    mode: "git-worktree",
    safeMode: workspacePolicy.safeMode !== false,
    mutationScope,
    status: "provisioning",
    metadata: {
      repoRoot,
      source: workspacePolicy.source ?? "workflow-step",
      workspacePurpose: getAuthoringWorkspacePurpose(step),
      handoffStatus: step.role === "builder" ? "pending" : null,
    },
    createdAt: now,
    updatedAt: now,
    cleanedAt: null,
  };
  insertWorkspaceAllocation(db, pending);

  try {
    const created = await createWorkspace({
      repoRoot,
      workspaceId: pending.id,
      projectId: pending.projectId,
      ownerType: pending.ownerType,
      ownerId: pending.ownerId,
      baseRef: pending.baseRef,
      worktreeRoot,
      branchName: pending.branchName,
      safeMode: pending.safeMode,
      mutationScope,
    });
    const inspected = await inspectWorkspace({
      repoRoot,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
    });
    const updated = {
      ...pending,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      status: inspected.clean ? "provisioned" : "active",
      metadata: {
        ...pending.metadata,
        inspection: inspected,
      },
      updatedAt: nowIso(),
    };
    updateWorkspaceAllocation(db, updated);
    return updated;
  } catch (error) {
    const failed = {
      ...pending,
      status: "failed",
      metadata: {
        ...pending.metadata,
        error: error.message,
      },
      updatedAt: nowIso(),
    };
    updateWorkspaceAllocation(db, failed);
    throw error;
  }
}

function settleStepWorkspace(db, step, nextStatus, metadata: LooseRecord = {}) {
  const workspace = getWorkspaceAllocationByStepId(db, step.id);
  if (!workspace) {
    return null;
  }
  const updated = {
    ...workspace,
    status: nextStatus,
    updatedAt: nowIso(),
    metadata: {
      ...workspace.metadata,
      ...metadata,
      settledAt: metadata.settledAt ?? nowIso(),
    },
  };
  updateWorkspaceAllocation(db, updated);
  return updated;
}

async function publishBuilderWorkspaceHandoff(db, execution, step) {
  if (step.role !== "builder") {
    return null;
  }
  const workspace = getWorkspaceAllocationByStepId(db, step.id);
  if (!workspace?.worktreePath) {
    return null;
  }

  const snapshotRef = buildWorkspaceSnapshotRef({
    projectId: execution.projectId ?? "spore",
    executionId: execution.id,
    stepId: step.id,
    attemptCount: step.attemptCount,
  });
  const snapshot = await publishWorkspaceSnapshot({
    repoRoot: workspace.metadata?.repoRoot ?? getWorkspaceRepoRoot(),
    worktreePath: workspace.worktreePath,
    snapshotRef,
    commitMessage: `chore: publish builder handoff for ${execution.id} step ${step.sequence + 1}`,
  });
  const updatedWorkspace = {
    ...workspace,
    updatedAt: nowIso(),
    metadata: {
      ...workspace.metadata,
      workspacePurpose: workspace.metadata?.workspacePurpose ?? "authoring",
      handoffStatus: "ready",
      handoff: {
        snapshotRef: snapshot.snapshotRef,
        snapshotCommit: snapshot.snapshotCommit,
        headBefore: snapshot.headBefore,
        committed: snapshot.committed,
        dirtyEntryCount: snapshot.dirtyEntryCount,
        publishedAt: snapshot.createdAt,
        publishedForStepId: step.id,
        publishedForSessionId: step.sessionId,
      },
    },
  };
  updateWorkspaceAllocation(db, updatedWorkspace);
  if (workspace.workItemRunId) {
    const ownerWorkspace = getWorkspaceAllocationByRunId(
      db,
      workspace.workItemRunId,
    );
    if (ownerWorkspace) {
      updateWorkspaceAllocation(db, {
        ...ownerWorkspace,
        updatedAt: nowIso(),
        metadata: {
          ...ownerWorkspace.metadata,
          handoff: updatedWorkspace.metadata.handoff,
          handoffStatus: "ready",
        },
      });
    }
  }
  emitWorkflowEvent(db, {
    executionId: execution.id,
    stepId: step.id,
    sessionId: step.sessionId,
    type: "workflow.step.handoff_published",
    payload: {
      role: step.role,
      workspaceId: workspace.id,
      workspacePurpose:
        updatedWorkspace.metadata?.workspacePurpose ?? "authoring",
      snapshotRef: snapshot.snapshotRef,
      snapshotCommit: snapshot.snapshotCommit,
      committed: snapshot.committed,
      dirtyEntryCount: snapshot.dirtyEntryCount,
    },
  });
  return updatedWorkspace;
}

function emitWorkflowEvent(
  db,
  options: WorkflowEventOptions | (LooseRecord & WorkflowEventOptions),
) {
  const {
    executionId,
    stepId = null,
    sessionId = null,
    type,
    payload = {},
  } = options;
  const event = createWorkflowEventRecord({
    executionId,
    stepId,
    sessionId,
    type,
    payload: asEventPayload(payload),
  });
  insertWorkflowEvent(db, event);
  return event;
}

function emitAuditEvent(
  db,
  options: AuditEventOptions | (LooseRecord & AuditEventOptions),
) {
  const {
    executionId,
    stepId = null,
    sessionId = null,
    action,
    actor = "operator",
    source = "orchestrator",
    targetType = "execution",
    targetId = null,
    payload = {},
    result = "accepted",
  } = options;
  const record = createAuditRecord({
    executionId,
    stepId,
    sessionId,
    action,
    actor,
    source,
    targetType,
    targetId,
    payload: asEventPayload(payload),
    result,
  });
  insertAuditRecord(db, record);
  return record;
}

function parseIntegerOrNull(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function openEscalation(db, options: LooseRecord = {}) {
  const {
    execution,
    step = null,
    sourceStepId = null,
    reason,
    payload = {},
    targetRole = null,
  } = options;
  const effectiveTargetRole = defaultEscalationTargetRole(
    execution,
    targetRole,
  );
  const escalation = createEscalationRecord({
    executionId: execution.id,
    stepId: step?.id ?? null,
    sourceStepId,
    targetRole: effectiveTargetRole,
    reason,
    payload,
  });
  insertEscalation(db, escalation);
  emitWorkflowEvent(db, {
    executionId: execution.id,
    stepId: step?.id ?? null,
    sessionId: step?.sessionId ?? null,
    type: "workflow.execution.escalated",
    payload: buildEscalationEventPayload(
      String(escalation.id),
      effectiveTargetRole ? String(effectiveTargetRole) : null,
      String(reason),
      asEventPayload(payload),
    ),
  });
  if (getExecutionProjectRole(execution) === "integrator") {
    updateExecutionPromotionSummary(db, execution, {
      status: "blocked",
      blockerReason: reason,
      blockers: [
        ...asArray(getPromotionSummary(execution)?.blockers),
        {
          escalationId: escalation.id,
          reason,
          targetRole: effectiveTargetRole,
        },
      ],
    });
  }
  return escalation;
}

function scheduleRetry(step, execution, reason) {
  const nextAttempt = step.attemptCount + 1;
  return transitionStepRecord(step, "planned", {
    attemptCount: nextAttempt,
    sessionId: buildRetriedSessionId(execution, step, nextAttempt),
    lastError: reason ?? step.lastError ?? null,
    launchedAt: null,
    settledAt: null,
  });
}

function resetReviewGateStep(step, execution) {
  const nextAttempt = step.attemptCount + 1;
  return transitionStepRecord(step, "planned", {
    attemptCount: nextAttempt,
    sessionId: buildRetriedSessionId(execution, step, nextAttempt),
    reviewStatus: "pending",
    approvalStatus: step.approvalRequired ? "pending" : null,
    launchedAt: null,
    settledAt: null,
    lastError: null,
  });
}

function prepareOperatorResumeStep(
  step,
  execution,
  reason = "operator_resumed",
) {
  const nextAttempt = step.attemptCount + 1;
  return transitionStepRecord(step, "planned", {
    attemptCount: nextAttempt,
    maxAttempts: Math.max(step.maxAttempts, nextAttempt),
    sessionId: buildRetriedSessionId(execution, step, nextAttempt),
    lastError: reason,
    reviewStatus: step.reviewRequired ? "pending" : step.reviewStatus,
    approvalStatus: step.approvalRequired ? "pending" : step.approvalStatus,
    launchedAt: null,
    settledAt: null,
  });
}

function isTerminalExecutionState(state) {
  return TERMINAL_EXECUTION_STATES.has(state);
}

function _isGovernanceExecutionState(state) {
  return GOVERNANCE_EXECUTION_STATES.has(state);
}

function isExecutionDispatchBlocked(state) {
  return ["paused", "held"].includes(state);
}

function blockingChildren(children) {
  return children.filter((child) => !isTerminalExecutionState(child.state));
}

function isCoordinationHoldReason(reason) {
  return [
    "waiting_for_child_executions",
    "waiting_for_project_leads",
    "waiting_for_feature_promotion",
  ].includes(reason);
}

function updateExecutionPromotionSummary(db, execution, updates = {}) {
  const currentPromotion = normalizePromotionSummary(
    getPromotionSummary(execution) ?? {},
  );
  const nextPromotion = {
    ...currentPromotion,
    ...updates,
  };
  const nextExecution = updateExecutionMetadataRecord(db, execution, {
    promotion: nextPromotion,
  });
  return {
    execution: nextExecution,
    promotion: nextPromotion,
  };
}

function holdExecutionRecord(execution, reason, nextState = "held") {
  return transitionExecutionRecord(execution, nextState, {
    heldFromState:
      nextState === "held"
        ? execution.state === "held"
          ? execution.heldFromState
          : execution.state
        : execution.heldFromState,
    holdReason: reason,
    holdOwner: execution.holdOwner,
    holdGuidance: execution.holdGuidance,
    holdExpiresAt: execution.holdExpiresAt,
    pausedAt: nextState === "paused" ? new Date().toISOString() : null,
    heldAt: nextState === "held" ? new Date().toISOString() : execution.heldAt,
    resumedAt: execution.resumedAt,
  });
}

function resumeExecutionRecord(execution) {
  const resumedState = execution.heldFromState ?? "running";
  return transitionExecutionRecord(execution, resumedState, {
    heldFromState: null,
    holdReason: null,
    holdOwner: null,
    holdGuidance: null,
    holdExpiresAt: null,
    pausedAt: null,
    heldAt: null,
    resumedAt: new Date().toISOString(),
    endedAt: null,
  });
}

function getExecutionPolicy(execution) {
  return execution?.policy ?? {};
}

function resolveWatchdogThreshold(options, execution, step, key, fallback) {
  return Number.parseInt(
    String(
      options[key] ??
        getStepPolicy(step)?.workflowPolicy?.[key] ??
        getExecutionPolicy(execution)?.workflowPolicy?.[key] ??
        fallback,
    ),
    10,
  );
}

function buildHoldMetadata(
  execution,
  payload: LooseRecord = {},
  nextState = "held",
) {
  const timeoutMs = payload.timeoutMs
    ? Number.parseInt(String(payload.timeoutMs), 10)
    : null;
  const now = Date.now();
  return {
    heldFromState: execution.state,
    holdReason:
      payload.reason ??
      (nextState === "paused" ? "execution paused" : "operator hold"),
    holdOwner: payload.owner ?? payload.decidedBy ?? "operator",
    holdGuidance: payload.guidance ?? payload.comments ?? null,
    holdExpiresAt:
      timeoutMs && timeoutMs > 0
        ? new Date(now + timeoutMs).toISOString()
        : null,
    pausedAt: nextState === "paused" ? new Date(now).toISOString() : null,
    heldAt:
      nextState === "held" ? new Date(now).toISOString() : execution.heldAt,
    endedAt: null,
  };
}

function hasExpiredHold(execution) {
  if (!execution?.holdExpiresAt || execution.state !== "held") {
    return false;
  }
  const expiresAt = Date.parse(execution.holdExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function selectRetryTargetStep(steps, gateStep, execution) {
  const preferredRole =
    getExecutionPolicy(execution)?.workflowPolicy?.retryTargetRole ?? null;
  const eligible = [...steps]
    .filter((step) => step.sequence < gateStep.sequence && !step.reviewRequired)
    .reverse();
  if (preferredRole) {
    const preferred = eligible.find((step) => step.role === preferredRole);
    if (preferred) {
      return preferred;
    }
  }
  return eligible.find(Boolean) ?? null;
}

function shouldBranchRework(execution) {
  return (
    getExecutionPolicy(execution)?.workflowPolicy?.reworkStrategy === "branch"
  );
}

function deriveReworkRoles(steps, retryTarget, gateStep, execution) {
  const explicitRoles =
    getExecutionPolicy(execution)?.workflowPolicy?.reworkRoles ?? [];
  if (Array.isArray(explicitRoles) && explicitRoles.length > 0) {
    return explicitRoles;
  }
  return steps
    .filter(
      (step) =>
        step.sequence >= retryTarget.sequence &&
        step.sequence <= gateStep.sequence,
    )
    .map((step) => step.role)
    .filter(Boolean);
}

async function branchForRework(
  execution,
  gateStep,
  retryTarget,
  payload: LooseRecord = {},
  options: LooseRecord = {},
) {
  const branchRoles = deriveReworkRoles(
    options.steps ?? [],
    retryTarget,
    gateStep,
    execution,
  );
  if (branchRoles.length === 0) {
    throw new Error(
      `cannot derive rework roles for execution: ${execution.id}`,
    );
  }
  const objectiveSuffix = payload.comments
    ? ` Rework request: ${payload.comments}`
    : "";
  return branchExecution(
    execution.id,
    {
      workflowPath: execution.workflowPath,
      projectPath: execution.projectPath,
      domainId: execution.domainId ?? null,
      roles: branchRoles,
      invocationId: `${execution.id}-rework-${Date.now()}`,
      objective: `${execution.objective}${objectiveSuffix}`.trim(),
      branchKey: `${gateStep.role}-rework-${Date.now()}`,
    },
    options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH,
    options.sessionDbPath ?? DEFAULT_SESSION_DB_PATH,
  );
}

function resetDependentSteps(steps, execution, retryTarget, gateStep, reason) {
  const resetDescendants =
    getExecutionPolicy(execution)?.workflowPolicy?.resetDescendantSteps ??
    false;
  if (!resetDescendants) {
    return [];
  }
  return steps
    .filter(
      (step) =>
        step.sequence > retryTarget.sequence &&
        step.sequence < gateStep.sequence &&
        !step.reviewRequired,
    )
    .map((step) => {
      const nextAttempt = step.attemptCount + 1;
      return transitionStepRecord(step, "planned", {
        attemptCount: nextAttempt,
        maxAttempts: Math.max(step.maxAttempts, nextAttempt),
        sessionId: buildRetriedSessionId(execution, step, nextAttempt),
        lastError: reason,
        reviewStatus: step.reviewRequired ? "pending" : step.reviewStatus,
        approvalStatus: step.approvalRequired ? "pending" : step.approvalStatus,
        launchedAt: null,
        settledAt: null,
      });
    });
}

async function hasControlAction(sessionId, action, source = "orchestrator") {
  const chunk = await readControlMessagesFromOffset(sessionId, 0);
  return chunk.entries.some(
    (entry) =>
      entry?.payload?.action === action && entry?.payload?.source === source,
  );
}

async function applyActiveStepWatchdog(
  execution,
  step,
  session,
  options: LooseRecord = {},
) {
  if (!session || session.state !== "active") {
    return null;
  }

  const softTimeoutMs = resolveWatchdogThreshold(
    options,
    execution,
    step,
    "stepSoftTimeoutMs",
    DEFAULT_STEP_SOFT_TIMEOUT_MS,
  );
  const hardTimeoutMs = resolveWatchdogThreshold(
    options,
    execution,
    step,
    "stepHardTimeoutMs",
    DEFAULT_STEP_HARD_TIMEOUT_MS,
  );
  const ageMs = getStepAgeMs(step);

  if (ageMs >= hardTimeoutMs) {
    const alreadyRequested = await hasControlAction(session.id, "abort");
    if (!alreadyRequested) {
      const record = await appendControlMessage(session.id, {
        action: "abort",
        source: "orchestrator",
        reason: "step hard timeout",
        executionId: step.executionId,
        stepId: step.id,
        stepSequence: step.sequence,
        role: step.role,
        ageMs,
      });
      return {
        kind: "hard-timeout-abort",
        ageMs,
        control: record,
      };
    }
    return {
      kind: "hard-timeout-pending",
      ageMs,
    };
  }

  if (ageMs >= softTimeoutMs) {
    const alreadyRequested = await hasControlAction(session.id, "steer");
    if (!alreadyRequested) {
      const record = await appendControlMessage(session.id, {
        action: "steer",
        source: "orchestrator",
        message:
          "Return the requested deliverable now in its final form. Do not perform more diagnostics or extra tool calls. End immediately after the deliverable.",
        executionId: step.executionId,
        stepId: step.id,
        stepSequence: step.sequence,
        role: step.role,
        ageMs,
      });
      return {
        kind: "soft-timeout-steer",
        ageMs,
        control: record,
      };
    }
  }

  return null;
}

function applyWavePolicy(db, execution, steps, wave) {
  const waveSteps = getWaveSteps(steps, wave);
  if (waveSteps.length === 0) {
    return null;
  }
  const wavePolicy = getWavePolicy(steps, wave);
  const maxActiveMs = parseIntegerOrNull(wavePolicy.maxActiveMs);
  if (!maxActiveMs) {
    return null;
  }
  const activeWaveSteps = waveSteps.filter((step) =>
    ACTIVE_STEP_STATES.has(step.state),
  );
  if (activeWaveSteps.length === 0) {
    return null;
  }
  const ageMs = getWaveAgeMs(steps, wave);
  if (ageMs < maxActiveMs) {
    return null;
  }

  const reason = "wave-timeout";
  const existingEscalation = listEscalations(db, execution.id).some(
    (item) =>
      item.status === "open" &&
      item.reason === reason &&
      Number(item.payload?.wave ?? -1) === wave,
  );
  emitWorkflowEvent(db, {
    executionId: execution.id,
    type: "workflow.wave.timed_out",
    payload: {
      wave,
      waveName: waveSteps[0]?.waveName ?? null,
      ageMs,
      maxActiveMs,
    },
  });

  const action = wavePolicy.onTimeout ?? "open_escalation";
  if (
    ["open_escalation", "hold_execution"].includes(action) &&
    !existingEscalation
  ) {
    openEscalation(db, {
      execution,
      step: activeWaveSteps[0],
      sourceStepId: activeWaveSteps[0]?.id ?? null,
      reason,
      payload: {
        wave,
        waveName: waveSteps[0]?.waveName ?? null,
        ageMs,
        maxActiveMs,
        policy: wavePolicy,
      },
    });
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.wave.escalated",
      payload: {
        wave,
        waveName: waveSteps[0]?.waveName ?? null,
        reason,
        ageMs,
      },
    });
  }

  if (
    action === "hold_execution" ||
    wavePolicy.blockNextWaveOnOpenEscalation === true
  ) {
    const heldExecution = holdExecutionRecord(
      execution,
      `wave-${wave}-blocked`,
    );
    updateExecution(db, heldExecution);
    return heldExecution;
  }

  if (action === "fail_execution") {
    const failedExecution = transitionExecutionRecord(execution, "failed", {
      currentStepIndex:
        activeWaveSteps[0]?.sequence ?? execution.currentStepIndex,
    });
    updateExecution(db, failedExecution);
    return failedExecution;
  }

  return null;
}

export function createExecution(
  invocation,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const existing = getExecution(db, invocation.invocationId);
    if (existing) {
      throw new Error(`execution already exists: ${invocation.invocationId}`);
    }
    const execution = createExecutionRecord(invocation);
    const steps = invocation.launches.map((launch, index) =>
      createStepRecord(execution.id, launch, index),
    );
    insertExecutionWithSteps(db, execution, steps);
    if (execution.parentExecutionId) {
      const parentExecution = getExecution(db, execution.parentExecutionId);
      if (
        parentExecution &&
        !isTerminalExecutionState(parentExecution.state) &&
        !shouldDeferImmediateParentHold(parentExecution, execution)
      ) {
        const holdReason = deriveParentHoldReason(parentExecution, execution);
        const heldParent = holdExecutionRecord(parentExecution, holdReason);
        updateExecution(db, heldParent);
        emitWorkflowEvent(db, {
          executionId: parentExecution.id,
          type: "workflow.execution.held",
          payload: {
            reason: holdReason,
            coordinationGroupId: execution.coordinationGroupId,
            childExecutionId: execution.id,
            childProjectRole: getExecutionProjectRole(execution),
            childTopologyKind: getExecutionTopologyKind(execution),
          },
        });
      }
    }
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.created",
      payload: {
        workflowId: execution.workflowId,
        projectId: execution.projectId,
        domainId: execution.domainId,
        objective: execution.objective,
        coordinationGroupId: execution.coordinationGroupId,
        parentExecutionId: execution.parentExecutionId,
        branchKey: execution.branchKey,
        policy: execution.policy ?? {},
        metadata: execution.metadata ?? {},
      },
    });
    for (const step of steps) {
      emitWorkflowEvent(db, {
        executionId: execution.id,
        stepId: step.id,
        sessionId: step.sessionId,
        type: "workflow.step.planned",
        payload: {
          sequence: step.sequence,
          wave: step.wave ?? step.sequence,
          waveName: step.waveName ?? null,
          role: step.role,
          requestedProfileId: step.requestedProfileId,
          sessionMode: step.sessionMode,
          attemptCount: step.attemptCount,
          maxAttempts: step.maxAttempts,
          policy: step.policy ?? {},
          executionMetadata: execution.metadata ?? {},
        },
      });
    }
    return { execution: decorateExecution(execution), steps };
  });
}

export function getExecutionDetail(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    const steps = listSteps(db, executionId);
    const reviews = listReviews(db, executionId);
    const approvals = listApprovals(db, executionId);
    const events = listWorkflowEvents(db, executionId);
    const escalations = listEscalations(db, executionId);
    const audit = listAuditRecords(db, executionId);
    const childExecutions = listChildExecutions(db, executionId);
    const coordinationGroup = execution.coordinationGroupId
      ? listExecutionGroup(db, execution.coordinationGroupId)
      : [execution];
    let sessions = [];
    try {
      sessions = withSessionDatabase(sessionDbPath, (sessionDb) =>
        steps
          .filter((step) => step.sessionId)
          .map((step) => ({
            sessionId: step.sessionId,
            session: getSession(sessionDb, step.sessionId),
          }))
          .filter((item) => item.session),
      );
    } catch (error) {
      if (!isSessionDatabaseLocked(error)) {
        throw error;
      }
    }
    return {
      execution: decorateExecution(execution),
      steps,
      reviews,
      approvals,
      events,
      escalations,
      audit,
      childExecutions: childExecutions.map(decorateExecution),
      coordinationGroup: coordinationGroup.map(decorateExecution),
      sessions,
    };
  });
}

export function listExecutionEvents(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listWorkflowEvents(db, executionId);
  });
}

export function listExecutionEscalations(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listEscalations(db, executionId);
  });
}

export function listExecutionAudit(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listAuditRecords(db, executionId);
  });
}

function buildPolicyDiff(baseline = {}, candidate = {}) {
  const diff = comparePolicies(baseline, candidate);
  return [
    ...diff.changed.map((entry) => ({
      path: entry.key,
      baseline: entry.baseline,
      candidate: entry.candidate,
      tone: "changed",
    })),
    ...diff.candidateOnly.map((entry) => ({
      path: entry.key,
      baseline: null,
      candidate: entry.candidate,
      tone: "added",
    })),
    ...diff.baselineOnly.map((entry) => ({
      path: entry.key,
      baseline: entry.baseline,
      candidate: null,
      tone: "removed",
    })),
  ];
}

export async function getExecutionPolicyDiff(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    return null;
  }

  const execution = detail.execution;
  const roles = detail.steps.map((step) => step.role);
  let planned = null;
  if (
    getExecutionProjectRole(execution) === "coordinator" &&
    getExecutionTopologyKind(execution) === "project-root"
  ) {
    planned = await planProjectCoordination({
      projectPath: execution.projectPath,
      domains: asArray(execution.metadata?.selectedDomains),
      objective: execution.objective,
      invocationId: execution.id,
      coordinationGroupId: execution.coordinationGroupId ?? execution.id,
      metadata: execution.metadata ?? {},
    });
  } else if (getExecutionProjectRole(execution) === "integrator") {
    planned = await planFeaturePromotion({
      projectPath: execution.projectPath,
      objective: execution.objective,
      invocationId: execution.id,
      coordinationGroupId: execution.coordinationGroupId,
      parentExecutionId: execution.parentExecutionId,
      branchKey: execution.branchKey,
      targetBranch:
        execution.metadata?.targetBranch ??
        execution.metadata?.promotion?.targetBranch ??
        null,
      sourceSummary:
        execution.metadata?.sourceSummary ??
        execution.metadata?.promotion?.sourceSummary ??
        null,
      metadata: execution.metadata ?? {},
    });
  } else {
    planned = await planWorkflowInvocation({
      workflowPath: execution.workflowPath,
      projectPath: execution.projectPath,
      domainId: execution.domainId,
      roles,
      maxRoles: roles.length,
      objective: execution.objective,
      coordinationGroupId: execution.coordinationGroupId,
      parentExecutionId: execution.parentExecutionId,
      branchKey: execution.branchKey,
      metadata: execution.metadata ?? {},
    });
  }

  const persistedPolicy = execution.policy ?? {};
  return {
    executionId,
    plannedEffectivePolicy: planned.effectivePolicy ?? {},
    persistedExecutionPolicy: persistedPolicy,
    executionVsPlan: buildPolicyDiff(
      planned.effectivePolicy ?? {},
      persistedPolicy,
    ),
    steps: detail.steps.map((step) => ({
      stepId: step.id,
      sequence: step.sequence,
      wave: step.wave ?? step.sequence,
      waveName: step.waveName ?? null,
      role: step.role,
      sessionMode: step.sessionMode ?? null,
      policy: step.policy ?? {},
      diffVsExecution: buildPolicyDiff(persistedPolicy, step.policy ?? {}),
      diffVsPlan: buildPolicyDiff(
        planned.effectivePolicy ?? {},
        step.policy ?? {},
      ),
    })),
  };
}

function orderedTimeline(items) {
  return [...items].sort((left, right) => {
    const leftTime =
      Date.parse(
        left.timestamp ??
          left.createdAt ??
          left.decidedAt ??
          left.updatedAt ??
          0,
      ) || 0;
    const rightTime =
      Date.parse(
        right.timestamp ??
          right.createdAt ??
          right.decidedAt ??
          right.updatedAt ??
          0,
      ) || 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

function buildExecutionHistoryItems(detail, policyDiff) {
  const items = [];
  if (detail.execution?.promotion) {
    items.push({
      id: `promotion:${detail.execution.id}`,
      kind: "promotion",
      timestamp: detail.execution.updatedAt ?? detail.execution.createdAt,
      executionId: detail.execution.id,
      stepId: null,
      sessionId: null,
      label: `promotion:${detail.execution.promotion.status ?? "unknown"}`,
      payload: detail.execution.promotion,
    });
  }
  for (const event of detail.events ?? []) {
    items.push({
      id: event.id,
      kind: "workflow-event",
      timestamp: event.createdAt,
      executionId: event.executionId,
      stepId: event.stepId,
      sessionId: event.sessionId,
      label: event.type,
      payload: event.payload ?? {},
    });
  }
  for (const review of detail.reviews ?? []) {
    items.push({
      id: review.id,
      kind: "review",
      timestamp: review.decidedAt ?? review.createdAt,
      executionId: review.executionId,
      stepId: review.stepId,
      label: `review:${review.status}`,
      payload: review,
    });
  }
  for (const approval of detail.approvals ?? []) {
    items.push({
      id: approval.id,
      kind: "approval",
      timestamp: approval.decidedAt ?? approval.createdAt,
      executionId: approval.executionId,
      stepId: approval.stepId,
      label: `approval:${approval.status}`,
      payload: approval,
    });
  }
  for (const escalation of detail.escalations ?? []) {
    items.push({
      id: escalation.id,
      kind: "escalation",
      timestamp: escalation.updatedAt ?? escalation.createdAt,
      executionId: escalation.executionId,
      stepId: escalation.stepId,
      label: `escalation:${escalation.status}`,
      payload: escalation,
    });
  }
  for (const audit of detail.audit ?? []) {
    items.push({
      id: audit.id,
      kind: "audit",
      timestamp: audit.createdAt,
      executionId: audit.executionId,
      stepId: audit.stepId,
      sessionId: audit.sessionId,
      label: audit.action,
      payload: audit,
    });
  }
  for (const step of policyDiff?.steps ?? []) {
    if (step.diffVsExecution.length === 0 && step.diffVsPlan.length === 0) {
      continue;
    }
    items.push({
      id: `policy-${step.stepId}`,
      kind: "policy-diff",
      timestamp: detail.execution.updatedAt ?? detail.execution.createdAt,
      executionId: detail.execution.id,
      stepId: step.stepId,
      label: `policy:${step.role}`,
      payload: step,
    });
  }
  return orderedTimeline(items);
}

export async function getExecutionHistory(
  executionId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    return null;
  }
  const policyDiff = await getExecutionPolicyDiff(
    executionId,
    dbPath,
    sessionDbPath,
  );
  const tree = getExecutionTree(executionId, dbPath);
  return {
    execution: detail.execution,
    tree,
    stepSummary: summarizeStepStates(detail.steps),
    reviews: detail.reviews,
    approvals: detail.approvals,
    escalations: detail.escalations,
    audit: detail.audit,
    policyDiff,
    timeline: buildExecutionHistoryItems(detail, policyDiff),
    sessions: detail.sessions,
    scope: options.scope ?? "execution",
  };
}

export async function listScenarioCatalog(
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const definitions = await listScenarioDefinitions();
  return withOrchestratorDatabase(dbPath, (db) =>
    definitions.map((definition) => {
      const latestRun = listScenarioRuns(db, definition.id, 1)[0] ?? null;
      const latestExecutions = latestRun
        ? listScenarioRunExecutions(db, latestRun.id)
        : [];
      return {
        ...definition,
        latestRun,
        latestExecutions,
      };
    }),
  );
}

export async function getScenarioCatalogEntry(
  scenarioId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    return null;
  }
  return withOrchestratorDatabase(dbPath, (db) => {
    const latestRun = listScenarioRuns(db, scenarioId, 1)[0] ?? null;
    const latestExecutions = latestRun
      ? listScenarioRunExecutions(db, latestRun.id)
      : [];
    return {
      ...definition,
      latestRun,
      latestExecutions,
    };
  });
}

export async function getScenarioRuns(
  scenarioId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  limit = 20,
) {
  const definition = await getScenarioDefinition(scenarioId);
  if (!definition) {
    return null;
  }
  return withOrchestratorDatabase(dbPath, (db) => ({
    scenario: definition,
    runs: listScenarioRuns(db, scenarioId, limit).map((run) => ({
      ...run,
      executions: listScenarioRunExecutions(db, run.id),
    })),
  }));
}

export async function listRegressionCatalog(
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const definitions = await listRegressionDefinitions();
  return withOrchestratorDatabase(dbPath, (db) =>
    definitions.map((definition) => {
      const latestRun = listRegressionRuns(db, definition.id, 1)[0] ?? null;
      const latestItems = latestRun
        ? listRegressionRunItems(db, latestRun.id)
        : [];
      return {
        ...definition,
        latestRun,
        latestItems,
      };
    }),
  );
}

export async function getRegressionCatalogEntry(
  regressionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    return null;
  }
  return withOrchestratorDatabase(dbPath, (db) => {
    const latestRun = listRegressionRuns(db, regressionId, 1)[0] ?? null;
    const latestItems = latestRun
      ? listRegressionRunItems(db, latestRun.id)
      : [];
    return {
      ...definition,
      latestRun,
      latestItems,
    };
  });
}

export async function getRegressionRuns(
  regressionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  limit = 20,
) {
  const definition = await getRegressionDefinition(regressionId);
  if (!definition) {
    return null;
  }
  return withOrchestratorDatabase(dbPath, (db) => ({
    regression: definition,
    runs: listRegressionRuns(db, regressionId, limit).map((run) => ({
      ...run,
      items: listRegressionRunItems(db, run.id),
    })),
  }));
}

export function listExecutionChildren(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listChildExecutions(db, executionId).map(decorateExecution);
  });
}

export function listCoordinationGroup(
  groupId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) =>
    listExecutionGroup(db, groupId).map(decorateExecution),
  );
}

export function listExecutionSummaries(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) =>
    listExecutions(db).map(decorateExecution),
  );
}

function summarizeCoordinationGroupExecutions(groupId, executions) {
  const byState = {};
  for (const execution of executions) {
    byState[execution.state] = (byState[execution.state] ?? 0) + 1;
  }
  return {
    groupId,
    executionCount: executions.length,
    byState,
    rootExecutionIds: executions
      .filter((item) => !item.parentExecutionId)
      .map((item) => item.id),
    childExecutionIds: executions
      .filter((item) => item.parentExecutionId)
      .map((item) => item.id),
    activeExecutionIds: executions
      .filter((item) => !SETTLED_EXECUTION_STATES.includes(item.state))
      .map((item) => item.id),
    heldExecutionIds: executions
      .filter((item) => ["paused", "held"].includes(item.state))
      .map((item) => item.id),
    executions,
  };
}

function summarizeStepStates(steps) {
  return summarizeWaveStepStates(steps, WAVE_SUCCESS_STEP_STATES);
}

function resolveExecutionRoot(db, execution) {
  let current = execution;
  while (current?.parentExecutionId) {
    const parent = getExecution(db, current.parentExecutionId);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current;
}

function buildExecutionTreeNode(
  executionId,
  executionsById,
  childrenByParent,
  stepsByExecutionId,
) {
  const execution = executionsById.get(executionId);
  if (!execution) {
    return null;
  }
  const steps = stepsByExecutionId.get(executionId) ?? [];
  const children = (childrenByParent.get(executionId) ?? [])
    .map((childId) =>
      buildExecutionTreeNode(
        childId,
        executionsById,
        childrenByParent,
        stepsByExecutionId,
      ),
    )
    .filter(Boolean);
  return {
    execution,
    stepSummary: summarizeStepStates(steps),
    children,
  };
}

export function listCoordinationGroups(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const groups = new Map();
    for (const execution of listExecutions(db)) {
      const groupId = execution.coordinationGroupId ?? execution.id;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(execution);
    }
    return Array.from(groups.entries())
      .map(([groupId, executions]) =>
        summarizeCoordinationGroupExecutions(groupId, executions),
      )
      .sort((left, right) => {
        const leftUpdated = Math.max(
          ...left.executions.map(
            (item) =>
              Date.parse(
                item.updatedAt ?? item.startedAt ?? item.endedAt ?? 0,
              ) || 0,
          ),
        );
        const rightUpdated = Math.max(
          ...right.executions.map(
            (item) =>
              Date.parse(
                item.updatedAt ?? item.startedAt ?? item.endedAt ?? 0,
              ) || 0,
          ),
        );
        return rightUpdated - leftUpdated;
      });
  });
}

export function getCoordinationGroupDetail(
  groupId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const executions = listExecutionGroup(db, groupId);
    if (executions.length === 0) {
      return null;
    }
    const details = executions.map((execution) =>
      getExecutionDetail(execution.id, dbPath, sessionDbPath),
    );
    return {
      summary: summarizeCoordinationGroupExecutions(groupId, executions),
      details,
    };
  });
}

export function getExecutionTree(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    const root = resolveExecutionRoot(db, execution);
    const groupId =
      execution.coordinationGroupId ?? root.coordinationGroupId ?? root.id;
    const executions = listExecutionGroup(db, groupId);
    const decoratedExecutions = executions.map(decorateExecution);
    const executionsById = new Map(
      decoratedExecutions.map((item) => [item.id, item]),
    );
    const childrenByParent = new Map();
    const stepsByExecutionId = new Map();

    for (const item of executions) {
      stepsByExecutionId.set(item.id, listSteps(db, item.id));
      const parentId = item.parentExecutionId ?? null;
      if (!parentId) {
        continue;
      }
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId).push(item.id);
    }

    return {
      selectedExecutionId: execution.id,
      rootExecutionId: root.id,
      coordinationGroupId: groupId,
      executionCount: decoratedExecutions.length,
      root: buildExecutionTreeNode(
        root.id,
        executionsById,
        childrenByParent,
        stepsByExecutionId,
      ),
    };
  });
}

export async function driveExecutionTree(
  executionId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }
  return driveCoordinationGroup(
    tree.coordinationGroupId,
    options,
    dbPath,
    sessionDbPath,
  );
}

function flattenExecutionTree(node, items = [], depth = 0) {
  if (!node) {
    return items;
  }
  items.push({
    depth,
    executionId: node.execution.id,
    state: node.execution.state,
  });
  for (const child of node.children ?? []) {
    flattenExecutionTree(child, items, depth + 1);
  }
  return items;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(asArray(values))];
}

function buildCoordinatorBranchKey(domainId) {
  return `domain:${domainId}`;
}

function buildPromotionBranchKey(featureKey) {
  return `promotion:${featureKey}`;
}

function buildProjectLaneMetadata(rootExecutionId, domainId) {
  return {
    topologyKind: "project-child",
    projectLaneType: "lead",
    projectRootExecutionId: rootExecutionId,
    selectedDomainId: domainId,
  };
}

function _buildPromotionLaneMetadata(rootExecutionId, promotion) {
  return {
    topologyKind: "promotion-lane",
    projectRole: "integrator",
    projectLaneType: "integrator",
    projectRootExecutionId: rootExecutionId,
    promotion,
  };
}

function executionSupportsProjectCoordination(execution) {
  return (
    getExecutionProjectRole(execution) === "coordinator" ||
    getExecutionTopologyKind(execution) === "project-root"
  );
}

function isExecutionGovernanceReadyForPromotion(execution) {
  if (execution.state === "completed") {
    return true;
  }
  if (execution.approvalStatus === "approved") {
    return true;
  }
  return execution.reviewStatus === "approved" && !execution.approvalStatus;
}

function updateExecutionMetadataRecord(db, execution, updates = {}) {
  const next = {
    ...execution,
    metadata: {
      ...(execution.metadata ?? {}),
      ...updates,
    },
    updatedAt: nowIso(),
  };
  updateExecution(db, next);
  return next;
}

function collectExecutionWorkspaceSources(db, execution, proposalsById) {
  const workspaces = listWorkspaceAllocations(db, {
    executionId: execution.id,
    limit: 200,
  });
  return workspaces
    .filter((workspace) => workspace.status !== "cleaned")
    .map((workspace) => {
      const proposal = workspace.proposalArtifactId
        ? (proposalsById.get(workspace.proposalArtifactId) ?? null)
        : null;
      const handoff = workspace.metadata?.handoff ?? null;
      return {
        executionId: execution.id,
        domainId: execution.domainId ?? null,
        role:
          workspace.metadata?.workspacePurpose === "integration"
            ? "integrator"
            : (workspace.metadata?.workspacePurpose ?? null),
        workspaceId: workspace.id,
        proposalArtifactId: workspace.proposalArtifactId ?? null,
        proposalStatus: proposal?.status ?? null,
        worktreePath: workspace.worktreePath,
        branchName: workspace.branchName,
        baseRef: workspace.baseRef,
        integrationBranch: workspace.integrationBranch ?? null,
        snapshotRef: handoff?.snapshotRef ?? null,
        snapshotCommit: handoff?.snapshotCommit ?? null,
        sourceType: proposal
          ? "proposal-artifact"
          : handoff?.snapshotCommit
            ? "workspace-snapshot"
            : workspace.branchName
              ? "workspace-branch"
              : "unknown",
      };
    })
    .filter((source) =>
      Boolean(
        source.proposalArtifactId || source.snapshotCommit || source.branchName,
      ),
    );
}

function summarizePromotionSources(rootExecution, executions, db) {
  const proposalsById = new Map(
    listProposalArtifacts(db, null, 500).map((artifact) => [
      artifact.id,
      artifact,
    ]),
  );
  const leadExecutions = executions.filter(
    (execution) =>
      execution.id !== rootExecution.id &&
      execution.parentExecutionId === rootExecution.id &&
      execution.domainId &&
      getExecutionProjectRole(execution) !== "integrator",
  );
  const blockers = [];
  const sources = [];

  for (const execution of leadExecutions) {
    if (!isExecutionGovernanceReadyForPromotion(execution)) {
      blockers.push({
        code: "lane_not_ready",
        executionId: execution.id,
        domainId: execution.domainId ?? null,
        message: `lead lane ${execution.id} is not promotion-ready`,
      });
      continue;
    }
    const laneSources = collectExecutionWorkspaceSources(
      db,
      execution,
      proposalsById,
    );
    if (laneSources.length === 0) {
      blockers.push({
        code: "missing_promotion_source",
        executionId: execution.id,
        domainId: execution.domainId ?? null,
        message: `lead lane ${execution.id} has no durable promotion source artifacts`,
      });
      continue;
    }
    sources.push(...laneSources);
  }

  return {
    rootExecutionId: rootExecution.id,
    laneCount: leadExecutions.length,
    count: sources.length,
    sources,
    blockers,
  };
}

export async function buildProjectCoordinationPlan(options: LooseRecord = {}) {
  const rootInvocation = await planProjectCoordination(options);
  const selectedDomains = asArray(
    rootInvocation.metadata?.invocationMetadata?.selectedDomains,
  );
  const childInvocations = [];
  for (const domainId of selectedDomains) {
    const childPlan = await planWorkflowInvocation({
      projectPath: rootInvocation.project.path,
      domainId,
      maxRoles: 32,
      invocationId: `${rootInvocation.invocationId}-${domainId}-lead`,
      objective: options.objective ?? rootInvocation.objective,
      coordinationGroupId: rootInvocation.invocationId,
      parentExecutionId: rootInvocation.invocationId,
      branchKey: buildCoordinatorBranchKey(domainId),
      metadata: buildProjectLaneMetadata(rootInvocation.invocationId, domainId),
    });
    childInvocations.push(childPlan);
  }
  return {
    rootInvocation,
    childInvocations,
    selectedDomains,
  };
}

export async function planPromotionForExecution(
  executionId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, async (db) => {
    const selected = getExecution(db, executionId);
    if (!selected) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const root = resolveExecutionRoot(db, selected);
    if (!executionSupportsProjectCoordination(root)) {
      throw new Error(
        `promotion flow requires a coordinator-root execution family: ${root.id}`,
      );
    }
    const groupId = root.coordinationGroupId ?? root.id;
    const executions = listExecutionGroup(db, groupId);
    const sourceSummary = summarizePromotionSources(root, executions, db);
    if (sourceSummary.blockers.length > 0 || sourceSummary.count === 0) {
      const primary = sourceSummary.blockers[0] ?? {
        code: "missing_promotion_source",
        message: `execution family ${root.id} has no promotion-ready sources`,
      };
      throw new Error(`promotion blocked: ${primary.code}: ${primary.message}`);
    }
    const plan = await planFeaturePromotion({
      projectPath: root.projectPath,
      objective: options.objective ?? root.objective,
      invocationId:
        options.invocationId ?? `promotion-${root.id}-${Date.now()}`,
      coordinationGroupId: groupId,
      parentExecutionId: root.id,
      branchKey: buildPromotionBranchKey(options.featureKey ?? root.id),
      targetBranch: options.targetBranch ?? null,
      sourceSummary,
      metadata: {
        projectRootExecutionId: root.id,
        promotionSourceExecutionIds: unique(
          sourceSummary.sources.map((source) => source.executionId),
        ),
        projectRole: "integrator",
      },
    });
    return {
      rootExecution: decorateExecution(root),
      sourceSummary,
      invocation: plan,
    };
  });
}

export async function invokeProjectCoordination(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const plan = await buildProjectCoordinationPlan(options);
  const rootCreated = createExecution(plan.rootInvocation, dbPath);
  const childResults = [];
  for (const childPlan of plan.childInvocations) {
    const childCreated = createExecution(childPlan, dbPath);
    await emitBranchEvents(
      plan.rootInvocation.invocationId,
      childPlan.invocationId,
      childPlan.coordination.branchKey,
      dbPath,
    );
    childResults.push({
      invocation: childPlan,
      created: childCreated,
      detail: getExecutionDetail(childPlan.invocationId, dbPath, sessionDbPath),
    });
  }
  const detail = options.wait
    ? await driveCoordinationGroup(
        plan.rootInvocation.invocationId,
        {
          wait: true,
          timeoutMs: options.timeoutMs ?? options.timeout ?? "180000",
          intervalMs: options.intervalMs ?? options.interval ?? "1500",
          noMonitor: options.noMonitor ?? false,
          stub: options.stub ?? false,
          launcher: options.launcher ?? null,
          stepSoftTimeoutMs:
            options.stepSoftTimeoutMs ?? options["step-soft-timeout"] ?? null,
          stepHardTimeoutMs:
            options.stepHardTimeoutMs ?? options["step-hard-timeout"] ?? null,
        },
        dbPath,
        sessionDbPath,
      )
    : getCoordinationGroupDetail(
        plan.rootInvocation.invocationId,
        dbPath,
        sessionDbPath,
      );
  return {
    plan,
    created: {
      root: rootCreated,
      children: childResults,
    },
    detail,
  };
}

export async function invokeFeaturePromotion(
  executionId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const promotionPlan = await planPromotionForExecution(
    executionId,
    options,
    dbPath,
  );
  const created = createExecution(promotionPlan.invocation, dbPath);
  withOrchestratorDatabase(dbPath, (db) => {
    const rootExecution = getExecution(db, promotionPlan.rootExecution.id);
    if (rootExecution) {
      const heldRoot = holdExecutionRecord(
        rootExecution,
        "waiting_for_feature_promotion",
      );
      updateExecution(db, heldRoot);
      emitWorkflowEvent(db, {
        executionId: rootExecution.id,
        type: "workflow.execution.held",
        payload: {
          reason: "waiting_for_feature_promotion",
          coordinationGroupId:
            rootExecution.coordinationGroupId ?? rootExecution.id,
          childExecutionId: promotionPlan.invocation.invocationId,
          childProjectRole: "integrator",
          childTopologyKind: "promotion-lane",
        },
      });
    }
    const integratorExecution = getExecution(
      db,
      promotionPlan.invocation.invocationId,
    );
    if (integratorExecution) {
      updateExecutionPromotionSummary(db, integratorExecution, {
        status: "running",
        sourceSummary: promotionPlan.sourceSummary,
        blockers: [],
      });
    }
  });
  await emitBranchEvents(
    promotionPlan.rootExecution.id,
    promotionPlan.invocation.invocationId,
    promotionPlan.invocation.coordination.branchKey,
    dbPath,
  );
  const detail = options.wait
    ? await driveExecution(promotionPlan.invocation.invocationId, {
        wait: true,
        timeoutMs: options.timeoutMs ?? options.timeout ?? "180000",
        intervalMs: options.intervalMs ?? options.interval ?? "1500",
        noMonitor: options.noMonitor ?? false,
        stub: options.stub ?? false,
        launcher: options.launcher ?? null,
        stepSoftTimeoutMs:
          options.stepSoftTimeoutMs ?? options["step-soft-timeout"] ?? null,
        stepHardTimeoutMs:
          options.stepHardTimeoutMs ?? options["step-hard-timeout"] ?? null,
      })
    : getExecutionDetail(
        promotionPlan.invocation.invocationId,
        dbPath,
        sessionDbPath,
      );
  return {
    plan: promotionPlan,
    created,
    detail,
  };
}

export function applyExecutionTreeAction(
  executionId,
  action,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }

  const ordered = flattenExecutionTree(tree.root).filter(
    (item) => !TERMINAL_EXECUTION_STATES.has(item.state),
  );
  const executionOrder =
    action === "resume"
      ? ordered.sort((left, right) => right.depth - left.depth)
      : ordered.sort((left, right) => left.depth - right.depth);

  const results = [];
  for (const item of executionOrder) {
    if (action === "pause") {
      results.push(
        pauseExecution(item.executionId, payload, dbPath, sessionDbPath),
      );
      continue;
    }
    if (action === "hold") {
      results.push(
        holdExecution(item.executionId, payload, dbPath, sessionDbPath),
      );
      continue;
    }
    if (action === "resume") {
      const detail = getExecutionDetail(
        item.executionId,
        dbPath,
        sessionDbPath,
      );
      if (
        detail?.execution?.state &&
        ["paused", "held"].includes(detail.execution.state)
      ) {
        results.push(
          resumeExecution(item.executionId, payload, dbPath, sessionDbPath),
        );
      }
      continue;
    }
    throw new Error(`unsupported tree action: ${action}`);
  }

  const outcome = {
    action,
    changedExecutionIds: results.map((item) => item.execution.id),
    tree: getExecutionTree(executionId, dbPath),
  };
  withOrchestratorDatabase(dbPath, (db) => {
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      action: `tree:${action}`,
      actor: context.actor,
      source: context.source,
      targetType: "execution-tree",
      targetId: outcome.tree?.rootExecutionId ?? executionId,
      payload: {
        scope: "tree",
        requestedAction: action,
        changedExecutionIds: outcome.changedExecutionIds,
      },
      result: {
        status: "accepted",
        changedExecutionIds: outcome.changedExecutionIds,
      },
    });
  });
  return outcome;
}

export async function applyExecutionTreeGovernance(
  executionId,
  action,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }

  const ordered = flattenExecutionTree(tree.root).sort(
    (left, right) => right.depth - left.depth,
  );
  const pending = ordered
    .map((item) => getExecutionDetail(item.executionId, dbPath, sessionDbPath))
    .filter(Boolean)
    .filter((detail) =>
      action === "review"
        ? detail.execution.state === "waiting_review" ||
          detail.steps.some((step) => step.state === "review_pending")
        : detail.execution.state === "waiting_approval" ||
          detail.steps.some((step) => step.state === "approval_pending"),
    );

  const scope =
    payload.scope === "first-pending" ? "first-pending" : "all-pending";
  const targets = scope === "first-pending" ? pending.slice(0, 1) : pending;
  const changedExecutionIds = [];

  for (const detail of targets) {
    if (action === "review") {
      await recordReviewDecision(
        detail.execution.id,
        payload,
        dbPath,
        sessionDbPath,
      );
      changedExecutionIds.push(detail.execution.id);
      continue;
    }
    if (action === "approval") {
      await recordApprovalDecision(
        detail.execution.id,
        payload,
        dbPath,
        sessionDbPath,
      );
      changedExecutionIds.push(detail.execution.id);
      continue;
    }
    throw new Error(`unsupported tree governance action: ${action}`);
  }

  const outcome = {
    action,
    scope,
    changedExecutionIds,
    tree: getExecutionTree(executionId, dbPath),
  };
  withOrchestratorDatabase(dbPath, (db) => {
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      action: `tree:${action}`,
      actor: context.actor,
      source: context.source,
      targetType: "execution-tree",
      targetId: outcome.tree?.rootExecutionId ?? executionId,
      payload: {
        scope,
        status: payload.status,
        changedExecutionIds,
      },
      result: {
        status: "accepted",
        changedExecutionIds,
      },
    });
  });
  return outcome;
}

async function emitBranchEvents(
  parentExecutionId,
  childExecutionId,
  branchKey,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    emitWorkflowEvent(db, {
      executionId: parentExecutionId,
      type: "workflow.execution.child_planned",
      payload: {
        childExecutionId,
        branchKey,
      },
    });
    emitWorkflowEvent(db, {
      executionId: childExecutionId,
      type: "workflow.execution.branched",
      payload: {
        parentExecutionId,
        branchKey,
      },
    });
  });
}

export async function branchExecution(
  parentExecutionId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const parent = getExecutionDetail(parentExecutionId, dbPath, sessionDbPath);
  if (!parent) {
    throw new Error(`parent execution not found: ${parentExecutionId}`);
  }

  const roles =
    Array.isArray(payload.roles) && payload.roles.length > 0
      ? payload.roles
      : null;
  const invocation = await planWorkflowInvocation({
    workflowPath: payload.workflowPath ?? parent.execution.workflowPath,
    projectPath: payload.projectPath ?? parent.execution.projectPath,
    domainId: payload.domainId ?? parent.execution.domainId ?? null,
    roles,
    maxRoles: Number.parseInt(
      String(payload.maxRoles ?? roles?.length ?? 1),
      10,
    ),
    invocationId:
      payload.invocationId ?? `branch-${parentExecutionId}-${Date.now()}`,
    objective: payload.objective ?? parent.execution.objective,
    coordinationGroupId:
      payload.coordinationGroupId ??
      parent.execution.coordinationGroupId ??
      parent.execution.id,
    parentExecutionId,
    branchKey:
      payload.branchKey ??
      `${payload.domainId ?? parent.execution.domainId ?? "shared"}-${Date.now()}`,
  });

  const created = createExecution(invocation, dbPath);
  await emitBranchEvents(
    parentExecutionId,
    invocation.invocationId,
    invocation.coordination.branchKey,
    dbPath,
  );
  withOrchestratorDatabase(dbPath, (db) => {
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId: parentExecutionId,
      action: "execution:branch",
      actor: context.actor,
      source: context.source,
      targetType: "execution",
      targetId: invocation.invocationId,
      payload: {
        branchKey: invocation.coordination.branchKey,
        roles: invocation.launches.map((launch) => launch.role),
      },
      result: {
        status: "accepted",
        childExecutionId: invocation.invocationId,
      },
    });
  });
  const detail = payload.wait
    ? await driveExecution(invocation.invocationId, {
        wait: true,
        timeoutMs: payload.timeoutMs ?? "180000",
        intervalMs: payload.intervalMs ?? "1500",
        noMonitor: payload.noMonitor ?? false,
        stub: payload.stub ?? false,
        launcher: payload.launcher ?? null,
        stepSoftTimeoutMs: payload.stepSoftTimeoutMs ?? null,
        stepHardTimeoutMs: payload.stepHardTimeoutMs ?? null,
      })
    : getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);

  return {
    invocation,
    created,
    detail,
  };
}

export const forkExecution = branchExecution;

export async function spawnExecutionBranches(
  executionId,
  branches = [],
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new Error("spawnExecutionBranches requires at least one branch spec");
  }
  const created = [];
  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index] ?? {};
    const roles =
      Array.isArray(branch.roles) && branch.roles.length > 0
        ? branch.roles
        : null;
    const result = await branchExecution(
      executionId,
      {
        workflowPath: branch.workflowPath ?? null,
        projectPath: branch.projectPath ?? null,
        domainId: branch.domainId ?? null,
        roles,
        maxRoles: branch.maxRoles ?? roles?.length ?? 1,
        invocationId:
          branch.invocationId ??
          `${executionId}-branch-${index + 1}-${Date.now()}`,
        objective: branch.objective ?? null,
        branchKey: branch.branchKey ?? `branch-${index + 1}-${Date.now()}`,
        wait: false,
      },
      dbPath,
      sessionDbPath,
    );
    created.push(result);
  }

  const tree = getExecutionTree(executionId, dbPath);
  withOrchestratorDatabase(dbPath, (db) => {
    const context = buildAuditContext(options);
    emitAuditEvent(db, {
      executionId,
      action: "execution:spawn-branches",
      actor: context.actor,
      source: context.source,
      targetType: "execution-tree",
      targetId: tree?.rootExecutionId ?? executionId,
      payload: {
        branchCount: branches.length,
        branches: branches.map((branch) => ({
          branchKey: branch?.branchKey ?? null,
          roles: Array.isArray(branch?.roles) ? branch.roles : [],
        })),
      },
      result: {
        status: "accepted",
        createdExecutionIds: created.map(
          (item) => item.invocation.invocationId,
        ),
      },
    });
  });
  if (options.wait === true) {
    const groupId = tree?.coordinationGroupId ?? executionId;
    const detail = await driveCoordinationGroup(
      groupId,
      options,
      dbPath,
      sessionDbPath,
    );
    return {
      created,
      tree: getExecutionTree(executionId, dbPath),
      detail,
    };
  }

  return {
    created,
    tree,
  };
}

function assertHoldableExecution(execution, steps, action) {
  if (["completed", "canceled"].includes(execution.state)) {
    throw new Error(`cannot ${action} terminal execution: ${execution.id}`);
  }
  assertNoActiveStep(steps, execution.id, action);
}

export function holdExecution(
  executionId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    assertHoldableExecution(execution, steps, "hold");
    if (execution.state === "held") {
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }
    const heldExecution = transitionExecutionRecord(
      execution,
      "held",
      buildHoldMetadata(execution, payload, "held"),
    );
    updateExecution(db, heldExecution);
    emitWorkflowEvent(db, {
      executionId,
      type: "workflow.execution.held",
      payload: {
        decidedBy: payload.decidedBy ?? "operator",
        reason: heldExecution.holdReason,
        heldFromState: execution.state,
        holdOwner: heldExecution.holdOwner,
        holdGuidance: heldExecution.holdGuidance,
        holdExpiresAt: heldExecution.holdExpiresAt,
      },
    });
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      action: "execution:hold",
      actor: context.actor,
      source: context.source,
      targetType: "execution",
      targetId: executionId,
      payload,
      result: {
        status: "accepted",
        state: heldExecution.state,
      },
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function pauseExecution(
  executionId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    assertHoldableExecution(execution, steps, "pause");
    if (execution.state === "paused") {
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }
    const pausedExecution = transitionExecutionRecord(
      execution,
      "paused",
      buildHoldMetadata(execution, payload, "paused"),
    );
    updateExecution(db, pausedExecution);
    emitWorkflowEvent(db, {
      executionId,
      type: "workflow.execution.paused",
      payload: {
        decidedBy: payload.decidedBy ?? "operator",
        reason: pausedExecution.holdReason,
        pausedFromState: execution.state,
        holdOwner: pausedExecution.holdOwner,
        holdGuidance: pausedExecution.holdGuidance,
        holdExpiresAt: pausedExecution.holdExpiresAt,
      },
    });
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      action: "execution:pause",
      actor: context.actor,
      source: context.source,
      targetType: "execution",
      targetId: executionId,
      payload,
      result: {
        status: "accepted",
        state: pausedExecution.state,
      },
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function resumeExecution(
  executionId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    if (!["paused", "held"].includes(execution.state)) {
      throw new Error(`execution is not paused or held: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    assertNoActiveStep(steps, executionId, "resume");
    const nextStep = getFirstPlannedStep(steps);
    const hasReviewPending = steps.some(
      (step) => step.state === "review_pending",
    );
    const hasApprovalPending = steps.some(
      (step) => step.state === "approval_pending",
    );
    const nextState = nextStep
      ? "running"
      : hasApprovalPending
        ? "waiting_approval"
        : hasReviewPending
          ? "waiting_review"
          : "running";
    const resumedExecution = transitionExecutionRecord(execution, nextState, {
      heldFromState: null,
      holdReason: null,
      holdOwner: null,
      holdGuidance: null,
      holdExpiresAt: null,
      pausedAt: null,
      heldAt: null,
      resumedAt: new Date().toISOString(),
      endedAt: null,
    });
    updateExecution(db, resumedExecution);
    emitWorkflowEvent(db, {
      executionId,
      stepId: nextStep?.id ?? null,
      sessionId: nextStep?.sessionId ?? null,
      type: "workflow.execution.resumed",
      payload: {
        decidedBy: payload.decidedBy ?? "operator",
        resumedFromState: execution.state,
        nextState,
        reason: payload.reason ?? payload.comments ?? "operator resume",
        previousHoldOwner: execution.holdOwner,
        previousHoldExpiresAt: execution.holdExpiresAt,
      },
    });
    const context = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      stepId: nextStep?.id ?? null,
      sessionId: nextStep?.sessionId ?? null,
      action: "execution:resume",
      actor: context.actor,
      source: context.source,
      targetType: "execution",
      targetId: executionId,
      payload,
      result: {
        status: "accepted",
        state: resumedExecution.state,
      },
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export async function driveCoordinationGroup(
  groupId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "1500"), 10);
  const timeoutMs = options.wait
    ? Number.parseInt(String(options.timeoutMs ?? "180000"), 10)
    : 0;
  const startedAt = Date.now();

  const step = async () => {
    const group = getCoordinationGroupDetail(groupId, dbPath, sessionDbPath);
    if (!group) {
      throw new Error(`coordination group not found: ${groupId}`);
    }
    for (const detail of group.details) {
      if (
        detail &&
        !TERMINAL_EXECUTION_STATES.has(detail.execution.state) &&
        detail.execution.state !== "paused"
      ) {
        await reconcileExecution(detail.execution.id, options);
      }
    }
    return getCoordinationGroupDetail(groupId, dbPath, sessionDbPath);
  };

  let detail = await step();
  if (!options.wait) {
    return detail;
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (
      detail.details.every((item) =>
        SETTLED_EXECUTION_STATES.includes(item.execution.state),
      )
    ) {
      return detail;
    }
    await sleep(intervalMs);
    detail = await step();
  }

  return detail;
}

function getFirstPlannedStep(steps) {
  return getNextLaunchableSteps(steps)[0] ?? null;
}

function assertNoActiveStep(steps, executionId, action) {
  const activeStep = steps.find((step) => ACTIVE_STEP_STATES.has(step.state));
  if (activeStep) {
    throw new Error(
      `cannot ${action} execution with active step: ${executionId}`,
    );
  }
}

async function launchStep(execution, step, options: LooseRecord = {}) {
  const briefPath = await writeExecutionBrief(execution, step);
  const dbPath = options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH;
  const db = openOrchestratorDatabase(dbPath);
  let workspace = null;
  let previousStep = null;
  try {
    previousStep =
      step.sequence > 0
        ? (listSteps(db, execution.id)[step.sequence - 1] ?? null)
        : null;
    workspace = await ensureStepWorkspace(db, execution, step);
  } finally {
    db.close();
  }
  const parentSessionId = previousStep?.sessionId ?? null;

  const args = [
    "packages/runtime-pi/src/cli/run-session-plan.js",
    "--profile",
    step.profilePath,
    "--project",
    execution.projectPath,
    "--session-id",
    step.sessionId,
    "--run-id",
    `${execution.id}-${step.sequence + 1}`,
    "--brief",
    briefPath,
    "--workflow",
    execution.workflowId,
  ];
  const contextQuery =
    getStepPolicy(step)?.docsKbPolicy?.query ??
    getExecutionPolicy(execution)?.docsKbPolicy?.queryTerms?.join(" ") ??
    null;
  const contextQueryTerms =
    getStepPolicy(step)?.docsKbPolicy?.queryTerms ??
    getExecutionPolicy(execution)?.docsKbPolicy?.queryTerms ??
    [];
  const contextLimit =
    getStepPolicy(step)?.docsKbPolicy?.resultLimit ??
    getExecutionPolicy(execution)?.docsKbPolicy?.resultLimit ??
    null;
  if (execution.domainId) {
    args.push("--domain", execution.domainId);
  }
  if (step.sessionMode) {
    args.push("--session-mode", step.sessionMode);
  }
  if (contextQuery) {
    args.push("--context-query", contextQuery);
  }
  if (Array.isArray(contextQueryTerms) && contextQueryTerms.length > 0) {
    args.push("--context-query-terms", contextQueryTerms.join(","));
  }
  if (contextLimit) {
    args.push("--context-limit", String(contextLimit));
  }
  if (parentSessionId) {
    args.push("--parent", parentSessionId);
  }
  if (workspace?.worktreePath) {
    args.push("--cwd", workspace.worktreePath);
    args.push("--workspace-id", workspace.id);
    if (workspace.branchName) {
      args.push("--workspace-branch", workspace.branchName);
    }
    if (workspace.baseRef) {
      args.push("--workspace-base-ref", workspace.baseRef);
    }
    if (workspace.metadata?.workspacePurpose) {
      args.push("--workspace-purpose", workspace.metadata.workspacePurpose);
    }
    if (workspace.metadata?.sourceWorkspaceId) {
      args.push("--workspace-source-id", workspace.metadata.sourceWorkspaceId);
    }
    if (workspace.metadata?.sourceRef) {
      args.push("--workspace-source-ref", workspace.metadata.sourceRef);
    }
    if (workspace.metadata?.sourceCommit) {
      args.push("--workspace-source-commit", workspace.metadata.sourceCommit);
    }
  }
  if (options.noMonitor) {
    args.push("--no-monitor");
  }
  if (options.stub) {
    args.push("--stub");
  }
  if (options.launcher) {
    args.push("--launcher", options.launcher);
  }

  const runtime = await runCli("node", args);

  return withOrchestratorDatabase(dbPath, (db) => {
    const currentExecution = getExecution(db, execution.id);
    const currentStep = getStep(db, step.id);
    const currentWorkspace = getWorkspaceAllocationByStepId(db, step.id);
    const updatedStep = transitionStepRecord(currentStep, "active", {
      parentSessionId,
      launchedAt: new Date().toISOString(),
    });
    updateStep(db, updatedStep);
    if (currentWorkspace) {
      updateWorkspaceAllocation(db, {
        ...currentWorkspace,
        status: "active",
        updatedAt: nowIso(),
        metadata: {
          ...currentWorkspace.metadata,
          sessionId: updatedStep.sessionId,
          lastLaunchedAt: nowIso(),
          launchedCwd: currentWorkspace.worktreePath,
        },
      });
    }
    const updatedExecution = transitionExecutionRecord(
      currentExecution,
      "running",
      {
        currentStepIndex: currentStep.sequence,
        startedAt: currentExecution.startedAt ?? new Date().toISOString(),
      },
    );
    updateExecution(db, updatedExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      stepId: updatedStep.id,
      sessionId: updatedStep.sessionId,
      type: "workflow.step.started",
      payload: {
        sequence: updatedStep.sequence,
        wave: updatedStep.wave ?? updatedStep.sequence,
        waveName: updatedStep.waveName ?? null,
        role: updatedStep.role,
        sessionMode: updatedStep.sessionMode,
        attemptCount: updatedStep.attemptCount,
        maxAttempts: updatedStep.maxAttempts,
        parentSessionId,
        workspaceId: currentWorkspace?.id ?? null,
        worktreePath: currentWorkspace?.worktreePath ?? null,
        workspacePurpose: currentWorkspace?.metadata?.workspacePurpose ?? null,
        sourceWorkspaceId:
          currentWorkspace?.metadata?.sourceWorkspaceId ?? null,
        sourceCommit: currentWorkspace?.metadata?.sourceCommit ?? null,
        sourceRef: currentWorkspace?.metadata?.sourceRef ?? null,
        briefPath,
        policy: updatedStep.policy ?? {},
      },
    });
    return {
      execution: updatedExecution,
      step: updatedStep,
      runtime,
      briefPath,
    };
  });
}

async function launchSteps(execution, steps, options: LooseRecord = {}) {
  if (steps.length > 0) {
    const wave = getStepWave(steps[0]);
    withOrchestratorDatabase(
      options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH,
      (db) => {
        const priorWave = wave - 1;
        if (priorWave >= 0) {
          emitWorkflowEvent(db, {
            executionId: execution.id,
            stepId: steps[0].id,
            sessionId: steps[0].sessionId,
            type: "workflow.wave.gate_satisfied",
            payload: {
              wave: priorWave,
              nextWave: wave,
              gate: getWaveGate(listSteps(db, execution.id), priorWave),
            },
          });
        }
        emitWorkflowEvent(db, {
          executionId: execution.id,
          stepId: steps[0].id,
          sessionId: steps[0].sessionId,
          type: "workflow.wave.started",
          payload: {
            wave,
            waveName: steps[0].waveName ?? null,
            size: steps.length,
            gate: getWaveGate(listSteps(db, execution.id), wave),
            policy: getWavePolicy(listSteps(db, execution.id), wave),
          },
        });
      },
    );
  }
  const results = [];
  for (const step of steps) {
    results.push(await launchStep(execution, step, options));
  }
  return results;
}

function settleStepFromSession(step, session) {
  if (!session) {
    return null;
  }
  if (session.state === "completed") {
    if (step.reviewRequired) {
      return transitionStepRecord(step, "review_pending", {
        reviewStatus: step.reviewStatus ?? "pending",
        approvalStatus: step.approvalRequired
          ? (step.approvalStatus ?? "pending")
          : null,
      });
    }
    return transitionStepRecord(step, "completed");
  }
  if (["failed", "stopped", "canceled"].includes(session.state)) {
    return transitionStepRecord(
      step,
      session.state === "stopped" ? "stopped" : "failed",
    );
  }
  return null;
}

function reconcileCoordinationState(db, execution) {
  const children = listChildExecutions(db, execution.id);
  if (children.length === 0) {
    return execution;
  }

  const blocking = blockingChildren(children);
  const coordinationPolicy =
    getExecutionPolicy(execution)?.coordinationPolicy ?? {};
  const autoHoldParent =
    coordinationPolicy.autoHoldParentOnOpenChildEscalation ?? true;
  const autoResumeParent =
    coordinationPolicy.resumeParentWhenChildrenSettled ?? true;
  const familyStallMs = parseIntegerOrNull(
    coordinationPolicy.escalateOnFamilyStallMs,
  );
  const maxHeldMs = parseIntegerOrNull(coordinationPolicy.maxHeldMs);

  if (blocking.length > 0 && autoHoldParent && execution.state !== "held") {
    const holdReason =
      getExecutionProjectRole(execution) === "coordinator"
        ? blocking.some(
            (child) => getExecutionProjectRole(child) === "integrator",
          )
          ? "waiting_for_feature_promotion"
          : "waiting_for_project_leads"
        : "waiting_for_child_executions";
    const heldExecution = holdExecutionRecord(execution, holdReason);
    updateExecution(db, heldExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.held",
      payload: {
        reason: holdReason,
        blockingChildren: blocking.map((child) => ({
          executionId: child.id,
          state: child.state,
          projectRole: getExecutionProjectRole(child),
          topologyKind: getExecutionTopologyKind(child),
        })),
      },
    });
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.family.held",
      payload: {
        reason: holdReason,
        blockingChildren: blocking.map((child) => child.id),
        coordinationGroupId: execution.coordinationGroupId,
      },
    });
    return heldExecution;
  }

  if (
    blocking.length === 0 &&
    autoResumeParent &&
    execution.state === "held" &&
    isCoordinationHoldReason(execution.holdReason)
  ) {
    const resumedExecution = resumeExecutionRecord(execution);
    updateExecution(db, resumedExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.resumed",
      payload: {
        source: "coordination",
        reason: "child_executions_settled",
        coordinationGroupId: execution.coordinationGroupId,
      },
    });
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.family.resumed",
      payload: {
        reason: "child_executions_settled",
        coordinationGroupId: execution.coordinationGroupId,
      },
    });
    return resumedExecution;
  }

  if (blocking.length > 0 && familyStallMs) {
    const anchor =
      execution.heldAt ?? execution.updatedAt ?? execution.createdAt ?? null;
    const anchorTime = anchor ? Date.parse(anchor) : NaN;
    const ageMs = Number.isFinite(anchorTime)
      ? Math.max(0, Date.now() - anchorTime)
      : 0;
    if (ageMs >= familyStallMs) {
      const alreadyOpen = listEscalations(db, execution.id).some(
        (escalation) =>
          escalation.status === "open" &&
          escalation.reason === "family-stalled",
      );
      if (!alreadyOpen) {
        openEscalation(db, {
          execution,
          reason: "family-stalled",
          payload: {
            coordinationGroupId: execution.coordinationGroupId,
            ageMs,
            blockingChildren: blocking.map((child) => ({
              executionId: child.id,
              state: child.state,
            })),
          },
        });
        emitWorkflowEvent(db, {
          executionId: execution.id,
          type: "workflow.family.escalated",
          payload: {
            reason: "family-stalled",
            coordinationGroupId: execution.coordinationGroupId,
            ageMs,
          },
        });
      }
    }
  }

  if (
    execution.state === "held" &&
    isCoordinationHoldReason(execution.holdReason) &&
    maxHeldMs
  ) {
    const heldAt = execution.heldAt ? Date.parse(execution.heldAt) : NaN;
    const ageMs = Number.isFinite(heldAt)
      ? Math.max(0, Date.now() - heldAt)
      : 0;
    if (ageMs >= maxHeldMs) {
      const alreadyOpen = listEscalations(db, execution.id).some(
        (escalation) =>
          escalation.status === "open" &&
          escalation.reason === "family-held-timeout",
      );
      if (!alreadyOpen) {
        openEscalation(db, {
          execution,
          reason: "family-held-timeout",
          payload: {
            coordinationGroupId: execution.coordinationGroupId,
            ageMs,
            holdReason: execution.holdReason,
          },
        });
        emitWorkflowEvent(db, {
          executionId: execution.id,
          type: "workflow.family.stalled",
          payload: {
            reason: "family-held-timeout",
            ageMs,
            coordinationGroupId: execution.coordinationGroupId,
          },
        });
      }
    }
  }

  return execution;
}

function reconcileExpiredHold(db, execution) {
  if (!hasExpiredHold(execution)) {
    return execution;
  }
  const alreadyOpen = listEscalations(db, execution.id).some(
    (escalation) =>
      escalation.status === "open" && escalation.reason === "hold-expired",
  );
  if (!alreadyOpen) {
    openEscalation(db, {
      execution,
      sourceStepId: null,
      reason: "hold-expired",
      payload: {
        holdReason: execution.holdReason,
        holdOwner: execution.holdOwner,
        holdGuidance: execution.holdGuidance,
        holdExpiresAt: execution.holdExpiresAt,
      },
    });
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.hold_expired",
      payload: {
        holdReason: execution.holdReason,
        holdOwner: execution.holdOwner,
        holdGuidance: execution.holdGuidance,
        holdExpiresAt: execution.holdExpiresAt,
      },
    });
  }
  return execution;
}

export async function reconcileExecution(
  executionId,
  options: LooseRecord = {},
) {
  const dbPath = options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH;
  const sessionDbPath = options.sessionDbPath ?? DEFAULT_SESSION_DB_PATH;

  let detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    throw new Error(`execution not found: ${executionId}`);
  }

  withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (execution) {
      const coordinated = reconcileCoordinationState(db, execution);
      reconcileExpiredHold(db, coordinated);
    }
  });

  detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    throw new Error(
      `execution not found after coordination reconcile: ${executionId}`,
    );
  }

  if (SETTLED_EXECUTION_STATES.includes(detail.execution.state)) {
    return detail;
  }

  const activeSteps = getActiveSteps(detail.steps);
  if (activeSteps.length > 0) {
    const observations = [];
    for (const activeStep of activeSteps) {
      const session = await readSessionWithRetry(
        sessionDbPath,
        activeStep.sessionId,
      );
      await applyActiveStepWatchdog(
        detail.execution,
        activeStep,
        session,
        options,
      );
      observations.push({
        activeStep,
        session,
        settledStep: settleStepFromSession(activeStep, session),
      });
    }

    if (observations.some((item) => item.settledStep)) {
      const db = openOrchestratorDatabase(dbPath);
      let updatedDetail = null;
      try {
        const execution = getExecution(db, executionId);
        const dispatchBlocked = isExecutionDispatchBlocked(execution.state);

        for (const observation of observations) {
          if (!observation.settledStep) {
            continue;
          }

          const { activeStep, settledStep } = observation;
          if (["failed", "stopped"].includes(settledStep.state)) {
            const retryAllowed =
              activeStep.attemptCount < activeStep.maxAttempts;
            if (retryAllowed) {
              const retriedStep = scheduleRetry(
                activeStep,
                execution,
                settledStep.state,
              );
              updateStep(db, retriedStep);
              emitWorkflowEvent(db, {
                executionId,
                stepId: activeStep.id,
                sessionId: activeStep.sessionId,
                type: "workflow.step.retry_scheduled",
                payload: {
                  reason: settledStep.state,
                  nextAttempt: retriedStep.attemptCount,
                  maxAttempts: retriedStep.maxAttempts,
                  nextSessionId: retriedStep.sessionId,
                },
              });
              continue;
            }

            updateStep(db, settledStep);
            settleStepWorkspace(
              db,
              settledStep,
              settledStep.state === "failed" ? "failed" : "settled",
              {
                finalState: settledStep.state,
                sessionId: settledStep.sessionId,
              },
            );
            const currentSteps = listSteps(db, executionId);
            const wavePolicy = getWavePolicy(
              currentSteps,
              getStepWave(activeStep),
            );
            const failureAction = wavePolicy.onFailure ?? "fail_execution";
            if (
              failureAction === "open_escalation" ||
              failureAction === "hold_execution"
            ) {
              openEscalation(db, {
                execution,
                step: settledStep,
                sourceStepId: settledStep.id,
                reason: "retry-exhausted",
                payload: {
                  finalState: settledStep.state,
                  attemptCount: settledStep.attemptCount,
                  maxAttempts: settledStep.maxAttempts,
                  wave: getStepWave(activeStep),
                  waveName: activeStep.waveName ?? null,
                  policy: wavePolicy,
                },
              });
            }
            emitWorkflowEvent(db, {
              executionId,
              stepId: settledStep.id,
              sessionId: settledStep.sessionId,
              type: "workflow.step.failed",
              payload: {
                finalState: settledStep.state,
                attemptCount: settledStep.attemptCount,
                maxAttempts: settledStep.maxAttempts,
              },
            });
            if (failureAction === "hold_execution") {
              const heldExecution = holdExecutionRecord(
                execution,
                `wave-${getStepWave(activeStep)}-failure`,
              );
              updateExecution(db, heldExecution);
              return getExecutionDetail(executionId, dbPath, sessionDbPath);
            }
            if (failureAction === "open_escalation") {
              const heldExecution = holdExecutionRecord(
                execution,
                `wave-${getStepWave(activeStep)}-escalated`,
              );
              updateExecution(db, heldExecution);
              return getExecutionDetail(executionId, dbPath, sessionDbPath);
            }
            if (failureAction === "continue") {
              const currentWave = getStepWave(activeStep);
              const refreshedWaveSteps = getWaveSteps(
                listSteps(db, executionId),
                currentWave,
              );
              const waveSatisfied = isWaveSatisfied(
                listSteps(db, executionId),
                currentWave,
              );
              const waveStillHasWork = refreshedWaveSteps.some(
                (step) =>
                  step.state === "planned" ||
                  ACTIVE_STEP_STATES.has(step.state),
              );
              if (!waveSatisfied && !waveStillHasWork) {
                openEscalation(db, {
                  execution,
                  step: settledStep,
                  sourceStepId: settledStep.id,
                  reason: "wave-blocked",
                  payload: {
                    wave: currentWave,
                    waveName: activeStep.waveName ?? null,
                    finalState: settledStep.state,
                    policy: wavePolicy,
                  },
                });
                const heldExecution = holdExecutionRecord(
                  execution,
                  `wave-${currentWave}-blocked`,
                );
                updateExecution(db, heldExecution);
                return getExecutionDetail(executionId, dbPath, sessionDbPath);
              }
              continue;
            }
            const failedExecution = transitionExecutionRecord(
              execution,
              "failed",
              {
                currentStepIndex: activeStep.sequence,
              },
            );
            updateExecution(db, failedExecution);
            return getExecutionDetail(executionId, dbPath, sessionDbPath);
          }

          updateStep(db, settledStep);
          if (["completed", "review_pending"].includes(settledStep.state)) {
            await publishBuilderWorkspaceHandoff(db, execution, settledStep);
          }
          settleStepWorkspace(
            db,
            settledStep,
            settledStep.state === "review_pending" ? "settled" : "settled",
            {
              finalState: settledStep.state,
              sessionId: settledStep.sessionId,
            },
          );
          if (settledStep.state === "review_pending") {
            emitWorkflowEvent(db, {
              executionId,
              stepId: settledStep.id,
              sessionId: settledStep.sessionId,
              type: "workflow.step.review_pending",
              payload: {
                sequence: settledStep.sequence,
                wave: settledStep.wave ?? settledStep.sequence,
                role: settledStep.role,
                dispatchBlocked,
              },
            });
            continue;
          }

          emitWorkflowEvent(db, {
            executionId,
            stepId: settledStep.id,
            sessionId: settledStep.sessionId,
            type: "workflow.step.completed",
            payload: {
              sequence: settledStep.sequence,
              wave: settledStep.wave ?? settledStep.sequence,
              role: settledStep.role,
              attemptCount: settledStep.attemptCount,
            },
          });
        }

        const activeWaves = [
          ...new Set(
            getActiveSteps(listSteps(db, executionId)).map((step) =>
              getStepWave(step),
            ),
          ),
        ];
        for (const wave of activeWaves) {
          const waveState = applyWavePolicy(
            db,
            execution,
            listSteps(db, executionId),
            wave,
          );
          if (
            waveState &&
            SETTLED_EXECUTION_STATES.includes(String(waveState.state ?? ""))
          ) {
            return getExecutionDetail(executionId, dbPath, sessionDbPath);
          }
        }

        const refreshedSteps = listSteps(db, executionId);
        const remainingActive = getActiveSteps(refreshedSteps);
        const reviewPendingSteps = refreshedSteps.filter(
          (step) => step.state === "review_pending",
        );
        if (reviewPendingSteps.length > 0 && remainingActive.length === 0) {
          const pendingStep = reviewPendingSteps.sort(
            (left, right) => left.sequence - right.sequence,
          )[0];
          const waitingReview = transitionExecutionRecord(
            execution,
            dispatchBlocked ? execution.state : "waiting_review",
            {
              currentStepIndex: pendingStep.sequence,
              reviewStatus: "pending",
              approvalStatus: pendingStep.approvalRequired ? "pending" : null,
            },
          );
          updateExecution(db, waitingReview);
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }

        const approvalPendingSteps = refreshedSteps.filter(
          (step) => step.state === "approval_pending",
        );
        if (approvalPendingSteps.length > 0 && remainingActive.length === 0) {
          const pendingStep = approvalPendingSteps.sort(
            (left, right) => left.sequence - right.sequence,
          )[0];
          const waitingApproval = transitionExecutionRecord(
            execution,
            dispatchBlocked ? execution.state : "waiting_approval",
            {
              currentStepIndex: pendingStep.sequence,
              approvalStatus: "pending",
            },
          );
          updateExecution(db, waitingApproval);
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }

        const nextLaunchable = getNextLaunchableSteps(refreshedSteps);
        const runningExecution = transitionExecutionRecord(
          execution,
          dispatchBlocked ? execution.state : "running",
          {
            currentStepIndex:
              remainingActive[0]?.sequence ??
              nextLaunchable[0]?.sequence ??
              refreshedSteps.length,
          },
        );
        updateExecution(db, runningExecution);
        updatedDetail = getExecutionDetail(executionId, dbPath, sessionDbPath);
      } finally {
        db.close();
      }

      const launchable = getNextLaunchableSteps(updatedDetail.steps);
      if (launchable.length > 0) {
        await launchSteps(updatedDetail.execution, launchable, options);
        return getExecutionDetail(executionId, dbPath, sessionDbPath);
      }
      return updatedDetail;
    }
    const launchable = getNextLaunchableSteps(detail.steps);
    if (launchable.length > 0) {
      await launchSteps(detail.execution, launchable, options);
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }
    const waveState = withOrchestratorDatabase(dbPath, (db) => {
      const execution = getExecution(db, executionId);
      if (!execution) {
        return null;
      }
      const steps = listSteps(db, executionId);
      const activeWaves = [
        ...new Set(getActiveSteps(steps).map((step) => getStepWave(step))),
      ];
      for (const wave of activeWaves) {
        const state = applyWavePolicy(db, execution, steps, wave);
        if (state) {
          return state;
        }
      }
      return null;
    });
    if (waveState) {
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }
    return detail;
  }

  withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (execution) {
      reconcileCoordinationState(db, execution);
    }
  });

  const refreshed = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (SETTLED_EXECUTION_STATES.includes(refreshed.execution.state)) {
    return refreshed;
  }

  const nextSteps = getNextLaunchableSteps(refreshed.steps);
  if (nextSteps.length === 0) {
    return withOrchestratorDatabase(dbPath, (db) => {
      const execution = getExecution(db, executionId);
      const steps = listSteps(db, executionId);
      if (hasPlannedSteps(steps)) {
        const blockedWave = findBlockedWave(steps);
        if (blockedWave) {
          const existingEscalation = listEscalations(db, executionId).some(
            (item) =>
              item.status === "open" &&
              item.reason === "wave-blocked" &&
              Number(item.payload?.wave ?? -1) === blockedWave.wave,
          );
          if (!existingEscalation) {
            openEscalation(db, {
              execution,
              step: blockedWave.steps[0] ?? null,
              sourceStepId: blockedWave.steps[0]?.id ?? null,
              reason: "wave-blocked",
              payload: {
                wave: blockedWave.wave,
                waveName: blockedWave.waveName,
                policy: blockedWave.policy,
              },
            });
          }
          const heldExecution = holdExecutionRecord(
            execution,
            `wave-${blockedWave.wave}-blocked`,
          );
          updateExecution(db, heldExecution);
          emitWorkflowEvent(db, {
            executionId,
            type: "workflow.wave.escalated",
            payload: {
              wave: blockedWave.wave,
              waveName: blockedWave.waveName,
              reason: "wave-blocked",
            },
          });
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }
        return getExecutionDetail(executionId, dbPath, sessionDbPath);
      }
      const completed = transitionExecutionRecord(execution, "completed", {
        reviewStatus: execution.reviewStatus,
        approvalStatus: execution.approvalStatus,
      });
      updateExecution(db, completed);
      let finalizedExecution = completed;
      if (getExecutionProjectRole(execution) === "integrator") {
        finalizedExecution = updateExecutionPromotionSummary(db, completed, {
          status:
            completed.approvalStatus === "approved" ||
            completed.reviewStatus === "approved"
              ? "promotion_candidate"
              : "completed",
          mergeAllowed:
            getPromotionSummary(execution)?.mergeAllowed ??
            buildPromotionPolicySummary(execution).autoMergeToTarget,
          validationStatus: "completed",
          blockers: [],
        }).execution;
      }
      emitWorkflowEvent(db, {
        executionId,
        type: "workflow.execution.completed",
        payload: {
          reviewStatus: completed.reviewStatus,
          approvalStatus: completed.approvalStatus,
          promotion:
            getExecutionProjectRole(execution) === "integrator"
              ? getPromotionSummary(finalizedExecution)
              : null,
        },
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    });
  }

  await launchSteps(refreshed.execution, nextSteps, options);
  return getExecutionDetail(executionId, dbPath, sessionDbPath);
}

export async function driveExecution(executionId, options: LooseRecord = {}) {
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "1500"), 10);
  const timeoutMs = options.wait
    ? Number.parseInt(String(options.timeoutMs ?? "180000"), 10)
    : 0;
  let detail = await reconcileExecution(executionId, options);
  if (!options.wait) {
    return detail;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (SETTLED_EXECUTION_STATES.includes(detail.execution.state)) {
      return detail;
    }
    await sleep(intervalMs);
    detail = await reconcileExecution(executionId, options);
  }

  return detail;
}

export async function recordReviewDecision(
  executionId,
  payload,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  let branchRequest = null;
  const detail = withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    const reviewStep =
      steps.find((step) => step.state === "review_pending") ??
      steps.find((step) => step.reviewRequired);
    if (!reviewStep) {
      throw new Error(`no review-pending step for execution: ${executionId}`);
    }
    const review = createReviewRecord({
      executionId,
      stepId: reviewStep.id,
      status: payload.status,
      decidedBy: payload.decidedBy,
      comments: payload.comments,
    });
    insertReview(db, review);
    const auditContext = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      stepId: reviewStep.id,
      sessionId: reviewStep.sessionId,
      action: "execution:review",
      actor: auditContext.actor,
      source: auditContext.source,
      targetType: "step",
      targetId: reviewStep.id,
      payload: {
        status: payload.status,
        comments: payload.comments ?? "",
      },
      result: {
        status: "accepted",
      },
    });
    emitWorkflowEvent(db, {
      executionId,
      stepId: reviewStep.id,
      sessionId: reviewStep.sessionId,
      type: "workflow.review.recorded",
      payload: {
        status: payload.status,
        decidedBy: review.decidedBy,
        comments: review.comments,
      },
    });

    if (payload.status === "approved") {
      const updatedStep = transitionStepRecord(reviewStep, "approval_pending", {
        reviewStatus: payload.status,
        approvalStatus: reviewStep.approvalRequired ? "pending" : null,
      });
      updateStep(db, updatedStep);
      settleStepWorkspace(db, updatedStep, "settled", {
        finalState: updatedStep.state,
        sessionId: updatedStep.sessionId,
      });
      const nextExecutionState = reviewStep.approvalRequired
        ? "waiting_approval"
        : "running";
      const updatedExecution = transitionExecutionRecord(
        execution,
        nextExecutionState,
        {
          reviewStatus: payload.status,
          approvalStatus: reviewStep.approvalRequired
            ? "pending"
            : execution.approvalStatus,
        },
      );
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: reviewStep.id,
        sessionId: reviewStep.sessionId,
        type: "workflow.review.approved",
        payload: {
          nextState: nextExecutionState,
        },
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    const retryTarget = selectRetryTargetStep(steps, reviewStep, execution);

    if (
      payload.status === "changes_requested" &&
      retryTarget &&
      retryTarget.attemptCount < retryTarget.maxAttempts &&
      shouldBranchRework(execution)
    ) {
      const updatedStep = transitionStepRecord(reviewStep, "rejected", {
        reviewStatus: payload.status,
        approvalStatus: null,
      });
      updateStep(db, updatedStep);
      settleStepWorkspace(db, updatedStep, "failed", {
        finalState: updatedStep.state,
        sessionId: updatedStep.sessionId,
      });
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retryTarget.sequence,
        reviewStatus: payload.status,
        approvalStatus: null,
      });
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: reviewStep.id,
        sessionId: reviewStep.sessionId,
        type: "workflow.review.branch_requested",
        payload: {
          retryTargetStepId: retryTarget.id,
          retryTargetRole: retryTarget.role,
          branchRoles: deriveReworkRoles(
            steps,
            retryTarget,
            reviewStep,
            execution,
          ),
        },
      });
      branchRequest = {
        execution,
        gateStep: reviewStep,
        retryTarget,
        steps,
      };
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    if (
      payload.status === "changes_requested" &&
      retryTarget &&
      retryTarget.attemptCount < retryTarget.maxAttempts
    ) {
      const retriedTarget = scheduleRetry(
        retryTarget,
        execution,
        "changes_requested",
      );
      const resetSteps = resetDependentSteps(
        steps,
        execution,
        retriedTarget,
        reviewStep,
        "changes_requested",
      );
      const resetReviewStep = resetReviewGateStep(reviewStep, execution);
      updateStep(db, retriedTarget);
      for (const resetStep of resetSteps) {
        updateStep(db, resetStep);
      }
      updateStep(db, resetReviewStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retriedTarget.sequence,
        reviewStatus: payload.status,
        approvalStatus: null,
      });
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: retriedTarget.id,
        sessionId: retriedTarget.sessionId,
        type: "workflow.review.changes_requested",
        payload: {
          retryTargetStepId: retriedTarget.id,
          retryTargetRole: retriedTarget.role,
          nextAttempt: retriedTarget.attemptCount,
          nextSessionId: retriedTarget.sessionId,
          resetStepIds: resetSteps.map((step) => step.id),
        },
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    openEscalation(db, {
      execution,
      step: reviewStep,
      sourceStepId: reviewStep.id,
      reason:
        payload.status === "changes_requested"
          ? "changes-requested-exhausted"
          : "review-rejected",
      payload: {
        reviewStatus: payload.status,
        retryTargetStepId: retryTarget?.id ?? null,
      },
    });
    const updatedStep = transitionStepRecord(reviewStep, "rejected", {
      reviewStatus: payload.status,
      approvalStatus: null,
    });
    updateStep(db, updatedStep);
    settleStepWorkspace(db, updatedStep, "failed", {
      finalState: updatedStep.state,
      sessionId: updatedStep.sessionId,
    });
    const updatedExecution = transitionExecutionRecord(execution, "rejected", {
      reviewStatus: payload.status,
      approvalStatus: execution.approvalStatus,
    });
    updateExecution(db, updatedExecution);
    emitWorkflowEvent(db, {
      executionId,
      stepId: reviewStep.id,
      sessionId: reviewStep.sessionId,
      type: "workflow.review.rejected",
      payload: {
        status: payload.status,
      },
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
  if (branchRequest) {
    await branchForRework(
      branchRequest.execution,
      branchRequest.gateStep,
      branchRequest.retryTarget,
      payload,
      {
        dbPath,
        sessionDbPath,
        steps: branchRequest.steps,
      },
    );
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  }
  return detail;
}

export async function recordApprovalDecision(
  executionId,
  payload,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  let branchRequest = null;
  const detail = withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    const approvalStep =
      steps.find((step) => step.state === "approval_pending") ??
      steps.find((step) => step.approvalRequired);
    if (!approvalStep) {
      throw new Error(`no approval-pending step for execution: ${executionId}`);
    }
    const approval = createApprovalRecord({
      executionId,
      stepId: approvalStep.id,
      status: payload.status,
      decidedBy: payload.decidedBy,
      comments: payload.comments,
    });
    insertApproval(db, approval);
    const auditContext = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      stepId: approvalStep.id,
      sessionId: approvalStep.sessionId,
      action: "execution:approval",
      actor: auditContext.actor,
      source: auditContext.source,
      targetType: "step",
      targetId: approvalStep.id,
      payload: {
        status: payload.status,
        comments: payload.comments ?? "",
      },
      result: {
        status: "accepted",
      },
    });
    emitWorkflowEvent(db, {
      executionId,
      stepId: approvalStep.id,
      sessionId: approvalStep.sessionId,
      type: "workflow.approval.recorded",
      payload: {
        status: payload.status,
        decidedBy: approval.decidedBy,
        comments: approval.comments,
      },
    });

    if (payload.status === "approved") {
      const updatedStep = transitionStepRecord(approvalStep, "completed", {
        approvalStatus: payload.status,
      });
      updateStep(db, updatedStep);
      settleStepWorkspace(db, updatedStep, "settled", {
        finalState: updatedStep.state,
        sessionId: updatedStep.sessionId,
      });

      const remainingPlanned = steps.some((step) => step.state === "planned");
      const nextExecution = transitionExecutionRecord(
        execution,
        remainingPlanned ? "running" : "completed",
        {
          approvalStatus: payload.status,
          currentStepIndex: approvalStep.sequence + 1,
        },
      );
      updateExecution(db, nextExecution);
      if (getExecutionProjectRole(execution) === "integrator") {
        updateExecutionPromotionSummary(db, nextExecution, {
          status: remainingPlanned ? "running" : "promotion_candidate",
          validationStatus: remainingPlanned ? "pending" : "completed",
          blockers: [],
        });
      }
      emitWorkflowEvent(db, {
        executionId,
        stepId: approvalStep.id,
        sessionId: approvalStep.sessionId,
        type: "workflow.approval.approved",
        payload: {
          nextState: nextExecution.state,
        },
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    const retryTarget = selectRetryTargetStep(steps, approvalStep, execution);

    if (
      retryTarget &&
      retryTarget.attemptCount < retryTarget.maxAttempts &&
      shouldBranchRework(execution)
    ) {
      const updatedStep = transitionStepRecord(approvalStep, "rejected", {
        approvalStatus: payload.status,
      });
      updateStep(db, updatedStep);
      settleStepWorkspace(db, updatedStep, "failed", {
        finalState: updatedStep.state,
        sessionId: updatedStep.sessionId,
      });
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retryTarget.sequence,
        approvalStatus: payload.status,
      });
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: approvalStep.id,
        sessionId: approvalStep.sessionId,
        type: "workflow.approval.branch_requested",
        payload: {
          retryTargetStepId: retryTarget.id,
          retryTargetRole: retryTarget.role,
          branchRoles: deriveReworkRoles(
            steps,
            retryTarget,
            approvalStep,
            execution,
          ),
        },
      });
      branchRequest = {
        execution,
        gateStep: approvalStep,
        retryTarget,
        steps,
      };
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    if (retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts) {
      const retriedTarget = scheduleRetry(
        retryTarget,
        execution,
        "approval_rejected",
      );
      const resetSteps = resetDependentSteps(
        steps,
        execution,
        retriedTarget,
        approvalStep,
        "approval_rejected",
      );
      const resetApprovalStep = resetReviewGateStep(approvalStep, execution);
      updateStep(db, retriedTarget);
      for (const resetStep of resetSteps) {
        updateStep(db, resetStep);
      }
      updateStep(db, resetApprovalStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retriedTarget.sequence,
        approvalStatus: payload.status,
      });
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: retriedTarget.id,
        sessionId: retriedTarget.sessionId,
        type: "workflow.approval.rework_requested",
        payload: {
          retryTargetStepId: retriedTarget.id,
          retryTargetRole: retriedTarget.role,
          nextAttempt: retriedTarget.attemptCount,
          nextSessionId: retriedTarget.sessionId,
          resetStepIds: resetSteps.map((step) => step.id),
        },
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    openEscalation(db, {
      execution,
      step: approvalStep,
      sourceStepId: approvalStep.id,
      reason: "approval-rejected",
      payload: {
        approvalStatus: payload.status,
        retryTargetStepId: retryTarget?.id ?? null,
      },
    });
    const updatedStep = transitionStepRecord(approvalStep, "rejected", {
      approvalStatus: payload.status,
    });
    updateStep(db, updatedStep);
    settleStepWorkspace(db, updatedStep, "failed", {
      finalState: updatedStep.state,
      sessionId: updatedStep.sessionId,
    });
    const nextExecution = transitionExecutionRecord(execution, "rejected", {
      approvalStatus: payload.status,
      currentStepIndex: approvalStep.sequence,
    });
    updateExecution(db, nextExecution);
    emitWorkflowEvent(db, {
      executionId,
      stepId: approvalStep.id,
      sessionId: approvalStep.sessionId,
      type: "workflow.approval.rejected",
      payload: {
        status: payload.status,
      },
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
  if (branchRequest) {
    await branchForRework(
      branchRequest.execution,
      branchRequest.gateStep,
      branchRequest.retryTarget,
      payload,
      {
        dbPath,
        sessionDbPath,
        steps: branchRequest.steps,
      },
    );
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  }
  return detail;
}

export function resolveExecutionEscalation(
  executionId,
  escalationId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = DEFAULT_SESSION_DB_PATH,
) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const escalation = getEscalation(db, escalationId);
    if (!escalation || escalation.executionId !== executionId) {
      throw new Error(`escalation not found: ${escalationId}`);
    }
    if (escalation.status !== "open") {
      throw new Error(
        `escalation is already ${escalation.status}: ${escalationId}`,
      );
    }

    const resolvedEscalation = transitionEscalationRecord(
      escalation,
      "resolved",
      {
        payload: {
          ...escalation.payload,
          resolution: {
            decidedBy: payload.decidedBy ?? "operator",
            comments: payload.comments ?? "",
            resume: payload.resume === true,
          },
        },
      },
    );
    updateEscalation(db, resolvedEscalation);
    const auditContext = buildAuditContext(payload);
    emitAuditEvent(db, {
      executionId,
      stepId: escalation.stepId ?? escalation.sourceStepId ?? null,
      action: "execution:resolve-escalation",
      actor: auditContext.actor,
      source: auditContext.source,
      targetType: "escalation",
      targetId: escalationId,
      payload: {
        resume: payload.resume === true,
        comments: payload.comments ?? "",
      },
      result: {
        status: "accepted",
      },
    });
    emitWorkflowEvent(db, {
      executionId,
      stepId: escalation.stepId ?? escalation.sourceStepId ?? null,
      type: "workflow.escalation.resolved",
      payload: {
        escalationId,
        decidedBy: payload.decidedBy ?? "operator",
        resume: payload.resume === true,
        comments: payload.comments ?? "",
      },
    });

    if (payload.resume === true) {
      const targetStepId = escalation.stepId ?? escalation.sourceStepId;
      if (!targetStepId) {
        throw new Error(`escalation has no target step: ${escalationId}`);
      }
      const targetStep = getStep(db, targetStepId);
      if (!targetStep) {
        throw new Error(`step not found for escalation: ${targetStepId}`);
      }
      const resumedStep = prepareOperatorResumeStep(targetStep, execution);
      updateStep(db, resumedStep);
      const resumedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: resumedStep.sequence,
        endedAt: null,
      });
      updateExecution(db, resumedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: resumedStep.id,
        sessionId: resumedStep.sessionId,
        type: "workflow.execution.resumed",
        payload: {
          escalationId,
          resumedStepId: resumedStep.id,
          resumedRole: resumedStep.role,
          nextAttempt: resumedStep.attemptCount,
          nextSessionId: resumedStep.sessionId,
        },
      });
    }

    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}
