import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkerMessage,
  serializeWorkerMessage,
  WORKER_PROTOCOL_VERSION,
  WorkerCommandSchema,
} from "../src/worker/protocol.js";

test("worker protocol envelopes require protocolVersion and requestId", () => {
  const parsed = WorkerCommandSchema.parse({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "command",
    requestId: "req-1",
    sessionId: "session-1",
    command: "session.start",
    timestamp: new Date().toISOString(),
    payload: {},
  });

  assert.equal(parsed.command, "session.start");
  assert.equal(
    parseWorkerMessage(serializeWorkerMessage(parsed)).messageType,
    "command",
  );
});
