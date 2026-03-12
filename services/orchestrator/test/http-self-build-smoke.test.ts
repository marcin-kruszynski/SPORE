import test from "node:test";

import {
  ensureRealPiSmokePrerequisites,
  runPromptToPromotionCandidate,
  startSelfBuildSmokeStack,
} from "./helpers/http-self-build-smoke.js";

const PROMPT_CASES = [
  {
    id: "operator-dashboard-review",
    prompt:
      "Improve the operator web dashboard for self-build review and keep the work in safe mode.",
  },
  {
    id: "operator-webui-promotion",
    prompt:
      "Improve the operator web UI for proposal promotion readiness and keep the work in safe mode.",
  },
] as const;

test(
  "real PI self-build smoke covers dashboard and webui prompts",
  { timeout: 40 * 60_000 },
  async (t) => {
    if (!(await ensureRealPiSmokePrerequisites(t))) {
      return;
    }

    const stack = await startSelfBuildSmokeStack(t);

    for (const promptCase of PROMPT_CASES) {
      await t.test(promptCase.id, async (t) => {
        const result = await runPromptToPromotionCandidate(stack, promptCase);
        t.diagnostic(JSON.stringify({ promptCase: promptCase.id, ...result }));
      });
    }
  },
);
