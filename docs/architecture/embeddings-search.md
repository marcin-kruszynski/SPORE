# Embeddings and Search Strategy

## Goals

Build a local-first documentation retrieval system for Markdown and QMD content, with a thin provider abstraction.

## Package Boundary

Primary package scaffold: `packages/docs-kb/`

Planned modules:
- ingestion
- chunking
- embedding backend abstraction
- local store
- CLI entrypoints
- optional API adapter
- index metadata

## Data Model

- document table: id, path, hash, updated_at, domain, type
- chunk table: id, document_id, order, text, token_estimate
- embedding table: chunk_id, vector_ref, provider, model, created_at
- index status table: run_id, mode, changed_docs, duration

## Storage Strategy

Bootstrap preference: SQLite metadata + file-based embedding payloads.

Later options:
- SQLite vector extension,
- pure SQLite vectors,
- JSONL fallback for early local operation.

## Current Bootstrap Implementation

The first executable slice now exists and intentionally stays lightweight:

- `docs-kb index`
- `docs-kb search`
- `docs-kb status`

Current characteristics:

- indexes `docs/` only,
- supports `.md` and `.qmd`,
- chunks by headings and paragraph groups,
- stores a local SQLite index in `data/docs-index/`,
- uses a local embedding provider abstraction with keyword plus semantic blended scoring,
- supports incremental `index` and full `rebuild`.

This is still a deliberate bootstrap step. Richer embeddings, collection-aware retrieval, and API exposure remain follow-up work.

## Chunking Strategy

- deterministic chunk IDs,
- heading-aware segmentation,
- size windows with overlap,
- stable re-chunking to minimize unnecessary re-embedding.

## Update Strategy

- full rebuild mode,
- incremental mode based on path/hash diff,
- per-collection refresh.

## Interface Contracts

CLI:
- `docs-kb index`
- `docs-kb search "query"`
- `docs-kb status`
- `docs-kb rebuild`

Optional API:
- `GET /search?q=...`
- `GET /docs/:id`
- `GET /index/status`

## Agent Integration

Future orchestrator/agent flows should query docs-kb before planning major changes to retrieve conventions, ADRs, and architecture constraints.

## Open Questions

- embedding provider choice for local and offline modes,
- vector storage format in first working implementation,
- ranking blend between keyword and semantic score.
