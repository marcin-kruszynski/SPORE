import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PROJECT_ROOT } from "@spore/core";

import { loadSchemaForConfig, parseYaml, validateAgainstSchema } from "../src/index.js";

test("system runtime config keeps profile runtime=pi while registering backend kinds", async () => {
  const filePath = path.join(PROJECT_ROOT, "config/system/runtime.yaml");
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  const schema = await loadSchemaForConfig(filePath);
  const errors = validateAgainstSchema(schema, parsed);

  assert.deepEqual(errors, []);
  const runtime = parsed as {
    primaryRuntime: { providerFamily: string; backendKind: string };
  };
  assert.equal(runtime.primaryRuntime.providerFamily, "pi");
  assert.equal(runtime.primaryRuntime.backendKind, "pi_rpc");
});
