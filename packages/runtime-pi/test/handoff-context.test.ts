import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  getDefaultEmbeddingProvider,
  openDatabase,
  sha1,
  tokenize,
  upsertDocuments,
  writeMeta,
} from "@spore/docs-kb";
import {
  buildSessionPlan,
  PROJECT_ROOT,
  writeStartupContext,
} from "@spore/runtime-pi";

async function makeTempDir(prefix: string) {
  const root = path.join(PROJECT_ROOT, "tmp");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, prefix));
}

async function createIndexedDocsDb(indexPath: string, text: string) {
  const provider = getDefaultEmbeddingProvider();
  const db = openDatabase(indexPath);
  try {
    writeMeta(db, {
      root: "docs",
      generatedAt: "2026-03-12T00:00:00.000Z",
      embeddingProvider: provider.id,
      indexMode: "test",
    });
    upsertDocuments(
      db,
      [
        {
          id: "doc-workflow-handoffs",
          path: "docs/test/workflow-handoffs.md",
          hash: sha1(text),
          modifiedAt: "2026-03-12T00:00:00.000Z",
          chunkCount: 1,
          chunks: [
            {
              id: "chunk-workflow-handoffs-1",
              path: "docs/test/workflow-handoffs.md",
              order: 0,
              sectionTitle: "Workflow Handoffs",
              text,
              tokens: tokenize(text),
            },
          ],
        },
      ],
      provider,
    );
  } finally {
    db.close();
  }
}

test("startup context carries inbound workflow handoffs and expected handoff output", async (t) => {
  const tempRoot = await makeTempDir("runtime-handoffs-");
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const plan = await buildSessionPlan({
    profilePath: "config/profiles/builder.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    workflowId: "frontend-ui-pass",
    sessionId: "builder-handoff-session",
    runId: "builder-handoff-run",
    inboundHandoffs: [
      {
        id: "handoff-scout-findings",
        kind: "scout_findings",
        sourceRole: "scout",
        targetRole: "builder",
        summary: {
          title: "Scout findings",
          outcome: "recommended implementation path",
        },
        artifacts: {
          transcriptPath: "tmp/sessions/scout.transcript.md",
          handoffPath: "tmp/sessions/scout.handoff.json",
        },
      },
      {
        id: "handoff-lead-brief",
        kind: "task_brief",
        sourceRole: "lead",
        targetRole: "builder",
        summary: {
          title: "Lead brief",
          outcome: "ship workflow handoffs",
        },
        artifacts: {
          briefPath: "tmp/orchestrator/execution-1/lead.brief.md",
        },
      },
    ],
    expectedHandoff: {
      kind: "implementation_summary",
      marker: "SPORE_HANDOFF_JSON",
      requiredSections: [
        "summary",
        "changed_paths",
        "tests_run",
        "open_risks",
      ],
    },
  } as never);

  const indexPath = path.join(tempRoot, "docs-index.sqlite");
  await createIndexedDocsDb(indexPath, "workflow handoffs builder tester reviewer");

  const contextPath = path.join(tempRoot, "builder.context.json");
  const written = await writeStartupContext(plan, contextPath, {
    indexPath,
    limit: plan.retrieval.limit,
  });

  assert.equal(plan.metadata.inboundHandoffs.length, 2);
  assert.equal(plan.metadata.inboundHandoffs[0]?.kind, "scout_findings");
  assert.equal(plan.metadata.expectedHandoff?.kind, "implementation_summary");
  assert.equal(written.payload.handoffs.inbound.length, 2);
  assert.equal(written.payload.handoffs.inbound[0]?.kind, "scout_findings");
  assert.deepEqual(written.payload.handoffs.expected?.requiredSections, [
    "summary",
    "changed_paths",
    "tests_run",
    "open_risks",
  ]);
});
