# Position indexer

An Envio HyperIndex service that indexes position creation, actions, and execution history. Position and event identifiers include the chain ID.

Current collateral balances, accrued debt, health factors, and risk premiums come from protocol reads in the web application. The indexer supplies discovery and history; the app can also discover accounts through factory logs.

## Run locally

Requires the repository dependencies, Docker, and a running local fork with a deployed factory. Run these commands from the repository root:

```sh
pnpm indexer:sync
pnpm --filter @aave-isolated/indexer codegen
pnpm dev:indexer
```

`indexer:sync` generates `config.yaml` from `contracts/config/local.json`. Rerun it after changing the local deployment. The sync script requires chain 31337, the local RPC, and a nonzero factory address. Generate the configuration through this command rather than editing it by hand.

The local chain uses RPC indexing. An Envio API token is needed only for HyperSync-backed configurations.

## Source layout

| Path | Purpose |
| --- | --- |
| `schema.graphql` | Position and activity entities |
| `src/handlers/Positions.ts` | Factory and account event handlers |
| `src/identity.ts` | Chain-qualified position and event identifiers |
| `scripts/sync-local-config.mjs` | Local deployment configuration generator |

## Checks

```sh
pnpm --filter @aave-isolated/indexer typecheck
pnpm --filter @aave-isolated/indexer test
```

The current unit tests cover identity helpers. Event handlers and the Docker runtime need separate integration verification. See [local development](../../docs/local-development.md) for integration setup.
