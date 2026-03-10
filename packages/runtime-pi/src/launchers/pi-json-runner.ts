#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@spore/config-schema";

import { PROJECT_ROOT } from "../metadata/constants.js";
import type { CliFlags } from "../types.js";

type JsonRunnerEvent = JsonObject & {
  type?: string;
  id?: string;
  cwd?: string;
  assistantMessageEvent?:
    | (JsonObject & {
        type?: string;
        delta?: string;
      })
    | null;
  toolName?: string;
  args?: JsonValue;
  isError?: boolean;
  attempt?: number | string;
  maxAttempts?: number | string;
  delayMs?: number | string;
  success?: boolean;
};

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(raw: string): JsonValue {
  return JSON.parse(raw) as JsonValue;
}

function asJsonRunnerEvent(value: JsonValue | unknown): JsonRunnerEvent | null {
  return isJsonObject(value) ? (value as JsonRunnerEvent) : null;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);
}

async function ensureFileParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function appendText(filePath: string, text: string): Promise<void> {
  await ensureFileParent(filePath);
  await fs.appendFile(filePath, text, "utf8");
}

function createTranscriptRenderer(transcriptPath: string) {
  let assistantOpen = false;

  return async function renderEvent(event: unknown) {
    const payload = asJsonRunnerEvent(event);
    if (!payload) {
      return;
    }

    if (payload.type === "session") {
      await appendText(
        transcriptPath,
        `# PI JSON Session\n\n- sessionId: ${payload.id ?? "unknown"}\n- cwd: ${payload.cwd ?? "unknown"}\n\n`,
      );
      return;
    }

    if (
      payload.type === "message_update" &&
      payload.assistantMessageEvent?.type === "text_delta"
    ) {
      assistantOpen = true;
      await appendText(
        transcriptPath,
        payload.assistantMessageEvent.delta ?? "",
      );
      return;
    }

    if (payload.type === "message_end" && assistantOpen) {
      assistantOpen = false;
      await appendText(transcriptPath, "\n\n");
      return;
    }

    if (payload.type === "tool_execution_start") {
      await appendText(
        transcriptPath,
        `\n[tool:start] ${payload.toolName ?? "unknown"} ${JSON.stringify(payload.args ?? {})}\n`,
      );
      return;
    }

    if (payload.type === "tool_execution_end") {
      await appendText(
        transcriptPath,
        `[tool:end] ${payload.toolName ?? "unknown"} error=${payload.isError ? "true" : "false"}\n`,
      );
      return;
    }

    if (payload.type === "auto_retry_start") {
      await appendText(
        transcriptPath,
        `\n[retry:start] attempt=${payload.attempt}/${payload.maxAttempts} delayMs=${payload.delayMs}\n`,
      );
      return;
    }

    if (payload.type === "auto_retry_end") {
      await appendText(
        transcriptPath,
        `[retry:end] success=${payload.success ? "true" : "false"}\n`,
      );
    }
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (
    !flags["pi-bin"] ||
    !flags.prompt ||
    !flags.transcript ||
    !flags.events ||
    !flags.stderr ||
    !flags["session-file"]
  ) {
    throw new Error(
      "use --pi-bin --prompt --transcript --events --stderr --session-file [--cwd <path>]",
    );
  }

  const piBinary = resolvePath(flags["pi-bin"]);
  const promptPath = resolvePath(flags.prompt);
  const transcriptPath = resolvePath(flags.transcript);
  const eventsPath = resolvePath(flags.events);
  const stderrPath = resolvePath(flags.stderr);
  const sessionFilePath = resolvePath(flags["session-file"]);
  const workingDirectory = flags.cwd ? resolvePath(flags.cwd) : PROJECT_ROOT;

  await Promise.all([
    ensureFileParent(transcriptPath),
    ensureFileParent(eventsPath),
    ensureFileParent(stderrPath),
    ensureFileParent(sessionFilePath),
  ]);

  const renderEvent = createTranscriptRenderer(transcriptPath);
  const child = spawn(
    piBinary,
    [
      "--mode",
      "json",
      "--session",
      sessionFilePath,
      `@${promptPath}`,
      "Execute this SPORE session plan.",
    ],
    {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  child.stdout.on("data", async (chunk) => {
    const text = chunk.toString("utf8");
    stdoutBuffer += text;
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        await appendText(eventsPath, `${line}\n`);
        try {
          const event = parseJsonValue(line);
          await renderEvent(event);
        } catch {
          await appendText(transcriptPath, `${line}\n`);
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", async (chunk) => {
    const text = chunk.toString("utf8");
    await appendText(stderrPath, text);
    await appendText(transcriptPath, `\n[stderr]\n${text}\n`);
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (stdoutBuffer.trim()) {
    const line = stdoutBuffer.trim();
    await appendText(eventsPath, `${line}\n`);
    try {
      const event = parseJsonValue(line);
      await renderEvent(event);
    } catch {
      await appendText(transcriptPath, `${line}\n`);
    }
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`pi-json-runner error: ${error.message}`);
  process.exitCode = 1;
});
