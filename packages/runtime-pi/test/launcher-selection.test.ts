import assert from "node:assert/strict";
import test from "node:test";

import { resolveLauncherType } from "../src/cli/run-session-plan.js";

test("resolveLauncherType fails loudly when PI is unavailable and stub was not requested", async () => {
  await assert.rejects(
    () => resolveLauncherType({}, false),
    /pi CLI is required for runtime launch/i,
  );
});

test("resolveLauncherType keeps explicit stub mode available for tests and diagnostics", async () => {
  assert.equal(await resolveLauncherType({ stub: "true" }, false), "stub");
});

test("resolveLauncherType prefers explicit launcher when provided", async () => {
  assert.equal(await resolveLauncherType({ launcher: "pi-json" }, true), "pi-json");
});

test("resolveLauncherType defaults to pi-rpc when PI is available", async () => {
  assert.equal(await resolveLauncherType({}, true), "pi-rpc");
});
