#!/usr/bin/env node
import path from "node:path";
import {
  getDefaultEmbeddingProvider,
  getEmbeddingProvider,
} from "../embeddings/provider-registry.js";
import { scanDocuments } from "../ingestion/scan-documents.js";
import {
  DEFAULT_DOCS_ROOT,
  DEFAULT_INDEX_PATH,
  PROJECT_ROOT,
} from "../metadata/constants.js";
import {
  buildExcerpt,
  relativeToProject,
  tokenize,
} from "../metadata/helpers.js";
import {
  deleteDatabaseFile,
  deleteDatabaseWalFiles,
  ensureStoreDirectory,
  getExistingDocuments,
  getStatus,
  openDatabase,
  removeDocumentsNotInSet,
  searchChunks,
  upsertDocuments,
  writeMeta,
} from "../store/sqlite-store.js";
import type {
  CliParsedArgs,
  DocsIndexStatus,
  SearchChunkResult,
} from "../types.js";

function printHelp(): void {
  console.log(`docs-kb <command> [options]

Commands:
  index            Build or incrementally refresh the local documentation index
  rebuild          Rebuild the local documentation index from scratch
  search <query>   Search indexed documentation
  status           Show index metadata

Options:
  --root <path>    Override the indexed docs root (default: docs)
  --index <path>   Override the index file path
  --provider <id>  Embedding provider id (default: local-hash-v1)
  --json           Emit JSON output
  --limit <n>      Limit search results (default: 10)`);
}

function parseArgs(argv: string[]): CliParsedArgs {
  const positional: string[] = [];
  const flags: CliParsedArgs["flags"] = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (key === "json") {
      flags.json = true;
      continue;
    }

    const value = argv[index + 1];
    flags[key] = value;
    index += 1;
  }

  return { positional, flags };
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolvePath(
  input: string | boolean | undefined,
  fallback: string,
): string {
  const resolvedInput = asString(input);
  if (!resolvedInput) {
    return fallback;
  }
  return path.isAbsolute(resolvedInput)
    ? resolvedInput
    : path.join(PROJECT_ROOT, resolvedInput);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleIndex(flags: CliParsedArgs["flags"]): Promise<void> {
  const docsRoot = resolvePath(flags.root, DEFAULT_DOCS_ROOT);
  const indexPath = resolvePath(flags.index, DEFAULT_INDEX_PATH);
  const embeddingProvider = getEmbeddingProvider(
    asString(flags.provider) ?? getDefaultEmbeddingProvider().id,
  );
  const documents = await scanDocuments(docsRoot);
  await ensureStoreDirectory(indexPath);
  const db = openDatabase(indexPath);
  let changedDocuments = documents;
  let deletedPaths: string[] = [];
  let chunkCount = 0;
  const generatedAt = new Date().toISOString();
  try {
    const existingDocuments = getExistingDocuments(db);
    const seenPaths = new Set(documents.map((document) => document.path));
    changedDocuments = documents.filter((document) => {
      const existing = existingDocuments.get(document.path);
      return !existing || existing.hash !== document.hash;
    });
    deletedPaths = removeDocumentsNotInSet(db, seenPaths);
    upsertDocuments(db, changedDocuments, embeddingProvider);
    chunkCount = documents.reduce(
      (sum, document) => sum + document.chunkCount,
      0,
    );
    writeMeta(db, {
      version: 2,
      root: relativeToProject(docsRoot),
      generatedAt,
      embeddingProvider: embeddingProvider.id,
      indexMode: "incremental",
      documentCount: documents.length,
      chunkCount,
    });
  } finally {
    db.close();
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          indexPath: relativeToProject(indexPath),
          root: relativeToProject(docsRoot),
          generatedAt,
          embeddingProvider: embeddingProvider.id,
          documentCount: documents.length,
          chunkCount,
          changedDocuments: changedDocuments.length,
          deletedDocuments: deletedPaths.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Indexed ${documents.length} documents into ${relativeToProject(indexPath)}.`,
  );
  console.log(`Chunks: ${chunkCount}`);
  console.log(`Changed documents: ${changedDocuments.length}`);
  console.log(`Deleted documents: ${deletedPaths.length}`);
  console.log(`Embedding provider: ${embeddingProvider.id}`);
}

async function handleRebuild(flags: CliParsedArgs["flags"]): Promise<void> {
  const indexPath = resolvePath(flags.index, DEFAULT_INDEX_PATH);
  await deleteDatabaseFile(indexPath);
  await deleteDatabaseWalFiles(indexPath);
  await handleIndex(flags);
}

async function handleSearch(
  query: string,
  flags: CliParsedArgs["flags"],
): Promise<void> {
  if (!query) {
    throw new Error("search requires a query string");
  }

  const indexPath = resolvePath(flags.index, DEFAULT_INDEX_PATH);
  await ensureStoreDirectory(indexPath);
  const db = openDatabase(indexPath);
  let results: Array<
    SearchChunkResult & {
      excerpt: string;
    }
  > = [];
  try {
    const status = getStatus(db, indexPath);
    if (!status.indexed) {
      throw new Error(
        `index file not found at ${relativeToProject(indexPath)}. Run 'docs-kb index' first.`,
      );
    }
    const queryTokens = tokenize(query);
    const limit = Number.parseInt(asString(flags.limit) ?? "10", 10);
    const embeddingProvider = getEmbeddingProvider(
      asString(flags.provider) ??
        status.provider ??
        getDefaultEmbeddingProvider().id,
    );
    const queryVector = embeddingProvider.embed(query);
    results = searchChunks(db, queryVector, queryTokens, limit).map(
      (result) => ({
        ...result,
        score: Number(result.score.toFixed(3)),
        semanticScore: Number(result.semanticScore.toFixed(3)),
        excerpt: buildExcerpt(result.text, queryTokens),
      }),
    );
  } finally {
    db.close();
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          query,
          resultCount: results.length,
          results,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (results.length === 0) {
    console.log(`No results for "${query}".`);
    return;
  }

  console.log(`Results for "${query}":`);
  for (const [indexResult, result] of results.entries()) {
    console.log(
      `${indexResult + 1}. ${result.path} :: ${result.sectionTitle} (score ${result.score})`,
    );
    if (result.excerpt) {
      console.log(`   ${result.excerpt}`);
    }
  }
}

async function handleStatus(flags: CliParsedArgs["flags"]): Promise<void> {
  const indexPath = resolvePath(flags.index, DEFAULT_INDEX_PATH);
  await ensureStoreDirectory(indexPath);
  const db = openDatabase(indexPath);
  let payload: DocsIndexStatus;
  try {
    payload = getStatus(db, indexPath);
  } finally {
    db.close();
  }

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!payload.indexed) {
    console.log(`No docs index found at ${payload.indexPath}.`);
    return;
  }

  console.log(`Index path: ${payload.indexPath}`);
  console.log(`Docs root: ${payload.root}`);
  console.log(`Generated: ${payload.generatedAt}`);
  console.log(`Documents: ${payload.documentCount}`);
  console.log(`Chunks: ${payload.chunkCount}`);
  console.log(`Embedding provider: ${payload.provider}`);
  console.log(`Mode: ${payload.indexMode}`);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "index") {
    await handleIndex(flags);
    return;
  }

  if (command === "rebuild") {
    await handleRebuild(flags);
    return;
  }

  if (command === "search") {
    await handleSearch(positional.slice(1).join(" "), flags);
    return;
  }

  if (command === "status") {
    await handleStatus(flags);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(`docs-kb error: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
