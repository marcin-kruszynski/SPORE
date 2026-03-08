import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { getDefaultEmbeddingProvider } from "../../../packages/docs-kb/src/embeddings/provider-registry.js";
import { sha1, tokenize } from "../../../packages/docs-kb/src/metadata/helpers.js";
import {
  openDatabase,
  upsertDocuments,
  writeMeta
} from "../../../packages/docs-kb/src/store/sqlite-store.js";
import { planWorkflowInvocation } from "../../orchestrator/src/invocation/plan-workflow-invocation.js";
import { writeStartupContext } from "../src/context/build-startup-context.js";
import { PROJECT_ROOT } from "../src/metadata/constants.js";
import { buildSessionPlan } from "../src/planner/build-session-plan.js";

async function makeTempDir(prefix) {
  const root = path.join(PROJECT_ROOT, "tmp");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, prefix));
}

async function createIndexedDocsDb(indexPath, text) {
  const provider = getDefaultEmbeddingProvider();
  const db = openDatabase(indexPath);
  try {
    writeMeta(db, {
      root: "docs",
      generatedAt: "2026-03-08T00:00:00.000Z",
      embeddingProvider: provider.id,
      indexMode: "test"
    });
    upsertDocuments(
      db,
      [
        {
          id: "doc-backend-policy",
          path: "docs/test/backend-policy.md",
          hash: sha1(text),
          modifiedAt: "2026-03-08T00:00:00.000Z",
          chunkCount: 1,
          chunks: [
            {
              id: "chunk-backend-policy-1",
              path: "docs/test/backend-policy.md",
              order: 0,
              sectionTitle: "Backend Policy",
              text,
              tokens: tokenize(text)
            }
          ]
        }
      ],
      provider
    );
  } finally {
    db.close();
  }
}

test("planned domain policy becomes runtime retrieval inputs and startup context", async (t) => {
  const tempRoot = await makeTempDir("runtime-policy-");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["reviewer"],
    invocationId: "test-runtime-policy-propagation",
    objective: "Verify runtime context policy propagation"
  });
  const launch = invocation.launches[0];

  const plan = await buildSessionPlan({
    profilePath: launch.profilePath,
    projectPath: invocation.project.path,
    domainId: launch.domainId,
    workflowId: invocation.workflow.id,
    sessionId: launch.sessionId,
    runId: launch.runId,
    sessionMode: launch.sessionMode,
    contextQuery: launch.policy.docsKbPolicy.query,
    contextQueryTerms: launch.policy.docsKbPolicy.queryTerms,
    contextLimit: launch.policy.docsKbPolicy.resultLimit
  });

  assert.equal(plan.session.id, launch.sessionId);
  assert.equal(plan.session.runId, launch.runId);
  assert.equal(plan.session.domainId, invocation.domain.id);
  assert.equal(plan.session.workflowId, invocation.workflow.id);
  assert.equal(plan.session.sessionMode, launch.sessionMode);
  assert.equal(plan.retrieval.query, launch.policy.docsKbPolicy.query);
  assert.deepEqual(plan.retrieval.queryTerms, launch.policy.docsKbPolicy.queryTerms);
  assert.equal(plan.retrieval.limit, launch.policy.docsKbPolicy.resultLimit);

  const indexPath = path.join(tempRoot, "docs-index.sqlite");
  await createIndexedDocsDb(
    indexPath,
    `${launch.policy.docsKbPolicy.query} review policy session workflow docs`
  );

  const contextPath = path.join(tempRoot, "reviewer.context.json");
  const written = await writeStartupContext(plan, contextPath, {
    indexPath,
    limit: plan.retrieval.limit
  });

  assert.equal(written.payload.session.role, plan.session.role);
  assert.equal(written.payload.session.domainId, plan.session.domainId);
  assert.equal(written.payload.session.workflowId, plan.session.workflowId);
  assert.equal(written.payload.session.sessionMode, plan.session.sessionMode);
  assert.equal(written.payload.retrieval.query, plan.retrieval.query);
  assert.equal(written.payload.retrieval.note, null);
  assert.ok(written.payload.retrieval.results.length >= 1);
  assert.equal(written.payload.retrieval.results[0].path, "docs/test/backend-policy.md");

  const rawContext = JSON.parse(await fs.readFile(contextPath, "utf8"));
  assert.equal(rawContext.session.domainId, invocation.domain.id);
  assert.equal(rawContext.session.workflowId, invocation.workflow.id);
  assert.equal(rawContext.session.sessionMode, launch.sessionMode);
  assert.equal(rawContext.retrieval.query, launch.policy.docsKbPolicy.query);
});
