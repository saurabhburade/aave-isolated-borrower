#!/usr/bin/env bash
set -euo pipefail

: "${FACTORY_ADDRESS:?Set FACTORY_ADDRESS to the deployed PositionFactory}"
: "${FORK_BLOCK:?Set FORK_BLOCK to the source Ethereum fork block}"
RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8557}"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "31337" ]]; then
  echo "refusing manifest for chain $CHAIN_ID; expected local chain 31337" >&2
  exit 1
fi

V3_POOL="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
V4_SPOKE="0x94e7A5dCbE816e498b89aB752661904E2F56c485"
V4_BLUECHIP="0x973a023A77420ba610f06b3858aD991Df6d85A08"
WETH="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
WSTETH="0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
FACTORY_HASH="$(cast keccak "$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")")"
V3_HASH="$(cast keccak "$(cast code "$V3_POOL" --rpc-url "$RPC_URL")")"
V4_HASH="$(cast keccak "$(cast code "$V4_SPOKE" --rpc-url "$RPC_URL")")"
V4_BLUECHIP_HASH="$(cast keccak "$(cast code "$V4_BLUECHIP" --rpc-url "$RPC_URL")")"
ERC1967_IMPLEMENTATION_SLOT="0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC"

implementation_address() {
  local venue="$1"
  local word
  word="$(cast storage "$venue" "$ERC1967_IMPLEMENTATION_SLOT" --rpc-url "$RPC_URL")"
  word="${word#0x}"
  if [[ -z "$word" || "$word" =~ ^0+$ ]]; then
    echo ""
  else
    echo "0x${word: -40}"
  fi
}

implementation_hash() {
  local implementation="$1"
  if [[ -z "$implementation" ]]; then
    echo ""
  else
    cast keccak "$(cast code "$implementation" --rpc-url "$RPC_URL")"
  fi
}

V3_IMPLEMENTATION="$(implementation_address "$V3_POOL")"
V4_IMPLEMENTATION="$(implementation_address "$V4_SPOKE")"
V3_IMPLEMENTATION_HASH="$(implementation_hash "$V3_IMPLEMENTATION")"
V4_IMPLEMENTATION_HASH="$(implementation_hash "$V4_IMPLEMENTATION")"

V4_BLUECHIP_IMPLEMENTATION="$(implementation_address "$V4_BLUECHIP")"
V4_BLUECHIP_IMPLEMENTATION_HASH="$(implementation_hash "$V4_BLUECHIP_IMPLEMENTATION")"

mkdir -p config
jq -n \
  --arg factory "$FACTORY_ADDRESS" \
  --arg factoryHash "$FACTORY_HASH" \
  --arg v3Hash "$V3_HASH" \
  --arg v4Hash "$V4_HASH" \
  --arg v3Implementation "$V3_IMPLEMENTATION" \
  --arg v4Implementation "$V4_IMPLEMENTATION" \
  --arg v3ImplementationHash "$V3_IMPLEMENTATION_HASH" \
  --arg v4ImplementationHash "$V4_IMPLEMENTATION_HASH" \
  --arg v4BluechipHash "$V4_BLUECHIP_HASH" \
  --arg v4BluechipImplementation "$V4_BLUECHIP_IMPLEMENTATION" \
  --arg v4BluechipImplementationHash "$V4_BLUECHIP_IMPLEMENTATION_HASH" \
  --arg forkBlock "$FORK_BLOCK" \
  --arg rpcUrl "$RPC_URL" \
  '{
    chainId: 31337,
    rpcUrl: $rpcUrl,
    forkBlock: $forkBlock,
    factory: $factory,
    factoryCodeHash: $factoryHash,
    markets: [
      {
        version: 3,
        venue: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        name: "Aave V3 Ethereum Pool",
        network: "Ethereum fork",
        verifiedBlock: $forkBlock,
        revision: "Aave V3 Pool revision 12",
        venueCodeHash: $v3Hash,
        implementation: (if $v3Implementation == "" then null else $v3Implementation end),
        implementationCodeHash: (if $v3ImplementationHash == "" then null else $v3ImplementationHash end),
        implementationKind: (if $v3Implementation == "" then "direct" else "erc1967-proxy" end),
        reserveIds: ["0"],
        assets: [
          {id: "v3-weth", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18, reserveId: "0"},
          {id: "v3-usdc", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, reserveId: "0"}
        ]
      },
      {
        version: 4,
        venue: "0x94e7A5dCbE816e498b89aB752661904E2F56c485",
        name: "Aave V4 Main / Core",
        network: "Ethereum fork",
        verifiedBlock: $forkBlock,
        revision: "Aave V4 Ethereum address-book Main Spoke",
        venueCodeHash: $v4Hash,
        implementation: (if $v4Implementation == "" then null else $v4Implementation end),
        implementationCodeHash: (if $v4ImplementationHash == "" then null else $v4ImplementationHash end),
        implementationKind: (if $v4Implementation == "" then "direct" else "erc1967-proxy" end),
        reserveIds: ["0", "1", "7"],
        assets: [
          {id: "v4-weth", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18, reserveId: "0"},
          {id: "v4-wsteth", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", symbol: "wstETH", name: "Wrapped stETH", decimals: 18, reserveId: "1"},
          {id: "v4-usdc", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, reserveId: "7"}
        ]
      },
      {
        version: 4,
        venue: "0x973a023A77420ba610f06b3858aD991Df6d85A08",
        name: "Aave V4 Bluechip / Core",
        network: "Ethereum fork",
        verifiedBlock: $forkBlock,
        revision: "Aave V4 Bluechip Spoke; Core USDC reserve 7",
        venueCodeHash: $v4BluechipHash,
        implementation: (if $v4BluechipImplementation == "" then null else $v4BluechipImplementation end),
        implementationCodeHash: (if $v4BluechipImplementationHash == "" then null else $v4BluechipImplementationHash end),
        implementationKind: (if $v4BluechipImplementation == "" then "direct" else "erc1967-proxy" end),
        preferredDebtReserveIds: ["7"],
        reserveIds: ["0", "7"],
        assets: [
          {id: "v4-bluechip-weth", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18, reserveId: "0"},
          {id: "v4-bluechip-usdc", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, reserveId: "7"}
        ]
      }
    ]
  }' > config/local.json

echo "wrote config/local.json (factory $FACTORY_ADDRESS; source block $FORK_BLOCK)"
