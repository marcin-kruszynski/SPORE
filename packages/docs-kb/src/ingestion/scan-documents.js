import fs from "node:fs/promises";
import path from "node:path";

import { chunkDocument } from "../chunking/chunk-document.js";
import { SUPPORTED_EXTENSIONS } from "../metadata/constants.js";
import {
  relativeToProject,
  sha1,
  stripFrontmatter,
  tokenize
} from "../metadata/helpers.js";

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
      continue;
    }
    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

export async function scanDocuments(rootPath) {
  const absoluteFiles = await walk(rootPath);
  const documents = [];

  for (const absolutePath of absoluteFiles.sort()) {
    const source = await fs.readFile(absolutePath, "utf8");
    const content = stripFrontmatter(source);
    const relativePath = relativeToProject(absolutePath);
    const stats = await fs.stat(absolutePath);
    const chunks = chunkDocument(content).map((chunk) => ({
      id: sha1(`${relativePath}:${chunk.order}:${chunk.sectionTitle}`),
      path: relativePath,
      order: chunk.order,
      sectionTitle: chunk.sectionTitle,
      text: chunk.text,
      tokens: tokenize(chunk.text)
    }));

    documents.push({
      id: sha1(relativePath),
      path: relativePath,
      hash: sha1(source),
      modifiedAt: stats.mtime.toISOString(),
      chunkCount: chunks.length,
      chunks
    });
  }

  return documents;
}
