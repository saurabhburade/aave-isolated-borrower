# Protocol sources and verification

The implementation follows the current primary sources:

- [Aave V3 Pool](https://aave.com/docs/aave-v3/smart-contracts/pool): `getReservesList`, `getReserveData`, `getConfiguration`, `getUserConfiguration`, and `getUserAccountData`.
- [Aave V4 reserve model](https://aave.com/docs/aave-v4/liquidity/reserves): Spoke-local reserves, underlying tokens, caps/status, collateral configuration, and dynamic configuration.
- [Aave V4 position fetch](https://aave.com/docs/aave-v4/positions/fetch): position reads by Spoke reserve ID and user account.
- [Aave V4 `ISpoke`](https://github.com/aave/aave-v4/blob/main/src/spoke/interfaces/ISpoke.sol): `getReserve`, user supply/debt/status, account data, risk premium, and native supply/withdraw/borrow/repay actions.
- [Aave V4 `IHub`](https://github.com/aave/aave-v4/blob/main/src/hub/interfaces/IHub.sol): exact Hub `getAssetDrawnRate(assetId)` base borrow-rate read for each Spoke reserve's Hub/asset mapping.
- [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview): current v3 config/handler model and dynamic contract registration.
- [Ethereum `eth_simulateV1`](https://ethereum.github.io/execution-apis/docs/ethsimulatev1-notes/): sequential ephemeral calls used for approval + creation/management + native risk reads.

The executable manifest must record chain ID, local fork block, venue/factory addresses, bytecode hashes, optional ERC-1967 implementation metadata, ABI provenance, and implementation revision. Markets remain unavailable until the local setup scripts generate and verify that manifest. No public-chain deployment or user funds are used.

## Observed deployment

On 2026-11-25 the dRPC-backed Ethereum fork was pinned to block **26491052**, served locally as chain 31337. The V3 Pool was `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` (revision **12**), proxy implementation `0x4295fe69b3e978eb511e4558b4407ad871612fcb`. The V4 Main Spoke was `0x94e7A5dCbE816e498b89aB752661904E2F56c485`, implementation `0xabd0e26fe17bde4f1f1187ed8aa80c274e03d8b5`, with Hub `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9`.

Native inventory returned 68 V3 reserves and 15 V4 reserves. On the V4 Spoke, WETH reserve 0 and wstETH reserve 1 were compatible collateral in one actual account; USDC reserve 7 maps to Hub asset 5. Each lifecycle used the deployed Pool/Spoke, not a mock. Proxy/implementation hashes are in `contracts/config/local.json`; the local factory is disposable and must be regenerated after resets.

Initial direct public RPC runs encountered HTTP 429. A read-only local request queue now forwards to the same dRPC source with a fixed request ceiling. It does not fabricate chain responses. [Foundry’s fork configuration](https://www.getfoundry.sh/reference/anvil/anvil) documents upstream throttling and fork state caching; [its RPC implementation](https://foundry-rs.github.io/foundry/src/anvil/eth/api.rs.html) verifies source identity when changing a fork endpoint.

## Bluechip / Core route

The local manifest also verifies Bluechip Spoke `0x973a023A77420ba610f06b3858aD991Df6d85A08`. Native discovery returns 12 reserves. WETH collateral is reserve 0 (Prime Hub); USDC reserve 7 draws from Core Hub `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9`, asset 5. Bluechip also has a distinct Prime USDC reserve 4, so the manifest explicitly selects reserve 7 for token-level debt requests. Exact reserve IDs remain authoritative for position operations. A native quote for 1 WETH collateral and 100 USDC debt was verified eligible on the local fork.
