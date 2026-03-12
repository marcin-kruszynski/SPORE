import { spawn } from "node:child_process";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";

export function parseCliJsonOutput(stdout: string, args: string[]) {
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(`command returned no JSON output: ${args.join(" ")}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `command returned invalid JSON output: ${args.join(" ")} (${message})`,
    );
  }
}

export function runCli(args: string[]) {
  return new Promise((resolve, reject) => {
    const [scriptPath, ...scriptArgs] = args;
    const child = spawn(
      process.execPath,
      buildTsxEntrypointArgs(scriptPath, scriptArgs),
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        try {
          resolve(parseCliJsonOutput(stdout, args));
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(
        new Error(stderr || stdout || `command failed: ${args.join(" ")}`),
      );
    });
    child.on("error", reject);
  });
}
