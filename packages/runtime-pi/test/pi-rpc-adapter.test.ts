import assert from "node:assert/strict";
import test from "node:test";

import { createPiRpcAdapter, PI_RPC_CAPABILITIES } from "../src/index.js";

test("PiRpcAdapter reports tmux inspection and raw event support", () => {
  const adapter = createPiRpcAdapter();

  assert.equal(adapter.backendKind, "pi_rpc");
  assert.deepEqual(adapter.capabilities, PI_RPC_CAPABILITIES);
  assert.equal(adapter.capabilities.supportsTmuxInspection, true);
  assert.equal(adapter.capabilities.supportsRawEvents, true);
});
