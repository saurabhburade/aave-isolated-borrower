#!/usr/bin/env bash
set -euo pipefail

# Disposable fork capital only. No real-chain transaction can pass these guards.
RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8557}"
case "$RPC_URL" in
  http://127.0.0.1:8557|http://localhost:8557) ;;
  *) echo "expected the local fork RPC" >&2; exit 1 ;;
esac
[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "31337" ]] || { echo "expected chain 31337" >&2; exit 1; }
OWNER="${LOCAL_OWNER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
STETH=0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
DONOR="${LOCAL_USDC_DONOR:-0xF977814e90dA44bFA03b6295A0616a897441aceC}"

cast send "$WETH" 'deposit()' --value 5ether --from "$OWNER" --unlocked --rpc-url "$RPC_URL" >/dev/null
cast send "$STETH" 'submit(address)(uint256)' "$OWNER" --value 5ether --from "$OWNER" --unlocked --rpc-url "$RPC_URL" >/dev/null
STETH_AMOUNT="$(cast call "$STETH" 'balanceOf(address)(uint256)' "$OWNER" --rpc-url "$RPC_URL" | awk '{print $1}')"
cast send "$STETH" 'approve(address,uint256)(bool)' "$WSTETH" "$STETH_AMOUNT" --from "$OWNER" --unlocked --rpc-url "$RPC_URL" >/dev/null
cast send "$WSTETH" 'wrap(uint256)(uint256)' "$STETH_AMOUNT" --from "$OWNER" --unlocked --rpc-url "$RPC_URL" >/dev/null

# A small native-token rounding/interest buffer; source tokens come from an EOA,
# leaving the protocol Hub/Pool accounting intact. Always stop impersonation.
cast rpc anvil_setBalance "$DONOR" 0xde0b6b3a7640000 --rpc-url "$RPC_URL" >/dev/null
cast rpc anvil_impersonateAccount "$DONOR" --rpc-url "$RPC_URL" >/dev/null
trap 'cast rpc anvil_stopImpersonatingAccount "$DONOR" --rpc-url "$RPC_URL" >/dev/null' EXIT
cast send "$USDC" 'transfer(address,uint256)(bool)' "$OWNER" 1000000 --from "$DONOR" --unlocked --rpc-url "$RPC_URL" >/dev/null
echo "Funded $OWNER on local chain 31337 with WETH, wstETH, and a 1 USDC rounding buffer."
