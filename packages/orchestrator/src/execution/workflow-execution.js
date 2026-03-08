import { spawn } from "node:child_process";

import { getSession, openSessionDatabase } from "../../../session-manager/src/store/session-store.js";
import { DEFAULT_SESSION_DB_PATH } from "../../../session-manager/src/metadata/constants.js";
import {
  appendControlMessage,
  readControlMessagesFromOffset
} from "../../../runtime-pi/src/control/session-control-queue.js";
import {
  createApprovalRecord,
  createEscalationRecord,
  createExecutionRecord,
  createReviewRecord,
  createStepRecord,
  createWorkflowEventRecord,
  transitionEscalationRecord,
  transitionExecutionRecord,
  transitionStepRecord
} from "../lifecycle/execution-lifecycle.js";
import { DEFAULT_ORCHESTRATOR_DB_PATH, PROJECT_ROOT } from "../metadata/constants.js";
import {
  getExecution,
  getEscalation,
  getStep,
  insertApproval,
  insertEscalation,
  insertExecutionWithSteps,
  insertReview,
  insertWorkflowEvent,
  listApprovals,
  listChildExecutions,
  listEscalations,
  listExecutionGroup,
  listExecutions,
  listWorkflowEvents,
  listReviews,
  listSteps,
  openOrchestratorDatabase,
  updateEscalation,
  updateExecution,
  updateStep
} from "../store/execution-store.js";
import { writeExecutionBrief } from "./brief.js";
import { planWorkflowInvocation } from "../invocation/plan-workflow-invocation.js";

const DEFAULT_STEP_SOFT_TIMEOUT_MS = 20_000;
const DEFAULT_STEP_HARD_TIMEOUT_MS = 45_000;
const SETTLED_EXECUTION_STATES = ["waiting_review", "waiting_approval", "completed", "failed", "rejected", "canceled", "paused", "held"];
const TERMINAL_EXECUTION_STATES = new Set(["completed", "failed", "rejected", "canceled"]);
const GOVERNANCE_EXECUTION_STATES = new Set(["waiting_review", "waiting_approval"]);

function runCli(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

function buildRetriedSessionId(execution, step, nextAttempt) {
  const scope = execution.domainId ?? "shared";
  return `${execution.id}-${scope}-${step.role}-${step.sequence + 1}-r${nextAttempt}`;
}

function emitWorkflowEvent(db, { executionId, stepId = null, sessionId = null, type, payload = {} }) {
  const event = createWorkflowEventRecord({
    executionId,
    stepId,
    sessionId,
    type,
    payload
  });
  insertWorkflowEvent(db, event);
  return event;
}

function openEscalation(db, { execution, step, sourceStepId = null, reason, payload = {}, targetRole = "lead" }) {
  const escalation = createEscalationRecord({
    executionId: execution.id,
    stepId: step?.id ?? null,
    sourceStepId,
    targetRole,
    reason,
    payload
  });
  insertEscalation(db, escalation);
  emitWorkflowEvent(db, {
    executionId: execution.id,
    stepId: step?.id ?? null,
    sessionId: step?.sessionId ?? null,
    type: "workflow.execution.escalated",
    payload: {
      escalationId: escalation.id,
      targetRole,
      reason,
      ...payload
    }
  });
  return escalation;
}

function scheduleRetry(step, execution, reason) {
  const nextAttempt = step.attemptCount + 1;
  return transitionStepRecord(step, "planned", {
    attemptCount: nextAttempt,
    sessionId: buildRetriedSessionId(execution, step, nextAttempt),
    lastError: reason ?? step.lastError ?? null,
    launchedAt: null,
    settledAt: null
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
    lastError: null
  });
}

function prepareOperatorResumeStep(step, execution, reason = "operator_resumed") {
  const nextAttempt = step.attemptCount + 1;
  return transitionStepRecord(step, "planned", {
    attemptCount: nextAttempt,
    maxAttempts: Math.max(step.maxAttempts, nextAttempt),
    sessionId: buildRetriedSessionId(execution, step, nextAttempt),
    lastError: reason,
    reviewStatus: step.reviewRequired ? "pending" : step.reviewStatus,
    approvalStatus: step.approvalRequired ? "pending" : step.approvalStatus,
    launchedAt: null,
    settledAt: null
  });
}

function isTerminalExecutionState(state) {
  return TERMINAL_EXECUTION_STATES.has(state);
}

function isGovernanceExecutionState(state) {
  return GOVERNANCE_EXECUTION_STATES.has(state);
}

function isExecutionDispatchBlocked(state) {
  return ["paused", "held"].includes(state);
}

function blockingChildren(children) {
  return children.filter((child) => !isTerminalExecutionState(child.state));
}

function holdExecutionRecord(execution, reason, nextState = "held") {
  return transitionExecutionRecord(execution, nextState, {
    heldFromState: nextState === "held" ? execution.state : execution.heldFromState,
    holdReason: reason,
    pausedAt: nextState === "paused" ? new Date().toISOString() : null,
    heldAt: nextState === "held" ? new Date().toISOString() : execution.heldAt,
    resumedAt: execution.resumedAt
  });
}

function resumeExecutionRecord(execution) {
  const resumedState = execution.heldFromState ?? "running";
  return transitionExecutionRecord(execution, resumedState, {
    heldFromState: null,
    holdReason: null,
    pausedAt: null,
    heldAt: null,
    resumedAt: new Date().toISOString(),
    endedAt: null
  });
}

function getStepAgeMs(step) {
  const reference = step.launchedAt ?? step.createdAt ?? null;
  if (!reference) {
    return 0;
  }
  const parsed = Date.parse(reference);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(0, Date.now() - parsed);
}

function getStepPolicy(step) {
  return step?.policy ?? {};
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
      fallback
    ),
    10
  );
}

async function hasControlAction(sessionId, action, source = "orchestrator") {
  const chunk = await readControlMessagesFromOffset(sessionId, 0);
  return chunk.entries.some(
    (entry) => entry?.payload?.action === action && entry?.payload?.source === source
  );
}

async function applyActiveStepWatchdog(execution, step, session, options = {}) {
  if (!session || session.state !== "active") {
    return null;
  }

  const softTimeoutMs = resolveWatchdogThreshold(
    options,
    execution,
    step,
    "stepSoftTimeoutMs",
    DEFAULT_STEP_SOFT_TIMEOUT_MS
  );
  const hardTimeoutMs = resolveWatchdogThreshold(
    options,
    execution,
    step,
    "stepHardTimeoutMs",
    DEFAULT_STEP_HARD_TIMEOUT_MS
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
        ageMs
      });
      return {
        kind: "hard-timeout-abort",
        ageMs,
        control: record
      };
    }
    return {
      kind: "hard-timeout-pending",
      ageMs
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
        ageMs
      });
      return {
        kind: "soft-timeout-steer",
        ageMs,
        control: record
      };
    }
  }

  return null;
}

export function createExecution(invocation, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const existing = getExecution(db, invocation.invocationId);
    if (existing) {
      throw new Error(`execution already exists: ${invocation.invocationId}`);
    }
    const execution = createExecutionRecord(invocation);
    const steps = invocation.launches.map((launch, index) => createStepRecord(execution.id, launch, index));
    insertExecutionWithSteps(db, execution, steps);
    if (execution.parentExecutionId) {
      const parentExecution = getExecution(db, execution.parentExecutionId);
      if (parentExecution && !isTerminalExecutionState(parentExecution.state)) {
        const heldParent = holdExecutionRecord(parentExecution, "waiting_for_child_executions");
        updateExecution(db, heldParent);
        emitWorkflowEvent(db, {
          executionId: parentExecution.id,
          type: "workflow.execution.held",
          payload: {
            reason: "waiting_for_child_executions",
            coordinationGroupId: execution.coordinationGroupId,
            childExecutionId: execution.id
          }
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
        policy: execution.policy ?? {}
      }
    });
    for (const step of steps) {
      emitWorkflowEvent(db, {
        executionId: execution.id,
        stepId: step.id,
        sessionId: step.sessionId,
        type: "workflow.step.planned",
        payload: {
          sequence: step.sequence,
          role: step.role,
          requestedProfileId: step.requestedProfileId,
          sessionMode: step.sessionMode,
          attemptCount: step.attemptCount,
          maxAttempts: step.maxAttempts,
          policy: step.policy ?? {}
        }
      });
    }
    return { execution, steps };
  });
}

export function getExecutionDetail(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
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
    const childExecutions = listChildExecutions(db, executionId);
    const coordinationGroup = execution.coordinationGroupId
      ? listExecutionGroup(db, execution.coordinationGroupId)
      : [execution];
    const sessions = withSessionDatabase(sessionDbPath, (sessionDb) =>
      steps
        .filter((step) => step.sessionId)
        .map((step) => ({ sessionId: step.sessionId, session: getSession(sessionDb, step.sessionId) }))
        .filter((item) => item.session)
    );
    return {
      execution,
      steps,
      reviews,
      approvals,
      events,
      escalations,
      childExecutions,
      coordinationGroup,
      sessions
    };
  });
}

export function listExecutionEvents(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listWorkflowEvents(db, executionId);
  });
}

export function listExecutionEscalations(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listEscalations(db, executionId);
  });
}

export function listExecutionChildren(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    return listChildExecutions(db, executionId);
  });
}

export function listCoordinationGroup(groupId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => listExecutionGroup(db, groupId));
}

export function listExecutionSummaries(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => listExecutions(db));
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
    rootExecutionIds: executions.filter((item) => !item.parentExecutionId).map((item) => item.id),
    childExecutionIds: executions.filter((item) => item.parentExecutionId).map((item) => item.id),
    activeExecutionIds: executions.filter((item) => !SETTLED_EXECUTION_STATES.includes(item.state)).map((item) => item.id),
    heldExecutionIds: executions.filter((item) => ["paused", "held"].includes(item.state)).map((item) => item.id),
    executions
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
      .map(([groupId, executions]) => summarizeCoordinationGroupExecutions(groupId, executions))
      .sort((left, right) => {
        const leftUpdated = Math.max(...left.executions.map((item) => Date.parse(item.updatedAt ?? item.startedAt ?? item.endedAt ?? 0) || 0));
        const rightUpdated = Math.max(...right.executions.map((item) => Date.parse(item.updatedAt ?? item.startedAt ?? item.endedAt ?? 0) || 0));
        return rightUpdated - leftUpdated;
      });
  });
}

export function getCoordinationGroupDetail(groupId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const executions = listExecutionGroup(db, groupId);
    if (executions.length === 0) {
      return null;
    }
    const details = executions.map((execution) => getExecutionDetail(execution.id, dbPath, sessionDbPath));
    return {
      summary: summarizeCoordinationGroupExecutions(groupId, executions),
      details
    };
  });
}

async function emitBranchEvents(parentExecutionId, childExecutionId, branchKey, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    emitWorkflowEvent(db, {
      executionId: parentExecutionId,
      type: "workflow.execution.child_planned",
      payload: {
        childExecutionId,
        branchKey
      }
    });
    emitWorkflowEvent(db, {
      executionId: childExecutionId,
      type: "workflow.execution.branched",
      payload: {
        parentExecutionId,
        branchKey
      }
    });
  });
}

export async function branchExecution(parentExecutionId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  const parent = getExecutionDetail(parentExecutionId, dbPath, sessionDbPath);
  if (!parent) {
    throw new Error(`parent execution not found: ${parentExecutionId}`);
  }

  const roles = Array.isArray(payload.roles) && payload.roles.length > 0
    ? payload.roles
    : null;
  const invocation = await planWorkflowInvocation({
    workflowPath: payload.workflowPath ?? parent.execution.workflowPath,
    projectPath: payload.projectPath ?? parent.execution.projectPath,
    domainId: payload.domainId ?? parent.execution.domainId ?? null,
    roles,
    maxRoles: Number.parseInt(String(payload.maxRoles ?? roles?.length ?? 1), 10),
    invocationId: payload.invocationId ?? `branch-${parentExecutionId}-${Date.now()}`,
    objective: payload.objective ?? parent.execution.objective,
    coordinationGroupId: payload.coordinationGroupId ?? parent.execution.coordinationGroupId ?? parent.execution.id,
    parentExecutionId,
    branchKey: payload.branchKey ?? `${payload.domainId ?? parent.execution.domainId ?? "shared"}-${Date.now()}`
  });

  const created = createExecution(invocation, dbPath);
  await emitBranchEvents(parentExecutionId, invocation.invocationId, invocation.coordination.branchKey, dbPath);
  const detail = payload.wait
    ? await driveExecution(invocation.invocationId, {
      wait: true,
      timeoutMs: payload.timeoutMs ?? "180000",
      intervalMs: payload.intervalMs ?? "1500",
      noMonitor: payload.noMonitor ?? false,
      stub: payload.stub ?? false,
      launcher: payload.launcher ?? null,
      stepSoftTimeoutMs: payload.stepSoftTimeoutMs ?? null,
      stepHardTimeoutMs: payload.stepHardTimeoutMs ?? null
    })
    : getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);

  return {
    invocation,
    created,
    detail
  };
}

export const forkExecution = branchExecution;

function assertHoldableExecution(execution, steps, action) {
  if (["completed", "canceled"].includes(execution.state)) {
    throw new Error(`cannot ${action} terminal execution: ${execution.id}`);
  }
  assertNoActiveStep(steps, execution.id, action);
}

export function holdExecution(executionId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
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
    const heldExecution = transitionExecutionRecord(execution, "held", {
      heldFromState: execution.state,
      holdReason: payload.reason ?? "operator hold",
      heldAt: new Date().toISOString(),
      endedAt: null
    });
    updateExecution(db, heldExecution);
    emitWorkflowEvent(db, {
      executionId,
      type: "workflow.execution.held",
      payload: {
        decidedBy: payload.decidedBy ?? "operator",
        reason: heldExecution.holdReason,
        heldFromState: execution.state
      }
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function pauseExecution(executionId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
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
    const pausedExecution = transitionExecutionRecord(execution, "paused", {
      heldFromState: execution.state,
      holdReason: payload.reason ?? "execution paused",
      pausedAt: new Date().toISOString(),
      endedAt: null
    });
    updateExecution(db, pausedExecution);
    emitWorkflowEvent(db, {
      executionId,
      type: "workflow.execution.paused",
      payload: {
        decidedBy: payload.decidedBy ?? "operator",
        reason: pausedExecution.holdReason,
        pausedFromState: execution.state
      }
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function resumeExecution(executionId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
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
    const hasReviewPending = steps.some((step) => step.state === "review_pending");
    const hasApprovalPending = steps.some((step) => step.state === "approval_pending");
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
      pausedAt: null,
      heldAt: null,
      resumedAt: new Date().toISOString(),
      endedAt: null
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
        reason: payload.reason ?? payload.comments ?? "operator resume"
      }
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export async function driveCoordinationGroup(groupId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "1500"), 10);
  const timeoutMs = options.wait ? Number.parseInt(String(options.timeoutMs ?? "180000"), 10) : 0;
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
    if (detail.details.every((item) => SETTLED_EXECUTION_STATES.includes(item.execution.state))) {
      return detail;
    }
    await sleep(intervalMs);
    detail = await step();
  }

  return detail;
}

function getFirstPlannedStep(steps) {
  return steps.find((step) => step.state === "planned") ?? null;
}

function assertNoActiveStep(steps, executionId, action) {
  const activeStep = steps.find((step) => ["active", "launching"].includes(step.state));
  if (activeStep) {
    throw new Error(`cannot ${action} execution with active step: ${executionId}`);
  }
}

async function launchStep(execution, step, options = {}) {
  const briefPath = await writeExecutionBrief(execution, step);
  const previousStep = step.sequence > 0
    ? withOrchestratorDatabase(options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH, (db) => listSteps(db, execution.id)[step.sequence - 1] ?? null)
    : null;
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
    execution.workflowId
  ];
  const contextQuery = getStepPolicy(step)?.docsKbPolicy?.query ?? getExecutionPolicy(execution)?.docsKbPolicy?.queryTerms?.join(" ") ?? null;
  const contextQueryTerms = getStepPolicy(step)?.docsKbPolicy?.queryTerms ?? getExecutionPolicy(execution)?.docsKbPolicy?.queryTerms ?? [];
  const contextLimit = getStepPolicy(step)?.docsKbPolicy?.resultLimit ?? getExecutionPolicy(execution)?.docsKbPolicy?.resultLimit ?? null;
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

  return withOrchestratorDatabase(options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH, (db) => {
    const currentExecution = getExecution(db, execution.id);
    const currentStep = getStep(db, step.id);
    const updatedStep = transitionStepRecord(currentStep, "active", {
      parentSessionId,
      launchedAt: new Date().toISOString()
    });
    updateStep(db, updatedStep);
    const updatedExecution = transitionExecutionRecord(currentExecution, "running", {
      currentStepIndex: currentStep.sequence,
      startedAt: currentExecution.startedAt ?? new Date().toISOString()
    });
    updateExecution(db, updatedExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      stepId: updatedStep.id,
      sessionId: updatedStep.sessionId,
      type: "workflow.step.started",
      payload: {
        sequence: updatedStep.sequence,
        role: updatedStep.role,
        sessionMode: updatedStep.sessionMode,
        attemptCount: updatedStep.attemptCount,
        maxAttempts: updatedStep.maxAttempts,
        parentSessionId,
        briefPath,
        policy: updatedStep.policy ?? {}
      }
    });
    return {
      execution: updatedExecution,
      step: updatedStep,
      runtime,
      briefPath
    };
  });
}

function settleStepFromSession(step, session) {
  if (!session) {
    return null;
  }
  if (session.state === "completed") {
    if (step.reviewRequired) {
      return transitionStepRecord(step, "review_pending", {
        reviewStatus: step.reviewStatus ?? "pending",
        approvalStatus: step.approvalRequired ? step.approvalStatus ?? "pending" : null
      });
    }
    return transitionStepRecord(step, "completed");
  }
  if (["failed", "stopped", "canceled"].includes(session.state)) {
    return transitionStepRecord(step, session.state === "stopped" ? "stopped" : "failed");
  }
  return null;
}

function reconcileCoordinationState(db, execution) {
  const children = listChildExecutions(db, execution.id);
  if (children.length === 0) {
    return execution;
  }

  const blocking = blockingChildren(children);
  if (blocking.length > 0 && execution.state !== "held") {
    const heldExecution = holdExecutionRecord(execution, "waiting_for_child_executions");
    updateExecution(db, heldExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.held",
      payload: {
        reason: "waiting_for_child_executions",
        blockingChildren: blocking.map((child) => ({
          executionId: child.id,
          state: child.state
        }))
      }
    });
    return heldExecution;
  }

  if (blocking.length === 0 && execution.state === "held" && execution.holdReason === "waiting_for_child_executions") {
    const resumedExecution = resumeExecutionRecord(execution);
    updateExecution(db, resumedExecution);
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.resumed",
      payload: {
        source: "coordination",
        reason: "child_executions_settled",
        coordinationGroupId: execution.coordinationGroupId
      }
    });
    return resumedExecution;
  }

  return execution;
}

export async function reconcileExecution(executionId, options = {}) {
  const dbPath = options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH;
  const sessionDbPath = options.sessionDbPath ?? DEFAULT_SESSION_DB_PATH;

  let detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    throw new Error(`execution not found: ${executionId}`);
  }

  withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (execution) {
      reconcileCoordinationState(db, execution);
    }
  });

  detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    throw new Error(`execution not found after coordination reconcile: ${executionId}`);
  }

  if (SETTLED_EXECUTION_STATES.includes(detail.execution.state)) {
    return detail;
  }

  const activeStep = detail.steps.find((step) => ["active", "launching"].includes(step.state));
  if (activeStep) {
    const session = withSessionDatabase(sessionDbPath, (db) => getSession(db, activeStep.sessionId));
    await applyActiveStepWatchdog(detail.execution, activeStep, session, options);
    const settledStep = settleStepFromSession(activeStep, session);
    if (settledStep) {
      return withOrchestratorDatabase(dbPath, (db) => {
        const execution = getExecution(db, executionId);
        const dispatchBlocked = isExecutionDispatchBlocked(execution.state);
        if (["failed", "stopped"].includes(settledStep.state)) {
          const retryAllowed = activeStep.attemptCount < activeStep.maxAttempts;
          if (retryAllowed) {
            const retriedStep = scheduleRetry(activeStep, execution, settledStep.state);
            updateStep(db, retriedStep);
            const runningExecution = transitionExecutionRecord(execution, dispatchBlocked ? execution.state : "running", {
              currentStepIndex: activeStep.sequence
            });
            updateExecution(db, runningExecution);
            emitWorkflowEvent(db, {
              executionId,
              stepId: activeStep.id,
              sessionId: activeStep.sessionId,
              type: "workflow.step.retry_scheduled",
              payload: {
                reason: settledStep.state,
                nextAttempt: retriedStep.attemptCount,
                maxAttempts: retriedStep.maxAttempts,
                nextSessionId: retriedStep.sessionId
              }
            });
            return getExecutionDetail(executionId, dbPath, sessionDbPath);
          }
          updateStep(db, settledStep);
          openEscalation(db, {
            execution,
            step: settledStep,
            sourceStepId: settledStep.id,
            reason: "retry-exhausted",
            payload: {
              finalState: settledStep.state,
              attemptCount: settledStep.attemptCount,
              maxAttempts: settledStep.maxAttempts
            }
          });
          const failedExecution = transitionExecutionRecord(execution, "failed", {
            currentStepIndex: activeStep.sequence
          });
          updateExecution(db, failedExecution);
          emitWorkflowEvent(db, {
            executionId,
            stepId: settledStep.id,
            sessionId: settledStep.sessionId,
            type: "workflow.step.failed",
            payload: {
              finalState: settledStep.state,
              attemptCount: settledStep.attemptCount,
              maxAttempts: settledStep.maxAttempts
            }
          });
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }
        updateStep(db, settledStep);
        if (settledStep.state === "review_pending") {
          const waitingReview = transitionExecutionRecord(
            execution,
            dispatchBlocked ? execution.state : "waiting_review",
            {
            currentStepIndex: activeStep.sequence,
            reviewStatus: "pending",
            approvalStatus: settledStep.approvalRequired ? "pending" : null
            }
          );
          updateExecution(db, waitingReview);
          emitWorkflowEvent(db, {
            executionId,
            stepId: settledStep.id,
            sessionId: settledStep.sessionId,
            type: "workflow.step.review_pending",
            payload: {
              sequence: settledStep.sequence,
              role: settledStep.role,
              dispatchBlocked
            }
          });
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }
        const completedExecution = transitionExecutionRecord(execution, dispatchBlocked ? execution.state : "running", {
          currentStepIndex: activeStep.sequence + 1
        });
        updateExecution(db, completedExecution);
        emitWorkflowEvent(db, {
          executionId,
          stepId: settledStep.id,
          sessionId: settledStep.sessionId,
          type: "workflow.step.completed",
          payload: {
            sequence: settledStep.sequence,
            role: settledStep.role,
            attemptCount: settledStep.attemptCount
          }
        });
        return getExecutionDetail(executionId, dbPath, sessionDbPath);
      });
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

  const nextStep = getFirstPlannedStep(refreshed.steps);
  if (!nextStep) {
    return withOrchestratorDatabase(dbPath, (db) => {
      const execution = getExecution(db, executionId);
      const completed = transitionExecutionRecord(execution, "completed", {
        reviewStatus: execution.reviewStatus,
        approvalStatus: execution.approvalStatus
      });
      updateExecution(db, completed);
      emitWorkflowEvent(db, {
        executionId,
        type: "workflow.execution.completed",
        payload: {
          reviewStatus: completed.reviewStatus,
          approvalStatus: completed.approvalStatus
        }
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    });
  }

  await launchStep(refreshed.execution, nextStep, options);
  return getExecutionDetail(executionId, dbPath, sessionDbPath);
}

export async function driveExecution(executionId, options = {}) {
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "1500"), 10);
  const timeoutMs = options.wait ? Number.parseInt(String(options.timeoutMs ?? "180000"), 10) : 0;
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

export function recordReviewDecision(executionId, payload, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    const reviewStep = steps.find((step) => step.state === "review_pending") ?? steps.find((step) => step.reviewRequired);
    if (!reviewStep) {
      throw new Error(`no review-pending step for execution: ${executionId}`);
    }
    const review = createReviewRecord({
      executionId,
      stepId: reviewStep.id,
      status: payload.status,
      decidedBy: payload.decidedBy,
      comments: payload.comments
    });
    insertReview(db, review);
    emitWorkflowEvent(db, {
      executionId,
      stepId: reviewStep.id,
      sessionId: reviewStep.sessionId,
      type: "workflow.review.recorded",
      payload: {
        status: payload.status,
        decidedBy: review.decidedBy,
        comments: review.comments
      }
    });

    if (payload.status === "approved") {
      const updatedStep = transitionStepRecord(reviewStep, "approval_pending", {
        reviewStatus: payload.status,
        approvalStatus: reviewStep.approvalRequired ? "pending" : null
      });
      updateStep(db, updatedStep);
      const nextExecutionState = reviewStep.approvalRequired ? "waiting_approval" : "running";
      const updatedExecution = transitionExecutionRecord(execution, nextExecutionState, {
        reviewStatus: payload.status,
        approvalStatus: reviewStep.approvalRequired ? "pending" : execution.approvalStatus
      });
      updateExecution(db, updatedExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: reviewStep.id,
        sessionId: reviewStep.sessionId,
        type: "workflow.review.approved",
        payload: {
          nextState: nextExecutionState
        }
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    const retryTarget = [...steps]
      .filter((step) => step.sequence < reviewStep.sequence && !step.reviewRequired)
      .reverse()
      .find(Boolean);

    if (payload.status === "changes_requested" && retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts) {
      const retriedTarget = scheduleRetry(retryTarget, execution, "changes_requested");
      const resetReviewStep = resetReviewGateStep(reviewStep, execution);
      updateStep(db, retriedTarget);
      updateStep(db, resetReviewStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retriedTarget.sequence,
        reviewStatus: payload.status,
        approvalStatus: null
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
          nextSessionId: retriedTarget.sessionId
        }
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    openEscalation(db, {
      execution,
      step: reviewStep,
      sourceStepId: reviewStep.id,
      reason: payload.status === "changes_requested" ? "changes-requested-exhausted" : "review-rejected",
      payload: {
        reviewStatus: payload.status,
        retryTargetStepId: retryTarget?.id ?? null
      }
    });
    const updatedStep = transitionStepRecord(reviewStep, "rejected", {
      reviewStatus: payload.status,
      approvalStatus: null
    });
    updateStep(db, updatedStep);
    const updatedExecution = transitionExecutionRecord(execution, "rejected", {
      reviewStatus: payload.status,
      approvalStatus: execution.approvalStatus
    });
    updateExecution(db, updatedExecution);
    emitWorkflowEvent(db, {
      executionId,
      stepId: reviewStep.id,
      sessionId: reviewStep.sessionId,
      type: "workflow.review.rejected",
      payload: {
        status: payload.status
      }
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function recordApprovalDecision(executionId, payload, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      throw new Error(`execution not found: ${executionId}`);
    }
    const steps = listSteps(db, executionId);
    const approvalStep = steps.find((step) => step.state === "approval_pending") ?? steps.find((step) => step.approvalRequired);
    if (!approvalStep) {
      throw new Error(`no approval-pending step for execution: ${executionId}`);
    }
    const approval = createApprovalRecord({
      executionId,
      stepId: approvalStep.id,
      status: payload.status,
      decidedBy: payload.decidedBy,
      comments: payload.comments
    });
    insertApproval(db, approval);
    emitWorkflowEvent(db, {
      executionId,
      stepId: approvalStep.id,
      sessionId: approvalStep.sessionId,
      type: "workflow.approval.recorded",
      payload: {
        status: payload.status,
        decidedBy: approval.decidedBy,
        comments: approval.comments
      }
    });

    if (payload.status === "approved") {
      const updatedStep = transitionStepRecord(approvalStep, "completed", {
        approvalStatus: payload.status
      });
      updateStep(db, updatedStep);

      const remainingPlanned = steps.some((step) => step.state === "planned");
      const nextExecution = transitionExecutionRecord(execution, remainingPlanned ? "running" : "completed", {
        approvalStatus: payload.status,
        currentStepIndex: approvalStep.sequence + 1
      });
      updateExecution(db, nextExecution);
      emitWorkflowEvent(db, {
        executionId,
        stepId: approvalStep.id,
        sessionId: approvalStep.sessionId,
        type: "workflow.approval.approved",
        payload: {
          nextState: nextExecution.state
        }
      });
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    const retryTarget = [...steps]
      .filter((step) => step.sequence < approvalStep.sequence && !step.reviewRequired)
      .reverse()
      .find(Boolean);

    if (retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts) {
      const retriedTarget = scheduleRetry(retryTarget, execution, "approval_rejected");
      const resetApprovalStep = resetReviewGateStep(approvalStep, execution);
      updateStep(db, retriedTarget);
      updateStep(db, resetApprovalStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retriedTarget.sequence,
        approvalStatus: payload.status
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
          nextSessionId: retriedTarget.sessionId
        }
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
        retryTargetStepId: retryTarget?.id ?? null
      }
    });
    const updatedStep = transitionStepRecord(approvalStep, "rejected", {
      approvalStatus: payload.status
    });
    updateStep(db, updatedStep);
    const nextExecution = transitionExecutionRecord(execution, "rejected", {
      approvalStatus: payload.status,
      currentStepIndex: approvalStep.sequence
    });
    updateExecution(db, nextExecution);
    emitWorkflowEvent(db, {
      executionId,
      stepId: approvalStep.id,
      sessionId: approvalStep.sessionId,
      type: "workflow.approval.rejected",
      payload: {
        status: payload.status
      }
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}

export function resolveExecutionEscalation(executionId, escalationId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
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
      throw new Error(`escalation is already ${escalation.status}: ${escalationId}`);
    }

    const resolvedEscalation = transitionEscalationRecord(escalation, "resolved", {
      payload: {
        ...escalation.payload,
        resolution: {
          decidedBy: payload.decidedBy ?? "operator",
          comments: payload.comments ?? "",
          resume: payload.resume === true
        }
      }
    });
    updateEscalation(db, resolvedEscalation);
    emitWorkflowEvent(db, {
      executionId,
      stepId: escalation.stepId ?? escalation.sourceStepId ?? null,
      type: "workflow.escalation.resolved",
      payload: {
        escalationId,
        decidedBy: payload.decidedBy ?? "operator",
        resume: payload.resume === true,
        comments: payload.comments ?? ""
      }
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
        endedAt: null
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
          nextSessionId: resumedStep.sessionId
        }
      });
    }

    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  });
}
