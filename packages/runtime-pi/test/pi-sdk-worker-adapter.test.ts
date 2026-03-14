import assert from "node:assert/strict";
import test from "node:test";

import {
  createPiSdkWorkerAdapter,
  PI_SDK_WORKER_CAPABILITIES,
} from "../src/index.js";

test("PiSdkWorkerAdapter advertises attachable worker-process capabilities", () => {
  const adapter = createPiSdkWorkerAdapter();

  assert.equal(adapter.backendKind, "pi_sdk_worker");
  assert.deepEqual(adapter.capabilities, PI_SDK_WORKER_CAPABILITIES);
  assert.equal(adapter.capabilities.supportsAttach, true);
  assert.equal(adapter.capabilities.supportsTmuxInspection, false);
});
