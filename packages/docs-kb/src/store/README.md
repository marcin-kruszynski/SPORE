# Store

This module now persists a local SQLite index in `data/docs-index/`.

Current responsibilities:

- schema bootstrap,
- metadata persistence,
- document and chunk upserts,
- embedding persistence,
- incremental change tracking,
- search record retrieval.
