import {
  type ChildProcess,
  type StdioOptions,
  spawn,
} from "node:child_process";
import { once } from "node:events";
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

export async function stopProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  timeoutMs = 5_000,
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const releaseHandles = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.stdin?.destroy();
    child.unref?.();
  };

  child.kill(signal);

  const exitPromise = once(child, "exit").then(() => undefined);
  const timeoutPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      releaseHandles();
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });

  await Promise.race([exitPromise, timeoutPromise]);
  releaseHandles();
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
