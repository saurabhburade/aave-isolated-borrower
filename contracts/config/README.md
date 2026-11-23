# Contract deployment manifests

`verified-ethereum.json` records the independently checked Ethereum V3 Pool revision 12 and V4 Main Spoke, with proxy/implementation hashes and native lifecycle evidence. It has no public-chain application factory.

`local.json` records the current disposable factory on chain 31337, port 8557. From the repository root, run `pnpm fork`, then `pnpm local:deploy` to regenerate it after resetting Anvil. The script reads the actual source fork block, uses the unlocked local account by default, and refuses public-chain RPCs.

Venue and factory code hashes are verified before discovery and execution. An absent, stale, or mismatched manifest keeps markets unavailable.

The local market list is an optional set of bytecode pins and reserve preferences. The backend also discovers Ethereum markets from the official Aave catalog, validates their deployment and adapter interface on the current fork, and reads their native reserves when selected. The factory takes version and venue per position; it has no market-registration step.
