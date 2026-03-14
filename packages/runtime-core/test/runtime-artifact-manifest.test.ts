import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeArtifactManifest,
  DEFAULT_RUNTIME_ARTIFACT_NAMES,
} from "../src/index.js";

test("runtime artifact manifest defaults to nullable stable keys", () => {
  const manifest = createRuntimeArtifactManifest({
    transcriptPath: "tmp/sessions/session-1.transcript.md",
  });

  assert.equal(
    manifest.transcriptPath,
    "tmp/sessions/session-1.transcript.md",
  );
  assert.equal(manifest.runtimeStatusPath, null);
  assert.deepEqual(manifest.debugPaths, []);
  assert.equal(DEFAULT_RUNTIME_ARTIFACT_NAMES.runtimeStatus, "runtime-status.json");
});
