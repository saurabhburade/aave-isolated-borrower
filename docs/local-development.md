# Local development

The supported execution environment is an Ethereum fork on Anvil chain 31337, port 8557. The web app uses port 3210 and the `@aave-isolated` package namespace. No public application factory is configured. Markets are discovered dynamically from the official Ethereum Aave catalog and validated against this fork. `local.json` supplies the factory plus optional market bytecode pins and reserve preferences, rather than an exhaustive market allowlist. New compatible catalog markets need no registration or redeployment; markets deployed after the pinned fork block remain unavailable until the fork includes them.

Run `pnpm install`, then `pnpm fork` in a persistent terminal. In a second terminal run `pnpm local:deploy`, `pnpm local:fund`, `pnpm indexer:sync`, and `pnpm dev`. Connect an injected development wallet to the local chain. All setup broadcasts and funding scripts check the local RPC and chain before acting.

OKX Wallet needs the wallet RPC **http://127.0.0.1:8556**, chain **31337** (ETH). The fork command starts it automatically, including with `FORK_RPS=0`. It handles OKX's custom-header preflight and forwards to Anvil on 8557. The app and scripts still use 8557 directly. Replace any saved wallet RPC pointing to 8546: that proxy is from the separate borrow aggregator and expects a node on 8545. To add the wallet proxy to an already running fork without discarding positions, run `pnpm wallet:rpc` separately.

`pnpm local:deploy` reads the fork's original block from `anvil_nodeInfo`, deploys the current factory, and generates a fresh manifest. It uses the unlocked first Anvil account by default; `LOCAL_OWNER` or a local `DEPLOYER_PRIVATE_KEY` can override the signer. Do not use a funded real-world account for fork development.

`FORK_URL` selects an Ethereum source endpoint. The default is `https://eth.drpc.org`. The local read-only transport on port 8558 queues upstream requests at `FORK_RPS=4` to avoid bursts; `FORK_RPS=0` connects Anvil directly. It refuses transaction submission/signing methods. Allow several minutes for the first full reserve inventory on a cold fork. `FORK_CUPS` additionally controls Anvil’s compute-unit throttle. Public endpoint availability and archive retention can vary. An archive-capable endpoint is needed for sustained pinned-fork sessions. Keep secrets in shell environment variables. `.env.example` documents names without storing credentials. Restarting the fork discards disposable local positions; rerun deployment and manifest generation afterward.

For the optional indexer, install/start Docker, run `pnpm indexer:sync`, `pnpm --filter @aave-isolated/indexer codegen`, and `pnpm dev:indexer`. Code generation supplies the Envio type augmentation. Native balances and risk remain protocol reads; event entities are discovery/history only. Factory-log discovery works while the indexer is absent or behind.

Run `pnpm typecheck`, `pnpm test`, `pnpm check:contracts`, and `pnpm build` for static, unit, formatting, and production checks. `pnpm test:fork` explicitly opts into real native V3/V4 tests; their setup capital exists only inside Foundry's fork. `ETHEREUM_RPC_URL` and optional `FORK_BLOCK` control that test source.

Run the funded integration script with `pnpm --filter @aave-isolated/web exec node --experimental-strip-types scripts/integration-local.mjs`. It uses JSON-RPC unlocked test accounts, asserts chain 31337, and never signs a public-chain transaction.

Quotes use read-only `eth_simulateV1`: transient approvals, the exact owner/account transaction, and native post-action risk/rate reads share simulated state. Request handling does not impersonate accounts, persist approvals, or modify Anvil. Missing data, incompatible reserves, wrong chains, mismatched code hashes, failed simulations, and stale reviews remain unavailable rather than being shown as zero risk.

Browser verification uses a disposable Chromium context, never the personal browser profile. Run `pnpm --filter @aave-isolated/web test:browser`; optional `HEADLESS_CHROMIUM` selects an existing executable. `RUN_LOCAL_WALLET_UI=1` enables the local-only EIP-1193 test wallet and asserts chain 31337 before any transaction.

## All-token local faucet

Run `pnpm local:fund:usdt` to top up only USDT to 1,000,000 for the first unlocked Anvil account (or `LOCAL_OWNER`).

Run `pnpm local:fund:all` to top up Anvil's first unlocked account (or `LOCAL_OWNER`) with 10,000 ETH and every token in the verified native reserve catalog. Targets are 1,000 ETH-family tokens, 100 BTC-family tokens, 1,000,000 stablecoin-family tokens, 100 XAUt, and 10,000 other tokens. Existing balances above those targets are preserved.

This is a local state faucet on port 8557 / chain 31337. It derives owner-specific balance mapping keys from actual balance reads, supports Solidity/Vyper and namespaced mappings, verifies token supply is unchanged, and restores unsuccessful probes. SNX uses its verified `tokenState()` ledger; LDO uses an owner-specific MiniMe checkpoint. It does not enable paused/expired reserves or modify Aave positions. No public-chain mint or transfer occurs. The full balance report is written to `/tmp/aave-local-faucet-balances.json`.

## Fork recovery snapshots

The fork launcher saves state every 15 seconds to `contracts/cache/anvil-local-state.json` (or `FORK_STATE_FILE`, relative to the contracts directory). It also bounds upstream requests to 15 seconds with one retry. To resume a healthy saved snapshot, set `FORK_LOAD_STATE=cache/anvil-local-state.json` and use its original `FORK_BLOCK` when running `pnpm fork`; retain the matching deployment manifest. A fresh start without `FORK_LOAD_STATE` still resets local positions. A snapshot can only protect state saved before a node becomes unresponsive.

On restore, the launcher checks chain 31337 and advances an older block timestamp to the current time before completing startup. It mines one empty local block and preserves accounts and positions. A restored block clock can otherwise precede Aave reserve update timestamps, causing interest-accruing `totalSupply` reads to revert with arithmetic underflow. Clock recovery never moves an equal or newer timestamp backward. Run `pnpm --filter @aave-isolated/contracts test:local` to check this recovery behavior.

`LOCAL_FAUCET_TOKENS=WETH,USDC,wstETH pnpm local:fund:all` restores just those test tokens without loading every protocol reserve. The faucet still requires chain 31337, an unlocked local account, an authenticated catalog/factory, and verified balance/total-supply reads around owner-only storage changes.
