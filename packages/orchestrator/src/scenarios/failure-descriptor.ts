import type { FailureDescriptor, SuggestedAction } from "../types/contracts.js";

export interface FailureDescriptorInput {
  code?: string | null;
  reason?: unknown;
  source?: string | null;
  finalState?: string | null;
}

export function toErrorMessage(value: unknown): string {
  return String(value ?? "").trim();
}

export function humanizeClassification(
  code: string | null | undefined,
): string {
  return String(code ?? "unknown")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isInfrastructureFailure(
  code: string | null | undefined,
): boolean {
  return [
    "runtime_setup_failure",
    "launcher_failure",
    "gateway_control_failure",
    "artifact_integrity_failure",
  ].includes(String(code ?? ""));
}

export function isRecoverableFailure(code: string | null | undefined): boolean {
  return [
    "timeout_or_stall",
    "gateway_control_failure",
    "artifact_integrity_failure",
    "governance_failure",
  ].includes(String(code ?? ""));
}

export function classificationSeverity(
  code: string | null | undefined,
): string {
  if (code === "success") {
    return "info";
  }
  if (code === "runtime_setup_failure" || code === "launcher_failure") {
    return "critical";
  }
  if (code === "gateway_control_failure" || code === "timeout_or_stall") {
    return "high";
  }
  if (code === "governance_failure") {
    return "medium";
  }
  return "medium";
}

export function classifyFailureFromMessage(message: unknown): string | null {
  const normalized = toErrorMessage(message).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("auth") ||
    normalized.includes("provider") ||
    normalized.includes("api key")
  ) {
    return "runtime_setup_failure";
  }
  if (
    normalized.includes("pi") ||
    normalized.includes("launcher") ||
    normalized.includes("rpc")
  ) {
    return "launcher_failure";
  }
  if (normalized.includes("gateway") || normalized.includes("control")) {
    return "gateway_control_failure";
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("stuck") ||
    normalized.includes("stall") ||
    normalized.includes("held")
  ) {
    return "timeout_or_stall";
  }
  return "scenario_assertion_failure";
}

export function buildFailureDescriptor({
  code,
  reason,
  source,
  finalState = null,
}: FailureDescriptorInput): FailureDescriptor {
  const normalizedCode = code ?? "scenario_assertion_failure";
  return {
    code: normalizedCode,
    label: humanizeClassification(normalizedCode),
    reason: toErrorMessage(reason) || normalizedCode,
    source: source ?? "scenario",
    finalState,
    infrastructure: isInfrastructureFailure(normalizedCode),
    recoverable: isRecoverableFailure(normalizedCode),
    severity: classificationSeverity(normalizedCode),
    failed: normalizedCode !== "success",
  };
}

export function normalizeFailureDescriptor(
  value: string | Partial<FailureDescriptor> | null | undefined,
  fallback: FailureDescriptorInput = {},
): FailureDescriptor | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.code
  ) {
    return buildFailureDescriptor({
      code: value.code,
      reason: value.reason ?? fallback.reason ?? value.code,
      source: value.source ?? fallback.source ?? "scenario",
      finalState: value.finalState ?? fallback.finalState ?? null,
    });
  }
  if (!value && !fallback.code) {
    return null;
  }
  return buildFailureDescriptor({
    code:
      typeof value === "string"
        ? value
        : (fallback.code ?? "scenario_assertion_failure"),
    reason: fallback.reason ?? value ?? null,
    source: fallback.source ?? "scenario",
    finalState: fallback.finalState ?? null,
  });
}

export function buildSuggestion(
  action: string,
  options: {
    reason?: unknown;
    expectedOutcome?: unknown;
    targetType?: string | null;
    targetId?: string | null;
    commandHint?: string | null;
    httpHint?: string | null;
    priority?: string;
  } = {},
): SuggestedAction {
  const {
    reason,
    expectedOutcome,
    targetType,
    targetId,
    commandHint,
    httpHint,
    priority = "medium",
  } = options;
  return {
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    priority,
    reason: toErrorMessage(reason) || action,
    expectedOutcome: toErrorMessage(expectedOutcome) || null,
    commandHint: commandHint ?? null,
    httpHint: httpHint ?? null,
  };
}
