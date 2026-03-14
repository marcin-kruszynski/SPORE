import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeSnapshot } from "../src/index.js";

test("runtime adapter contract captures backend identity and capabilities", () => {
  const snapshot: RuntimeSnapshot = {
    sessionId: "session-1",
    backendKind: "pi_rpc",
    state: "starting",
    health: "healthy",
    startedAt: null,
    finishedAt: null,
    lastEventAt: null,
    terminalSignal: null,
    rawStateRef: null,
  };

  assert.equal(snapshot.backendKind, "pi_rpc");
  assert.equal(snapshot.state, "starting");
});
