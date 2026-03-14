import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionPlan } from "../src/planner/build-session-plan.js";

test("buildSessionPlan carries provider family and backend kind", async () => {
  const plan = await buildSessionPlan({
    profilePath: "config/profiles/lead.yaml",
    projectPath: "config/projects/spore.yaml",
    backendKind: "pi_rpc",
  });

  assert.equal(plan.providerFamily, "pi");
  assert.equal(plan.backendKind, "pi_rpc");
});
