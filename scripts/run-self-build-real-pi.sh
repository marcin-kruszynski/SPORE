#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNS_ROOT_DEFAULT="${REPO_ROOT}/tmp/self-build-runs"

PORT_BASE=8787
RUN_NAME=""
RUN_DIR=""

usage() {
  cat <<'EOF'
Usage: scripts/run-self-build-real-pi.sh [options]

Starts the SPORE gateway, orchestrator, and web UI in tmux with isolated state,
Real PI enabled, and services bound to 0.0.0.0.

Options:
  --port-base <port>   Base port for gateway (default: 8787)
                       Uses <base> for gateway, <base+1> for web, <base+2> for orchestrator.
  --name <name>        Optional readable suffix for the run directory/session names
  --run-dir <path>     Use an explicit run directory instead of tmp/self-build-runs/<timestamp>
  -h, --help           Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port-base)
      PORT_BASE="$2"
      shift 2
      ;;
    --name)
      RUN_NAME="$2"
      shift 2
      ;;
    --run-dir)
      RUN_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "$PORT_BASE" =~ ^[0-9]+$ ]]; then
  printf '%s\n' '--port-base must be a number' >&2
  exit 1
fi

GATEWAY_PORT="$PORT_BASE"
WEB_PORT="$((PORT_BASE + 1))"
ORCHESTRATOR_PORT="$((PORT_BASE + 2))"

if [[ -z "$RUN_DIR" ]]; then
  mkdir -p "$RUNS_ROOT_DEFAULT"
  RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
  SAFE_NAME=""
  if [[ -n "$RUN_NAME" ]]; then
    SAFE_NAME="-$(printf '%s' "$RUN_NAME" | tr ' /:' '---' | tr -cd '[:alnum:]-_')"
  fi
  RUN_DIR="${RUNS_ROOT_DEFAULT}/${RUN_STAMP}${SAFE_NAME}"
fi

mkdir -p "$RUN_DIR/logs" "$RUN_DIR/worktrees"

if [[ -n "${SPORE_PI_BIN:-}" ]]; then
  PI_BIN="$SPORE_PI_BIN"
elif command -v pi >/dev/null 2>&1; then
  PI_BIN="$(command -v pi)"
else
  PI_BIN="$(npm prefix -g 2>/dev/null)/bin/pi"
fi

if [[ ! -x "$PI_BIN" ]]; then
  printf '%s\n' 'Could not find executable pi binary. Set SPORE_PI_BIN or install pi first.' >&2
  exit 1
fi

for port in "$GATEWAY_PORT" "$WEB_PORT" "$ORCHESTRATOR_PORT"; do
  if lsof -i ":${port}" >/dev/null 2>&1; then
    printf 'Port %s is already in use. Choose another --port-base or stop the existing service.\n' "$port" >&2
    exit 1
  fi
done

SESSION_PREFIX="spore-selfbuild-$(basename "$RUN_DIR" | tr '.' '_' | tr -cd '[:alnum:]-_')"
GATEWAY_SESSION="${SESSION_PREFIX}-gateway"
WEB_SESSION="${SESSION_PREFIX}-web"
ORCHESTRATOR_SESSION="${SESSION_PREFIX}-orch"

cat >"$RUN_DIR/env.sh" <<EOF
export SPORE_SELFBUILD_RUN_DIR="${RUN_DIR}"
export SPORE_SELFBUILD_GATEWAY_PORT="${GATEWAY_PORT}"
export SPORE_SELFBUILD_WEB_PORT="${WEB_PORT}"
export SPORE_SELFBUILD_ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT}"
export SPORE_SELFBUILD_GATEWAY_SESSION="${GATEWAY_SESSION}"
export SPORE_SELFBUILD_WEB_SESSION="${WEB_SESSION}"
export SPORE_SELFBUILD_ORCHESTRATOR_SESSION="${ORCHESTRATOR_SESSION}"
export SPORE_PI_BIN="${PI_BIN}"
export SPORE_ORCHESTRATOR_DB_PATH="${RUN_DIR}/orchestrator.sqlite"
export SPORE_SESSION_DB_PATH="${RUN_DIR}/session.sqlite"
export SPORE_EVENT_LOG_PATH="${RUN_DIR}/events.log"
export SPORE_WORKSPACE_REPO_ROOT="${REPO_ROOT}"
export SPORE_WORKTREE_ROOT="${RUN_DIR}/worktrees"
EOF

cat >"$RUN_DIR/runtime.json" <<EOF
{
  "runDir": "${RUN_DIR}",
  "repoRoot": "${REPO_ROOT}",
  "gatewayPort": ${GATEWAY_PORT},
  "webPort": ${WEB_PORT},
  "orchestratorPort": ${ORCHESTRATOR_PORT},
  "gatewaySession": "${GATEWAY_SESSION}",
  "webSession": "${WEB_SESSION}",
  "orchestratorSession": "${ORCHESTRATOR_SESSION}",
  "piBin": "${PI_BIN}",
  "startedAt": "$(date --iso-8601=seconds)"
}
EOF

ln -sfn "$RUN_DIR" "${RUNS_ROOT_DEFAULT}/latest"

source "$RUN_DIR/env.sh"

tmux new-session -d -s "$ORCHESTRATOR_SESSION" -c "$REPO_ROOT" \
  "SPORE_ORCHESTRATOR_HOST=0.0.0.0 SPORE_ORCHESTRATOR_PORT='${ORCHESTRATOR_PORT}' SPORE_ORCHESTRATOR_DB_PATH='${SPORE_ORCHESTRATOR_DB_PATH}' SPORE_SESSION_DB_PATH='${SPORE_SESSION_DB_PATH}' SPORE_EVENT_LOG_PATH='${SPORE_EVENT_LOG_PATH}' SPORE_WORKSPACE_REPO_ROOT='${SPORE_WORKSPACE_REPO_ROOT}' SPORE_WORKTREE_ROOT='${SPORE_WORKTREE_ROOT}' SPORE_PI_BIN='${SPORE_PI_BIN}' npm run orchestrator:start 2>&1 | tee '${RUN_DIR}/logs/orchestrator.log'"

tmux new-session -d -s "$GATEWAY_SESSION" -c "$REPO_ROOT" \
  "SPORE_GATEWAY_HOST=0.0.0.0 SPORE_GATEWAY_PORT='${GATEWAY_PORT}' SPORE_SESSION_DB_PATH='${SPORE_SESSION_DB_PATH}' SPORE_EVENT_LOG_PATH='${SPORE_EVENT_LOG_PATH}' npm run gateway:start 2>&1 | tee '${RUN_DIR}/logs/gateway.log'"

tmux new-session -d -s "$WEB_SESSION" -c "$REPO_ROOT" \
  "SPORE_WEB_HOST=0.0.0.0 SPORE_WEB_PORT='${WEB_PORT}' SPORE_GATEWAY_ORIGIN='http://127.0.0.1:${GATEWAY_PORT}' SPORE_ORCHESTRATOR_ORIGIN='http://127.0.0.1:${ORCHESTRATOR_PORT}' npm run web:start 2>&1 | tee '${RUN_DIR}/logs/web.log'"

wait_for_url() {
  local url="$1"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if python3 - "$url" <<'PY'
import sys, urllib.request
url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=2) as response:
        raise SystemExit(0 if 200 <= response.status < 500 else 1)
except Exception:
    raise SystemExit(1)
PY
    then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_url "http://127.0.0.1:${ORCHESTRATOR_PORT}/health"
wait_for_url "http://127.0.0.1:${GATEWAY_PORT}/health"
wait_for_url "http://127.0.0.1:${WEB_PORT}/"

cat <<EOF

SPORE Real-PI self-build stack is running.

Run directory:
  ${RUN_DIR}

Services:
  Gateway:       http://127.0.0.1:${GATEWAY_PORT}  (bound to 0.0.0.0:${GATEWAY_PORT})
  Web UI:        http://127.0.0.1:${WEB_PORT}      (bound to 0.0.0.0:${WEB_PORT})
  Orchestrator:  http://127.0.0.1:${ORCHESTRATOR_PORT}  (bound to 0.0.0.0:${ORCHESTRATOR_PORT})

State files:
  ${RUN_DIR}/orchestrator.sqlite
  ${RUN_DIR}/session.sqlite
  ${RUN_DIR}/events.log
  ${RUN_DIR}/worktrees/

Logs:
  ${RUN_DIR}/logs/orchestrator.log
  ${RUN_DIR}/logs/gateway.log
  ${RUN_DIR}/logs/web.log

tmux sessions:
  ${ORCHESTRATOR_SESSION}
  ${GATEWAY_SESSION}
  ${WEB_SESSION}

Stop everything with:
  scripts/stop-self-build.sh "${RUN_DIR}"

Or stop the latest run with:
  scripts/stop-self-build.sh --latest

EOF
