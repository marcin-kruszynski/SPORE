# Docsearch Usage

## Current Commands

- `docs-kb index`
- `docs-kb search "query"`
- `docs-kb status`

Current implementation details:

- indexes `docs/` by default,
- supports `.md` and `.qmd`,
- stores a local SQLite index in `data/docs-index/spore-docs.sqlite`,
- uses deterministic heading-aware chunking,
- blends keyword scoring with a local embedding provider.

Run from the repository root:

```bash
npm run docs-kb -- index
npm run docs-kb -- search "session model"
npm run docs-kb -- status
npm run docs-kb -- rebuild
```

## Intended Users

- humans navigating project knowledge,
- orchestrator planning flows,
- scouts and reviewers retrieving context.
