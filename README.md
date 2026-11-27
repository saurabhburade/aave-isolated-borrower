# Aave isolated positions

A pnpm + Turbo monorepo with a Next.js borrowing interface, owner-controlled Solidity position accounts, and an Envio indexer. Each position belongs to one owner, chain, Aave version, and Pool or Spoke. Collateral can cross-collateralize inside that account; other accounts remain independent.

## Run locally

Requires Node 24+, pnpm 12.18+, Foundry, and `jq`. Install dependencies with `pnpm install`.

Start an Ethereum fork in one terminal:

```sh
pnpm fork
```

In another terminal:

```sh
pnpm local:deploy
pnpm local:fund
pnpm indexer:sync
pnpm dev
```

Open [the local app](http://127.0.0.1:3210/31337), click **Connect wallet**, and select **Anvil Local** to use Anvil's first funded test account without extension approval popups. Each approval or transaction waits **1.5 seconds** before submission so the signing step stays visible. This connector is available only with `pnpm dev` on localhost and checks chain **31337** before every request. Transactions are signed by the unlocked local node; no private key is stored in the app. It reconnects after a page reload until you disconnect through the wallet menu.

You can also connect an injected development wallet on chain **31337**, RPC **http://127.0.0.1:8557**. Funding defaults to Anvil's first development account. `LOCAL_OWNER` can select a different unlocked local account with test ETH for injected wallets; **Anvil Local** always uses the default first account. The funding script wraps test ETH into WETH/wstETH and provides a small USDC interest buffer; it refuses public-chain RPCs.

For **OKX Wallet**, use RPC **http://127.0.0.1:8556** instead. `pnpm fork` starts this wallet-compatible proxy and forwards to this project's Anvil on port 8557. It supports OKX's custom CORS headers and wallet-signed transactions without exposing unlocked Anvil accounts. Port **8546** belongs to the separate borrow aggregator project and does not connect to this fork. If a fork is already running from before the proxy was added, run `pnpm wallet:rpc` in another terminal; no fork reset or redeployment is needed.

The default Ethereum source is `https://eth.drpc.org`; a local read-only transport on port 8558 limits upstream traffic to four requests per second (`FORK_RPS`, set `0` for a direct connection). The first complete reserve read can take several minutes while the fork warms. Both recent and historical storage reads were verified during implementation. Public endpoint availability and archive retention can vary. For sustained sessions, export an archive-capable `FORK_URL` before starting the fork. `ETHEREUM_RPC_URL` selects the source RPC for Foundry tests; optional `FORK_BLOCK` pins their source block. See [.env.example](.env.example). No credentials are included.

After resetting Anvil, rerun deployment, funding, and indexer sync. The generated `contracts/config/local.json` binds the actual factory, venues, proxy implementations, and bytecode hashes; stale or mismatched state disables execution.

## Packages

- `apps/web`: basket composition, individual market selection, transaction review, borrowing, position discovery, and management. Light/dark and mobile layouts use the reference component source and current styles, including its chart-left / borrow-widget-right layout and real Aave rate history for the filtered loan asset and collateral markets.
- `contracts`: deterministic venue-bound accounts, factory, typed internal V3/V4 libraries, tests, and local setup scripts. Protocol calls originate from each subaccount.
- `apps/indexer`: chain-qualified position/activity entities and dynamic account registration. The app can discover accounts through factory logs without running the indexer.

Market comparison uses the Aave V3/V4 GraphQL catalogs for markets, tokens, collateral eligibility, and USD prices on the selected source chain (Ethereum for Anvil). It filters by protocol version, exact debt token address, and every supplied collateral, then batches API borrow-rate requests only for the remaining markets. Rows sort by borrow APY, with the lowest available rate selected by default. Manual selection persists through amount edits; changing filters or assets returns to the lowest-rate default. Browsing, USD values, Max LTV, and entered-position LTV/health-factor estimates work without a wallet or native simulation. Missing inputs remain unknown. Catalog rows and pending rates use the shared skeleton component. V4 API rates are labeled Base APY and exclude the position risk premium. Ethereum catalog markets are dynamically eligible for local execution without a manual manifest entry or factory registration. Selecting a market validates its deployed code and adapter interface on the current fork, then quotes only the entered collateral/debt reserves. Creation requires a verified factory, fresh compatible market data, and sufficient wallet funding. Approve & sign prepares calldata once, then requests token approvals and the wallet signature without an app simulation or post-approval refresh. Review risk and rates remain estimates; the account enforces health, rate and deadline limits on chain. The local setup retains bytecode pins for the V3 Ethereum Pool plus V4 Main/Core and Bluechip/Core; Bluechip comparisons honor Core USDC reserve 7, distinct from its Prime USDC reserve. Other multi-Hub V4 loans bind execution to the exact reserve used for the displayed rate. Markets absent at the pinned fork block or incompatible with the adapters show their validation reason.

Borrow APY history follows the same loan asset, collateral, and version filters as market comparison. Each matching Pool/Spoke debt reserve has its own line and legend entry; unavailable history is labeled explicitly. V4 history shows base APY before collateral risk premiums, with separate lines for duplicate underlying-token reserves. Run `pnpm --filter @aave-isolated/web test:rate-history` for chart filter and mobile regression checks.

The optional indexer needs Docker. Run `pnpm indexer:sync`, `pnpm --filter @aave-isolated/indexer codegen`, then `pnpm dev:indexer`.

## Verification

```sh
pnpm typecheck
pnpm test
ETHEREUM_RPC_URL=http://127.0.0.1:8557 pnpm test:fork
pnpm check:contracts
pnpm build
pnpm --filter @aave-isolated/web exec node --experimental-strip-types scripts/integration-local.mjs
```

Run `pnpm --filter @aave-isolated/web test:market-comparison` for API filtering, sorting, selection and USD regression checks. Run `pnpm --filter @aave-isolated/web test:browser` with a Playwright Chromium installation for light/dark desktop/mobile checks. Set `RUN_LOCAL_WALLET_UI=1` to include injected test-wallet rejection, creation, and same-account collateral addition. `HEADLESS_CHROMIUM` can point to an existing compatible Chromium executable.

With the fork and dev server running, `pnpm --filter @aave-isolated/web test:anvil-wallet` verifies Anvil Local connection without an extension or popup, automatic reconnection, and persistent disconnection.

The integration command sends disposable transactions to the funded local fork only. It verifies owner-bound read-only simulation, review stability, separate same-market accounts, V4 collateral addition, unsafe-action rejection, repayment, closure, and retained history.

For a production-mode local server, stop the dev server, run `pnpm build`, then `pnpm --filter @aave-isolated/web start`.

See [architecture](docs/architecture.md), [domain model](docs/domain-model.md), [protocol provenance](docs/protocol-sources.md), [local development](docs/local-development.md), and [verification results](docs/verification.md). Public deployment is outside this workspace's configured execution scope.
