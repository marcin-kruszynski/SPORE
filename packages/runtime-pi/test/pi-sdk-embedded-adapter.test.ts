import assert from "node:assert/strict";
import test from "node:test";

import {
  createPiSdkEmbeddedAdapter,
  PI_SDK_EMBEDDED_CAPABILITIES,
} from "../src/index.js";

test("PiSdkEmbeddedAdapter advertises non-tmux same-process capabilities", () => {
  const adapter = createPiSdkEmbeddedAdapter();

  assert.equal(adapter.backendKind, "pi_sdk_embedded");
  assert.deepEqual(adapter.capabilities, PI_SDK_EMBEDDED_CAPABILITIES);
  assert.equal(adapter.capabilities.supportsAttach, false);
  assert.equal(adapter.capabilities.supportsTmuxInspection, false);
});
