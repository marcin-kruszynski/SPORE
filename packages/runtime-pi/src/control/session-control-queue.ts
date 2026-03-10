import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "../metadata/constants.js";

export function getSessionControlPath(sessionId) {
  return path.join(
    PROJECT_ROOT,
    "tmp",
    "sessions",
    `${sessionId}.control.ndjson`,
  );
}

export async function appendControlMessage(sessionId, payload) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId,
    payload,
  };
  const targetPath = getSessionControlPath(sessionId);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.appendFile(targetPath, `${JSON.stringify(entry)}\n`, "utf8");
  return {
    path: targetPath,
    entry,
  };
}

export async function readControlMessagesFromOffset(
  controlPathOrSessionId,
  offset = 0,
) {
  const targetPath = controlPathOrSessionId.endsWith(".ndjson")
    ? controlPathOrSessionId
    : getSessionControlPath(controlPathOrSessionId);

  let handle = null;
  try {
    handle = await fs.open(targetPath, "r");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        nextOffset: 0,
        entries: [],
      };
    }
    throw error;
  }

  try {
    const stats = await handle.stat();
    if (stats.size <= offset) {
      return {
        nextOffset: stats.size,
        entries: [],
      };
    }

    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const entries = buffer
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return {
      nextOffset: stats.size,
      entries,
    };
  } finally {
    await handle.close();
  }
}
