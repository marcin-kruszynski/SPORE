# CLI

This module now implements:

- `docs-kb index`
- `docs-kb search`
- `docs-kb status`
- `docs-kb rebuild`

The CLI now targets a SQLite-backed local index and keeps the command surface stable while storage and ranking evolve underneath it.
