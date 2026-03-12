import assert from "node:assert/strict";
import test from "node:test";

import { parseCliJsonOutput } from "../run-cli.js";

test("parseCliJsonOutput parses valid JSON output", () => {
  const payload = parseCliJsonOutput('{"ok":true,"detail":{"id":"abc"}}', [
    "fake",
    "args",
  ]);

  assert.deepEqual(payload, {
    ok: true,
    detail: {
      id: "abc",
    },
  });
});

test("parseCliJsonOutput rejects empty success output with actionable error", () => {
  assert.throws(
    () => parseCliJsonOutput("   ", ["fake", "args"]),
    /returned no JSON output/i,
  );
});

test("parseCliJsonOutput rejects invalid JSON output without crashing caller", () => {
  assert.throws(
    () => parseCliJsonOutput("not-json", ["fake", "args"]),
    /returned invalid JSON output/i,
  );
});
