# Contract coverage and gas benchmarks

Measured on November 27, 2026 against source revision `8fdfd7b`. Contract coverage uses the existing seven-test unit suite. Gas results use a separate 28-scenario benchmark suite; production contract sources are unchanged.

## Environment

| Setting | Value |
| --- | --- |
| Foundry | 1.7.1 (`4072e487`) |
| Solidity | 0.8.24 |
| Gas report optimizer | Enabled, 200 runs |
| EVM target | Cancun |
| via IR | Disabled |

## Contract coverage

Measured across executable Solidity contracts in `contracts/src` using the seven existing mock unit tests. All seven tests passed.

### Solidity breakdown

| File | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `PositionAccount.sol` | 79.52% (66/83) | 79.70% (106/133) | 48.00% (12/25) | 72.73% (8/11) |
| `PositionFactory.sol` | 100.00% (15/15) | 90.48% (19/21) | 33.33% (1/3) | 100.00% (3/3) |
| `SafeToken.sol` | 100.00% (6/6) | 87.50% (7/8) | 50.00% (1/2) | 100.00% (1/1) |
| `adapters/AaveV3Actions.sol` | 90.57% (48/53) | 82.35% (70/85) | 38.89% (7/18) | 100.00% (4/4) |
| `adapters/AaveV4Actions.sol` | 66.67% (36/54) | 55.95% (47/84) | 25.00% (4/16) | 100.00% (4/4) |
| **Total** | **81.04% (171/211)** | **75.23% (249/331)** | **39.06% (25/64)** | **86.96% (20/23)** |

### Scope and gaps

Solidity coverage includes the existing mock tests and executable production contracts. Tests, deployment scripts, and interfaces without executable code are excluded from the totals. Foundry disables optimization for coverage instrumentation; gas measurements use the optimized build separately. Foundry emitted source-map anchor warnings during coverage collection, so these are its reported source-level percentages.

Gaps in this unit-only report include idle-token recovery and V4 repayment and withdrawal paths. The gas benchmark suite exercises those paths separately. Native fork and gas benchmark suites are excluded from these coverage totals.

### Reproduce coverage

Run from the repository root:

```sh
cd contracts
forge coverage --force --match-path test/PositionAccount.t.sol \
  --exclude-tests --no-match-coverage '^(script|test)/' \
  --report summary --report lcov --report-file /tmp/aave-isolated-coverage.info
```

## Gas benchmarks

The [benchmark suite](../contracts/test/GasBenchmarks.t.sol) contains **28 successful scenarios**. Every scenario records the target operation and checks its resulting state. Values below come from the [saved baseline](../contracts/snapshots/GasBenchmarks.json).

### Deployment

| Operation | Gas | Measurement |
| --- | ---: | --- |
| Deploy `PositionFactory` | 3,154,674 | Section snapshot around `new PositionFactory()` |

Factory deployment is a separate setup cost. Each account-creation row below includes deploying and initializing its own `PositionAccount`, but excludes deploying the factory.

### V3 and V4 lifecycle

Both versions use a single collateral asset and identical token amounts. Funding assets and actions refer to the arrays passed to `createPosition` or `execute`. Idle recovery calls `recoverIdle` directly.

| Operation | Funding assets | Actions | V3 gas | V4 gas |
| --- | ---: | --- | ---: | ---: |
| Create account and supply collateral | 1 | 1 | 2,599,542 | 2,616,668 |
| Create account, supply, and borrow | 1 | 2 | 2,671,213 | 2,693,237 |
| Add to existing collateral | 1 | 1 | 118,441 | 116,190 |
| Withdraw part of the collateral | 0 | 1 | 99,464 | 96,325 |
| Borrow more | 0 | 1 | 102,631 | 106,153 |
| Repay part of the debt | 1 | 1 | 120,122 | 115,611 |
| Repay all debt and refund excess funding | 1 | 1 | 122,744 | 118,232 |
| Repay all debt and withdraw all collateral | 1 | 2 | 175,058 | 170,359 |
| Add collateral and borrow in one batch | 1 | 2 | 177,705 | 179,372 |
| Recover idle tokens | 0 | Direct call | 51,364 | 51,364 |

### V4 baskets and configuration

The two-collateral scenarios supply both assets into the same position account. They exercise batch funding, collateral configuration, and withdrawal of both balances.

| Operation | Funding assets | Actions | Gas |
| --- | ---: | ---: | ---: |
| Create account with two collateral assets | 2 | 2 | 2,711,062 |
| Create account with two collateral assets and borrow | 2 | 3 | 2,786,874 |
| Add a second collateral asset | 1 | 1 | 145,853 |
| Repay all debt and withdraw both collateral assets | 1 | 3 | 218,135 |
| Disable one collateral asset | 0 | 1 | 63,360 |
| Enable one collateral asset | 0 | 1 | 67,300 |
| Refresh configuration and risk premium | 0 | 1 | 49,691 |

### Workloads

| Parameter | Fixture |
| --- | --- |
| Collateral tokens | Mock ERC-20 tokens, 18 decimals |
| Debt token | Mock ERC-20 token, 6 decimals |
| New single-collateral account | Supply 10 collateral tokens; borrow 2 debt tokens where specified |
| New two-collateral account | Supply 10 first-collateral tokens and 5 second-collateral tokens; borrow 2 debt tokens where specified |
| Existing account | 10 collateral tokens and 2 debt tokens |
| Existing V4 basket | 10 first-collateral tokens, 5 second-collateral tokens, and 2 debt tokens |
| Partial supply or withdrawal | 1 collateral token |
| Additional borrowing or partial repayment | 1 debt token |
| Full repayment | Fund 3 debt tokens, repay the 2-token debt with `uint256.max`, refund the remaining token |
| Single-collateral closure | Fund 2 debt tokens, repay all debt, withdraw all collateral |
| Basket closure | Fund 2 debt tokens, repay all debt, withdraw both collateral assets |
| Idle recovery | Recover 1 collateral token held directly by the account |
| Collateral toggles | Disable or re-enable the second collateral while retaining its supplied balance |
| Execution limits | Minimum health factor 1.1; maximum borrow rate `1e26` ray; deadline one day after the test timestamp |

The owner starts with nonzero token balances and sufficient funding. Required owner-to-account approvals are established before measurement. Every scenario starts from a fresh copy of the setup state; one test's mutations cannot affect another's baseline.

### Measurement method

1. Run the optimized build with `--isolate`, which gives external calls separate transaction contexts and avoids access warming from earlier fixture calls.
2. Call the target factory or account function, then record `snapshotGasLastCall` immediately, before any external assertion reads. Factory deployment uses a section snapshot around the creation expression because this Foundry version's last-call snapshot measures calls only.
3. Check the operation's resulting balances, debt, or collateral state after recording. Fixture deployment, owner approvals, test assertions, and snapshot bookkeeping are excluded from operation call snapshots.
4. Save the 28 named results in `contracts/snapshots/GasBenchmarks.json`. The check command compares each result against that baseline and exits unsuccessfully if a value changes, without writing a replacement baseline.

The published call values match Foundry's callee execution traces. They include nested token/protocol calls and account events, and are measured before receipt-level refunds. They exclude a standalone wallet transaction's intrinsic/calldata gas and caller-side ABI preparation. Factory deployment is a caller-side creation section and is reported separately. See [Foundry gas snapshot documentation](https://www.getfoundry.sh/reference/cheatcodes/gas-snapshots) for snapshot semantics.

These measurements replace the earlier aggregate lifecycle-test ranges. The dedicated suite uses fixed amounts, isolated calls, and one named snapshot per operation; its values should be compared only with runs using the same fixture, settings, and measurement method.

### Scope and limitations

- Protocols and tokens are local mocks. These results establish regression baselines for this account implementation and fixture; they do not estimate live Aave transaction receipts or fees.
- The existing V3 mock supports one collateral asset and its collateral-toggle method is a no-op. V3 multi-collateral creation and collateral toggles are therefore omitted from this baseline.
- V4 configuration/risk refresh methods are no-ops in the mock. The refresh row measures the account and adapter calls; native V4 recomputation can cost more.
- Owner approval transactions, failed executions, native interest accrual, token-specific behavior, and chain-specific transaction pricing are outside this suite. Gas units are independent of the gas price paid by a wallet.
- No cross-version efficiency claim follows from the mock comparison: the V3 and V4 mocks implement different protocol internals.

### Reproduce and check

From the repository root, generate or intentionally update the baseline:

```sh
pnpm --filter @aave-isolated/contracts test:gas
```

Check current measurements against the saved baseline without rewriting it:

```sh
pnpm --filter @aave-isolated/contracts test:gas:check
```

The equivalent Foundry commands are:

```sh
cd contracts
forge test --match-path test/GasBenchmarks.t.sol --isolate
forge test --match-path test/GasBenchmarks.t.sol --isolate \
  --gas-snapshot-check true --gas-snapshot-emit false
```

Use the optimized default profile when collecting gas results. After coverage collection, Foundry recompiles when optimizer settings change. Review the snapshot diff before accepting a baseline update. The gas values printed beside entire test functions include harness work; use the named JSON snapshots for the published operation values.

See [verification notes](verification.md) for the separate native V3/V4 fork lifecycle checks.
