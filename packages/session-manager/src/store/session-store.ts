import fs from "node:fs/promises";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";

import type {
  SessionArtifactRecoveryTelemetry,
  SessionControlRequestInput,
  SessionControlRequestRecord,
  SessionRecord,
  SessionSummary,
} from "../types.js";

interface SessionColumnRow {
  name: string;
}

interface SessionRecordRow {
  id: string;
  runId: string;
  agentIdentityId: string;
  profileId: string;
  role: string;
  state: SessionRecord["state"];
  runtimeAdapter: string;
  backendKind: string | null;
  transportMode: string | null;
  sessionMode: string | null;
  projectId: string | null;
  projectName: string | null;
  projectType: string | null;
  domainId: string | null;
  workflowId: string | null;
  parentSessionId: string | null;
  contextPath: string | null;
  transcriptPath: string | null;
  launcherType: string | null;
  launchCommand: string | null;
  tmuxSession: string | null;
  runtimeInstanceId: string | null;
  runtimeCapabilitiesJson: string | null;
  runtimeStatusPath: string | null;
  runtimeEventsPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  artifactRecoveryJson: string | null;
}

interface SessionSummaryRow {
  id: string;
  runId: string;
  profileId: string;
  role: string;
  state: SessionSummary["state"];
  projectId: string | null;
  domainId: string | null;
  workflowId: string | null;
  parentSessionId: string | null;
  tmuxSession: string | null;
  updatedAt: string;
}

interface SessionControlRequestRow {
  id: string;
  sessionId: string;
  action: string;
  idempotencyKey: string | null;
  requestPayloadJson: string | null;
  ackStatus: string;
  status: string;
  resultJson: string | null;
  acceptedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function asSqlParameters(
  value: Record<string, unknown>,
): Record<string, SQLInputValue> {
  return value as unknown as Record<string, SQLInputValue>;
}

function asRow<T>(value: unknown): T {
  return value as unknown as T;
}

function asRows<T>(value: unknown): T[] {
  return value as unknown as T[];
}

function toSessionRecord(row: SessionRecordRow): SessionRecord {
  return {
    id: row.id,
    runId: row.runId,
    agentIdentityId: row.agentIdentityId,
    profileId: row.profileId,
    role: row.role,
    state: row.state,
    runtimeAdapter: row.runtimeAdapter,
    backendKind: row.backendKind,
    transportMode: row.transportMode,
    sessionMode: row.sessionMode,
    projectId: row.projectId,
    projectName: row.projectName,
    projectType: row.projectType,
    domainId: row.domainId,
    workflowId: row.workflowId,
    parentSessionId: row.parentSessionId,
    contextPath: row.contextPath,
    transcriptPath: row.transcriptPath,
    launcherType: row.launcherType,
    launchCommand: row.launchCommand,
    tmuxSession: row.tmuxSession,
    runtimeInstanceId: row.runtimeInstanceId,
    runtimeCapabilities: parseJsonField<Record<string, boolean> | null>(
      row.runtimeCapabilitiesJson,
      null,
    ),
    runtimeStatusPath: row.runtimeStatusPath,
    runtimeEventsPath: row.runtimeEventsPath,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    artifactRecovery: parseArtifactRecoveryJson(row.artifactRecoveryJson),
  };
}

function parseArtifactRecoveryJson(
  raw: string | null,
): SessionArtifactRecoveryTelemetry | null {
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as SessionArtifactRecoveryTelemetry;
}

function toSessionSummary(row: SessionSummaryRow): SessionSummary {
  return {
    id: row.id,
    runId: row.runId,
    profileId: row.profileId,
    role: row.role,
    state: row.state,
    projectId: row.projectId,
    domainId: row.domainId,
    workflowId: row.workflowId,
    parentSessionId: row.parentSessionId,
    tmuxSession: row.tmuxSession,
    updatedAt: row.updatedAt,
  };
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export function openSessionDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_identity_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      role TEXT NOT NULL,
      state TEXT NOT NULL,
      runtime_adapter TEXT NOT NULL,
      backend_kind TEXT,
      transport_mode TEXT,
      session_mode TEXT,
      project_id TEXT,
      project_name TEXT,
      project_type TEXT,
      domain_id TEXT,
      workflow_id TEXT,
      parent_session_id TEXT,
      context_path TEXT,
      transcript_path TEXT,
      launcher_type TEXT,
      launch_command TEXT,
      tmux_session TEXT,
      runtime_instance_id TEXT,
      runtime_capabilities_json TEXT,
      runtime_status_path TEXT,
      runtime_events_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      artifact_recovery_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
    CREATE TABLE IF NOT EXISTS session_control_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      action TEXT NOT NULL,
      idempotency_key TEXT,
      request_payload_json TEXT,
      ack_status TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      accepted_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_control_requests_session_id
      ON session_control_requests(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_control_requests_idempotency
      ON session_control_requests(session_id, action, idempotency_key);
  `);
  ensureColumns(db, [
    ["launcher_type", "TEXT"],
    ["launch_command", "TEXT"],
    ["tmux_session", "TEXT"],
    ["backend_kind", "TEXT"],
    ["runtime_instance_id", "TEXT"],
    ["runtime_capabilities_json", "TEXT"],
    ["runtime_status_path", "TEXT"],
    ["runtime_events_path", "TEXT"],
    ["artifact_recovery_json", "TEXT"],
  ]);
  return db;
}

function ensureColumns(
  db: DatabaseSync,
  definitions: Array<[string, string]>,
): void {
  const rows = asRows<SessionColumnRow>(
    db.prepare("PRAGMA table_info(sessions)").all(),
  );
  const existing = new Set(rows.map((row) => row.name));
  for (const [name, type] of definitions) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }
  }
}

function runTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function upsertSessionInTransaction(
  db: DatabaseSync,
  sessionRecord: SessionRecord,
): void {
  const statement = db.prepare(`
    INSERT INTO sessions (
      id,
      run_id,
      agent_identity_id,
      profile_id,
      role,
      state,
      runtime_adapter,
      backend_kind,
      transport_mode,
      session_mode,
      project_id,
      project_name,
      project_type,
      domain_id,
      workflow_id,
      parent_session_id,
      context_path,
      transcript_path,
      launcher_type,
      launch_command,
      tmux_session,
      runtime_instance_id,
      runtime_capabilities_json,
      runtime_status_path,
      runtime_events_path,
      started_at,
       ended_at,
       created_at,
       updated_at,
       artifact_recovery_json
     ) VALUES (
      @id,
      @runId,
      @agentIdentityId,
      @profileId,
      @role,
      @state,
      @runtimeAdapter,
      @backendKind,
      @transportMode,
      @sessionMode,
      @projectId,
      @projectName,
      @projectType,
      @domainId,
      @workflowId,
      @parentSessionId,
      @contextPath,
      @transcriptPath,
      @launcherType,
      @launchCommand,
      @tmuxSession,
      @runtimeInstanceId,
      @runtimeCapabilitiesJson,
      @runtimeStatusPath,
      @runtimeEventsPath,
      @startedAt,
       @endedAt,
       @createdAt,
       @updatedAt,
       @artifactRecoveryJson
     )
    ON CONFLICT(id) DO UPDATE SET
      run_id = excluded.run_id,
      agent_identity_id = excluded.agent_identity_id,
      profile_id = excluded.profile_id,
      role = excluded.role,
      state = excluded.state,
      runtime_adapter = excluded.runtime_adapter,
      backend_kind = excluded.backend_kind,
      transport_mode = excluded.transport_mode,
      session_mode = excluded.session_mode,
      project_id = excluded.project_id,
      project_name = excluded.project_name,
      project_type = excluded.project_type,
      domain_id = excluded.domain_id,
      workflow_id = excluded.workflow_id,
      parent_session_id = excluded.parent_session_id,
      context_path = excluded.context_path,
      transcript_path = excluded.transcript_path,
      launcher_type = excluded.launcher_type,
      launch_command = excluded.launch_command,
      tmux_session = excluded.tmux_session,
      runtime_instance_id = excluded.runtime_instance_id,
      runtime_capabilities_json = excluded.runtime_capabilities_json,
      runtime_status_path = excluded.runtime_status_path,
      runtime_events_path = excluded.runtime_events_path,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      updated_at = excluded.updated_at,
      artifact_recovery_json = excluded.artifact_recovery_json
   `);

  const {
    artifactRecovery: _artifactRecovery,
    runtimeCapabilities: _runtimeCapabilities,
    ...sessionParameters
  } = sessionRecord;
  statement.run(
    asSqlParameters({
      ...(sessionParameters as unknown as Record<string, unknown>),
      runtimeCapabilitiesJson: sessionRecord.runtimeCapabilities
        ? JSON.stringify(sessionRecord.runtimeCapabilities)
        : null,
      artifactRecoveryJson: sessionRecord.artifactRecovery
        ? JSON.stringify(sessionRecord.artifactRecovery)
        : null,
    }),
  );
}

export function upsertSession(
  db: DatabaseSync,
  sessionRecord: SessionRecord,
): void {
  runTransaction(db, () => {
    upsertSessionInTransaction(db, sessionRecord);
  });
}

export function getSession(
  db: DatabaseSync,
  sessionId: string,
): SessionRecord | null {
  const row = asRow<SessionRecordRow | undefined>(
    db
      .prepare(`
        SELECT
          id,
          run_id AS runId,
          agent_identity_id AS agentIdentityId,
          profile_id AS profileId,
          role,
          state,
          runtime_adapter AS runtimeAdapter,
          backend_kind AS backendKind,
          transport_mode AS transportMode,
          session_mode AS sessionMode,
          project_id AS projectId,
          project_name AS projectName,
          project_type AS projectType,
          domain_id AS domainId,
          workflow_id AS workflowId,
          parent_session_id AS parentSessionId,
          context_path AS contextPath,
          transcript_path AS transcriptPath,
          launcher_type AS launcherType,
          launch_command AS launchCommand,
          tmux_session AS tmuxSession,
          runtime_instance_id AS runtimeInstanceId,
          runtime_capabilities_json AS runtimeCapabilitiesJson,
          runtime_status_path AS runtimeStatusPath,
          runtime_events_path AS runtimeEventsPath,
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          artifact_recovery_json AS artifactRecoveryJson
        FROM sessions
        WHERE id = ?
      `)
      .get(sessionId),
  );
  if (!row) {
    return null;
  }
  return toSessionRecord(row);
}

export function listSessions(db: DatabaseSync): SessionSummary[] {
  return asRows<SessionSummaryRow>(
    db
      .prepare(`
      SELECT
        id,
        run_id AS runId,
        profile_id AS profileId,
        role,
        state,
        project_id AS projectId,
        domain_id AS domainId,
        workflow_id AS workflowId,
        parent_session_id AS parentSessionId,
        tmux_session AS tmuxSession,
        updated_at AS updatedAt
      FROM sessions
      ORDER BY updated_at DESC
    `)
      .all(),
  ).map(toSessionSummary);
}

function parseJsonField<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function insertSessionControlRequest(
  db: DatabaseSync,
  request: SessionControlRequestInput,
): void {
  db.prepare(`
    INSERT INTO session_control_requests (
      id,
      session_id,
      action,
      idempotency_key,
      request_payload_json,
      ack_status,
      status,
      result_json,
      accepted_at,
      completed_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @sessionId,
      @action,
      @idempotencyKey,
      @requestPayloadJson,
      @ackStatus,
      @status,
      @resultJson,
      @acceptedAt,
      @completedAt,
      @createdAt,
      @updatedAt
    )
  `).run(
    asSqlParameters({
      id: request.id,
      sessionId: request.sessionId,
      action: request.action,
      idempotencyKey: request.idempotencyKey ?? null,
      requestPayloadJson: JSON.stringify(request.requestPayload ?? {}),
      ackStatus: request.ackStatus,
      status: request.status,
      resultJson: JSON.stringify(request.result ?? {}),
      acceptedAt: request.acceptedAt,
      completedAt: request.completedAt ?? null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }),
  );
}

export function updateSessionControlRequest(
  db: DatabaseSync,
  request: SessionControlRequestInput,
): void {
  db.prepare(`
    UPDATE session_control_requests SET
      session_id = @sessionId,
      action = @action,
      idempotency_key = @idempotencyKey,
      request_payload_json = @requestPayloadJson,
      ack_status = @ackStatus,
      status = @status,
      result_json = @resultJson,
      accepted_at = @acceptedAt,
      completed_at = @completedAt,
      updated_at = @updatedAt
    WHERE id = @id
  `).run(
    asSqlParameters({
      id: request.id,
      sessionId: request.sessionId,
      action: request.action,
      idempotencyKey: request.idempotencyKey ?? null,
      requestPayloadJson: JSON.stringify(request.requestPayload ?? {}),
      ackStatus: request.ackStatus,
      status: request.status,
      resultJson: JSON.stringify(request.result ?? {}),
      acceptedAt: request.acceptedAt,
      completedAt: request.completedAt ?? null,
      updatedAt: request.updatedAt,
    }),
  );
}

function toSessionControlRequestRecord(
  row: SessionControlRequestRow,
): SessionControlRequestRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    action: row.action,
    idempotencyKey: row.idempotencyKey,
    requestPayload: parseJsonField<Record<string, unknown>>(
      row.requestPayloadJson,
      {},
    ),
    ackStatus: row.ackStatus,
    status: row.status,
    result: parseJsonField<Record<string, unknown>>(row.resultJson, {}),
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getSessionControlRequest(
  db: DatabaseSync,
  requestId: string,
): SessionControlRequestRecord | null {
  const row = asRow<SessionControlRequestRow | undefined>(
    db
      .prepare(`
    SELECT
      id,
      session_id AS sessionId,
      action,
      idempotency_key AS idempotencyKey,
      request_payload_json AS requestPayloadJson,
      ack_status AS ackStatus,
      status,
      result_json AS resultJson,
      accepted_at AS acceptedAt,
      completed_at AS completedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM session_control_requests
    WHERE id = ?
  `)
      .get(requestId),
  );
  if (!row) {
    return null;
  }
  return toSessionControlRequestRecord(row);
}

export function findSessionControlRequestByIdempotency(
  db: DatabaseSync,
  sessionId: string,
  action: string,
  idempotencyKey: string | null | undefined,
): SessionControlRequestRecord | null {
  if (!idempotencyKey) {
    return null;
  }
  const row = asRow<SessionControlRequestRow | undefined>(
    db
      .prepare(`
    SELECT
      id,
      session_id AS sessionId,
      action,
      idempotency_key AS idempotencyKey,
      request_payload_json AS requestPayloadJson,
      ack_status AS ackStatus,
      status,
      result_json AS resultJson,
      accepted_at AS acceptedAt,
      completed_at AS completedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM session_control_requests
    WHERE session_id = ? AND action = ? AND idempotency_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `)
      .get(sessionId, action, idempotencyKey),
  );
  if (!row) {
    return null;
  }
  return toSessionControlRequestRecord(row);
}

export function listSessionControlRequests(
  db: DatabaseSync,
  sessionId: string,
  limit = 50,
): SessionControlRequestRecord[] {
  return asRows<SessionControlRequestRow>(
    db
      .prepare(`
    SELECT
      id,
      session_id AS sessionId,
      action,
      idempotency_key AS idempotencyKey,
      request_payload_json AS requestPayloadJson,
      ack_status AS ackStatus,
      status,
      result_json AS resultJson,
      accepted_at AS acceptedAt,
      completed_at AS completedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM session_control_requests
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `)
      .all(sessionId, limit),
  ).map(toSessionControlRequestRecord);
}
