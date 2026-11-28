# Contract coverage and gas benchmarks

Contract coverage was refreshed on November 28, 2026 using the expanded 64-test local suite. The gas figures below remain the November 27 measurements against source revision `8fdfd7b`; they have not been refreshed by the test additions.

## Environment

| Setting | Value |
| --- | --- |
| Foundry | 1.7.1 (`4072e487`) |
| Solidity | 0.8.24 |
| Gas report optimizer | Enabled, 200 runs |
| EVM target | Cancun |
| via IR | Disabled |

## Contract coverage

Measured across executable Solidity contracts in `contracts/src`. All **64 local tests passed**: seven original unit tests, 22 edge-case tests, five lifecycle/property tests, 28 gas scenarios, and two stateful invariant properties. Live fork tests are excluded.

### Solidity breakdown

| File | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `PositionAccount.sol` | 100.00% (79/79) | 100.00% (127/127) | 100.00% (22/22) | 100.00% (11/11) |
| `PositionFactory.sol` | 100.00% (15/15) | 100.00% (21/21) | 100.00% (3/3) | 100.00% (3/3) |
| `SafeToken.sol` | 100.00% (6/6) | 100.00% (8/8) | 100.00% (2/2) | 100.00% (1/1) |
| `adapters/AaveV3Actions.sol` | 100.00% (53/53) | 100.00% (85/85) | 100.00% (18/18) | 100.00% (4/4) |
| `adapters/AaveV4Actions.sol` | 100.00% (54/54) | 100.00% (84/84) | 100.00% (16/16) | 100.00% (4/4) |
| **Total** | **100.00% (207/207)** | **100.00% (325/325)** | **100.00% (61/61)** | **100.00% (23/23)** |

### Test scope

The default contract test command runs every local Solidity suite, including the gas scenarios, with snapshot writes disabled. Twelve parameterized fuzz tests each run 512 cases. They cover duplicate funding/refunds, recovery, reentrancy, repayment bounds, rate/health boundaries, rate rounding, CREATE2 identity, full lifecycle conservation, and atomic rollback. Boolean parameters select V3/V4; amount, owner, salt, and premium parameters explore additional input ranges.

The invariant handler owns two V3 and two V4 accounts and exposes nine randomized operations: supply, borrow, repay, withdraw, unsolicited token donation, idle recovery, collateral configuration/refresh, a failing batch, and unauthorized calls. V4 accounts include a second collateral reserve. Two invariant properties each run 128 sequences of up to 64 calls (8,192 calls per property in the measured run), with unexpected handler reverts treated as failures.

The handler independently tracks collateral, debt, and unsolicited idle balances. It checks underlying token conservation, immutable authority/venue bindings, cleared protocol allowances, refunds, a conservative solvency bound, isolation of every untouched account, exact authorization errors, and atomic rollback. Expected failures are caught and checked for their exact error selectors rather than silently discarded. The mocks use fixed rates and simplified accounting; interest accrual, real oracle pricing, liquidations, and live protocol upgrades are outside these properties.

The reentrancy regression targets the account currently being initialized and requires `Reentered()` from its callback. Additional fuzz cases exercise all three locked entry points during token callbacks and recovery. Temporarily disabling the guard or refund transfer is used as a local mutation check; production sources are restored afterward.

### Coverage of defensive paths

The constructor restricts the immutable version to 3 or 4. Each account dispatch helper handles V3 explicitly and otherwise uses V4, removing unreachable unsupported-version fallbacks. Comments describe a future factory-managed `mapping(uint8 => address)` registry with approved adapters pinned per account while preserving protocol-call context. Adding another version requires updating validation and all three dispatch helpers together.

The factory's deployed-address mismatch check is retained and covered through fault injection. `predictPosition()` is virtual so a test-only derived factory can deliberately corrupt its prediction while inheriting the real deployment path. The regression checks the exact `InvalidPlan()` error for V3 and V4, absence of deployed account code, unchanged owner/venue balances and funding allowance, and absence of protocol positions. The test approves the actual address as well, ensuring initialization would succeed if the guard were removed; a local guard-removal mutation was detected as an unexpectedly successful creation. Normal production prediction behavior remains unchanged.

The mismatch branch is exercised under an intentionally incorrect derived-factory prediction, not an actual CREATE2 address failure. The account refactor changes compiled creation code and therefore future CREATE2 address predictions.

Foundry disables optimization for coverage and emits source-map anchor warnings. These are its reported source-level percentages, not proof that every possible input or sequence is correct. Internal library guard cases use a small test harness. Test/helper code, scripts, and interfaces without executable code are excluded from the production totals. Gas figures use a separate optimized build.

### Reproduce verification

Run from the repository root:

```sh
pnpm --filter @aave-isolated/contracts test
pnpm --filter @aave-isolated/contracts test:fuzz
pnpm --filter @aave-isolated/contracts test:invariants
pnpm --filter @aave-isolated/contracts coverage
```

For an LCOV artifact:

```sh
cd contracts
forge coverage --no-match-path test/LiveForkLifecycle.t.sol \
  --exclude-tests --no-match-coverage '^(script|test)/' --isolate \
  --gas-snapshot-emit false --report summary --report lcov \
  --report-file /tmp/aave-isolated-coverage.info
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
