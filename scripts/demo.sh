#!/usr/bin/env bash
# Start the MetaAgri hub + dashboard for a live demo.
#
# Usage: scripts/demo.sh [mock|grid]
#   mock (default): canned proposals, no model/network dependency.
#   grid: real petal agents over Flower SuperGrid (needs `uv run flwr login supergrid`
#         once from agents/petal/; no FLWR_MODEL_API_KEY required).
#
# Ports 8100 (hub) and 8601 (dashboard), so MetaHospital (8000/8501) can run alongside.
# Set METAAGRI_SEED=0 for a reproducible season (every "Restart season" reuses the seed).
set -euo pipefail

MODE="${1:-mock}"
if [[ "$MODE" != "mock" && "$MODE" != "grid" ]]; then
  echo "Usage: $0 [mock|grid]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUB_URL="http://127.0.0.1:8100"
UI_URL="http://127.0.0.1:8601"

echo "Starting MetaAgri (PETAL_MODE=$MODE) ..."

# --directory (not `cd dir && ...`) so $! below is uv's own PID directly, with no
# intervening subshell - simplifies finding its child process in cleanup().
PETAL_MODE="$MODE" uv --directory "$ROOT_DIR/hub" run uvicorn hub.main:app --port 8100 &
HUB_PID=$!

HUB_URL="$HUB_URL" uv --directory "$ROOT_DIR/ui" run streamlit run app.py --server.port 8601 --server.headless true &
UI_PID=$!

kill_tree() {
  local sig="$1" pid="$2" child
  child="$(pgrep -P "$pid" 2>/dev/null || true)"
  [[ -n "$child" ]] && kill "-$sig" $child 2>/dev/null || true
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "Stopping hub (pid $HUB_PID) and dashboard (pid $UI_PID) ..."
  # uv run keeps running as a parent of the actual uvicorn/streamlit process, and
  # doesn't forward signals to it - kill both explicitly.
  kill_tree TERM "$HUB_PID"
  kill_tree TERM "$UI_PID"
  sleep 1
  kill_tree KILL "$HUB_PID"
  kill_tree KILL "$UI_PID"
  exit 0
}
trap cleanup EXIT INT TERM

echo -n "Waiting for hub to come up"
for _ in $(seq 1 30); do
  if curl -fs "$HUB_URL/state" > /dev/null 2>&1; then
    echo " - ready."
    break
  fi
  echo -n "."
  sleep 1
done

echo
echo "Hub:       $HUB_URL  (docs at $HUB_URL/docs)"
echo "Dashboard: $UI_URL  (our farm: $UI_URL/?farm=lerchenbruch)"
echo "Mode:      $MODE"
if [[ "$MODE" == "grid" ]]; then
  echo "Note: grid mode needs 'uv run flwr login supergrid' (run once from agents/petal/)."
fi
echo "Press Ctrl+C to stop both."

wait
