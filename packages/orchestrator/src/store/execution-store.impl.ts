// biome-ignore-all lint/suspicious/noExplicitAny: the orchestrator store is a thin SQLite DAO over additive JSON payloads persisted across many workflow surfaces.
import { DatabaseSync } from "node:sqlite";
import type { WorkspaceAllocationListOptions } from "../types/contracts.js";
import {
  mapGoalPlan,
  mapLearningRecord,
  mapProposalArtifact,
  mapRegressionRun,
  mapRegressionRunItem,
  mapScenarioRun,
  mapScenarioRunExecution,
  mapSchedulerEvaluation,
  mapWorkItem,
  mapWorkItemGroup,
  mapWorkItemRun,
  mapWorkspaceAllocation,
} from "./entity-mappers.js";
import {
  mapAuditRecordRow,
  mapEscalationRow,
  mapWorkflowEventRow,
  parseJsonField,
} from "./row-mappers.js";

function ensureColumn(db, tableName, columnName, sqlDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    try {
      db.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`,
      );
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
      metadata_json TEXT,
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
    CREATE TABLE IF NOT EXISTS scheduler_evaluations (
      id TEXT PRIMARY KEY,
      regression_id TEXT,
      requested_by TEXT,
      trigger_source TEXT,
      dry_run INTEGER NOT NULL DEFAULT 0,
      due_only INTEGER NOT NULL DEFAULT 1,
      max_runs INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      summary_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT,
      goal TEXT,
      status TEXT NOT NULL,
      priority TEXT,
      acceptance_json TEXT,
      related_docs_json TEXT,
      related_scenarios_json TEXT,
      related_regressions_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT
    );
    CREATE TABLE IF NOT EXISTS work_item_runs (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_source TEXT,
      requested_by TEXT,
      result_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS goal_plans (
      id TEXT PRIMARY KEY,
      title TEXT,
      goal TEXT NOT NULL,
      project_id TEXT,
      domain_id TEXT,
      mode TEXT,
      status TEXT NOT NULL,
      constraints_json TEXT,
      recommendations_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      materialized_at TEXT
    );
    CREATE TABLE IF NOT EXISTS work_item_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal_plan_id TEXT,
      status TEXT NOT NULL,
      summary_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT
    );
    CREATE TABLE IF NOT EXISTS proposal_artifacts (
      id TEXT PRIMARY KEY,
      work_item_run_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary_json TEXT,
      artifacts_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workspace_allocations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      execution_id TEXT,
      step_id TEXT,
      work_item_id TEXT,
      work_item_run_id TEXT,
      proposal_artifact_id TEXT,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_ref TEXT,
      integration_branch TEXT,
      mode TEXT NOT NULL,
      safe_mode INTEGER NOT NULL DEFAULT 1,
      mutation_scope_json TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cleaned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS learning_records (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_scheduler_evaluations_regression_id ON scheduler_evaluations(regression_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_item_runs_item_id ON work_item_runs(work_item_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_goal_plans_status ON goal_plans(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_item_groups_status ON work_item_groups(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proposal_artifacts_run_id ON proposal_artifacts(work_item_run_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_allocations_work_item_run_id
      ON workspace_allocations(work_item_run_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_allocations_execution_id
      ON workspace_allocations(execution_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_allocations_owner
      ON workspace_allocations(owner_type, owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_allocations_status
      ON workspace_allocations(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_learning_records_source ON learning_records(source_type, source_id, updated_at DESC);
  `);
  ensureColumn(
    db,
    "workflow_steps",
    "attempt_count",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "workflow_steps",
    "max_attempts",
    "INTEGER NOT NULL DEFAULT 1",
  );
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
  ensureColumn(db, "workflow_executions", "metadata_json", "TEXT");
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
      domain_id, policy_json, metadata_json, objective, state, review_status, approval_status, held_from_state, hold_reason, hold_owner, hold_guidance, hold_expires_at, paused_at,
      held_at, resumed_at, current_step_index, created_at, updated_at, started_at, ended_at
    ) VALUES (
      @id, @coordinationGroupId, @parentExecutionId, @branchKey,
      @workflowId, @workflowName, @workflowPath, @projectId, @projectName, @projectPath,
      @domainId, @policyJson, @metadataJson, @objective, @state, @reviewStatus, @approvalStatus, @heldFromState, @holdReason, @holdOwner, @holdGuidance, @holdExpiresAt, @pausedAt,
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
      metadataJson: JSON.stringify(execution.metadata ?? {}),
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
      endedAt: execution.endedAt,
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
        approvalRequired: step.approvalRequired ? 1 : 0,
        approvalStatus: step.approvalStatus,
        objective: step.objective,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        launchedAt: step.launchedAt,
        settledAt: step.settledAt,
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
      metadata_json = @metadataJson,
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
    metadataJson: JSON.stringify(execution.metadata ?? {}),
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
    endedAt: execution.endedAt,
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
    approvalRequired: step.approvalRequired ? 1 : 0,
    approvalStatus: step.approvalStatus,
    objective: step.objective,
    updatedAt: step.updatedAt,
    launchedAt: step.launchedAt,
    settledAt: step.settledAt,
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
    createdAt: event.createdAt,
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
    resolvedAt: escalation.resolvedAt,
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
    createdAt: record.createdAt,
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
    resolvedAt: escalation.resolvedAt,
  });
}

export function getExecution(db, executionId) {
  const execution = db
    .prepare(`
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
      metadata_json AS metadataJson,
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
  `)
    .get(executionId);
  return execution
    ? {
        ...execution,
        policy: parseJsonField(execution.policyJson),
        metadata: parseJsonField(execution.metadataJson),
      }
    : null;
}

export function listExecutions(db) {
  return db
    .prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
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
  `)
    .all()
    .map((execution) => ({
      ...execution,
      policy: parseJsonField(execution.policyJson),
      metadata: parseJsonField(execution.metadataJson),
    }));
}

export function listChildExecutions(db, parentExecutionId) {
  return db
    .prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
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
  `)
    .all(parentExecutionId)
    .map((execution) => ({
      ...execution,
      policy: parseJsonField(execution.policyJson),
      metadata: parseJsonField(execution.metadataJson),
    }));
}

export function listExecutionGroup(db, coordinationGroupId) {
  return db
    .prepare(`
    SELECT
      id,
      coordination_group_id AS coordinationGroupId,
      parent_execution_id AS parentExecutionId,
      branch_key AS branchKey,
      workflow_id AS workflowId,
      project_id AS projectId,
      domain_id AS domainId,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
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
  `)
    .all(coordinationGroupId)
    .map((execution) => ({
      ...execution,
      policy: parseJsonField(execution.policyJson),
      metadata: parseJsonField(execution.metadataJson),
    }));
}

export function listSteps(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId)
    .map((step) => ({
      ...step,
      reviewRequired: Boolean(step.reviewRequired),
      approvalRequired: Boolean(step.approvalRequired),
      policy: parseJsonField(step.policyJson),
    }));
}

export function getStep(db, stepId) {
  const step = db
    .prepare(`
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
  `)
    .get(stepId);
  return step
    ? {
        ...step,
        reviewRequired: Boolean(step.reviewRequired),
        approvalRequired: Boolean(step.approvalRequired),
        policy: parseJsonField(step.policyJson),
      }
    : null;
}

export function getEscalation(db, escalationId) {
  const record = db
    .prepare(`
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
  `)
    .get(escalationId);
  return record
    ? {
        ...record,
        payload: record.payloadJson ? JSON.parse(record.payloadJson) : {},
      }
    : null;
}

export function listReviews(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId);
}

export function listApprovals(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId);
}

export function listWorkflowEvents(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId)
    .map(mapWorkflowEventRow);
}

export function listEscalations(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId)
    .map(mapEscalationRow);
}

export function listAuditRecords(db, executionId) {
  return db
    .prepare(`
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
  `)
    .all(executionId)
    .map(mapAuditRecordRow);
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
    endedAt: run.endedAt ?? null,
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
    endedAt: run.endedAt ?? null,
  });
}

export function getScenarioRun(db, runId) {
  const record = db
    .prepare(`
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
  `)
    .get(runId);
  return mapScenarioRun(record);
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
  const rows = scenarioId
    ? statement.all(scenarioId, limit)
    : statement.all(limit);
  return rows.map((record) => mapScenarioRun(record));
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
    createdAt: row.createdAt,
  });
}

export function listScenarioRunExecutions(db, scenarioRunId) {
  return db
    .prepare(`
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
  `)
    .all(scenarioRunId)
    .map((record) => mapScenarioRunExecution(record));
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
    endedAt: run.endedAt ?? null,
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
    endedAt: run.endedAt ?? null,
  });
}

export function getRegressionRun(db, runId) {
  const record = db
    .prepare(`
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
  `)
    .get(runId);
  return mapRegressionRun(record);
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
  const rows = regressionId
    ? statement.all(regressionId, limit)
    : statement.all(limit);
  return rows.map((record) => mapRegressionRun(record));
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
    endedAt: item.endedAt ?? null,
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
    endedAt: item.endedAt ?? null,
  });
}

export function listRegressionRunItems(db, regressionRunId) {
  return db
    .prepare(`
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
  `)
    .all(regressionRunId)
    .map((record) => mapRegressionRunItem(record));
}

export function insertSchedulerEvaluation(db, evaluation) {
  db.prepare(`
    INSERT INTO scheduler_evaluations (
      id, regression_id, requested_by, trigger_source, dry_run, due_only, max_runs,
      status, summary_json, metadata_json, created_at, started_at, ended_at
    ) VALUES (
      @id, @regressionId, @requestedBy, @triggerSource, @dryRun, @dueOnly, @maxRuns,
      @status, @summaryJson, @metadataJson, @createdAt, @startedAt, @endedAt
    )
  `).run({
    id: evaluation.id,
    regressionId: evaluation.regressionId ?? null,
    requestedBy: evaluation.requestedBy ?? null,
    triggerSource: evaluation.triggerSource ?? null,
    dryRun: evaluation.dryRun ? 1 : 0,
    dueOnly: evaluation.dueOnly ? 1 : 0,
    maxRuns: evaluation.maxRuns ?? 1,
    status: evaluation.status,
    summaryJson: JSON.stringify(evaluation.summary ?? {}),
    metadataJson: JSON.stringify(evaluation.metadata ?? {}),
    createdAt: evaluation.createdAt,
    startedAt: evaluation.startedAt,
    endedAt: evaluation.endedAt ?? null,
  });
}

export function updateSchedulerEvaluation(db, evaluation) {
  db.prepare(`
    UPDATE scheduler_evaluations SET
      regression_id = @regressionId,
      requested_by = @requestedBy,
      trigger_source = @triggerSource,
      dry_run = @dryRun,
      due_only = @dueOnly,
      max_runs = @maxRuns,
      status = @status,
      summary_json = @summaryJson,
      metadata_json = @metadataJson,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: evaluation.id,
    regressionId: evaluation.regressionId ?? null,
    requestedBy: evaluation.requestedBy ?? null,
    triggerSource: evaluation.triggerSource ?? null,
    dryRun: evaluation.dryRun ? 1 : 0,
    dueOnly: evaluation.dueOnly ? 1 : 0,
    maxRuns: evaluation.maxRuns ?? 1,
    status: evaluation.status,
    summaryJson: JSON.stringify(evaluation.summary ?? {}),
    metadataJson: JSON.stringify(evaluation.metadata ?? {}),
    startedAt: evaluation.startedAt,
    endedAt: evaluation.endedAt ?? null,
  });
}

export function getSchedulerEvaluation(db, evaluationId) {
  const record = db
    .prepare(`
    SELECT
      id,
      regression_id AS regressionId,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      dry_run AS dryRun,
      due_only AS dueOnly,
      max_runs AS maxRuns,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM scheduler_evaluations
    WHERE id = ?
  `)
    .get(evaluationId);
  return mapSchedulerEvaluation(record);
}

export function listSchedulerEvaluations(db, regressionId = null, limit = 20) {
  const sql = `
    SELECT
      id,
      regression_id AS regressionId,
      requested_by AS requestedBy,
      trigger_source AS triggerSource,
      dry_run AS dryRun,
      due_only AS dueOnly,
      max_runs AS maxRuns,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM scheduler_evaluations
    ${regressionId ? "WHERE regression_id = ?" : ""}
    ORDER BY started_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = regressionId
    ? statement.all(regressionId, limit)
    : statement.all(limit);
  return rows.map((record) => mapSchedulerEvaluation(record));
}

export function insertWorkItem(db, item) {
  db.prepare(`
    INSERT INTO work_items (
      id, title, kind, source, goal, status, priority, acceptance_json,
      related_docs_json, related_scenarios_json, related_regressions_json,
      metadata_json, created_at, updated_at, last_run_at
    ) VALUES (
      @id, @title, @kind, @source, @goal, @status, @priority, @acceptanceJson,
      @relatedDocsJson, @relatedScenariosJson, @relatedRegressionsJson,
      @metadataJson, @createdAt, @updatedAt, @lastRunAt
    )
  `).run({
    id: item.id,
    title: item.title,
    kind: item.kind,
    source: item.source ?? null,
    goal: item.goal ?? null,
    status: item.status,
    priority: item.priority ?? null,
    acceptanceJson: JSON.stringify(item.acceptanceCriteria ?? []),
    relatedDocsJson: JSON.stringify(item.relatedDocs ?? []),
    relatedScenariosJson: JSON.stringify(item.relatedScenarios ?? []),
    relatedRegressionsJson: JSON.stringify(item.relatedRegressions ?? []),
    metadataJson: JSON.stringify(item.metadata ?? {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastRunAt: item.lastRunAt ?? null,
  });
}

export function updateWorkItem(db, item) {
  db.prepare(`
    UPDATE work_items SET
      title = @title,
      kind = @kind,
      source = @source,
      goal = @goal,
      status = @status,
      priority = @priority,
      acceptance_json = @acceptanceJson,
      related_docs_json = @relatedDocsJson,
      related_scenarios_json = @relatedScenariosJson,
      related_regressions_json = @relatedRegressionsJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      last_run_at = @lastRunAt
    WHERE id = @id
  `).run({
    id: item.id,
    title: item.title,
    kind: item.kind,
    source: item.source ?? null,
    goal: item.goal ?? null,
    status: item.status,
    priority: item.priority ?? null,
    acceptanceJson: JSON.stringify(item.acceptanceCriteria ?? []),
    relatedDocsJson: JSON.stringify(item.relatedDocs ?? []),
    relatedScenariosJson: JSON.stringify(item.relatedScenarios ?? []),
    relatedRegressionsJson: JSON.stringify(item.relatedRegressions ?? []),
    metadataJson: JSON.stringify(item.metadata ?? {}),
    updatedAt: item.updatedAt,
    lastRunAt: item.lastRunAt ?? null,
  });
}

export function getWorkItem(db, itemId) {
  const record = db
    .prepare(`
    SELECT
      id,
      title,
      kind,
      source,
      goal,
      status,
      priority,
      acceptance_json AS acceptanceJson,
      related_docs_json AS relatedDocsJson,
      related_scenarios_json AS relatedScenariosJson,
      related_regressions_json AS relatedRegressionsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_run_at AS lastRunAt
    FROM work_items
    WHERE id = ?
  `)
    .get(itemId);
  return mapWorkItem(record);
}

export function listWorkItems(db, status = null, limit = 50) {
  const sql = `
    SELECT
      id,
      title,
      kind,
      source,
      goal,
      status,
      priority,
      acceptance_json AS acceptanceJson,
      related_docs_json AS relatedDocsJson,
      related_scenarios_json AS relatedScenariosJson,
      related_regressions_json AS relatedRegressionsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_run_at AS lastRunAt
    FROM work_items
    ${status ? "WHERE status = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = status ? statement.all(status, limit) : statement.all(limit);
  return rows.map((record) => mapWorkItem(record));
}

export function insertWorkItemRun(db, run) {
  db.prepare(`
    INSERT INTO work_item_runs (
      id, work_item_id, status, trigger_source, requested_by,
      result_json, metadata_json, created_at, started_at, ended_at
    ) VALUES (
      @id, @workItemId, @status, @triggerSource, @requestedBy,
      @resultJson, @metadataJson, @createdAt, @startedAt, @endedAt
    )
  `).run({
    id: run.id,
    workItemId: run.workItemId,
    status: run.status,
    triggerSource: run.triggerSource ?? null,
    requestedBy: run.requestedBy ?? null,
    resultJson: JSON.stringify(run.result ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
  });
}

export function updateWorkItemRun(db, run) {
  db.prepare(`
    UPDATE work_item_runs SET
      status = @status,
      trigger_source = @triggerSource,
      requested_by = @requestedBy,
      result_json = @resultJson,
      metadata_json = @metadataJson,
      started_at = @startedAt,
      ended_at = @endedAt
    WHERE id = @id
  `).run({
    id: run.id,
    status: run.status,
    triggerSource: run.triggerSource ?? null,
    requestedBy: run.requestedBy ?? null,
    resultJson: JSON.stringify(run.result ?? {}),
    metadataJson: JSON.stringify(run.metadata ?? {}),
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
  });
}

export function getWorkItemRun(db, runId) {
  const record = db
    .prepare(`
    SELECT
      id,
      work_item_id AS workItemId,
      status,
      trigger_source AS triggerSource,
      requested_by AS requestedBy,
      result_json AS resultJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM work_item_runs
    WHERE id = ?
  `)
    .get(runId);
  return mapWorkItemRun(record);
}

export function listWorkItemRuns(db, workItemId, limit = 20) {
  return db
    .prepare(`
    SELECT
      id,
      work_item_id AS workItemId,
      status,
      trigger_source AS triggerSource,
      requested_by AS requestedBy,
      result_json AS resultJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      started_at AS startedAt,
      ended_at AS endedAt
    FROM work_item_runs
    WHERE work_item_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `)
    .all(workItemId, limit)
    .map((record) => mapWorkItemRun(record));
}

export function insertGoalPlan(db, plan) {
  db.prepare(`
    INSERT INTO goal_plans (
      id, title, goal, project_id, domain_id, mode, status,
      constraints_json, recommendations_json, metadata_json,
      created_at, updated_at, materialized_at
    ) VALUES (
      @id, @title, @goal, @projectId, @domainId, @mode, @status,
      @constraintsJson, @recommendationsJson, @metadataJson,
      @createdAt, @updatedAt, @materializedAt
    )
  `).run({
    id: plan.id,
    title: plan.title ?? null,
    goal: plan.goal,
    projectId: plan.projectId ?? null,
    domainId: plan.domainId ?? null,
    mode: plan.mode ?? null,
    status: plan.status,
    constraintsJson: JSON.stringify(plan.constraints ?? {}),
    recommendationsJson: JSON.stringify(plan.recommendations ?? []),
    metadataJson: JSON.stringify(plan.metadata ?? {}),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    materializedAt: plan.materializedAt ?? null,
  });
}

export function updateGoalPlan(db, plan) {
  db.prepare(`
    UPDATE goal_plans SET
      title = @title,
      goal = @goal,
      project_id = @projectId,
      domain_id = @domainId,
      mode = @mode,
      status = @status,
      constraints_json = @constraintsJson,
      recommendations_json = @recommendationsJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      materialized_at = @materializedAt
    WHERE id = @id
  `).run({
    id: plan.id,
    title: plan.title ?? null,
    goal: plan.goal,
    projectId: plan.projectId ?? null,
    domainId: plan.domainId ?? null,
    mode: plan.mode ?? null,
    status: plan.status,
    constraintsJson: JSON.stringify(plan.constraints ?? {}),
    recommendationsJson: JSON.stringify(plan.recommendations ?? []),
    metadataJson: JSON.stringify(plan.metadata ?? {}),
    updatedAt: plan.updatedAt,
    materializedAt: plan.materializedAt ?? null,
  });
}

export function getGoalPlan(db, planId) {
  const record = db
    .prepare(`
    SELECT
      id,
      title,
      goal,
      project_id AS projectId,
      domain_id AS domainId,
      mode,
      status,
      constraints_json AS constraintsJson,
      recommendations_json AS recommendationsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      materialized_at AS materializedAt
    FROM goal_plans
    WHERE id = ?
  `)
    .get(planId);
  return mapGoalPlan(record);
}

export function listGoalPlans(db, status = null, limit = 50) {
  const sql = `
    SELECT
      id,
      title,
      goal,
      project_id AS projectId,
      domain_id AS domainId,
      mode,
      status,
      constraints_json AS constraintsJson,
      recommendations_json AS recommendationsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      materialized_at AS materializedAt
    FROM goal_plans
    ${status ? "WHERE status = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = status ? statement.all(status, limit) : statement.all(limit);
  return rows.map((record) => mapGoalPlan(record));
}

export function insertWorkItemGroup(db, group) {
  db.prepare(`
    INSERT INTO work_item_groups (
      id, title, goal_plan_id, status, summary_json, metadata_json,
      created_at, updated_at, last_run_at
    ) VALUES (
      @id, @title, @goalPlanId, @status, @summaryJson, @metadataJson,
      @createdAt, @updatedAt, @lastRunAt
    )
  `).run({
    id: group.id,
    title: group.title,
    goalPlanId: group.goalPlanId ?? null,
    status: group.status,
    summaryJson: JSON.stringify(group.summary ?? {}),
    metadataJson: JSON.stringify(group.metadata ?? {}),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    lastRunAt: group.lastRunAt ?? null,
  });
}

export function updateWorkItemGroup(db, group) {
  db.prepare(`
    UPDATE work_item_groups SET
      title = @title,
      goal_plan_id = @goalPlanId,
      status = @status,
      summary_json = @summaryJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      last_run_at = @lastRunAt
    WHERE id = @id
  `).run({
    id: group.id,
    title: group.title,
    goalPlanId: group.goalPlanId ?? null,
    status: group.status,
    summaryJson: JSON.stringify(group.summary ?? {}),
    metadataJson: JSON.stringify(group.metadata ?? {}),
    updatedAt: group.updatedAt,
    lastRunAt: group.lastRunAt ?? null,
  });
}

export function getWorkItemGroup(db, groupId) {
  const record = db
    .prepare(`
    SELECT
      id,
      title,
      goal_plan_id AS goalPlanId,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_run_at AS lastRunAt
    FROM work_item_groups
    WHERE id = ?
  `)
    .get(groupId);
  return mapWorkItemGroup(record);
}

export function listWorkItemGroups(db, status = null, limit = 50) {
  const sql = `
    SELECT
      id,
      title,
      goal_plan_id AS goalPlanId,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_run_at AS lastRunAt
    FROM work_item_groups
    ${status ? "WHERE status = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = status ? statement.all(status, limit) : statement.all(limit);
  return rows.map((record) => mapWorkItemGroup(record));
}

export function insertProposalArtifact(db, artifact) {
  db.prepare(`
    INSERT INTO proposal_artifacts (
      id, work_item_run_id, work_item_id, status, kind, summary_json,
      artifacts_json, metadata_json, created_at, updated_at, reviewed_at, approved_at
    ) VALUES (
      @id, @workItemRunId, @workItemId, @status, @kind, @summaryJson,
      @artifactsJson, @metadataJson, @createdAt, @updatedAt, @reviewedAt, @approvedAt
    )
  `).run({
    id: artifact.id,
    workItemRunId: artifact.workItemRunId,
    workItemId: artifact.workItemId,
    status: artifact.status,
    kind: artifact.kind,
    summaryJson: JSON.stringify(artifact.summary ?? {}),
    artifactsJson: JSON.stringify(artifact.artifacts ?? {}),
    metadataJson: JSON.stringify(artifact.metadata ?? {}),
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    reviewedAt: artifact.reviewedAt ?? null,
    approvedAt: artifact.approvedAt ?? null,
  });
}

export function updateProposalArtifact(db, artifact) {
  db.prepare(`
    UPDATE proposal_artifacts SET
      work_item_run_id = @workItemRunId,
      work_item_id = @workItemId,
      status = @status,
      kind = @kind,
      summary_json = @summaryJson,
      artifacts_json = @artifactsJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      reviewed_at = @reviewedAt,
      approved_at = @approvedAt
    WHERE id = @id
  `).run({
    id: artifact.id,
    workItemRunId: artifact.workItemRunId,
    workItemId: artifact.workItemId,
    status: artifact.status,
    kind: artifact.kind,
    summaryJson: JSON.stringify(artifact.summary ?? {}),
    artifactsJson: JSON.stringify(artifact.artifacts ?? {}),
    metadataJson: JSON.stringify(artifact.metadata ?? {}),
    updatedAt: artifact.updatedAt,
    reviewedAt: artifact.reviewedAt ?? null,
    approvedAt: artifact.approvedAt ?? null,
  });
}

export function getProposalArtifact(db, artifactId) {
  const record = db
    .prepare(`
    SELECT
      id,
      work_item_run_id AS workItemRunId,
      work_item_id AS workItemId,
      status,
      kind,
      summary_json AS summaryJson,
      artifacts_json AS artifactsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      approved_at AS approvedAt
    FROM proposal_artifacts
    WHERE id = ?
  `)
    .get(artifactId);
  return mapProposalArtifact(record);
}

export function getProposalArtifactByRunId(db, runId) {
  const record = db
    .prepare(`
    SELECT
      id,
      work_item_run_id AS workItemRunId,
      work_item_id AS workItemId,
      status,
      kind,
      summary_json AS summaryJson,
      artifacts_json AS artifactsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      approved_at AS approvedAt
    FROM proposal_artifacts
    WHERE work_item_run_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(runId);
  return mapProposalArtifact(record);
}

export function listProposalArtifacts(db, workItemId = null, limit = 50) {
  const sql = `
    SELECT
      id,
      work_item_run_id AS workItemRunId,
      work_item_id AS workItemId,
      status,
      kind,
      summary_json AS summaryJson,
      artifacts_json AS artifactsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      approved_at AS approvedAt
    FROM proposal_artifacts
    ${workItemId ? "WHERE work_item_id = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = workItemId
    ? statement.all(workItemId, limit)
    : statement.all(limit);
  return rows.map((record) => mapProposalArtifact(record));
}

export function insertWorkspaceAllocation(db, allocation) {
  db.prepare(`
    INSERT INTO workspace_allocations (
      id, project_id, owner_type, owner_id, execution_id, step_id, work_item_id, work_item_run_id,
      proposal_artifact_id, worktree_path, branch_name, base_ref, integration_branch, mode, safe_mode,
      mutation_scope_json, status, metadata_json, created_at, updated_at, cleaned_at
    ) VALUES (
      @id, @projectId, @ownerType, @ownerId, @executionId, @stepId, @workItemId, @workItemRunId,
      @proposalArtifactId, @worktreePath, @branchName, @baseRef, @integrationBranch, @mode, @safeMode,
      @mutationScopeJson, @status, @metadataJson, @createdAt, @updatedAt, @cleanedAt
    )
  `).run({
    id: allocation.id,
    projectId: allocation.projectId ?? null,
    ownerType: allocation.ownerType,
    ownerId: allocation.ownerId,
    executionId: allocation.executionId ?? null,
    stepId: allocation.stepId ?? null,
    workItemId: allocation.workItemId ?? null,
    workItemRunId: allocation.workItemRunId ?? null,
    proposalArtifactId: allocation.proposalArtifactId ?? null,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName,
    baseRef: allocation.baseRef ?? null,
    integrationBranch: allocation.integrationBranch ?? null,
    mode: allocation.mode ?? "git-worktree",
    safeMode: allocation.safeMode === false ? 0 : 1,
    mutationScopeJson: JSON.stringify(allocation.mutationScope ?? []),
    status: allocation.status,
    metadataJson: JSON.stringify(allocation.metadata ?? {}),
    createdAt: allocation.createdAt,
    updatedAt: allocation.updatedAt,
    cleanedAt: allocation.cleanedAt ?? null,
  });
}

export function updateWorkspaceAllocation(db, allocation) {
  db.prepare(`
    UPDATE workspace_allocations SET
      project_id = @projectId,
      owner_type = @ownerType,
      owner_id = @ownerId,
      execution_id = @executionId,
      step_id = @stepId,
      work_item_id = @workItemId,
      work_item_run_id = @workItemRunId,
      proposal_artifact_id = @proposalArtifactId,
      worktree_path = @worktreePath,
      branch_name = @branchName,
      base_ref = @baseRef,
      integration_branch = @integrationBranch,
      mode = @mode,
      safe_mode = @safeMode,
      mutation_scope_json = @mutationScopeJson,
      status = @status,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      cleaned_at = @cleanedAt
    WHERE id = @id
  `).run({
    id: allocation.id,
    projectId: allocation.projectId ?? null,
    ownerType: allocation.ownerType,
    ownerId: allocation.ownerId,
    executionId: allocation.executionId ?? null,
    stepId: allocation.stepId ?? null,
    workItemId: allocation.workItemId ?? null,
    workItemRunId: allocation.workItemRunId ?? null,
    proposalArtifactId: allocation.proposalArtifactId ?? null,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName,
    baseRef: allocation.baseRef ?? null,
    integrationBranch: allocation.integrationBranch ?? null,
    mode: allocation.mode ?? "git-worktree",
    safeMode: allocation.safeMode === false ? 0 : 1,
    mutationScopeJson: JSON.stringify(allocation.mutationScope ?? []),
    status: allocation.status,
    metadataJson: JSON.stringify(allocation.metadata ?? {}),
    updatedAt: allocation.updatedAt,
    cleanedAt: allocation.cleanedAt ?? null,
  });
}

export function getWorkspaceAllocation(db, allocationId) {
  const record = db
    .prepare(`
    SELECT
      id,
      project_id AS projectId,
      owner_type AS ownerType,
      owner_id AS ownerId,
      execution_id AS executionId,
      step_id AS stepId,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      worktree_path AS worktreePath,
      branch_name AS branchName,
      base_ref AS baseRef,
      integration_branch AS integrationBranch,
      mode,
      safe_mode AS safeMode,
      mutation_scope_json AS mutationScopeJson,
      status,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      cleaned_at AS cleanedAt
    FROM workspace_allocations
    WHERE id = ?
  `)
    .get(allocationId);
  return mapWorkspaceAllocation(record);
}

export function getWorkspaceAllocationByRunId(db, workItemRunId) {
  const record = db
    .prepare(`
    SELECT
      id,
      project_id AS projectId,
      owner_type AS ownerType,
      owner_id AS ownerId,
      execution_id AS executionId,
      step_id AS stepId,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      worktree_path AS worktreePath,
      branch_name AS branchName,
      base_ref AS baseRef,
      integration_branch AS integrationBranch,
      mode,
      safe_mode AS safeMode,
      mutation_scope_json AS mutationScopeJson,
      status,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      cleaned_at AS cleanedAt
    FROM workspace_allocations
    WHERE work_item_run_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(workItemRunId);
  return mapWorkspaceAllocation(record);
}

export function getWorkspaceAllocationByStepId(db, stepId) {
  const record = db
    .prepare(`
    SELECT
      id,
      project_id AS projectId,
      owner_type AS ownerType,
      owner_id AS ownerId,
      execution_id AS executionId,
      step_id AS stepId,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      worktree_path AS worktreePath,
      branch_name AS branchName,
      base_ref AS baseRef,
      integration_branch AS integrationBranch,
      mode,
      safe_mode AS safeMode,
      mutation_scope_json AS mutationScopeJson,
      status,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      cleaned_at AS cleanedAt
    FROM workspace_allocations
    WHERE step_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(stepId);
  return mapWorkspaceAllocation(record);
}

export function listWorkspaceAllocations(
  db,
  options: WorkspaceAllocationListOptions = {},
) {
  const clauses = [];
  const params = [];
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.ownerType) {
    clauses.push("owner_type = ?");
    params.push(options.ownerType);
  }
  if (options.workItemId) {
    clauses.push("work_item_id = ?");
    params.push(options.workItemId);
  }
  if (options.workItemRunId) {
    clauses.push("work_item_run_id = ?");
    params.push(options.workItemRunId);
  }
  if (options.executionId) {
    clauses.push("execution_id = ?");
    params.push(options.executionId);
  }
  if (options.stepId) {
    clauses.push("step_id = ?");
    params.push(options.stepId);
  }
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const sql = `
    SELECT
      id,
      project_id AS projectId,
      owner_type AS ownerType,
      owner_id AS ownerId,
      execution_id AS executionId,
      step_id AS stepId,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      worktree_path AS worktreePath,
      branch_name AS branchName,
      base_ref AS baseRef,
      integration_branch AS integrationBranch,
      mode,
      safe_mode AS safeMode,
      mutation_scope_json AS mutationScopeJson,
      status,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      cleaned_at AS cleanedAt
    FROM workspace_allocations
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);
  return rows.map((record) => mapWorkspaceAllocation(record));
}

export function insertLearningRecord(db, record) {
  db.prepare(`
    INSERT INTO learning_records (
      id, source_type, source_id, kind, status, summary, details_json, metadata_json,
      created_at, updated_at
    ) VALUES (
      @id, @sourceType, @sourceId, @kind, @status, @summary, @detailsJson, @metadataJson,
      @createdAt, @updatedAt
    )
  `).run({
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    kind: record.kind,
    status: record.status,
    summary: record.summary,
    detailsJson: JSON.stringify(record.details ?? {}),
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function updateLearningRecord(db, record) {
  db.prepare(`
    UPDATE learning_records SET
      source_type = @sourceType,
      source_id = @sourceId,
      kind = @kind,
      status = @status,
      summary = @summary,
      details_json = @detailsJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    kind: record.kind,
    status: record.status,
    summary: record.summary,
    detailsJson: JSON.stringify(record.details ?? {}),
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
  });
}

export function getLearningRecord(db, recordId) {
  const record = db
    .prepare(`
    SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      kind,
      status,
      summary,
      details_json AS detailsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM learning_records
    WHERE id = ?
  `)
    .get(recordId);
  return mapLearningRecord(record);
}

export function listLearningRecords(db, sourceType = null, limit = 50) {
  const sql = `
    SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      kind,
      status,
      summary,
      details_json AS detailsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM learning_records
    ${sourceType ? "WHERE source_type = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = sourceType
    ? statement.all(sourceType, limit)
    : statement.all(limit);
  return rows.map((record) => mapLearningRecord(record));
}
