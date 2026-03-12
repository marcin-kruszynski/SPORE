import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeJsonFileAtomically } from "../src/launchers/json-file.js";

test("writeJsonFileAtomically replaces json content without leaving temp files behind", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-json-file-"));
  const filePath = path.join(root, "status.json");

  await writeJsonFileAtomically(filePath, { status: "starting", count: 1 });
  await writeJsonFileAtomically(filePath, { status: "completed", count: 2 });

  const written = JSON.parse(await fs.readFile(filePath, "utf8"));
  const entries = await fs.readdir(root);

  assert.deepEqual(written, { status: "completed", count: 2 });
  assert.deepEqual(entries, ["status.json"]);
});

test("writeJsonFileAtomically tolerates overlapping writes from the same process", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-json-file-overlap-"));
  const filePath = path.join(root, "status.json");

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      writeJsonFileAtomically(filePath, {
        status: "streaming",
        count: index,
      }),
    ),
  );

  const written = JSON.parse(await fs.readFile(filePath, "utf8"));
  const entries = await fs.readdir(root);

  assert.equal(written.status, "streaming");
  assert.match(String(written.count), /^\d+$/);
  assert.deepEqual(entries, ["status.json"]);
});
