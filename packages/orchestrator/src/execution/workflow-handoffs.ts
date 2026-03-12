import { PROJECT_ROOT } from "../metadata/constants.js";
import { getWorkspaceAllocationByStepId, upsertWorkflowHandoff } from "../store/execution-store.js";
import {
  extractAgentOutputSegment,
  extractStructuredHandoffBlock,
  fallbackHandoffSummary,
  readSessionTranscript,
  writeSessionHandoffArtifact,
} from "./handoff-extraction.js";
import { buildExpectedHandoff } from "./handoff-context.js";

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildHandoffId(stepId: string, kind: string) {
  return `handoff-${sanitizeSegment(stepId)}-${sanitizeSegment(kind)}`;
}

function briefArtifactPath(executionId: string, sessionId: string) {
  return `tmp/orchestrator/${executionId}/${sessionId}.brief.md`;
}

function nextWaveTargets(steps: Array<Record<string, unknown>>, step: Record<string, unknown>) {
  const currentWave = Number(step.wave ?? step.sequence ?? 0);
  const laterSteps = steps.filter(
    (candidate) => Number(candidate.wave ?? candidate.sequence ?? 0) > currentWave,
  );
  if (laterSteps.length === 0) {
    return { toStepId: "", targetRole: null };
  }
  const nearestWave = Math.min(
    ...laterSteps.map((candidate) => Number(candidate.wave ?? candidate.sequence ?? 0)),
  );
  const targets = laterSteps.filter(
    (candidate) => Number(candidate.wave ?? candidate.sequence ?? 0) === nearestWave,
  );
  const uniqueRoles = [...new Set(targets.map((candidate) => String(candidate.role ?? "")))].filter(Boolean);
  const targetRole = uniqueRoles.length === 1 ? uniqueRoles[0] : null;
  const toStepId = targets.length === 1 ? String(targets[0]?.id ?? "") : "";
  return { toStepId, targetRole };
}

export async function publishWorkflowStepHandoffs({
  db,
  execution,
  step,
  session,
  steps,
}: {
  db: unknown;
  execution: Record<string, unknown>;
  step: Record<string, unknown>;
  session: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
}) {
  if (!step.sessionId || !session) {
    return [];
  }

  const expectedHandoff = await buildExpectedHandoff(step);
  if (!expectedHandoff) {
    return [];
  }

  const transcript = await readSessionTranscript(String(session.transcriptPath ?? "") || null);
  const output = extractAgentOutputSegment(transcript);
  const parsedBlock = extractStructuredHandoffBlock(output, expectedHandoff.marker);
  const parsedObject = normalizeObject(parsedBlock);
  const summary = {
    ...fallbackHandoffSummary(output, String(step.role ?? "role")),
    ...normalizeObject(parsedObject.summary),
  };
  const payload = Object.keys(parsedObject).length > 0
    ? parsedObject
    : {
        summary,
        content: output.trim() || null,
      };
  const { toStepId, targetRole } = nextWaveTargets(steps, step);
  const primaryHandoff = {
    id: buildHandoffId(String(step.id), expectedHandoff.kind),
    executionId: String(execution.id),
    fromStepId: String(step.id),
    toStepId,
        sourceRole: String(step.role),
        targetRole,
        kind: expectedHandoff.kind,
        status: "ready",
        summary,
        artifacts: {
          sessionId: String(step.sessionId),
          transcriptPath: String(session.transcriptPath ?? "") || null,
          briefPath: briefArtifactPath(String(execution.id), String(step.sessionId)),
          handoffPath: null,
          workspaceId: null,
          proposalArtifactId: null,
          snapshotRef: null,
      snapshotCommit: null,
    },
    payload,
    createdAt: String(step.settledAt ?? step.updatedAt ?? execution.updatedAt),
    updatedAt: String(step.settledAt ?? step.updatedAt ?? execution.updatedAt),
    consumedAt: null,
  };

  const auxiliary = [] as Array<Record<string, unknown>>;
  if (String(step.role ?? "") === "builder") {
    const allocation = getWorkspaceAllocationByStepId(db, String(step.id));
    const handoffMetadata = normalizeObject(allocation?.metadata?.handoff);
    if (handoffMetadata.snapshotRef || handoffMetadata.snapshotCommit) {
      auxiliary.push({
        id: buildHandoffId(String(step.id), "workspace_snapshot"),
        executionId: String(execution.id),
        fromStepId: String(step.id),
        toStepId,
        sourceRole: String(step.role),
        targetRole,
        kind: "workspace_snapshot",
        status: "ready",
        summary: {
          title: "Builder workspace snapshot",
          objective: execution.objective ?? null,
          outcome: "snapshot-published",
          confidence: "high",
        },
        artifacts: {
          sessionId: String(step.sessionId),
          transcriptPath: String(session.transcriptPath ?? "") || null,
          briefPath: briefArtifactPath(String(execution.id), String(step.sessionId)),
          handoffPath: null,
          workspaceId: allocation?.id ?? null,
          proposalArtifactId: allocation?.proposalArtifactId ?? null,
          snapshotRef: handoffMetadata.snapshotRef ?? null,
          snapshotCommit: handoffMetadata.snapshotCommit ?? null,
        },
        payload: {
          workspacePurpose: allocation?.metadata?.workspacePurpose ?? null,
        },
        createdAt: String(step.settledAt ?? step.updatedAt ?? execution.updatedAt),
        updatedAt: String(step.settledAt ?? step.updatedAt ?? execution.updatedAt),
        consumedAt: null,
      });
    }
  }

  const artifact = {
    sessionId: String(step.sessionId),
    executionId: String(execution.id),
    stepId: String(step.id),
    role: String(step.role),
    primary: primaryHandoff,
    auxiliary,
  };
  const writtenArtifact = await writeSessionHandoffArtifact(String(step.sessionId), artifact);
  const allHandoffs = [primaryHandoff, ...auxiliary].map((handoff) => ({
    ...handoff,
    artifacts: {
      ...normalizeObject(handoff.artifacts),
      handoffPath: writtenArtifact.relativePath,
    },
  }));

  for (const handoff of allHandoffs) {
    upsertWorkflowHandoff(db, handoff);
  }
  return allHandoffs;
}
