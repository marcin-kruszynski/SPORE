# Docs Search Tool Spec

## Objective

Provide local-first keyword plus semantic retrieval over project documentation.

## Required Capabilities

- scan docs,
- deterministic chunking,
- embedding generation abstraction,
- local storage,
- incremental reindex,
- CLI search/status/rebuild.

## Planned Interfaces

- CLI contract in `packages/docs-kb/README.md`
- provider abstraction in `tools/docsearch/provider-contract.md`
