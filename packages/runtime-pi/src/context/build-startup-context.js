import fs from "node:fs/promises";
import path from "node:path";

import { getDefaultEmbeddingProvider } from "../../../docs-kb/src/embeddings/provider-registry.js";
import { buildExcerpt, tokenize } from "../../../docs-kb/src/metadata/helpers.js";
import {
  DEFAULT_INDEX_PATH
} from "../../../docs-kb/src/metadata/constants.js";
import {
  ensureStoreDirectory,
  getStatus,
  openDatabase,
  searchChunks
} from "../../../docs-kb/src/store/sqlite-store.js";
import { PROJECT_ROOT } from "../metadata/constants.js";

function relativeToProject(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function resolvePath(filePath, fallback) {
  const target = filePath ?? fallback;
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

export async function buildStartupContext(plan, options = {}) {
  const indexPath = resolvePath(options.indexPath, DEFAULT_INDEX_PATH);
  await ensureStoreDirectory(indexPath);
  const db = openDatabase(indexPath);
  try {
    const status = getStatus(db, indexPath);
    if (!status.indexed) {
      return {
        query: null,
        results: [],
        note: "docs-kb index not available"
      };
    }

    const query = plan.retrieval?.query ?? [
      plan.session.role,
      plan.session.domainId ?? "",
      plan.session.workflowId ?? "",
      plan.project?.type ?? "",
      plan.runtime,
      ...((plan.retrieval?.queryTerms ?? []).filter(Boolean)),
      "session workflow docs"
    ]
      .filter(Boolean)
      .join(" ");
    const provider = getDefaultEmbeddingProvider();
    const tokens = tokenize(query);
    const results = searchChunks(
      db,
      provider.embed(query),
      tokens,
      options.limit ?? plan.retrieval?.limit ?? 5
    ).map(
      (result) => ({
        path: result.path,
        sectionTitle: result.sectionTitle,
        score: Number(result.score.toFixed(3)),
        excerpt: buildExcerpt(result.text, tokens)
      })
    );
    return { query, results, note: null };
  } finally {
    db.close();
  }
}

export async function writeStartupContext(plan, outputPath, options = {}) {
  const context = await buildStartupContext(plan, options);
  const resolved = resolvePath(outputPath, outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const payload = {
    sessionId: plan.session.id,
    runId: plan.session.runId,
    generatedAt: new Date().toISOString(),
    planSources: plan.metadata.sourceFiles,
    contextFiles: plan.pi.contextFiles,
    session: {
      role: plan.session.role,
      domainId: plan.session.domainId ?? null,
      workflowId: plan.session.workflowId ?? null,
      sessionMode: plan.session.sessionMode
    },
    retrieval: context
  };
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    path: relativeToProject(resolved),
    payload
  };
}
