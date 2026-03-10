# Documentation Maintenance Runbook

## Ground Rules

- `docs/INDEX.md` is the human entrypoint.
- `docs/index/DOCS_INDEX.md` is the broader inventory grouped by current, historical, supplemental, and compatibility docs.
- `docs/index/docs_manifest.yaml` tracks the documents intentionally surfaced from `docs/INDEX.md`.
- Lowercase kebab-case files are canonical.
- Uppercase duplicates should remain compatibility stubs only.
- Prefer updating one canonical doc over creating new parallel note fragments.

## When Updating Docs

- Update the canonical document that actually owns the topic.
- If a document is still useful but no longer current, mark it as historical instead of leaving stale "next step" language in place.
- Remove placeholder docs that add no information instead of indexing them as if they were real guidance.
- If product direction changes, update `docs/plans/project-state-and-direction-handoff.md`, `docs/plans/self-build-status-and-next-steps.md`, and `docs/plans/roadmap.md` together.
- If architecture boundaries change, update the relevant architecture docs and ADRs together.

## Hygiene Checklist

- `docs/INDEX.md` updated when the canonical navigation changes
- `docs/index/DOCS_INDEX.md` updated when inventory/status grouping changes
- `docs/index/docs_manifest.yaml` updated when surfaced docs change
- `docs/runbooks/local-dev.md` updated when environment, commands, or verification expectations change
- `README.md` and `AGENTS.md` updated when project framing or operator expectations change materially
- stale duplicate docs converted to redirects or historical notes
- placeholder docs removed when they stop adding value
