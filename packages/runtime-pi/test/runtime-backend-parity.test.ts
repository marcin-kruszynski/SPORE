import assert from "node:assert/strict";
import test from "node:test";

import {
  createPiRpcAdapter,
  createPiSdkEmbeddedAdapter,
  createPiSdkWorkerAdapter,
} from "../src/index.js";

for (const adapter of [
  createPiRpcAdapter(),
  createPiSdkEmbeddedAdapter(),
  createPiSdkWorkerAdapter(),
]) {
  test(`parity: ${adapter.backendKind} exposes core control capabilities`, () => {
    assert.equal(adapter.capabilities.supportsSteer, true);
    assert.equal(adapter.capabilities.supportsAbort, true);
    assert.equal(adapter.capabilities.supportsSnapshot, true);
  });
}
