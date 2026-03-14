import assert from "node:assert/strict";
import test from "node:test";

import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";

test("runtime policy can select backend kind by role", async () => {
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/backend-service-delivery.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "backend",
    roles: ["builder"],
    invocationId: "test-runtime-backend-policy",
    objective: "Verify runtime backend policy propagation",
  });

  assert.equal(invocation.launches[0]?.policy.runtimePolicy.backendKind, "pi_rpc");
  assert.equal(invocation.effectivePolicy.runtimePolicy.defaultBackendKind, "pi_rpc");
});
