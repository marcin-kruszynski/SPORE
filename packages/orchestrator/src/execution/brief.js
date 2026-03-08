import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "../metadata/constants.js";

export async function writeExecutionBrief(execution, step) {
  const briefDir = path.join(PROJECT_ROOT, "tmp", "orchestrator", execution.id);
  await fs.mkdir(briefDir, { recursive: true });
  const briefPath = path.join(briefDir, `${step.sessionId}.brief.md`);
  const deliverableHint = step.role === "reviewer"
    ? "Return exactly one sentence that states readiness using approve, revise, or reject."
    : "Return exactly one concise sentence that advances the workflow objective.";
  const lines = [
    "# SPORE Workflow Invocation Brief",
    "",
    `- Execution: ${execution.id}`,
    `- Workflow: ${execution.workflowId}`,
    `- Project: ${execution.projectId}`,
    `- Domain: ${execution.domainId ?? "shared"}`,
    `- Step: ${step.sequence + 1}`,
    `- Role: ${step.role}`,
    `- Requested profile: ${step.requestedProfileId}`,
    "",
    "## Objective",
    execution.objective?.trim() || "No objective was provided.",
    "",
    "## Execution Rules",
    "- Use the objective as the active assignment for this session.",
    "- Stay within the session role boundary.",
    "- Prefer documentation-first behavior.",
    "- Prefer a direct answer over exploratory tool use.",
    "- Do not inspect session health, tmux state, or runtime internals unless the brief explicitly requires it.",
    "- Do not run bash unless it is essential to the objective.",
    "- End the session immediately after producing the requested deliverable.",
    "",
    "## Completion Contract",
    `- ${deliverableHint}`,
    "- Keep the response self-contained.",
    "- Do not ask follow-up questions.",
    "- Do not continue with extra analysis after the deliverable is produced."
  ];
  await fs.writeFile(briefPath, `${lines.join("\n")}\n`, "utf8");
  return path.relative(PROJECT_ROOT, briefPath);
}
