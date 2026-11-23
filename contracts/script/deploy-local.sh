#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8557}"
FORK_BLOCK="${FORK_BLOCK:-$(cast rpc anvil_nodeInfo --rpc-url "$RPC_URL" | jq -r .forkConfig.forkBlockNumber)}"

case "$RPC_URL" in
  http://127.0.0.1:8557|http://localhost:8557) ;;
  *) echo "refusing deployment to non-local RPC" >&2; exit 1 ;;
esac
[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "31337" ]] || { echo "expected local chain 31337" >&2; exit 1; }

AUTH=(--unlocked --sender "${LOCAL_OWNER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}")
if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then AUTH=(--private-key "$DEPLOYER_PRIVATE_KEY"); fi
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --broadcast \
  "${AUTH[@]}" \
  --slow

FACTORY_ADDRESS="$(jq -r '.transactions[] | select(.contractName == "PositionFactory") | .contractAddress' "broadcast/Deploy.s.sol/31337/run-latest.json" | head -n1)"
FACTORY_ADDRESS="$FACTORY_ADDRESS" FORK_BLOCK="$FORK_BLOCK" bash script/generate-local-manifest.sh
