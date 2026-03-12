# Scripts

Repository-level helper scripts should live here when they are not package-specific.

Current helpers:

- `scripts/run-self-build-real-pi.sh` - start gateway/orchestrator/web with isolated state, tmux sessions, and Real PI enabled
- `scripts/stop-self-build.sh` - stop a stack started by the run helper while preserving logs and DBs
