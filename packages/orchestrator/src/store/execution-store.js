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
      hold_owner TEXT,
      hold_guidance TEXT,
      hold_expires_at TEXT,
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
      wave INTEGER NOT NULL DEFAULT 0,
      wave_name TEXT,
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
    CREATE TABLE IF NOT EXISTS workflow_audit (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      step_id TEXT,
      session_id TEXT,
      action TEXT NOT NULL,
      actor TEXT,
      source TEXT,
      target_type TEXT,
      target_id TEXT,
      payload_json TEXT,
      result TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scenario_runs (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      scenario_label TEXT,
      workflow_id TEXT,
      workflow_path TEXT,
      domain_id TEXT,
      launcher TEXT,
      uses_real_pi INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      trigger_source TEXT,
      objective TEXT,
      status TEXT NOT NULL,
      assertion_summary_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS scenario_run_executions (
      id TEXT PRIMARY KEY,
      scenario_run_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      session_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS regression_runs (
      id TEXT PRIMARY KEY,
      regression_id TEXT NOT NULL,
      regression_label TEXT,
      requested_by TEXT,
      trigger_source TEXT,
      real_pi_required INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      summary_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS regression_run_items (
      id TEXT PRIMARY KEY,
      regression_run_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      scenario_run_id TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_executions_state ON workflow_executions(state);
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_execution_id ON workflow_steps(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_reviews_execution_id ON workflow_reviews(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_approvals_execution_id ON workflow_approvals(execution_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_events_execution_id ON workflow_events(execution_id, event_index);
    CREATE INDEX IF NOT EXISTS idx_workflow_escalations_execution_id ON workflow_escalations(execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_audit_execution_id ON workflow_audit(execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_scenario_runs_scenario_id ON scenario_runs(scenario_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scenario_run_executions_run_id ON scenario_run_executions(scenario_run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_regression_runs_regression_id ON regression_runs(regression_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_regression_run_items_run_id ON regression_run_items(regression_run_id, created_at);
  `);
  ensureColumn(db, "workflow_steps", "attempt_count", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "workflow_steps", "max_attempts", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "workflow_steps", "last_error", "TEXT");
  ensureColumn(db, "workflow_steps", "wave", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workflow_steps", "wave_name", "TEXT");
  ensureColumn(db, "workflow_executions", "coordination_group_id", "TEXT");
  ensureColumn(db, "workflow_executions", "parent_execution_id", "TEXT");
  ensureColumn(db, "workflow_executions", "branch_key", "TEXT");
  ensureColumn(db, "workflow_executions", "held_from_state", "TEXT");
  ensureColumn(db, "workflow_executions", "hold_reason", "TEXT");
  ensureColumn(db, "workflow_executions", "hold_owner", "TEXT");
  ensureColumn(db, "workflow_executions", "hold_guidance", "TEXT");
  ensureColumn(db, "workflow_executions", "hold_expires_at", "TEXT");
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
      domain_id, policy_json, objective, state, review_status, approval_status, held_from_state, hold_reason, hold_owner, hold_guidance, hold_expires_at, paused_at,
      held_at, resumed_at, current_step_index, created_at, updated_at, started_at, ended_at
    ) VALUES (
      @id, @coordinationGroupId, @parentExecutionId, @branchKey,
      @workflowId, @workflowName, @workflowPath, @projectId, @projectName, @projectPath,
      @domainId, @policyJson, @objective, @state, @reviewStatus, @approvalStatus, @heldFromState, @holdReason, @holdOwner, @holdGuidance, @holdExpiresAt, @pausedAt,
      @heldAt, @resumedAt, @currentStepIndex, @createdAt, @updatedAt, @startedAt, @endedAt
    )
  `);
  const insertStep = db.prepare(`
    INSERT INTO workflow_steps (
      id, execution_id, sequence, wave, wave_name, role, requested_profile_id, profile_path, session_id,
      parent_session_id, session_mode, policy_json, state, attempt_count, max_attempts, last_error, review_required, review_status, approval_required,
      approval_status, objective, created_at, updated_at, launched_at, settled_at
    ) VALUES (
      @id, @executionId, @sequence, @wave, @waveName, @role, @requestedProfileId, @profilePath, @sessionId,
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
      holdOwner: execution.holdOwner,
      holdGuidance: execution.holdGuidance,
      holdExpiresAt: execution.holdExpiresAt,
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
        wave: step.wave ?? step.sequence,
        waveName: step.waveName ?? `wave-${(step.wave ?? step.sequence) + 1}`,
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
      hold_owner = @holdOwner,
      hold_guidance = @holdGuidance,
      hold_expires_at = @holdExpiresAt,
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
    holdOwner: execution.holdOwner,
    holdGuidance: execution.holdGuidance,
    holdExpiresAt: execution.holdExpiresAt,
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
      wave = @wave,
      wave_name = @waveName,
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
    wave: step.wave ?? step.sequence,
    waveName: step.waveName ?? `wave-${(step.wave ?? step.sequence) + 1}`,
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

export function insertAuditRecord(db, record) {
  db.prepare(`
    INSERT INTO workflow_audit (
      id, execution_id, step_id, session_id, action, actor, source, target_type, target_id,
      payload_json, result, created_at
    ) VALUES (
      @id, @executionId, @stepId, @sessionId, @action, @actor, @source, @targetType, @targetId,
      @payloadJson, @result, @createdAt
    )
  `).run({
    id: record.id,
    executionId: record.executionId,
    stepId: record.stepId,
    sessionId: record.sessionId,
    action: record.action,
    actor: record.actor,
    source: record.source,
    targetType: record.targetType,
    targetId: record.targetId,
    payloadJson: JSON.stringify(record.payload ?? {}),
    result: JSON.stringify(record.result ?? {}),
    createdAt: record.createdAt
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
      hold_owner AS holdOwner,
      hold_guidance AS holdGuidance,
      hold_expires_at AS holdExpiresAt,
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
      hold_owner AS holdOwner,
      hold_guidance AS holdGuidance,
      hold_expires_at AS holdExpiresAt,
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
      hold_owner AS holdOwner,
      hold_guidance AS holdGuidance,
      hold_expires_at AS holdExpiresAt,
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
      hold_owner AS holdOwner,
      hold_guidance AS holdGuidance,
      hold_expires_at AS holdExpiresAt,
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
      wave,
      wave_name AS waveName,
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
      wave,
      wave_name AS waveName,
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

export function listAuditRecords(db, executionId) {
  return db.prepare(`
    SELECT
      id,
      execution_id AS executionId,
      step_id AS stepId,
      session_id AS sessionId,
      action,
      actor,
      source,
      target_type AS targetType,
      target_id AS targetId,
      payload_json AS payloadJson,
      result,
      created_at AS createdAt
    FROM workflow_audit
    WHERE execution_id = ?
    ORDER BY created_at DESC
  `).all(executionId).map((record) => ({
    ...record,
    payload: record.payloadJson ? JSON.parse(record.payloadJson) : {},
    result: parseJsonField(record.result, {})
  }));
}

export function insertScenarioRun(db, run) {
  db.prepare(`
    INSERT INTO scenario_runs (
      id, scenario_id, scenario_label, workflow_id, workflow_path, domain_id, launcher,
      uses_real_pi, requested_by, trigger_source, objective, status, assertion_summary_json,
      metadata_json, created_at, started_at, ended_at
    ) VALUES (
      @id, @scenarioId, @scenarioLabel, @workflowId, @workflowPath, @domainId, @launcher,
      @usesRealPi, @requestedBy, @triggerSource, @objective, @status, @assertionSummaryJson,
      @metadataJson, @createdAt, @startedAt, @endedAt
    )
  `).run({
    id: run.id,
    scenarioId: run.scenarioId,
    scenarioLabel: run.scenarioLabel,
    workflowId: run.workflowId,
    workflowPath: run.workflowPath,
    domainId: run.domainId,
    launcher: run.launcher,
    usesRealPi: run.usesRealPi ? 1 : 0,
    requestedBy: run.requestedBy,
    triggerSource: run.triggerSource,
    objective: run.objective,
    status: run.status,
    assertionSummaryJson: JSON.stringify(run.assertionSummary ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null
  });
}

export function updateScenarioRun(db, run) {
  db.prepare(`
    UPDATE scenario_runs SET
      scenario_id = @scenarioId,
      scenario_label = @scenarioLabel,
      workflow_id = @workflowId,
      workflow_path = @workflowPath,
      domain_id = @domainId,
      launcher = @launcher,
      uses_real_pi = @usesRealPi,
      requested_by = @requestedBy,
      trigger_source = @triggerSource,
      objective = @objective,
      status = @status,
      assertion_summary_json = @assertionSummaryJson,
      metadata_json = @metadataJson,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: run.id,
    scenarioId: run.scenarioId,
    scenarioLabel: run.scenarioLabel,
    workflowId: run.workflowId,
    workflowPath: run.workflowPath,
    domainId: run.domainId,
    launcher: run.launcher,
    usesRealPi: run.usesRealPi ? 1 : 0,
    requestedBy: run.requestedBy,
    triggerSource: run.triggerSource,
    objective: run.objective,
    status: run.status,
    assertionSummaryJson: JSON.stringify(run.assertionSummary ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null
  });
}

export function getScenarioRun(db, runId) {
  const record = db.prepare(`
    SELECT
      id,
      scenario_id AS scenarioId,
      scenario_label AS scenarioLabel,
      workflow_id AS workflowId,
      workflow_path AS workflowPath,
      domain_id AS domainId,
      launcher,
      uses_real_pi AS usesRealPi,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      objective,
      status,
      assertion_summary_json AS assertionSummaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM scenario_runs
    WHERE id = ?
  `).get(runId);
  return record ? {
    ...record,
    usesRealPi: Boolean(record.usesRealPi),
    assertionSummary: parseJsonField(record.assertionSummaryJson, {}),
    metadata: parseJsonField(record.metadataJson, {})
  } : null;
}

export function listScenarioRuns(db, scenarioId = null, limit = 20) {
  const sql = `
    SELECT
      id,
      scenario_id AS scenarioId,
      scenario_label AS scenarioLabel,
      workflow_id AS workflowId,
      workflow_path AS workflowPath,
      domain_id AS domainId,
      launcher,
      uses_real_pi AS usesRealPi,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      objective,
      status,
      assertion_summary_json AS assertionSummaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM scenario_runs
    ${scenarioId ? "WHERE scenario_id = ?" : ""}
    ORDER BY started_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = scenarioId ? statement.all(scenarioId, limit) : statement.all(limit);
  return rows.map((record) => ({
    ...record,
    usesRealPi: Boolean(record.usesRealPi),
    assertionSummary: parseJsonField(record.assertionSummaryJson, {}),
    metadata: parseJsonField(record.metadataJson, {})
  }));
}

export function insertScenarioRunExecution(db, row) {
  db.prepare(`
    INSERT INTO scenario_run_executions (
      id, scenario_run_id, execution_id, session_count, metadata_json, created_at
    ) VALUES (
      @id, @scenarioRunId, @executionId, @sessionCount, @metadataJson, @createdAt
    )
  `).run({
    id: row.id,
    scenarioRunId: row.scenarioRunId,
    executionId: row.executionId,
    sessionCount: row.sessionCount ?? 0,
    metadataJson: JSON.stringify(row.metadata ?? {}),
    createdAt: row.createdAt
  });
}

export function listScenarioRunExecutions(db, scenarioRunId) {
  return db.prepare(`
    SELECT
      id,
      scenario_run_id AS scenarioRunId,
      execution_id AS executionId,
      session_count AS sessionCount,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM scenario_run_executions
    WHERE scenario_run_id = ?
    ORDER BY created_at ASC
  `).all(scenarioRunId).map((record) => ({
    ...record,
    metadata: parseJsonField(record.metadataJson, {})
  }));
}

export function insertRegressionRun(db, run) {
  db.prepare(`
    INSERT INTO regression_runs (
      id, regression_id, regression_label, requested_by, trigger_source, real_pi_required,
      status, summary_json, metadata_json, created_at, started_at, ended_at
    ) VALUES (
      @id, @regressionId, @regressionLabel, @requestedBy, @triggerSource, @realPiRequired,
      @status, @summaryJson, @metadataJson, @createdAt, @startedAt, @endedAt
    )
  `).run({
    id: run.id,
    regressionId: run.regressionId,
    regressionLabel: run.regressionLabel,
    requestedBy: run.requestedBy,
    triggerSource: run.triggerSource,
    realPiRequired: run.realPiRequired ? 1 : 0,
    status: run.status,
    summaryJson: JSON.stringify(run.summary ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null
  });
}

export function updateRegressionRun(db, run) {
  db.prepare(`
    UPDATE regression_runs SET
      regression_id = @regressionId,
      regression_label = @regressionLabel,
      requested_by = @requestedBy,
      trigger_source = @triggerSource,
      real_pi_required = @realPiRequired,
      status = @status,
      summary_json = @summaryJson,
      metadata_json = @metadataJson,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: run.id,
    regressionId: run.regressionId,
    regressionLabel: run.regressionLabel,
    requestedBy: run.requestedBy,
    triggerSource: run.triggerSource,
    realPiRequired: run.realPiRequired ? 1 : 0,
    status: run.status,
    summaryJson: JSON.stringify(run.summary ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null
  });
}

export function getRegressionRun(db, runId) {
  const record = db.prepare(`
    SELECT
      id,
      regression_id AS regressionId,
      regression_label AS regressionLabel,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      real_pi_required AS realPiRequired,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM regression_runs
    WHERE id = ?
  `).get(runId);
  return record ? {
    ...record,
    realPiRequired: Boolean(record.realPiRequired),
    summary: parseJsonField(record.summaryJson, {}),
    metadata: parseJsonField(record.metadataJson, {})
  } : null;
}

export function listRegressionRuns(db, regressionId = null, limit = 20) {
  const sql = `
    SELECT
      id,
      regression_id AS regressionId,
      regression_label AS regressionLabel,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      real_pi_required AS realPiRequired,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM regression_runs
    ${regressionId ? "WHERE regression_id = ?" : ""}
    ORDER BY started_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = regressionId ? statement.all(regressionId, limit) : statement.all(limit);
  return rows.map((record) => ({
    ...record,
    realPiRequired: Boolean(record.realPiRequired),
    summary: parseJsonField(record.summaryJson, {}),
    metadata: parseJsonField(record.metadataJson, {})
  }));
}

export function insertRegressionRunItem(db, item) {
  db.prepare(`
    INSERT INTO regression_run_items (
      id, regression_run_id, scenario_id, scenario_run_id, status, metadata_json, created_at, started_at, ended_at
    ) VALUES (
      @id, @regressionRunId, @scenarioId, @scenarioRunId, @status, @metadataJson, @createdAt, @startedAt, @endedAt
    )
  `).run({
    id: item.id,
    regressionRunId: item.regressionRunId,
    scenarioId: item.scenarioId,
    scenarioRunId: item.scenarioRunId ?? null,
    status: item.status,
    metadataJson: JSON.stringify(item.metadata ?? {}),
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    endedAt: item.endedAt ?? null
  });
}

export function updateRegressionRunItem(db, item) {
  db.prepare(`
    UPDATE regression_run_items SET
      scenario_id = @scenarioId,
      scenario_run_id = @scenarioRunId,
      status = @status,
      metadata_json = @metadataJson,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: item.id,
    scenarioId: item.scenarioId,
    scenarioRunId: item.scenarioRunId ?? null,
    status: item.status,
    metadataJson: JSON.stringify(item.metadata ?? {}),
    startedAt: item.startedAt,
    endedAt: item.endedAt ?? null
  });
}

export function listRegressionRunItems(db, regressionRunId) {
  return db.prepare(`
    SELECT
      id,
      regression_run_id AS regressionRunId,
      scenario_id AS scenarioId,
      scenario_run_id AS scenarioRunId,
      status,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM regression_run_items
    WHERE regression_run_id = ?
    ORDER BY created_at ASC
  `).all(regressionRunId).map((record) => ({
    ...record,
    metadata: parseJsonField(record.metadataJson, {})
  }));
}
