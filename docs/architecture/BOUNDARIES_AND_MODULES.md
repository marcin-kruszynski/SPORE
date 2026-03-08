# Boundaries and Modules

SPORE separates:
- knowledge/documentation,
- configuration/composition,
- runtime/orchestration,
- session/observability,
- client surfaces.

No module should silently mutate another module's behavior without explicit contract linkage.
