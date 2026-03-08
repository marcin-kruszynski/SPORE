import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export function openSessionDatabase(dbPath) {
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
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
  `);
  ensureColumns(db, [
    ["launcher_type", "TEXT"],
    ["launch_command", "TEXT"],
    ["tmux_session", "TEXT"]
  ]);
  return db;
}

function ensureColumns(db, definitions) {
  const rows = db.prepare("PRAGMA table_info(sessions)").all();
  const existing = new Set(rows.map((row) => row.name));
  for (const [name, type] of definitions) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }
  }
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

export function upsertSession(db, sessionRecord) {
  const statement = db.prepare(`
    INSERT INTO sessions (
      id,
      run_id,
      agent_identity_id,
      profile_id,
      role,
      state,
      runtime_adapter,
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
      started_at,
      ended_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @runId,
      @agentIdentityId,
      @profileId,
      @role,
      @state,
      @runtimeAdapter,
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
      @startedAt,
      @endedAt,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      run_id = excluded.run_id,
      agent_identity_id = excluded.agent_identity_id,
      profile_id = excluded.profile_id,
      role = excluded.role,
      state = excluded.state,
      runtime_adapter = excluded.runtime_adapter,
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
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      updated_at = excluded.updated_at
  `);

  runTransaction(db, () => {
    statement.run(sessionRecord);
  });
}

export function getSession(db, sessionId) {
  return (
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
          started_at AS startedAt,
          ended_at AS endedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM sessions
        WHERE id = ?
      `)
      .get(sessionId) ?? null
  );
}

export function listSessions(db) {
  return db
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
    .all();
}
