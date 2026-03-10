# `packages/docs-kb`

`packages/docs-kb` is the local-first documentation knowledge base for SPORE.

## Current Vertical Slice

The first bootstrap implementation provides:

- `docs-kb index`
- `docs-kb search "<query>"`
- `docs-kb status`
- `docs-kb rebuild`

The current implementation indexes Markdown and QMD from `docs/`, chunks them deterministically by headings and paragraph groups, stores a local SQLite index under `data/docs-index/`, and blends keyword ranking with a local embedding provider abstraction.

## Current Boundaries

- `src/ingestion/` scans supported documents
- `src/chunking/` creates stable, heading-aware chunks
- `src/store/` persists the SQLite-backed index
- `src/embeddings/` provides the local embedding abstraction and default provider
- `src/cli/` exposes the command-line surface
- `src/api/` remains planned, not yet implemented

## Run

From the repository root:

```bash
npm run docs-kb:index
npm run docs-kb -- search "session model"
npm run docs-kb:status
npm run docs-kb:rebuild
```

## Next Step

Next improvements should focus on richer semantic providers, collection-aware filtering, and API exposure without changing the CLI contract.
