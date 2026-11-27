# Domain model

An owner controls one or more dedicated position accounts. Each account is permanently bound to one chain, one Aave version, one V3 Pool or V4 Spoke, and one creation salt. Collateral and debt are collections inside that account; no balances or health factors are combined across accounts or venues.

V3 reserve identity is the Pool plus underlying address. V4 reserve identity is the Spoke plus `reserveId`, whose underlying, Hub, and Hub asset mapping are read from the Spoke. Symbols are display labels only.

Native metrics are preferred. V3 account data is read from `getUserAccountData`; reserve balances come from aToken and debt-token balances. V4 account data is read from `getUserAccountData`, user reserve status, supplied assets, total debt, and premium debt. Currency values remain null unless the deployment’s native value denomination is verified.

`Asset.tokenId` is the optional form-level identity introduced to compare compatible underlying tokens across markets. `Asset.id` remains the venue-native identity for market balances and management.

Market quote eligibility describes reserve compatibility independently of wallet execution readiness. Disconnected and unfunded wallets can compare observed rates and select compatible markets. V4 market rates are Hub base rates until a successful native position simulation includes the collateral risk premium. Wallet balance and optional exact-quote simulation failures are reported separately as execution reasons. Creation prepares calldata from fresh market observations without requiring a simulated quote or native post-action risk. The review retains estimated risk until the position is confirmed; management still uses native post-action risk.

A catalog market is a candidate for execution on its source-chain fork, rather than a comparison-only venue pending manual registration. Creation availability requires a verified factory, a deployed compatible market, fresh observations and sufficient wallet funding. The account enforces the deadline, minimum health factor and maximum borrowing rate on chain. V4 creation bounds the collateral premium using the highest enabled collateral risk plus the existing rate tolerance. Local market definitions can pin implementations and debt-reserve choices. Each position remains permanently bound to its chosen venue.
