#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { readControlMessagesFromOffset } from "../control/session-control-queue.js";
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

async function writeJsonFile(filePath, value) {
  await ensureFileParent(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendJsonLine(filePath, value) {
  await appendText(filePath, `${JSON.stringify(value)}\n`);
}

function createTranscriptRenderer(transcriptPath) {
  let assistantOpen = false;

  return async function renderEvent(event) {
    if (!event || typeof event !== "object") {
      return;
    }

    if (event.type === "response") {
      if (event.command === "abort") {
        await appendText(transcriptPath, `\n[rpc:abort acknowledged]\n`);
      }
      return;
    }

    if (event.type === "agent_start") {
      await appendText(transcriptPath, `\n[agent:start]\n`);
      return;
    }

    if (event.type === "agent_end") {
      await appendText(transcriptPath, `\n\n[agent:end]\n`);
      return;
    }

    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
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

    if (event.type === "tool_execution_update") {
      const text = event.partialResult?.content
        ?.filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("") ?? "";
      if (text) {
        await appendText(transcriptPath, `[tool:update] ${event.toolName ?? "unknown"}: ${text}\n`);
      }
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

function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      onLine(line);
    }
  });

  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      onLine(line);
    }
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (
    !flags["pi-bin"] ||
    !flags.prompt ||
    !flags.transcript ||
    !flags.events ||
    !flags.stderr ||
    !flags["session-file"] ||
    !flags.control ||
    !flags["status-file"]
  ) {
    throw new Error(
      "use --pi-bin --prompt --transcript --events --stderr --session-file --control --status-file [--cwd <path>]"
    );
  }

  const piBinary = resolvePath(flags["pi-bin"]);
  const promptPath = resolvePath(flags.prompt);
  const transcriptPath = resolvePath(flags.transcript);
  const eventsPath = resolvePath(flags.events);
  const stderrPath = resolvePath(flags.stderr);
  const sessionFilePath = resolvePath(flags["session-file"]);
  const controlPath = resolvePath(flags.control);
  const statusPath = resolvePath(flags["status-file"]);
  const workingDirectory = flags.cwd ? resolvePath(flags.cwd) : PROJECT_ROOT;
  const idleGraceMs = Number.parseInt(String(flags["idle-grace-ms"] ?? "1500"), 10);
  const pollIntervalMs = Number.parseInt(String(flags["poll-ms"] ?? "1000"), 10);

  await Promise.all([
    ensureFileParent(transcriptPath),
    ensureFileParent(eventsPath),
    ensureFileParent(stderrPath),
    ensureFileParent(sessionFilePath),
    ensureFileParent(controlPath),
    ensureFileParent(statusPath)
  ]);
  await Promise.all([
    fs.writeFile(stderrPath, "", { flag: "a" }),
    fs.writeFile(eventsPath, "", { flag: "a" }),
    fs.writeFile(sessionFilePath, "", { flag: "a" }),
    fs.writeFile(controlPath, "", { flag: "a" })
  ]);

  const promptText = await fs.readFile(promptPath, "utf8");
  const renderEvent = createTranscriptRenderer(transcriptPath);
  const state = {
    runner: "pi-rpc-runner",
    status: "starting",
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    controlPath: path.relative(PROJECT_ROOT, controlPath),
    sessionArtifactPath: path.relative(PROJECT_ROOT, sessionFilePath),
    cwd: path.relative(PROJECT_ROOT, workingDirectory),
    lastEventAt: null,
    sawAgentEnd: false,
    abortRequested: false,
    idleSince: null,
    rpcState: null
  };

  async function flushStatus() {
    await writeJsonFile(statusPath, state);
  }

  const child = spawn(piBinary, ["--mode", "rpc", "--no-session"], {
    cwd: workingDirectory,
    stdio: ["pipe", "pipe", "pipe"]
  });
  state.pid = child.pid ?? null;
  await flushStatus();

  const pendingResponses = new Map();
  let requestId = 0;
  let shuttingDown = false;
  let controlOffset = 0;
  let childExitCode = null;
  let syntheticExitCode = 0;

  function nextId(prefix) {
    requestId += 1;
    return `${prefix}-${requestId}`;
  }

  async function send(command) {
    const id = command.id ?? nextId(command.type);
    const body = { ...command, id };
    await appendJsonLine(sessionFilePath, {
      timestamp: new Date().toISOString(),
      type: "rpc_command",
      command: body
    });

    return new Promise((resolve, reject) => {
      pendingResponses.set(id, { resolve, reject, command: body.type });
      child.stdin.write(`${JSON.stringify(body)}\n`, (error) => {
        if (error) {
          pendingResponses.delete(id);
          reject(error);
        }
      });
    });
  }

  async function handleResponse(payload) {
    const pending = payload.id ? pendingResponses.get(payload.id) : null;
    if (pending && payload.id) {
      pendingResponses.delete(payload.id);
      if (payload.success === false) {
        pending.reject(new Error(payload.error?.message ?? `RPC command failed: ${payload.command}`));
      } else {
        pending.resolve(payload);
      }
    }

    if (payload.command === "get_state" && payload.success) {
      state.rpcState = payload.data ?? null;
      state.lastEventAt = new Date().toISOString();
      if (payload.data?.isStreaming) {
        state.idleSince = null;
      }
      await appendJsonLine(sessionFilePath, {
        timestamp: new Date().toISOString(),
        type: "state_snapshot",
        data: payload.data ?? null
      });
      await flushStatus();
    }

    if (payload.command === "get_messages" && payload.success) {
      await appendJsonLine(sessionFilePath, {
        timestamp: new Date().toISOString(),
        type: "messages_snapshot",
        data: payload.data ?? null
      });
    }
  }

  attachJsonlReader(child.stdout, (line) => {
    const task = (async () => {
      if (!line.trim()) {
        return;
      }
      await appendText(eventsPath, `${line}\n`);
      let payload = null;
      try {
        payload = JSON.parse(line);
      } catch {
        await appendText(transcriptPath, `${line}\n`);
        return;
      }

      state.lastEventAt = new Date().toISOString();

      if (payload.type === "response") {
        await handleResponse(payload);
      } else {
        if (payload.type === "agent_start") {
          state.status = "streaming";
          state.idleSince = null;
        }
        if (payload.type === "agent_end") {
          state.sawAgentEnd = true;
          state.status = "idle-check";
          state.idleSince = new Date().toISOString();
          await appendJsonLine(sessionFilePath, {
            timestamp: new Date().toISOString(),
            type: "agent_end",
            data: {
              messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
              messages: payload.messages ?? []
            }
          });
        }
        if (payload.type === "message_end") {
          await appendJsonLine(sessionFilePath, {
            timestamp: new Date().toISOString(),
            type: "message",
            data: payload.message ?? null
          });
        }
      }

      await renderEvent(payload);
      await flushStatus();
    })().catch(async (error) => {
      await appendText(stderrPath, `rpc-runner stdout handler error: ${error.message}\n`);
    });
    return task;
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    const task = (async () => {
      await appendText(stderrPath, text);
      await appendText(transcriptPath, `\n[stderr]\n${text}\n`);
    })().catch(() => {});
    return task;
  });

  child.on("exit", (code) => {
    childExitCode = code ?? (shuttingDown ? syntheticExitCode : 1);
    for (const pending of pendingResponses.values()) {
      pending.reject(new Error(`pi rpc process exited with code ${childExitCode}`));
    }
    pendingResponses.clear();
  });

  async function stopChild() {
    if (child.exitCode !== null || child.killed) {
      return;
    }
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(1000).then(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
        }
      })
    ]);
  }

  async function finalize() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(controlTimer);
    clearInterval(idleTimer);
    try {
      await send({ type: "get_messages" });
    } catch (error) {
      await appendText(stderrPath, `get_messages failed during finalize: ${error.message}\n`);
    }
    await stopChild();
    state.status = syntheticExitCode === 0 ? "completed" : "aborted";
    state.finishedAt = new Date().toISOString();
    await flushStatus();
    process.exitCode = childExitCode ?? syntheticExitCode;
  }

  async function dispatchControlEntry(entry) {
    const payload = entry.payload ?? {};
    await appendJsonLine(sessionFilePath, {
      timestamp: new Date().toISOString(),
      type: "control_entry",
      data: entry
    });

    if (payload.action === "steer") {
      await send({ type: "steer", message: payload.message ?? "" });
      return;
    }

    if (payload.action === "follow_up") {
      await send({ type: "follow_up", message: payload.message ?? "" });
      return;
    }

    if (payload.action === "prompt") {
      await send({
        type: "prompt",
        message: payload.message ?? "",
        streamingBehavior: payload.streamingBehavior ?? "followUp"
      });
      return;
    }

    if (payload.action === "abort" || payload.action === "stop") {
      syntheticExitCode = 130;
      state.abortRequested = true;
      await send({ type: "abort" });
      return;
    }

    if (payload.action === "get_state") {
      await send({ type: "get_state" });
    }
  }

  const controlTimer = setInterval(() => {
    const task = (async () => {
      const chunk = await readControlMessagesFromOffset(controlPath, controlOffset);
      controlOffset = chunk.nextOffset;
      for (const entry of chunk.entries) {
        await dispatchControlEntry(entry);
      }
    })().catch(async (error) => {
      await appendText(stderrPath, `control watcher error: ${error.message}\n`);
    });
    return task;
  }, pollIntervalMs);

  const idleTimer = setInterval(() => {
    const task = (async () => {
      if (shuttingDown) {
        return;
      }
      let snapshot = null;
      try {
        snapshot = await send({ type: "get_state" });
      } catch (error) {
        await appendText(stderrPath, `get_state poll error: ${error.message}\n`);
        return;
      }
      const data = snapshot.data ?? null;
      const isStreaming = Boolean(data?.isStreaming);
      const pendingMessageCount = Number.parseInt(String(data?.pendingMessageCount ?? "0"), 10);
      if (!isStreaming && state.sawAgentEnd) {
        if (!state.idleSince) {
          state.idleSince = new Date().toISOString();
        }
        const idleSinceMs = Date.parse(state.idleSince);
        if (Date.now() - idleSinceMs >= idleGraceMs) {
          await finalize();
        }
        return;
      }
      if (!isStreaming && pendingMessageCount === 0) {
        if (!state.idleSince) {
          state.idleSince = new Date().toISOString();
        }
        const idleSinceMs = Date.parse(state.idleSince);
        if (Date.now() - idleSinceMs >= idleGraceMs) {
          await finalize();
        }
      } else {
        state.idleSince = null;
      }
    })().catch(async (error) => {
      await appendText(stderrPath, `idle watcher error: ${error.message}\n`);
    });
    return task;
  }, pollIntervalMs);

  process.on("SIGINT", async () => {
    syntheticExitCode = 130;
    try {
      await send({ type: "abort" });
    } catch {}
    await finalize();
  });

  process.on("SIGTERM", async () => {
    syntheticExitCode = 143;
    try {
      await send({ type: "abort" });
    } catch {}
    await finalize();
  });

  await appendText(transcriptPath, "# PI RPC Session\n\n");
  await send({ type: "get_state" });
  await send({ type: "prompt", message: promptText });
  state.status = "prompt-sent";
  await flushStatus();

  const exitCode = await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (shuttingDown && (childExitCode !== null || child.killed)) {
        clearInterval(timer);
        resolve(childExitCode ?? syntheticExitCode);
      }
    }, 200);
    child.on("exit", (code) => {
      if (!shuttingDown) {
        syntheticExitCode = code ?? 1;
        finalize().finally(() => {
          clearInterval(timer);
          resolve(code ?? 1);
        });
        return;
      }
      clearInterval(timer);
      resolve(code ?? syntheticExitCode);
    });
  });

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`pi-rpc-runner error: ${error.message}`);
  process.exitCode = 1;
});
