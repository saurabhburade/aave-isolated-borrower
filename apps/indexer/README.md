# Aave isolated position indexer

This is an Envio HyperIndex v3.17.1 indexer for the frozen `PositionFactory` and dynamic `PositionAccount` event surface. It indexes chain-qualified creation, action, and execution history only; current balances, accrued debt, native health factor, and risk premium remain protocol reads in the web data layer.

Run `pnpm sync-local-config` after a verified `contracts/config/local.json` exists. The checked-in `config.yaml` intentionally contains a zero-address fail-closed placeholder. Never start the indexer with that placeholder.

The current Envio v3 flow is `pnpm envio codegen` followed by `pnpm envio dev`. Local HyperIndex uses Docker for Postgres/Hasura. `ENVIO_API_TOKEN` is only needed for HyperSync-backed chains; the local Anvil chain is RPC-only.
