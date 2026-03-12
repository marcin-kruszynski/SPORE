// biome-ignore-all lint/suspicious/noExplicitAny: the orchestrator store is a thin SQLite DAO over additive JSON payloads persisted across many workflow surfaces.
import { DatabaseSync } from "node:sqlite";
import type {
  DocSuggestionRecordListOptions,
  OperatorThreadActionListOptions,
  OperatorThreadListOptions,
  PolicyRecommendationReviewListOptions,
  QuarantineRecordListOptions,
  RollbackRecordListOptions,
  SelfBuildDecisionListOptions,
  SelfBuildIntakeListOptions,
  SelfBuildOverrideListOptions,
  WorkflowHandoffListOptions,
  WorkspaceAllocationListOptions,
} from "../types/contracts.js";
import {
  mapDocSuggestionRecord,
  mapGoalPlan,
  mapIntegrationBranch,
  mapLearningRecord,
  mapOperatorThread,
  mapOperatorThreadAction,
  mapOperatorThreadMessage,
  mapPolicyRecommendationReview,
  mapProposalArtifact,
  mapQuarantineRecord,
  mapRegressionRun,
  mapRegressionRunItem,
  mapRollbackRecord,
  mapScenarioRun,
  mapScenarioRunExecution,
  mapSchedulerEvaluation,
  mapSelfBuildDecision,
  mapSelfBuildIntakeRecord,
  mapSelfBuildLoopState,
  mapSelfBuildOverrideRecord,
  mapWorkItem,
  mapWorkItemGroup,
  mapWorkItemRun,
  mapWorkflowHandoff,
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
    PRAGMA busy_timeout = 10000;
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
    CREATE TABLE IF NOT EXISTS workflow_handoffs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      from_step_id TEXT NOT NULL,
      to_step_id TEXT NOT NULL DEFAULT '',
      source_role TEXT NOT NULL,
      target_role TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      summary_json TEXT,
      artifacts_json TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_handoffs_execution
      ON workflow_handoffs(execution_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_handoffs_from_step
      ON workflow_handoffs(from_step_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_handoffs_to_step
      ON workflow_handoffs(to_step_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_handoffs_status
      ON workflow_handoffs(status, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_handoffs_unique
      ON workflow_handoffs(execution_id, from_step_id, kind, to_step_id);
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
    CREATE TABLE IF NOT EXISTS doc_suggestion_records (
      id TEXT PRIMARY KEY,
      work_item_id TEXT,
      work_item_run_id TEXT,
      proposal_artifact_id TEXT,
      kind TEXT NOT NULL,
      target_path TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      materialized_at TEXT
    );
    CREATE TABLE IF NOT EXISTS self_build_intake_records (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      goal TEXT NOT NULL,
      project_id TEXT,
      domain_id TEXT,
      template_id TEXT,
      goal_plan_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS integration_branches (
      name TEXT PRIMARY KEY,
      project_id TEXT,
      status TEXT NOT NULL,
      target_branch TEXT,
      source_execution_id TEXT,
      proposal_artifact_ids_json TEXT,
      workspace_ids_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_promotion_at TEXT
    );
    CREATE TABLE IF NOT EXISTS self_build_loop_state (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      mode TEXT,
      project_id TEXT,
      policy_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT,
      started_at TEXT,
      stopped_at TEXT
    );
    CREATE TABLE IF NOT EXISTS self_build_decisions (
      id TEXT PRIMARY KEY,
      loop_id TEXT,
      mode TEXT,
      state TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      rationale TEXT,
      policy_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operator_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_id TEXT,
      status TEXT NOT NULL,
      summary_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      latest_message_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_operator_threads_status_updated
      ON operator_threads(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS operator_thread_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operator_thread_messages_thread_created
      ON operator_thread_messages(thread_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS operator_thread_actions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      target_type TEXT,
      target_id TEXT,
      payload_json TEXT,
      options_json TEXT,
      links_json TEXT,
      requested_by TEXT,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_operator_thread_actions_thread_status_requested
      ON operator_thread_actions(thread_id, status, requested_at DESC);
    CREATE TABLE IF NOT EXISTS self_build_override_records (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT,
      source TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS policy_recommendation_reviews (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      reason TEXT,
      reviewed_by TEXT,
      source TEXT,
      materialized_intake_id TEXT,
      materialized_goal_plan_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      materialized_at TEXT
    );
    CREATE TABLE IF NOT EXISTS quarantine_records (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS rollback_records (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_doc_suggestion_records_run_id
      ON doc_suggestion_records(work_item_run_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_suggestion_records_status
      ON doc_suggestion_records(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_intake_status
      ON self_build_intake_records(status, priority DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_intake_source
      ON self_build_intake_records(source_type, source_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_integration_branches_status
      ON integration_branches(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_loop_state_status
      ON self_build_loop_state(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_decisions_created_at
      ON self_build_decisions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_decisions_target
      ON self_build_decisions(target_type, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_override_records_target
      ON self_build_override_records(target_type, target_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_self_build_override_records_status
      ON self_build_override_records(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_policy_recommendation_reviews_status
      ON policy_recommendation_reviews(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quarantine_records_target
      ON quarantine_records(target_type, target_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rollback_records_target
      ON rollback_records(target_type, target_id, updated_at DESC);
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

function normalizeWorkflowHandoff(handoff) {
  return {
    id: handoff.id,
    executionId: handoff.executionId,
    fromStepId: handoff.fromStepId,
    toStepId: handoff.toStepId ?? "",
    sourceRole: handoff.sourceRole,
    targetRole: handoff.targetRole ?? null,
    kind: handoff.kind,
    status: handoff.status,
    summaryJson: JSON.stringify(handoff.summary ?? {}),
    artifactsJson: JSON.stringify(handoff.artifacts ?? {}),
    payloadJson: JSON.stringify(handoff.payload ?? {}),
    createdAt: handoff.createdAt,
    updatedAt: handoff.updatedAt,
    consumedAt: handoff.consumedAt ?? null,
  };
}

export function upsertWorkflowHandoff(db, handoff) {
  const normalized = normalizeWorkflowHandoff(handoff);
  db.prepare(`
    INSERT INTO workflow_handoffs (
      id, execution_id, from_step_id, to_step_id, source_role, target_role,
      kind, status, summary_json, artifacts_json, payload_json,
      created_at, updated_at, consumed_at
    ) VALUES (
      @id, @executionId, @fromStepId, @toStepId, @sourceRole, @targetRole,
      @kind, @status, @summaryJson, @artifactsJson, @payloadJson,
      @createdAt, @updatedAt, @consumedAt
    )
    ON CONFLICT(execution_id, from_step_id, kind, to_step_id)
    DO UPDATE SET
      id = excluded.id,
      source_role = excluded.source_role,
      target_role = excluded.target_role,
      status = excluded.status,
      summary_json = excluded.summary_json,
      artifacts_json = excluded.artifacts_json,
      payload_json = excluded.payload_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      consumed_at = excluded.consumed_at
  `).run(normalized);
}

export function markWorkflowHandoffConsumed(db, handoffId, consumedAt) {
  db.prepare(`
    UPDATE workflow_handoffs
    SET status = 'consumed', updated_at = @consumedAt, consumed_at = @consumedAt
    WHERE id = @id
  `).run({
    id: handoffId,
    consumedAt,
  });
}

export function getWorkflowHandoff(db, handoffId) {
  const record = db
    .prepare(`
      SELECT
        id,
        execution_id AS executionId,
        from_step_id AS fromStepId,
        to_step_id AS toStepId,
        source_role AS sourceRole,
        target_role AS targetRole,
        kind,
        status,
        summary_json AS summaryJson,
        artifacts_json AS artifactsJson,
        payload_json AS payloadJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        consumed_at AS consumedAt
      FROM workflow_handoffs
      WHERE id = ?
    `)
    .get(handoffId);
  return mapWorkflowHandoff(record);
}

export function listWorkflowHandoffs(
  db,
  options: WorkflowHandoffListOptions = {},
) {
  const clauses = [];
  const params = [];
  if (options.executionId) {
    clauses.push("execution_id = ?");
    params.push(options.executionId);
  }
  if (options.fromStepId) {
    clauses.push("from_step_id = ?");
    params.push(options.fromStepId);
  }
  if (options.toStepId) {
    clauses.push("to_step_id = ?");
    params.push(options.toStepId);
  }
  if (options.sourceRole) {
    clauses.push("source_role = ?");
    params.push(options.sourceRole);
  }
  if (options.targetRole) {
    clauses.push("target_role = ?");
    params.push(options.targetRole);
  }
  if (options.kind) {
    clauses.push("kind = ?");
    params.push(options.kind);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const rows = db
    .prepare(`
      SELECT
        id,
        execution_id AS executionId,
        from_step_id AS fromStepId,
        to_step_id AS toStepId,
        source_role AS sourceRole,
        target_role AS targetRole,
        kind,
        status,
        summary_json AS summaryJson,
        artifacts_json AS artifactsJson,
        payload_json AS payloadJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        consumed_at AS consumedAt
      FROM workflow_handoffs
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `)
    .all(...params, limit);
  return rows.map((record) => mapWorkflowHandoff(record));
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

export function insertDocSuggestionRecord(db, record) {
  db.prepare(`
    INSERT INTO doc_suggestion_records (
      id, work_item_id, work_item_run_id, proposal_artifact_id, kind, target_path,
      status, summary, payload_json, metadata_json, created_at, updated_at, reviewed_at, materialized_at
    ) VALUES (
      @id, @workItemId, @workItemRunId, @proposalArtifactId, @kind, @targetPath,
      @status, @summary, @payloadJson, @metadataJson, @createdAt, @updatedAt, @reviewedAt, @materializedAt
    )
  `).run({
    id: record.id,
    workItemId: record.workItemId ?? null,
    workItemRunId: record.workItemRunId ?? null,
    proposalArtifactId: record.proposalArtifactId ?? null,
    kind: record.kind,
    targetPath: record.targetPath ?? null,
    status: record.status,
    summary: record.summary,
    payloadJson: JSON.stringify(record.payload ?? {}),
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt ?? null,
    materializedAt: record.materializedAt ?? null,
  });
}

export function updateDocSuggestionRecord(db, record) {
  db.prepare(`
    UPDATE doc_suggestion_records SET
      work_item_id = @workItemId,
      work_item_run_id = @workItemRunId,
      proposal_artifact_id = @proposalArtifactId,
      kind = @kind,
      target_path = @targetPath,
      status = @status,
      summary = @summary,
      payload_json = @payloadJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      reviewed_at = @reviewedAt,
      materialized_at = @materializedAt
    WHERE id = @id
  `).run({
    id: record.id,
    workItemId: record.workItemId ?? null,
    workItemRunId: record.workItemRunId ?? null,
    proposalArtifactId: record.proposalArtifactId ?? null,
    kind: record.kind,
    targetPath: record.targetPath ?? null,
    status: record.status,
    summary: record.summary,
    payloadJson: JSON.stringify(record.payload ?? {}),
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt ?? null,
    materializedAt: record.materializedAt ?? null,
  });
}

export function getDocSuggestionRecord(db, id) {
  const record = db
    .prepare(`
    SELECT
      id,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      kind,
      target_path AS targetPath,
      status,
      summary,
      payload_json AS payloadJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      materialized_at AS materializedAt
    FROM doc_suggestion_records
    WHERE id = ?
  `)
    .get(id);
  return mapDocSuggestionRecord(record);
}

export function findDocSuggestionRecordByRunAndKind(
  db,
  workItemRunId,
  kind,
  targetPath = null,
) {
  const record = db
    .prepare(`
    SELECT
      id,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      kind,
      target_path AS targetPath,
      status,
      summary,
      payload_json AS payloadJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      materialized_at AS materializedAt
    FROM doc_suggestion_records
    WHERE work_item_run_id = ? AND kind = ? AND (target_path = ? OR (? IS NULL AND target_path IS NULL))
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(workItemRunId, kind, targetPath, targetPath);
  return mapDocSuggestionRecord(record);
}

export function listDocSuggestionRecords(
  db,
  options: DocSuggestionRecordListOptions = {},
) {
  const where = [];
  const params = [];
  if (options.status) {
    where.push("status = ?");
    params.push(String(options.status).trim());
  }
  if (options.workItemId) {
    where.push("work_item_id = ?");
    params.push(String(options.workItemId).trim());
  }
  if (options.workItemRunId) {
    where.push("work_item_run_id = ?");
    params.push(String(options.workItemRunId).trim());
  }
  if (options.proposalArtifactId) {
    where.push("proposal_artifact_id = ?");
    params.push(String(options.proposalArtifactId).trim());
  }
  if (options.kind) {
    where.push("kind = ?");
    params.push(String(options.kind).trim());
  }
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const sql = `
    SELECT
      id,
      work_item_id AS workItemId,
      work_item_run_id AS workItemRunId,
      proposal_artifact_id AS proposalArtifactId,
      kind,
      target_path AS targetPath,
      status,
      summary,
      payload_json AS payloadJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      materialized_at AS materializedAt
    FROM doc_suggestion_records
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapDocSuggestionRecord(record));
}

export function upsertDocSuggestionRecord(db, record) {
  const existing = getDocSuggestionRecord(db, record.id);
  if (existing) {
    updateDocSuggestionRecord(db, { ...existing, ...record });
    return getDocSuggestionRecord(db, record.id);
  }
  insertDocSuggestionRecord(db, record);
  return getDocSuggestionRecord(db, record.id);
}

export function insertSelfBuildIntakeRecord(db, record) {
  db.prepare(`
    INSERT INTO self_build_intake_records (
      id, source_type, source_id, kind, status, priority, goal, project_id,
      domain_id, template_id, goal_plan_id, metadata_json, created_at, updated_at, consumed_at
    ) VALUES (
      @id, @sourceType, @sourceId, @kind, @status, @priority, @goal, @projectId,
      @domainId, @templateId, @goalPlanId, @metadataJson, @createdAt, @updatedAt, @consumedAt
    )
  `).run({
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    kind: record.kind,
    status: record.status,
    priority: Number(record.priority ?? 0) || 0,
    goal: record.goal,
    projectId: record.projectId ?? null,
    domainId: record.domainId ?? null,
    templateId: record.templateId ?? null,
    goalPlanId: record.goalPlanId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    consumedAt: record.consumedAt ?? null,
  });
}

export function updateSelfBuildIntakeRecord(db, record) {
  db.prepare(`
    UPDATE self_build_intake_records SET
      source_type = @sourceType,
      source_id = @sourceId,
      kind = @kind,
      status = @status,
      priority = @priority,
      goal = @goal,
      project_id = @projectId,
      domain_id = @domainId,
      template_id = @templateId,
      goal_plan_id = @goalPlanId,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      consumed_at = @consumedAt
    WHERE id = @id
  `).run({
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    kind: record.kind,
    status: record.status,
    priority: Number(record.priority ?? 0) || 0,
    goal: record.goal,
    projectId: record.projectId ?? null,
    domainId: record.domainId ?? null,
    templateId: record.templateId ?? null,
    goalPlanId: record.goalPlanId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
    consumedAt: record.consumedAt ?? null,
  });
}

export function getSelfBuildIntakeRecord(db, id) {
  const record = db
    .prepare(`
    SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      kind,
      status,
      priority,
      goal,
      project_id AS projectId,
      domain_id AS domainId,
      template_id AS templateId,
      goal_plan_id AS goalPlanId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      consumed_at AS consumedAt
    FROM self_build_intake_records
    WHERE id = ?
  `)
    .get(id);
  return mapSelfBuildIntakeRecord(record);
}

export function findSelfBuildIntakeRecordBySource(db, sourceType, sourceId) {
  const record = db
    .prepare(`
    SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      kind,
      status,
      priority,
      goal,
      project_id AS projectId,
      domain_id AS domainId,
      template_id AS templateId,
      goal_plan_id AS goalPlanId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      consumed_at AS consumedAt
    FROM self_build_intake_records
    WHERE source_type = ? AND source_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(sourceType, sourceId);
  return mapSelfBuildIntakeRecord(record);
}

export function listSelfBuildIntakeRecords(
  db,
  options: SelfBuildIntakeListOptions = {},
) {
  const where = [];
  const params = [];
  if (options.status) {
    where.push("status = ?");
    params.push(String(options.status).trim());
  }
  if (options.sourceType) {
    where.push("source_type = ?");
    params.push(String(options.sourceType).trim());
  }
  if (options.kind) {
    where.push("kind = ?");
    params.push(String(options.kind).trim());
  }
  if (options.priority) {
    where.push("priority = ?");
    params.push(Number(options.priority) || 0);
  }
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const sql = `
    SELECT
      id,
      source_type AS sourceType,
      source_id AS sourceId,
      kind,
      status,
      priority,
      goal,
      project_id AS projectId,
      domain_id AS domainId,
      template_id AS templateId,
      goal_plan_id AS goalPlanId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      consumed_at AS consumedAt
    FROM self_build_intake_records
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY priority DESC, updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapSelfBuildIntakeRecord(record));
}

export function upsertSelfBuildIntakeRecord(db, record) {
  const existing = findSelfBuildIntakeRecordBySource(
    db,
    record.sourceType,
    record.sourceId,
  );
  if (existing) {
    updateSelfBuildIntakeRecord(db, {
      ...existing,
      ...record,
      id: existing.id,
    });
    return getSelfBuildIntakeRecord(db, existing.id);
  }
  insertSelfBuildIntakeRecord(db, record);
  return getSelfBuildIntakeRecord(db, record.id);
}

export function insertIntegrationBranch(db, branch) {
  db.prepare(`
    INSERT INTO integration_branches (
      name, project_id, status, target_branch, source_execution_id,
      proposal_artifact_ids_json, workspace_ids_json, metadata_json,
      created_at, updated_at, last_promotion_at
    ) VALUES (
      @name, @projectId, @status, @targetBranch, @sourceExecutionId,
      @proposalArtifactIdsJson, @workspaceIdsJson, @metadataJson,
      @createdAt, @updatedAt, @lastPromotionAt
    )
  `).run({
    name: branch.name,
    projectId: branch.projectId ?? null,
    status: branch.status,
    targetBranch: branch.targetBranch ?? null,
    sourceExecutionId: branch.sourceExecutionId ?? null,
    proposalArtifactIdsJson: JSON.stringify(branch.proposalArtifactIds ?? []),
    workspaceIdsJson: JSON.stringify(branch.workspaceIds ?? []),
    metadataJson: JSON.stringify(branch.metadata ?? {}),
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    lastPromotionAt: branch.lastPromotionAt ?? null,
  });
}

export function updateIntegrationBranch(db, branch) {
  db.prepare(`
    UPDATE integration_branches SET
      project_id = @projectId,
      status = @status,
      target_branch = @targetBranch,
      source_execution_id = @sourceExecutionId,
      proposal_artifact_ids_json = @proposalArtifactIdsJson,
      workspace_ids_json = @workspaceIdsJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      last_promotion_at = @lastPromotionAt
    WHERE name = @name
  `).run({
    name: branch.name,
    projectId: branch.projectId ?? null,
    status: branch.status,
    targetBranch: branch.targetBranch ?? null,
    sourceExecutionId: branch.sourceExecutionId ?? null,
    proposalArtifactIdsJson: JSON.stringify(branch.proposalArtifactIds ?? []),
    workspaceIdsJson: JSON.stringify(branch.workspaceIds ?? []),
    metadataJson: JSON.stringify(branch.metadata ?? {}),
    updatedAt: branch.updatedAt,
    lastPromotionAt: branch.lastPromotionAt ?? null,
  });
}

export function getIntegrationBranch(db, name) {
  const record = db
    .prepare(`
    SELECT
      name,
      project_id AS projectId,
      status,
      target_branch AS targetBranch,
      source_execution_id AS sourceExecutionId,
      proposal_artifact_ids_json AS proposalArtifactIdsJson,
      workspace_ids_json AS workspaceIdsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_promotion_at AS lastPromotionAt
    FROM integration_branches
    WHERE name = ?
  `)
    .get(name);
  return mapIntegrationBranch(record);
}

export function listIntegrationBranches(db, status = null, limit = 50) {
  const sql = `
    SELECT
      name,
      project_id AS projectId,
      status,
      target_branch AS targetBranch,
      source_execution_id AS sourceExecutionId,
      proposal_artifact_ids_json AS proposalArtifactIdsJson,
      workspace_ids_json AS workspaceIdsJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_promotion_at AS lastPromotionAt
    FROM integration_branches
    ${status ? "WHERE status = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = status ? statement.all(status, limit) : statement.all(limit);
  return rows.map((record) => mapIntegrationBranch(record));
}

export function upsertIntegrationBranch(db, branch) {
  const existing = getIntegrationBranch(db, branch.name);
  if (existing) {
    updateIntegrationBranch(db, { ...existing, ...branch });
    return getIntegrationBranch(db, branch.name);
  }
  insertIntegrationBranch(db, branch);
  return getIntegrationBranch(db, branch.name);
}

export function insertSelfBuildLoopState(db, loopState) {
  db.prepare(`
    INSERT INTO self_build_loop_state (
      id, status, mode, project_id, policy_json, metadata_json,
      created_at, updated_at, heartbeat_at, started_at, stopped_at
    ) VALUES (
      @id, @status, @mode, @projectId, @policyJson, @metadataJson,
      @createdAt, @updatedAt, @heartbeatAt, @startedAt, @stoppedAt
    )
  `).run({
    id: loopState.id,
    status: loopState.status,
    mode: loopState.mode ?? null,
    projectId: loopState.projectId ?? null,
    policyJson: JSON.stringify(loopState.policy ?? {}),
    metadataJson: JSON.stringify(loopState.metadata ?? {}),
    createdAt: loopState.createdAt,
    updatedAt: loopState.updatedAt,
    heartbeatAt: loopState.heartbeatAt ?? null,
    startedAt: loopState.startedAt ?? null,
    stoppedAt: loopState.stoppedAt ?? null,
  });
}

export function updateSelfBuildLoopState(db, loopState) {
  db.prepare(`
    UPDATE self_build_loop_state SET
      status = @status,
      mode = @mode,
      project_id = @projectId,
      policy_json = @policyJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      heartbeat_at = @heartbeatAt,
      started_at = @startedAt,
      stopped_at = @stoppedAt
    WHERE id = @id
  `).run({
    id: loopState.id,
    status: loopState.status,
    mode: loopState.mode ?? null,
    projectId: loopState.projectId ?? null,
    policyJson: JSON.stringify(loopState.policy ?? {}),
    metadataJson: JSON.stringify(loopState.metadata ?? {}),
    updatedAt: loopState.updatedAt,
    heartbeatAt: loopState.heartbeatAt ?? null,
    startedAt: loopState.startedAt ?? null,
    stoppedAt: loopState.stoppedAt ?? null,
  });
}

export function getSelfBuildLoopState(db, id = "default") {
  const record = db
    .prepare(`
    SELECT
      id,
      status,
      mode,
      project_id AS projectId,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      heartbeat_at AS heartbeatAt,
      started_at AS startedAt,
      stopped_at AS stoppedAt
    FROM self_build_loop_state
    WHERE id = ?
  `)
    .get(id);
  return mapSelfBuildLoopState(record);
}

export function listSelfBuildLoopStates(db, status = null, limit = 10) {
  const sql = `
    SELECT
      id,
      status,
      mode,
      project_id AS projectId,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      heartbeat_at AS heartbeatAt,
      started_at AS startedAt,
      stopped_at AS stoppedAt
    FROM self_build_loop_state
    ${status ? "WHERE status = ?" : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  const statement = db.prepare(sql);
  const rows = status ? statement.all(status, limit) : statement.all(limit);
  return rows.map((record) => mapSelfBuildLoopState(record));
}

export function upsertSelfBuildLoopState(db, loopState) {
  const existing = getSelfBuildLoopState(db, loopState.id);
  if (existing) {
    updateSelfBuildLoopState(db, { ...existing, ...loopState });
    return getSelfBuildLoopState(db, loopState.id);
  }
  insertSelfBuildLoopState(db, loopState);
  return getSelfBuildLoopState(db, loopState.id);
}

export function insertSelfBuildDecision(db, decision) {
  db.prepare(`
    INSERT INTO self_build_decisions (
      id, loop_id, mode, state, action, target_type, target_id, rationale,
      policy_json, metadata_json, created_at
    ) VALUES (
      @id, @loopId, @mode, @state, @action, @targetType, @targetId, @rationale,
      @policyJson, @metadataJson, @createdAt
    )
  `).run({
    id: decision.id,
    loopId: decision.loopId ?? null,
    mode: decision.mode ?? null,
    state: decision.state,
    action: decision.action,
    targetType: decision.targetType ?? null,
    targetId: decision.targetId ?? null,
    rationale: decision.rationale ?? null,
    policyJson: JSON.stringify(decision.policy ?? {}),
    metadataJson: JSON.stringify(decision.metadata ?? {}),
    createdAt: decision.createdAt,
  });
}

export function listSelfBuildDecisions(
  db,
  options: SelfBuildDecisionListOptions = {},
) {
  const status = options.state ? String(options.state).trim() : null;
  const targetType = options.targetType
    ? String(options.targetType).trim()
    : null;
  const targetId = options.targetId ? String(options.targetId).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("state = ?");
    params.push(status);
  }
  if (targetType) {
    where.push("target_type = ?");
    params.push(targetType);
  }
  if (targetId) {
    where.push("target_id = ?");
    params.push(targetId);
  }
  const sql = `
    SELECT
      id,
      loop_id AS loopId,
      mode,
      state,
      action,
      target_type AS targetType,
      target_id AS targetId,
      rationale,
      policy_json AS policyJson,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM self_build_decisions
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapSelfBuildDecision(record));
}

export function insertOperatorThread(db, thread) {
  db.prepare(`
    INSERT INTO operator_threads (
      id, title, project_id, status, summary_json, metadata_json,
      created_at, updated_at, latest_message_at
    ) VALUES (
      @id, @title, @projectId, @status, @summaryJson, @metadataJson,
      @createdAt, @updatedAt, @latestMessageAt
    )
  `).run({
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId ?? null,
    status: thread.status,
    summaryJson: JSON.stringify(thread.summary ?? {}),
    metadataJson: JSON.stringify(thread.metadata ?? {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    latestMessageAt: thread.latestMessageAt ?? null,
  });
}

export function updateOperatorThread(db, thread) {
  db.prepare(`
    UPDATE operator_threads SET
      title = @title,
      project_id = @projectId,
      status = @status,
      summary_json = @summaryJson,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      latest_message_at = @latestMessageAt
    WHERE id = @id
  `).run({
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId ?? null,
    status: thread.status,
    summaryJson: JSON.stringify(thread.summary ?? {}),
    metadataJson: JSON.stringify(thread.metadata ?? {}),
    updatedAt: thread.updatedAt,
    latestMessageAt: thread.latestMessageAt ?? null,
  });
}

export function getOperatorThread(db, threadId) {
  const record = db
    .prepare(`
      SELECT
        id,
        title,
        project_id AS projectId,
        status,
        summary_json AS summaryJson,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        latest_message_at AS latestMessageAt
      FROM operator_threads
      WHERE id = ?
    `)
    .get(threadId);
  return mapOperatorThread(record);
}

export function listOperatorThreads(
  db,
  options: OperatorThreadListOptions = {},
) {
  const status = options.status ? String(options.status).trim() : null;
  const projectId = options.projectId ? String(options.projectId).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (projectId) {
    where.push("project_id = ?");
    params.push(projectId);
  }
  const sql = `
    SELECT
      id,
      title,
      project_id AS projectId,
      status,
      summary_json AS summaryJson,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      latest_message_at AS latestMessageAt
    FROM operator_threads
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(latest_message_at, updated_at) DESC, updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapOperatorThread(record));
}

export function upsertOperatorThread(db, thread) {
  const existing = getOperatorThread(db, thread.id);
  if (existing) {
    updateOperatorThread(db, { ...existing, ...thread });
    return getOperatorThread(db, thread.id);
  }
  insertOperatorThread(db, thread);
  return getOperatorThread(db, thread.id);
}

export function insertOperatorThreadMessage(db, message) {
  db.prepare(`
    INSERT INTO operator_thread_messages (
      id, thread_id, role, kind, content, payload_json, created_at
    ) VALUES (
      @id, @threadId, @role, @kind, @content, @payloadJson, @createdAt
    )
  `).run({
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    kind: message.kind,
    content: message.content,
    payloadJson: JSON.stringify(message.payload ?? {}),
    createdAt: message.createdAt,
  });
}

export function listOperatorThreadMessages(db, threadId, limit = 200) {
  return db
    .prepare(`
      SELECT
        id,
        thread_id AS threadId,
        role,
        kind,
        content,
        payload_json AS payloadJson,
        created_at AS createdAt
      FROM operator_thread_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(threadId, limit)
    .map((record) => mapOperatorThreadMessage(record));
}

export function insertOperatorThreadAction(db, action) {
  db.prepare(`
    INSERT INTO operator_thread_actions (
      id, thread_id, status, action_kind, title, summary, target_type, target_id,
      payload_json, options_json, links_json, requested_by, requested_at, updated_at,
      resolved_at, resolution_json
    ) VALUES (
      @id, @threadId, @status, @actionKind, @title, @summary, @targetType, @targetId,
      @payloadJson, @optionsJson, @linksJson, @requestedBy, @requestedAt, @updatedAt,
      @resolvedAt, @resolutionJson
    )
  `).run({
    id: action.id,
    threadId: action.threadId,
    status: action.status,
    actionKind: action.actionKind,
    title: action.title,
    summary: action.summary ?? null,
    targetType: action.targetType ?? null,
    targetId: action.targetId ?? null,
    payloadJson: JSON.stringify(action.payload ?? {}),
    optionsJson: JSON.stringify(action.options ?? {}),
    linksJson: JSON.stringify(action.links ?? {}),
    requestedBy: action.requestedBy ?? null,
    requestedAt: action.requestedAt,
    updatedAt: action.updatedAt ?? action.requestedAt,
    resolvedAt: action.resolvedAt ?? null,
    resolutionJson: JSON.stringify(action.resolution ?? {}),
  });
}

export function updateOperatorThreadAction(db, action) {
  db.prepare(`
    UPDATE operator_thread_actions SET
      thread_id = @threadId,
      status = @status,
      action_kind = @actionKind,
      title = @title,
      summary = @summary,
      target_type = @targetType,
      target_id = @targetId,
      payload_json = @payloadJson,
      options_json = @optionsJson,
      links_json = @linksJson,
      requested_by = @requestedBy,
      requested_at = @requestedAt,
      updated_at = @updatedAt,
      resolved_at = @resolvedAt,
      resolution_json = @resolutionJson
    WHERE id = @id
  `).run({
    id: action.id,
    threadId: action.threadId,
    status: action.status,
    actionKind: action.actionKind,
    title: action.title,
    summary: action.summary ?? null,
    targetType: action.targetType ?? null,
    targetId: action.targetId ?? null,
    payloadJson: JSON.stringify(action.payload ?? {}),
    optionsJson: JSON.stringify(action.options ?? {}),
    linksJson: JSON.stringify(action.links ?? {}),
    requestedBy: action.requestedBy ?? null,
    requestedAt: action.requestedAt,
    updatedAt: action.updatedAt ?? action.requestedAt,
    resolvedAt: action.resolvedAt ?? null,
    resolutionJson: JSON.stringify(action.resolution ?? {}),
  });
}

export function getOperatorThreadAction(db, actionId) {
  const record = db
    .prepare(`
      SELECT
        id,
        thread_id AS threadId,
        status,
        action_kind AS actionKind,
        title,
        summary,
        target_type AS targetType,
        target_id AS targetId,
        payload_json AS payloadJson,
        options_json AS optionsJson,
        links_json AS linksJson,
        requested_by AS requestedBy,
        requested_at AS requestedAt,
        updated_at AS updatedAt,
        resolved_at AS resolvedAt,
        resolution_json AS resolutionJson
      FROM operator_thread_actions
      WHERE id = ?
    `)
    .get(actionId);
  return mapOperatorThreadAction(record);
}

export function findPendingOperatorThreadAction(
  db,
  threadId,
  actionKind = null,
  targetType = null,
  targetId = null,
) {
  const record = db
    .prepare(`
      SELECT
        id,
        thread_id AS threadId,
        status,
        action_kind AS actionKind,
        title,
        summary,
        target_type AS targetType,
        target_id AS targetId,
        payload_json AS payloadJson,
        options_json AS optionsJson,
        links_json AS linksJson,
        requested_by AS requestedBy,
        requested_at AS requestedAt,
        updated_at AS updatedAt,
        resolved_at AS resolvedAt,
        resolution_json AS resolutionJson
      FROM operator_thread_actions
      WHERE thread_id = ?
        AND status = 'pending'
        AND (? IS NULL OR action_kind = ?)
        AND (? IS NULL OR target_type = ?)
        AND (? IS NULL OR target_id = ?)
      ORDER BY requested_at DESC
      LIMIT 1
    `)
    .get(
      threadId,
      actionKind,
      actionKind,
      targetType,
      targetType,
      targetId,
      targetId,
    );
  return mapOperatorThreadAction(record);
}

export function listOperatorThreadActions(
  db,
  options: OperatorThreadActionListOptions = {},
) {
  const threadId = options.threadId ? String(options.threadId).trim() : null;
  const status = options.status ? String(options.status).trim() : null;
  const actionKind = options.actionKind
    ? String(options.actionKind).trim()
    : null;
  const targetType = options.targetType
    ? String(options.targetType).trim()
    : null;
  const targetId = options.targetId ? String(options.targetId).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "100"), 10) || 100;
  const where = [];
  const params = [];
  if (threadId) {
    where.push("thread_id = ?");
    params.push(threadId);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (actionKind) {
    where.push("action_kind = ?");
    params.push(actionKind);
  }
  if (targetType) {
    where.push("target_type = ?");
    params.push(targetType);
  }
  if (targetId) {
    where.push("target_id = ?");
    params.push(targetId);
  }
  const sql = `
    SELECT
      id,
      thread_id AS threadId,
      status,
      action_kind AS actionKind,
      title,
      summary,
      target_type AS targetType,
      target_id AS targetId,
      payload_json AS payloadJson,
      options_json AS optionsJson,
      links_json AS linksJson,
      requested_by AS requestedBy,
      requested_at AS requestedAt,
      updated_at AS updatedAt,
      resolved_at AS resolvedAt,
      resolution_json AS resolutionJson
    FROM operator_thread_actions
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY requested_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapOperatorThreadAction(record));
}

export function insertSelfBuildOverrideRecord(db, record) {
  db.prepare(`
    INSERT INTO self_build_override_records (
      id, target_type, target_id, kind, status, reason, requested_by, source,
      metadata_json, created_at, updated_at, released_at
    ) VALUES (
      @id, @targetType, @targetId, @kind, @status, @reason, @requestedBy, @source,
      @metadataJson, @createdAt, @updatedAt, @releasedAt
    )
  `).run({
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    kind: record.kind,
    status: record.status,
    reason: record.reason,
    requestedBy: record.requestedBy ?? null,
    source: record.source ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    releasedAt: record.releasedAt ?? null,
  });
}

export function updateSelfBuildOverrideRecord(db, record) {
  db.prepare(`
    UPDATE self_build_override_records SET
      target_type = @targetType,
      target_id = @targetId,
      kind = @kind,
      status = @status,
      reason = @reason,
      requested_by = @requestedBy,
      source = @source,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      released_at = @releasedAt
    WHERE id = @id
  `).run({
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    kind: record.kind,
    status: record.status,
    reason: record.reason,
    requestedBy: record.requestedBy ?? null,
    source: record.source ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
    releasedAt: record.releasedAt ?? null,
  });
}

export function getSelfBuildOverrideRecord(db, id) {
  const record = db
    .prepare(`
      SELECT
        id,
        target_type AS targetType,
        target_id AS targetId,
        kind,
        status,
        reason,
        requested_by AS requestedBy,
        source,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        released_at AS releasedAt
      FROM self_build_override_records
      WHERE id = ?
    `)
    .get(id);
  return mapSelfBuildOverrideRecord(record);
}

export function findActiveSelfBuildOverrideRecord(
  db,
  targetType,
  targetId,
  kind = null,
) {
  const record = db
    .prepare(`
      SELECT
        id,
        target_type AS targetType,
        target_id AS targetId,
        kind,
        status,
        reason,
        requested_by AS requestedBy,
        source,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        released_at AS releasedAt
      FROM self_build_override_records
      WHERE target_type = ?
        AND target_id = ?
        AND status = 'approved'
        AND (? IS NULL OR kind = ?)
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get(targetType, targetId, kind, kind);
  return mapSelfBuildOverrideRecord(record);
}

export function listSelfBuildOverrideRecords(
  db,
  options: SelfBuildOverrideListOptions = {},
) {
  const status = options.status ? String(options.status).trim() : null;
  const targetType = options.targetType
    ? String(options.targetType).trim()
    : null;
  const targetId = options.targetId ? String(options.targetId).trim() : null;
  const kind = options.kind ? String(options.kind).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (targetType) {
    where.push("target_type = ?");
    params.push(targetType);
  }
  if (targetId) {
    where.push("target_id = ?");
    params.push(targetId);
  }
  if (kind) {
    where.push("kind = ?");
    params.push(kind);
  }
  const sql = `
    SELECT
      id,
      target_type AS targetType,
      target_id AS targetId,
      kind,
      status,
      reason,
      requested_by AS requestedBy,
      source,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      released_at AS releasedAt
    FROM self_build_override_records
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapSelfBuildOverrideRecord(record));
}

export function insertPolicyRecommendationReview(db, record) {
  db.prepare(`
    INSERT INTO policy_recommendation_reviews (
      id, recommendation_id, status, reason, reviewed_by, source,
      materialized_intake_id, materialized_goal_plan_id,
      metadata_json, created_at, updated_at, reviewed_at, materialized_at
    ) VALUES (
      @id, @recommendationId, @status, @reason, @reviewedBy, @source,
      @materializedIntakeId, @materializedGoalPlanId,
      @metadataJson, @createdAt, @updatedAt, @reviewedAt, @materializedAt
    )
  `).run({
    id: record.id,
    recommendationId: record.recommendationId,
    status: record.status,
    reason: record.reason ?? null,
    reviewedBy: record.reviewedBy ?? null,
    source: record.source ?? null,
    materializedIntakeId: record.materializedIntakeId ?? null,
    materializedGoalPlanId: record.materializedGoalPlanId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt ?? null,
    materializedAt: record.materializedAt ?? null,
  });
}

export function updatePolicyRecommendationReview(db, record) {
  db.prepare(`
    UPDATE policy_recommendation_reviews SET
      recommendation_id = @recommendationId,
      status = @status,
      reason = @reason,
      reviewed_by = @reviewedBy,
      source = @source,
      materialized_intake_id = @materializedIntakeId,
      materialized_goal_plan_id = @materializedGoalPlanId,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      reviewed_at = @reviewedAt,
      materialized_at = @materializedAt
    WHERE id = @id
  `).run({
    id: record.id,
    recommendationId: record.recommendationId,
    status: record.status,
    reason: record.reason ?? null,
    reviewedBy: record.reviewedBy ?? null,
    source: record.source ?? null,
    materializedIntakeId: record.materializedIntakeId ?? null,
    materializedGoalPlanId: record.materializedGoalPlanId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt ?? null,
    materializedAt: record.materializedAt ?? null,
  });
}

export function getPolicyRecommendationReviewByRecommendationId(
  db,
  recommendationId,
) {
  const record = db
    .prepare(`
      SELECT
        id,
        recommendation_id AS recommendationId,
        status,
        reason,
        reviewed_by AS reviewedBy,
        source,
        materialized_intake_id AS materializedIntakeId,
        materialized_goal_plan_id AS materializedGoalPlanId,
        metadata_json AS metadataJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        reviewed_at AS reviewedAt,
        materialized_at AS materializedAt
      FROM policy_recommendation_reviews
      WHERE recommendation_id = ?
      LIMIT 1
    `)
    .get(recommendationId);
  return mapPolicyRecommendationReview(record);
}

export function listPolicyRecommendationReviews(
  db,
  options: PolicyRecommendationReviewListOptions = {},
) {
  const status = options.status ? String(options.status).trim() : null;
  const recommendationId = options.recommendationId
    ? String(options.recommendationId).trim()
    : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (recommendationId) {
    where.push("recommendation_id = ?");
    params.push(recommendationId);
  }
  const sql = `
    SELECT
      id,
      recommendation_id AS recommendationId,
      status,
      reason,
      reviewed_by AS reviewedBy,
      source,
      materialized_intake_id AS materializedIntakeId,
      materialized_goal_plan_id AS materializedGoalPlanId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      reviewed_at AS reviewedAt,
      materialized_at AS materializedAt
    FROM policy_recommendation_reviews
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapPolicyRecommendationReview(record));
}

export function upsertPolicyRecommendationReview(db, record) {
  const existing = getPolicyRecommendationReviewByRecommendationId(
    db,
    record.recommendationId,
  );
  if (existing) {
    updatePolicyRecommendationReview(db, {
      ...existing,
      ...record,
      id: existing.id,
      recommendationId: existing.recommendationId,
      createdAt: existing.createdAt,
    });
    return getPolicyRecommendationReviewByRecommendationId(
      db,
      record.recommendationId,
    );
  }
  insertPolicyRecommendationReview(db, record);
  return getPolicyRecommendationReviewByRecommendationId(
    db,
    record.recommendationId,
  );
}

export function insertQuarantineRecord(db, record) {
  db.prepare(`
    INSERT INTO quarantine_records (
      id, target_type, target_id, status, reason, source_type, source_id,
      metadata_json, created_at, updated_at, released_at
    ) VALUES (
      @id, @targetType, @targetId, @status, @reason, @sourceType, @sourceId,
      @metadataJson, @createdAt, @updatedAt, @releasedAt
    )
  `).run({
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    status: record.status,
    reason: record.reason,
    sourceType: record.sourceType ?? null,
    sourceId: record.sourceId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    releasedAt: record.releasedAt ?? null,
  });
}

export function updateQuarantineRecord(db, record) {
  db.prepare(`
    UPDATE quarantine_records SET
      target_type = @targetType,
      target_id = @targetId,
      status = @status,
      reason = @reason,
      source_type = @sourceType,
      source_id = @sourceId,
      metadata_json = @metadataJson,
      updated_at = @updatedAt,
      released_at = @releasedAt
    WHERE id = @id
  `).run({
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    status: record.status,
    reason: record.reason,
    sourceType: record.sourceType ?? null,
    sourceId: record.sourceId ?? null,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    updatedAt: record.updatedAt,
    releasedAt: record.releasedAt ?? null,
  });
}

export function getQuarantineRecord(db, id) {
  const record = db
    .prepare(`
    SELECT
      id,
      target_type AS targetType,
      target_id AS targetId,
      status,
      reason,
      source_type AS sourceType,
      source_id AS sourceId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      released_at AS releasedAt
    FROM quarantine_records
    WHERE id = ?
  `)
    .get(id);
  return mapQuarantineRecord(record);
}

export function findActiveQuarantineRecord(db, targetType, targetId) {
  const record = db
    .prepare(`
    SELECT
      id,
      target_type AS targetType,
      target_id AS targetId,
      status,
      reason,
      source_type AS sourceType,
      source_id AS sourceId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      released_at AS releasedAt
    FROM quarantine_records
    WHERE target_type = ? AND target_id = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(targetType, targetId);
  return mapQuarantineRecord(record);
}

export function listQuarantineRecords(
  db,
  options: QuarantineRecordListOptions = {},
) {
  const status = options.status ? String(options.status).trim() : null;
  const targetType = options.targetType
    ? String(options.targetType).trim()
    : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (targetType) {
    where.push("target_type = ?");
    params.push(targetType);
  }
  const sql = `
    SELECT
      id,
      target_type AS targetType,
      target_id AS targetId,
      status,
      reason,
      source_type AS sourceType,
      source_id AS sourceId,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      released_at AS releasedAt
    FROM quarantine_records
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapQuarantineRecord(record));
}

export function upsertQuarantineRecord(db, record) {
  const existing = record.id ? getQuarantineRecord(db, record.id) : null;
  if (existing) {
    updateQuarantineRecord(db, { ...existing, ...record });
    return getQuarantineRecord(db, record.id);
  }
  insertQuarantineRecord(db, record);
  return getQuarantineRecord(db, record.id);
}

export function insertRollbackRecord(db, record) {
  db.prepare(`
    INSERT INTO rollback_records (
      id, target_type, target_id, status, reason, metadata_json, created_at, updated_at
    ) VALUES (
      @id, @targetType, @targetId, @status, @reason, @metadataJson, @createdAt, @updatedAt
    )
  `).run({
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    status: record.status,
    reason: record.reason,
    metadataJson: JSON.stringify(record.metadata ?? {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function listRollbackRecords(
  db,
  options: RollbackRecordListOptions = {},
) {
  const status = options.status ? String(options.status).trim() : null;
  const targetType = options.targetType
    ? String(options.targetType).trim()
    : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (targetType) {
    where.push("target_type = ?");
    params.push(targetType);
  }
  const sql = `
    SELECT
      id,
      target_type AS targetType,
      target_id AS targetId,
      status,
      reason,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM rollback_records
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(...params, limit)
    .map((record) => mapRollbackRecord(record));
}
