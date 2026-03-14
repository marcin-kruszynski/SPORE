import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "../metadata/constants.js";

const AGENT_SEGMENT_PATTERN = /\[agent:start\]([\s\S]*?)\[agent:end\]/g;
const STUB_SEGMENT_PATTERN =
  /\[stub:agent-output:start\]([\s\S]*?)\[stub:agent-output:end\]/g;

const TOOL_TRACE_LINE_PATTERN =
  /^\[(tool:(start|update|end)|retry:(start|end)|rpc:abort acknowledged)\]/;

function asRelativeProjectPath(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function resolveProjectPath(filePath: string | null | undefined): string | null {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
}

function collectSegments(pattern: RegExp, input: string): string[] {
  const matches = [];
  for (const match of input.matchAll(pattern)) {
    const segment = String(match[1] ?? "").trim();
    if (segment) {
      matches.push(segment);
    }
  }
  return matches;
}

export async function readSessionTranscript(transcriptPath: string | null | undefined) {
  const resolved = resolveProjectPath(transcriptPath);
  if (!resolved) {
    return null;
  }
  try {
    return await fs.readFile(resolved, "utf8");
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === "ENOENT") {
      return null;
    }
    throw typedError;
  }
}

export function extractAgentOutputSegment(transcript: string | null) {
  if (!transcript) {
    return "";
  }
  const agentSegments = collectSegments(AGENT_SEGMENT_PATTERN, transcript);
  if (agentSegments.length > 0) {
    return stripAutomationTrace(agentSegments.at(-1) ?? "");
  }
  const stubSegments = collectSegments(STUB_SEGMENT_PATTERN, transcript);
  if (stubSegments.length > 0) {
    return stripAutomationTrace(stubSegments.at(-1) ?? "");
  }
  return "";
}

export function extractStructuredHandoffBlock(
  output: string,
  marker = "SPORE_HANDOFF_JSON",
) {
  const beginToken = `[${marker}_BEGIN]`;
  const endToken = `[${marker}_END]`;
  const pattern = new RegExp(
    `\\[${marker}_BEGIN\\]([\\s\\S]*?)\\[${marker}_END\\]`,
  );
  const match = output.match(pattern);
  if (match) {
    const raw = String(match[1] ?? "").trim();
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const beginIndex = output.indexOf(beginToken);
  const endIndex = output.indexOf(endToken, beginIndex + beginToken.length);
  if (beginIndex === -1 || endIndex !== -1) {
    return null;
  }

  const raw = output.slice(beginIndex + beginToken.length).trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasStructuredHandoffMarker(
  output: string,
  marker = "SPORE_HANDOFF_JSON",
) {
  const beginToken = `[${marker}_BEGIN]`;
  const pattern = new RegExp(
    `\\[${marker}_BEGIN\\]([\\s\\S]*?)\\[${marker}_END\\]`,
  );
  return pattern.test(output) || output.includes(beginToken);
}

export function fallbackHandoffSummary(output: string, role: string) {
  const trimmed = stripStructuredHandoffBlock(output).trim();
  const firstParagraph = trimmed.split(/\n\s*\n/)[0]?.trim() ?? "";
  const excerpt = firstParagraph.slice(0, 240);
  return {
    title: `${role} handoff`,
    objective: null,
    outcome: excerpt || "No structured handoff content was captured.",
    confidence: "low",
  };
}

export function sessionHandoffArtifactAbsolutePath(sessionId: string) {
  return path.join(PROJECT_ROOT, "tmp", "sessions", `${sessionId}.handoff.json`);
}

export async function writeSessionHandoffArtifact(sessionId: string, payload: unknown) {
  const absolutePath = sessionHandoffArtifactAbsolutePath(sessionId);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    absolutePath,
    relativePath: asRelativeProjectPath(absolutePath),
  };
}

function stripAutomationTrace(output: string) {
  const lines = output.split(/\r?\n/);
  const cleaned: string[] = [];
  let skippingToolUpdate = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (TOOL_TRACE_LINE_PATTERN.test(trimmed)) {
      skippingToolUpdate = trimmed.startsWith("[tool:update]");
      continue;
    }
    if (skippingToolUpdate) {
      if (trimmed.startsWith("[")) {
        skippingToolUpdate = false;
      } else if (looksLikeHumanSummaryLine(trimmed)) {
        skippingToolUpdate = false;
      } else {
        continue;
      }
    }
    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeHumanSummaryLine(line: string) {
  if (!line) {
    return false;
  }
  const wordCount = line.split(/\s+/).filter(Boolean).length;
  return wordCount >= 5 || /[.?!:]$/.test(line);
}

function stripStructuredHandoffBlock(output: string, marker = "SPORE_HANDOFF_JSON") {
  const pattern = new RegExp(
    `\\[${marker}_BEGIN\\][\\s\\S]*?\\[${marker}_END\\]`,
    "g",
  );
  return output.replace(pattern, "").trim();
}
