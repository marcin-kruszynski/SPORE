# `packages/config-schema`

This package now contains the first lightweight configuration validation layer for SPORE.

## Current Capability

- parses the current YAML config subset used in `config/`
- loads schema definitions from `schemas/`
- validates all config files through `npm run config:validate`

## Current Scope

The validator targets the seeded config tree:

- `config/system/`
- `config/profiles/`
- `config/workflows/`
- `config/teams/`
- `config/projects/`
- `config/domains/`

It intentionally covers a pragmatic subset of YAML and JSON Schema sufficient for the current bootstrap contracts.
