import { MAX_CHUNK_CHARS, TARGET_CHUNK_CHARS } from "../metadata/constants.js";
import { normalizeWhitespace } from "../metadata/helpers.js";

function createChunk(sectionTitle, content, order) {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return null;
  }
  return {
    order,
    sectionTitle,
    text: normalized
  };
}

function splitLargeChunk(sectionTitle, content, startOrder) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);

  const chunks = [];
  let current = "";
  let order = startOrder;

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= TARGET_CHUNK_CHARS || current.length === 0) {
      current = candidate;
      continue;
    }

    chunks.push(createChunk(sectionTitle, current, order));
    order += 1;
    current = paragraph;
  }

  if (current) {
    chunks.push(createChunk(sectionTitle, current, order));
  }

  return chunks.filter(Boolean);
}

export function chunkDocument(text) {
  const lines = text.split("\n");
  const sections = [];
  let currentTitle = "Document";
  let buffer = [];

  const flush = () => {
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

  const chunks = [];
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

    for (const chunk of splitLargeChunk(section.title, section.content, order)) {
      chunks.push(chunk);
      order = chunk.order + 1;
    }
  }

  return chunks;
}
