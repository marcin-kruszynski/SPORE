import {
  type ChildProcess,
  type StdioOptions,
  spawn,
} from "node:child_process";
import net from "node:net";
import { buildTsxEntrypointArgs } from "@spore/core";

export interface HarnessTempPaths {
  root: string;
  dbPath: string;
  sessionDbPath: string;
}

export interface HarnessTempPathsWithEventLog extends HarnessTempPaths {
  eventLogPath: string;
}

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_CLI_TIMEOUT_MS = 300_000;

// biome-ignore lint/suspicious/noExplicitAny: shared integration harnesses intentionally default to loosely typed JSON envelopes; callers can pass T when they need narrowing.
export type JsonResponse<T = any> = {
  status: number;
  json: T | null;
};

async function parseJsonResponse<T>(
  response: Response,
): Promise<JsonResponse<T>> {
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as T) : null,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHealth(
  url: string,
  attempts = 100,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // service still booting
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
}

export function withEventLogPath(
  paths: HarnessTempPaths,
): HarnessTempPathsWithEventLog {
  return {
    ...paths,
    eventLogPath: `${paths.root}/events.ndjson`,
  };
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (port === null) {
          reject(new Error("failed to resolve free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

export function startProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  options: { stdio?: StdioOptions } = {},
): ChildProcess {
  const invocation =
    (command === "node" || command === process.execPath) && args[0]
      ? {
          command: process.execPath,
          args: buildTsxEntrypointArgs(args[0], args.slice(1)),
        }
      : { command, args };

  return spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: options.stdio ?? "ignore",
  });
}

function isProcessSettled(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function releaseHandles(child: ChildProcess) {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.stdin?.destroy();
  child.unref?.();
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals) {
  if (isProcessSettled(child)) {
    return;
  }
  try {
    child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function waitForProcessTermination(child: ChildProcess): Promise<void> {
  if (isProcessSettled(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const settle = () => {
      child.off("close", settle);
      child.off("exit", settle);
      child.off("error", settle);
      resolve();
    };
    child.once("close", settle);
    child.once("exit", settle);
    child.once("error", settle);
  });
}

function waitForTerminationWindow(
  terminated: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    void terminated.then(() => finish(true));
  });
}

export async function stopProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  timeoutMs = 5_000,
): Promise<void> {
  if (!child) {
    return;
  }

  if (isProcessSettled(child)) {
    releaseHandles(child);
    return;
  }

  const terminated = waitForProcessTermination(child);
  try {
    sendSignal(child, signal);
    const exitedGracefully = await waitForTerminationWindow(
      terminated,
      timeoutMs,
    );
    if (!exitedGracefully) {
      sendSignal(child, "SIGKILL");
      await waitForTerminationWindow(
        terminated,
        Math.max(1_000, Math.min(timeoutMs, 5_000)),
      );
    }
  } finally {
    releaseHandles(child);
  }
}

export async function runCliScript(
  scriptPath: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<CliRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const commandLabel = `${scriptPath} ${args.join(" ")}`.trim();
  const child = startProcess(
    process.execPath,
    [scriptPath, ...args],
    options.env,
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return new Promise<CliRunResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("exit", onExit);
      child.off("error", onError);
      callback();
    };

    const onError = (error: Error) => {
      finish(() => reject(error));
    };

    const settleWithCode = (code: number | null) => {
      if (timedOut) {
        finish(() =>
          reject(
            new Error(
              `CLI timed out after ${timeoutMs}ms: ${commandLabel}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          ),
        );
        return;
      }
      if (code === 0) {
        finish(() => resolve({ code, stdout, stderr }));
        return;
      }
      finish(() =>
        reject(
          new Error(
            [
              `CLI failed (${commandLabel}), exit=${String(code)}`,
              stderr ? `stderr:\n${stderr}` : "",
              stdout ? `stdout:\n${stdout}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        ),
      );
    };

    const onClose = (code: number | null) => {
      settleWithCode(code);
    };

    const onExit = (code: number | null) => {
      settleWithCode(code);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcess(child)
        .then(() => {
          finish(() =>
            reject(
              new Error(
                `CLI timed out after ${timeoutMs}ms: ${commandLabel}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
              ),
            ),
          );
        })
        .catch((error) => {
          finish(() =>
            reject(error instanceof Error ? error : new Error(String(error))),
          );
        });
    }, timeoutMs);
    timer.unref?.();

    child.once("close", onClose);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

// biome-ignore lint/suspicious/noExplicitAny: shared integration harnesses intentionally default to loosely typed JSON envelopes; callers can pass T when they need narrowing.
export async function postJson<T = any>(
  url: string,
  payload: unknown,
): Promise<JsonResponse<T>> {
  return parseJsonResponse<T>(
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: shared integration harnesses intentionally default to loosely typed JSON envelopes; callers can pass T when they need narrowing.
export async function getJson<T = any>(url: string): Promise<JsonResponse<T>> {
  return parseJsonResponse<T>(await fetch(url));
}
