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
const ACTIVE_STEP_STATES = new Set(["active", "launching"]);
const WAVE_SUCCESS_STEP_STATES = new Set(["completed"]);

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
    holdOwner: execution.holdOwner,
    holdGuidance: execution.holdGuidance,
    holdExpiresAt: execution.holdExpiresAt,
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
    holdOwner: null,
    holdGuidance: null,
    holdExpiresAt: null,
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

function getStepWave(step) {
  return Number.isInteger(step?.wave) ? step.wave : step?.sequence ?? 0;
}

function getActiveSteps(steps) {
  return steps.filter((step) => ACTIVE_STEP_STATES.has(step.state));
}

function getWaveGate(steps, wave) {
  const waveStep = steps.find((step) => getStepWave(step) === wave) ?? null;
  return getStepPolicy(waveStep)?.workflowPolicy?.waveGate ?? { mode: "all" };
}

function isWaveSatisfied(steps, wave) {
  const waveSteps = steps.filter((step) => getStepWave(step) === wave);
  if (waveSteps.length === 0) {
    return true;
  }
  const gate = getWaveGate(steps, wave);
  const successCount = waveSteps.filter((step) => WAVE_SUCCESS_STEP_STATES.has(step.state)).length;
  const mode = gate?.mode ?? "all";
  if (mode === "any") {
    return successCount >= 1;
  }
  if (mode === "min_success_count") {
    const target = Math.max(1, Number.parseInt(String(gate?.count ?? 1), 10));
    return successCount >= target;
  }
  return successCount >= waveSteps.length;
}

function getNextLaunchableSteps(steps) {
  const planned = steps.filter((step) => step.state === "planned");
  if (planned.length === 0) {
    return [];
  }
  const candidateWaves = [...new Set(planned.map((step) => getStepWave(step)))].sort((left, right) => left - right);
  for (const wave of candidateWaves) {
    const lowerWaves = [...new Set(steps.map((step) => getStepWave(step)).filter((value) => value < wave))];
    if (lowerWaves.every((value) => isWaveSatisfied(steps, value))) {
      return planned.filter((step) => getStepWave(step) === wave).sort((left, right) => left.sequence - right.sequence);
    }
  }
  return [];
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

function buildHoldMetadata(execution, payload = {}, nextState = "held") {
  const timeoutMs = payload.timeoutMs ? Number.parseInt(String(payload.timeoutMs), 10) : null;
  const now = Date.now();
  return {
    heldFromState: execution.state,
    holdReason: payload.reason ?? (nextState === "paused" ? "execution paused" : "operator hold"),
    holdOwner: payload.owner ?? payload.decidedBy ?? "operator",
    holdGuidance: payload.guidance ?? payload.comments ?? null,
    holdExpiresAt: timeoutMs && timeoutMs > 0 ? new Date(now + timeoutMs).toISOString() : null,
    pausedAt: nextState === "paused" ? new Date(now).toISOString() : null,
    heldAt: nextState === "held" ? new Date(now).toISOString() : execution.heldAt,
    endedAt: null
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
  const preferredRole = getExecutionPolicy(execution)?.workflowPolicy?.retryTargetRole ?? null;
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
  return getExecutionPolicy(execution)?.workflowPolicy?.reworkStrategy === "branch";
}

function deriveReworkRoles(steps, retryTarget, gateStep, execution) {
  const explicitRoles = getExecutionPolicy(execution)?.workflowPolicy?.reworkRoles ?? [];
  if (Array.isArray(explicitRoles) && explicitRoles.length > 0) {
    return explicitRoles;
  }
  return steps
    .filter((step) => step.sequence >= retryTarget.sequence && step.sequence <= gateStep.sequence)
    .map((step) => step.role)
    .filter(Boolean);
}

async function branchForRework(execution, gateStep, retryTarget, payload = {}, options = {}) {
  const branchRoles = deriveReworkRoles(options.steps ?? [], retryTarget, gateStep, execution);
  if (branchRoles.length === 0) {
    throw new Error(`cannot derive rework roles for execution: ${execution.id}`);
  }
  const objectiveSuffix = payload.comments ? ` Rework request: ${payload.comments}` : "";
  return branchExecution(
    execution.id,
    {
      workflowPath: execution.workflowPath,
      projectPath: execution.projectPath,
      domainId: execution.domainId ?? null,
      roles: branchRoles,
      invocationId: `${execution.id}-rework-${Date.now()}`,
      objective: `${execution.objective}${objectiveSuffix}`.trim(),
      branchKey: `${gateStep.role}-rework-${Date.now()}`
    },
    options.dbPath ?? DEFAULT_ORCHESTRATOR_DB_PATH,
    options.sessionDbPath ?? DEFAULT_SESSION_DB_PATH
  );
}

function resetDependentSteps(steps, execution, retryTarget, gateStep, reason) {
  const resetDescendants = getExecutionPolicy(execution)?.workflowPolicy?.resetDescendantSteps ?? false;
  if (!resetDescendants) {
    return [];
  }
  return steps
    .filter(
      (step) =>
        step.sequence > retryTarget.sequence &&
        step.sequence < gateStep.sequence &&
        !step.reviewRequired
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
        settledAt: null
      });
    });
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
          wave: step.wave ?? step.sequence,
          waveName: step.waveName ?? null,
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

function summarizeStepStates(steps) {
  const byState = {};
  const byWave = {};
  for (const step of steps) {
    byState[step.state] = (byState[step.state] ?? 0) + 1;
    const wave = Number.isInteger(step.wave) ? step.wave : 0;
    if (!byWave[wave]) {
      byWave[wave] = {
        wave,
        gate: getWaveGate(steps, wave),
        satisfied: false,
        count: 0,
        byState: {}
      };
    }
    byWave[wave].count += 1;
    byWave[wave].byState[step.state] = (byWave[wave].byState[step.state] ?? 0) + 1;
  }
  return {
    count: steps.length,
    byState,
    byWave: Object.values(byWave)
      .map((entry) => ({
        ...entry,
        satisfied: isWaveSatisfied(steps, entry.wave)
      }))
      .sort((left, right) => left.wave - right.wave)
  };
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

function buildExecutionTreeNode(executionId, executionsById, childrenByParent, stepsByExecutionId) {
  const execution = executionsById.get(executionId);
  if (!execution) {
    return null;
  }
  const steps = stepsByExecutionId.get(executionId) ?? [];
  const children = (childrenByParent.get(executionId) ?? [])
    .map((childId) => buildExecutionTreeNode(childId, executionsById, childrenByParent, stepsByExecutionId))
    .filter(Boolean);
  return {
    execution,
    stepSummary: summarizeStepStates(steps),
    children
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

export function getExecutionTree(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withOrchestratorDatabase(dbPath, (db) => {
    const execution = getExecution(db, executionId);
    if (!execution) {
      return null;
    }
    const root = resolveExecutionRoot(db, execution);
    const groupId = execution.coordinationGroupId ?? root.coordinationGroupId ?? root.id;
    const executions = listExecutionGroup(db, groupId);
    const executionsById = new Map(executions.map((item) => [item.id, item]));
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
      executionCount: executions.length,
      root: buildExecutionTreeNode(root.id, executionsById, childrenByParent, stepsByExecutionId)
    };
  });
}

export async function driveExecutionTree(executionId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }
  return driveCoordinationGroup(tree.coordinationGroupId, options, dbPath, sessionDbPath);
}

function flattenExecutionTree(node, items = [], depth = 0) {
  if (!node) {
    return items;
  }
  items.push({
    depth,
    executionId: node.execution.id,
    state: node.execution.state
  });
  for (const child of node.children ?? []) {
    flattenExecutionTree(child, items, depth + 1);
  }
  return items;
}

export function applyExecutionTreeAction(executionId, action, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }

  const ordered = flattenExecutionTree(tree.root)
    .filter((item) => !TERMINAL_EXECUTION_STATES.has(item.state));
  const executionOrder =
    action === "resume"
      ? ordered.sort((left, right) => right.depth - left.depth)
      : ordered.sort((left, right) => left.depth - right.depth);

  const results = [];
  for (const item of executionOrder) {
    if (action === "pause") {
      results.push(pauseExecution(item.executionId, payload, dbPath, sessionDbPath));
      continue;
    }
    if (action === "hold") {
      results.push(holdExecution(item.executionId, payload, dbPath, sessionDbPath));
      continue;
    }
    if (action === "resume") {
      const detail = getExecutionDetail(item.executionId, dbPath, sessionDbPath);
      if (detail?.execution?.state && ["paused", "held"].includes(detail.execution.state)) {
        results.push(resumeExecution(item.executionId, payload, dbPath, sessionDbPath));
      }
      continue;
    }
    throw new Error(`unsupported tree action: ${action}`);
  }

  return {
    action,
    changedExecutionIds: results.map((item) => item.execution.id),
    tree: getExecutionTree(executionId, dbPath)
  };
}

export async function applyExecutionTreeGovernance(executionId, action, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  const tree = getExecutionTree(executionId, dbPath);
  if (!tree) {
    throw new Error(`execution not found: ${executionId}`);
  }

  const ordered = flattenExecutionTree(tree.root)
    .sort((left, right) => right.depth - left.depth);
  const pending = ordered
    .map((item) => getExecutionDetail(item.executionId, dbPath, sessionDbPath))
    .filter(Boolean)
    .filter((detail) =>
      action === "review"
        ? detail.execution.state === "waiting_review" || detail.steps.some((step) => step.state === "review_pending")
        : detail.execution.state === "waiting_approval" || detail.steps.some((step) => step.state === "approval_pending")
    );

  const scope = payload.scope === "first-pending" ? "first-pending" : "all-pending";
  const targets = scope === "first-pending" ? pending.slice(0, 1) : pending;
  const changedExecutionIds = [];

  for (const detail of targets) {
    if (action === "review") {
      await recordReviewDecision(detail.execution.id, payload, dbPath, sessionDbPath);
      changedExecutionIds.push(detail.execution.id);
      continue;
    }
    if (action === "approval") {
      await recordApprovalDecision(detail.execution.id, payload, dbPath, sessionDbPath);
      changedExecutionIds.push(detail.execution.id);
      continue;
    }
    throw new Error(`unsupported tree governance action: ${action}`);
  }

  return {
    action,
    scope,
    changedExecutionIds,
    tree: getExecutionTree(executionId, dbPath)
  };
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

export async function spawnExecutionBranches(executionId, branches = [], options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new Error("spawnExecutionBranches requires at least one branch spec");
  }
  const created = [];
  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index] ?? {};
    const roles = Array.isArray(branch.roles) && branch.roles.length > 0
      ? branch.roles
      : null;
    const result = await branchExecution(executionId, {
      workflowPath: branch.workflowPath ?? null,
      projectPath: branch.projectPath ?? null,
      domainId: branch.domainId ?? null,
      roles,
      maxRoles: branch.maxRoles ?? roles?.length ?? 1,
      invocationId: branch.invocationId ?? `${executionId}-branch-${index + 1}-${Date.now()}`,
      objective: branch.objective ?? null,
      branchKey: branch.branchKey ?? `branch-${index + 1}-${Date.now()}`,
      wait: false
    }, dbPath, sessionDbPath);
    created.push(result);
  }

  const tree = getExecutionTree(executionId, dbPath);
  if (options.wait === true) {
    const groupId = tree?.coordinationGroupId ?? executionId;
    const detail = await driveCoordinationGroup(groupId, options, dbPath, sessionDbPath);
    return {
      created,
      tree: getExecutionTree(executionId, dbPath),
      detail
    };
  }

  return {
    created,
    tree
  };
}

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
    const heldExecution = transitionExecutionRecord(execution, "held", buildHoldMetadata(execution, payload, "held"));
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
        holdExpiresAt: heldExecution.holdExpiresAt
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
    const pausedExecution = transitionExecutionRecord(execution, "paused", buildHoldMetadata(execution, payload, "paused"));
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
        holdExpiresAt: pausedExecution.holdExpiresAt
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
      holdOwner: null,
      holdGuidance: null,
      holdExpiresAt: null,
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
        reason: payload.reason ?? payload.comments ?? "operator resume",
        previousHoldOwner: execution.holdOwner,
        previousHoldExpiresAt: execution.holdExpiresAt
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
  return getNextLaunchableSteps(steps)[0] ?? null;
}

function assertNoActiveStep(steps, executionId, action) {
  const activeStep = steps.find((step) => ACTIVE_STEP_STATES.has(step.state));
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
        wave: updatedStep.wave ?? updatedStep.sequence,
        waveName: updatedStep.waveName ?? null,
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

async function launchSteps(execution, steps, options = {}) {
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

function reconcileExpiredHold(db, execution) {
  if (!hasExpiredHold(execution)) {
    return execution;
  }
  const alreadyOpen = listEscalations(db, execution.id).some(
    (escalation) => escalation.status === "open" && escalation.reason === "hold-expired"
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
        holdExpiresAt: execution.holdExpiresAt
      }
    });
    emitWorkflowEvent(db, {
      executionId: execution.id,
      type: "workflow.execution.hold_expired",
      payload: {
        holdReason: execution.holdReason,
        holdOwner: execution.holdOwner,
        holdGuidance: execution.holdGuidance,
        holdExpiresAt: execution.holdExpiresAt
      }
    });
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
      const coordinated = reconcileCoordinationState(db, execution);
      reconcileExpiredHold(db, coordinated);
    }
  });

  detail = getExecutionDetail(executionId, dbPath, sessionDbPath);
  if (!detail) {
    throw new Error(`execution not found after coordination reconcile: ${executionId}`);
  }

  if (SETTLED_EXECUTION_STATES.includes(detail.execution.state)) {
    return detail;
  }

  const activeSteps = getActiveSteps(detail.steps);
  if (activeSteps.length > 0) {
    const observations = [];
    for (const activeStep of activeSteps) {
      const session = withSessionDatabase(sessionDbPath, (db) => getSession(db, activeStep.sessionId));
      await applyActiveStepWatchdog(detail.execution, activeStep, session, options);
      observations.push({
        activeStep,
        session,
        settledStep: settleStepFromSession(activeStep, session)
      });
    }

    if (observations.some((item) => item.settledStep)) {
      const updatedDetail = withOrchestratorDatabase(dbPath, (db) => {
        const execution = getExecution(db, executionId);
        const dispatchBlocked = isExecutionDispatchBlocked(execution.state);

        for (const observation of observations) {
          if (!observation.settledStep) {
            continue;
          }

          const { activeStep, settledStep } = observation;
          if (["failed", "stopped"].includes(settledStep.state)) {
            const retryAllowed = activeStep.attemptCount < activeStep.maxAttempts;
            if (retryAllowed) {
              const retriedStep = scheduleRetry(activeStep, execution, settledStep.state);
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
                  nextSessionId: retriedStep.sessionId
                }
              });
              continue;
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
            const failedExecution = transitionExecutionRecord(execution, "failed", {
              currentStepIndex: activeStep.sequence
            });
            updateExecution(db, failedExecution);
            return getExecutionDetail(executionId, dbPath, sessionDbPath);
          }

          updateStep(db, settledStep);
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
                dispatchBlocked
              }
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
              attemptCount: settledStep.attemptCount
            }
          });
        }

        const refreshedSteps = listSteps(db, executionId);
        const remainingActive = getActiveSteps(refreshedSteps);
        const reviewPendingSteps = refreshedSteps.filter((step) => step.state === "review_pending");
        if (reviewPendingSteps.length > 0 && remainingActive.length === 0) {
          const pendingStep = reviewPendingSteps.sort((left, right) => left.sequence - right.sequence)[0];
          const waitingReview = transitionExecutionRecord(
            execution,
            dispatchBlocked ? execution.state : "waiting_review",
            {
              currentStepIndex: pendingStep.sequence,
              reviewStatus: "pending",
              approvalStatus: pendingStep.approvalRequired ? "pending" : null
            }
          );
          updateExecution(db, waitingReview);
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }

        const approvalPendingSteps = refreshedSteps.filter((step) => step.state === "approval_pending");
        if (approvalPendingSteps.length > 0 && remainingActive.length === 0) {
          const pendingStep = approvalPendingSteps.sort((left, right) => left.sequence - right.sequence)[0];
          const waitingApproval = transitionExecutionRecord(
            execution,
            dispatchBlocked ? execution.state : "waiting_approval",
            {
              currentStepIndex: pendingStep.sequence,
              approvalStatus: "pending"
            }
          );
          updateExecution(db, waitingApproval);
          return getExecutionDetail(executionId, dbPath, sessionDbPath);
        }

        const nextLaunchable = getNextLaunchableSteps(refreshedSteps);
        const runningExecution = transitionExecutionRecord(execution, dispatchBlocked ? execution.state : "running", {
          currentStepIndex:
            remainingActive[0]?.sequence ??
            nextLaunchable[0]?.sequence ??
            refreshedSteps.length
        });
        updateExecution(db, runningExecution);
        return getExecutionDetail(executionId, dbPath, sessionDbPath);
      });

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

  await launchSteps(refreshed.execution, nextSteps, options);
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

export async function recordReviewDecision(executionId, payload, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  let branchRequest = null;
  const detail = withOrchestratorDatabase(dbPath, (db) => {
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

    const retryTarget = selectRetryTargetStep(steps, reviewStep, execution);

    if (payload.status === "changes_requested" && retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts && shouldBranchRework(execution)) {
      const updatedStep = transitionStepRecord(reviewStep, "rejected", {
        reviewStatus: payload.status,
        approvalStatus: null
      });
      updateStep(db, updatedStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retryTarget.sequence,
        reviewStatus: payload.status,
        approvalStatus: null
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
          branchRoles: deriveReworkRoles(steps, retryTarget, reviewStep, execution)
        }
      });
      branchRequest = {
        execution,
        gateStep: reviewStep,
        retryTarget,
        steps
      };
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    if (payload.status === "changes_requested" && retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts) {
      const retriedTarget = scheduleRetry(retryTarget, execution, "changes_requested");
      const resetSteps = resetDependentSteps(steps, execution, retriedTarget, reviewStep, "changes_requested");
      const resetReviewStep = resetReviewGateStep(reviewStep, execution);
      updateStep(db, retriedTarget);
      for (const resetStep of resetSteps) {
        updateStep(db, resetStep);
      }
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
          nextSessionId: retriedTarget.sessionId,
          resetStepIds: resetSteps.map((step) => step.id)
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
  if (branchRequest) {
    await branchForRework(branchRequest.execution, branchRequest.gateStep, branchRequest.retryTarget, payload, {
      dbPath,
      sessionDbPath,
      steps: branchRequest.steps
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  }
  return detail;
}

export async function recordApprovalDecision(executionId, payload, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, sessionDbPath = DEFAULT_SESSION_DB_PATH) {
  let branchRequest = null;
  const detail = withOrchestratorDatabase(dbPath, (db) => {
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

    const retryTarget = selectRetryTargetStep(steps, approvalStep, execution);

    if (retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts && shouldBranchRework(execution)) {
      const updatedStep = transitionStepRecord(approvalStep, "rejected", {
        approvalStatus: payload.status
      });
      updateStep(db, updatedStep);
      const updatedExecution = transitionExecutionRecord(execution, "running", {
        currentStepIndex: retryTarget.sequence,
        approvalStatus: payload.status
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
          branchRoles: deriveReworkRoles(steps, retryTarget, approvalStep, execution)
        }
      });
      branchRequest = {
        execution,
        gateStep: approvalStep,
        retryTarget,
        steps
      };
      return getExecutionDetail(executionId, dbPath, sessionDbPath);
    }

    if (retryTarget && retryTarget.attemptCount < retryTarget.maxAttempts) {
      const retriedTarget = scheduleRetry(retryTarget, execution, "approval_rejected");
      const resetSteps = resetDependentSteps(steps, execution, retriedTarget, approvalStep, "approval_rejected");
      const resetApprovalStep = resetReviewGateStep(approvalStep, execution);
      updateStep(db, retriedTarget);
      for (const resetStep of resetSteps) {
        updateStep(db, resetStep);
      }
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
          nextSessionId: retriedTarget.sessionId,
          resetStepIds: resetSteps.map((step) => step.id)
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
  if (branchRequest) {
    await branchForRework(branchRequest.execution, branchRequest.gateStep, branchRequest.retryTarget, payload, {
      dbPath,
      sessionDbPath,
      steps: branchRequest.steps
    });
    return getExecutionDetail(executionId, dbPath, sessionDbPath);
  }
  return detail;
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
