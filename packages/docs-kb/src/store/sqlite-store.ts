import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { relativeToProject } from "../metadata/helpers.js";
import type {
  DocsIndexStatus,
  EmbeddingProvider,
  EmbeddingVector,
  ExistingDocumentRecord,
  IndexedDocument,
  MetaValue,
  SearchChunkResult,
} from "../types.js";

interface MetaRow {
  key: string;
  value: string;
}

interface CountRow {
  count: number;
}

interface SearchRow {
  chunkId: string;
  path: string;
  sectionTitle: string;
  text: string;
  keywordBlob: string;
  vectorJson: string;
}

function serializeVector(vector: EmbeddingVector): string {
  return JSON.stringify(vector);
}

function deserializeVector(value: string): EmbeddingVector {
  return JSON.parse(value) as EmbeddingVector;
}

function cosineSimilarity(
  left: EmbeddingVector,
  right: EmbeddingVector,
): number {
  if (left.length !== right.length) {
    return 0;
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function runTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function ensureStoreDirectory(indexPath: string): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
}

export function openDatabase(indexPath: string): DatabaseSync {
  const db = new DatabaseSync(indexPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      chunk_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      path TEXT NOT NULL,
      chunk_order INTEGER NOT NULL,
      section_title TEXT NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      keyword_blob TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
  `);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function deleteDatabaseFile(indexPath: string): Promise<void> {
  return fs.rm(indexPath, { force: true });
}

export function deleteDatabaseWalFiles(
  indexPath: string,
): Promise<undefined[]> {
  return Promise.all([
    fs.rm(`${indexPath}-shm`, { force: true }),
    fs.rm(`${indexPath}-wal`, { force: true }),
  ]).then(() => [undefined, undefined]);
}

export function getExistingDocuments(
  db: DatabaseSync,
): Map<string, ExistingDocumentRecord> {
  const rows = db
    .prepare(
      "SELECT id, path, hash, modified_at AS modifiedAt, chunk_count AS chunkCount FROM documents",
    )
    .all() as unknown as ExistingDocumentRecord[];
  return new Map(rows.map((row) => [row.path, row]));
}

export function writeMeta(
  db: DatabaseSync,
  values: Record<string, MetaValue>,
): void {
  const statement = db.prepare(`
    INSERT INTO meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  runTransaction(db, () => {
    for (const [key, value] of Object.entries(values)) {
      statement.run(key, String(value));
    }
  });
}

export function readMeta(db: DatabaseSync): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM meta")
    .all() as unknown as MetaRow[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function removeDocumentsNotInSet(
  db: DatabaseSync,
  keepPaths: Set<string>,
): string[] {
  const rows = db.prepare("SELECT path FROM documents").all() as Array<{
    path: string;
  }>;
  const removable = rows
    .map((row) => row.path)
    .filter((current) => !keepPaths.has(current));
  if (removable.length === 0) {
    return [];
  }

  const deleteDocument = db.prepare("DELETE FROM documents WHERE path = ?");
  runTransaction(db, () => {
    for (const currentPath of removable) {
      deleteDocument.run(currentPath);
    }
  });
  return removable;
}

export function upsertDocuments(
  db: DatabaseSync,
  documents: IndexedDocument[],
  embeddingProvider: EmbeddingProvider,
): void {
  if (documents.length === 0) {
    return;
  }

  const upsertDocument = db.prepare(`
    INSERT INTO documents (id, path, hash, modified_at, chunk_count)
    VALUES (@id, @path, @hash, @modifiedAt, @chunkCount)
    ON CONFLICT(path) DO UPDATE SET
      id = excluded.id,
      hash = excluded.hash,
      modified_at = excluded.modified_at,
      chunk_count = excluded.chunk_count
  `);

  const deleteChunks = db.prepare("DELETE FROM chunks WHERE document_id = ?");
  const insertChunk = db.prepare(`
    INSERT INTO chunks (id, document_id, path, chunk_order, section_title, text, token_count, keyword_blob)
    VALUES (@id, @documentId, @path, @order, @sectionTitle, @text, @tokenCount, @keywordBlob)
  `);
  const insertEmbedding = db.prepare(`
    INSERT INTO embeddings (chunk_id, provider_id, dimensions, vector_json)
    VALUES (@chunkId, @providerId, @dimensions, @vectorJson)
    ON CONFLICT(chunk_id) DO UPDATE SET
      provider_id = excluded.provider_id,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json
  `);

  runTransaction(db, () => {
    for (const document of documents) {
      upsertDocument.run({
        id: document.id,
        path: document.path,
        hash: document.hash,
        modifiedAt: document.modifiedAt,
        chunkCount: document.chunkCount,
      });
      deleteChunks.run(document.id);
      for (const chunk of document.chunks) {
        insertChunk.run({
          id: chunk.id,
          documentId: document.id,
          path: chunk.path,
          order: chunk.order,
          sectionTitle: chunk.sectionTitle,
          text: chunk.text,
          tokenCount: chunk.tokens.length,
          keywordBlob: JSON.stringify(chunk.tokens),
        });
        insertEmbedding.run({
          chunkId: chunk.id,
          providerId: embeddingProvider.id,
          dimensions: embeddingProvider.dimensions,
          vectorJson: serializeVector(embeddingProvider.embed(chunk.text)),
        });
      }
    }
  });
}

export function getStatus(
  db: DatabaseSync,
  indexPath: string,
): DocsIndexStatus {
  const meta = readMeta(db);
  const documentCount = (
    db
      .prepare("SELECT COUNT(*) AS count FROM documents")
      .get() as unknown as CountRow
  ).count;
  const chunkCount = (
    db
      .prepare("SELECT COUNT(*) AS count FROM chunks")
      .get() as unknown as CountRow
  ).count;
  return {
    ok: true,
    indexed: documentCount > 0,
    indexPath: relativeToProject(indexPath),
    root: meta.root ?? "docs",
    generatedAt: meta.generatedAt ?? null,
    documentCount,
    chunkCount,
    provider: meta.embeddingProvider ?? null,
    indexMode: meta.indexMode ?? "unknown",
  };
}

export function searchChunks(
  db: DatabaseSync,
  queryVector: EmbeddingVector,
  queryTokens: string[],
  limit: number,
): SearchChunkResult[] {
  const rows = db
    .prepare(`
      SELECT
        chunks.id AS chunkId,
        chunks.path,
        chunks.section_title AS sectionTitle,
        chunks.text,
        chunks.keyword_blob AS keywordBlob,
        embeddings.vector_json AS vectorJson
      FROM chunks
      JOIN embeddings ON embeddings.chunk_id = chunks.id
    `)
    .all() as unknown as SearchRow[];

  return rows
    .map((row) => {
      const tokens = JSON.parse(row.keywordBlob) as string[];
      let keywordScore = 0;
      for (const token of queryTokens) {
        keywordScore +=
          tokens.filter((current) => current === token).length * 5;
        if (row.sectionTitle.toLowerCase().includes(token)) {
          keywordScore += 3;
        }
        if (row.path.toLowerCase().includes(token)) {
          keywordScore += 2;
        }
      }
      const semanticScore = cosineSimilarity(
        queryVector,
        deserializeVector(row.vectorJson),
      );
      const blendedScore = keywordScore + semanticScore * 10;
      return {
        chunkId: row.chunkId,
        path: row.path,
        sectionTitle: row.sectionTitle,
        text: row.text,
        keywordScore,
        semanticScore,
        score: blendedScore,
      };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
    )
    .slice(0, limit);
}
