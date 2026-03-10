import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandFromPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${command}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null);
        return;
      }
      resolve(null);
    });
  });
}

async function commandFromSiblingNode(command: string): Promise<string | null> {
  const candidate = path.join(path.dirname(process.execPath), command);
  return (await isExecutable(candidate)) ? candidate : null;
}

async function commandFromGlobalNpmBin(
  command: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", "npm prefix -g"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("exit", async (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const prefix = stdout.trim();
      if (!prefix) {
        resolve(null);
        return;
      }
      const candidate = path.join(prefix, "bin", command);
      resolve((await isExecutable(candidate)) ? candidate : null);
    });
  });
}

async function commandFromNvm(command: string): Promise<string | null> {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  const versionsRoot = path.join(nvmDir, "versions", "node");
  try {
    const versions = (await fs.readdir(versionsRoot)).sort().reverse();
    for (const version of versions) {
      const candidate = path.join(versionsRoot, version, "bin", command);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function commandFromGlobalNpmPrefix(
  command: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", "npm prefix -g"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("exit", async (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const prefix = stdout.trim();
      if (!prefix) {
        resolve(null);
        return;
      }
      const candidate = path.join(prefix, "bin", command);
      resolve((await isExecutable(candidate)) ? candidate : null);
    });
  });
}

export async function resolveCommandBinary(
  command: string,
): Promise<string | null> {
  const override = command === "pi" ? (process.env.SPORE_PI_BIN ?? null) : null;
  if (override && (await isExecutable(override))) {
    return override;
  }

  const fromPath = await commandFromPath(command);
  if (fromPath) {
    return fromPath;
  }

  const fromSibling = await commandFromSiblingNode(command);
  if (fromSibling) {
    return fromSibling;
  }

  const fromGlobalNpmBin = await commandFromGlobalNpmBin(command);
  if (fromGlobalNpmBin) {
    return fromGlobalNpmBin;
  }

  if (command === "pi") {
    const fromNpmPrefix = await commandFromGlobalNpmPrefix(command);
    if (fromNpmPrefix) {
      return fromNpmPrefix;
    }
    const fromNvm = await commandFromNvm(command);
    if (fromNvm) {
      return fromNvm;
    }
  }

  return null;
}

export async function commandExists(command: string): Promise<boolean> {
  return (await resolveCommandBinary(command)) !== null;
}
