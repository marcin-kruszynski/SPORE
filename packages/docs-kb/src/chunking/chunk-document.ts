import { MAX_CHUNK_CHARS, TARGET_CHUNK_CHARS } from "../metadata/constants.js";
import { normalizeWhitespace } from "../metadata/helpers.js";
import type { DocumentChunk } from "../types.js";

function createChunk(
  sectionTitle: string,
  content: string,
  order: number,
): DocumentChunk | null {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return null;
  }
  return {
    order,
    sectionTitle,
    text: normalized,
  };
}

function splitLargeChunk(
  sectionTitle: string,
  content: string,
  startOrder: number,
): DocumentChunk[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter((paragraph): paragraph is string => Boolean(paragraph));

  const chunks: DocumentChunk[] = [];
  let current = "";
  let order = startOrder;

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= TARGET_CHUNK_CHARS || current.length === 0) {
      current = candidate;
      continue;
    }

    const chunk = createChunk(sectionTitle, current, order);
    if (chunk) {
      chunks.push(chunk);
      order += 1;
    }
    current = paragraph;
  }

  if (current) {
    const chunk = createChunk(sectionTitle, current, order);
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

export function chunkDocument(text: string): DocumentChunk[] {
  const lines = text.split("\n");
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = "Document";
  let buffer: string[] = [];

  const flush = (): void => {
    const content = buffer.join("\n").trim();
    if (content) {
      sections.push({ title: currentTitle, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentTitle = headingMatch[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  const chunks: DocumentChunk[] = [];
  let order = 0;
  for (const section of sections) {
    if (section.content.length <= MAX_CHUNK_CHARS) {
      const chunk = createChunk(section.title, section.content, order);
      if (chunk) {
        chunks.push(chunk);
        order += 1;
      }
      continue;
    }

    for (const chunk of splitLargeChunk(
      section.title,
      section.content,
      order,
    )) {
      chunks.push(chunk);
      order = chunk.order + 1;
    }
  }

  return chunks;
}
