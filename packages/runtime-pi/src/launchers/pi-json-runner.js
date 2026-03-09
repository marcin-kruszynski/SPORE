#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../metadata/constants.js";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
}

async function ensureFileParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function appendText(filePath, text) {
  await ensureFileParent(filePath);
  await fs.appendFile(filePath, text, "utf8");
}

function createTranscriptRenderer(transcriptPath) {
  let assistantOpen = false;

  return async function renderEvent(event) {
    if (!event || typeof event !== "object") {
      return;
    }

    if (event.type === "session") {
      await appendText(
        transcriptPath,
        `# PI JSON Session\n\n- sessionId: ${event.id ?? "unknown"}\n- cwd: ${event.cwd ?? "unknown"}\n\n`
      );
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      assistantOpen = true;
      await appendText(transcriptPath, event.assistantMessageEvent.delta ?? "");
      return;
    }

    if (event.type === "message_end" && assistantOpen) {
      assistantOpen = false;
      await appendText(transcriptPath, "\n\n");
      return;
    }

    if (event.type === "tool_execution_start") {
      await appendText(
        transcriptPath,
        `\n[tool:start] ${event.toolName ?? "unknown"} ${JSON.stringify(event.args ?? {})}\n`
      );
      return;
    }

    if (event.type === "tool_execution_end") {
      await appendText(
        transcriptPath,
        `[tool:end] ${event.toolName ?? "unknown"} error=${event.isError ? "true" : "false"}\n`
      );
      return;
    }

    if (event.type === "auto_retry_start") {
      await appendText(
        transcriptPath,
        `\n[retry:start] attempt=${event.attempt}/${event.maxAttempts} delayMs=${event.delayMs}\n`
      );
      return;
    }

    if (event.type === "auto_retry_end") {
      await appendText(
        transcriptPath,
        `[retry:end] success=${event.success ? "true" : "false"}\n`
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
    throw new Error("use --pi-bin --prompt --transcript --events --stderr --session-file [--cwd <path>]");
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
    ensureFileParent(sessionFilePath)
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
      "Execute this SPORE session plan."
    ],
    {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"]
    }
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
          const event = JSON.parse(line);
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

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (stdoutBuffer.trim()) {
    const line = stdoutBuffer.trim();
    await appendText(eventsPath, `${line}\n`);
    try {
      const event = JSON.parse(line);
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
