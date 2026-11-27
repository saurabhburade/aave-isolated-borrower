# Deployment manifests

Deployment manifests identify the factory and protocol contracts used by the application. The backend verifies their chain, addresses, and code hashes before enabling execution.

| File | Purpose |
| --- | --- |
| `verified-ethereum.json` | Reference Ethereum V3 Pool and V4 Main Spoke identities, implementation hashes, and lifecycle evidence |
| `local.json` | Factory deployment and optional market pins for the local Ethereum fork |

The reference manifest has no public application factory. Local execution uses Anvil chain 31337.

## Generate the local manifest

Run from the repository root:

```sh
pnpm fork
```

Keep the fork running, then run in another terminal:

```sh
pnpm local:deploy
pnpm indexer:sync
```

The deployment script reads the source fork block and writes the deployed factory address and code hashes to `local.json`. Regenerate the manifest after resetting the fork or deploying a new factory.

## Market discovery

Local market entries provide optional bytecode pins and reserve preferences. The backend also discovers Ethereum markets from the Aave catalog and validates each selected venue on the fork. New compatible markets require no factory registration.

An absent, stale, or mismatched manifest disables execution. See [local development](../../docs/local-development.md) for configuration and [protocol sources](../../docs/protocol-sources.md) for contract provenance.
