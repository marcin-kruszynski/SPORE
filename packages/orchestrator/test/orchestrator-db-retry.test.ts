import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openOrchestratorDatabase,
  withRetriedOrchestratorDatabase,
} from "../src/store/db.js";

test("withRetriedOrchestratorDatabase retries through transient sqlite locks", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "spore-db-retry-"));
  const dbPath = join(tempDir, "orchestrator.sqlite");

  const setup = openOrchestratorDatabase(dbPath);
  setup.exec(
    "CREATE TABLE IF NOT EXISTS retry_probe (id TEXT PRIMARY KEY, value TEXT);",
  );
  setup.close();

  const locker = spawn(
    process.execPath,
    [
      "--import=tsx",
      "--input-type=module",
      "-e",
      `
        import { openOrchestratorDatabase } from ${JSON.stringify(join(process.cwd(), "packages/orchestrator/src/store/db.ts"))};
        const db = openOrchestratorDatabase(${JSON.stringify(dbPath)});
        db.exec("CREATE TABLE IF NOT EXISTS retry_probe (id TEXT PRIMARY KEY, value TEXT);");
        db.exec("BEGIN IMMEDIATE;");
        db.exec("INSERT INTO retry_probe (id, value) VALUES ('locked', 'yes');");
        setTimeout(() => {
          db.exec("COMMIT;");
          db.close();
        }, 3600);
      `,
    ],
    { stdio: "ignore" },
  );

  await new Promise((resolve) => setTimeout(resolve, 200));

  const inserted = await withRetriedOrchestratorDatabase(
    dbPath,
    (db) => {
      db.exec("INSERT INTO retry_probe (id, value) VALUES ('after', 'ok');");
      return true;
    },
    {
      attempts: 4,
      delayMs: 300,
    },
  );

  assert.equal(inserted, true);

  const verify = openOrchestratorDatabase(dbPath);
  const rows = verify
    .prepare("SELECT id, value FROM retry_probe ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  verify.close();

  assert.deepEqual(rows, [
    { id: "after", value: "ok" },
    { id: "locked", value: "yes" },
  ]);

  await new Promise((resolve) => locker.on("exit", resolve));
});
