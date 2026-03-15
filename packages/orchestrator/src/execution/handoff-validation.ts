import type {
  HandoffValidationIssue,
  HandoffValidationResult,
} from "../types/contracts.js";
import { transitionStepRecord } from "../lifecycle/execution-lifecycle.js";

const VALID_ENFORCEMENT_MODES = new Set([
  "accept",
  "review_pending",
  "blocked",
]);

const SECTION_ALIASES: Record<string, string[]> = {
  risks: ["risks", "risk", "ris"],
  next_role: ["next_role", "nextRole", "next-role"],
  changed_paths: ["changed_paths", "changedPaths"],
  tests_run: ["tests_run", "testsRun"],
  open_risks: ["open_risks", "openRisks"],
  next_actions: ["next_actions", "nextActions"],
  target_branch: ["target_branch", "targetBranch"],
  integration_branch: ["integration_branch", "integrationBranch"],
  task_id: ["task_id", "taskId"],
  active_task_id: ["active_task_id", "activeTaskId"],
  blocked_on_task_ids: ["blocked_on_task_ids", "blockedOnTaskIds"],
  replan_reason: ["replan_reason", "replanReason"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildIssue(
  code: string,
  message: string,
  section?: string | null,
): HandoffValidationIssue {
  return {
    code,
    message,
    section: section ?? null,
  };
}

function getValidation(record: Record<string, unknown>) {
  const validation = record.validation;
  return isRecord(validation) ? validation : {};
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecordArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item));
}

function coordinationPlanSectionIsValid(
  section: string,
  value: unknown,
): boolean {
  if (section === "affected_domains" || section === "unresolved_questions") {
    if (!Array.isArray(value)) {
      return false;
    }
    return section === "affected_domains"
      ? isStringArray(value) && value.length > 0
      : isStringArray(value);
  }
  if (!isRecordArray(value)) {
    return false;
  }
  const records = value as Array<Record<string, unknown>>;
  if (section === "domain_tasks") {
    if (records.length === 0) {
      return false;
    }
    return records.every(
      (record) =>
        typeof record.id === "string" && record.id.trim().length > 0 &&
        typeof record.domainId === "string" && record.domainId.trim().length > 0,
    );
  }
  if (section === "waves") {
    if (records.length === 0) {
      return false;
    }
    return records.every(
      (record) =>
        typeof record.id === "string" && record.id.trim().length > 0 &&
        isStringArray(record.task_ids),
    );
  }
  if (section === "dependencies") {
    return records.every(
      (record) =>
        typeof record.from_task_id === "string" &&
        record.from_task_id.trim().length > 0 &&
        typeof record.to_task_id === "string" &&
        record.to_task_id.trim().length > 0,
    );
  }
  if (section === "shared_contracts") {
    return records.every(
      (record) =>
        typeof record.id === "string" && record.id.trim().length > 0,
    );
  }
  return false;
}

function hasRequiredSection(
  payload: Record<string, unknown> | null,
  section: string,
) {
  if (!payload) {
    return false;
  }
  const candidateKeys = SECTION_ALIASES[section] ?? [section];
  const key = candidateKeys.find((candidate) => Object.hasOwn(payload, candidate));
  if (!key) {
    return false;
  }
  const value = payload[key];
  if (section === "summary") {
    return (
      isRecord(value) ||
      (Array.isArray(value) && value.length > 0) ||
      (typeof value === "string" && value.trim().length > 0)
    );
  }
  if (
    [
      "changed_paths",
      "tests_run",
      "findings",
      "recommendations",
      "risks",
      "evidence",
      "open_risks",
      "blockers",
      "active_lanes",
      "next_actions",
    ].includes(section)
  ) {
    return (
      Array.isArray(value) ||
      (typeof value === "string" && value.trim().length > 0)
    );
  }
  if (["task_id", "active_task_id", "status", "replan_reason"].includes(section)) {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (section === "blocked_on_task_ids") {
    return isStringArray(value);
  }
  if (
    [
      "affected_domains",
      "domain_tasks",
      "waves",
      "dependencies",
      "shared_contracts",
      "unresolved_questions",
    ].includes(section)
  ) {
    return coordinationPlanSectionIsValid(section, value);
  }
  if (
    [
      "verdict",
      "target_branch",
      "integration_branch",
      "next_role",
    ].includes(section)
  ) {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (section === "scope") {
    return (
      (typeof value === "string" && value.trim().length > 0) ||
      (Array.isArray(value) && value.length > 0) ||
      (isRecord(value) && Object.keys(value).length > 0)
    );
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined;
}

function getSectionValue(
  payload: Record<string, unknown> | null,
  section: string,
) {
  if (!payload) {
    return undefined;
  }
  const candidateKeys = SECTION_ALIASES[section] ?? [section];
  const key = candidateKeys.find((candidate) => Object.hasOwn(payload, candidate));
  return key ? payload[key] : undefined;
}

export function deriveHandoffEnforcementMode(value: unknown) {
  const mode = String(value ?? "").trim();
  if (VALID_ENFORCEMENT_MODES.has(mode)) {
    return mode as "accept" | "review_pending" | "blocked";
  }
  return "accept";
}

export function validateStructuredHandoff({
  markerFound,
  parsedBlock,
  requiredSections,
  allowedNextRoles,
}: {
  markerFound: boolean;
  parsedBlock: unknown;
  requiredSections: string[];
  allowedNextRoles?: string[];
}): HandoffValidationResult {
  const issues: HandoffValidationIssue[] = [];

  if (!markerFound) {
    issues.push(
      buildIssue(
        "missing_marker",
        "The structured handoff marker block was not found in the agent output.",
      ),
    );
  }

  if (markerFound && !isRecord(parsedBlock)) {
    issues.push(
      buildIssue(
        "invalid_json",
        "The structured handoff marker was present but did not contain a valid JSON object.",
      ),
    );
  }

  const payload = isRecord(parsedBlock) ? parsedBlock : null;
  for (const section of requiredSections) {
    if (!hasRequiredSection(payload, section)) {
      issues.push(
        buildIssue(
          "missing_required_section",
          `The structured handoff is missing the required section '${section}'.`,
          section,
        ),
      );
    }
  }

  const normalizedAllowedNextRoles = Array.isArray(allowedNextRoles)
    ? [...new Set(allowedNextRoles.map((entry) => String(entry ?? "").trim()).filter(Boolean))]
    : [];
  const nextRole = String(getSectionValue(payload, "next_role") ?? "").trim();
  if (
    payload &&
    nextRole &&
    normalizedAllowedNextRoles.length > 0 &&
    !normalizedAllowedNextRoles.includes(nextRole)
  ) {
    issues.push(
      buildIssue(
        "invalid_next_role",
        `The structured handoff next_role '${nextRole}' is not one of the allowed downstream roles: ${normalizedAllowedNextRoles.join(", ")}.`,
        "next_role",
      ),
    );
  }

  return {
    valid: issues.length === 0,
    degraded: issues.length > 0,
    issues,
  };
}

export function resolveHandoffEnforcement(
  step: Record<string, unknown>,
  handoffs: Array<Record<string, unknown>>,
) {
  const invalidHandoffs = handoffs.filter(
    (handoff) => getValidation(handoff).valid === false,
  );
  if (invalidHandoffs.length === 0) {
    return {
      step,
      enforcement: null,
    };
  }

  const blockingHandoff = invalidHandoffs.find(
    (handoff) => getValidation(handoff).mode === "blocked",
  );
  if (blockingHandoff) {
    return {
      step: transitionStepRecord(step, "review_pending", {
        reviewStatus: String(step.reviewStatus ?? "pending") || "pending",
        approvalStatus: step.approvalRequired
          ? (step.approvalStatus ?? "pending")
          : null,
        lastError: "handoff_validation_blocked",
      }),
      enforcement: {
        mode: "blocked",
        handoffId: blockingHandoff.id ?? null,
        issues: getValidation(blockingHandoff).issues ?? [],
      },
    };
  }

  const reviewPendingHandoff = invalidHandoffs.find(
    (handoff) => getValidation(handoff).mode === "review_pending",
  );
  if (reviewPendingHandoff) {
    return {
      step: transitionStepRecord(step, "review_pending", {
        reviewStatus: String(step.reviewStatus ?? "pending") || "pending",
        approvalStatus: step.approvalRequired
          ? (step.approvalStatus ?? "pending")
          : null,
      }),
      enforcement: {
        mode: "review_pending",
        handoffId: reviewPendingHandoff.id ?? null,
        issues: getValidation(reviewPendingHandoff).issues ?? [],
      },
    };
  }

  return {
    step,
    enforcement: {
      mode: "accept",
      handoffId: invalidHandoffs[0]?.id ?? null,
      issues: invalidHandoffs.flatMap(
        (handoff) => getValidation(handoff).issues ?? [],
      ),
    },
  };
}
