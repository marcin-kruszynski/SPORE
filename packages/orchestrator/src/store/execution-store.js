import { DatabaseSync } from "node:sqlite";

function parseJsonField(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureColumn(db, tableName, columnName, sqlDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`);
    } catch (error) {
      if (!String(error?.message ?? "").includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

export function openOrchestratorDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      coordination_group_id TEXT,
      parent_execution_id TEXT,
      branch_key TEXT,
      workflow_id TEXT NOT NULL,
      workflow_name TEXT,
      workflow_path TEXT,
      project_id TEXT,
      project_name TEXT,
      project_path TEXT,
      domain_id TEXT,
      policy_json TEXT,
      objective TEXT,
      state TEXT NOT NULL,
      review_status TEXT,
      approval_status TEXT,
      held_from_state TEXT,
      hold_reason TEXT,
      paused_at TEXT,
      held_at TEXT,
      resumed_at TEXT,
      current_step_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      role TEXT NOT NULL,
      requested_profile_id TEXT,
      profile_path TEXT,
      session_id TEXT,
      parent_session_id TEXT,
      session_mode TEXT,
      policy_json TEXT,
      state TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      review_required INTEGER NOT NULL DEFAULT 0,
      review_status TEXT,
      approval_required INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT,
      objective TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      launched_at TEXT,
      settled_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_steps_execution_sequence
      ON workflow_steps(execution_id, sequence);
    CREATE TABLE IF NOT EXISTS workflow_reviews (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_by TEXT,
      comments TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_approvals (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_by TEXT,
      comments TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_events (
      event_index INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      execution_id TEXT NOT NULL,
      step_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_escalations (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      step_id TEXT,
      source_step_id TEXT,
      target_role TEXT,
      reason TEXT,
      status TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_state ON workflow_executions(state);
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_execution_id ON workflow_steps(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_reviews_execution_id ON workflow_reviews(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_approvals_execution_id ON workflow_approvals(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_events_execution_id ON workflow_events(execution_id, event_index);
    CREATE INDEX IF NOT EXISTS idx_workflow_escalations_execution_id ON workflow_escalations(execution_id, created_at);
  `);
  ensureColumn(db, "workflow_steps", "attempt_count", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "workflow_steps", "max_attempts", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "workflow_steps", "last_error", "TEXT");
  ensureColumn(db, "workflow_executions", "coordination_group_id", "TEXT");
  ensureColumn(db, "workflow_executions", "parent_execution_id", "TEXT");
  ensureColumn(db, "workflow_executions", "branch_key", "TEXT");
  ensureColumn(db, "workflow_executions", "held_from_state", "TEXT");
  ensureColumn(db, "workflow_executions", "hold_reason", "TEXT");
  ensureColumn(db, "workflow_executions", "paused_at", "TEXT");
  ensureColumn(db, "workflow_executions", "held_at", "TEXT");
  ensureColumn(db, "workflow_executions", "resumed_at", "TEXT");
  ensureColumn(db, "workflow_executions", "policy_json", "TEXT");
  ensureColumn(db, "workflow_steps", "session_mode", "TEXT");
  ensureColumn(db, "workflow_steps", "policy_json", "TEXT");
  db.exec(`
    UPDATE workflow_executions
    SET coordination_group_id = id
    WHERE coordination_group_id IS NULL OR coordination_group_id = '';
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_coordination_group
      ON workflow_executions(coordination_group_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_parent
      ON workflow_executions(parent_execution_id, updated_at);
  `);
  return db;
}

function runTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function insertExecutionWithSteps(db, execution, steps) {
  const insertExecution = db.prepare(`
    INSERT INTO workflow_executions (
      id, coordination_group_id, parent_execution_id, branch_key,
      workflow_id, workflow_name, workflow_path, project_id, project_name, project_path,
      domain_id, policy_json, objective, state, review_status, approval_status, held_from_state, hold_reason, paused_at,
      held_at, resumed_at, current_step_index, created_at, updated_at, started_at, ended_at
    ) VALUES (
      @id, @coordinationGroupId, @parentExecutionId, @branchKey,
      @workflowId, @workflowName, @workflowPath, @projectId, @projectName, @projectPath,
      @domainId, @policyJson, @objective, @state, @reviewStatus, @approvalStatus, @heldFromState, @holdReason, @pausedAt,
      @heldAt, @resumedAt, @currentStepIndex, @createdAt, @updatedAt, @startedAt, @endedAt
    )
  `);
  const insertStep = db.prepare(`
    INSERT INTO workflow_steps (
      id, execution_id, sequence, role, requested_profile_id, profile_path, session_id,
      parent_session_id, session_mode, policy_json, state, attempt_count, max_attempts, last_error, review_required, review_status, approval_required,
      approval_status, objective, created_at, updated_at, launched_at, settled_at
    ) VALUES (
      @id, @executionId, @sequence, @role, @requestedProfileId, @profilePath, @sessionId,
      @parentSessionId, @sessionMode, @policyJson, @state, @attemptCount, @maxAttempts, @lastError, @reviewRequired, @reviewStatus, @approvalRequired,
      @approvalStatus, @objective, @createdAt, @updatedAt, @launchedAt, @settledAt
    )
  `);

  runTransaction(db, () => {
    insertExecution.run({
      id: execution.id,
      coordinationGroupId: execution.coordinationGroupId,
      parentExecutionId: execution.parentExecutionId,
      branchKey: execution.branchKey,
      workflowId: execution.workflowId,
      workflowName: execution.workflowName,
      workflowPath: execution.workflowPath,
      projectId: execution.projectId,
      projectName: execution.projectName,
      projectPath: execution.projectPath,
      domainId: execution.domainId,
      policyJson: JSON.stringify(execution.policy ?? {}),
      objective: execution.objective,
      state: execution.state,
      reviewStatus: execution.reviewStatus,
      approvalStatus: execution.approvalStatus,
      heldFromState: execution.heldFromState,
      holdReason: execution.holdReason,
      pausedAt: execution.pausedAt,
      heldAt: execution.heldAt,
      resumedAt: execution.resumedAt,
      currentStepIndex: execution.currentStepIndex,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt
    });
    for (const step of steps) {
      insertStep.run({
        id: step.id,
        executionId: step.executionId,
        sequence: step.sequence,
        role: step.role,
        requestedProfileId: step.requestedProfileId,
        profilePath: step.profilePath,
        sessionId: step.sessionId,
        parentSessionId: step.parentSessionId,
        sessionMode: step.sessionMode,
        policyJson: JSON.stringify(step.policy ?? {}),
        state: step.state,
        attemptCount: step.attemptCount,
        maxAttempts: step.maxAttempts,
        lastError: step.lastError,
        reviewRequired: step.reviewRequired ? 1 : 0,
        reviewStatus: step.reviewStatus,
        approvalRequired: step.approvalRequired ? 1 : 0
        ,
        approvalStatus: step.approvalStatus,
        objective: step.objective,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        launchedAt: step.launchedAt,
        settledAt: step.settledAt
      });
    }
  });
}

export function updateExecution(db, execution) {
  db.prepare(`
    UPDATE workflow_executions SET
      coordination_group_id = @coordinationGroupId,
      parent_execution_id = @parentExecutionId,
      branch_key = @branchKey,
      workflow_id = @workflowId,
      workflow_name = @workflowName,
      workflow_path = @workflowPath,
      project_id = @projectId,
      project_name = @projectName,
      project_path = @projectPath,
      domain_id = @domainId,
      policy_json = @policyJson,
      objective = @objective,
      state = @state,
      review_status = @reviewStatus,
      approval_status = @approvalStatus,
      held_from_state = @heldFromState,
      hold_reason = @holdReason,
      paused_at = @pausedAt,
      held_at = @heldAt,
      resumed_at = @resumedAt,
      current_step_index = @currentStepIndex,
      updated_at = @updatedAt,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: execution.id,
    coordinationGroupId: execution.coordinationGroupId,
    parentExecutionId: execution.parentExecutionId,
    branchKey: execution.branchKey,
    workflowId: execution.workflowId,
    workflowName: execution.workflowName,
    workflowPath: execution.workflowPath,
    projectId: execution.projectId,
    projectName: execution.projectName,
    projectPath: execution.projectPath,
    domainId: execution.domainId,
    policyJson: JSON.stringify(execution.policy ?? {}),
    objective: execution.objective,
    state: execution.state,
    reviewStatus: execution.reviewStatus,
    approvalStatus: execution.approvalStatus,
    heldFromState: execution.heldFromState,
    holdReason: execution.holdReason,
    pausedAt: execution.pausedAt,
    heldAt: execution.heldAt,
    resumedAt: execution.resumedAt,
    currentStepIndex: execution.currentStepIndex,
    updatedAt: execution.updatedAt,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt
  });
}

export function updateStep(db, step) {
  db.prepare(`
    UPDATE workflow_steps SET
      sequence = @sequence,
      role = @role,
      requested_profile_id = @requestedProfileId,
      profile_path = @profilePath,
      session_id = @sessionId,
      parent_session_id = @parentSessionId,
      session_mode = @sessionMode,
      policy_json = @policyJson,
      state = @state,
      attempt_count = @attemptCount,
      max_attempts = @maxAttempts,
      last_error = @lastError,
      review_required = @reviewRequired,
      review_status = @reviewStatus,
      approval_required = @approvalRequired,
      approval_status = @approvalStatus,
      objective = @objective,
      updated_at = @updatedAt,
      launched_at = @launchedAt,
      settled_at = @settledAt
    WHERE id = @id
  `).run({
    id: step.id,
    sequence: step.sequence,
    role: step.role,
    requestedProfileId: step.requestedProfileId,
    profilePath: step.profilePath,
    sessionId: step.sessionId,
    parentSessionId: step.parentSessionId,
    sessionMode: step.sessionMode,
    policyJson: JSON.stringify(step.policy ?? {}),
    state: step.state,
    attemptCount: step.attemptCount,
    maxAttempts: step.maxAttempts,
    lastError: step.lastError,
    reviewRequired: step.reviewRequired ? 1 : 0,
    reviewStatus: step.reviewStatus,
    approvalRequired: step.approvalRequired ? 1 : 0
    ,
    approvalStatus: step.approvalStatus,
    objective: step.objective,
    updatedAt: step.updatedAt,
    launchedAt: step.launchedAt,
    settledAt: step.settledAt
  });
}

export function insertReview(db, review) {
  db.prepare(`
    INSERT INTO workflow_reviews (
      id, execution_id, step_id, status, decided_by, comments, created_at, decided_at
    ) VALUES (
      @id, @executionId, @stepId, @status, @decidedBy, @comments, @createdAt, @decidedAt
    )
  `).run(review);
}

export function insertApproval(db, approval) {
  db.prepare(`
    INSERT INTO workflow_approvals (
      id, execution_id, step_id, status, decided_by, comments, created_at, decided_at
    ) VALUES (
      @id, @executionId, @stepId, @status, @decidedBy, @comments, @createdAt, @decidedAt
    )
  `).run(approval);
}

export function insertWorkflowEvent(db, event) {
  db.prepare(`
    INSERT INTO workflow_events (
      id, execution_id, step_id, session_id, type, payload_json, created_at
    ) VALUES (
      @id, @executionId, @stepId, @sessionId, @type, @payloadJson, @createdAt
    )
  `).run({
    id: event.id,
    executionId: event.executionId,
    stepId: event.stepId,
    sessionId: event.sessionId,
    type: event.type,
    payloadJson: JSON.stringify(event.payload ?? {}),
    createdAt: event.createdAt
  });
}

export function insertEscalation(db, escalation) {
  db.prepare(`
    INSERT INTO workflow_escalations (
      id, execution_id, step_id, source_step_id, target_role, reason, status, payload_json,
      created_at, updated_at, resolved_at
    ) VALUES (
      @id, @executionId, @stepId, @sourceStepId, @targetRole, @reason, @status, @payloadJson,
      @createdAt, @updatedAt, @resolvedAt
    )
  `).run({
    id: escalation.id,
    executionId: escalation.executionId,
    stepId: escalation.stepId,
    sourceStepId: escalation.sourceStepId,
    targetRole: escalation.targetRole,
    reason: escalation.reason,
    status: escalation.status,
    payloadJson: JSON.stringify(escalation.payload ?? {}),
    createdAt: escalation.createdAt,
    updatedAt: escalation.updatedAt,
    resolvedAt: escalation.resolvedAt
  });
}

export function updateEscalation(db, escalation) {
  db.prepare(`
    UPDATE workflow_escalations SET
      execution_id = @executionId,
      step_id = @stepId,
      source_step_id = @sourceStepId,
      target_role = @targetRole,
      reason = @reason,
      status = @status,
      payload_json = @payloadJson,
      updated_at = @updatedAt,
      resolved_at = @resolvedAt
    WHERE id = @id
  `).run({
    id: escalation.id,
    executionId: escalation.executionId,
    stepId: escalation.stepId,
    sourceStepId: escalation.sourceStepId,
    targetRole: escalation.targetRole,
    reason: escalation.reason,
    status: escalation.status,
    payloadJson: JSON.stringify(escalation.payload ?? {}),
    updatedAt: escalation.updatedAt,
    resolvedAt: escalation.resolvedAt
  });
}

export function getExecution(db, executionId) {
  const execution = db.prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      workflow_name AS workflowName,
      workflow_path AS workflowPath,
      project_id AS projectId,
      project_name AS projectName,
      project_path AS projectPath,
      domain_id AS domainId,
      policy_json AS policyJson,
      objective,
      state,
      review_status AS reviewStatus,
      approval_status AS approvalStatus,
      held_from_state AS heldFromState,
      hold_reason AS holdReason,
      paused_at AS pausedAt,
      held_at AS heldAt,
      resumed_at AS resumedAt,
      current_step_index AS currentStepIndex,
      created_at AS createdAt,
      updated_at AS updatedAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM workflow_executions
    WHERE id = ?
  `).get(executionId);
  return execution ? {
    ...execution,
    policy: parseJsonField(execution.policyJson)
  } : null;
}

export function listExecutions(db) {
  return db.prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      state,
      review_status AS reviewStatus,
      approval_status AS approvalStatus,
      held_from_state AS heldFromState,
      hold_reason AS holdReason,
      paused_at AS pausedAt,
      held_at AS heldAt,
      resumed_at AS resumedAt,
      current_step_index AS currentStepIndex,
      updated_at AS updatedAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM workflow_executions
    ORDER BY updated_at DESC
  `).all().map((execution) => ({
    ...execution,
    policy: parseJsonField(execution.policyJson)
  }));
}

export function listChildExecutions(db, parentExecutionId) {
  return db.prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      state,
      review_status AS reviewStatus,
      approval_status AS approvalStatus,
      held_from_state AS heldFromState,
      hold_reason AS holdReason,
      paused_at AS pausedAt,
      held_at AS heldAt,
      resumed_at AS resumedAt,
      current_step_index AS currentStepIndex,
      updated_at AS updatedAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM workflow_executions
    WHERE parent_execution_id = ?
    ORDER BY updated_at DESC
  `).all(parentExecutionId).map((execution) => ({
    ...execution,
    policy: parseJsonField(execution.policyJson)
  }));
}

export function listExecutionGroup(db, coordinationGroupId) {
  return db.prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      state,
      review_status AS reviewStatus,
      approval_status AS approvalStatus,
      held_from_state AS heldFromState,
      hold_reason AS holdReason,
      paused_at AS pausedAt,
      held_at AS heldAt,
      resumed_at AS resumedAt,
      current_step_index AS currentStepIndex,
      updated_at AS updatedAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM workflow_executions
    WHERE coordination_group_id = ?
    ORDER BY updated_at DESC
  `).all(coordinationGroupId).map((execution) => ({
    ...execution,
    policy: parseJsonField(execution.policyJson)
  }));
}

export function listSteps(db, executionId) {
  return db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      sequence,
      role,
      requested_profile_id AS requestedProfileId,
      profile_path AS profilePath,
      session_id AS sessionId,
      parent_session_id AS parentSessionId,
      session_mode AS sessionMode,
      policy_json AS policyJson,
      state,
      attempt_count AS attemptCount,
      max_attempts AS maxAttempts,
      last_error AS lastError,
      review_required AS reviewRequired,
      review_status AS reviewStatus,
      approval_required AS approvalRequired,
      approval_status AS approvalStatus,
      objective,
      created_at AS createdAt,
      updated_at AS updatedAt,
      launched_at AS launchedAt,
      settled_at AS settledAt
    FROM workflow_steps
    WHERE execution_id = ?
    ORDER BY sequence ASC
  `).all(executionId).map((step) => ({
    ...step,
    reviewRequired: Boolean(step.reviewRequired),
    approvalRequired: Boolean(step.approvalRequired),
    policy: parseJsonField(step.policyJson)
  }));
}

export function getStep(db, stepId) {
  const step = db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      sequence,
      role,
      requested_profile_id AS requestedProfileId,
      profile_path AS profilePath,
      session_id AS sessionId,
      parent_session_id AS parentSessionId,
      session_mode AS sessionMode,
      policy_json AS policyJson,
      state,
      attempt_count AS attemptCount,
      max_attempts AS maxAttempts,
      last_error AS lastError,
      review_required AS reviewRequired,
      review_status AS reviewStatus,
      approval_required AS approvalRequired,
      approval_status AS approvalStatus,
      objective,
      created_at AS createdAt,
      updated_at AS updatedAt,
      launched_at AS launchedAt,
      settled_at AS settledAt
    FROM workflow_steps
    WHERE id = ?
  `).get(stepId);
  return step ? {
    ...step,
    reviewRequired: Boolean(step.reviewRequired),
    approvalRequired: Boolean(step.approvalRequired),
    policy: parseJsonField(step.policyJson)
  } : null;
}

export function getEscalation(db, escalationId) {
  const record = db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      step_id AS stepId,
      source_step_id AS sourceStepId,
      target_role AS targetRole,
      reason,
      status,
      payload_json AS payloadJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      resolved_at AS resolvedAt
    FROM workflow_escalations
    WHERE id = ?
  `).get(escalationId);
  return record ? {
    ...record,
    payload: record.payloadJson ? JSON.parse(record.payloadJson) : {}
  } : null;
}

export function listReviews(db, executionId) {
  return db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      step_id AS stepId,
      status,
      decided_by AS decidedBy,
      comments,
      created_at AS createdAt,
      decided_at AS decidedAt
    FROM workflow_reviews
    WHERE execution_id = ?
    ORDER BY decided_at DESC
  `).all(executionId);
}

export function listApprovals(db, executionId) {
  return db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      step_id AS stepId,
      status,
      decided_by AS decidedBy,
      comments,
      created_at AS createdAt,
      decided_at AS decidedAt
    FROM workflow_approvals
    WHERE execution_id = ?
    ORDER BY decided_at DESC
  `).all(executionId);
}

export function listWorkflowEvents(db, executionId) {
  return db.prepare(`
    SELECT
      event_index AS eventIndex,
      id,
      execution_id AS executionId,
      step_id AS stepId,
      session_id AS sessionId,
      type,
      payload_json AS payloadJson,
      created_at AS createdAt
    FROM workflow_events
    WHERE execution_id = ?
    ORDER BY event_index ASC
  `).all(executionId).map((event) => ({
    ...event,
    payload: event.payloadJson ? JSON.parse(event.payloadJson) : {}
  }));
}

export function listEscalations(db, executionId) {
  return db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      step_id AS stepId,
      source_step_id AS sourceStepId,
      target_role AS targetRole,
      reason,
      status,
      payload_json AS payloadJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      resolved_at AS resolvedAt
    FROM workflow_escalations
    WHERE execution_id = ?
    ORDER BY created_at DESC
  `).all(executionId).map((record) => ({
    ...record,
    payload: record.payloadJson ? JSON.parse(record.payloadJson) : {}
  }));
}
