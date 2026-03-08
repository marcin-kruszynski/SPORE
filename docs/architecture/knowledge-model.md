# Knowledge Model

SPORE knowledge is structured and queryable.

## Knowledge Layers

- core project docs,
- external reference synthesis,
- ADR decisions,
- roadmap and plans,
- research notes and open questions,
- profile/workflow/domain specs,
- domain policy-backed docs-kb startup retrieval context,
- session notes and operational logs,
- future task memory.

## Governance

- canonical docs are indexed in `docs/INDEX.md` and `docs/index/docs_manifest.yaml`.
- new docs must be classified by type/domain/status/owner.
- avoid fragmented duplicates; prefer updating canonical docs.
- `docs-kb` retrieval can now be shaped per domain through `config/domains/*.yaml` and project `activeDomains[]` `docsKbPolicy` settings such as `queryTerms`, `queryTemplate`, and `resultLimit`.
