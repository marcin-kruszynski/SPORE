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
      (Array.isArray(value) && value.length > 0)
    );
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined;
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
}: {
  markerFound: boolean;
  parsedBlock: unknown;
  requiredSections: string[];
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
