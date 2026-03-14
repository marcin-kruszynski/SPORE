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
  test(`adapter contract: ${adapter.backendKind}`, () => {
    assert.equal(typeof adapter.start, "function");
    assert.equal(typeof adapter.getSnapshot, "function");
    assert.equal(typeof adapter.sendControl, "function");
    assert.equal(typeof adapter.shutdown, "function");
    assert.equal(adapter.providerFamily, "pi");
  });
}
