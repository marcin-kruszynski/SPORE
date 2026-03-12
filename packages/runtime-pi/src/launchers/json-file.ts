import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function ensureFileParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureFileParent(filePath);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
