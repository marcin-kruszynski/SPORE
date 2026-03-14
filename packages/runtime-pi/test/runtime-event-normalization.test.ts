import assert from "node:assert/strict";
import test from "node:test";

import { normalizePiRpcEvent } from "../src/normalize/pi-rpc-events.js";
import { normalizePiSdkEvent } from "../src/normalize/pi-sdk-events.js";

test("normalizePiRpcEvent preserves payload and backend kind", () => {
  const event = normalizePiRpcEvent("session-1", 1, { type: "agent.message" });
  assert.equal(event.backendKind, "pi_rpc");
  assert.equal(event.type, "agent.message");
});

test("normalizePiSdkEvent preserves payload and backend kind", () => {
  const event = normalizePiSdkEvent("session-1", "pi_sdk_worker", 1, {
    eventType: "runtime.heartbeat",
  });
  assert.equal(event.backendKind, "pi_sdk_worker");
  assert.equal(event.type, "runtime.heartbeat");
});
