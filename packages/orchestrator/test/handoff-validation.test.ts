import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveHandoffEnforcementMode,
  resolveHandoffEnforcement,
  validateStructuredHandoff,
} from "../src/execution/handoff-validation.js";
import { transitionStepRecord } from "../src/lifecycle/execution-lifecycle.js";

test("missing required sections yields invalid handoff result", () => {
  const result = validateStructuredHandoff({
    markerFound: true,
    parsedBlock: {
      summary: {
        title: "Builder summary",
      },
      changed_paths: ["apps/web/src/main.ts"],
    },
    requiredSections: ["summary", "changed_paths", "tests_run"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.degraded, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.code, "missing_required_section");
  assert.equal(result.issues[0]?.section, "tests_run");
});

test("missing marker yields degraded invalid result", () => {
  const result = validateStructuredHandoff({
    markerFound: false,
    parsedBlock: null,
    requiredSections: ["summary"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.degraded, true);
  assert.equal(result.issues[0]?.code, "missing_marker");
});

test("valid payload satisfies required sections", () => {
  const result = validateStructuredHandoff({
    markerFound: true,
    parsedBlock: {
      summary: {
        title: "Scout findings",
      },
      findings: ["one"],
      recommendations: ["two"],
      risks: [],
    },
    requiredSections: ["summary", "findings", "recommendations", "risks"],
  });

  assert.equal(result.valid, true);
  assert.equal(result.degraded, false);
  assert.equal(result.issues.length, 0);
});

test("summary must be an object when required", () => {
  const result = validateStructuredHandoff({
    markerFound: true,
    parsedBlock: {
      summary: "plain text summary",
      findings: ["one"],
    },
    requiredSections: ["summary", "findings"],
  });

  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "missing_required_section");
  assert.equal(result.issues[0]?.section, "summary");
});

test("contract fields with wrong types fail validation", () => {
  const result = validateStructuredHandoff({
    markerFound: true,
    parsedBlock: {
      summary: { title: "Integration summary" },
      verdict: { state: "blocked" },
      target_branch: ["main"],
      integration_branch: 123,
      blockers: "none",
    },
    requiredSections: [
      "summary",
      "verdict",
      "target_branch",
      "integration_branch",
      "blockers",
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.section),
    ["verdict", "target_branch", "integration_branch", "blockers"],
  );
});

test("enforcement mode defaults to accept and validates supported values", () => {
  assert.equal(deriveHandoffEnforcementMode(undefined), "accept");
  assert.equal(deriveHandoffEnforcementMode("review_pending"), "review_pending");
  assert.equal(deriveHandoffEnforcementMode("blocked"), "blocked");
  assert.equal(deriveHandoffEnforcementMode("unexpected"), "accept");
});

test("invalid handoff with review_pending mode holds the step for review", () => {
  const step = transitionStepRecord(
    {
      id: "execution-1:step:1",
      executionId: "execution-1",
      sequence: 0,
      role: "lead",
      reviewRequired: false,
      reviewStatus: null,
      approvalRequired: false,
      approvalStatus: null,
      state: "completed",
      launchedAt: null,
      settledAt: null,
      updatedAt: new Date().toISOString(),
    },
    "completed",
  );

  const resolved = resolveHandoffEnforcement(step, [
    {
      id: "handoff-1",
      validation: {
        valid: false,
        degraded: true,
        mode: "review_pending",
        issues: [{ code: "missing_marker", message: "missing" }],
      },
    },
  ]);

  assert.equal(resolved.step.state, "review_pending");
  assert.equal(resolved.step.reviewStatus, "pending");
  assert.equal(resolved.enforcement.mode, "review_pending");
});

test("invalid handoff with blocked mode blocks downstream progression", () => {
  const step = transitionStepRecord(
    {
      id: "execution-1:step:1",
      executionId: "execution-1",
      sequence: 0,
      role: "lead",
      reviewRequired: false,
      reviewStatus: null,
      approvalRequired: false,
      approvalStatus: null,
      state: "completed",
      launchedAt: null,
      settledAt: null,
      updatedAt: new Date().toISOString(),
    },
    "completed",
  );

  const resolved = resolveHandoffEnforcement(step, [
    {
      id: "handoff-1",
      validation: {
        valid: false,
        degraded: true,
        mode: "blocked",
        issues: [{ code: "missing_required_section", message: "missing" }],
      },
    },
  ]);

  assert.equal(resolved.step.state, "review_pending");
  assert.equal(resolved.step.lastError, "handoff_validation_blocked");
  assert.equal(resolved.enforcement.mode, "blocked");
});
