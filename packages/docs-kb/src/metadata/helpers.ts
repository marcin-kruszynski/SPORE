import crypto from "node:crypto";
import path from "node:path";

import { PROJECT_ROOT } from "./constants.js";

export function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function relativeToProject(absolutePath: string): string {
  return path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join("/");
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return text;
  }
  return text.slice(end + 5);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function countOccurrences(text: string, token: string): number {
  if (!token) {
    return 0;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, "gi"));
  return matches ? matches.length : 0;
}

export function buildExcerpt(text: string, tokens: string[]): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  const hit = lines.find((line) =>
    lowerTokens.some((token) => line.toLowerCase().includes(token)),
  );
  const excerpt = hit ?? lines[0];
  return excerpt.length > 220 ? `${excerpt.slice(0, 217)}...` : excerpt;
}
