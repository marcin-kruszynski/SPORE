#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNS_ROOT_DEFAULT="${REPO_ROOT}/tmp/self-build-runs"

TARGET=""

usage() {
  cat <<'EOF'
Usage: scripts/stop-self-build.sh [--latest | <run-dir>]

Stops a SPORE self-build stack started by scripts/run-self-build-real-pi.sh.

Examples:
  scripts/stop-self-build.sh --latest
  scripts/stop-self-build.sh tmp/self-build-runs/20260312-120000
EOF
}

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  case "$1" in
    --latest)
      TARGET="${RUNS_ROOT_DEFAULT}/latest"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGET="$1"
      ;;
  esac
else
  TARGET="${RUNS_ROOT_DEFAULT}/latest"
fi

if [[ -L "$TARGET" ]]; then
  TARGET="$(readlink -f "$TARGET")"
fi

if [[ ! -d "$TARGET" ]]; then
  printf 'Run directory not found: %s\n' "$TARGET" >&2
  exit 1
fi

ENV_FILE="$TARGET/env.sh"
if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Missing runtime metadata: %s\n' "$ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"

for session in \
  "$SPORE_SELFBUILD_ORCHESTRATOR_SESSION" \
  "$SPORE_SELFBUILD_GATEWAY_SESSION" \
  "$SPORE_SELFBUILD_WEB_SESSION"
do
  tmux kill-session -t "$session" 2>/dev/null || true
done

pkill -TERM -f "$SPORE_SELFBUILD_RUN_DIR" 2>/dev/null || true
sleep 2
pkill -KILL -f "$SPORE_SELFBUILD_RUN_DIR" 2>/dev/null || true

if [[ -L "${RUNS_ROOT_DEFAULT}/latest" ]] && [[ "$(readlink -f "${RUNS_ROOT_DEFAULT}/latest")" == "$TARGET" ]]; then
  rm -f "${RUNS_ROOT_DEFAULT}/latest"
fi

cat <<EOF
Stopped SPORE self-build stack for:
  ${TARGET}

Logs and state were preserved in:
  ${TARGET}
EOF
