import fs from "node:fs/promises";
import path from "node:path";

import { parseYaml } from "@spore/config-schema";
import { PROJECT_ROOT } from "../metadata/constants.js";

const DEFAULT_MARKER = "SPORE_HANDOFF_JSON";

function normalizeRequiredSections(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

const profileHandoffPolicyCache = new Map<string, Record<string, unknown>>();

export async function readProfileHandoffPolicy(profilePath: string | null | undefined) {
  if (!profilePath) {
    return {};
  }
  const resolved = path.isAbsolute(profilePath)
    ? profilePath
    : path.join(PROJECT_ROOT, profilePath);
  if (profileHandoffPolicyCache.has(resolved)) {
    return profileHandoffPolicyCache.get(resolved) ?? {};
  }
  const raw = await fs.readFile(resolved, "utf8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  const handoffPolicy =
    parsed && typeof parsed.handoffPolicy === "object" && parsed.handoffPolicy
      ? (parsed.handoffPolicy as Record<string, unknown>)
      : {};
  profileHandoffPolicyCache.set(resolved, handoffPolicy);
  return handoffPolicy;
}

export async function buildExpectedHandoff(step: Record<string, unknown>) {
  const handoffPolicy = await readProfileHandoffPolicy(
    String(step.profilePath ?? "") || null,
  );
  const kind = String(handoffPolicy.outputKind ?? "").trim();
  if (!kind) {
    return null;
  }
  return {
    kind,
    marker: String(handoffPolicy.marker ?? DEFAULT_MARKER).trim() || DEFAULT_MARKER,
    requiredSections: normalizeRequiredSections(handoffPolicy.requiredSections),
    enforcementMode: String(handoffPolicy.enforcementMode ?? "accept").trim() || "accept",
    targetRole: String(handoffPolicy.targetRole ?? "").trim() || null,
    mustReportUpward: handoffPolicy.mustReportUpward === true,
    allowedNextRoles: [],
  };
}

export function selectInboundWorkflowHandoffs({
  execution,
  step,
  steps,
  handoffs,
}: {
  execution: Record<string, unknown>;
  step: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
}) {
  const currentWave = Number(step.wave ?? step.sequence ?? 0);
  const currentRole = String(step.role ?? "");
  const stepsById = new Map(steps.map((record) => [String(record.id), record]));
  const selected = new Map<string, Record<string, unknown>>();

  for (const handoff of handoffs) {
    if (String(handoff.executionId ?? "") !== String(execution.id ?? "")) {
      continue;
    }
    const sourceStep = stepsById.get(String(handoff.fromStepId ?? ""));
    if (!sourceStep) {
      continue;
    }
    const sourceWave = Number(sourceStep.wave ?? sourceStep.sequence ?? 0);
    if (!(sourceWave < currentWave)) {
      continue;
    }
    const targetRole = String(handoff.targetRole ?? "").trim();
    if (targetRole && targetRole !== currentRole) {
      continue;
    }
    const toStepId = String(handoff.toStepId ?? "").trim();
    if (toStepId && toStepId !== String(step.id ?? "")) {
      continue;
    }
    const kind = String(handoff.kind ?? "");
    if (!kind) {
      continue;
    }
    if (!selected.has(kind)) {
      selected.set(kind, handoff);
    }
  }

  return [...selected.values()].map((handoff) => ({
    id: String(handoff.id ?? ""),
    kind: String(handoff.kind ?? ""),
    sourceRole: String(handoff.sourceRole ?? ""),
    targetRole: handoff.targetRole ? String(handoff.targetRole) : null,
    summary:
      handoff.summary && typeof handoff.summary === "object"
        ? (handoff.summary as Record<string, unknown>)
        : {},
    artifacts:
      handoff.artifacts && typeof handoff.artifacts === "object"
        ? (handoff.artifacts as Record<string, unknown>)
        : {},
  }));
}

export function handoffsConsumedByStep(step: Record<string, unknown>, handoffs: Array<Record<string, unknown>>) {
  return handoffs.filter(Boolean);
}
