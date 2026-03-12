import fs from "node:fs/promises";
import path from "node:path";

import { runProcess } from "@spore/test-support";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const WEB_DIST_DIR = path.resolve(import.meta.dirname, "../dist");
const LEGACY_MAIN_PATH = path.resolve(import.meta.dirname, "../public/main.js");
const LEGACY_ASSETS_DIR = path.resolve(import.meta.dirname, "../public/assets");
const LEGACY_CHUNKS_DIR = path.resolve(import.meta.dirname, "../public/chunks");

let webRuntimeBuildPromise: Promise<void> | null = null;

export async function ensureWebRuntimeBuilt() {
  webRuntimeBuildPromise ??= buildWebRuntime();
  await webRuntimeBuildPromise;
}

async function buildWebRuntime() {
  await Promise.all([
    fs.rm(WEB_DIST_DIR, { force: true, recursive: true }),
    fs.rm(LEGACY_MAIN_PATH, { force: true }),
    fs.rm(LEGACY_ASSETS_DIR, { force: true, recursive: true }),
    fs.rm(LEGACY_CHUNKS_DIR, { force: true, recursive: true }),
  ]);

  await runProcess(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "@spore/web", "run", "build"],
    { cwd: PROJECT_ROOT },
  );
}
