import assert from "node:assert/strict";
import test from "node:test";

import {
  decorateExecution,
  getExecutionCoordinationMode,
  getExecutionFamilyKey,
  getExecutionRootExecutionId,
} from "../src/execution/execution-metadata.js";

test("coordinator family metadata uses rootExecutionId as the canonical identifier and familyKey as optional grouping metadata", () => {
  const root = {
    id: "coord-root-42",
    coordinationGroupId: "family-42",
    metadata: {
      topologyKind: "project-root",
      projectRole: "coordinator",
      familyKey: "family-42",
      coordinationMode: "delivery",
    },
  };
  const lead = {
    id: "lead-backend-42",
    parentExecutionId: root.id,
    coordinationGroupId: root.coordinationGroupId,
    metadata: {
      topologyKind: "project-child",
      projectRootExecutionId: root.id,
      projectLaneType: "lead",
    },
  };

  assert.equal(getExecutionRootExecutionId(root), root.id);
  assert.equal(getExecutionRootExecutionId(lead), root.id);
  assert.equal(getExecutionFamilyKey(root), "family-42");
  assert.equal(getExecutionFamilyKey(lead), "family-42");
  assert.equal(getExecutionCoordinationMode(root), "delivery");
});

test("decorateExecution surfaces canonical family identity alongside legacy topology metadata", () => {
  const decorated = decorateExecution({
    id: "coord-root-99",
    coordinationGroupId: "family-99",
    metadata: {
      topologyKind: "project-root",
      projectRole: "coordinator",
      projectLaneType: "coordinator",
      familyKey: "family-99",
      coordinationMode: "project-breakdown",
    },
  });

  assert.equal(decorated?.topology.projectRootExecutionId, "coord-root-99");
  assert.equal(decorated?.topology.rootExecutionId, "coord-root-99");
  assert.equal(decorated?.topology.familyKey, "family-99");
  assert.equal(decorated?.topology.coordinationMode, "project-breakdown");
});
