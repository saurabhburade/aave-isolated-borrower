#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8557}"
PORT=8557
FORK_URL="${FORK_URL:-https://eth.drpc.org}"
FORK_BLOCK="${FORK_BLOCK:-}"
FORK_CUPS="${FORK_CUPS:-40}"
FORK_RPS="${FORK_RPS:-4}"
FORK_STATE_FILE="${FORK_STATE_FILE:-cache/anvil-local-state.json}"
FORK_LOAD_STATE="${FORK_LOAD_STATE:-}"
WALLET_PID=""
PROXY_PID=""
ANVIL_PID=""
cleanup() {
  if [[ -n "$ANVIL_PID" ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi
  if [[ -n "$PROXY_PID" ]]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  if [[ -n "$WALLET_PID" ]]; then kill "$WALLET_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

case "$RPC_URL" in
  http://127.0.0.1:8557|http://localhost:8557) ;;
  *) echo "refusing non-local RPC: $RPC_URL" >&2; exit 1 ;;
esac

# Keep the array nonempty for macOS Bash 3.2 with nounset enabled.
FORK_ARGS=(--port "$PORT" --chain-id 31337)
if [[ -n "$FORK_BLOCK" ]]; then FORK_ARGS+=(--fork-block-number "$FORK_BLOCK"); fi
mkdir -p "$(dirname "$FORK_STATE_FILE")"
if [[ -n "$FORK_LOAD_STATE" ]]; then FORK_ARGS+=(--load-state "$FORK_LOAD_STATE"); fi

# The wallet proxy belongs to this fork, not another project's port 8546.
node ../apps/web/scripts/local-wallet-rpc.mjs &
WALLET_PID=$!
READY=0
for _ in {1..50}; do
  kill -0 "$WALLET_PID" 2>/dev/null || exit 1
  if curl --silent --fail http://127.0.0.1:8556/health >/dev/null; then READY=1; break; fi
  sleep 0.1
done
[[ "$READY" == "1" ]] || { echo "wallet RPC proxy did not start" >&2; exit 1; }

SOURCE_URL="$FORK_URL"
if [[ "$FORK_RPS" != "0" ]]; then
  # Anvil compute-unit limits can still burst storage reads. A single upstream
  # queue provides a predictable request ceiling for the public source endpoint.
  export FORK_URL FORK_RPS
  FORK_PROXY_PORT=8558 node script/rpc-throttle.mjs &
  PROXY_PID=$!
  READY=0
  for _ in {1..50}; do
    kill -0 "$PROXY_PID" 2>/dev/null || exit 1
    if curl --silent --fail http://127.0.0.1:8558/health >/dev/null; then READY=1; break; fi
    sleep 0.1
  done
  [[ "$READY" == "1" ]] || { echo "fork transport did not start" >&2; exit 1; }
  SOURCE_URL=http://127.0.0.1:8558
fi
anvil --quiet --host 127.0.0.1 --fork-url "$SOURCE_URL" --fork-header "User-Agent: aave-isolated-positions" --compute-units-per-second "$FORK_CUPS" --timeout 15000 --retries 1 --dump-state "$FORK_STATE_FILE" --state-interval 15 "${FORK_ARGS[@]}" &
ANVIL_PID=$!
if [[ -n "$FORK_LOAD_STATE" ]]; then node script/restore-clock.mjs; fi
wait "$ANVIL_PID"
